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

const _OPEN_AIR_EDGE_DISTANCE_NONE = 255;
/** Max internal BFS depth (0-indexed). Depths 0..2 map to spec distances 1..3. */
const _OPEN_AIR_FILTER_MAX_DISTANCE_PX = 2;

// ── Organic edge shading constants ────────────────────────────────────────────
/** Base multiply per internal depth (0=spec-1, 1=spec-2, 2=spec-3). */
const _EDGE_BASE_MULTIPLIER = [0.70, 0.82, 0.92] as const;
/** Minimum multiplier per depth — ensures darkest-allowed shade at each level. */
const _EDGE_CLAMP_MIN       = [0.65, 0.78, 0.88] as const;
/** Maximum multiplier per depth — prevents shallower depth from exceeding deeper. */
const _EDGE_CLAMP_MAX       = [0.78, 0.88, 0.96] as const;
/** Noise-coordinate scale (noise-grid-units per world pixel). */
const _EDGE_NOISE_SCALE     = 0.15;
/** Amplitude of centred noise variation (+/−). */
const _EDGE_VARIATION_STR   = 0.08;
/** Additional darkening for pixels with ≥ 2 open-air neighbours (corner recessing). */
const _EDGE_CORNER_BOOST    = -0.05;
/** Additive highlight for outermost (depth 0) pixels exposed toward the top-left light. */
const _EDGE_HIGHLIGHT_AMOUNT = 0.07;

/**
 * Bit mask for open-air sides of a block sprite canvas.
 * Bit 0 = North (y=0 border), Bit 1 = East (x=widthPx-1 border),
 * Bit 2 = South (y=heightPx-1 border), Bit 3 = West (x=0 border).
 * A set bit means that border is exposed to air (no solid block neighbor on that side).
 * Pass 0xF to treat all four canvas borders as open air (default/ramp/platform behavior).
 */
export const OPEN_AIR_SIDE_N = 1;
export const OPEN_AIR_SIDE_E = 2;
export const OPEN_AIR_SIDE_S = 4;
export const OPEN_AIR_SIDE_W = 8;
/** All four borders exposed to air — use for ramps, platforms, and isolated blocks. */
export const OPEN_AIR_ALL_SIDES = 0xF;

function _cacheKey(
  baseUrl: string,
  templateUrl: string,
  widthPx: number,
  heightPx: number,
  flipX: boolean,
  flipY: boolean,
  rotStep: number,
  openAirSidesMask: number,
  worldOriginXWorld: number,
  worldOriginYWorld: number,
  seed: number,
): string {
  return `${baseUrl}|${templateUrl}|${widthPx}|${heightPx}|${flipX ? 1 : 0}${flipY ? 1 : 0}${rotStep}|${openAirSidesMask}|${worldOriginXWorld}|${worldOriginYWorld}|${seed}`;
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
  openAirSidesMask: number,
  worldOriginXWorld: number,
  worldOriginYWorld: number,
  seed: number,
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

  // Step 3: add a cached organic edge-shading pass. This is separate from room
  // ambient lighting: it only depends on the final sprite alpha mask and world
  // position. Pixels near open air are darkened via multiply, with smooth
  // world-space noise variation for an organic look across connected blocks.
  _applyOrganicEdgeShadingFilter(ctx, widthPx, heightPx, openAirSidesMask, worldOriginXWorld, worldOriginYWorld, seed);

  return canvas;
}

// ── Smooth value noise (deterministic world-space) ────────────────────────────

/**
 * Hashes integer grid coordinates to a float in [0, 1].
 * Used as the corner values for 2-D value noise.
 */
function _hashNoiseCorner(ix: number, iy: number, seed: number): number {
  let h = (ix * 73856093) ^ (iy * 19349663) ^ (seed * 83492791);
  h |= 0;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295; // [0, 1]
}

/**
 * Bilinear smooth value noise in [0, 1].
 * Continuous and differentiable across all real (x, y) — no tile-edge seams.
 * Input coordinates are in noise-grid units; use a small scale (e.g. 0.15)
 * so adjacent world pixels produce very similar values.
 */
