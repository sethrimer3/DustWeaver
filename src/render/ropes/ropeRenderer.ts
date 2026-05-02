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

export function renderRopes(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
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

    // Precompute pixel positions
    const xs = new Float32Array(segCount);
    const ys = new Float32Array(segCount);
    for (let s = 0; s < segCount; s++) {
      xs[s] = snapshot.ropeSegPosXWorld[base + s] * zoom + offsetXPx;
      ys[s] = snapshot.ropeSegPosYWorld[base + s] * zoom + offsetYPx;
    }

    // ── Shadow / outline pass ──────────────────────────────────────────
    ctx.strokeStyle = ROPE_OUTLINE;
    ctx.lineWidth   = bodyWidth + ROPE_OUTLINE_EXTRA_PX;
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (let s = 1; s < segCount; s++) {
      ctx.lineTo(xs[s], ys[s]);
    }
    ctx.stroke();

    // ── Body pass ─────────────────────────────────────────────────────
    ctx.strokeStyle = ROPE_FILL;
    ctx.lineWidth   = bodyWidth;
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (let s = 1; s < segCount; s++) {
      ctx.lineTo(xs[s], ys[s]);
    }
    ctx.stroke();

    // ── Anchor caps ───────────────────────────────────────────────────
    ctx.fillStyle = ROPE_ANCHOR;
    const anchorR = Math.max(ROPE_ANCHOR_RADIUS_PX, halfThick * zoom);
    ctx.beginPath();
    ctx.arc(xs[0], ys[0], anchorR, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(xs[segCount - 1], ys[segCount - 1], anchorR, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
