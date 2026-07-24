/**
 * Procedural block sprite generator.
 *
 * For each placed block, a final sprite is produced at runtime by:
 *   1. Deterministically selecting a base sprite variation from the correct
 *      pool (using a position hash so each tile always shows the same variant).
 *   2. Applying the white-pixel template mask for the requested shape via
 *      Canvas 2D 'destination-in' compositing:
 *        - White template pixels  → keep the base sprite pixel.
 *        - Transparent template pixels → erase (make transparent).
 *   3. Caching the resulting HTMLCanvasElement so it is generated at most once
 *      per unique (base URL, template URL, dimensions, orientation) combination.
 *
 * Orientation is encoded as:
 *   flipX    – horizontal mirror (used for ramp \ vs /)
 *   flipY    – vertical mirror   (used for ceiling ramps)
 *   rotStep  – rotation in 90° CW steps (0–3), applied to the template only
 *              (used for platform left/right edges)
 *
 * Only the template is transformed; the base texture is always drawn upright so
 * the rock detail doesn't rotate unexpectedly with the shape orientation.
 */

import type { BlockShapeName } from './blockSpriteCatalog';
import { TEMPLATE_URLS, getBaseSpriteProbePool } from './blockSpriteCatalog';
import {
  applyOrganicEdgeShading,
  EDGE_SHADING_VERSION,
  OPEN_AIR_SIDE_N,
  OPEN_AIR_SIDE_E,
  OPEN_AIR_SIDE_S,
  OPEN_AIR_SIDE_W,
  OPEN_AIR_ALL_SIDES,
} from './blockEdgeShading';
import { loadImg, isSpriteReady } from '../imageCache';
import * as FP from '../../debug/perfFreezeProfiler';

// Re-export open-air side constants so callers (blockSpriteRenderer.ts) do not
// need to change their import paths.
export {
  OPEN_AIR_SIDE_N,
  OPEN_AIR_SIDE_E,
  OPEN_AIR_SIDE_S,
  OPEN_AIR_SIDE_W,
  OPEN_AIR_ALL_SIDES,
};

// ── Sprite generation cache ───────────────────────────────────────────────────

/** Cache of fully generated (shaded) sprites keyed by a unique string. */
const _spriteCache = new Map<string, HTMLCanvasElement>();

/**
 * Cache of cheap unshaded sprites for active-gameplay frames when baking is
 * forbidden.  Keyed by the same string as `_spriteCache` (variant bucket
 * included) but stored separately so shaded versions can later replace them.
 * Created with the same base+template compositing but without
 * `applyOrganicEdgeShading`, making them very cheap (no getImageData/putImageData).
 */
const _unshadedSpriteCache = new Map<string, HTMLCanvasElement>();

/**
 * Number of distinct noise variants per (baseUrl, templateUrl, size, mask, seed).
 * See folderBlockThemes.ts SHADED_VARIANT_BUCKETS for the same technique.
 * Bounds the cache to PROC_VARIANT_BUCKETS entries per unique (url, template,
 * mask) combination instead of one entry per tile coordinate.
 */
const PROC_VARIANT_BUCKETS = 16;

function _cacheKey(
  baseUrl: string,
  templateUrl: string,
  widthPx: number,
  heightPx: number,
  flipX: boolean,
  flipY: boolean,
  rotStep: number,
  openAirSidesMask: number,
  variantBucket: number,
  seed: number,
  suppressEdgeShading: boolean,
): string {
  return `${baseUrl}|${templateUrl}|${widthPx}|${heightPx}|${flipX ? 1 : 0}${flipY ? 1 : 0}${rotStep}|${openAirSidesMask}|${variantBucket}|${seed}|${suppressEdgeShading ? 'plain' : `v${EDGE_SHADING_VERSION}`}`;
}

/**
 * Creates an HTMLCanvasElement containing the base sprite cut to the template
 * shape, with an optional orientation transform on the template.
 *
 * The base texture is drawn upright.  Only the template mask is transformed so
 * the rock detail never rotates/flips while the cut shape does.
 *
 * @param applyShading  When true (default), calls `applyOrganicEdgeShading`.
 *                      Pass false for a cheap unshaded fallback canvas.
 */
