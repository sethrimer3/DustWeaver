/**
 * folderBlockThemes.ts — Folder-based block theme sprite loading.
 *
 * Theme discovery and catalogue live in folderThemeCatalogue.ts.
 * This module owns sprite loading and the 8×8 nearest-neighbor downscale cache.
 *
 * Sprite conventions:
 *   • Source sprites are 16×16 pixels → used for 2×2 block tiles.
 *   • 8×8 nearest-neighbor downscaled versions are generated lazily and
 *     cached → used for 1×1 block tiles.
 */

import { loadImg } from '../imageCache';
import { hashTilePosition } from './proceduralBlockSprite';
import { applyOrganicEdgeShading, EDGE_SHADING_VERSION, OPEN_AIR_ALL_SIDES } from './blockEdgeShading';
import * as FP from '../../debug/perfFreezeProfiler';
export type { FolderThemeData } from './folderThemeCatalogue';
export { FOLDER_BLOCK_THEMES, isFolderBasedTheme, folderThemeShortId } from './folderThemeCatalogue';
import type { FolderThemeData } from './folderThemeCatalogue';
import { FOLDER_BLOCK_THEMES } from './folderThemeCatalogue';

// ── Sprite loading and 8×8 downscale cache ────────────────────────────────────

/** Pre-allocated 8×8 downscale cache. Keyed by the 16×16 source URL. */
const _cache8x8 = new Map<string, HTMLCanvasElement | null>();
/** URLs for which image loading has been requested but the image isn't ready yet. */
const _pendingUrls = new Set<string>();

/**
 * Generates an 8×8 nearest-neighbor downscaled canvas from a loaded 16×16
 * source image.  Returns null if the image has not finished loading yet.
 */
function _downscaleTo8x8(src: HTMLImageElement): HTMLCanvasElement | null {
  if (!src.complete || src.naturalWidth === 0) return null;
  const c = document.createElement('canvas');
  c.width  = 8;
  c.height = 8;
  const ctx = c.getContext('2d');
  if (ctx === null) return null;
  ctx.imageSmoothingEnabled = false; // nearest-neighbor — preserve pixel-art crispness
  ctx.drawImage(src, 0, 0, 8, 8);
  return c;
}

/**
 * Returns the cached 8×8 downscaled canvas for `url`, generating it if the
 * source image has loaded.
 *
 * On the first call for a URL, this function attaches a one-time `load`
 * listener so subsequent frames avoid repeated `loadImg` + readiness checks.
 * Returns null while the source is still loading (the renderer will draw a
 * fallback tile; once the listener fires the canvas is cached and the next
 * frame will draw the sprite).
 */
function _getOrCreate8x8(url: string): HTMLCanvasElement | null {
  const cached = _cache8x8.get(url);
  if (cached !== undefined) return cached; // null = creation failed; canvas = ready

  if (_pendingUrls.has(url)) return null; // already waiting for this image to load

  const img = loadImg(url);
  if (img.complete && img.naturalWidth > 0) {
    // Image was already loaded (e.g., browser cache hit) — create immediately.
    const canvas = _downscaleTo8x8(img);
    _cache8x8.set(url, canvas);
    return canvas;
  }

  // Image not yet ready: register a one-time listener to create the canvas
  // when it arrives. This avoids re-checking every frame.
  _pendingUrls.add(url);
  img.addEventListener('load', () => {
    _pendingUrls.delete(url);
    const canvas = _downscaleTo8x8(img);
    _cache8x8.set(url, canvas);
  }, { once: true });

  return null;
}

// ── Private theme lookup ──────────────────────────────────────────────────────

function _getEntry(themeId: string): FolderThemeData | null {
  // Linear search is acceptable — there are at most ~20 folder themes.
  for (let i = 0; i < FOLDER_BLOCK_THEMES.length; i++) {
    if (FOLDER_BLOCK_THEMES[i].id === themeId) return FOLDER_BLOCK_THEMES[i];
  }
  return null;
}

// ── Public sprite accessors ───────────────────────────────────────────────────

/**
 * Returns the 16×16 source image for use with 2×2 block tiles.
 *
 * Variation is chosen deterministically from the tile's grid position and the
 * current world seed — the same tile always shows the same variation.
 *
 * Returns null when `themeId` is null, not a folder-based theme, or when the
 * image has not finished loading (the renderer will draw a fallback and retry).
 */
export function getTheme2x2Sprite(
  themeId: string | null,
  col:     number,
  row:     number,
  seed:    number,
): HTMLImageElement | null {
  if (themeId === null) return null;
  const entry = _getEntry(themeId);
  if (entry === null || entry.sprite16Urls.length === 0) return null;

  const hash   = hashTilePosition(col, row, seed);
  const varIdx = hash % entry.sprite16Urls.length;
  const img    = loadImg(entry.sprite16Urls[varIdx]);

  return (img.complete && img.naturalWidth > 0) ? img : null;
}

