/**
 * blockEdgeShading.ts — Shared organic edge-shading post-process for block sprites.
 *
 * This module provides a single entry point, `applyOrganicEdgeShading`, that can be
 * called on any `CanvasRenderingContext2D` after the block sprite has been drawn.
 * It is used by:
 *   • `proceduralBlockSprite.ts` — for procedural (template-masked) sprites.
 *   • `folderBlockThemes.ts`     — for folder-based 8×8 and 16×16 sprites.
 *
 * Algorithm overview
 * ──────────────────
 * Pass 1 — BFS depth + multiply darkening:
 *   1. Compute each solid pixel's Chebyshev distance from open air (BFS, max depth 3px).
 *   2. Look up a base multiply multiplier for that depth (0.70 / 0.82 / 0.92 at strength 1.0).
 *   3. Add centred smooth world-space noise variation (±0.08) for an organic look.
 *   4. Apply a corner boost (−0.05) when ≥ 2 cardinal neighbours are open air (inner corner).
 *   5. Apply a rim highlight (+0.07) on depth-0 pixels facing N or W (top-left light).
 *   6. Scale the shading intensity by `EDGE_SHADING_STRENGTH` (1.0 = default; raise for
 *      stronger visibility on dark sprites — useful for tuning and debugging).
 *   7. Multiply the pixel's RGB channels by the final multiplier.
 *
 * Pass 2 — outer-corner overlay:
 *   Pixels that are solid but have no cardinal air neighbours and at least one
 *   diagonal air neighbour sit at an outer (convex) corner.  A subtle extra
 *   darkening is applied there so both inner and outer corners receive treatment.
 *
 * Seamlessness guarantee
 * ──────────────────────
 * The noise uses world-space coordinates, not canvas-local ones, so the shading
 * is seamless across tile boundaries: adjacent blocks sharing a material produce
 * matching noise gradients at their shared edge.
 *
 * Seam suppression
 * ────────────────
 * `openAirSidesMask` controls which canvas borders are treated as open air.
 * Sides whose bit is NOT set are solid-neighbour boundaries; no shading is
 * applied toward those sides, preventing dark seams between adjacent same-material
 * blocks.  Different-material boundary dithering is not implemented here because
 * the neighbour material is not available at this level.
 *
 * Baked-canvas invalidation
 * ─────────────────────────
 * The processed sprite canvases are cached in-memory.  Because shading constants
 * are compile-time values, any change to them requires a rebuild, which clears all
 * in-memory caches automatically.
 */

// ── Open-air side mask constants ──────────────────────────────────────────────

/**
 * Bit mask for open-air sides of a block sprite canvas.
 * Bit 0 = North (y=0 border), Bit 1 = East (x=widthPx-1 border),
 * Bit 2 = South (y=heightPx-1 border), Bit 3 = West (x=0 border).
 * A set bit means that border is exposed to air (no solid block neighbour on that side).
 * Pass 0xF to treat all four canvas borders as open air (default / ramp / platform).
 */
export const OPEN_AIR_SIDE_N = 1;
export const OPEN_AIR_SIDE_E = 2;
export const OPEN_AIR_SIDE_S = 4;
export const OPEN_AIR_SIDE_W = 8;
/** All four borders exposed to air — use for ramps, platforms, and isolated blocks. */
export const OPEN_AIR_ALL_SIDES = 0xF;

// ── Tuning constant ───────────────────────────────────────────────────────────

/**
 * Global strength multiplier for edge shading.
 *
 * At 1.0 (default) the shading uses the calibrated constants below.
 * Increase toward 2.0 to make the effect more visible on dark sprites
 * (useful for tuning and debugging).  Set below 1.0 to soften the effect.
 *
 * Formula: effectiveMultiplier = 1.0 − (1.0 − baseMultiplier) × EDGE_SHADING_STRENGTH
 */
export const EDGE_SHADING_STRENGTH = 1.2;

// ── Internal shading constants ────────────────────────────────────────────────