function _generateSprite(
  base: HTMLImageElement,
  template: HTMLImageElement,
  widthPx: number,
  heightPx: number,
  flipX: boolean,
  flipY: boolean,
  rotStep: number,
  openAirSidesMask: number,
  worldOriginXWorld: number,
  worldOriginYWorld: number,
  seed: number,
  applyShading = true,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width  = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // Step 1: draw base texture (always upright, never transformed).
  ctx.drawImage(base, 0, 0, widthPx, heightPx);

  // Step 2: apply template mask using 'destination-in' compositing.
  // Where template alpha > 0 the destination pixel is kept; transparent erases it.
  ctx.globalCompositeOperation = 'destination-in';
  if (rotStep !== 0 || flipX || flipY) {
    ctx.save();
    ctx.translate(widthPx * 0.5, heightPx * 0.5);
    if (rotStep !== 0) ctx.rotate(rotStep * Math.PI * 0.5);
    if (flipX) ctx.scale(-1, 1);
    if (flipY) ctx.scale(1, -1);
    ctx.drawImage(template, -widthPx * 0.5, -heightPx * 0.5, widthPx, heightPx);
    ctx.restore();
  } else {
    ctx.drawImage(template, 0, 0, widthPx, heightPx);
  }
  ctx.globalCompositeOperation = 'source-over';

  // Step 3: optionally apply organic edge shading (shared with folder-based sprites).
  // Skipped for cheap unshaded fallback canvases used during active gameplay.
  if (applyShading) {
    applyOrganicEdgeShading(ctx, widthPx, heightPx, openAirSidesMask, worldOriginXWorld, worldOriginYWorld, seed);
  }

  return canvas;
}

// ── Public sprite accessor ────────────────────────────────────────────────────

/**
 * Returns a cached HTMLCanvasElement for the given base + template combination,
 * or `null` when either image is not yet loaded.
 *
 * Once both images are loaded the result is generated and permanently cached.
 *
 * @param col  Optional tile column — used to compute a bounded variant bucket
 *             so the sprite cache stays O(variants) rather than O(room_tiles).
 * @param row  Optional tile row — same purpose as `col`.
 */
export function getProceduralSprite(
  baseUrl: string,
  templateUrl: string,
  widthPx: number,
  heightPx: number,
  flipX: boolean,
  flipY: boolean,
  rotStep: number,
  openAirSidesMask: number = OPEN_AIR_ALL_SIDES,
  worldOriginXWorld: number = 0,
  worldOriginYWorld: number = 0,
  seed: number = 0,
  col?: number,
  row?: number,
  suppressEdgeShading = false,
): HTMLCanvasElement | null {
  // Compute a bounded variant bucket to prevent per-tile cache explosion.
  // When col/row are provided (all internal callers), use them directly.
  // Otherwise approximate from world origin — useful for any external callers
  // that don't have grid coordinates handy.
  const colForBucket = col !== undefined ? col : Math.round(worldOriginXWorld / Math.max(widthPx, 1));
  const rowForBucket = row !== undefined ? row : Math.round(worldOriginYWorld / Math.max(heightPx, 1));
  const variantBucket = hashTilePosition(colForBucket, rowForBucket, seed) % PROC_VARIANT_BUCKETS;
  // Representative world origin for this bucket — deterministic and bounded.
  // Y is always 0 (only X axis carries the bucket variation to match folderBlockThemes.ts).
  const bucketWorldX  = variantBucket * widthPx;
  const bucketWorldY  = 0;

  const key = _cacheKey(baseUrl, templateUrl, widthPx, heightPx, flipX, flipY, rotStep, openAirSidesMask, variantBucket, seed, suppressEdgeShading);
  const cached = _spriteCache.get(key);
  if (cached !== undefined) return cached;

  const base     = loadImg(baseUrl);
  const template = loadImg(templateUrl);
  if (!isSpriteReady(base) || !isSpriteReady(template)) return null;

  if (suppressEdgeShading) {
    const result = _generateSprite(
      base, template, widthPx, heightPx,
      flipX, flipY, rotStep, openAirSidesMask,
      bucketWorldX, bucketWorldY, seed,
      false,
    );
    _spriteCache.set(key, result);
    return result;
  }

  // During active gameplay, baking new shaded sprites is forbidden to prevent
  // unexpected getImageData/putImageData stalls.  Return a cheap unshaded
  // fallback canvas — this is a stable non-null result so the chunk does NOT
  // set hadFallbacksFlag and will NOT rebuild every frame.
  if (FP.isBakeForbiddenInGameplay() || FP.isBakeBudgetExhausted()) {
    if (!FP.isBakeForbiddenInGameplay()) FP.markBudgetExhaustedFallback();
    const unshadedCached = _unshadedSpriteCache.get(key);
    if (unshadedCached !== undefined) return unshadedCached;
    const unshaded = _generateSprite(
      base, template, widthPx, heightPx,
      flipX, flipY, rotStep, openAirSidesMask,
      bucketWorldX, bucketWorldY, seed,
      /* applyShading */ false,
    );
    _unshadedSpriteCache.set(key, unshaded);
    return unshaded;
  }

  const _t0 = import.meta.env.DEV ? performance.now() : 0;
  const result = _generateSprite(
    base, template, widthPx, heightPx,
    flipX, flipY, rotStep, openAirSidesMask,
    bucketWorldX, bucketWorldY, seed,
    /* applyShading */ true,
  );
  _spriteCache.set(key, result);
  FP.recordSpriteBake(key, import.meta.env.DEV ? performance.now() - _t0 : 0);
  return result;
}

