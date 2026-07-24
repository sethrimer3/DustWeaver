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
 * Visual intent: subtle 3-pixel inward falloff
 * ─────────────────────────────────────────────
 * The guaranteed effect is intentionally understated — a soft distinction
 * along exposed edges, not a bright glowing outline. Each exposed edge gets 3
 * one-world-pixel-thick bands falling off inward (see `_BAND_ALPHA_RANGES`):
 * outermost ~20-30% alpha, middle ~10-20%, innermost ~0-10%. Alpha within
 * each band is a stable per-tile/per-side/per-depth pseudo-random value (see
 * `_bandNoise`) so the effect reads as organic texture rather than a flat,
 * uniform tint — but it never flickers, since the value is a deterministic
 * hash of tile position + side + depth, not real randomness.
 *
 * Geometry: three concepts, painted so each pixel is touched at most once
 * ─────────────────────────────────────────────────────────────────────────
 * A tile's overlay is built from three distinct pieces, iterated per-tile
 * (not per-segment) so corner ownership can be resolved once per tile:
 *   1. Straight side bands — 3 depth bands per exposed cardinal side, but
 *      TRIMMED at whichever end(s) abut another exposed cardinal side on the
 *      same tile. Untrimmed bands would double-paint the shared corner
 *      pixels with both the horizontal and vertical band (visibly brighter).
 *   2. Convex (outer) corner rings — drawn once, exactly at the trimmed-off
 *      region from (1), for each pair of adjacent exposed cardinal sides.
 *      Uses the same 3-depth falloff as straight bands, but with true
 *      Chebyshev-style corner depth (`min` of the two axis offsets) so the
 *      corner reads as a continuation of the adjacent bands rather than a
 *      brighter blob. Fully derivable from the tile's own `SurfaceMask`
 *      (`masks` map) — no new exposure data needed.
 *   3. Concave (inner) corner rings — drawn once per diagonally-exposed
 *      corner where BOTH adjacent cardinal sides are blocked (so no cardinal
 *      band exists there at all) but the diagonal neighbour is open air —
 *      the classic auto-tiling inner-corner/staircase-notch pattern. Reuses
 *      the exact same corner-ring geometry/alpha treatment as (2) — same
 *      subtlety, same non-doubling guarantee — triggered by
 *      `concaveCornerMasks`/`concaveCorners` on `SurfaceExposureMap` (see
 *      surfaceExposure.ts) instead of a `SurfaceMask` pair, since such a tile
 *      can have zero exposed cardinal sides and would otherwise never appear
 *      anywhere in `masks`.
 *
 * Since (1)+(2) partition the tile's cardinal-adjacent corner area exactly
 * (never overlapping — each corner-ring cell is painted by exactly one of
 * the 3 depth "rings", never by more than one) and (3) only fires where
 * (1)/(2) do not, every pixel of the overlay is painted by exactly one draw
 * call — no double strength anywhere, matching the intended single-layer
 * edge brightness.
 *
 * Deliberately kept dependency-light (only `surfaceExposure.ts` types) so it
 * can be unit-tested without pulling in the browser/Vite-only folder-theme
 * sprite loading machinery that `wallTilePassRenderers.ts` depends on for its
 * sprite-drawing passes.
 */

import {
  type SurfaceExposureMap,
  type SurfaceSide,
  type SurfaceMask,
  type CornerSide,
} from '../../sim/world/surfaceExposure';
import type { SurfaceRimStyle, SurfaceRimFalloff } from './surfaceRimStyle';

// ── Custom Surface Rim style support ────────────────────────────────────────────
//
// A per-tile style resolver (`SurfaceEdgeOverlayParams.getStyleForTile`) lets a
// placed block opt out of the default guaranteed overlay above and use a
// configured Surface Rim instead ('none' | 'solid' | 'gradient' | 'inverted').
// When the resolver is absent, or returns null/'default' for a tile, behavior
// is byte-for-byte identical to the original hard-coded overlay.

function _hexToRgbTriplet(hex: string): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

/** Normalized-depth [0,1) falloff multiplier for a custom rim band. */
function _falloffMultiplier(falloff: SurfaceRimFalloff, t: number): number {
  switch (falloff) {
    case 'hard': return 1;
    case 'linear': return 1 - t;
    case 'smooth': { const u = 1 - t; return u * u * (3 - 2 * u); }
    case 'exponential': return Math.pow(1 - t, 2);
  }
}

