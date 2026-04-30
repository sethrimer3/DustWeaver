/**
 * grappleInfluenceRenderer.ts — Renders grapple hook influence visuals:
 *
 *   1. **Influence Circle**: A golden arc around the player at INFLUENCE_RADIUS_WORLD,
 *      brightest in the mouse direction, fading to 0% opacity ±45° from that direction.
 *
 *   2. **Reachable Edge Glow**: Thin golden outlines on wall-block edges within the
 *      influence radius, brightest in the mouse direction, fading to 0% opacity ±30°
 *      from that direction.
 *
 * Both effects respect user-configurable max opacity from visual settings.
 * Only rendered when the player has a grapple charge (hasGrappleChargeFlag === 1).
 */

import type { WorldSnapshot, WallSnapshot } from './snapshot';

// ── Gold colour palette ──────────────────────────────────────────────────────

/** Bright gold at full intensity (centre of the directional arc). */
const BRIGHT_GOLD_R = 255;
const BRIGHT_GOLD_G = 215;
const BRIGHT_GOLD_B = 0;

/** Dark gold at the fade-out edge. */
const DARK_GOLD_R = 160;
const DARK_GOLD_G = 120;
const DARK_GOLD_B = 0;

// ── Angular fade helpers ────────────────────────────────────────────────────

/** Half-angle (radians) for the reachable edge glow fade arc. */
const EDGE_GLOW_HALF_ANGLE_RAD = (30 * Math.PI) / 180;

/**
 * Returns a value in [0, 1] representing how close `angleRad` is to
 * `centerAngleRad`, normalized by `halfSpreadRad`.  1 = exactly at centre,
 * 0 = at or beyond the spread boundary.
 */
function angularFade(angleRad: number, centerAngleRad: number, halfSpreadRad: number): number {
  let delta = angleRad - centerAngleRad;
  // Wrap to [-π, π]
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  const absDelta = Math.abs(delta);
  if (absDelta >= halfSpreadRad) return 0;
  return 1 - absDelta / halfSpreadRad;
}

/**
 * Interpolates between bright and dark gold based on `t` (0=bright, 1=dark)
 * and returns an `rgba()` string with the given alpha.
 */
