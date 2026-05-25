/**
 * roomPreloadScheduler.ts — Idle-time BFS preloader for nearby rooms.
 *
 * Triggered after every room load via `scheduleRoomPreloads()`.  Performs a
 * BFS from the current room through `RoomDef.transitions` and schedules
 * precomputation of each nearby room's `RoomWallTemplate` so that room
 * transitions can skip the expensive build pass entirely.
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
 *    - Cheap rooms (estimated cost ≤ MAX_R1_COST_SYNC_MS) are built
 *      synchronously in the idle slot.
 *    - Heavy rooms (estimated cost > threshold) are dispatched to the Web
 *      Worker so the main thread is never blocked.
 *    - If the worker is unavailable, heavy rooms are deferred until the next
 *      idle slot or **skipped** when the idle timeout fires — they are NOT
 *      built synchronously on the main thread to avoid freezing gameplay.
 *      A cache miss on transition is handled by the existing async overlay.
 *  - Radius-2 rooms (one hop further): enqueued second.
 *    - Cheap rooms (estimated cost ≤ MAX_R2_COST_WITHOUT_TIMEOUT_MS) are
 *      built synchronously in the idle slot.
 *    - Heavy rooms are dispatched to the Web Worker.
 *    - If the worker is unavailable, heavy radius-2 rooms are likewise
 *      **skipped** when the idle timeout fires.
 *  - Rooms already in the cache are skipped (idempotent).
 *  - `handle.prioritize(roomId)` moves a room to the front of the queue
 *    (called when the player approaches a transition boundary).
 *
 * Scheduling:
 *  - Uses `requestIdleCallback` when available (Chromium/Edge).
 *  - Falls back to `setTimeout(0)` on Safari/Firefox where rIC is absent.
 *  - Each callback processes at most one room to keep idle slices short.
 *  - Deadline time-budgeting: each callback checks `timeRemaining()` before
 *    starting a build so that callbacks in a short idle slot do not begin a
 *    potentially expensive synchronous build inside an animation frame.
 *    For heavy rooms the worker eliminates this concern entirely.
 *
 * This module also expands sprite preloading from radius-1 to radius-2 so
 * image assets are ready when the player arrives.
 *
 * BUILD 390
 */

