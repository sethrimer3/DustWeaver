/**
 * iceFrostRenderer.ts — draws the cosmetic Ice-arrow frost decals accumulated
 * in `sim/iceFrost.ts`, riding directly on their `SurfaceSegment`s so the
 * decal always sits on the correct exposed tile surface and follows that
 * surface's orientation.
 *
 * Rendering is pure pixel-rect fills (no canvas path anti-aliasing, no
 * texture filtering) — the same "1 world pixel per band" approach as
 * `surfaceEdgeOverlay.ts` — so frost reads as crisp pixel-art coverage with
 * no subpixel blur or shimmer. Depth (how far the frost extends outward from
 * the surface) is deterministically hashed per along-surface pixel so it
 * looks organically uneven without flickering frame-to-frame, and tapers
 * toward the two ends of the covered interval.
 */

import type { SurfaceSegment } from '../../sim/world/surfaceExposure';
import { getIceFrostSegmentStates, FROST_MAX_DEPTH_PX } from '../../sim/iceFrost';

/** Deterministic per-pixel hash, mirroring the mixing used in surfaceEdgeOverlay.ts. */
function _hash3(a: number, b: number, c: number): number {
  let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791);
  h |= 0;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const FROST_FILL = 'rgba(214,238,250,0.55)';
const FROST_EDGE_FILL = 'rgba(255,255,255,0.35)';

/** Taper multiplier at normalized distance `t` (0 = interval end, 1 = interval middle-or-beyond). */
function _taper(distFromNearEndPx: number, coveredLenPx: number): number {
  const taperSpanPx = Math.min(3, coveredLenPx * 0.5);
  if (taperSpanPx <= 0) return 1;
  return Math.max(0.15, Math.min(1, distFromNearEndPx / taperSpanPx));
}

function _segAngle(seg: SurfaceSegment): { dirX: number; dirY: number } {
  const len = Math.hypot(seg.x1 - seg.x0, seg.y1 - seg.y0) || 1;
  return { dirX: (seg.x1 - seg.x0) / len, dirY: (seg.y1 - seg.y0) / len };
}

/**
 * Draws all currently-active frost decals. Call after wall sprites so the
 * frost sits visibly on top of terrain, using the same offset/scale
 * convention as the rest of the wall render passes.
 */
export function renderIceFrostDecals(
  ctx: CanvasRenderingContext2D,
  offsetXPx: number,
  offsetYPx: number,
  scalePx: number,
): void {
  ctx.save();
  for (const state of getIceFrostSegmentStates()) {
    const start = state.animStart;
    const end = state.animEnd;
    const coveredLen = end - start;
    if (coveredLen <= 0.01) continue;

    const seg = state.segment;
    const { dirX, dirY } = _segAngle(seg);

    const pxStart = Math.floor(start);
    const pxEnd = Math.ceil(end);
    for (let p = pxStart; p < pxEnd; p++) {
      const alongLo = Math.max(start, p);
      const alongHi = Math.min(end, p + 1);
      if (alongHi <= alongLo) continue;

      const distFromStart = alongLo - start;
      const distFromEnd = end - alongHi;
      const taper = _taper(Math.min(distFromStart, distFromEnd), coveredLen);

      const noise = _hash3(seg.col * 4 + seg.row * 131 + p, seg.side.charCodeAt(0), 17);
      const depthPx = Math.max(1, Math.round(FROST_MAX_DEPTH_PX * taper * (0.6 + noise * 0.4)));

      const baseX = seg.x0 + dirX * p;
      const baseY = seg.y0 + dirY * p;

      for (let d = 0; d < depthPx; d++) {
        const wx = baseX + seg.normalX * d; // grows outward, away from the solid tile
        const wy = baseY + seg.normalY * d;
        const px = Math.round(wx * scalePx + offsetXPx);
        const py = Math.round(wy * scalePx + offsetYPx);
        const w = Math.max(1, Math.round(scalePx));
        const h = Math.max(1, Math.round(scalePx));
        ctx.fillStyle = d === 0 ? FROST_EDGE_FILL : FROST_FILL;
        ctx.fillRect(px, py, w, h);
      }
    }
  }
  ctx.restore();
}