function _smoothNoise2d(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  // Smoothstep interpolation weights — removes visible derivative discontinuity.
  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);
  const a = _hashNoiseCorner(ix,     iy,     seed);
  const b = _hashNoiseCorner(ix + 1, iy,     seed);
  const c = _hashNoiseCorner(ix,     iy + 1, seed);
  const d = _hashNoiseCorner(ix + 1, iy + 1, seed);
  return a + ux * (b - a) + uy * (c - a) + ux * uy * (a - b - c + d);
}

// ── Organic edge shading filter ───────────────────────────────────────────────

/**
 * Returns true when pixel (xPx, yPx) has at least one open-air neighbour in
 * any of the 8 directions (orthogonal + diagonal).
 *
 * Open-air means:
 *   – Transparent (alpha 0) interior pixel.
 *   – Canvas border on a side flagged in openAirSidesMask.
 *     For diagonal-border positions the mask for either adjacent side suffices.
 */
function _hasAnyAirNeighbor8(
  data: Uint8ClampedArray,
  widthPx: number,
  heightPx: number,
  xPx: number,
  yPx: number,
  openAirSidesMask: number,
): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = xPx + dx;
      const ny = yPx + dy;
      if (nx < 0) {
        if (openAirSidesMask & OPEN_AIR_SIDE_W) return true;
        continue;
      }
      if (nx >= widthPx) {
        if (openAirSidesMask & OPEN_AIR_SIDE_E) return true;
        continue;
      }
      if (ny < 0) {
        if (openAirSidesMask & OPEN_AIR_SIDE_N) return true;
        continue;
      }
      if (ny >= heightPx) {
        if (openAirSidesMask & OPEN_AIR_SIDE_S) return true;
        continue;
      }
      if (data[(ny * widthPx + nx) * 4 + 3] === 0) return true;
    }
  }
  return false;
}

/**
 * Returns true when the cardinal neighbour of (xPx, yPx) in the direction
 * (dx, dy) — where exactly one of dx/dy is ±1 and the other is 0 — is open air.
 *
 * Open air means transparent (alpha 0) or a canvas border flagged in openAirSidesMask.
 */
function _isCardinalAirNeighbor(
  data: Uint8ClampedArray,
  widthPx: number,
  heightPx: number,
  xPx: number,
  yPx: number,
  openAirSidesMask: number,
  dx: -1 | 0 | 1,
  dy: -1 | 0 | 1,
): boolean {
  const nx = xPx + dx;
  const ny = yPx + dy;
  if (ny < 0)         return !!(openAirSidesMask & OPEN_AIR_SIDE_N);
  if (nx >= widthPx)  return !!(openAirSidesMask & OPEN_AIR_SIDE_E);
  if (ny >= heightPx) return !!(openAirSidesMask & OPEN_AIR_SIDE_S);
  if (nx < 0)         return !!(openAirSidesMask & OPEN_AIR_SIDE_W);
  return data[(ny * widthPx + nx) * 4 + 3] === 0;
}

/**
 * Counts the number of open-air cardinal (N/E/S/W) neighbours of (xPx, yPx).
 * Used for corner-reinforcement detection: ≥ 2 means the pixel is at a corner.
 */
function _countCardinalAirNeighbors(
  data: Uint8ClampedArray,
  widthPx: number,
  heightPx: number,
  xPx: number,
  yPx: number,
  openAirSidesMask: number,
): number {
  let count = 0;
  if (_isCardinalAirNeighbor(data, widthPx, heightPx, xPx, yPx, openAirSidesMask,  0, -1)) count++;
  if (_isCardinalAirNeighbor(data, widthPx, heightPx, xPx, yPx, openAirSidesMask,  1,  0)) count++;
  if (_isCardinalAirNeighbor(data, widthPx, heightPx, xPx, yPx, openAirSidesMask,  0,  1)) count++;
  if (_isCardinalAirNeighbor(data, widthPx, heightPx, xPx, yPx, openAirSidesMask, -1,  0)) count++;
  return count;
}

/**
 * Replaces the previous colour-inversion filter with a multiply-based darkening
 * pass that preserves hue and uses smooth world-space noise for organic variation.
 *
 * Algorithm:
 *   1. Compute each solid pixel's Chebyshev distance from open air (BFS, depth ≤ 3).
 *   2. Look up base multiply multiplier for that depth (0.70 / 0.82 / 0.92).
 *   3. Add centred smooth noise variation (±0.08) and clamp to the depth range.
 *   4. Apply corner boost (−0.05) when ≥ 2 cardinal neighbours are open air.
 *   5. Apply rim highlight (+0.07) on depth-0 pixels exposed to N or W (top-left light).
 *   6. Multiply the pixel's RGB channels by the final multiplier.
 *
 * The noise uses world-space coordinates so it is seamless across tile boundaries.
 *
 * @param worldOriginXWorld  World-unit X of the sprite's top-left pixel.
 * @param worldOriginYWorld  World-unit Y of the sprite's top-left pixel.
 * @param seed               World/room seed for noise variety between worlds.
 */
