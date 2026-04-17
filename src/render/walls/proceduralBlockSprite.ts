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

// ── Image loading ─────────────────────────────────────────────────────────────

/** Module-level cache of loaded HTMLImageElements. */
const _imgCache = new Map<string, HTMLImageElement>();

/** Loads an image URL (fire-and-forget); returns the same element on repeat calls. */
function _loadImg(url: string): HTMLImageElement {
  const hit = _imgCache.get(url);
  if (hit !== undefined) return hit;
  const img = new Image();
  img.src = url;
  _imgCache.set(url, img);
  return img;
}

/** Returns true once an image has fully loaded and has non-zero dimensions. */
function _isReady(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

// ── Sprite generation cache ───────────────────────────────────────────────────

/** Cache of fully generated sprites keyed by a unique string. */
const _spriteCache = new Map<string, HTMLCanvasElement>();

function _cacheKey(
  baseUrl: string,
  templateUrl: string,
  widthPx: number,
  heightPx: number,
  flipX: boolean,
  flipY: boolean,
  rotStep: number,
): string {
  return `${baseUrl}|${templateUrl}|${widthPx}|${heightPx}|${flipX ? 1 : 0}${flipY ? 1 : 0}${rotStep}`;
}

/**
 * Creates an HTMLCanvasElement containing the base sprite cut to the template
 * shape, with an optional orientation transform on the template.
 *
 * The base texture is drawn upright.  Only the template mask is transformed so
 * the rock detail never rotates/flips while the cut shape does.
 */
function _generateSprite(
  base: HTMLImageElement,
  template: HTMLImageElement,
  widthPx: number,
  heightPx: number,
  flipX: boolean,
  flipY: boolean,
  rotStep: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width  = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d')!;

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

  return canvas;
}

// ── Public sprite accessor ────────────────────────────────────────────────────

/**
 * Returns a cached HTMLCanvasElement for the given base + template combination,
 * or `null` when either image is not yet loaded.
 *
 * Once both images are loaded the result is generated and permanently cached.
 */
export function getProceduralSprite(
  baseUrl: string,
  templateUrl: string,
  widthPx: number,
  heightPx: number,
  flipX: boolean,
  flipY: boolean,
  rotStep: number,
): HTMLCanvasElement | null {
  const key = _cacheKey(baseUrl, templateUrl, widthPx, heightPx, flipX, flipY, rotStep);
  const cached = _spriteCache.get(key);
  if (cached !== undefined) return cached;

  const base     = _loadImg(baseUrl);
  const template = _loadImg(templateUrl);
  if (!_isReady(base) || !_isReady(template)) return null;

  const result = _generateSprite(base, template, widthPx, heightPx, flipX, flipY, rotStep);
  _spriteCache.set(key, result);
  return result;
}

// ── Position hash ─────────────────────────────────────────────────────────────

/**
 * Deterministic integer hash of a tile grid position.
 * Used to pick a stable, pseudo-random base sprite variation per cell so the
 * same block always shows the same texture across frames and game sessions.
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

/**
 * Picks a ready base sprite URL from a probe pool using a deterministic hash.
 * Falls back to the first URL in the pool if no images have loaded yet (so the
 * caller can still attempt loading rather than silently skipping).
 *
 * @param probePool   Array of probe URLs (some may not exist / not be loaded).
 * @param hash        Pre-computed hash to choose the variation.
 * @returns           A URL string, or `null` when the pool is empty.
 */
function _pickFromPool(probePool: readonly string[], hash: number): string | null {
  if (probePool.length === 0) return null;

  // Collect URLs whose images have successfully loaded.
  const readyUrls: string[] = [];
  for (let i = 0; i < probePool.length; i++) {
    const img = _loadImg(probePool[i]);
    if (_isReady(img)) readyUrls.push(probePool[i]);
  }

  if (readyUrls.length === 0) {
    // Images still loading — kick off loading, return first URL so caller can
    // show a fallback and retry next frame.
    return probePool[0];
  }

  return readyUrls[hash % readyUrls.length];
}

// ── Orientation helpers ───────────────────────────────────────────────────────

/**
 * Returns the flip flags for a ramp orientation index.
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
): HTMLCanvasElement | null {
  const pool = getBaseSpriteProbePool(material, false);
  if (pool.length === 0) return null;
  const hash    = hashTilePosition(col, row, seed);
  const baseUrl = _pickFromPool(pool, hash);
  if (baseUrl === null) return null;
  return getProceduralSprite(baseUrl, TEMPLATE_URLS['1x1 block'], blockSizePx, blockSizePx, false, false, 0);
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
): HTMLCanvasElement | null {
  const pool = getBaseSpriteProbePool(material, true);
  if (pool.length === 0) return null;
  const hash    = hashTilePosition(col, row, seed);
  const baseUrl = _pickFromPool(pool, hash);
  if (baseUrl === null) return null;
  const dim = blockSizePx * 2;
  return getProceduralSprite(baseUrl, TEMPLATE_URLS['2x2 block'], dim, dim, false, false, 0);
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
): HTMLCanvasElement | null {
  const pool = getBaseSpriteProbePool(material, false);
  if (pool.length === 0) return null;
  const hash    = hashTilePosition(col, row, seed);
  const baseUrl = _pickFromPool(pool, hash);
  if (baseUrl === null) return null;
  const [flipX, flipY, rotStep] = _platformEdgeToTransform(platformEdge);
  return getProceduralSprite(baseUrl, TEMPLATE_URLS['1x1 platform'], blockSizePx, blockSizePx, flipX, flipY, rotStep);
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
): HTMLCanvasElement | null {
  const pool = getBaseSpriteProbePool(material, true);
  if (pool.length === 0) return null;
  const hash    = hashTilePosition(col, row, seed);
  const baseUrl = _pickFromPool(pool, hash);
  if (baseUrl === null) return null;
  const [flipX, flipY, rotStep] = _platformEdgeToTransform(platformEdge);
  const dim = blockSizePx * 2;
  return getProceduralSprite(baseUrl, TEMPLATE_URLS['2x2 platform'], dim, dim, flipX, flipY, rotStep);
}

/**
 * Returns the procedural sprite for a ramp wall.
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
  return getProceduralSprite(baseUrl, TEMPLATE_URLS[shapeName], widthPx, heightPx, flipX, flipY, 0);
}