// ── Position hash ─────────────────────────────────────────────────────────────

/**
 * Deterministic integer hash of a tile grid position.
 * Used to pick a stable, pseudo-random base sprite variation per cell so the
 * same block always shows the same texture across frames and game sessions.
 *
 * Uses the MurmurHash3 finalizer mix applied to a simple spatial seed formed
 * from the tile coordinates and an optional room/world seed.  The magic
 * constants (73856093, 19349663, 83492791) are standard spatial-hash primes;
 * 2246822519 is the first MurmurHash3 finalization constant.
 *
 * @param col   Tile column (0-based).
 * @param row   Tile row (0-based).
 * @param seed  Optional extra seed (e.g. world / room number).
 * @returns     Non-negative 32-bit integer.
 */
export function hashTilePosition(col: number, row: number, seed: number = 0): number {
  let h = (col * 73856093) ^ (row * 19349663) ^ (seed * 83492791);
  h |= 0;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}

// ── Per-pool ready-URL cache ──────────────────────────────────────────────────

/**
 * Caches the filtered list of successfully-loaded URLs for each probe pool.
 * Key: reference to the probe pool array (identity comparison).
 *
 * The cache is rebuilt lazily when the pool's ready-count has grown.  This
 * avoids per-frame allocation while still picking up newly-loaded variations.
 */
const _readyUrlsByPool = new Map<readonly string[], { urls: string[]; readyCount: number }>();

/**
 * Returns the subset of `probePool` whose images have finished loading,
 * using a cached result that is only rebuilt when new images have loaded.
 *
 * Avoids allocating a new array on every render call while sprites are still
 * being fetched — critical because this function runs for every visible tile.
 */
function _getReadyUrls(probePool: readonly string[]): string[] {
  // Count how many pool images are currently loaded.
  let currentReadyCount = 0;
  for (let i = 0; i < probePool.length; i++) {
    const img = loadImg(probePool[i]);
    if (isSpriteReady(img)) currentReadyCount++;
  }

  const entry = _readyUrlsByPool.get(probePool);
  if (entry !== undefined && entry.readyCount === currentReadyCount) {
    return entry.urls;
  }

  // Rebuild the ready list.
  const urls: string[] = [];
  for (let i = 0; i < probePool.length; i++) {
    if (isSpriteReady(loadImg(probePool[i]))) urls.push(probePool[i]);
  }
  _readyUrlsByPool.set(probePool, { urls, readyCount: currentReadyCount });
  return urls;
}

/**
 * Picks a ready base sprite URL from a probe pool using a deterministic hash.
 * Falls back to the first URL in the pool when no images have loaded yet so
 * the caller can still attempt loading rather than silently skipping.
 *
 * @param probePool   Array of probe URLs (some may not exist / not be loaded).
 * @param hash        Pre-computed hash to choose the variation.
 * @returns           A URL string, or `null` when the pool is empty.
 */
function _pickFromPool(probePool: readonly string[], hash: number): string | null {
  if (probePool.length === 0) return null;

  const readyUrls = _getReadyUrls(probePool);
  if (readyUrls.length === 0) {
    // Images still loading — return first URL so the caller can initiate
    // loading and show a fallback this frame, then retry next frame.
    return probePool[0];
  }

  return readyUrls[hash % readyUrls.length];
}

// ── Orientation helpers ───────────────────────────────────────────────────────