/**
 * Returns the pre-generated 8×8 nearest-neighbor downscaled canvas for use
 * with 1×1 block tiles.
 *
 * The downscaled canvas is created and cached lazily on the first call after
 * the source image has loaded.  Returns null when `themeId` is null, not a
 * folder-based theme, or while the source image is still loading.
 */
export function getTheme1x1Sprite(
  themeId: string | null,
  col:     number,
  row:     number,
  seed:    number,
): HTMLCanvasElement | null {
  if (themeId === null) return null;
  const entry = _getEntry(themeId);
  if (entry === null || entry.sprite16Urls.length === 0) return null;

  const hash   = hashTilePosition(col, row, seed);
  const varIdx = hash % entry.sprite16Urls.length;
  return _getOrCreate8x8(entry.sprite16Urls[varIdx]);
}

// ── Edge-shaded sprite cache ──────────────────────────────────────────────────

/**
 * Cache of edge-shaded canvases for folder-based sprites.
 *
 * Keyed by a string encoding (source URL, dimensions, openAirSidesMask,
 * variantBucket, seed).  The variant bucket (0–SHADED_VARIANT_BUCKETS-1) is
 * derived from the tile position hash, bounding the cache to at most
 * SHADED_VARIANT_BUCKETS entries per (url, size, mask) combination regardless
 * of room size — previously the key included exact world coordinates, which
 * created one canvas per tile and caused O(room_tiles) getImageData bakes.
 */
const _shadedCache = new Map<string, HTMLCanvasElement>();

/**
 * Cheap unshaded fallback canvases for active-gameplay frames when baking is
 * forbidden.  Keyed by URL only (no shading variants) — one canvas per source
 * URL per size.  Created by a plain drawImage with no getImageData/putImageData
 * and are stable non-null results that prevent chunk hadFallbacksFlag loops.
 */
const _unshadedCache8x8  = new Map<string, HTMLCanvasElement>();
const _unshadedCache16x16 = new Map<string, HTMLCanvasElement>();

/** Returns (or creates) an unshaded 16×16 canvas from a loaded source image. */
function _getOrCreateUnshaded16x16(url: string, src: HTMLImageElement): HTMLCanvasElement {
  const hit = _unshadedCache16x16.get(url);
  if (hit !== undefined) return hit;
  const canvas = document.createElement('canvas');
  canvas.width  = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, 16, 16);
  }
  _unshadedCache16x16.set(url, canvas);
  return canvas;
}

/** Returns (or creates) an unshaded 8×8 canvas from a loaded source canvas. */
function _getOrCreateUnshaded8x8(url: string, src: HTMLCanvasElement): HTMLCanvasElement {
  const hit = _unshadedCache8x8.get(url);
  if (hit !== undefined) return hit;
  const canvas = document.createElement('canvas');
  canvas.width  = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (ctx !== null) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, 8, 8);
  }
  _unshadedCache8x8.set(url, canvas);
  return canvas;
}

/**
 * Number of distinct shading variants per (url, size, openAirMask, seed).
 * Tile positions are hashed into this many buckets so the total canvas count
 * stays bounded.  16 gives good visual variety with ~256 canvases per theme
 * across all air-mask combinations, versus thousands for large rooms before.
 */
const SHADED_VARIANT_BUCKETS = 16;

function _shadedCacheKey(
  url: string,
  widthPx: number,
  heightPx: number,
  openAirSidesMask: number,
  variantBucket: number,
  seed: number,
): string {
  return `${url}|${widthPx}|${heightPx}|${openAirSidesMask}|${variantBucket}|${seed}|v${EDGE_SHADING_VERSION}`;
}

/**
 * Draws `src` into a new canvas of the given size and applies organic edge
 * shading, then caches the result.  Returns the shaded canvas.
 */
function _createShadedCanvas(
  src: HTMLImageElement | HTMLCanvasElement,
  widthPx: number,
  heightPx: number,
  openAirSidesMask: number,
  worldOriginXWorld: number,
  worldOriginYWorld: number,
  seed: number,
  key: string,
): HTMLCanvasElement {
  const _t0 = import.meta.env.DEV ? performance.now() : 0;
  const c = document.createElement('canvas');
  c.width  = widthPx;
  c.height = heightPx;
  const ctx = c.getContext('2d');
  if (ctx === null) return c;
  ctx.imageSmoothingEnabled = false; // preserve pixel-art crispness
  ctx.drawImage(src, 0, 0, widthPx, heightPx);
  applyOrganicEdgeShading(ctx, widthPx, heightPx, openAirSidesMask, worldOriginXWorld, worldOriginYWorld, seed);
  FP.recordSpriteBake(key, import.meta.env.DEV ? performance.now() - _t0 : 0);
  FP.recordFolderShadedBake();
  return c;
}