/** Per-depth strength function for a custom (non-default) Surface Rim style. */
function _customStrengthForDepth(style: SurfaceRimStyle, bandCount: number): (depth: number) => number {
  if (style.mode === 'none') return () => 0;
  return (depth: number): number => {
    const t = bandCount <= 1 ? 0 : depth / (bandCount - 1);
    const mul = style.mode === 'solid' ? 1 : _falloffMultiplier(style.falloff, t);
    return style.opacity * mul;
  };
}

// ── 'inverted' mode: interior darkening distance field ─────────────────────────

/**
 * Distance (in tiles) beyond which interior darkening saturates at the full
 * configured `interiorDarkness` — a tuning constant, not a hard room-size
 * limit (see surfaceRimDistanceField.ts for how distances are computed).
 */
const _INTERIOR_DARKNESS_MAX_DISTANCE_TILES = 6;

/**
 * Interior-darkening strength at a given BFS distance (tiles) from the
 * nearest exposed edge, for 'inverted' mode. Reuses `_falloffMultiplier` —
 * which is a "1 at the rim, 0 far away" curve for the *rim* bands — mirrored
 * around `1 - normalizedDistance` so it becomes "0 at the rim (distance 0),
 * interiorDarkness at/beyond the max distance" for the *interior*. 'hard' is
 * special-cased to an explicit step (distance 0 → 0, else full darkness)
 * since `_falloffMultiplier('hard', t)` is a constant 1 regardless of `t` and
 * would otherwise ignore the "distance 0 = no darkening" requirement.
 */
function _interiorDarknessAtDistance(style: SurfaceRimStyle, distanceTiles: number): number {
  if (distanceTiles <= 0) return 0;
  if (style.falloff === 'hard') return style.interiorDarkness;
  const normalized = Math.min(1, distanceTiles / _INTERIOR_DARKNESS_MAX_DISTANCE_TILES);
  return style.interiorDarkness * _falloffMultiplier(style.falloff, 1 - normalized);
}

// ── Tuning constants ──────────────────────────────────────────────────────────

/** Number of one-world-pixel-thick inward falloff bands per exposed edge/corner. */
const _BAND_COUNT = 3;

/**
 * Alpha range [lo, hi] per inward depth (0 = outermost, touching the exposed
 * edge; 2 = innermost, 3 pixels in). Per-pixel-band alpha is chosen
 * pseudo-randomly (but deterministically — see `_bandNoise`) within the
 * matching range, so the effect reads as soft, organic edge distinction
 * rather than a flat, uniform, or bright glowing outline.
 */
const _BAND_ALPHA_RANGES: readonly (readonly [number, number])[] = [
  [0.20, 0.30],
  [0.10, 0.20],
  [0.00, 0.10],
];

/** Ambient darkness alpha at/above which the overlay is fully suppressed so it never glows through darkness. */
const _EDGE_OVERLAY_DARKNESS_CUTOFF = 0.97;

// ── Deterministic per-pixel-band variation ────────────────────────────────────

/**
 * Hashes 4 integers to a float in [0, 1). Same MurmurHash3-style mix used
 * elsewhere in the block-sprite renderer (see `hashTilePosition` in
 * proceduralBlockSprite.ts and `_hashNoiseCorner` in blockEdgeShading.ts) —
 * duplicated locally (rather than imported) to keep this module free of the
 * Vite-only sprite-loading import chain those modules pull in.
 */
