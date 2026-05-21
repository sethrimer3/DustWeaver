/**
 * roomPreloadScheduler.ts — Idle-time BFS preloader for nearby rooms.
 *
 * Triggered after every room load via `scheduleRoomPreloads()`.  Performs a
 * BFS from the current room through `RoomDef.transitions` and schedules
 * precomputation of each nearby room's `RoomWallTemplate` and
 * `EdgeExtensionCache` so that room transitions can skip the expensive build
 * pass entirely.
 *
 * When `loadRoomAsync` is provided (Electron file-cache mode), the scheduler
 * also loads room DATA for adjacent rooms that are not yet in ROOM_REGISTRY.
 * This is the core of the lazy-loading strategy:
 *   1. The start room is loaded at startup.
 *   2. This scheduler fires and discovers adjacent rooms (via transitions).
 *   3. For rooms not in the registry, `loadRoomAsync` fetches them from the
 *      derived room file and registers them.
 *   4. On the next idle callback the room is in the registry and wall templates
 *      are built, completing preparation.
 *
 * Priority model:
 *  - Radius-1 rooms (directly connected): enqueued first.
 *  - Radius-2 rooms (one hop further): enqueued second.
 *  - Rooms already in the cache are skipped (idempotent).
 *  - `handle.prioritize(roomId)` moves a room to the front of the queue
 *    (called when the player approaches a transition boundary).
 *
 * Scheduling:
 *  - Uses `requestIdleCallback` when available (Chromium/Edge).
 *  - Falls back to `setTimeout(0)` on Safari/Firefox where rIC is absent.
 *  - Each callback processes at most one room to keep idle slices short.
 *  - Deadline time-budgeting: each callback checks `timeRemaining()` before
 *    starting a build so that callbacks forced by the timeout do not run
 *    during an active animation frame (unless `didTimeout` is true after the
 *    `IDLE_TIMEOUT_MS` deadline expires, in which case we run but log a warn).
 *
 * This module also expands sprite preloading from radius-1 to radius-2 so
 * image assets are ready when the player arrives.
 *
 * BUILD 382
 */

import type { RoomDef } from '../levels/roomDef';
import { buildPreparedRoomRuntime } from './preparedRoomRuntime';
import { preloadRoomThemeSprites } from '../render/roomAssetPreloader';
import type { RoomRuntimeCache } from './roomRuntimeCache';
import { isEntryFullyPrepared } from './roomRuntimeCache';

// ── Timing constants ──────────────────────────────────────────────────────────

/**
 * Minimum milliseconds of idle budget required before starting a room build.
 * If the deadline reports less than this, the callback reschedules rather than
 * risking a long task inside an animation frame.  20 ms gives enough headroom
 * for a typical room build without cutting into active frame time.
 */
const MIN_IDLE_BUDGET_MS = 20;

/**
 * Timeout passed to `requestIdleCallback`.  After this many ms without a
 * genuine idle slot, the browser forces the callback to run.  Using 4000 ms
 * instead of the old 500 ms greatly reduces the chance of a forced callback
 * firing during an active animation frame.
 */
const IDLE_TIMEOUT_MS = 4000;

/**
 * Dev-mode threshold (ms) above which a single room build is logged as a
 * slow task on the main thread.
 */
const LONG_TASK_WARN_MS = 16;

// ── Idle scheduling shim ──────────────────────────────────────────────────────

/** Cross-browser idle callback type. */
type IdleCallbackHandle = number;

/**
 * Minimal subset of the W3C `IdleDeadline` interface we need for time-
 * budgeting.  Defined locally so the file compiles without a separate `@types`
 * package for the Idle Detection API.
 */
interface IdleDeadline {
  timeRemaining(): number;
  readonly didTimeout: boolean;
}

type IdleBudgetCallback = (deadline: IdleDeadline) => void;