const _OPEN_AIR_EDGE_DISTANCE_NONE = 255;
/** Max internal BFS depth (0-indexed). Depths 0..2 map to spec distances 1..3. */
const _OPEN_AIR_FILTER_MAX_DISTANCE_PX = 2;

/** Base multiply multiplier per internal depth (before EDGE_SHADING_STRENGTH scaling). */
const _EDGE_BASE_MULTIPLIER = [0.70, 0.82, 0.92] as const;
/** Minimum multiplier per depth — clamps the darkest allowed shade at each level. */
const _EDGE_CLAMP_MIN       = [0.65, 0.78, 0.88] as const;
/** Maximum multiplier per depth — prevents a shallower depth from exceeding a deeper one. */
const _EDGE_CLAMP_MAX       = [0.78, 0.88, 0.96] as const;
/** Noise-coordinate scale (noise-grid-units per world pixel). */
const _EDGE_NOISE_SCALE     = 0.15;
/** Amplitude of centred noise variation (+/−). */
const _EDGE_VARIATION_STR   = 0.08;
/** Extra darkening for depth-0 pixels with ≥ 2 open-air cardinal neighbours (inner corner). */
const _EDGE_INNER_CORNER_BOOST = -0.08;
/** Subtle darkening for outer-corner pixels (diagonal-air only, no cardinal-air). */
const _EDGE_OUTER_CORNER_DARKEN = 0.95;
/** Additive highlight for outermost (depth-0) pixels exposed toward the top-left light. */
const _EDGE_HIGHLIGHT_AMOUNT = 0.07;

// ── Smooth value noise (deterministic world-space) ────────────────────────────

/**
 * Hashes integer grid coordinates to a float in [0, 1].
 * Used as the corner values for 2-D bilinear value noise.
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
 * Continuous across all real (x, y) — no tile-edge seams.
 * Input coordinates are in noise-grid units; use a small scale (e.g. 0.15)
 * so adjacent world pixels produce very similar values.
 */
function _smoothNoise2d(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  // Smoothstep interpolation weights — eliminates visible derivative discontinuity.
  const ux = fx * fx * (3.0 - 2.0 * fx);
  const uy = fy * fy * (3.0 - 2.0 * fy);
  const a = _hashNoiseCorner(ix,     iy,     seed);
  const b = _hashNoiseCorner(ix + 1, iy,     seed);
  const c = _hashNoiseCorner(ix,     iy + 1, seed);
  const d = _hashNoiseCorner(ix + 1, iy + 1, seed);
  return a + ux * (b - a) + uy * (c - a) + ux * uy * (a - b - c + d);
}

// ── Pixel neighbourhood helpers ───────────────────────────────────────────────

/**
 * Returns true when pixel (xPx, yPx) has at least one open-air neighbour in
 * any of the 8 directions (orthogonal + diagonal).
 *
 * Open air means:
 *   – Transparent interior pixel (alpha 0).
 *   – Canvas border on a side flagged in openAirSidesMask.
 *     For diagonal-border positions either adjacent cardinal side suffices.
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
 * Returns true when the diagonal neighbour at (xPx+dx, yPx+dy)
 * — where |dx|=|dy|=1 — is open air.
 * Used in pass 2 to detect outer corners.
 */