function goldRgba(t: number, alpha: number): string {
  const r = Math.round(BRIGHT_GOLD_R + (DARK_GOLD_R - BRIGHT_GOLD_R) * t);
  const g = Math.round(BRIGHT_GOLD_G + (DARK_GOLD_G - BRIGHT_GOLD_G) * t);
  const b = Math.round(BRIGHT_GOLD_B + (DARK_GOLD_B - BRIGHT_GOLD_B) * t);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

// ── Influence Circle ────────────────────────────────────────────────────────

/** Number of small arcs used to approximate the smooth angular fade. */
const CIRCLE_ARC_SEGMENTS = 64;

// ── Tension pulse constants (Phase 9) ─────────────────────────────────────

/**
 * Maximum additional opacity multiplier applied to the influence circle and
 * edge glow when the grapple rope is out of effective range.
 *
 * Final boost = 1.0 + grappleTensionFactor × pulseWave × TENSION_PULSE_BOOST_FACTOR
 * At full tension with a peak pulse wave (1.0):
 *   opacity × (1.0 + 1.0 × 1.0 × 1.5) = opacity × 2.5
 * Final alpha is clamped to 1.0 so we never exceed full-bright.
 */
const TENSION_PULSE_BOOST_FACTOR = 1.5;

/** Pulse frequency at minimum tension (Hz). */
const TENSION_PULSE_MIN_HZ = 4;
/** Pulse frequency at maximum tension (Hz). */
const TENSION_PULSE_MAX_HZ = 12;

/**
 * Draws the influence-radius circle as a series of arcs whose colour and
 * opacity fade from the mouse direction outward.
 *
 * @param highlightWidthFraction Fraction of the full 360° circumference (0–1) that
 *   is highlighted.  0.25 → 90° total arc (25% of 360°) centred on mouse.  1.0 → full ring.
 *   Converts to half-angle via: halfAngleRad = fraction × π.
 */
function drawInfluenceCircle(
  ctx: CanvasRenderingContext2D,
  playerScreenXPx: number,
  playerScreenYPx: number,
  radiusScreenPx: number,
  mouseAngleRad: number,
  maxOpacity: number,
  highlightWidthFraction: number,
): void {
  if (maxOpacity <= 0) return;

  // Convert fraction of circumference to half-angle: fraction=0.25 → 45°
  const halfAngleRad = highlightWidthFraction * Math.PI;

  const segAngle = (2 * Math.PI) / CIRCLE_ARC_SEGMENTS;
  ctx.lineWidth = 1.5;

  for (let i = 0; i < CIRCLE_ARC_SEGMENTS; i++) {
    const segStartAngle = -Math.PI + i * segAngle;
    const segMidAngle = segStartAngle + segAngle * 0.5;

    const fade = angularFade(segMidAngle, mouseAngleRad, halfAngleRad);
    if (fade <= 0) continue;

    const alpha = maxOpacity * fade;
    // t=0 → bright gold, t=1 → dark gold; invert fade so centre is bright
    const colorT = 1 - fade;

    ctx.beginPath();
    ctx.arc(playerScreenXPx, playerScreenYPx, radiusScreenPx, segStartAngle, segStartAngle + segAngle);
    ctx.strokeStyle = goldRgba(colorT, alpha);
    ctx.stroke();
  }
}

// ── Line-of-sight helpers ───────────────────────────────────────────────────

/**
 * Parametric t values used by the LOS ray tests.
 *
 * LOS_T_START — skip intersections very close to the ray origin so that a
 *   wall the player is currently touching does not self-occlude.
 * LOS_T_END   — skip intersections right at the ray endpoint so that the
 *   wall that *owns* the edge (whose boundary the endpoint sits on) is not
 *   falsely counted as an occluder even when excludeIndex is specified.
 */
const LOS_T_START = 0.01;
const LOS_T_END   = 0.99;

/**
 * Threshold below which a ray direction component is treated as parallel to
 * an AABB slab.  1e-10 avoids division-by-near-zero artefacts from floating-
 * point rays that are within a tiny fraction of a degree of axis-aligned.
 */
const PARALLEL_RAY_EPSILON = 1e-10;

/**
 * Tests whether the segment from (x1,y1) to (x2,y2) passes through the
 * interior of the AABB [minX,maxX]×[minY,maxY], considering only the
 * parametric range [LOS_T_START, LOS_T_END].
 *
 * Returns true if the segment enters the AABB within that range (i.e. is
 * occluded), false otherwise.
 */
function segmentIntersectsAABB(
  x1: number, y1: number,
  x2: number, y2: number,
  minX: number, minY: number,
  maxX: number, maxY: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;

  let tMin = LOS_T_START;
  let tMax = LOS_T_END;

  // X slab
  if (Math.abs(dx) < PARALLEL_RAY_EPSILON) {
    // Ray is vertical — must be strictly inside the X slab
    if (x1 <= minX || x1 >= maxX) return false;
  } else {
    let t1 = (minX - x1) / dx;
    let t2 = (maxX - x1) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin >= tMax) return false;
  }

  // Y slab
  if (Math.abs(dy) < PARALLEL_RAY_EPSILON) {
    if (y1 <= minY || y1 >= maxY) return false;
  } else {
    let t1 = (minY - y1) / dy;
    let t2 = (maxY - y1) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin >= tMax) return false;
  }

  return true;
}

/**
 * Returns true if the direct line from (playerX,playerY) to (edgeMidX,edgeMidY)
 * is blocked by any solid wall other than the wall at `excludeIndex`.
 */
function isEdgeOccluded(
  playerXWorld: number, playerYWorld: number,
  edgeMidXWorld: number, edgeMidYWorld: number,
  walls: WallSnapshot,
  excludeIndex: number,
): boolean {
  for (let wi = 0; wi < walls.count; wi++) {
    if (wi === excludeIndex) continue;
    if (walls.isInvisibleFlag[wi] === 1) continue;

    const minX = walls.xWorld[wi];
    const minY = walls.yWorld[wi];
    const maxX = minX + walls.wWorld[wi];
    const maxY = minY + walls.hWorld[wi];

    if (segmentIntersectsAABB(playerXWorld, playerYWorld, edgeMidXWorld, edgeMidYWorld,
        minX, minY, maxX, maxY)) {
      return true;
    }
  }
  return false;
}

/**
 * Probes a point just outside an edge to determine whether open air exists
 * in front of it.  Returns false if the probe point falls inside any solid
 * (visible) wall other than `excludeIndex`, meaning the edge is buried
 * against an adjacent wall and should not be highlighted.
 */