function _hash4(a: number, b: number, c: number, d: number): number {
  let h = (a * 73856093) ^ (b * 19349663) ^ (c * 83492791) ^ (d * 2246822519);
  h |= 0;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Stable integer id for a cardinal side or corner direction — used as the hash's "kind" axis. */
const _KIND_ID: Record<SurfaceSide | CornerSide, number> = {
  top: 0, right: 1, bottom: 2, left: 3,
  nw: 4, ne: 5, sw: 6, se: 7,
};

/**
 * Deterministic per-(tile, side-or-corner, depth) alpha within the depth's
 * intended range. Stable frame-to-frame and tile-to-tile (a pure function of
 * tile coordinates + which edge/corner + how many pixels inward) — never
 * flickers, but avoids a flat/uniform look across different tiles or sides.
 */
function _bandAlpha(col: number, row: number, kind: SurfaceSide | CornerSide, depth: number): number {
  const [lo, hi] = _BAND_ALPHA_RANGES[depth];
  const noise = _hash4(col, row, _KIND_ID[kind], depth);
  return lo + noise * (hi - lo);
}

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

interface Rect { x: number; y: number; w: number; h: number }

/**
 * Draws the 3-band inward falloff for one straight side of a tile, trimmed
 * at either end where an adjacent exposed cardinal side (on the SAME tile)
 * would otherwise share — and double-paint — the corner region. The
 * trimmed-off region (sized `_BAND_COUNT * bandUnit` at each trimmed end) is
 * instead painted exactly once by `_drawCornerRings`.
 */
function _drawTrimmedSideBand(
  ctx: CanvasRenderingContext2D,
  tileX: number,
  tileY: number,
  sizeScreen: number,
  bandUnit: number,
  side: SurfaceSide,
  mask: SurfaceMask,
  col: number,
  row: number,
  darknessMul: number,
  bandCount: number = _BAND_COUNT,
  strengthForDepth: ((depth: number) => number) | null = null,
  rgbTriplet: string = '255,255,255',
): void {
  const cornerSpan = bandCount * bandUnit;

  // A horizontal band (top/bottom) trims its X extent where left/right are
  // also exposed; a vertical band (left/right) trims its Y extent where
  // top/bottom are also exposed.
  const trimStart = side === 'top' || side === 'bottom' ? mask.left : mask.top;
  const trimEnd   = side === 'top' || side === 'bottom' ? mask.right : mask.bottom;

  const runLength = sizeScreen - (trimStart ? cornerSpan : 0) - (trimEnd ? cornerSpan : 0);
  if (runLength <= 0) return; // fully consumed by corners (degenerate — tiny tiles only)

  const runStart = trimStart ? cornerSpan : 0;

  for (let depth = 0; depth < bandCount; depth++) {
    const strength = (strengthForDepth ? strengthForDepth(depth) : _bandAlpha(col, row, side, depth)) * darknessMul;
    if (strength <= 0) continue;
    ctx.fillStyle = `rgba(${rgbTriplet},${strength})`;
    switch (side) {
      case 'top':
        ctx.fillRect(tileX + runStart, tileY + depth * bandUnit, runLength, bandUnit);
        break;
      case 'bottom':
        ctx.fillRect(tileX + runStart, tileY + sizeScreen - (depth + 1) * bandUnit, runLength, bandUnit);
        break;
      case 'left':
        ctx.fillRect(tileX + depth * bandUnit, tileY + runStart, bandUnit, runLength);
        break;
      case 'right':
        ctx.fillRect(tileX + sizeScreen - (depth + 1) * bandUnit, tileY + runStart, bandUnit, runLength);
        break;
    }
  }
}

/**
 * Draws the 3-ring inward falloff for one corner of a tile (convex or
 * concave — same geometry either way, only the triggering condition
 * differs). Uses true Chebyshev-style corner depth: a cell at local offset
 * (u, v) from the corner (0-indexed, both in `[0, _BAND_COUNT)`) gets
 * `depth = min(u, v)`, so the ring nearest the actual corner pixel is the
 * *shallowest* depth (brightest) and rings widen outward from there — the
 * corner is a continuation of the adjacent bands' falloff, never brighter
 * than they are, and each of the `_BAND_COUNT` rings is painted by exactly
 * one pair of non-overlapping rects (an L-shaped strip), so there is no
 * double-painting between rings either.
 */
function _drawCornerRings(
  ctx: CanvasRenderingContext2D,
  tileX: number, tileY: number, sizeScreen: number, bandUnit: number,
  corner: CornerSide, col: number, row: number, darknessMul: number,
  bandCount: number = _BAND_COUNT,
  strengthForDepth: ((depth: number) => number) | null = null,
  rgbTriplet: string = '255,255,255',
): void {
  const leftAnchor = corner === 'nw' || corner === 'sw';
  const topAnchor  = corner === 'nw' || corner === 'ne';
  const originX = leftAnchor ? tileX : tileX + sizeScreen;
  const originY = topAnchor  ? tileY : tileY + sizeScreen;
  const dirX = leftAnchor ? 1 : -1;
  const dirY = topAnchor  ? 1 : -1;

  // Converts a [uStart, uStart+uLen) run (in bandUnit steps, measured inward
  // from the corner along the horizontal axis) to a screen-space x/w pair,
  // accounting for which way "inward" points for this corner.
  const uToScreenX = (uStart: number, uLen: number): { x: number; w: number } =>
    dirX === 1
      ? { x: originX + uStart * bandUnit, w: uLen * bandUnit }
      : { x: originX - (uStart + uLen) * bandUnit, w: uLen * bandUnit };
  const vToScreenY = (vStart: number, vLen: number): { y: number; h: number } =>
    dirY === 1
      ? { y: originY + vStart * bandUnit, h: vLen * bandUnit }
      : { y: originY - (vStart + vLen) * bandUnit, h: vLen * bandUnit };

  for (let depth = 0; depth < bandCount; depth++) {
    const strength = (strengthForDepth ? strengthForDepth(depth) : _bandAlpha(col, row, corner, depth)) * darknessMul;
    if (strength <= 0) continue;
    ctx.fillStyle = `rgba(${rgbTriplet},${strength})`;

    const rects: Rect[] = [];
    // Ring `depth` = { (u,v) : min(u,v) === depth, u,v in [0, bandCount) }.
    // Part 1: row v = depth, u in [depth, bandCount).
    {
      const uLen = bandCount - depth;
      const { x, w } = uToScreenX(depth, uLen);
      const { y, h } = vToScreenY(depth, 1);
      rects.push({ x, y, w, h });
    }
    // Part 2: column u = depth, v in [depth+1, bandCount) — excludes the
    // (depth, depth) cell already covered by part 1, so the two never overlap.
    if (depth < bandCount - 1) {
      const vLen = bandCount - depth - 1;
      const { x, w } = uToScreenX(depth, 1);
      const { y, h } = vToScreenY(depth + 1, vLen);
      rects.push({ x, y, w, h });
    }

    for (const r of rects) ctx.fillRect(r.x, r.y, r.w, r.h);
  }
}

// ── Diagnostics ────────────────────────────────────────────────────────────────

/**
 * Per-frame counters for the guaranteed overlay pass, read by
 * `window.__dwSurfaceEdgeOverlayStats()` so it's possible to tell apart:
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
  sideBandRectsDrawnLastFrame: 0,
  convexCornerRectsDrawnLastFrame: 0,
  concaveCornerRectsDrawnLastFrame: 0,
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
  /**
   * Optional per-tile Surface Rim style lookup. Returning null/undefined or a
   * 'default'-mode style preserves the original hard-coded overlay exactly
   * for that tile. Returning 'none' suppresses the overlay for that tile.
   * Returning 'solid'/'gradient'/'inverted' draws the configured rim in the
   * block's color/width/opacity/falloff instead.
   */
  getStyleForTile?: (col: number, row: number) => SurfaceRimStyle | null | undefined;
  /**
   * Interior tiles (solid, but with zero exposed cardinal sides — i.e. not
   * present in `surfaceExposureMap.masks`) that should be checked for
   * 'inverted'-mode darkening, together with their cached BFS distance (in
   * tiles) to the nearest exposed edge. Both are already fully precomputed
   * (see blockWallLayoutCache.ts / surfaceRimDistanceField.ts) — this pass
   * only does O(1) map lookups per tile, no per-frame BFS or pixel scan.
   * Tiles at distance 0 are handled by Pass A above and must not appear here.
   */
  interiorTileCoords?: readonly { col: number; row: number }[];
  getInteriorDistanceForTile?: (col: number, row: number) => number | undefined;
}

