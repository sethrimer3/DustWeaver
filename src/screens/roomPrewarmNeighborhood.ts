/**
 * roomPrewarmNeighborhood.ts — Pure helper utilities for the render-chunk
 * prewarm scheduler.
 *
 * Extracted from roomRenderChunkWarmScheduler.ts.
 */

import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';

/**
 * BFS from `fromRoomId` across room transitions, returning `[roomId, radius,
 * incomingTransitionIndex]` triples for rooms within `maxRadius` hops.
 *
 * `incomingTransitionIndex` is the index of the transition IN THE CURRENT ROOM
 * that leads to the neighbour (used to compute the entrance viewport).
 * For radius > 1, it's set to -1 (we use the first transition in the neighbour).
 */
export function bfsNearbyRooms(
  fromRoomId: string,
  registry: ReadonlyMap<string, RoomDef>,
  maxRadius: number,
): Array<[string, number, number]> {
  const visited = new Set<string>([fromRoomId]);
  const result: Array<[string, number, number]> = [];
  const queue: Array<[string, number, number]> = [[fromRoomId, 0, -1]];

  while (queue.length > 0) {
    const [currentId, radius, _incomingTransIdx] = queue.shift()!;
    if (radius >= maxRadius) continue;

    const room = registry.get(currentId);
    if (room === undefined) continue;

    for (let ti = 0; ti < room.transitions.length; ti++) {
      const targetId = room.transitions[ti].targetRoomId;
      if (visited.has(targetId)) continue;
      visited.add(targetId);
      // For radius-1 neighbours, record which transition leads to them.
      const transIdx = (radius === 0) ? ti : -1;
      result.push([targetId, radius + 1, transIdx]);
      queue.push([targetId, radius + 1, transIdx]);
    }
  }

  return result;
}

/**
 * Computes the camera offset (virtual pixels) representing the first viewport
 * the player will see when entering a room via `transition`.
 *
 * The resulting `offsetXPx, offsetYPx` are passed to `prewarmWallChunksForRoom`
 * so it prioritises building chunks that will be visible in the first frame.
 */
export function computeEntranceOffset(
  transition: { targetSpawnBlock: readonly [number, number] },
  vpWPx: number,
  vpHPx: number,
  scalePx: number,
): { offsetXPx: number; offsetYPx: number } {
  const [spawnXBlock, spawnYBlock] = transition.targetSpawnBlock;
  const spawnXWorld = spawnXBlock * BLOCK_SIZE_MEDIUM;
  const spawnYWorld = spawnYBlock * BLOCK_SIZE_MEDIUM;
  const offsetXPx   = vpWPx / 2 - spawnXWorld * scalePx;
  const offsetYPx   = vpHPx / 2 - spawnYWorld * scalePx;
  return { offsetXPx, offsetYPx };
}
