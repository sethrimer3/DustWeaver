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
 * `wallLayout.surfaceExposureMap` — the same authoritative tile-level
 * exposure data `src/sim/world/surfaceExposure.ts` builds — so every exposed
 * tile side gets marked, every frame, independent of sprite state.
 *
 * Geometry: three concepts, painted so each pixel is touched at most once
 * ─────────────────────────────────────────────────────────────────────────
 * A tile's overlay is built from three distinct pieces, iterated per-tile
 * (not per-segment) so corner ownership can be resolved once per tile:
 *   1. Straight side bands — one per exposed cardinal side, but TRIMMED at
 *      whichever end(s) abut another exposed cardinal side on the same tile.
 *      Untrimmed bands would double-paint the shared corner pixel with both
 *      the horizontal and vertical band (visibly brighter — bug fixed here).
 *   2. Convex (outer) corner squares — drawn once, exactly at the trimmed-off
 *      region from (1), for each pair of adjacent exposed cardinal sides.
 *      Fully derivable from the tile's own `SurfaceMask` (`masks` map) — no
 *      new exposure data needed.
 *   3. Concave (inner) corner squares — drawn once per diagonally-exposed
 *      corner where BOTH adjacent cardinal sides are blocked (so no cardinal
 *      band exists there at all) but the diagonal neighbour is open air —
 *      the classic auto-tiling inner-corner/staircase-notch pattern. This
 *      needs the new `concaveCornerMasks`/`concaveCorners` data on
 *      `SurfaceExposureMap` (see surfaceExposure.ts) since such a tile can
 *      have zero exposed cardinal sides and would otherwise never appear
 *      anywhere in the map.
 *
 * Since (1)+(2) partition the tile's cardinal-adjacent corner area exactly
 * (never overlapping) and (3) only fires where (1)/(2) do not, every pixel of
 * the overlay is painted by exactly one draw call per tile — no double
 * strength anywhere, matching the intended single-layer edge brightness.
 *
 * Deliberately kept dependency-light (only `surfaceExposure.ts` types and the
 * freeze profiler) so it can be unit-tested without pulling in the browser/Vite
 * -only folder-theme sprite loading machinery that `wallTilePassRenderers.ts`
 * depends on for its sprite-drawing passes.
 */

import {
  type SurfaceExposureMap,
  type SurfaceSide,
  type SurfaceMask,
  type CornerSide,
} from '../../sim/world/surfaceExposure';

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

// ── Geometry helpers ───────────────────────────────────────────────────────────

/** Corner → the pair of cardinal sides that meet there. */
const _CORNER_ADJACENT_SIDES: Record<CornerSide, readonly [SurfaceSide, SurfaceSide]> = {
  nw: ['top', 'left'],
  ne: ['top', 'right'],
  sw: ['bottom', 'left'],
  se: ['bottom', 'right'],
};

/**
 * Draws one straight side band for a tile, trimmed at either end where an
 * adjacent exposed cardinal side (on the SAME tile) would otherwise share —
 * and double-paint — the corner pixel square. The trimmed-off region is
 * instead painted exactly once by `_drawConvexCorner`.
 */
function _drawTrimmedSideBand(
  ctx: CanvasRenderingContext2D,
  tileX: number,
  tileY: number,
  sizeScreen: number,
  bandScreen: number,
  side: SurfaceSide,
  mask: SurfaceMask,
  alpha: number,
): void {
  const strength = (side === 'top' ? _EDGE_OVERLAY_STRENGTH_TOP : _EDGE_OVERLAY_STRENGTH_SIDE) * alpha;
  if (strength <= 0) return;

  // A horizontal band (top/bottom) trims its X extent where left/right are
  // also exposed; a vertical band (left/right) trims its Y extent where
  // top/bottom are also exposed.
  const trimStart = side === 'top' || side === 'bottom' ? mask.left : mask.top;
  const trimEnd   = side === 'top' || side === 'bottom' ? mask.right : mask.bottom;

  const runLength = sizeScreen - (trimStart ? bandScreen : 0) - (trimEnd ? bandScreen : 0);
  if (runLength <= 0) return; // fully consumed by corners (degenerate — tiny tiles only)

  ctx.fillStyle = `rgba(255,255,255,${strength})`;
  switch (side) {
    case 'top':
      ctx.fillRect(tileX + (trimStart ? bandScreen : 0), tileY, runLength, bandScreen);
      break;
    case 'bottom':
      ctx.fillRect(tileX + (trimStart ? bandScreen : 0), tileY + sizeScreen - bandScreen, runLength, bandScreen);
      break;
    case 'left':
      ctx.fillRect(tileX, tileY + (trimStart ? bandScreen : 0), bandScreen, runLength);
      break;
    case 'right':
      ctx.fillRect(tileX + sizeScreen - bandScreen, tileY + (trimStart ? bandScreen : 0), bandScreen, runLength);
      break;
  }
}