/** Distance (world units) to probe outside an edge to check for open air. */
const OPEN_AIR_PROBE_DISTANCE_WORLD = 1.0;

function isOpenAirInFront(
  probeXWorld: number,
  probeYWorld: number,
  walls: WallSnapshot,
  excludeIndex: number,
): boolean {
  for (let wj = 0; wj < walls.count; wj++) {
    if (wj === excludeIndex) continue;
    if (walls.isInvisibleFlag[wj] === 1) continue;
    const minX = walls.xWorld[wj];
    const minY = walls.yWorld[wj];
    const maxX = minX + walls.wWorld[wj];
    const maxY = minY + walls.hWorld[wj];
    // Open intervals intentional: probe landing exactly on a wall boundary
    // (not inside it) still counts as open air.
    if (probeXWorld > minX && probeXWorld < maxX &&
        probeYWorld > minY && probeYWorld < maxY) {
      return false;
    }
  }
  return true;
}

// ── Reachable Edge Glow ─────────────────────────────────────────────────────

/**
 * For each wall within influence radius, draws a thin golden outline on any
 * edge that:
 *   1. **Faces the player** — the player is on the outward side of the edge.
 *   2. **Is within range** — the closest point on the edge to the player is
 *      within INFLUENCE_RADIUS_WORLD.
 *   3. **Is in line-of-sight** — no other wall blocks the ray from the player
 *      to the edge midpoint.
 *
 * The brightness/opacity of each qualifying edge segment is modulated by how
 * close that segment's angle (from the player) is to the mouse direction.
 */