function scheduleIdle(callback: IdleBudgetCallback): IdleCallbackHandle {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(callback as IdleRequestCallback, { timeout: IDLE_TIMEOUT_MS });
  }
  // setTimeout fallback: the callback runs in its own task, giving it full
  // frame budget.  Pass a fake deadline with generous remaining time.
  return setTimeout(
    () => callback({ timeRemaining: () => 50, didTimeout: false }),
    0,
  ) as unknown as IdleCallbackHandle;
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
 *
 * NOTE: BFS can only follow transitions from rooms already present in
 * `roomRegistry`.  Rooms not yet loaded (e.g. in lazy-load mode) are not
 * reachable via BFS because their `transitions` array is unavailable.
 * The preload scheduler handles this by re-scheduling after each room loads.
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

/** Handle returned by `scheduleRoomPreloads`. */
export interface PreloadScheduleHandle {
  /**
   * Cancels all pending preload work for this schedule.
   * Already-running callbacks cannot be stopped (best-effort).
   */
  cancel(): void;
  /**
   * Moves `roomId` to the front of the preload queue so it is built in the
   * next available idle slot.  Call this when the player approaches a
   * transition boundary to maximise the chance the room is ready before the
   * crossing fires.
   *
   * Idempotent: no-op if the room is already fully cached or already at the
   * front of the queue.
   */
  prioritize(roomId: string): void;
}

/**
 * Schedules precomputation of `RoomWallTemplate` + `EdgeExtensionCache` for
 * all rooms within 2 hops of `currentRoom`.
 *
 * When `loadRoomAsync` is supplied (Electron file-cache mode), the scheduler
 * also loads room DATA for adjacent rooms that are not yet in `roomRegistry`.
 * This is the mechanism by which gameplay lazy-loads rooms without requiring
 * all rooms to be in memory at startup:
 *   - After loading the start room, `scheduleRoomPreloads` is called.
 *   - BFS discovers the start room's neighbours (radius-1).
 *   - For each neighbour not in the registry, `loadRoomAsync` is called
 *     (fire-and-forget).  When it resolves, the room is registered and
 *     the scheduler will build its wall templates on the next idle tick.
 *   - The same process repeats after each room transition.
 *
 * Returns a handle so the caller can cancel the scheduled work when a new
 * room transition fires before the previous schedule completes.  (Cancellation
 * is best-effort; already-running callbacks cannot be stopped.)
 *
 * Idempotent: rooms already present in `cache` are silently skipped.
 *
 * @param loadRoomAsync  Optional async callback for loading room data that is
 *                       not yet in `roomRegistry`.  Should be
 *                       `loadRoomForGameplayAsync` from `roomFileLoader.ts`.
 *                       When absent (browser mode or packed-campaign mode),
 *                       rooms not in the registry are silently skipped.
 */