/** Width (in world pixels, same units as `SurfaceRimStyle.widthPx`) of one band-unit at the current scale. */
function _bandUnitFor(scalePx: number, sizeScreen: number, bandCount: number): number {
  return Math.max(1, Math.min(Math.round(scalePx), Math.floor(sizeScreen / bandCount)));
}

function _inFilterRange(col: number, row: number, params: SurfaceEdgeOverlayParams): boolean {
  return col >= params.filterColMinBlocks && col <= params.filterColMaxBlocks &&
         row >= params.filterRowMinBlocks && row <= params.filterRowMaxBlocks;
}

function _darknessMulAtTile(
  col: number, row: number, params: SurfaceEdgeOverlayParams,
): number | null {
  const darkness = params.isBlockTintEnabled ? (params.ambientDepths?.get(`${col},${row}`) ?? 0) : 0;
  if (darkness >= _EDGE_OVERLAY_DARKNESS_CUTOFF) return null;
  return 1 - darkness;
}

/**
 * Draws the guaranteed surface-edge overlay for every exposed tile side and
 * corner within the given chunk/viewport bounds, reading straight from
 * `params.surfaceExposureMap` (see the module doc comment for the subtle
 * 3-pixel falloff and the side-band / convex-corner / concave-corner
 * geometry this builds).
 *
 * Always runs — this is the actual guaranteed visual, not a debug-only
 * diagnostic. Call this after all base wall sprites (and any per-tile
 * darkness fill) have been drawn, so the highlight sits on top but is still
 * attenuated by `params.ambientDepths` so it never glows through darkness.
 *
 * When `window.__dwEdgeOverlay` is enabled, this also draws the existing
 * colour-coded per-side diagnostic line for troubleshooting, sourced from the
 * same segments (so it now also covers 2×2-covered tiles, unlike the old
 * 1×1-pass-only diagnostic it replaces). This debug line is unrelated to (and
 * unaffected by) the subtle-intensity tuning above.
 */