/** Screen-space rect (tile-relative) for a bandScreen×bandScreen corner square. */
function _cornerRect(
  tileX: number, tileY: number, sizeScreen: number, bandScreen: number, corner: CornerSide,
): { x: number; y: number } {
  const x = corner === 'nw' || corner === 'sw' ? tileX : tileX + sizeScreen - bandScreen;
  const y = corner === 'nw' || corner === 'ne' ? tileY : tileY + sizeScreen - bandScreen;
  return { x, y };
}

/**
 * Draws a convex (outer) corner square exactly once, at the intended edge
 * brightness (not doubled) — uses whichever of its two adjacent sides is
 * brighter (top's brighter strength wins for nw/ne corners) so it reads as a
 * continuation of the brighter of the two bands it joins, rather than a sum.
 */
function _drawConvexCorner(
  ctx: CanvasRenderingContext2D,
  tileX: number, tileY: number, sizeScreen: number, bandScreen: number,
  corner: CornerSide, alpha: number,
): void {
  const [sideA, sideB] = _CORNER_ADJACENT_SIDES[corner];
  const strengthA = sideA === 'top' ? _EDGE_OVERLAY_STRENGTH_TOP : _EDGE_OVERLAY_STRENGTH_SIDE;
  const strengthB = sideB === 'top' ? _EDGE_OVERLAY_STRENGTH_TOP : _EDGE_OVERLAY_STRENGTH_SIDE;
  const strength = Math.max(strengthA, strengthB) * alpha;
  if (strength <= 0) return;

  const { x, y } = _cornerRect(tileX, tileY, sizeScreen, bandScreen, corner);
  ctx.fillStyle = `rgba(255,255,255,${strength})`;
  ctx.fillRect(x, y, bandScreen, bandScreen);
}

/**
 * Draws a concave (inner) corner square exactly once, at the same geometric
 * position a convex corner would occupy for that corner direction — this is
 * where the tile's own corner pixel touches the diagonally-exposed air
 * pocket, so an accent there reads as the "recessed" counterpart to the
 * convex corner treatment.
 */
function _drawConcaveCorner(
  ctx: CanvasRenderingContext2D,
  tileX: number, tileY: number, sizeScreen: number, bandScreen: number,
  corner: CornerSide, alpha: number,
): void {
  const strength = _EDGE_OVERLAY_STRENGTH_SIDE * alpha;
  if (strength <= 0) return;

  const { x, y } = _cornerRect(tileX, tileY, sizeScreen, bandScreen, corner);
  ctx.fillStyle = `rgba(255,255,255,${strength})`;
  ctx.fillRect(x, y, bandScreen, bandScreen);
}

// ── Diagnostics ────────────────────────────────────────────────────────────────

/**
 * Per-frame counters for the guaranteed overlay pass, read by
 * `window.__dwSurfaceEdgeOverlayStats()` (wallTilePassRenderers.ts) so it's
 * possible to tell apart:
 *   - `tilesConsideredLastFrame === 0` → the bug is upstream, in the
 *     exposure/layout data (surfaceExposure.ts / blockWallLayoutCache.ts).
 *   - draws lower than expected → the bug is in this overlay's own draw
 *     filtering (viewport bounds / darkness cutoff).
 *   - Otherwise, any remaining visual gap is in sprite baking
 *     (applyOrganicEdgeShading / chunk fallback state), not in the guaranteed
 *     overlay, since this pass never reads sprite-bake state at all.
 */
