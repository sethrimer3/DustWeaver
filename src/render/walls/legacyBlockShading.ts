/**
 * legacyBlockShading.ts — Edge-shaded sprite cache for the legacy / world-number
 * wall tile sprites (blackRock world-0..9 atlases and the brownRock/dirt legacy
 * sprite fallbacks in blockSpriteSets.ts).
 *
 * `render1x1Pass` in wallTilePassRenderers.ts previously drew these sprites
 * directly with `ctx.drawImage`, completely bypassing `applyOrganicEdgeShading`.
 * That is the actual default/legacy gameplay path (roomTheme === null), so the
 * "3 open-air edge pixels" treatment was invisible in normal play even though
 * the shading algorithm itself worked and the folder-based theme path used it
 * correctly.
 *
 * This module mirrors the caching approach in folderBlockThemes.ts:
 *   • Draw the selected sprite into an offscreen canvas.
 *   • Apply `applyOrganicEdgeShading`.
 *   • Cache the result, bounded by a variant-bucket hash so cache size does
 *     not grow with room size.
 *   • Respect the shared per-frame bake budget / gameplay-bake-forbidden flag,
 *     falling back to a cheap unshaded canvas (stable, non-null) so chunks do
 *     not thrash-rebuild every frame while gameplay baking is disallowed.
 *   • Include `EDGE_SHADING_VERSION` in the cache key so tuning changes don't
 *     leave stale shaded canvases on screen.
 */

import { applyOrganicEdgeShading, EDGE_SHADING_VERSION, OPEN_AIR_ALL_SIDES } from './blockEdgeShading';
import { hashTilePosition } from './proceduralBlockSprite';
import * as FP from '../../debug/perfFreezeProfiler';

/** Bounded noise-variant buckets per (image, size, mask, seed) — see folderBlockThemes.ts. */
const SHADED_VARIANT_BUCKETS = 16;

const _shadedCache = new Map<string, HTMLCanvasElement>();
const _unshadedCache = new Map<string, HTMLCanvasElement>();

/** Per-frame diagnostic counters — read by the DEV overlay / console helpers. */
export const legacyShadingStats = {
  shadedBakesThisFrame: 0,
  unshadedFallbacksThisFrame: 0,
  totalShadedBakes: 0,
  totalUnshadedFallbacks: 0,
};

export function resetLegacyShadingFrameStats(): void {
  legacyShadingStats.shadedBakesThisFrame = 0;
  legacyShadingStats.unshadedFallbacksThisFrame = 0;
}

function _identityKey(img: HTMLImageElement): string {
  // img.src is stable per loaded sprite and unique per world/variant atlas.
  return img.src;
}

function _cacheKey(
  imgKey: string,
  widthPx: number,
  heightPx: number,
  openAirSidesMask: number,
  variantBucket: number,
  seed: number,
): string {
  return `${imgKey}|${widthPx}|${heightPx}|${openAirSidesMask}|${variantBucket}|${seed}|v${EDGE_SHADING_VERSION}`;
}

function _drawUnshaded(img: HTMLImageElement, widthPx: number, heightPx: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = widthPx;
  c.height = heightPx;
  const ctx = c.getContext('2d');
  if (ctx !== null) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, widthPx, heightPx);
  }
  return c;
}

/** Returns the cached base sprite with no legacy organic edge treatment. */
export function getLegacyUnshadedSprite(
  img: HTMLImageElement,
  widthPx: number,
  heightPx: number,
): HTMLCanvasElement {
  const key = `${_identityKey(img)}|${widthPx}|${heightPx}`;
  let unshaded = _unshadedCache.get(key);
  if (unshaded === undefined) {
    unshaded = _drawUnshaded(img, widthPx, heightPx);
    _unshadedCache.set(key, unshaded);
  }
  return unshaded;
}

/**
 * Returns an edge-shaded canvas for a legacy/world-number block sprite.
 *
 * @param img              The loaded, ready (isSpriteReady) source sprite image.
 * @param widthPx           Output canvas width (normally the tile's screen-independent size, e.g. blockSizePx).
 * @param heightPx          Output canvas height.
 * @param openAirSidesMask  OPEN_AIR_SIDE_* bitmask for this tile's exposed sides.
 * @param col               Tile column — used only to derive a stable noise-variant bucket.
 * @param row               Tile row — used only to derive a stable noise-variant bucket.
 * @param seed              World/room seed for noise variety.
 * @param blockSizePx       Block size in world units — used to space bucket noise origins.
 * @returns                 A shaded (or, when baking is disallowed, cheap unshaded) canvas. Never null once `img` is ready.
 */
export function getLegacyShadedSprite(
  img: HTMLImageElement,
  widthPx: number,
  heightPx: number,
  openAirSidesMask: number,
  col: number,
  row: number,
  seed: number,
  blockSizePx: number,
): HTMLCanvasElement {
  const imgKey = _identityKey(img);
  const variantBucket = hashTilePosition(col, row, seed) % SHADED_VARIANT_BUCKETS;
  const key = _cacheKey(imgKey, widthPx, heightPx, openAirSidesMask, variantBucket, seed);

  const cached = _shadedCache.get(key);
  if (cached !== undefined) return cached;

  if (FP.isBakeForbiddenInGameplay() || FP.isBakeBudgetExhausted()) {
    if (!FP.isBakeForbiddenInGameplay()) FP.markBudgetExhaustedFallback();
    const unshaded = getLegacyUnshadedSprite(img, widthPx, heightPx);
    legacyShadingStats.unshadedFallbacksThisFrame++;
    legacyShadingStats.totalUnshadedFallbacks++;
    FP.recordUnshadedFallback();
    return unshaded;
  }

  const bucketWorldX = variantBucket * blockSizePx;
  const bucketWorldY = 0;

  const c = document.createElement('canvas');
  c.width = widthPx;
  c.height = heightPx;
  const ctx = c.getContext('2d');
  if (ctx === null) return c;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, widthPx, heightPx);

  const _t0 = import.meta.env?.DEV ? performance.now() : 0;
  applyOrganicEdgeShading(ctx, widthPx, heightPx, openAirSidesMask, bucketWorldX, bucketWorldY, seed);
  FP.recordSpriteBake(key, import.meta.env?.DEV ? performance.now() - _t0 : 0);

  legacyShadingStats.shadedBakesThisFrame++;
  legacyShadingStats.totalShadedBakes++;
  FP.recordLegacyShadedBake();

  _shadedCache.set(key, c);
  return c;
}

export { OPEN_AIR_ALL_SIDES };
