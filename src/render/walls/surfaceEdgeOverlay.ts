/**
 * surfaceEdgeOverlay.ts — Guaranteed exposed-edge visual, drawn directly from
 * the authoritative `SurfaceExposureMap` rather than from sprite-baked shading.
 *
 * Why this module exists
 * ───────────────────────
 * `applyOrganicEdgeShading` (blockEdgeShading.ts) bakes its rim-highlight
 * directly into cached sprite canvases. That makes the visible edge effect
 * depend on: whether a shaded variant happened to be baked yet (vs. an
 * unshaded gameplay/budget fallback), 2×2 grouping (render1x1Pass skips cells
 * covered by a 2×2 sprite), and which sprite-cache bucket a tile happened to
 * land in — none of which have anything to do with whether the tile side is
 * actually exposed to open air. The result was a highlight that looked
 * "random" on some exposed edges and missing on others.
 *
 * This module draws the highlight as a separate overlay pass straight from
 * `wallLayout.surfaceExposureMap.segments` — the same authoritative tile-level
 * exposure data `src/sim/world/surfaceExposure.ts` builds — so every exposed
 * tile side gets marked, every frame, independent of sprite state.
 *
 * Deliberately kept dependency-light (only `surfaceExposure.ts` types and the
 * freeze profiler) so it can be unit-tested without pulling in the browser/Vite
 * -only folder-theme sprite loading machinery that `wallTilePassRenderers.ts`
 * depends on for its sprite-drawing passes.
 */

import type { SurfaceExposureMap, SurfaceSide } from '../../sim/world/surfaceExposure';

// ── Tuning constants ──────────────────────────────────────────────────────────

/**
 * Additive rim-light strength (0-1) for the top face vs the other three faces —
 * mirrors the asymmetry in `applyOrganicEdgeShading`'s `_EDGE_HIGHLIGHT_ADD_TOP`
 * vs `_EDGE_HIGHLIGHT_ADD`. Intentionally strong/"exaggerated" for now (see the
 * task note in blockEdgeShading.ts) so the guaranteed effect is unmistakable
 * while the underlying rendering question is being resolved.
 */
const _EDGE_OVERLAY_STRENGTH_TOP = 0.55;
const _EDGE_OVERLAY_STRENGTH_SIDE = 0.38;

/** Ambient darkness alpha at/above which the overlay is fully suppressed so it never glows through darkness. */
const _EDGE_OVERLAY_DARKNESS_CUTOFF = 0.97;

// ── DEV-only diagnostic overlay (colour-coded, from the same segment source) ──
//
// Toggle via the browser console: `window.__dwEdgeOverlay = true`. Unlike the
// legacy per-1×1-tile-only diagnostic this replaces, this draws from
// `surfaceExposureMap.segments` directly, so it also covers 2×2-covered tiles.
declare global {
  interface Window {
    __dwEdgeOverlay?: boolean;
  }
}

function _devEdgeOverlayEnabled(): boolean {
  return typeof window !== 'undefined' && window.__dwEdgeOverlay === true;
}

const _DEBUG_COLOR_FOR_SIDE: Record<SurfaceSide, string> = {
  top: '#ff0000',
  right: '#00ff00',
  bottom: '#00ffff',
  left: '#ff00ff',
};

function _drawDebugSegmentLine(
  ctx: CanvasRenderingContext2D,
  tileX: number,
  tileY: number,
  sizeScreen: number,
  side: SurfaceSide,
): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = _DEBUG_COLOR_FOR_SIDE[side];
  ctx.beginPath();
  switch (side) {
    case 'top':
      ctx.moveTo(tileX, tileY + 0.5);
      ctx.lineTo(tileX + sizeScreen, tileY + 0.5);
      break;
    case 'right':
      ctx.moveTo(tileX + sizeScreen - 0.5, tileY);
      ctx.lineTo(tileX + sizeScreen - 0.5, tileY + sizeScreen);
      break;
    case 'bottom':
      ctx.moveTo(tileX, tileY + sizeScreen - 0.5);
      ctx.lineTo(tileX + sizeScreen, tileY + sizeScreen - 0.5);
      break;
    case 'left':
      ctx.moveTo(tileX + 0.5, tileY);
      ctx.lineTo(tileX + 0.5, tileY + sizeScreen);
      break;
  }
  ctx.stroke();
  ctx.restore();
}

// ── Guaranteed pixel-crisp edge band ──────────────────────────────────────────

function _drawSurfaceEdgeBand(
  ctx: CanvasRenderingContext2D,
  tileX: number,
  tileY: number,
  sizeScreen: number,
  bandScreen: number,
  side: SurfaceSide,
  alpha: number,
): void {
  const strength = (side === 'top' ? _EDGE_OVERLAY_STRENGTH_TOP : _EDGE_OVERLAY_STRENGTH_SIDE) * alpha;
  if (strength <= 0) return;
  ctx.fillStyle = `rgba(255,255,255,${strength})`;
  switch (side) {
    case 'top':
      ctx.fillRect(tileX, tileY, sizeScreen, bandScreen);
      break;
    case 'right':
      ctx.fillRect(tileX + sizeScreen - bandScreen, tileY, bandScreen, sizeScreen);
      break;
    case 'bottom':
      ctx.fillRect(tileX, tileY + sizeScreen - bandScreen, sizeScreen, bandScreen);
      break;
    case 'left':
      ctx.fillRect(tileX, tileY, bandScreen, sizeScreen);
      break;
  }
}

// ── Diagnostics ────────────────────────────────────────────────────────────────