function drawReachableEdgeGlow(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  playerXWorld: number,
  playerYWorld: number,
  mouseAngleRad: number,
  maxOpacity: number,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  if (maxOpacity <= 0) return;

  const influenceRadiusSq = snapshot.moteGrappleDisplayRadiusWorld * snapshot.moteGrappleDisplayRadiusWorld;
  const walls = snapshot.walls;

  ctx.lineWidth = 1.0;

  for (let wi = 0; wi < walls.count; wi++) {
    if (walls.isInvisibleFlag[wi] === 1) continue;

    const wallMinXWorld = walls.xWorld[wi];
    const wallMinYWorld = walls.yWorld[wi];
    const wallMaxXWorld = wallMinXWorld + walls.wWorld[wi];
    const wallMaxYWorld = wallMinYWorld + walls.hWorld[wi];

    // Quick reject: bounding-circle check — closest point on AABB to player
    const closestXWorld = Math.max(wallMinXWorld, Math.min(playerXWorld, wallMaxXWorld));
    const closestYWorld = Math.max(wallMinYWorld, Math.min(playerYWorld, wallMaxYWorld));
    const dxAabb = closestXWorld - playerXWorld;
    const dyAabb = closestYWorld - playerYWorld;
    if (dxAabb * dxAabb + dyAabb * dyAabb > influenceRadiusSq) continue;

    // Screen coords of wall corners
    const sMinX = wallMinXWorld * scalePx + offsetXPx;
    const sMinY = wallMinYWorld * scalePx + offsetYPx;
    const sMaxX = wallMaxXWorld * scalePx + offsetXPx;
    const sMaxY = wallMaxYWorld * scalePx + offsetYPx;

    const edgeMidXWorld = (wallMinXWorld + wallMaxXWorld) * 0.5;
    const edgeMidYWorld = (wallMinYWorld + wallMaxYWorld) * 0.5;

    // ── Top edge: player must be above the wall's top surface ──────────────
    if (playerYWorld < wallMinYWorld) {
      // Closest point on this edge to the player
      const cpX = Math.max(wallMinXWorld, Math.min(playerXWorld, wallMaxXWorld));
      const edgeDxSq = (cpX - playerXWorld) * (cpX - playerXWorld);
      const edgeDySq = (wallMinYWorld - playerYWorld) * (wallMinYWorld - playerYWorld);
      if (edgeDxSq + edgeDySq <= influenceRadiusSq &&
          isOpenAirInFront(edgeMidXWorld, wallMinYWorld - OPEN_AIR_PROBE_DISTANCE_WORLD, walls, wi) &&
          !isEdgeOccluded(playerXWorld, playerYWorld, edgeMidXWorld, wallMinYWorld, walls, wi)) {
        drawEdgeSegment(ctx, sMinX, sMinY, sMaxX, sMinY,
          playerXWorld, playerYWorld, edgeMidXWorld, wallMinYWorld,
          mouseAngleRad, maxOpacity);
      }
    }

    // ── Bottom edge: player must be below the wall's bottom surface ────────
    if (playerYWorld > wallMaxYWorld) {
      const cpX = Math.max(wallMinXWorld, Math.min(playerXWorld, wallMaxXWorld));
      const edgeDxSq = (cpX - playerXWorld) * (cpX - playerXWorld);
      const edgeDySq = (wallMaxYWorld - playerYWorld) * (wallMaxYWorld - playerYWorld);
      if (edgeDxSq + edgeDySq <= influenceRadiusSq &&
          isOpenAirInFront(edgeMidXWorld, wallMaxYWorld + OPEN_AIR_PROBE_DISTANCE_WORLD, walls, wi) &&
          !isEdgeOccluded(playerXWorld, playerYWorld, edgeMidXWorld, wallMaxYWorld, walls, wi)) {
        drawEdgeSegment(ctx, sMinX, sMaxY, sMaxX, sMaxY,
          playerXWorld, playerYWorld, edgeMidXWorld, wallMaxYWorld,
          mouseAngleRad, maxOpacity);
      }
    }

    // ── Left edge: player must be left of the wall's left surface ──────────
    if (playerXWorld < wallMinXWorld) {
      const cpY = Math.max(wallMinYWorld, Math.min(playerYWorld, wallMaxYWorld));
      const edgeDxSq = (wallMinXWorld - playerXWorld) * (wallMinXWorld - playerXWorld);
      const edgeDySq = (cpY - playerYWorld) * (cpY - playerYWorld);
      if (edgeDxSq + edgeDySq <= influenceRadiusSq &&
          isOpenAirInFront(wallMinXWorld - OPEN_AIR_PROBE_DISTANCE_WORLD, edgeMidYWorld, walls, wi) &&
          !isEdgeOccluded(playerXWorld, playerYWorld, wallMinXWorld, edgeMidYWorld, walls, wi)) {
        drawEdgeSegment(ctx, sMinX, sMinY, sMinX, sMaxY,
          playerXWorld, playerYWorld, wallMinXWorld, edgeMidYWorld,
          mouseAngleRad, maxOpacity);
      }
    }

    // ── Right edge: player must be right of the wall's right surface ───────
    if (playerXWorld > wallMaxXWorld) {
      const cpY = Math.max(wallMinYWorld, Math.min(playerYWorld, wallMaxYWorld));
      const edgeDxSq = (wallMaxXWorld - playerXWorld) * (wallMaxXWorld - playerXWorld);
      const edgeDySq = (cpY - playerYWorld) * (cpY - playerYWorld);
      if (edgeDxSq + edgeDySq <= influenceRadiusSq &&
          isOpenAirInFront(wallMaxXWorld + OPEN_AIR_PROBE_DISTANCE_WORLD, edgeMidYWorld, walls, wi) &&
          !isEdgeOccluded(playerXWorld, playerYWorld, wallMaxXWorld, edgeMidYWorld, walls, wi)) {
        drawEdgeSegment(ctx, sMaxX, sMinY, sMaxX, sMaxY,
          playerXWorld, playerYWorld, wallMaxXWorld, edgeMidYWorld,
          mouseAngleRad, maxOpacity);
      }
    }
  }
}

/**
 * Draws a single wall edge with golden glow based on the angle from the
 * player to the edge midpoint relative to the mouse direction.
 */