function _hasDiagonalAirNeighbor(
  data: Uint8ClampedArray,
  widthPx: number,
  heightPx: number,
  xPx: number,
  yPx: number,
  openAirSidesMask: number,
): boolean {
  for (let dy = -1; dy <= 1; dy += 2) {
    for (let dx = -1; dx <= 1; dx += 2) {
      const nx = xPx + dx;
      const ny = yPx + dy;
      // Diagonal neighbour landing outside the canvas is air only if
      // BOTH adjacent cardinal sides are open-air.
      if (nx < 0 && ny < 0)           { if ((openAirSidesMask & OPEN_AIR_SIDE_W) && (openAirSidesMask & OPEN_AIR_SIDE_N)) return true; continue; }
      if (nx >= widthPx && ny < 0)    { if ((openAirSidesMask & OPEN_AIR_SIDE_E) && (openAirSidesMask & OPEN_AIR_SIDE_N)) return true; continue; }
      if (nx < 0 && ny >= heightPx)   { if ((openAirSidesMask & OPEN_AIR_SIDE_W) && (openAirSidesMask & OPEN_AIR_SIDE_S)) return true; continue; }
      if (nx >= widthPx && ny >= heightPx) { if ((openAirSidesMask & OPEN_AIR_SIDE_E) && (openAirSidesMask & OPEN_AIR_SIDE_S)) return true; continue; }
      if (nx < 0)         { if (openAirSidesMask & OPEN_AIR_SIDE_W) return true; continue; }
      if (nx >= widthPx)  { if (openAirSidesMask & OPEN_AIR_SIDE_E) return true; continue; }
      if (ny < 0)         { if (openAirSidesMask & OPEN_AIR_SIDE_N) return true; continue; }
      if (ny >= heightPx) { if (openAirSidesMask & OPEN_AIR_SIDE_S) return true; continue; }
      if (data[(ny * widthPx + nx) * 4 + 3] === 0) return true;
    }
  }
  return false;
}

/**
 * Returns true when the cardinal neighbour of (xPx, yPx) in direction (dx, dy)
 * — where exactly one of dx/dy is ±1 and the other is 0 — is open air.
 *
 * Open air = transparent pixel (alpha 0) or canvas border flagged in openAirSidesMask.
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
 * A count ≥ 2 identifies an inner-corner pixel (two exposed faces meeting).
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

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Applies organic edge shading to a block sprite already drawn on `ctx`.
 *
 * The function reads pixel data, performs a two-pass shading operation (BFS
 * depth darkening + outer-corner overlay), and writes the result back.
 * All shading is multiply-based so hue is preserved.
 *
 * @param ctx                  The 2D rendering context containing the sprite.
 * @param widthPx              Canvas width in pixels.
 * @param heightPx             Canvas height in pixels.
 * @param openAirSidesMask     Bitmask of sides exposed to air (use OPEN_AIR_SIDE_* constants).
 *                             A set bit means that canvas border has no solid block neighbour,
 *                             so shading is applied toward it.  Unset bits suppress shading
 *                             on solid-neighbour sides, preventing dark seams.
 * @param worldOriginXWorld    World-unit X coordinate of the sprite's top-left pixel.
 *                             Used for seamless noise across block boundaries.
 * @param worldOriginYWorld    World-unit Y coordinate of the sprite's top-left pixel.
 * @param seed                 World/room seed for noise variety between worlds.
 */
