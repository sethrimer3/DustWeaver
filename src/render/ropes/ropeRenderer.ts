/**
 * Rope renderer — draws Verlet rope chains as connected line segments
 * on the 2D canvas.
 */

import type { WorldSnapshot } from '../snapshotTypes';
import { MAX_ROPE_SEGMENTS } from '../../sim/world';

/** Base rope stroke color (RGBA). */
const ROPE_STROKE = 'rgba(180, 140, 80, 0.9)';
/** Highlight color for anchor endpoints (slightly lighter). */
const ROPE_HIGHLIGHT = 'rgba(220, 180, 100, 0.9)';
/**
 * Base line-width multiplier for the rope stroke.
 * Multiplied by `zoom` at draw time so the rope scales with world zoom.
 * Dimensionless — not a coordinate or pixel value.
 */
const ROPE_LINE_WIDTH = 1.5;

export function renderRopes(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldSnapshot,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  if (snapshot.ropeCount === 0) return;

  ctx.save();
  ctx.lineWidth = ROPE_LINE_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let r = 0; r < snapshot.ropeCount; r++) {
    const segCount = snapshot.ropeSegmentCount[r];
    if (segCount < 2) continue;
    const base = r * MAX_ROPE_SEGMENTS;

    ctx.beginPath();
    ctx.strokeStyle = ROPE_STROKE;

    const x0 = snapshot.ropeSegPosXWorld[base] * zoom + offsetXPx;
    const y0 = snapshot.ropeSegPosYWorld[base] * zoom + offsetYPx;
    ctx.moveTo(x0, y0);

    for (let s = 1; s < segCount; s++) {
      const idx = base + s;
      const sx = snapshot.ropeSegPosXWorld[idx] * zoom + offsetXPx;
      const sy = snapshot.ropeSegPosYWorld[idx] * zoom + offsetYPx;
      ctx.lineTo(sx, sy);
    }

    ctx.stroke();

    // Draw small circles at the anchor endpoints
    ctx.fillStyle = ROPE_HIGHLIGHT;
    ctx.beginPath();
    ctx.arc(x0, y0, 1.5, 0, Math.PI * 2);
    ctx.fill();

    const lastIdx = base + segCount - 1;
    const xlast = snapshot.ropeSegPosXWorld[lastIdx] * zoom + offsetXPx;
    const ylast = snapshot.ropeSegPosYWorld[lastIdx] * zoom + offsetYPx;
    ctx.beginPath();
    ctx.arc(xlast, ylast, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
