/**
 * timeStopFieldBuilder.ts — TimeStop Field Connectivity (BFS).
 *
 * Mirrors the shape of `render/liquidBodyBuilder.ts` (tile expansion + BFS
 * connected components) but lives in sim/ because the result — "which
 * connected region, if any, is the player standing in" — is gameplay state,
 * not just a rendering concern. The render-side geometry (rounded Path2D) is
 * built separately from `region.tileSet`, in render/timeStopFieldRenderer.ts,
 * so this module has no canvas/rendering dependency.
 *
 * Orthogonal (4-connected) adjacency is used, matching the liquid-body
 * connectivity convention already established for water/lava.
 */

import type { WorldState } from '../world';
import { BLOCK_SIZE_MEDIUM } from '../../levels/roomDef';

/** One connected group of adjacent TimeStop Field tiles. */
export interface TimeStopFieldRegion {
  /** Stable-for-this-cache-generation index into TimeStopFieldRegionSet.regions. */
  readonly id: number;
  /** Tile set for O(1) neighbour lookup (encoded keys — see encodeTileKey). */
  readonly tileSet: ReadonlySet<number>;
  readonly tileCount: number;
  readonly minXWorld: number;
  readonly maxXWorld: number;
  readonly minYWorld: number;
  readonly maxYWorld: number;
}

/** All connected TimeStop Field regions in the current room, plus a fast point→region lookup. */
export interface TimeStopFieldRegionSet {
  readonly regions: readonly TimeStopFieldRegion[];
  /** Encoded tile key → index into `regions`. Absent keys are not part of any field. */
  readonly tileToRegion: ReadonlyMap<number, number>;
}

const EMPTY_REGION_SET: TimeStopFieldRegionSet = { regions: [], tileToRegion: new Map() };

/** Packs a (gridX, gridY) pair into a single integer key. Supports ±4095 per axis. */
export function encodeTimeStopTileKey(gx: number, gy: number): number {
  return (gx + 4096) * 8192 + (gy + 4096);
}

function decodeGX(key: number): number {
  return Math.floor(key / 8192) - 4096;
}

function decodeGY(key: number): number {
  return (key % 8192) - 4096;
}

/** Decodes an encoded tile key (see encodeTimeStopTileKey) back to grid coordinates. */
export function decodeTimeStopTileKey(key: number): { gx: number; gy: number } {
  return { gx: decodeGX(key), gy: decodeGY(key) };
}

/**
 * Converts a player world-space position to the grid cell used for region
 * membership tests. Shared by the builder's own tile expansion and by the
 * runtime player-state tracker so both agree on the exact same grid.
 */
export function worldToTimeStopGrid(xWorld: number, yWorld: number): { gx: number; gy: number } {
  return { gx: Math.floor(xWorld / BLOCK_SIZE_MEDIUM), gy: Math.floor(yWorld / BLOCK_SIZE_MEDIUM) };
}

/**
 * Builds all connected TimeStop Field regions from the room's currently
 * loaded tile placements (`world.timeStopField*` arrays, populated once at
 * room load by gameRoomHazards.ts). Allocates fresh — acceptable because
 * rebuilds only happen on room load/edit, never in the per-tick hot path
 * (see timeStopFieldCache.ts).
 */
export function buildTimeStopFieldRegions(world: WorldState): TimeStopFieldRegionSet {
  const count = world.timeStopFieldCount;
  if (count === 0) return EMPTY_REGION_SET;

  const B = BLOCK_SIZE_MEDIUM;
  const tileSet = new Set<number>();
  for (let i = 0; i < count; i++) {
    const gx0 = Math.round(world.timeStopFieldXWorld[i] / B);
    const gy0 = Math.round(world.timeStopFieldYWorld[i] / B);
    const gx1 = Math.round((world.timeStopFieldXWorld[i] + world.timeStopFieldWWorld[i]) / B);
    const gy1 = Math.round((world.timeStopFieldYWorld[i] + world.timeStopFieldHWorld[i]) / B);
    for (let gy = gy0; gy < gy1; gy++) {
      for (let gx = gx0; gx < gx1; gx++) {
        tileSet.add(encodeTimeStopTileKey(gx, gy));
      }
    }
  }
  if (tileSet.size === 0) return EMPTY_REGION_SET;

  const regions: TimeStopFieldRegion[] = [];
  const tileToRegion = new Map<number, number>();
  const visited = new Set<number>();

  for (const startKey of tileSet) {
    if (visited.has(startKey)) continue;

    const componentKeys: number[] = [];
    const queue: number[] = [startKey];
    visited.add(startKey);
    let qHead = 0;

    while (qHead < queue.length) {
      const key = queue[qHead++];
      componentKeys.push(key);
      const gx = decodeGX(key);
      const gy = decodeGY(key);
      const neighbours = [
        encodeTimeStopTileKey(gx - 1, gy),
        encodeTimeStopTileKey(gx + 1, gy),
        encodeTimeStopTileKey(gx, gy - 1),
        encodeTimeStopTileKey(gx, gy + 1),
      ];
      for (const nk of neighbours) {
        if (tileSet.has(nk) && !visited.has(nk)) {
          visited.add(nk);
          queue.push(nk);
        }
      }
    }

    let minGX = Infinity, maxGX = -Infinity, minGY = Infinity, maxGY = -Infinity;
    for (const k of componentKeys) {
      const gx = decodeGX(k);
      const gy = decodeGY(k);
      if (gx < minGX) minGX = gx;
      if (gx > maxGX) maxGX = gx;
      if (gy < minGY) minGY = gy;
      if (gy > maxGY) maxGY = gy;
    }

    const regionId = regions.length;
    regions.push({
      id: regionId,
      tileSet: new Set(componentKeys),
      tileCount: componentKeys.length,
      minXWorld: minGX * B,
      maxXWorld: (maxGX + 1) * B,
      minYWorld: minGY * B,
      maxYWorld: (maxGY + 1) * B,
    });
    for (const k of componentKeys) tileToRegion.set(k, regionId);
  }

  return { regions, tileToRegion };
}
