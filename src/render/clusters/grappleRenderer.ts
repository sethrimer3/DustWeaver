/**
 * Grapple rendering.
 *
 * Draws all grapple-related visuals onto the 2D canvas:
 *   • Fail beam (dashed line when grapple misses)
 *   • Empty-charge FX (spinning spark when grapple charge is depleted)
 *   • Active rope polyline (dust sprite chain player→wrap points→anchor)
 *   • Attach FX (expanding ring at anchor on hook contact)
 *   • Zip starburst (rotating rays while the zip is active at the anchor)
 *   • Debug overlays (sweep segment, raw hit, surface normal, wrap corners)
 */

import { WorldSnapshot } from '../snapshot';
import { MAX_GRAPPLE_WRAP_POINTS } from '../../sim/world';
import { loadImg, isSpriteReady } from '../imageCache';

// ── Grapple dust sprites ─────────────────────────────────────────────────────

const _grappleDustSprite = loadImg('SPRITES/DUST/grapplingHook/grapplingHookDust.png');
const _grappleDustEndSprite = loadImg('SPRITES/DUST/grapplingHook/grapplingHookDust_end.png');
const GRAPPLE_DUST_SEGMENT_PX = 4;
const GRAPPLE_DUST_SIZE_PX = 4;
const GRAPPLE_DUST_END_SIZE_PX = 4;

// Pre-allocated scratch arrays for the grapple polyline waypoints.
// Max waypoints = 1 (player) + MAX_GRAPPLE_WRAP_POINTS + 1 (anchor).
// Module-level to avoid per-frame heap allocation.
const _scratchWpX = new Float32Array(2 + MAX_GRAPPLE_WRAP_POINTS);
const _scratchWpY = new Float32Array(2 + MAX_GRAPPLE_WRAP_POINTS);

function renderGrappleFailBeam(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  if (snapshot.grappleFailBeamTicksLeft <= 0) return;

  const totalTicks = Math.max(1, snapshot.grappleFailBeamTotalTicks);
  const elapsedTicks = totalTicks - snapshot.grappleFailBeamTicksLeft;
  const extendTicks = 5;
  const hoverTicks = 3;
  const extendT = Math.min(1, elapsedTicks / extendTicks);

  let alpha = 1;
  if (elapsedTicks > extendTicks + hoverTicks) {
    const fadeT = (elapsedTicks - extendTicks - hoverTicks) / Math.max(1, totalTicks - extendTicks - hoverTicks);
    alpha = Math.max(0, 1 - fadeT);
  }

  const sx = snapshot.grappleFailBeamStartXWorld * scalePx + offsetXPx;
  const sy = snapshot.grappleFailBeamStartYWorld * scalePx + offsetYPx;
  const exFull = snapshot.grappleFailBeamEndXWorld * scalePx + offsetXPx;
  const eyFull = snapshot.grappleFailBeamEndYWorld * scalePx + offsetYPx;
  const ex = sx + (exFull - sx) * extendT;
  const ey = sy + (eyFull - sy) * extendT;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;

  ctx.strokeStyle = 'rgba(255, 230, 120, 0.85)';
  ctx.lineWidth = Math.max(1, scalePx * 0.75);
  ctx.setLineDash([2 * scalePx, 2 * scalePx]);
  ctx.beginPath();
  ctx.moveTo(Math.round(sx), Math.round(sy));
  ctx.lineTo(Math.round(ex), Math.round(ey));
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = 'rgba(255, 245, 170, 0.9)';
  const r = Math.max(1, scalePx);
  ctx.fillRect(Math.round(ex) - r, Math.round(ey) - r, r * 2, r * 2);

  ctx.restore();
}

