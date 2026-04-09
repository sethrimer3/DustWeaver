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

import type { WorldSnapshot } from './snapshot';
import { INFLUENCE_RADIUS_WORLD } from '../sim/clusters/binding';

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

/** Half-angle (radians) for the influence circle fade arc. */
const INFLUENCE_CIRCLE_HALF_ANGLE_RAD = (45 * Math.PI) / 180;
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

/**
 * Draws the influence-radius circle as a series of arcs whose colour and
 * opacity fade from the mouse direction outward.
 */
function drawInfluenceCircle(
  ctx: CanvasRenderingContext2D,
  playerScreenXPx: number,
  playerScreenYPx: number,
  radiusScreenPx: number,
  mouseAngleRad: number,
  maxOpacity: number,
): void {
  if (maxOpacity <= 0) return;

  const segAngle = (2 * Math.PI) / CIRCLE_ARC_SEGMENTS;
  ctx.lineWidth = 1.5;

  for (let i = 0; i < CIRCLE_ARC_SEGMENTS; i++) {
    const segStartAngle = -Math.PI + i * segAngle;
    const segMidAngle = segStartAngle + segAngle * 0.5;

    const fade = angularFade(segMidAngle, mouseAngleRad, INFLUENCE_CIRCLE_HALF_ANGLE_RAD);
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

// ── Reachable Edge Glow ─────────────────────────────────────────────────────

/**
 * For each visible wall within influence radius, draws a thin golden outline
 * on any edge that faces the player.  The brightness/opacity of each edge
 * segment is modulated by how close that segment's angle (from the player)
 * is to the mouse direction.
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

  const influenceRadiusSq = INFLUENCE_RADIUS_WORLD * INFLUENCE_RADIUS_WORLD;
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
    const dxWorld = closestXWorld - playerXWorld;
    const dyWorld = closestYWorld - playerYWorld;
    if (dxWorld * dxWorld + dyWorld * dyWorld > influenceRadiusSq) continue;

    // Screen coords of wall edges
    const sMinX = wallMinXWorld * scalePx + offsetXPx;
    const sMinY = wallMinYWorld * scalePx + offsetYPx;
    const sMaxX = wallMaxXWorld * scalePx + offsetXPx;
    const sMaxY = wallMaxYWorld * scalePx + offsetYPx;

    // For each of the 4 edges, compute the angle from player to edge midpoint.
    // Only draw the edge if the player is on the facing side.

    // Top edge (player above wall → playerY < wallMinY)
    drawEdgeSegment(ctx, sMinX, sMinY, sMaxX, sMinY,
      playerXWorld, playerYWorld, (wallMinXWorld + wallMaxXWorld) * 0.5, wallMinYWorld,
      mouseAngleRad, maxOpacity);

    // Bottom edge (player below wall → playerY > wallMaxY)
    drawEdgeSegment(ctx, sMinX, sMaxY, sMaxX, sMaxY,
      playerXWorld, playerYWorld, (wallMinXWorld + wallMaxXWorld) * 0.5, wallMaxYWorld,
      mouseAngleRad, maxOpacity);

    // Left edge (player left of wall → playerX < wallMinX)
    drawEdgeSegment(ctx, sMinX, sMinY, sMinX, sMaxY,
      playerXWorld, playerYWorld, wallMinXWorld, (wallMinYWorld + wallMaxYWorld) * 0.5,
      mouseAngleRad, maxOpacity);

    // Right edge (player right of wall → playerX > wallMaxX)
    drawEdgeSegment(ctx, sMaxX, sMinY, sMaxX, sMaxY,
      playerXWorld, playerYWorld, wallMaxXWorld, (wallMinYWorld + wallMaxYWorld) * 0.5,
      mouseAngleRad, maxOpacity);
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

  // Draw influence circle
  const radiusScreenPx = INFLUENCE_RADIUS_WORLD * scalePx;
  drawInfluenceCircle(ctx, playerScreenXPx, playerScreenYPx, radiusScreenPx, mouseAngleRad, influenceCircleMaxOpacity);

  // Draw reachable edge glow on walls within range
  drawReachableEdgeGlow(ctx, snapshot, playerXWorld, playerYWorld, mouseAngleRad, edgeGlowMaxOpacity, offsetXPx, offsetYPx, scalePx);

  ctx.restore();
}