export function scheduleRoomPreloads(
  currentRoom: RoomDef,
  roomRegistry: ReadonlyMap<string, RoomDef>,
  cache: RoomRuntimeCache,
  isDebugMode = false,
  loadRoomAsync?: (roomId: string) => Promise<RoomDef | undefined>,
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
  // Set mirror for O(1) membership checks — kept in sync with workQueue.
  const workQueueSet = new Set<string>(workQueue);

  let activeHandle: IdleCallbackHandle | null = null;
  let isCancelled = false;

  function processNext(deadline: IdleDeadline): void {
    if (isCancelled) return;

    // If the idle slot has very little remaining time AND the callback was not
    // forced by the timeout, reschedule rather than starting a potentially
    // expensive build inside an active animation frame.
    if (deadline.timeRemaining() < MIN_IDLE_BUDGET_MS && !deadline.didTimeout) {
      activeHandle = scheduleIdle(processNext);
      return;
    }

    if (deadline.didTimeout && import.meta.env.DEV) {
      console.warn(
        `[preload] idle callback forced after ${IDLE_TIMEOUT_MS}ms timeout ` +
        `(timeRemaining=${deadline.timeRemaining().toFixed(1)}ms). ` +
        `This may cause a long task on the main thread.`,
      );
    }

    // Skip rooms already fully cached.
    while (workQueue.length > 0) {
      const frontEntry = cache.has(workQueue[0]) ? cache.get(workQueue[0]) : undefined;
      if (frontEntry !== undefined && isEntryFullyPrepared(frontEntry)) {
        workQueueSet.delete(workQueue[0]);
        workQueue.shift();
      } else {
        break;
      }
    }
    if (workQueue.length === 0) return;

    const roomId = workQueue.shift()!;
    workQueueSet.delete(roomId);
    const room = roomRegistry.get(roomId);

    // ── Lazy room data loading ─────────────────────────────────────────────
    // When the room is not yet in the registry (lazy-loading mode), trigger
    // an async data load.  Once the Promise resolves the room will be in
    // ROOM_REGISTRY and the next idle callback will build its wall templates.
    // We re-add the roomId to the back of the workQueue so it is processed
    // again after the data arrives.
    if (room === undefined) {
      if (loadRoomAsync !== undefined) {
        if (isDebugMode) {
          console.log(`[preload] ${roomId}: not in registry — triggering lazy data load.`);
        }
        void loadRoomAsync(roomId).then(loaded => {
          if (loaded !== undefined) {
            // Room data is now in ROOM_REGISTRY.
            // Re-add to workQueue if not already there and not yet cached.
            if (!isCancelled) {
              const alreadyCached = cache.get(roomId);
              if (alreadyCached === undefined || !isEntryFullyPrepared(alreadyCached)) {
                if (!workQueueSet.has(roomId)) {
                  workQueue.push(roomId);
                  workQueueSet.add(roomId);
                }
                if (activeHandle === null) {
                  activeHandle = scheduleIdle(processNext);
                }
              }
            }
          } else if (isDebugMode) {
            console.warn(`[preload] ${roomId}: lazy data load returned undefined (cache miss or no IPC).`);
          }
        });
      }
      // Schedule the next room regardless — don't block on the async load.
      if (workQueue.length > 0) {
        activeHandle = scheduleIdle(processNext);
      } else {
        activeHandle = null;
      }
      return;
    }

    // Skip if already fully prepared.
    const existingEntry = cache.has(roomId) ? cache.get(roomId) : undefined;
    if (room !== undefined && (existingEntry === undefined || !isEntryFullyPrepared(existingEntry))) {
      const t0 = performance.now();
      const prepared = buildPreparedRoomRuntime(room);
      const totalMs = performance.now() - t0;

      cache.set(roomId, prepared);

      if (totalMs > LONG_TASK_WARN_MS) {
        console.warn(
          `[preload] SLOW MAIN-THREAD TASK: ${roomId} took ${totalMs.toFixed(1)}ms` +
          ` (wall+edge+blockers+decor). Consider moving to a Web Worker.`,
        );
      } else if (isDebugMode) {
        console.log(
          `[preload] ${roomId} prepared in ${totalMs.toFixed(1)}ms` +
          ` (wall+edge+blockers+decor, cache size=${cache.size})`,
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

    prioritize(roomId: string): void {
      if (isCancelled) return;

      // No-op if already fully cached.
      const existingEntry = cache.get(roomId);
      if (existingEntry !== undefined && isEntryFullyPrepared(existingEntry)) return;

      const idx = workQueue.indexOf(roomId);
      if (idx > 0) {
        // Move from its current position to front of queue.
        workQueue.splice(idx, 1);
        workQueue.unshift(roomId);
        // workQueueSet membership unchanged — just moved position.
        if (isDebugMode) {
          console.log(`[preload:priority] ${roomId} moved to front of queue`);
        }
      } else if (idx === -1) {
        // Not in queue yet — add to front.
        workQueue.unshift(roomId);
        workQueueSet.add(roomId);
        if (isDebugMode) {
          console.log(`[preload:priority] ${roomId} added to front of queue`);
        }
        // Kick off scheduling if the queue was previously empty.
        if (activeHandle === null) {
          activeHandle = scheduleIdle(processNext);
        }
      }
      // If already at front (idx === 0), nothing to do.
    },
  };
}