import type { RoomDef } from '../levels/roomDef';
import type { AdjacencyEntry } from '../levels/roomCacheManifest';
import { buildPreparedRoomRuntime } from './preparedRoomRuntime';
import { preloadRoomThemeSprites, decodeRoomThemeSprites, decodeRoomBackground } from '../render/roomAssetPreloader';
import type { RoomRuntimeCache } from './roomRuntimeCache';
import { isEntryFullyPrepared } from './roomRuntimeCache';
import type { RoomRuntimeEntry } from './roomRuntimeCache';
import type { RoomWallTemplate } from './gameRoomWalls';
import type { WallDecoration } from '../render/effects/decorationWaveState';
import type { WorkerOutboundMessage, WorkerSuccessMessage, SerializedWallTemplate } from './roomPreparationWorkerProtocol';
import * as FP from '../debug/perfFreezeProfiler';

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
 * Estimated cost threshold above which a radius-1 room is dispatched to the
 * background worker instead of being built synchronously on the main thread.
 *
 * Radius-1 rooms were previously always built synchronously ("needed
 * imminently"), which could freeze gameplay by 1–5 seconds when a large room
 * was directly adjacent to the current room.  Rooms below this threshold
 * remain synchronous because they are genuinely cheap; heavier rooms are sent
 * to the worker.  The worker's async latency is acceptable since the existing
 * async loading overlay will cover any gap if the player transitions before
 * the worker finishes.
 */
const MAX_R1_COST_SYNC_MS = 8;

/**
 * Dev-mode threshold (ms) above which a single room build is logged as a
 * slow task on the main thread.
 */
const LONG_TASK_WARN_MS = 16;

// ── Room build cost heuristic ─────────────────────────────────────────────────

/**
 * Estimates the main-thread build cost of `buildPreparedRoomRuntime` for a
 * room using a lightweight heuristic based on geometry counts.
 *
 * The wall-merge pass is O(n²) in the number of pre-merge wall rectangles,
 * making it the dominant cost for large open rooms.  Background blocks and
 * decorations add smaller but measurable overhead.
 *
 * Calibrated so that:
 *   - a typical small/medium room returns ≈ 10–50 ms
 *   - large rooms like underwater_lake or seal_chamber return 100+ ms
 *
 * This estimate is ONLY used as a heuristic to decide whether it is safe to
 * build a room in the current idle slot.  It does NOT need to be precise.
 */
function estimateRoomBuildCostMs(room: RoomDef): number {
  const wallCount = room.walls?.length ?? 0;
  // Wall-merge pass is super-linear: O(n²) in the worst case.
  // Empirically, each wall costs ~0.04 ms + a quadratic term.
  const wallCost = wallCount * 0.04 + wallCount * wallCount * 0.002;
  let bgBlockCount = 0;
  if (room.backgroundBlocks !== undefined) {
    for (let i = 0; i < room.backgroundBlocks.length; i++) {
      const b = room.backgroundBlocks[i];
      bgBlockCount += b.wBlock * b.hBlock;
    }
  }
  const bgCost = bgBlockCount * 0.008;
  const decorCount = room.decorations?.length ?? 0;
  const decorCost = decorCount * 0.3;
  return wallCost + bgCost + decorCost;
}

/**
 * Maximum estimated build cost (ms) for a radius-2 room to be scheduled
 * without worker offloading.  Rooms whose estimated cost exceeds this are
 * dispatched to the Web Worker instead of running synchronously on the main
 * thread.  When the worker is unavailable, heavy rooms are skipped (not built
 * synchronously) so active gameplay is never blocked by speculative preloads.
 */
const MAX_R2_COST_WITHOUT_TIMEOUT_MS = 80;

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

// ── Web Worker management ─────────────────────────────────────────────────────
//
// A single worker instance is created lazily on the first heavy radius-2 room
// dispatch and reused for the lifetime of the game session.  Each room posts
// one message and receives one reply; there is no per-room worker lifecycle.
//
// Pending callbacks are stored by roomId so multiple schedules can coexist:
// when the worker replies, the result is written to the same shared
// `RoomRuntimeCache` regardless of which schedule originally dispatched it.

/** Lazily-initialised room preparation worker.  `null` after init failure. */
let _worker: Worker | null | undefined;
/** roomId → callback to call when the worker delivers a result. */
const _workerCallbacks = new Map<string, (entry: RoomRuntimeEntry) => void>();
/** roomIds currently pending with the worker (prevents double-dispatch). */
const _pendingWorkerRoomIds = new Set<string>();

/**
 * Returns the shared worker instance, creating it on first call.
 * Returns `null` if the environment does not support Workers or the worker
 * failed to start.
 */
function _getOrCreateWorker(): Worker | null {
  if (_worker !== undefined) return _worker;
  try {
    _worker = new Worker(
      new URL('./roomPreparationWorker.ts', import.meta.url),
      { type: 'module' },
    );
    _worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data;
      const callback = _workerCallbacks.get(msg.roomId);
      _workerCallbacks.delete(msg.roomId);
      _pendingWorkerRoomIds.delete(msg.roomId);

      if (!callback) return;

      if (msg.error !== undefined) {
        // Build failed — fall back by letting the cold-miss synchronous path
        // handle it when the room is needed.  Log in dev so it is visible.
        if (import.meta.env.DEV) {
          console.error(`[preload worker] ${msg.roomId} build failed:`, msg.error);
        }
        return;
      }

      callback(_reconstructRoomRuntimeEntry(msg));
    };
    _worker.onerror = (err) => {
      if (import.meta.env.DEV) {
        console.error('[preload worker] fatal error:', err);
      }
      // Nullify so subsequent calls create a fresh worker (one retry).
      _worker = null;
    };
  } catch {
    _worker = null;
  }
  return _worker;
}