function drawEdgeSegment(
  ctx: CanvasRenderingContext2D,
  screenX1Px: number, screenY1Px: number,
  screenX2Px: number, screenY2Px: number,
  playerXWorld: number, playerYWorld: number,
  edgeMidXWorld: number, edgeMidYWorld: number,
  mouseAngleRad: number,
  maxOpacity: number,
): void {
  const edgeDx = edgeMidXWorld - playerXWorld;
  const edgeDy = edgeMidYWorld - playerYWorld;
  const edgeAngleRad = Math.atan2(edgeDy, edgeDx);

  const fade = angularFade(edgeAngleRad, mouseAngleRad, EDGE_GLOW_HALF_ANGLE_RAD);
  if (fade <= 0) return;

  const alpha = maxOpacity * fade;
  const colorT = 1 - fade;

  ctx.beginPath();
  ctx.moveTo(screenX1Px, screenY1Px);
  ctx.lineTo(screenX2Px, screenY2Px);
  ctx.strokeStyle = goldRgba(colorT, alpha);
  ctx.stroke();
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Renders both the influence circle and the reachable-edge glow when the
 * player has a grapple charge.
 *
 * @param mouseXPx  Mouse X in device-canvas pixels (InputState.mouseXPx).
 * @param mouseYPx  Mouse Y in device-canvas pixels (InputState.mouseYPx).
 * @param canvasWidthPx   Device canvas width (for device→virtual mapping).
 * @param canvasHeightPx  Device canvas height.
 * @param virtualWidthPx  Virtual canvas width (480).
 * @param virtualHeightPx Virtual canvas height (270).
 */
export function renderGrappleInfluenceVisuals(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
  mouseXPx: number,
  mouseYPx: number,
  canvasWidthPx: number,
  canvasHeightPx: number,
  virtualWidthPx: number,
  virtualHeightPx: number,
  edgeGlowMaxOpacity: number,
  influenceCircleMaxOpacity: number,
  influenceHighlightWidth: number,
): void {
  // Only show when the player has a grapple charge
  if (snapshot.hasGrappleChargeFlag !== 1) return;

  // Find the alive player cluster
  let playerXWorld = 0;
  let playerYWorld = 0;
  let hasPlayer = false;
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    const c = snapshot.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerXWorld = c.positionXWorld;
      playerYWorld = c.positionYWorld;
      hasPlayer = true;
      break;
    }
  }
  if (!hasPlayer) return;

  // Convert device-pixel mouse position to virtual canvas pixels, then to world
  const virtualMouseXPx = (mouseXPx / canvasWidthPx) * virtualWidthPx;
  const virtualMouseYPx = (mouseYPx / canvasHeightPx) * virtualHeightPx;
  const mouseXWorld = (virtualMouseXPx - offsetXPx) / scalePx;
  const mouseYWorld = (virtualMouseYPx - offsetYPx) / scalePx;

  // Angle from player to mouse in world space
  const mouseAngleRad = Math.atan2(mouseYWorld - playerYWorld, mouseXWorld - playerXWorld);

  // Player position in virtual-canvas screen coordinates
  const playerScreenXPx = playerXWorld * scalePx + offsetXPx;
  const playerScreenYPx = playerYWorld * scalePx + offsetYPx;

  ctx.save();

  // ── Phase 9: tension pulse — widen circle highlight and flicker ───────────
  // When grappleTensionFactor > 0 (rope out of effective range), the influence
  // circle pulses faster and brighter as a "rope under tension" warning.
  const tension = snapshot.grappleTensionFactor;
  let circleOpacity = influenceCircleMaxOpacity;
  let edgeOpacity   = edgeGlowMaxOpacity;
  if (tension > 0) {
    // Pulse frequency scales from TENSION_PULSE_MIN_HZ → MAX_HZ as tension goes 0 → 1.
    const pulseHz = TENSION_PULSE_MIN_HZ + tension * (TENSION_PULSE_MAX_HZ - TENSION_PULSE_MIN_HZ);
    // Use tick-based square-ish sine so the pulse is visible even at low frame rates.
    const pulseWave = 0.5 + 0.5 * Math.sin(snapshot.tick * (2 * Math.PI * pulseHz / 60));
    const boost = 1.0 + tension * pulseWave * TENSION_PULSE_BOOST_FACTOR;
    circleOpacity = Math.min(1.0, influenceCircleMaxOpacity * boost);
    edgeOpacity   = Math.min(1.0, edgeGlowMaxOpacity   * boost);
  }

  // Draw influence circle using the smoothed mote-based display radius
  const radiusScreenPx = snapshot.moteGrappleDisplayRadiusWorld * scalePx;
  drawInfluenceCircle(ctx, playerScreenXPx, playerScreenYPx, radiusScreenPx, mouseAngleRad, circleOpacity, influenceHighlightWidth);

  // Draw reachable edge glow on walls within range
  drawReachableEdgeGlow(ctx, snapshot, playerXWorld, playerYWorld, mouseAngleRad, edgeOpacity, offsetXPx, offsetYPx, scalePx);

  ctx.restore();
}