/**
 * Per-frame counters for the guaranteed overlay pass, read by
 * `window.__dwSurfaceEdgeOverlayStats()` (wallTilePassRenderers.ts) so it's
 * possible to tell apart:
 *   - `segmentsConsideredLastFrame === 0` → the bug is upstream, in the
 *     exposure/layout data (surfaceExposure.ts / blockWallLayoutCache.ts).
 *   - `segmentsDrawnLastFrame < segmentsConsideredLastFrame - segmentsSkippedDarknessLastFrame`
 *     → the bug is in this overlay's own draw filtering.
 *   - Otherwise, any remaining visual gap is in sprite baking
 *     (applyOrganicEdgeShading / chunk fallback state), not in the guaranteed
 *     overlay, since this pass never reads sprite-bake state at all.
 */
export const surfaceEdgeOverlayDiag = {
  segmentsConsideredLastFrame: 0,
  segmentsDrawnLastFrame: 0,
  segmentsSkippedDarknessLastFrame: 0,
};

// ── Public entry point ────────────────────────────────────────────────────────

export interface SurfaceEdgeOverlayParams {
  surfaceExposureMap: SurfaceExposureMap;
  ambientDepths: ReadonlyMap<string, number> | null;
  isBlockTintEnabled: boolean;
  offsetXPx: number;
  offsetYPx: number;
  scalePx: number;
  blockSizePx: number;
  filterColMinBlocks: number;
  filterColMaxBlocks: number;
  filterRowMinBlocks: number;
  filterRowMaxBlocks: number;
}

/**
 * Draws the guaranteed surface-edge overlay for every exposed tile side in
 * `params.surfaceExposureMap.segments` that falls within the given
 * chunk/viewport bounds.
 *
 * Always runs — this is the actual guaranteed visual, not a debug-only
 * diagnostic. Call this after all base wall sprites (and any per-tile
 * darkness fill) have been drawn, so the highlight sits on top but is still
 * attenuated by `params.ambientDepths` so it never glows through darkness.
 *
 * When `window.__dwEdgeOverlay` is enabled, this also draws the existing
 * colour-coded per-side diagnostic line for troubleshooting, sourced from the
 * same segments (so it now also covers 2×2-covered tiles, unlike the old
 * 1×1-pass-only diagnostic it replaces).
 */
export function renderSurfaceEdgeOverlayPass(
  ctx: CanvasRenderingContext2D,
  params: SurfaceEdgeOverlayParams,
): void {
  const { surfaceExposureMap, ambientDepths, isBlockTintEnabled, offsetXPx, offsetYPx, scalePx, blockSizePx,
          filterColMinBlocks, filterColMaxBlocks, filterRowMinBlocks, filterRowMaxBlocks } = params;

  const bandPx = Math.max(1, Math.min(3, Math.round(blockSizePx * 0.25)));
  const bandScreen = Math.max(1, Math.round(bandPx * scalePx));
  const sizeScreen = blockSizePx * scalePx;
  const debugMode = _devEdgeOverlayEnabled();

  let considered = 0;
  let drawn = 0;
  let skippedDarkness = 0;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  for (const seg of surfaceExposureMap.segments) {
    if (seg.col < filterColMinBlocks || seg.col > filterColMaxBlocks) continue;
    if (seg.row < filterRowMinBlocks || seg.row > filterRowMaxBlocks) continue;
    considered++;

    const tileKey = `${seg.col},${seg.row}`;
    const darkness = isBlockTintEnabled ? (ambientDepths?.get(tileKey) ?? 0) : 0;
    if (darkness >= _EDGE_OVERLAY_DARKNESS_CUTOFF) {
      skippedDarkness++;
      continue;
    }
    const alpha = 1 - darkness;

    const tileX = Math.round(seg.col * blockSizePx * scalePx + offsetXPx);
    const tileY = Math.round(seg.row * blockSizePx * scalePx + offsetYPx);

    _drawSurfaceEdgeBand(ctx, tileX, tileY, sizeScreen, bandScreen, seg.side, alpha);
    drawn++;
  }

  ctx.restore();

  if (debugMode) {
    for (const seg of surfaceExposureMap.segments) {
      if (seg.col < filterColMinBlocks || seg.col > filterColMaxBlocks) continue;
      if (seg.row < filterRowMinBlocks || seg.row > filterRowMaxBlocks) continue;
      const tileX = Math.round(seg.col * blockSizePx * scalePx + offsetXPx);
      const tileY = Math.round(seg.row * blockSizePx * scalePx + offsetYPx);
      _drawDebugSegmentLine(ctx, tileX, tileY, sizeScreen, seg.side);
    }
  }

  if (import.meta.env?.DEV) {
    surfaceEdgeOverlayDiag.segmentsConsideredLastFrame = considered;
    surfaceEdgeOverlayDiag.segmentsDrawnLastFrame = drawn;
    surfaceEdgeOverlayDiag.segmentsSkippedDarknessLastFrame = skippedDarkness;
  }
}

declare global {
  interface Window {
    /**
     * Dumps the guaranteed surface-edge overlay's per-frame counters.
     * See `surfaceEdgeOverlayDiag` doc comment for how to read the numbers.
     */
    __dwSurfaceEdgeOverlayStats?: () => typeof surfaceEdgeOverlayDiag;
  }
}

if (import.meta.env?.DEV && typeof window !== 'undefined') {
  window.__dwSurfaceEdgeOverlayStats = () => {
    console.table([surfaceEdgeOverlayDiag]);
    return surfaceEdgeOverlayDiag;
  };
}
