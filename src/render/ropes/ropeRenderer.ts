/**
 * Rope renderer — draws Verlet rope chains as thick strokes on the 2D canvas.
 *
 * Each rope is rendered with a lineWidth matching its collision half-thickness
 * (2 × ropeHalfThickWorld × zoom), giving a visual width that corresponds to
 * the physics capsule the player interacts with.
 *
 * A thin dark outline (shadow pass) is drawn first to improve readability
 * against varied backgrounds.
 */

import type { WorldSnapshot } from '../snapshotTypes';
import { MAX_ROPE_SEGMENTS } from '../../sim/world';

/** Rope body fill color. */
const ROPE_FILL = 'rgba(180, 140, 80, 0.95)';
/** Dark outline drawn slightly wider than the fill to create depth. */
const ROPE_OUTLINE = 'rgba(80, 50, 20, 0.7)';
/** Anchor cap color (slightly lighter than rope body). */
const ROPE_ANCHOR = 'rgba(230, 195, 120, 1.0)';
/** Anchor cap radius in virtual pixels (not scaled by zoom — always readable). */
const ROPE_ANCHOR_RADIUS_PX = 2.5;
/** Outline-to-fill line-width ratio (outline is this many extra pixels wider). */
const ROPE_OUTLINE_EXTRA_PX = 2.0;

/**
 * Pre-allocated scratch arrays for rope segment pixel positions.
 * MAX_ROPE_SEGMENTS is imported to bound the size.  These buffers are reused
 * every frame to avoid per-frame heap allocations in the render hot path.
 */
const _scratchXsPx = new Float32Array(MAX_ROPE_SEGMENTS);
const _scratchYsPx = new Float32Array(MAX_ROPE_SEGMENTS);

import { isScreenRectVisible } from '../viewportCull';

export function renderRopes(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  vpW = 480,
  vpH = 270,
): void {
  if (snapshot.ropeCount === 0) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let r = 0; r < snapshot.ropeCount; r++) {
    const segCount = snapshot.ropeSegmentCount[r];
    if (segCount < 2) continue;
    const base = r * MAX_ROPE_SEGMENTS;

    // Line width in canvas pixels = 2 × halfThick × zoom
    const halfThick = snapshot.ropeHalfThickWorld[r];
    const bodyWidth = Math.max(1.0, halfThick * 2.0 * zoom);

    // Precompute pixel positions into pre-allocated scratch buffers
    // and compute AABB for viewport culling in the same pass.
    let minXPx = Infinity, minYPx = Infinity, maxXPx = -Infinity, maxYPx = -Infinity;
    for (let s = 0; s < segCount; s++) {
      const xPx = snapshot.ropeSegPosXWorld[base + s] * zoom + offsetXPx;
      const yPx = snapshot.ropeSegPosYWorld[base + s] * zoom + offsetYPx;
      _scratchXsPx[s] = xPx;
      _scratchYsPx[s] = yPx;
      if (xPx < minXPx) minXPx = xPx;
      if (yPx < minYPx) minYPx = yPx;
      if (xPx > maxXPx) maxXPx = xPx;
      if (yPx > maxYPx) maxYPx = yPx;
    }

    // Skip ropes whose AABB (plus margin for outline + anchor cap) is offscreen.
    const margin = bodyWidth + ROPE_OUTLINE_EXTRA_PX + ROPE_ANCHOR_RADIUS_PX + 1;
    if (!isScreenRectVisible(
      minXPx - margin, minYPx - margin,
      maxXPx - minXPx + margin * 2, maxYPx - minYPx + margin * 2,
      vpW, vpH,
    )) continue;

    // ── Shadow / outline pass ──────────────────────────────────────────
    ctx.strokeStyle = ROPE_OUTLINE;
    ctx.lineWidth   = bodyWidth + ROPE_OUTLINE_EXTRA_PX;
    ctx.beginPath();
    ctx.moveTo(_scratchXsPx[0], _scratchYsPx[0]);
    for (let s = 1; s < segCount; s++) {
      ctx.lineTo(_scratchXsPx[s], _scratchYsPx[s]);
    }
    ctx.stroke();

    // ── Body pass ─────────────────────────────────────────────────────
    ctx.strokeStyle = ROPE_FILL;
    ctx.lineWidth   = bodyWidth;
    ctx.beginPath();
    ctx.moveTo(_scratchXsPx[0], _scratchYsPx[0]);
    for (let s = 1; s < segCount; s++) {
      ctx.lineTo(_scratchXsPx[s], _scratchYsPx[s]);
    }
    ctx.stroke();

    // ── Anchor caps ───────────────────────────────────────────────────
    ctx.fillStyle = ROPE_ANCHOR;
    const anchorR = Math.max(ROPE_ANCHOR_RADIUS_PX, halfThick * zoom);
    ctx.beginPath();
    ctx.arc(_scratchXsPx[0], _scratchYsPx[0], anchorR, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(_scratchXsPx[segCount - 1], _scratchYsPx[segCount - 1], anchorR, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