/**
 * Returns the flip flags for a ramp or stairs orientation index.
 * Both shapes share this convention — their templates are authored in the
 * same base orientation (solid in the lower-right).
 *   0 = / rises right  → no flip (template default)
 *   1 = \ rises left   → flip horizontally
 *   2 = ⌐ ceiling      → flip vertically
 *   3 = ¬ ceiling      → flip both axes
 */
function _rampOriToFlips(orientationIndex: number): [boolean, boolean] {
  switch (orientationIndex) {
    case 1:  return [true,  false];
    case 2:  return [false, true];
    case 3:  return [true,  true];
    default: return [false, false];
  }
}

/**
 * Returns the flip flags and rotation step for a platform edge index.
 *   0 = top    → no transform (template default)
 *   1 = bottom → flip Y
 *   2 = left   → rotate 90° CCW (= 270° CW, rotStep=3)
 *   3 = right  → rotate 90° CW  (rotStep=1)
 */
function _platformEdgeToTransform(platformEdge: number): [boolean, boolean, number] {
  switch (platformEdge) {
    case 1:  return [false, true,  0];
    case 2:  return [false, false, 3];
    case 3:  return [false, false, 1];
    default: return [false, false, 0];
  }
}

// ── Per-shape procedural accessors ────────────────────────────────────────────

/**
 * Returns the procedural sprite for a 1×1 solid block cell.
 *
 * @param col        Tile column.
 * @param row        Tile row.
 * @param material   Block material name (e.g. `'blackRock'`).
 * @param blockSizePx Block size in virtual pixels (= world units at zoom 1).
 * @param seed       Hash seed (e.g. world number).
 */
export function getBlockSprite1x1(
  col: number,
  row: number,
  material: string,
  blockSizePx: number,
  seed: number,
  openAirSidesMask: number = OPEN_AIR_ALL_SIDES,
  suppressEdgeShading = false,
): HTMLCanvasElement | null {
  const pool = getBaseSpriteProbePool(material, false);
  if (pool.length === 0) return null;
  const hash    = hashTilePosition(col, row, seed);
  const baseUrl = _pickFromPool(pool, hash);
  if (baseUrl === null) return null;
  return getProceduralSprite(baseUrl, TEMPLATE_URLS['1x1 block'], blockSizePx, blockSizePx, false, false, 0, openAirSidesMask, col * blockSizePx, row * blockSizePx, seed, col, row, suppressEdgeShading);
}

/**
 * Returns the procedural sprite for a 2×2 solid block (top-left cell
 * coordinates provided).
 *
 * @param col        Tile column of the 2×2 top-left corner.
 * @param row        Tile row of the 2×2 top-left corner.
 * @param material   Block material name.
 * @param blockSizePx Block size in virtual pixels.
 * @param seed       Hash seed.
 */
export function getBlockSprite2x2(
  col: number,
  row: number,
  material: string,
  blockSizePx: number,
  seed: number,
  openAirSidesMask: number = OPEN_AIR_ALL_SIDES,
  suppressEdgeShading = false,
): HTMLCanvasElement | null {
  const pool = getBaseSpriteProbePool(material, true);
  if (pool.length === 0) return null;
  const hash    = hashTilePosition(col, row, seed);
  const baseUrl = _pickFromPool(pool, hash);
  if (baseUrl === null) return null;
  const dim = blockSizePx * 2;
  return getProceduralSprite(baseUrl, TEMPLATE_URLS['2x2 block'], dim, dim, false, false, 0, openAirSidesMask, col * blockSizePx, row * blockSizePx, seed, col, row, suppressEdgeShading);
}

/**
 * Returns the procedural sprite for a 1×1 platform cell.
 *
 * @param col          Tile column.
 * @param row          Tile row.
 * @param material     Block material name.
 * @param blockSizePx  Block size in virtual pixels.
 * @param platformEdge Platform edge index: 0=top, 1=bottom, 2=left, 3=right.
 * @param seed         Hash seed.
 */
export function getPlatformSprite1x1(
  col: number,
  row: number,
  material: string,
  blockSizePx: number,
  platformEdge: number,
  seed: number,
  suppressEdgeShading = false,
): HTMLCanvasElement | null {
  const pool = getBaseSpriteProbePool(material, false);
  if (pool.length === 0) return null;
  const hash    = hashTilePosition(col, row, seed);
  const baseUrl = _pickFromPool(pool, hash);
  if (baseUrl === null) return null;
  const [flipX, flipY, rotStep] = _platformEdgeToTransform(platformEdge);
  // Platforms are always at the boundary of solid regions; use all-sides-open default.
  return getProceduralSprite(baseUrl, TEMPLATE_URLS['1x1 platform'], blockSizePx, blockSizePx, flipX, flipY, rotStep, OPEN_AIR_ALL_SIDES, col * blockSizePx, row * blockSizePx, seed, col, row, suppressEdgeShading);
}