/**
 * Reconstructs a `RoomRuntimeEntry` from a successful worker reply.
 * Typed arrays are wrapped around the transferred ArrayBuffers (zero-copy).
 * Sets are reconstructed from the serialised key arrays.
 */
function _reconstructRoomRuntimeEntry(msg: WorkerSuccessMessage): RoomRuntimeEntry {
  const sw = msg.wallTemplate as SerializedWallTemplate;
  const wallTemplate: RoomWallTemplate = {
    wallCount:            sw.wallCount,
    xWorld:               new Float32Array(sw.xWorld),
    yWorld:               new Float32Array(sw.yWorld),
    wWorld:               new Float32Array(sw.wWorld),
    hWorld:               new Float32Array(sw.hWorld),
    isPlatformFlag:       new Uint8Array(sw.isPlatformFlag),
    platformEdge:         new Uint8Array(sw.platformEdge),
    themeIndex:           new Uint8Array(sw.themeIndex),
    soundHardnessIndex:   new Uint8Array(sw.soundHardnessIndex),
    isInvisibleFlag:      new Uint8Array(sw.isInvisibleFlag),
    rampOrientationIndex: new Uint8Array(sw.rampOrientationIndex),
    isPillarHalfWidthFlag: new Uint8Array(sw.isPillarHalfWidthFlag),
    isIceFlag:            new Uint8Array(sw.isIceFlag),
    isUltraIceFlag:       new Uint8Array(sw.isUltraIceFlag),
  };

  // Wire: null  = "built; no blockers"  → RoomRuntimeEntry: undefined
  //       array = "has blockers"         → RoomRuntimeEntry: Set<string>
  const blockerKeys: Set<string> | undefined =
    msg.blockerKeys !== null ? new Set(msg.blockerKeys) : undefined;
  const darkBlockerKeys: Set<string> | undefined =
    msg.darkBlockerKeys !== null ? new Set(msg.darkBlockerKeys) : undefined;

  return {
    wallTemplate,
    edgeExtension: null,
    blockerKeys,
    darkBlockerKeys,
    wallDecorations: msg.wallDecorations as WallDecoration[],
  };
}

/**
 * Dispatches `room` to the background worker for preparation.
 * On success the result is stored in `cache` via `cache.set(roomId, entry)`.
 *
 * Returns `true` when the room was accepted by the worker (it may already be
 * pending, in which case the existing dispatch is reused).
 * Returns `false` when the worker is unavailable.
 */
function _dispatchToWorker(
  roomId: string,
  room: RoomDef,
  cache: RoomRuntimeCache,
  isDebugMode: boolean,
): boolean {
  const worker = _getOrCreateWorker();
  if (worker === null) return false;

  // Avoid double-dispatching the same room.
  if (_pendingWorkerRoomIds.has(roomId)) return true;

  _pendingWorkerRoomIds.add(roomId);
  _workerCallbacks.set(roomId, (entry) => {
    cache.set(roomId, entry);
    if (isDebugMode) {
      console.log(`[preload worker] ${roomId} cached from worker`);
    }
  });

  // `room` is a plain-object `RoomDef` produced by JSON hydration — all fields
  // are primitive values, plain arrays, or plain sub-objects.  The structured
  // clone algorithm copies it cleanly without requiring any special handling.
  worker.postMessage({ roomId, room });
  return true;
}

// ── BFS helpers ───────────────────────────────────────────────────────────────