function renderGrappleEmptyFx(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  if (snapshot.grappleEmptyFxTicksLeft <= 0) return;

  const totalTicks = Math.max(1, snapshot.grappleEmptyFxTotalTicks);
  const elapsedTicks = totalTicks - snapshot.grappleEmptyFxTicksLeft;
  const t = elapsedTicks / totalTicks;
  const alpha = Math.max(0, 1 - t);

  const cx = snapshot.grappleEmptyFxXWorld * scalePx + offsetXPx;
  const cy = snapshot.grappleEmptyFxYWorld * scalePx + offsetYPx;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;

  const radius = (2 + t * 5) * scalePx;
  ctx.strokeStyle = 'rgba(255, 180, 80, 0.8)';
  ctx.lineWidth = Math.max(1, scalePx * 0.75);
  ctx.beginPath();
  ctx.arc(Math.round(cx), Math.round(cy), radius, -Math.PI * 0.2, Math.PI * 1.15);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 220, 90, 0.9)';
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + t * 2.0;
    const inward = (1 - t) * 4 * scalePx;
    const x = cx + Math.cos(angle) * inward;
    const y = cy + Math.sin(angle) * inward;
    const s = Math.max(1, scalePx);
    ctx.fillRect(Math.round(x) - s, Math.round(y) - s, s * 2, s * 2);
  }

  ctx.restore();
}

/**
 * Renders the zip impact shockwave ring and dust plume at the zip completion
 * or blocked-zip contact point.
 *
 * Normal zip completion: a single expanding golden ring (scale 1.0).
 * Successful zip-jump:   a slightly larger ring (scale ZIP_JUMP_FX_SCALE ≈ 1.35)
 *                        that communicates the timed jump was registered.
 *
 * The dust plume fans outward from the impact point in the surface normal
 * direction, giving a directional read of which surface the player hit.
 */
function renderZipImpactFx(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  if (snapshot.zipImpactFxTicksLeft <= 0) return;

  const totalTicks = Math.max(1, snapshot.zipImpactFxTotalTicks);
  const elapsed    = totalTicks - snapshot.zipImpactFxTicksLeft;
  const t          = elapsed / totalTicks; // 0 = freshly fired, 1 = expired
  const scale      = snapshot.zipImpactFxScale;
  const alpha      = Math.max(0, 1.0 - t);

  const cx = snapshot.zipImpactFxXWorld * scalePx + offsetXPx;
  const cy = snapshot.zipImpactFxYWorld * scalePx + offsetYPx;
  const nx = snapshot.zipImpactFxNormalXWorld;
  const ny = snapshot.zipImpactFxNormalYWorld;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // ── Shockwave ring: expands outward as t goes 0→1 ─────────────────────────
  const outerRadius = (3 + t * 18 * scale) * scalePx;
  ctx.beginPath();
  ctx.arc(Math.round(cx), Math.round(cy), outerRadius, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255, 220, 120, ${alpha * 0.75})`;
  ctx.lineWidth   = Math.max(1, (2 - t * 1.5) * scalePx);
  ctx.stroke();

  // Bright inner ring (faster fade, slightly smaller — gives a double-ring feel)
  const innerRadius = (1.5 + t * 9 * scale) * scalePx;
  const innerAlpha  = Math.max(0, alpha * (1.0 - t * 1.5));
  if (innerAlpha > 0.01) {
    ctx.beginPath();
    ctx.arc(Math.round(cx), Math.round(cy), innerRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 200, ${innerAlpha})`;
    ctx.lineWidth   = Math.max(1, scalePx);
    ctx.stroke();
  }

  // ── Dust plume: small squares fan outward along the surface normal ─────────
  // Each square's position is at center + normal * distance * t plus a
  // tangential spread, so the plume expands as the FX progresses.
  const PLUME_COUNT  = 8;
  const plumeAlpha   = Math.max(0, alpha * (1.0 - t * 1.2));
  if (PLUME_COUNT >= 2 && plumeAlpha > 0.01) {
    // Tangent of the surface normal for sideways spread.
    const tanX = -ny;
    const tanY =  nx;
    ctx.fillStyle = `rgba(200, 165, 110, ${plumeAlpha})`;

    for (let i = 0; i < PLUME_COUNT; i++) {
      // Spread parameter in [-1, 1]; middle particles go straight along normal.
      const spread = ((i / (PLUME_COUNT - 1)) - 0.5) * 2.0;
      // Blend normal direction with tangent for cone spread.
      const dirX = nx + tanX * spread * 0.9;
      const dirY = ny + tanY * spread * 0.9;
      const len  = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len < 0.001) continue;
      const ndx = dirX / len;
      const ndy = dirY / len;
      // Particles travel further as t increases; scale adjusts max reach.
      const dist  = t * (14 + 8 * scale) * scalePx;
      const px    = Math.round(cx + ndx * dist);
      const py    = Math.round(cy + ndy * dist);
      ctx.fillRect(px - 1, py - 1, 2, 2);
    }
  }

  ctx.restore();
}