/**
 * Returns the procedural platform sprite for a 1×1 cell using an explicit
 * base sprite URL instead of a material probe pool.
 *
 * Used for folder-based themes where the sprite URL is already known (e.g.
 * discovered via `import.meta.glob`), bypassing the probe-pool mechanism.
 *
 * @param baseUrl      Direct URL of the base sprite image.
 * @param col          Tile column.
 * @param row          Tile row.
 * @param blockSizePx  Block size in virtual pixels.
 * @param platformEdge Platform edge index: 0=top, 1=bottom, 2=left, 3=right.
 * @param seed         Hash seed.
 */
export function getPlatformSpriteFromBaseUrl(
  baseUrl: string,
  col: number,
  row: number,
  blockSizePx: number,
  platformEdge: number,
  seed: number,
  suppressEdgeShading = false,
): HTMLCanvasElement | null {
  const [flipX, flipY, rotStep] = _platformEdgeToTransform(platformEdge);
  return getProceduralSprite(
    baseUrl, TEMPLATE_URLS['1x1 platform'],
    blockSizePx, blockSizePx,
    flipX, flipY, rotStep,
    OPEN_AIR_ALL_SIDES,
    col * blockSizePx, row * blockSizePx,
    seed,
    col, row, suppressEdgeShading,
  );
}


/**
 * Returns the procedural sprite for a 2×2 platform cell (top-left coordinates).
 *
 * @param col          Tile column of the 2×2 top-left corner.
 * @param row          Tile row of the 2×2 top-left corner.
 * @param material     Block material name.
 * @param blockSizePx  Block size in virtual pixels.
 * @param platformEdge Platform edge index: 0=top, 1=bottom, 2=left, 3=right.
 * @param seed         Hash seed.
 */
export function getPlatformSprite2x2(
  col: number,
  row: number,
  material: string,
  blockSizePx: number,
  platformEdge: number,
  seed: number,
  suppressEdgeShading = false,
): HTMLCanvasElement | null {
  const pool = getBaseSpriteProbePool(material, true);
  if (pool.length === 0) return null;
  const hash    = hashTilePosition(col, row, seed);
  const baseUrl = _pickFromPool(pool, hash);
  if (baseUrl === null) return null;
  const [flipX, flipY, rotStep] = _platformEdgeToTransform(platformEdge);
  const dim = blockSizePx * 2;
  return getProceduralSprite(baseUrl, TEMPLATE_URLS['2x2 platform'], dim, dim, flipX, flipY, rotStep, OPEN_AIR_ALL_SIDES, col * blockSizePx, row * blockSizePx, seed, col, row, suppressEdgeShading);
}

/**
 * Returns the procedural sprite for a stairs wall.
 *
 * The stair mask is cut from the base texture by the same `destination-in`
 * template compositing every other shape uses, so transparent template pixels
 * never draw and the organic edge shading (which derives open air from the
 * canvas alpha channel) automatically highlights each individual step edge.
 *
 * @param col           Tile column of the stairs top-left corner.
 * @param row           Tile row of the stairs top-left corner.
 * @param widthBlocks   Stairs width in blocks (1 or 2).
 * @param heightBlocks  Stairs height in blocks (1 or 2).
 * @param orientation   Stairs orientation index (0–3), same convention as ramps.
 * @param material      Block material name.
 * @param blockSizePx   Block size in virtual pixels.
 * @param seed          Hash seed.
 */
