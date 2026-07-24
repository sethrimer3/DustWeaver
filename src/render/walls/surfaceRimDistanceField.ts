/**
 * surfaceRimDistanceField.ts — Per-tile "distance to nearest exposed edge"
 * field for the Surface Rim 'inverted' mode's interior darkening.
 *
 * Computed once per wall-layout rebuild (see blockWallLayoutCache.ts) via a
 * cheap multi-source BFS over the room's solid tile grid — NOT a per-frame or
 * per-pixel scan. Seeds are every tile with at least one exposed cardinal
 * side (depth 0 — the rim itself, already drawn by the existing edge-band
 * pass); the BFS expands outward through solid neighbours, so a tile's
 * distance is the number of solid-tile steps to the nearest exposed tile.
 *
 * Tiles unreachable from any exposed tile (a fully sealed interior pocket,
 * walled off on all sides by other solid tiles with no path to open air)
 * are simply absent from the returned map — callers should treat a missing
 * entry as "at least as dark as the configured max distance", since such a
 * tile is, by definition, further from any edge than anything the BFS did
 * reach.
 */

import type { SurfaceMask } from '../../sim/world/surfaceExposure';

/** Returns the string key for a tile grid coordinate — mirrors blockWallLayoutCache.ts's wallTileKey. */
function _tileKey(col: number, row: number): string {
  return `${col},${row}`;
}

const _NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
];

/**
 * Builds the interior distance field for one wall layout.
 *
 * @param occupied Every solid 1×1 tile key in the room (same `occupied` set
 *   `blockWallLayoutCache.ts` already builds from wall AABBs).
 * @param masks    `SurfaceExposureMap.masks` — tiles with ≥1 exposed cardinal
 *   side, the BFS seed set (distance 0).
 */
export function buildInteriorRimDistanceField(
  occupied: ReadonlySet<string>,
  masks: ReadonlyMap<string, SurfaceMask>,
): Map<string, number> {
  const distance = new Map<string, number>();
  const queue: Array<[number, number]> = [];

  for (const key of masks.keys()) {
    distance.set(key, 0);
    const commaIdx = key.indexOf(',');
    queue.push([parseInt(key.slice(0, commaIdx), 10), parseInt(key.slice(commaIdx + 1), 10)]);
  }

  let head = 0;
  while (head < queue.length) {
    const [col, row] = queue[head++];
    const d = distance.get(_tileKey(col, row))!;
    for (const [dx, dy] of _NEIGHBOR_OFFSETS) {
      const ncol = col + dx;
      const nrow = row + dy;
      const nkey = _tileKey(ncol, nrow);
      if (distance.has(nkey) || !occupied.has(nkey)) continue;
      distance.set(nkey, d + 1);
      queue.push([ncol, nrow]);
    }
  }

  return distance;
}
