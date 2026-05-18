/**
 * roomPreloadScheduler.ts — Idle-time BFS preloader for nearby rooms.
 *
 * Triggered after every room load via `scheduleRoomPreloads()`.  Performs a
 * BFS from the current room through `RoomDef.transitions` and schedules
 * precomputation of each nearby room's `RoomWallTemplate` and
 * `EdgeExtensionCache` so that room transitions can skip the expensive build
 * pass entirely.
 *
 * Priority model:
 *  - Radius-1 rooms (directly connected): enqueued first.
 *  - Radius-2 rooms (one hop further): enqueued second.
 *  - Rooms already in the cache are skipped (idempotent).
 *
 * Scheduling:
 *  - Uses `requestIdleCallback` when available (Chromium/Edge).
 *  - Falls back to `setTimeout(0)` on Safari/Firefox where rIC is absent.
 *  - Each callback processes at most one room to keep idle slices short.
 *
 * This module also expands sprite preloading from radius-1 to radius-2 so
 * image assets are ready when the player arrives.
 *
 * BUILD 357
 */

import type { RoomDef } from '../levels/roomDef';
import { buildRoomWallTemplate } from './gameRoomWalls';
import { buildEdgeExtensionCache } from '../render/transitions/edgeExtensionCache';
import { preloadRoomThemeSprites } from '../render/roomAssetPreloader';
import type { RoomRuntimeCache } from './roomRuntimeCache';

// ── Idle scheduling shim ──────────────────────────────────────────────────────

/** Cross-browser idle callback type. */
type IdleCallbackHandle = number;

function scheduleIdle(callback: () => void): IdleCallbackHandle {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(callback, { timeout: 500 });
  }
  return setTimeout(callback, 0) as unknown as IdleCallbackHandle;
}

function cancelIdle(handle: IdleCallbackHandle): void {
  if (typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(handle);
  } else {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  }
}

// ── BFS helpers ───────────────────────────────────────────────────────────────

/**
 * Collects room IDs within `maxRadius` hops of `fromRoomId` in BFS order.
 * Returns an array of `[roomId, radius]` pairs, ordered by radius then by
 * the order transitions appear in the room definition.  The source room
 * (radius 0) is excluded.
 */
function _bfsNearbyRooms(
  fromRoomId: string,
  roomRegistry: ReadonlyMap<string, RoomDef>,
  maxRadius: number,
): Array<[string, number]> {
  const visited = new Set<string>([fromRoomId]);
  const result: Array<[string, number]> = [];
  const queue: Array<[string, number]> = [[fromRoomId, 0]];

  while (queue.length > 0) {
    const [currentId, radius] = queue.shift()!;
    if (radius >= maxRadius) continue;

    const room = roomRegistry.get(currentId);
    if (room === undefined) continue;

    for (let ti = 0; ti < room.transitions.length; ti++) {
      const targetId = room.transitions[ti].targetRoomId;
      if (visited.has(targetId)) continue;
      visited.add(targetId);
      result.push([targetId, radius + 1]);
      queue.push([targetId, radius + 1]);
    }
  }

  return result;
}

// ── RoomPreloadScheduler ──────────────────────────────────────────────────────

/** Opaque handle returned by `scheduleRoomPreloads` so callers can cancel. */
export interface PreloadScheduleHandle {
  cancel(): void;
}

/**
 * Schedules precomputation of `RoomWallTemplate` + `EdgeExtensionCache` for
 * all rooms within 2 hops of `currentRoom`.
 *
 * Returns a handle so the caller can cancel the scheduled work when a new
 * room transition fires before the previous schedule completes.  (Cancellation
 * is best-effort; already-running callbacks cannot be stopped.)
 *
 * Idempotent: rooms already present in `cache` are silently skipped.
 */
export function scheduleRoomPreloads(
  currentRoom: RoomDef,
  roomRegistry: ReadonlyMap<string, RoomDef>,
  cache: RoomRuntimeCache,
  isDebugMode = false,
): PreloadScheduleHandle {
  const nearby = _bfsNearbyRooms(currentRoom.id, roomRegistry, 2);

  // Separate into radius-1 (urgent) and radius-2 (background) queues.
  const radius1: string[] = [];
  const radius2: string[] = [];
  for (const [id, radius] of nearby) {
    if (radius === 1) radius1.push(id);
    else radius2.push(id);
  }

  // Preload sprites for all nearby rooms (fire-and-forget; imageCache deduplicates).
  for (let i = 0; i < radius1.length; i++) {
    const r = roomRegistry.get(radius1[i]);
    if (r !== undefined) preloadRoomThemeSprites(r);
  }
  for (let i = 0; i < radius2.length; i++) {
    const r = roomRegistry.get(radius2[i]);
    if (r !== undefined) preloadRoomThemeSprites(r);
  }

  // Work queue: radius-1 rooms first, then radius-2.
  const workQueue: string[] = [...radius1, ...radius2];

  let activeHandle: IdleCallbackHandle | null = null;
  let isCancelled = false;

  function processNext(): void {
    if (isCancelled) return;

    // Skip rooms already cached.
    while (workQueue.length > 0 && cache.has(workQueue[0])) {
      workQueue.shift();
    }
    if (workQueue.length === 0) return;

    const roomId = workQueue.shift()!;
    const room = roomRegistry.get(roomId);
    if (room !== undefined && !cache.has(roomId)) {
      const t0 = performance.now();
      const wallTemplate = buildRoomWallTemplate(room);
      const wallMs = performance.now() - t0;

      const t1 = performance.now();
      const edgeExtension = buildEdgeExtensionCache(room);
      const edgeMs = performance.now() - t1;

      cache.set(roomId, { wallTemplate, edgeExtension });

      if (isDebugMode) {
        console.log(
          `[preload] ${roomId} wallTemplate=${wallMs.toFixed(1)}ms` +
          ` edge=${edgeMs.toFixed(1)}ms (cache size=${cache.size})`,
        );
      }
    }

    // Schedule the next room if there's more work.
    if (workQueue.length > 0) {
      activeHandle = scheduleIdle(processNext);
    } else {
      activeHandle = null;
    }
  }

  // Kick off with the first idle slot.
  if (workQueue.length > 0) {
    activeHandle = scheduleIdle(processNext);
  }

  return {
    cancel(): void {
      isCancelled = true;
      if (activeHandle !== null) {
        cancelIdle(activeHandle);
        activeHandle = null;
      }
    },
  };
}