/**
 * Returns an edge-shaded 8×8 canvas for a folder-based 1×1 block tile.
 *
 * The canvas is generated from the downscaled source, shaded once using
 * `applyOrganicEdgeShading`, and cached permanently so each unique
 * (tile position, neighbour configuration, seed) combination is baked at most once.
 *
 * Returns null while the source image is still loading.
 *
 * @param themeId          Folder-based block theme ID (e.g. `'grayStone'`).
 * @param col              Tile column (0-based).
 * @param row              Tile row (0-based).
 * @param seed             World/room hash seed — same value passed to the BFS noise.
 * @param openAirSidesMask Bitmask of sides exposed to air (OPEN_AIR_SIDE_* constants).
 *                         Sides NOT set are solid-neighbour edges; shading is suppressed
 *                         on those sides to prevent seams between adjacent blocks.
 * @param blockSizePx      Block size in world units (= virtual pixels at zoom 1).
 *                         Used to compute the world-space origin of the sprite for
 *                         seamless noise across tile boundaries.
 */
export function getTheme1x1SpriteShaded(
  themeId:          string | null,
  col:              number,
  row:              number,
  seed:             number,
  openAirSidesMask: number = OPEN_AIR_ALL_SIDES,
  blockSizePx:      number = 8,
): HTMLCanvasElement | null {
  if (themeId === null) return null;
  const entry = _getEntry(themeId);
  if (entry === null || entry.sprite16Urls.length === 0) return null;

  const hash   = hashTilePosition(col, row, seed);
  const varIdx = hash % entry.sprite16Urls.length;
  const url    = entry.sprite16Urls[varIdx];

  const base = _getOrCreate8x8(url);
  if (base === null) return null; // source still loading

  // Use a bounded variant bucket instead of the exact tile world position as
  // the cache key.  This caps shaded canvases at SHADED_VARIANT_BUCKETS per
  // (url, openAirMask, seed) combination, preventing O(room_tiles)
  // getImageData/putImageData bakes during active gameplay.
  // Trade-off: tiles that share the same bucket share the same noise pattern
  // (slight repetition), but smooth gameplay is the priority here.
  const variantBucket = hashTilePosition(col, row, seed) % SHADED_VARIANT_BUCKETS;
  // Representative world origin for this bucket — gives each bucket a unique
  // noise pattern while remaining constant (so the canvas is reused every frame).
  // Y is always 0; only the X axis carries per-bucket variation.
  const bucketWorldX  = variantBucket * blockSizePx;
  const bucketWorldY  = 0;
  const key    = _shadedCacheKey(url, 8, 8, openAirSidesMask, variantBucket, seed);
  const cached = _shadedCache.get(key);
  if (cached !== undefined) return cached;

  // During active gameplay, baking new shaded canvases is forbidden to prevent
  // unexpected getImageData/putImageData stalls.  Return an unshaded fallback
  // canvas instead — this is a stable non-null result so the chunk does NOT
  // set hadFallbacksFlag and will NOT rebuild every frame.
  if (FP.isBakeForbiddenInGameplay() || FP.isBakeBudgetExhausted()) {
    FP.recordUnshadedFallback();
    return _getOrCreateUnshaded8x8(url, base);
  }

  const shaded = _createShadedCanvas(base, 8, 8, openAirSidesMask, bucketWorldX, bucketWorldY, seed, key);
  _shadedCache.set(key, shaded);
  return shaded;
}

/**
 * Returns an edge-shaded 16×16 canvas for a folder-based 2×2 block group.
 *
 * Works identically to {@link getTheme1x1SpriteShaded} but uses the full 16×16
 * source image and is intended for 2×2 block tile groups (top-left coordinates
 * provided as `col`/`row`).
 *
 * Returns null while the source image is still loading.
 *
 * @param themeId          Folder-based block theme ID.
 * @param col              Tile column of the 2×2 group's top-left corner.
 * @param row              Tile row of the 2×2 group's top-left corner.
 * @param seed             World/room hash seed.
 * @param openAirSidesMask Bitmask of sides exposed to air (OPEN_AIR_SIDE_* constants).
 * @param blockSizePx      Block size in world units (= virtual pixels at zoom 1).
 */