export const surfaceEdgeOverlayDiag = {
  tilesConsideredLastFrame: 0,
  sideBandsDrawnLastFrame: 0,
  convexCornersDrawnLastFrame: 0,
  concaveCornersDrawnLastFrame: 0,
  tilesSkippedDarknessLastFrame: 0,
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

function _inFilterRange(col: number, row: number, params: SurfaceEdgeOverlayParams): boolean {
  return col >= params.filterColMinBlocks && col <= params.filterColMaxBlocks &&
         row >= params.filterRowMinBlocks && row <= params.filterRowMaxBlocks;
}

function _darknessAlphaAtTile(
  col: number, row: number, params: SurfaceEdgeOverlayParams,
): number | null {
  const darkness = params.isBlockTintEnabled ? (params.ambientDepths?.get(`${col},${row}`) ?? 0) : 0;
  if (darkness >= _EDGE_OVERLAY_DARKNESS_CUTOFF) return null;
  return 1 - darkness;
}

/**
 * Draws the guaranteed surface-edge overlay for every exposed tile side and
 * corner within the given chunk/viewport bounds, reading straight from
 * `params.surfaceExposureMap` (see the module doc comment for the three-part
 * side-band / convex-corner / concave-corner geometry this builds).
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
  const { surfaceExposureMap, offsetXPx, offsetYPx, scalePx, blockSizePx } = params;

  const bandPx = Math.max(1, Math.min(3, Math.round(blockSizePx * 0.25)));
  const bandScreen = Math.max(1, Math.round(bandPx * scalePx));
  const sizeScreen = blockSizePx * scalePx;
  const debugMode = _devEdgeOverlayEnabled();

  let tilesConsidered = 0;
  let sideBandsDrawn = 0;
  let convexCornersDrawn = 0;
  let concaveCornersDrawn = 0;
  let skippedDarkness = 0;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // ── Pass A: straight side bands + convex (outer) corners ────────────────────
  // Iterated per-tile (via `masks`, not `segments`) so all of a tile's
  // exposed sides are known together — required to trim bands and own each
  // convex corner exactly once instead of double-painting it.
  for (const [key, mask] of surfaceExposureMap.masks) {
    const commaIdx = key.indexOf(',');
    const col = parseInt(key.slice(0, commaIdx), 10);
    const row = parseInt(key.slice(commaIdx + 1), 10);
    if (!_inFilterRange(col, row, params)) continue;
    tilesConsidered++;

    const alpha = _darknessAlphaAtTile(col, row, params);
    if (alpha === null) { skippedDarkness++; continue; }

    const tileX = Math.round(col * blockSizePx * scalePx + offsetXPx);
    const tileY = Math.round(row * blockSizePx * scalePx + offsetYPx);

    const sides: readonly SurfaceSide[] = ['top', 'right', 'bottom', 'left'];
    for (const side of sides) {
      if (!mask[side]) continue;
      _drawTrimmedSideBand(ctx, tileX, tileY, sizeScreen, bandScreen, side, mask, alpha);
      sideBandsDrawn++;
    }

    const corners: readonly CornerSide[] = ['nw', 'ne', 'sw', 'se'];
    for (const corner of corners) {
      const [sideA, sideB] = _CORNER_ADJACENT_SIDES[corner];
      if (!mask[sideA] || !mask[sideB]) continue; // convex corner requires BOTH adjacent sides exposed
      _drawConvexCorner(ctx, tileX, tileY, sizeScreen, bandScreen, corner, alpha);
      convexCornersDrawn++;
    }
  }

  // ── Pass B: concave (inner) corners ──────────────────────────────────────────
  // Separate source (`concaveCorners`) since a tile can have a concave corner
  // with zero exposed cardinal sides and would never appear in `masks`.
  for (const tile of surfaceExposureMap.concaveCorners) {
    const { col, row, corners } = tile;
    if (!_inFilterRange(col, row, params)) continue;

    const alpha = _darknessAlphaAtTile(col, row, params);
    if (alpha === null) continue; // already counted as skipped in pass A when the tile also has a mask entry

    const tileX = Math.round(col * blockSizePx * scalePx + offsetXPx);
    const tileY = Math.round(row * blockSizePx * scalePx + offsetYPx);

    const cornerSides: readonly CornerSide[] = ['nw', 'ne', 'sw', 'se'];
    for (const corner of cornerSides) {
      if (!corners[corner]) continue;
      _drawConcaveCorner(ctx, tileX, tileY, sizeScreen, bandScreen, corner, alpha);
      concaveCornersDrawn++;
    }
  }

  ctx.restore();

  if (debugMode) {
    for (const seg of surfaceExposureMap.segments) {
      if (!_inFilterRange(seg.col, seg.row, params)) continue;
      const tileX = Math.round(seg.col * blockSizePx * scalePx + offsetXPx);
      const tileY = Math.round(seg.row * blockSizePx * scalePx + offsetYPx);
      _drawDebugSegmentLine(ctx, tileX, tileY, sizeScreen, seg.side);
    }
  }

  if (import.meta.env?.DEV) {
    surfaceEdgeOverlayDiag.tilesConsideredLastFrame = tilesConsidered;
    surfaceEdgeOverlayDiag.sideBandsDrawnLastFrame = sideBandsDrawn;
    surfaceEdgeOverlayDiag.convexCornersDrawnLastFrame = convexCornersDrawn;
    surfaceEdgeOverlayDiag.concaveCornersDrawnLastFrame = concaveCornersDrawn;
    surfaceEdgeOverlayDiag.tilesSkippedDarknessLastFrame = skippedDarkness;
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