/**
 * Collects room IDs within `maxRadius` hops of `fromRoomId` in BFS order.
 * Returns an array of `[roomId, radius]` pairs, ordered by radius then by
 * the order transitions appear in the room definition.  The source room
 * (radius 0) is excluded.
 *
 * When `adjacency` is provided (from the active manifest), BFS can traverse
 * neighbours of rooms that are NOT yet loaded in `roomRegistry`.  This allows
 * discovery of radius-2 rooms even in lazy-load mode where only the current
 * room is hydrated.  If a room is in the registry, its live transitions take
 * precedence; the adjacency index is used only as a fallback.
 *
 * NOTE: Without adjacency, BFS can only follow transitions from rooms already
 * present in `roomRegistry`.  Rooms not yet loaded are not reachable and the
 * scheduler re-discovers them after each room loads.
 */
function _bfsNearbyRooms(
  fromRoomId: string,
  roomRegistry: ReadonlyMap<string, RoomDef>,
  maxRadius: number,
  adjacency?: Record<string, AdjacencyEntry>,
): Array<[string, number]> {
  const visited = new Set<string>([fromRoomId]);
  const result: Array<[string, number]> = [];
  const queue: Array<[string, number]> = [[fromRoomId, 0]];

  while (queue.length > 0) {
    const [currentId, radius] = queue.shift()!;
    if (radius >= maxRadius) continue;

    // Prefer live room transitions; fall back to manifest adjacency when the
    // room is not yet hydrated in the registry.
    const room = roomRegistry.get(currentId);

    if (room !== undefined) {
      // Room is loaded — use its authoritative transition list.
      for (let ti = 0; ti < room.transitions.length; ti++) {
        const targetId = room.transitions[ti].targetRoomId;
        if (visited.has(targetId)) continue;
        visited.add(targetId);
        result.push([targetId, radius + 1]);
        queue.push([targetId, radius + 1]);
      }
    } else if (adjacency !== undefined) {
      // Room is not yet loaded — use the manifest adjacency index as a fallback.
      const adjEntry = adjacency[currentId];
      if (adjEntry !== undefined &&
          // Deliberate runtime Array.isArray guard: `targets` comes from JSON-parsed
          // manifest data and may be malformed even when the TypeScript type says string[].
          Array.isArray(adjEntry.targets)) {
        for (let ti = 0; ti < adjEntry.targets.length; ti++) {
          const targetId = adjEntry.targets[ti];
          // Basic safety guard against malformed manifest entries.
          if (typeof targetId !== 'string' || targetId.length === 0) continue;
          if (visited.has(targetId)) continue;
          visited.add(targetId);
          result.push([targetId, radius + 1]);
          queue.push([targetId, radius + 1]);
        }
      }
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
 * Schedules precomputation of `RoomWallTemplate` (and associated runtime data)
 * for all rooms within 2 hops of `currentRoom`.
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
 * @param adjacency      Optional adjacency index from the active manifest.
 *                       When provided, BFS can traverse neighbours of rooms
 *                       that are not yet loaded in `roomRegistry`, enabling
 *                       radius-2 discovery in lazy-load mode.  Falls back to
 *                       registry-only BFS when absent (old manifests or
 *                       browser / packed-campaign mode).
 */
export function scheduleRoomPreloads(
  currentRoom: RoomDef,
  roomRegistry: ReadonlyMap<string, RoomDef>,
  cache: RoomRuntimeCache,
  isDebugMode = false,
  loadRoomAsync?: (roomId: string) => Promise<RoomDef | undefined>,
  adjacency?: Record<string, AdjacencyEntry>,
): PreloadScheduleHandle {
  const nearby = _bfsNearbyRooms(currentRoom.id, roomRegistry, 2, adjacency);

  // Separate into radius-1 (urgent) and radius-2 (background) queues.
  const radius1: string[] = [];
  const radius2: string[] = [];
  for (const [id, radius] of nearby) {
    if (radius === 1) radius1.push(id);
    else radius2.push(id);
  }

  // Preload and decode sprites for all nearby rooms (fire-and-forget; imageCache deduplicates).
  // Radius-1 rooms use full decode() so sprites are GPU-rasterized before the player arrives.
  // Radius-2 rooms use the cheaper loadImg-only path; decode will fire later via proximity check.
  for (let i = 0; i < radius1.length; i++) {
    const r = roomRegistry.get(radius1[i]);
    if (r !== undefined) void decodeRoomThemeSprites(r);
    if (r !== undefined) decodeRoomBackground(r);
  }
  for (let i = 0; i < radius2.length; i++) {
    const r = roomRegistry.get(radius2[i]);
    if (r !== undefined) preloadRoomThemeSprites(r);
  }

  // Work queue: radius-1 rooms first, then radius-2.
  // Each entry tracks the room ID and its BFS radius so that radius-2 rooms
  // can be subject to a stricter budget policy.
  const workQueue: Array<{ roomId: string; radius: number }> = [
    ...radius1.map(id => ({ roomId: id, radius: 1 })),
    ...radius2.map(id => ({ roomId: id, radius: 2 })),
  ];
  // Set mirror for O(1) membership checks — kept in sync with workQueue.
  const workQueueSet = new Set<string>(workQueue.map(e => e.roomId));

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

    // Skip rooms already fully cached.
    while (workQueue.length > 0) {
      const frontEntry = cache.has(workQueue[0].roomId) ? cache.get(workQueue[0].roomId) : undefined;
      if (frontEntry !== undefined && isEntryFullyPrepared(frontEntry)) {
        workQueueSet.delete(workQueue[0].roomId);
        workQueue.shift();
      } else {
        break;
      }
    }
    if (workQueue.length === 0) return;

    const { roomId, radius } = workQueue.shift()!;
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
                  workQueue.push({ roomId, radius });
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

    // ── Radius-2 cost guard ────────────────────────────────────────────────
    // For heavy radius-2 rooms, dispatch to the background worker so the main
    // thread is never blocked.  This eliminates the timeout-forced synchronous
    // path for large rooms entirely (e.g. underwater_lake, seal_chamber).
    //
    // If the worker is unavailable, fall back to the old deferral strategy:
    // keep re-queuing until `deadline.didTimeout` forces the synchronous build.
    //
    // ── Radius-1 cost guard ────────────────────────────────────────────────
    // Radius-1 rooms with estimated cost > MAX_R1_COST_SYNC_MS are also sent
    // to the worker to prevent 1–5 second gameplay freezes when the player
    // approaches a large adjacent room.  The worker's async latency is fine —
    // the existing loading overlay covers any gap if the player crosses before
    // the worker finishes.
    if (radius >= 1) {
      const estimatedCostMs = estimateRoomBuildCostMs(room);
      const threshold = radius === 1 ? MAX_R1_COST_SYNC_MS : MAX_R2_COST_WITHOUT_TIMEOUT_MS;
      if (estimatedCostMs > threshold) {
        const dispatched = _dispatchToWorker(roomId, room, cache, isDebugMode);
        if (dispatched) {
          if (isDebugMode) {
            console.log(
              `[preload] ${roomId} (radius-${radius}): estimated ${estimatedCostMs.toFixed(0)}ms — ` +
              `dispatched to worker.`,
            );
          }
          // Worker accepted; continue processing the rest of the queue.
          if (workQueue.length > 0) {
            activeHandle = scheduleIdle(processNext);
          } else {
            activeHandle = null;
          }
          return;
        }
        // Worker unavailable.
        if (!deadline.didTimeout) {
          // Defer for both radius-1 and radius-2 until the idle timeout fires.
          // This prevents a main-thread freeze during active gameplay when a
          // heavy room is due and the worker is not available.
          if (isDebugMode) {
            console.log(
              `[preload] ${roomId} (radius-${radius}): estimated ${estimatedCostMs.toFixed(0)}ms build cost ` +
              `exceeds threshold. Worker unavailable — deferring until idle timeout.`,
            );
          }
          if (!workQueueSet.has(roomId)) {
            workQueue.push({ roomId, radius });
            workQueueSet.add(roomId);
          }
          if (workQueue.length > 0) {
            activeHandle = scheduleIdle(processNext);
          }
          return;
        }
        // Idle timeout forced — worker still unavailable for this heavy room.
        // Do NOT build synchronously; that would freeze active gameplay for
        // potentially hundreds of ms.  Instead, skip this speculative preload
        // and let the existing async loading overlay handle any cache miss if
        // the player transitions to this room.
        if (import.meta.env.DEV) {
          console.log(
            `[preload] ${roomId} (radius-${radius}): skipping heavy speculative preload ` +
            `(estimated ${estimatedCostMs.toFixed(0)}ms, worker unavailable). ` +
            `Async overlay will cover any transition cache miss.`,
          );
          FP.recordPreloadTask(roomId, 0);
        }
        // Continue to next room in queue (do NOT fall through to synchronous build).
        if (workQueue.length > 0) {
          activeHandle = scheduleIdle(processNext);
        } else {
          activeHandle = null;
        }
        return;
      }
    }

    // Skip if already fully prepared.
    const existingEntry = cache.has(roomId) ? cache.get(roomId) : undefined;
    if (room !== undefined && (existingEntry === undefined || !isEntryFullyPrepared(existingEntry))) {
      const _buildT0 = import.meta.env.DEV ? performance.now() : 0;
      const result = buildPreparedRoomRuntime(room);
      cache.set(roomId, result.runtimeEntry);
      if (import.meta.env.DEV) FP.recordPreloadTask(roomId, performance.now() - _buildT0);

      if (result.totalMs > LONG_TASK_WARN_MS) {
        let bgArea = 0;
        if (room.backgroundBlocks !== undefined) {
          for (let _bi = 0; _bi < room.backgroundBlocks.length; _bi++) {
            const _b = room.backgroundBlocks[_bi];
            bgArea += _b.wBlock * _b.hBlock;
          }
        }
        console.warn(
          `[preload] SLOW MAIN-THREAD TASK: ${roomId} took ${result.totalMs.toFixed(1)}ms`,
          `\n  wall=${result.wallMs.toFixed(1)}ms  blockers=${result.blockerMs.toFixed(1)}ms  decor=${result.decorMs.toFixed(1)}ms`,
          `\n  wallCount=${room.walls?.length ?? 0}` +
          `  bgBlockArea=${bgArea}` +
          `  decorCount=${room.decorations?.length ?? 0}` +
          `  roomSize=${room.widthBlocks}×${room.heightBlocks}` +
          `  radius=${radius}`,
        );
      } else if (isDebugMode) {
        console.log(
          `[preload] ${roomId} prepared in ${result.totalMs.toFixed(1)}ms` +
          ` (wall+blockers+decor, cache size=${cache.size})`,
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

      // No-op if the worker is already computing this room.  It will deliver
      // the result shortly and `cache.set` will be called on arrival.
      if (_pendingWorkerRoomIds.has(roomId)) {
        if (isDebugMode) {
          console.log(`[preload:priority] ${roomId} is pending with worker — no action needed`);
        }
        return;
      }

      const idx = workQueue.findIndex(e => e.roomId === roomId);
      if (idx > 0) {
        // Move from its current position to front of queue.
        // Promote to radius-1 since the player is approaching this room.
        workQueue.splice(idx, 1);
        workQueue.unshift({ roomId, radius: 1 });
        // workQueueSet membership unchanged — just moved position.
        if (isDebugMode) {
          console.log(`[preload:priority] ${roomId} moved to front of queue (promoted to radius-1)`);
        }
      } else if (idx === -1) {
        // Not in queue yet — add to front as radius-1.
        workQueue.unshift({ roomId, radius: 1 });
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