export function applyOrganicEdgeShading(
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

  // ── Pass 1: BFS depth computation ─────────────────────────────────────────

  const distBuf = new Uint8Array(pixelCount);
  distBuf.fill(_OPEN_AIR_EDGE_DISTANCE_NONE);

  // One slot per pixel is sufficient — each pixel enters the queue at most once.
  const queue = new Uint16Array(pixelCount);
  let qHead = 0;
  let qCount = 0;

  // Seed: all solid pixels with any 8-connected air neighbour → depth 0.
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
    if (d >= _OPEN_AIR_FILTER_MAX_DISTANCE_PX) continue;

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
        if (data[npi * 4 + 3] === 0) continue; // air pixel
        if (distBuf[npi] <= nd) continue;       // already at equal or shorter distance
        distBuf[npi] = nd;
        queue[qCount++] = npi;
      }
    }
  }

  // ── Pass 1: multiply-based darkening + rim highlight ──────────────────────

  for (let pi = 0; pi < pixelCount; pi++) {
    const d = distBuf[pi];
    if (d > _OPEN_AIR_FILTER_MAX_DISTANCE_PX) continue; // beyond shading range

    const xPx = pi % widthPx;
    const yPx = (pi / widthPx) | 0;

    // Smooth world-space noise variation centred at 0.
    const worldX = worldOriginXWorld + xPx;
    const worldY = worldOriginYWorld + yPx;
    const noiseVal = _smoothNoise2d(worldX * _EDGE_NOISE_SCALE, worldY * _EDGE_NOISE_SCALE, seed);
    const variation = (noiseVal * 2.0 - 1.0) * _EDGE_VARIATION_STR;

    // Base multiplier with noise variation.
    let rawMultiplier = _EDGE_BASE_MULTIPLIER[d] + variation;

    // Inner-corner boost: stronger darkening for pixels with ≥ 2 cardinal air neighbours.
    const airNeighborCount = _countCardinalAirNeighbors(data, widthPx, heightPx, xPx, yPx, openAirSidesMask);
    if (airNeighborCount >= 2) {
      rawMultiplier += _EDGE_INNER_CORNER_BOOST;
    }

    // Clamp to the allowed range for this depth.
    const cMin = _EDGE_CLAMP_MIN[d];
    const cMax = _EDGE_CLAMP_MAX[d];
    if (rawMultiplier < cMin) rawMultiplier = cMin;
    if (rawMultiplier > cMax) rawMultiplier = cMax;

    // Rim highlight for outermost (depth-0) pixels facing N or W (top-left light).
    if (d === 0) {
      const facesLightN = _isCardinalAirNeighbor(data, widthPx, heightPx, xPx, yPx, openAirSidesMask,  0, -1);
      const facesLightW = _isCardinalAirNeighbor(data, widthPx, heightPx, xPx, yPx, openAirSidesMask, -1,  0);
      if (facesLightN || facesLightW) {
        rawMultiplier = Math.min(rawMultiplier + _EDGE_HIGHLIGHT_AMOUNT, 1.0);
      }
    }

    // Scale the shading intensity by EDGE_SHADING_STRENGTH.
    // effectiveMultiplier = 1.0 − (1.0 − rawMultiplier) × EDGE_SHADING_STRENGTH
    let multiplier = 1.0 - (1.0 - rawMultiplier) * EDGE_SHADING_STRENGTH;
    if (multiplier < 0.0) multiplier = 0.0;

    const di = pi * 4;
    data[di]     = Math.round(data[di]     * multiplier);
    data[di + 1] = Math.round(data[di + 1] * multiplier);
    data[di + 2] = Math.round(data[di + 2] * multiplier);
  }

  // ── Pass 2: outer-corner overlay ─────────────────────────────────────────
  //
  // Pixels that are solid, have no cardinal air neighbours (so they are inside
  // the shape relative to any open side), but have at least one diagonal air
  // neighbour sit at a convex outer corner.  A subtle extra darkening is applied
  // there so corners look naturally recessed even without being on the shaded edge.

  for (let pi = 0; pi < pixelCount; pi++) {
    if (data[pi * 4 + 3] === 0) continue; // air — skip

    const xPx = pi % widthPx;
    const yPx = (pi / widthPx) | 0;

    // Only applies to pixels not already shaded by pass 1.
    if (distBuf[pi] <= _OPEN_AIR_FILTER_MAX_DISTANCE_PX) continue;

    // No cardinal air neighbours but at least one diagonal air neighbour → outer corner.
    if (_countCardinalAirNeighbors(data, widthPx, heightPx, xPx, yPx, openAirSidesMask) > 0) continue;
    if (!_hasDiagonalAirNeighbor(data, widthPx, heightPx, xPx, yPx, openAirSidesMask)) continue;

    const di = pi * 4;
    data[di]     = Math.round(data[di]     * _EDGE_OUTER_CORNER_DARKEN);
    data[di + 1] = Math.round(data[di + 1] * _EDGE_OUTER_CORNER_DARKEN);
    data[di + 2] = Math.round(data[di + 2] * _EDGE_OUTER_CORNER_DARKEN);
  }

  ctx.putImageData(imageData, 0, 0);
}