export function renderSurfaceEdgeOverlayPass(
  ctx: CanvasRenderingContext2D,
  params: SurfaceEdgeOverlayParams,
): void {
  const { surfaceExposureMap, offsetXPx, offsetYPx, scalePx, blockSizePx } = params;

  const sizeScreen = blockSizePx * scalePx;
  // One world-pixel per inward band, scaled to screen space; clamped so
  // 3 bands never exceed the tile itself (relevant only for pathologically
  // small block sizes/zoom levels).
  const bandUnit = Math.max(1, Math.min(
    Math.round(scalePx),
    Math.floor(sizeScreen / _BAND_COUNT),
  ));
  const debugMode = _devEdgeOverlayEnabled();

  let tilesConsidered = 0;
  let sideBandRectsDrawn = 0;
  let convexCornerRectsDrawn = 0;
  let concaveCornerRectsDrawn = 0;
  let skippedDarkness = 0;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';

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

    const darknessMul = _darknessMulAtTile(col, row, params);
    if (darknessMul === null) { skippedDarkness++; continue; }

    const tileX = Math.round(col * blockSizePx * scalePx + offsetXPx);
    const tileY = Math.round(row * blockSizePx * scalePx + offsetYPx);

    const customStyle = params.getStyleForTile?.(col, row);
    const isCustom = !!customStyle && customStyle.mode !== 'default';
    if (isCustom && customStyle!.mode === 'none') continue; // 'none': suppress overlay entirely for this tile

    const tileBandCount = isCustom ? customStyle!.widthPx : _BAND_COUNT;
    const tileBandUnit = isCustom ? _bandUnitFor(scalePx, sizeScreen, tileBandCount) : bandUnit;
    const strengthFn = isCustom ? _customStrengthForDepth(customStyle!, tileBandCount) : null;
    const rgbTriplet = isCustom ? _hexToRgbTriplet(customStyle!.color) : '255,255,255';

    const sides: readonly SurfaceSide[] = ['top', 'right', 'bottom', 'left'];
    for (const side of sides) {
      if (!mask[side]) continue;
      _drawTrimmedSideBand(ctx, tileX, tileY, sizeScreen, tileBandUnit, side, mask, col, row, darknessMul,
        tileBandCount, strengthFn, rgbTriplet);
      sideBandRectsDrawn += tileBandCount;
    }

    const corners: readonly CornerSide[] = ['nw', 'ne', 'sw', 'se'];
    for (const corner of corners) {
      const [sideA, sideB] = _CORNER_ADJACENT_SIDES[corner];
      if (!mask[sideA] || !mask[sideB]) continue; // convex corner requires BOTH adjacent sides exposed
      _drawCornerRings(ctx, tileX, tileY, sizeScreen, tileBandUnit, corner, col, row, darknessMul,
        tileBandCount, strengthFn, rgbTriplet);
      convexCornerRectsDrawn += tileBandCount * 2 - 1;
    }
    // 'inverted' interior darkening for THIS tile is 0 — it's at BFS distance
    // 0 (it's in `masks`, i.e. directly exposed), and distance 0 always means
    // no extra darkening (the rim bands above already mark it). Deeper
    // interior tiles are darkened by Pass C below.
  }

  // ── Pass B: concave (inner) corners ──────────────────────────────────────────
  // Separate source (`concaveCorners`) since a tile can have a concave corner
  // with zero exposed cardinal sides and would never appear in `masks`.
  for (const tile of surfaceExposureMap.concaveCorners) {
    const { col, row, corners } = tile;
    if (!_inFilterRange(col, row, params)) continue;

    const darknessMul = _darknessMulAtTile(col, row, params);
    if (darknessMul === null) continue; // already counted as skipped in pass A when the tile also has a mask entry

    const customStyle = params.getStyleForTile?.(col, row);
    const isCustom = !!customStyle && customStyle.mode !== 'default';
    if (isCustom && customStyle!.mode === 'none') continue;

    const tileBandCount = isCustom ? customStyle!.widthPx : _BAND_COUNT;
    const tileBandUnit = isCustom ? _bandUnitFor(scalePx, sizeScreen, tileBandCount) : bandUnit;
    const strengthFn = isCustom ? _customStrengthForDepth(customStyle!, tileBandCount) : null;
    const rgbTriplet = isCustom ? _hexToRgbTriplet(customStyle!.color) : '255,255,255';

    const tileX = Math.round(col * blockSizePx * scalePx + offsetXPx);
    const tileY = Math.round(row * blockSizePx * scalePx + offsetYPx);

    const cornerSides: readonly CornerSide[] = ['nw', 'ne', 'sw', 'se'];
    for (const corner of cornerSides) {
      if (!corners[corner]) continue;
      _drawCornerRings(ctx, tileX, tileY, sizeScreen, tileBandUnit, corner, col, row, darknessMul,
        tileBandCount, strengthFn, rgbTriplet);
      concaveCornerRectsDrawn += tileBandCount * 2 - 1;
    }
  }

  // ── Pass C: 'inverted'-mode interior darkening for deeper tiles ─────────────
  // Tiles with zero exposed cardinal sides never appear in `masks` (Pass A),
  // so this is the only pass that can darken them. One O(1) map-lookup rect
  // per candidate tile — no BFS or pixel work happens here, it was all done
  // once at layout-cache build time (see surfaceRimDistanceField.ts).
  if (params.interiorTileCoords && params.getInteriorDistanceForTile && params.getStyleForTile) {
    for (const { col, row } of params.interiorTileCoords) {
      if (!_inFilterRange(col, row, params)) continue;
      const style = params.getStyleForTile(col, row);
      if (!style || style.mode !== 'inverted' || style.interiorDarkness <= 0) continue;

      const darknessMul = _darknessMulAtTile(col, row, params);
      if (darknessMul === null) continue;

      const distance = params.getInteriorDistanceForTile(col, row) ?? _INTERIOR_DARKNESS_MAX_DISTANCE_TILES;
      const strength = _interiorDarknessAtDistance(style, distance) * darknessMul;
      if (strength <= 0) continue;

      const tileX = Math.round(col * blockSizePx * scalePx + offsetXPx);
      const tileY = Math.round(row * blockSizePx * scalePx + offsetYPx);
      ctx.fillStyle = `rgba(0,0,0,${strength})`;
      ctx.fillRect(tileX, tileY, sizeScreen, sizeScreen);
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
    surfaceEdgeOverlayDiag.sideBandRectsDrawnLastFrame = sideBandRectsDrawn;
    surfaceEdgeOverlayDiag.convexCornerRectsDrawnLastFrame = convexCornerRectsDrawn;
    surfaceEdgeOverlayDiag.concaveCornerRectsDrawnLastFrame = concaveCornerRectsDrawn;
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