export function getTheme2x2SpriteShaded(
  themeId:          string | null,
  col:              number,
  row:              number,
  seed:             number,
  openAirSidesMask: number = OPEN_AIR_ALL_SIDES,
  blockSizePx:      number = 8,
): HTMLCanvasElement | null {
  if (themeId === null) return null;
  const entry = _getEntry(themeId);
  if (entry === null || entry.sprite16Urls.length === 0) return null;

  const hash   = hashTilePosition(col, row, seed);
  const varIdx = hash % entry.sprite16Urls.length;
  const url    = entry.sprite16Urls[varIdx];

  const img = loadImg(url);
  if (!img.complete || img.naturalWidth === 0) return null; // source still loading

  // Bounded variant bucket (same approach as getTheme1x1SpriteShaded).
  // Y is always 0; only the X axis carries per-bucket variation.
  const variantBucket = hashTilePosition(col, row, seed) % SHADED_VARIANT_BUCKETS;
  const bucketWorldX  = variantBucket * blockSizePx;
  const bucketWorldY  = 0;
  const key    = _shadedCacheKey(url, 16, 16, openAirSidesMask, variantBucket, seed);
  const cached = _shadedCache.get(key);
  if (cached !== undefined) return cached;

  // During active gameplay, baking new shaded canvases is forbidden.  Return a
  // cheap unshaded canvas so the chunk renders without hadFallbacksFlag loops.
  if (FP.isBakeForbiddenInGameplay() || FP.isBakeBudgetExhausted()) {
    FP.recordUnshadedFallback();
    return _getOrCreateUnshaded16x16(url, img);
  }

  const shaded = _createShadedCanvas(img, 16, 16, openAirSidesMask, bucketWorldX, bucketWorldY, seed, key);
  _shadedCache.set(key, shaded);
  return shaded;
}


// ── Direct URL accessor for use in cookie-cutter platform rendering ───────────

/**
 * Returns a deterministic base sprite URL for a folder-based block theme tile.
 *
 * Used by the platform sprite generator to apply the platform cookie-cutter
 * template to a folder theme's base texture without going through the probe-pool
 * system.  The URL is picked from the theme's discovered 16×16 sprite list using
 * the same hash as the tile-position hash, ensuring stable per-cell variation.
 *
 * @param themeId  Folder-based block theme ID (e.g. 'grayStone').
 * @param col      Tile column.
 * @param row      Tile row.
 * @param seed     World/room seed passed to {@link hashTilePosition}.
 * @returns        A URL string, or null if the theme is unknown or has no sprites.
 */
export function getFolderThemeBaseUrl(
  themeId: string,
  col:     number,
  row:     number,
  seed:    number,
): string | null {
  const entry = _getEntry(themeId);
  if (entry === null || entry.sprite16Urls.length === 0) return null;
  const hash = hashTilePosition(col, row, seed);
  return entry.sprite16Urls[hash % entry.sprite16Urls.length];
}

// ── Derived-sprite prewarm helpers ────────────────────────────────────────────

/**
 * Proactively warms the shaded-canvas cache for a rectangle of folder-based
 * tiles during a loading or prewarm phase (baking is allowed).
 *
 * Iterates the tile grid from (colMin,rowMin) to (colMax,rowMax) inclusive for
 * the given `themeId` and calls `getTheme1x1SpriteShaded` / `getTheme2x2SpriteShaded`
 * so each variant bucket is baked and stored before the player regains control.
 *
 * Call this from the entry-viewport prewarm path with the loading overlay still
 * visible.  Each call respects `isBakeBudgetExhausted()` and stops early when
 * the per-frame cap is reached — the caller should spread across multiple frames
 * if needed.
 *
 * @param themeId          Folder theme ID (e.g. `'grayStone'`).
 * @param colMin           First tile column (inclusive).
 * @param rowMin           First tile row (inclusive).
 * @param colMax           Last tile column (inclusive).
 * @param rowMax           Last tile row (inclusive).
 * @param seed             World/room seed.
 * @param openAirSidesMask Typical air-mask for these tiles (or OPEN_AIR_ALL_SIDES).
 * @param blockSizePx      Block size in world units (normally 8).
 * @param use2x2           When true, prewarm 16×16 (2×2) shaded sprites; otherwise 8×8 (1×1).
 * @returns                `true` when all requested variants were baked; `false`
 *                         when the per-frame budget ran out early (retry next frame).
 */
export function prewarmFolderThemeShadedForChunk(
  themeId:          string,
  colMin:           number,
  rowMin:           number,
  colMax:           number,
  rowMax:           number,
  seed:             number,
  openAirSidesMask: number,
  blockSizePx:      number,
  use2x2:           boolean,
): boolean {
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      if (FP.isBakeBudgetExhausted()) return false;
      if (use2x2) {
        getTheme2x2SpriteShaded(themeId, col, row, seed, openAirSidesMask, blockSizePx);
      } else {
        getTheme1x1SpriteShaded(themeId, col, row, seed, openAirSidesMask, blockSizePx);
      }
    }
  }
  return true;
}