export function renderGrapple(ctx: CanvasRenderingContext2D, snapshot: WorldSnapshot, offsetXPx: number, offsetYPx: number, scalePx: number, isDebugMode = false): void {
  const hasActiveGrapple = snapshot.isGrappleActiveFlag === 1;
  const hasFailFx =
    snapshot.grappleFailBeamTicksLeft > 0 ||
    snapshot.grappleEmptyFxTicksLeft > 0;
  const hasZipImpactFx = snapshot.zipImpactFxTicksLeft > 0;

  if (!hasActiveGrapple && snapshot.grappleAttachFxTicks <= 0 && !hasFailFx && !hasZipImpactFx) return;

  renderGrappleFailBeam(ctx, snapshot, offsetXPx, offsetYPx, scalePx);
  renderGrappleEmptyFx(ctx, snapshot, offsetXPx, offsetYPx, scalePx);
  renderZipImpactFx(ctx, snapshot, offsetXPx, offsetYPx, scalePx);

  let playerCluster: (typeof snapshot.clusters)[0] | undefined;
  for (let ci = 0; ci < snapshot.clusters.length; ci++) {
    if (snapshot.clusters[ci].isPlayerFlag === 1 && snapshot.clusters[ci].isAliveFlag === 1) {
      playerCluster = snapshot.clusters[ci];
      break;
    }
  }
  if (playerCluster === undefined && snapshot.grappleAttachFxTicks <= 0) return;

  // Grapple visually originates from right-middle (or left-middle when facing left) of the sprite
  let px = 0;
  let py = 0;
  if (playerCluster !== undefined) {
    const halfW = playerCluster.halfWidthWorld * scalePx;
    const offsetDir = playerCluster.isFacingLeftFlag === 1 ? -1 : 1;
    px = playerCluster.positionXWorld * scalePx + offsetXPx + offsetDir * halfW;
    py = playerCluster.positionYWorld * scalePx + offsetYPx;
  }
  const ax = snapshot.grappleAnchorXWorld * scalePx + offsetXPx;
  const ay = snapshot.grappleAnchorYWorld * scalePx + offsetYPx;

  // ── Build polyline waypoints ──────────────────────────────────────────────
  // When wrapping is enabled and wrap points exist, the rope is a polyline:
  //   player → wrap[count-1] → … → wrap[0] → main anchor
  // Otherwise it is a single straight segment: player → main anchor.
  const wrapCount = (snapshot.isGrappleWrappingEnabled === 1)
    ? snapshot.grappleWrapPointCount
    : 0;

  // waypoints[0] = player; waypoints[last] = main anchor.
  // Max length = 1 (player) + MAX_GRAPPLE_WRAP_POINTS (wraps) + 1 (anchor) = 5.
  // We keep these as screen-space Px coords.
  // Pre-alloc to avoid per-frame heap allocation (max 5 waypoints).
  const waypointCount = 2 + wrapCount;          // player + wraps + anchor
  // Use module-level scratch to avoid hot-path allocation.
  _scratchWpX[0] = px;
  _scratchWpY[0] = py;
  for (let wi = 0; wi < wrapCount; wi++) {
    // Polyline goes from player toward anchor, so the newest wrap is index 1,
    // the oldest is index wrapCount.
    const wIdx = wrapCount - 1 - wi; // newest first
    _scratchWpX[1 + wi] = snapshot.grappleWrapPointXWorld[wIdx] * scalePx + offsetXPx;
    _scratchWpY[1 + wi] = snapshot.grappleWrapPointYWorld[wIdx] * scalePx + offsetYPx;
  }
  _scratchWpX[1 + wrapCount] = ax;
  _scratchWpY[1 + wrapCount] = ay;

  ctx.save();

  if (hasActiveGrapple && playerCluster !== undefined) {
    // Faint guide glow along the whole polyline.
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.08)';
    ctx.lineWidth = 2.0;
    ctx.setLineDash([1, 10]);
    ctx.beginPath();
    ctx.moveTo(_scratchWpX[0], _scratchWpY[0]);
    for (let wi = 1; wi < waypointCount; wi++) {
      ctx.lineTo(_scratchWpX[wi], _scratchWpY[wi]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (hasActiveGrapple && playerCluster !== undefined) {
    // Draw dust sprites along each segment of the polyline.
    const dustSizePx = GRAPPLE_DUST_SIZE_PX * Math.max(1, scalePx * 0.5);
    const spriteReady = isSpriteReady(_grappleDustSprite);

    for (let seg = 0; seg < waypointCount - 1; seg++) {
      const x0 = _scratchWpX[seg];
      const y0 = _scratchWpY[seg];
      const x1 = _scratchWpX[seg + 1];
      const y1 = _scratchWpY[seg + 1];
      const sdx = x1 - x0;
      const sdy = y1 - y0;
      const segLen = Math.sqrt(sdx * sdx + sdy * sdy);
      const segCount = Math.max(1, Math.floor(segLen / GRAPPLE_DUST_SEGMENT_PX));

      if (spriteReady) {
        for (let si = 0; si <= segCount; si++) {
          const t = segCount > 0 ? si / segCount : 0;
          const sx = x0 + sdx * t;
          const sy = y0 + sdy * t;
          ctx.drawImage(_grappleDustSprite, sx - dustSizePx * 0.5, sy - dustSizePx * 0.5, dustSizePx, dustSizePx);
        }
      } else {
        ctx.fillStyle = 'rgba(255, 215, 0, 0.75)';
        for (let si = 0; si <= segCount; si++) {
          const t = segCount > 0 ? si / segCount : 0;
          const sx = x0 + sdx * t;
          const sy = y0 + sdy * t;
          ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
        }
      }
    }
  }

  if (hasActiveGrapple && playerCluster !== undefined) {
    const endSizePx = GRAPPLE_DUST_END_SIZE_PX * Math.max(1, scalePx * 0.5);
    if (isSpriteReady(_grappleDustEndSprite)) {
      ctx.drawImage(_grappleDustEndSprite, ax - endSizePx * 0.5, ay - endSizePx * 0.5, endSizePx, endSizePx);
      ctx.drawImage(_grappleDustEndSprite, px - endSizePx * 0.5, py - endSizePx * 0.5, endSizePx, endSizePx);
      // Draw end sprites at wrap corners too (shows the bend points clearly).
      if (wrapCount > 0) {
        for (let wi = 0; wi < wrapCount; wi++) {
          const wpxPx = snapshot.grappleWrapPointXWorld[wi] * scalePx + offsetXPx;
          const wpyPx = snapshot.grappleWrapPointYWorld[wi] * scalePx + offsetYPx;
          ctx.drawImage(_grappleDustEndSprite, wpxPx - endSizePx * 0.5, wpyPx - endSizePx * 0.5, endSizePx, endSizePx);
        }
      }
    } else {
      ctx.beginPath();
      ctx.arc(ax, ay, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 215, 0, 0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 200, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Fallback circles at wrap corners.
      if (wrapCount > 0) {
        for (let wi = 0; wi < wrapCount; wi++) {
          const wpxPx = snapshot.grappleWrapPointXWorld[wi] * scalePx + offsetXPx;
          const wpyPx = snapshot.grappleWrapPointYWorld[wi] * scalePx + offsetYPx;
          ctx.beginPath();
          ctx.arc(wpxPx, wpyPx, 4, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255, 215, 0, 0.7)';
          ctx.fill();
        }
      }
    }
  }

  if (snapshot.grappleAttachFxTicks > 0) {
    const fxProgress = 1.0 - snapshot.grappleAttachFxTicks / 14.0;
    const fxRadius = 6 + fxProgress * 24;
    const fxAlpha = 0.4 * (1.0 - fxProgress);
    ctx.beginPath();
    ctx.arc(
      snapshot.grappleAttachFxXWorld * scalePx + offsetXPx,
      snapshot.grappleAttachFxYWorld * scalePx + offsetYPx,
      fxRadius,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = `rgba(255, 236, 170, ${fxAlpha})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ── Top-surface grapple special effect: rotating golden starburst at anchor ─
  if (snapshot.isGrappleZipActiveFlag === 1 && snapshot.isGrappleActiveFlag === 1) {
    /** Tick-to-radians scale for starburst rotation speed. */
    const STARBURST_TIME_SCALE = 0.12;
    /** Number of radiating rays in the starburst. */
    const STARBURST_RAY_COUNT = 8;
    /** Inner radius (px) where rays begin — keeps the center clear. */
    const STARBURST_INNER_RADIUS_PX = 2;
    /** Base outer radius (px) of the starburst rays. */
    const STARBURST_OUTER_BASE_PX = 8;
    /** Frequency of the pulsing outer-radius oscillation. */
    const STARBURST_PULSE_FREQUENCY = 3.0;
    /** Amplitude (px) of the pulsing oscillation on the outer radius. */
    const STARBURST_PULSE_AMPLITUDE_PX = 3;
    /** Radius (px) of the bright center glow circle. */
    const STARBURST_CENTER_GLOW_RADIUS_PX = 3;

    const starAx = snapshot.grappleAnchorXWorld * scalePx + offsetXPx;
    const starAy = snapshot.grappleAnchorYWorld * scalePx + offsetYPx;
    const time = snapshot.tick * STARBURST_TIME_SCALE;
    const pulseOuter = STARBURST_OUTER_BASE_PX +
      Math.sin(time * STARBURST_PULSE_FREQUENCY) * STARBURST_PULSE_AMPLITUDE_PX;

    // Radiating golden rays
    for (let r = 0; r < STARBURST_RAY_COUNT; r++) {
      const angle = time + (r / STARBURST_RAY_COUNT) * Math.PI * 2;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(starAx + cosA * STARBURST_INNER_RADIUS_PX, starAy + sinA * STARBURST_INNER_RADIUS_PX);
      ctx.lineTo(starAx + cosA * pulseOuter, starAy + sinA * pulseOuter);
      ctx.strokeStyle = 'rgba(255, 215, 0, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Bright center glow
    ctx.beginPath();
    ctx.arc(starAx, starAy, STARBURST_CENTER_GLOW_RADIUS_PX, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 220, 0.95)';
    ctx.fill();

    // Outer pulsing ring (brighter when stuck / decelerating)
    const ringAlpha = snapshot.isGrappleStuckFlag === 1 ? 0.7 : 0.4;
    ctx.beginPath();
    ctx.arc(starAx, starAy, pulseOuter + 2, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 236, 170, ${ringAlpha})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ── Debug grapple collision visualization ───────────────────────────────────
  // Draws the last sweep segment, raw hit point, surface normal, and snapped
  // anchor when debug mode is on.  Shows how CCD placed the anchor relative
  // to the wall surface so seam or epsilon issues are immediately visible.
  if (isDebugMode && snapshot.isGrappleDebugActiveFlag === 1) {
    const sfx = snapshot.grappleDebugSweepFromXWorld * scalePx + offsetXPx;
    const sfy = snapshot.grappleDebugSweepFromYWorld * scalePx + offsetYPx;
    const stx = snapshot.grappleDebugSweepToXWorld * scalePx + offsetXPx;
    const sty = snapshot.grappleDebugSweepToYWorld * scalePx + offsetYPx;
    const rhx = snapshot.grappleDebugRawHitXWorld * scalePx + offsetXPx;
    const rhy = snapshot.grappleDebugRawHitYWorld * scalePx + offsetYPx;
    const snx = snapshot.grappleAnchorXWorld * scalePx + offsetXPx;
    const sny = snapshot.grappleAnchorYWorld * scalePx + offsetYPx;
    const nx  = snapshot.grappleAnchorNormalXWorld;
    const ny  = snapshot.grappleAnchorNormalYWorld;

    // Sweep segment (cyan dashed line)
    ctx.beginPath();
    ctx.moveTo(sfx, sfy);
    ctx.lineTo(stx, sty);
    ctx.strokeStyle = 'rgba(0, 220, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Raw hit point (yellow cross)
    ctx.strokeStyle = 'rgba(255, 230, 0, 0.9)';
    ctx.lineWidth = 1.5;
    const cs = 4;
    ctx.beginPath(); ctx.moveTo(rhx - cs, rhy); ctx.lineTo(rhx + cs, rhy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rhx, rhy - cs); ctx.lineTo(rhx, rhy + cs); ctx.stroke();

    // Surface normal arrow (magenta) from snapped anchor outward
    const normalLenPx = 12;
    ctx.beginPath();
    ctx.moveTo(snx, sny);
    ctx.lineTo(snx + nx * normalLenPx, sny + ny * normalLenPx);
    ctx.strokeStyle = 'rgba(255, 80, 230, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Snapped anchor point (green circle)
    ctx.beginPath();
    ctx.arc(snx, sny, 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(80, 255, 120, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Label: "AABB" to indicate merged-rectangle broad-phase was used
    ctx.fillStyle = 'rgba(0, 220, 255, 0.85)';
    ctx.font = '8px monospace';
    ctx.fillText('AABB', rhx + 5, rhy - 4);
  }

  // ── Debug: grapple wrapping overlay ─────────────────────────────────────────
  // When debug mode is on and wrapping is enabled, draws the original anchor,
  // all active wrap corners numbered 1–3, and labels for each polyline segment.
  if (isDebugMode && snapshot.isGrappleWrappingEnabled === 1 && hasActiveGrapple) {
    const dbgWrapCount = snapshot.grappleWrapPointCount;
    const origAx = snapshot.grappleAnchorXWorld * scalePx + offsetXPx;
    const origAy = snapshot.grappleAnchorYWorld * scalePx + offsetYPx;
    ctx.font = '7px monospace';

    // Original grapple anchor — white diamond
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.0;
    const ds = 4;
    ctx.beginPath();
    ctx.moveTo(origAx, origAy - ds);
    ctx.lineTo(origAx + ds, origAy);
    ctx.lineTo(origAx, origAy + ds);
    ctx.lineTo(origAx - ds, origAy);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('anchor', origAx + 5, origAy - 3);

    // Wrap point circles + labels
    for (let wi = 0; wi < dbgWrapCount; wi++) {
      const wpxPx2 = snapshot.grappleWrapPointXWorld[wi] * scalePx + offsetXPx;
      const wpyPx2 = snapshot.grappleWrapPointYWorld[wi] * scalePx + offsetYPx;
      ctx.beginPath();
      ctx.arc(wpxPx2, wpyPx2, 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(80, 255, 200, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(80, 255, 200, 0.9)';
      ctx.fillText(`W${wi + 1}`, wpxPx2 + 5, wpyPx2 - 3);
    }

    // Wrapping-enabled status label
    ctx.fillStyle = 'rgba(80, 255, 200, 0.85)';
    ctx.font = '8px monospace';
    const labelX = hasActiveGrapple ? origAx - 24 : 4;
    const labelY = hasActiveGrapple ? origAy + 14 : 14;
    ctx.fillText(`wrap: ${dbgWrapCount > 0 ? 'ON (' + dbgWrapCount + ')' : 'active(0)'}`, labelX, labelY);
  }

  ctx.restore();
}