function _applyOrganicEdgeShadingFilter(
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  heightPx: number,
  openAirSidesMask: number,
  worldOriginXWorld: number,
  worldOriginYWorld: number,
  seed: number,
): void {
  const imageData = ctx.getImageData(0, 0, widthPx, heightPx);
  const data = imageData.data;
  const pixelCount = widthPx * heightPx;

  // ── Step 1: BFS to compute Chebyshev distance from open air ─────────────
  const distBuf = new Uint8Array(pixelCount);
  distBuf.fill(_OPEN_AIR_EDGE_DISTANCE_NONE);

  // One slot per pixel is sufficient: each pixel enters the queue at most once
  // (the guard in _pushNeighborIfCloser prevents duplicate entries).
  const queue = new Uint16Array(pixelCount);
  let qHead = 0;
  let qCount = 0;

  // Seed: all solid pixels with any 8-connected air neighbour → internal depth 0.
  for (let yPx = 0; yPx < heightPx; yPx++) {
    for (let xPx = 0; xPx < widthPx; xPx++) {
      const pi = yPx * widthPx + xPx;
      if (data[pi * 4 + 3] === 0) continue; // transparent = air, skip
      if (!_hasAnyAirNeighbor8(data, widthPx, heightPx, xPx, yPx, openAirSidesMask)) continue;
      distBuf[pi] = 0;
      queue[qCount++] = pi;
    }
  }

  // Propagate inward (8-connected BFS, max depth = _OPEN_AIR_FILTER_MAX_DISTANCE_PX).
  while (qHead < qCount) {
    const pi = queue[qHead++];
    const d = distBuf[pi];
    if (d >= _OPEN_AIR_FILTER_MAX_DISTANCE_PX) continue; // depth 2 → do not propagate further

    const nd = d + 1;
    const xPx = pi % widthPx;
    const yPx = (pi / widthPx) | 0;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = xPx + dx;
        const ny = yPx + dy;
        if (nx < 0 || nx >= widthPx || ny < 0 || ny >= heightPx) continue;
        const npi = ny * widthPx + nx;
        if (data[npi * 4 + 3] === 0) continue; // air
        if (distBuf[npi] <= nd) continue;       // already at equal or shorter distance
        distBuf[npi] = nd;
        queue[qCount++] = npi;
      }
    }
  }

  // ── Steps 2–6: compute multiplier and apply to RGB ────────────────────────
  for (let pi = 0; pi < pixelCount; pi++) {
    const d = distBuf[pi];
    if (d > _OPEN_AIR_FILTER_MAX_DISTANCE_PX) continue; // beyond shading range → no change

    const xPx = pi % widthPx;
    const yPx = (pi / widthPx) | 0;

    // Step 3: smooth world-space noise variation centred at 0.
    const worldX = worldOriginXWorld + xPx;
    const worldY = worldOriginYWorld + yPx;
    const noiseVal = _smoothNoise2d(worldX * _EDGE_NOISE_SCALE, worldY * _EDGE_NOISE_SCALE, seed);
    const variation = (noiseVal * 2.0 - 1.0) * _EDGE_VARIATION_STR;

    // Step 2: base multiplier with noise variation.
    let multiplier = _EDGE_BASE_MULTIPLIER[d] + variation;

    // Step 4: corner reinforcement — extra darkening for corner pixels.
    const airNeighborCount = _countCardinalAirNeighbors(data, widthPx, heightPx, xPx, yPx, openAirSidesMask);
    if (airNeighborCount >= 2) {
      multiplier += _EDGE_CORNER_BOOST;
    }

    // Clamp to the allowed range for this depth.
    const cMin = _EDGE_CLAMP_MIN[d];
    const cMax = _EDGE_CLAMP_MAX[d];
    if (multiplier < cMin) multiplier = cMin;
    if (multiplier > cMax) multiplier = cMax;

    // Step 6: rim highlight for outermost pixels (depth 0) facing the top-left light.
    // A pixel is "facing the light" when it has an open-air cardinal neighbour to
    // the north or west (the presumed light direction).
    if (d === 0) {
      const facesLightN = _isCardinalAirNeighbor(data, widthPx, heightPx, xPx, yPx, openAirSidesMask,  0, -1);
      const facesLightW = _isCardinalAirNeighbor(data, widthPx, heightPx, xPx, yPx, openAirSidesMask, -1,  0);
      if (facesLightN || facesLightW) {
        multiplier = Math.min(multiplier + _EDGE_HIGHLIGHT_AMOUNT, 1.0);
      }
    }

    // Apply multiply — darkens the pixel while preserving hue.
    const di = pi * 4;
    data[di]     = Math.round(data[di]     * multiplier);
    data[di + 1] = Math.round(data[di + 1] * multiplier);
    data[di + 2] = Math.round(data[di + 2] * multiplier);
  }

  ctx.putImageData(imageData, 0, 0);
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
  openAirSidesMask: number = OPEN_AIR_ALL_SIDES,
  worldOriginXWorld: number = 0,
  worldOriginYWorld: number = 0,
  seed: number = 0,
): HTMLCanvasElement | null {
  const key = _cacheKey(baseUrl, templateUrl, widthPx, heightPx, flipX, flipY, rotStep, openAirSidesMask, worldOriginXWorld, worldOriginYWorld, seed);
  const cached = _spriteCache.get(key);
  if (cached !== undefined) return cached;

  const base     = _loadImg(baseUrl);
  const template = _loadImg(templateUrl);
  if (!_isReady(base) || !_isReady(template)) return null;

  const result = _generateSprite(base, template, widthPx, heightPx, flipX, flipY, rotStep, openAirSidesMask, worldOriginXWorld, worldOriginYWorld, seed);
  _spriteCache.set(key, result);
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
    const img = _loadImg(probePool[i]);
    if (_isReady(img)) currentReadyCount++;
  }

  const entry = _readyUrlsByPool.get(probePool);
  if (entry !== undefined && entry.readyCount === currentReadyCount) {
    return entry.urls;
  }

  // Rebuild the ready list.
  const urls: string[] = [];
  for (let i = 0; i < probePool.length; i++) {
    if (_isReady(_loadImg(probePool[i]))) urls.push(probePool[i]);
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
  openAirSidesMask: number = OPEN_AIR_ALL_SIDES,
): HTMLCanvasElement | null {
  const pool = getBaseSpriteProbePool(material, false);
  if (pool.length === 0) return null;
  const hash    = hashTilePosition(col, row, seed);
  const baseUrl = _pickFromPool(pool, hash);
  if (baseUrl === null) return null;
  return getProceduralSprite(baseUrl, TEMPLATE_URLS['1x1 block'], blockSizePx, blockSizePx, false, false, 0, openAirSidesMask, col * blockSizePx, row * blockSizePx, seed);
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
): HTMLCanvasElement | null {
  const pool = getBaseSpriteProbePool(material, true);
  if (pool.length === 0) return null;
  const hash    = hashTilePosition(col, row, seed);
  const baseUrl = _pickFromPool(pool, hash);
  if (baseUrl === null) return null;
  const dim = blockSizePx * 2;
  return getProceduralSprite(baseUrl, TEMPLATE_URLS['2x2 block'], dim, dim, false, false, 0, openAirSidesMask, col * blockSizePx, row * blockSizePx, seed);
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
  // Platforms are always at the boundary of solid regions; use all-sides-open default.
  return getProceduralSprite(baseUrl, TEMPLATE_URLS['1x1 platform'], blockSizePx, blockSizePx, flipX, flipY, rotStep, OPEN_AIR_ALL_SIDES, col * blockSizePx, row * blockSizePx, seed);
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
  return getProceduralSprite(baseUrl, TEMPLATE_URLS['2x2 platform'], dim, dim, flipX, flipY, rotStep, OPEN_AIR_ALL_SIDES, col * blockSizePx, row * blockSizePx, seed);
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
  return getProceduralSprite(baseUrl, TEMPLATE_URLS[shapeName], widthPx, heightPx, flipX, flipY, 0, OPEN_AIR_ALL_SIDES, col * blockSizePx, row * blockSizePx, seed);
}