export function getStairsSprite(
  col: number,
  row: number,
  widthBlocks: number,
  heightBlocks: number,
  orientation: number,
  material: string,
  blockSizePx: number,
  seed: number,
  suppressEdgeShading = false,
): HTMLCanvasElement | null {
  const use2x2Pool = widthBlocks >= 2 || heightBlocks >= 2;
  const pool = getBaseSpriteProbePool(material, use2x2Pool);
  if (pool.length === 0) return null;

  const hash    = hashTilePosition(col, row, seed);
  const baseUrl = _pickFromPool(pool, hash);
  if (baseUrl === null) return null;

  const widthPx  = widthBlocks  * blockSizePx;
  const heightPx = heightBlocks * blockSizePx;

  let shapeName: BlockShapeName;
  if (widthBlocks === 1 && heightBlocks === 1) {
    shapeName = '1x1 stairs';
  } else if (widthBlocks === 2 && heightBlocks === 1) {
    shapeName = '1x2 stairs';
  } else {
    shapeName = '2x2 stairs';
  }

  const [flipX, flipY] = _rampOriToFlips(orientation);
  return getProceduralSprite(baseUrl, TEMPLATE_URLS[shapeName], widthPx, heightPx, flipX, flipY, 0, OPEN_AIR_ALL_SIDES, col * blockSizePx, row * blockSizePx, seed, col, row, suppressEdgeShading);
}

/**
 * Returns the procedural sprite for a ramp wall.  LEGACY — ramps are retired
 * from editor placement; this keeps pre-existing rooms rendering.
 *
 * Base-pool selection:
 *   - 2×2 or 1×2 ramps use the 2×2 pool (wider texture detail).
 *   - 1×1 ramps use the 1×1 pool.
 *
 * @param col           Tile column of the ramp top-left corner.
 * @param row           Tile row of the ramp top-left corner.
 * @param widthBlocks   Ramp width in blocks (1 or 2).
 * @param heightBlocks  Ramp height in blocks (1 or 2).
 * @param orientation   Ramp orientation index (0–3): 0=/, 1=\, 2=⌐, 3=¬.
 * @param material      Block material name.
 * @param blockSizePx   Block size in virtual pixels.
 * @param seed          Hash seed.
 */
export function getRampSprite(
  col: number,
  row: number,
  widthBlocks: number,
  heightBlocks: number,
  orientation: number,
  material: string,
  blockSizePx: number,
  seed: number,
  suppressEdgeShading = false,
): HTMLCanvasElement | null {
  const use2x2Pool = widthBlocks >= 2 || heightBlocks >= 2;
  const pool = getBaseSpriteProbePool(material, use2x2Pool);
  if (pool.length === 0) return null;

  const hash    = hashTilePosition(col, row, seed);
  const baseUrl = _pickFromPool(pool, hash);
  if (baseUrl === null) return null;

  const widthPx  = widthBlocks  * blockSizePx;
  const heightPx = heightBlocks * blockSizePx;

  let shapeName: BlockShapeName;
  if (widthBlocks === 1 && heightBlocks === 1) {
    shapeName = '1x1 ramp';
  } else if (widthBlocks === 2 && heightBlocks === 1) {
    shapeName = '1x2 ramp';
  } else {
    shapeName = '2x2 ramp';
  }

  const [flipX, flipY] = _rampOriToFlips(orientation);
  return getProceduralSprite(baseUrl, TEMPLATE_URLS[shapeName], widthPx, heightPx, flipX, flipY, 0, OPEN_AIR_ALL_SIDES, col * blockSizePx, row * blockSizePx, seed, col, row, suppressEdgeShading);
}

// ── Derived-sprite prewarm helper ─────────────────────────────────────────────

/**
 * Proactively warms the shaded procedural-sprite cache for one tile variant
 * during a loading or prewarm phase (baking is allowed).
 *
 * Calls `getProceduralSprite` directly so the shaded canvas is stored before
 * the player regains control, preventing first-touch stutter.
 *
 * Respects `isBakeBudgetExhausted()` — if the budget is gone this frame the
 * call is a no-op and returns `false`; the caller should retry next frame.
 *
 * @returns `true` when the variant was already cached or was successfully baked;
 *          `false` when the budget ran out and the bake was skipped.
 */
export function prewarmProceduralSpriteVariant(
  baseUrl:          string,
  templateUrl:      string,
  widthPx:          number,
  heightPx:         number,
  flipX:            boolean,
  flipY:            boolean,
  rotStep:          number,
  openAirSidesMask: number,
  col:              number,
  row:              number,
  seed:             number,
): boolean {
  if (FP.isBakeBudgetExhausted()) return false;
  const result = getProceduralSprite(
    baseUrl, templateUrl, widthPx, heightPx,
    flipX, flipY, rotStep, openAirSidesMask,
    col * widthPx, row * heightPx,
    seed, col, row,
  );
  // A non-null result means the variant is (or was) cached.
  return result !== null;
}
