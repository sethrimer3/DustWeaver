/**
 * roomRenderChunkWarmScheduler.ts — Idle-time render-chunk pre-warmer.
 *
 * Uses spare CPU/GPU time during active gameplay to pre-build wall and
 * background render chunks for nearby rooms before the player enters them.
 * When the player does enter a room with pre-warmed chunks, `adoptPrewarmedWallChunks`
 * and `adoptPrewarmedBgChunks` inject the pre-built canvases into the active
 * caches, eliminating the first-frame hitch.
 *
 * Priority order:
 *   1. Radius-1 rooms (directly adjacent) — entrance viewport first.
 *   2. Radius-2 rooms — entrance viewport only, when machine is fast.
 *   3. Radius-3 rooms — only on high quality + stable frame times.
 *
 * Safety rules:
 *   - Only runs during `requestIdleCallback` (or setTimeout fallback) slots.
 *   - Checks `timeRemaining()` and stops before the budget is exhausted.
 *   - Backs off or pauses when recent frame times are poor.
 *   - Cancelled and restarted on every room transition.
 *
 * BUILD 394
 */

import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import {
  DEFAULT_DIRECTIONAL_BIAS,
  DEFAULT_SIDE_EXPOSURE_STRENGTH,
  DEFAULT_MINIMUM_WALL_LIGHT,
  DEFAULT_FALLOFF_POWER,
  DEFAULT_BACKGROUND_LIGHT_SPILL,
  DEFAULT_SOLID_LIGHT_SOFTNESS,
} from '../render/walls/ambientLightDepths';
import {
  type WallPrewarmContext,
  prewarmWallChunksForRoom,
  adoptPrewarmedWallChunks,
  getPrewarmWallStats,
  listPrewarmedWallRoomIds,
  evictPrewarmedWallChunks,
  getPrewarmWallRoomStats,
} from '../render/walls/blockSpriteRenderer';
import {
  prewarmBgChunksForRoom,
  adoptPrewarmedBgChunks,
  getPrewarmBgStats,
  listPrewarmedBgRoomIds,
  evictPrewarmedBgChunks,
  getPrewarmBgRoomStats,
} from '../render/walls/backgroundBlockRenderer';
import { areRoomSpritesReady } from '../render/roomAssetPreloader';
import type { RoomRuntimeCache } from './roomRuntimeCache';
import { isEntryFullyPrepared } from './roomRuntimeCache';
import type { WallSnapshot } from '../render/snapshot';
import * as FP from '../debug/perfFreezeProfiler';

// ── Tuning constants ──────────────────────────────────────────────────────────

/** Maximum number of wall + bg chunks to build in a single idle callback. */
const MAX_CHUNKS_PER_IDLE = 6;

/** Stop the current idle callback when fewer than this many ms remain. */
const MIN_IDLE_REMAINING_MS = 4;

/** Idle callback timeout (ms): browser forces callback after this delay. */
const IDLE_TIMEOUT_MS = 5000;

/**
 * If the most-recent gameScreen frame time (ms) exceeds this value, reduce
 * the per-idle chunk budget to the adaptive minimum to avoid adding load.
 */
const FRAME_TIME_PAUSE_THRESHOLD_MS = 20;

/**
 * When frame times are bad, only allow this many chunks per idle call
 * (instead of MAX_CHUNKS_PER_IDLE).
 */
const CHUNKS_PER_IDLE_REDUCED = 1;

/**
 * Maximum prewarming radius.
 *
 * - 2 = warm radius-1 and radius-2 rooms (recommended default).
 * - 3 = additionally warm radius-3 rooms (only when quality='high').
 */
const MAX_PREWARM_RADIUS = 3;

/**
 * When `true`, radius-3 rooms are only warmed on 'high' graphics quality and
 * when frame times are stable.
 */
const RADIUS3_HIGH_QUALITY_ONLY = true;

/**
 * Global prewarm memory budgets by graphics quality tier (KB).
 * When total prewarmed wall + bg memory exceeds the budget, stale rooms are
 * evicted starting with the highest-radius, least-recently-scheduled rooms.
 */
const PREWARM_MEMORY_BUDGET_KB: Record<'low' | 'med' | 'high', number> = {
  low:  4096,
  med:  12288,
  high: 32768,
};

// ── Idle scheduling shim (mirrors roomPreloadScheduler) ──────────────────────

type IdleCallbackHandle = number;

interface IdleDeadline {
  timeRemaining(): number;
  readonly didTimeout: boolean;
}

type IdleBudgetCallback = (deadline: IdleDeadline) => void;

function _scheduleIdle(callback: IdleBudgetCallback): IdleCallbackHandle {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(callback as IdleRequestCallback, { timeout: IDLE_TIMEOUT_MS });
  }
  return setTimeout(
    () => callback({ timeRemaining: () => 50, didTimeout: false }),
    0,
  ) as unknown as IdleCallbackHandle;
}

function _cancelIdle(handle: IdleCallbackHandle): void {
  if (typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(handle);
  } else {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  }
}

// ── WallSnapshot adapter ──────────────────────────────────────────────────────

/**
 * Zero-copy view of a `RoomWallTemplate` as a `WallSnapshot`.
 * Both share the same underlying typed-array buffers.
 */
function _wallTemplateToSnapshot(t: {
  readonly wallCount: number;
  readonly xWorld: Float32Array;
  readonly yWorld: Float32Array;
  readonly wWorld: Float32Array;
  readonly hWorld: Float32Array;
  readonly isPlatformFlag: Uint8Array;
  readonly platformEdge: Uint8Array;
  readonly themeIndex: Uint8Array;
  readonly isInvisibleFlag: Uint8Array;
  readonly rampOrientationIndex: Uint8Array;
  readonly isPillarHalfWidthFlag: Uint8Array;
}): WallSnapshot {
  return {
    count:                  t.wallCount,
    xWorld:                 t.xWorld,
    yWorld:                 t.yWorld,
    wWorld:                 t.wWorld,
    hWorld:                 t.hWorld,
    isPlatformFlag:         t.isPlatformFlag,
    platformEdge:           t.platformEdge,
    themeIndex:             t.themeIndex,
    isInvisibleFlag:        t.isInvisibleFlag,
    rampOrientationIndex:   t.rampOrientationIndex,
    isPillarHalfWidthFlag:  t.isPillarHalfWidthFlag,
  };
}

// ── Prewarm stats (shared with debug panel) ───────────────────────────────────

export interface PrewarmStats {
  /** Number of rooms currently held in prewarm wall caches. */
  wallRoomCount: number;
  /** Total pre-built wall chunks across all rooms. */
  totalWallChunks: number;
  /** Estimated VRAM usage for all pre-built wall canvases (KB). */
  wallMemoryEstimateKB: number;
  /** Number of rooms currently held in prewarm bg caches. */
  bgRoomCount: number;
  /** Total pre-built background chunks across all rooms. */
  totalBgChunks: number;
  /** Estimated VRAM usage for all pre-built bg canvases (KB). */
  bgMemoryEstimateKB: number;
  /** How many rooms are still in the prewarm queue. */
  queueLength: number;
  /** Chunks warmed during the most recent idle callback. */
  chunksLastSlice: number;
  /** Milliseconds spent in the most recent idle callback. */
  msLastSlice: number;
  /** Prewarm radius currently being targeted. */
  currentRadius: number;
  /** `true` when warming is paused due to high frame time. */
  pausedForFrameTime: boolean;
  /** Wall cache hits on the most recent room entry. */
  wallCacheHits: number;
  /** Wall cache misses on the most recent room entry. */
  wallCacheMisses: number;
  /** BG cache hits on the most recent room entry. */
  bgCacheHits: number;
  /** BG cache misses on the most recent room entry. */
  bgCacheMisses: number;
  /**
   * Tasks deferred this schedule because runtime data (blockerKeys, wall
   * template, or decorations) was not yet computed.  Resets each schedule.
   */
  deferredNotReady: number;
  /**
   * Tasks deferred this schedule because room sprites were not yet decoded.
   * Resets each schedule.
   */
  deferredSpritesNotReady: number;
  /**
   * Rooms evicted from prewarm caches in the most recent eviction pass.
   * Resets each eviction call.
   */
  evictedThisPass: number;
  /** Running total of rooms evicted since the scheduler was started. */
  totalEvictions: number;
  /** Combined wall + bg prewarm memory estimate (KB). */
  totalPrewarmMemoryKB: number;
}

let _stats: PrewarmStats = {
  wallRoomCount:           0,
  totalWallChunks:         0,
  wallMemoryEstimateKB:    0,
  bgRoomCount:             0,
  totalBgChunks:           0,
  bgMemoryEstimateKB:      0,
  queueLength:             0,
  chunksLastSlice:         0,
  msLastSlice:             0,
  currentRadius:           1,
  pausedForFrameTime:      false,
  wallCacheHits:           0,
  wallCacheMisses:         0,
  bgCacheHits:             0,
  bgCacheMisses:           0,
  deferredNotReady:        0,
  deferredSpritesNotReady: 0,
  evictedThisPass:         0,
  totalEvictions:          0,
  totalPrewarmMemoryKB:    0,
};

/** Read-only snapshot of prewarm stats. Updates every idle callback. */
export function getPrewarmStats(): Readonly<PrewarmStats> {
  return _stats;
}

// ── Scheduler state ───────────────────────────────────────────────────────────

interface WarmTask {
  roomId: string;
  radius: number;
  /** Entrance camera offset to prioritise the first-visible chunk region. */
  offsetXPx: number;
  offsetYPx: number;
  /** Viewport dimensions (virtual pixels). */
  vpWPx: number;
  vpHPx: number;
  /** Camera zoom factor (usually 1.0). */
  scalePx: number;
  /** Whether wall chunks still need more coverage in this task. */
  wallDone: boolean;
  /** Whether bg chunks still need more coverage. */
  bgDone: boolean;
}

/** BFS-ordered list of rooms to warm. Front = highest priority. */
let _queue: WarmTask[] = [];
/** Current idle callback handle (`0` = not scheduled). */
let _idleHandle: IdleCallbackHandle = 0;
/** Whether the scheduler has been cancelled. */
let _cancelled = false;
/** Registry snapshot provided when scheduling. */
let _roomRegistry: ReadonlyMap<string, RoomDef> | null = null;
/** Runtime-cache snapshot provided when scheduling. */
let _runtimeCache: RoomRuntimeCache | null = null;
/** Graphics-quality getter supplied by gameScreen.ts. */
let _getQuality: (() => 'low' | 'med' | 'high') | null = null;
/** Frame-time getter supplied by gameScreen.ts (ms per frame, e.g. from FP). */
let _getLastFrameMs: (() => number) | null = null;
/** Room ID of the current active room — never evicted. */
let _currentRoomId: string | null = null;

// ── Handle ────────────────────────────────────────────────────────────────────

export interface WarmScheduleHandle {
  /** Cancels all pending warm work for this schedule. */
  cancel(): void;
}

// ── BFS helper ────────────────────────────────────────────────────────────────

/**
 * Builds a BFS-ordered list of `[roomId, radius, incomingTransitionIndex]`
 * triples for rooms within `maxRadius` hops of `fromRoomId`.
 *
 * `incomingTransitionIndex` is the index of the transition IN THE CURRENT ROOM
 * that leads to the neighbour (used to compute the entrance viewport).
 * For radius > 1, it's set to -1 (we use the first transition in the neighbour).
 */
function _bfsNearby(
  fromRoomId: string,
  registry: ReadonlyMap<string, RoomDef>,
  maxRadius: number,
): Array<[string, number, number]> {
  const visited = new Set<string>([fromRoomId]);
  const result: Array<[string, number, number]> = [];
  const queue: Array<[string, number, number]> = [[fromRoomId, 0, -1]];

  while (queue.length > 0) {
    const [currentId, radius, _] = queue.shift()!;
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

// ── Entrance viewport computation ──────────────────────────────────────────────

/**
 * Computes the camera offset (virtual pixels) representing the first viewport
 * the player will see when entering `targetRoom` via `transition`.
 *
 * The resulting `offsetXPx, offsetYPx` are passed to `prewarmWallChunksForRoom`
 * so it prioritises building chunks that will be visible in the first frame.
 */
function _computeEntranceOffset(
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

// ── Schedule public API ───────────────────────────────────────────────────────

/**
 * Schedules idle-time render-chunk prewarming for all rooms within
 * `MAX_PREWARM_RADIUS` hops of `currentRoom`.
 *
 * Must be called after `scheduleRoomPreloads` (or at the same time) so that
 * room runtime data and sprites have a head start before we try to build chunks.
 *
 * @param currentRoom     The room the player just entered.
 * @param roomRegistry    Map of all loaded room definitions.
 * @param runtimeCache    The shared `RoomRuntimeCache` instance.
 * @param getQuality      Returns the current graphics quality setting.
 * @param getLastFrameMs  Returns the most recent main-thread frame time (ms).
 * @param vpWPx           Viewport width (virtual pixels).
 * @param vpHPx           Viewport height (virtual pixels).
 * @param scalePx         Camera zoom factor.
 * @returns               A handle to cancel the schedule.
 */
export function scheduleChunkPrewarms(
  currentRoom: RoomDef,
  roomRegistry: ReadonlyMap<string, RoomDef>,
  runtimeCache: RoomRuntimeCache,
  getQuality:    () => 'low' | 'med' | 'high',
  getLastFrameMs: () => number,
  vpWPx: number,
  vpHPx: number,
  scalePx: number,
): WarmScheduleHandle {
  // Cancel any previous run.
  _cancelled = false;
  if (_idleHandle !== 0) {
    _cancelIdle(_idleHandle);
    _idleHandle = 0;
  }

  _roomRegistry   = roomRegistry;
  _runtimeCache   = runtimeCache;
  _getQuality     = getQuality;
  _getLastFrameMs = getLastFrameMs;
  _currentRoomId  = currentRoom.id;

  const nearby = _bfsNearby(currentRoom.id, roomRegistry, MAX_PREWARM_RADIUS);

  // Build the task queue (radius-1 first, then radius-2, then radius-3).
  _queue = [];
  for (const [roomId, radius, transIdx] of nearby) {
    const currentRoomDef = roomRegistry.get(currentRoom.id);
    let entranceOffsetXPx = 0;
    let entranceOffsetYPx = 0;

    if (currentRoomDef !== undefined && transIdx >= 0 && transIdx < currentRoomDef.transitions.length) {
      const t = currentRoomDef.transitions[transIdx];
      if (t.targetRoomId === roomId) {
        const { offsetXPx, offsetYPx } = _computeEntranceOffset(t, vpWPx, vpHPx, scalePx);
        entranceOffsetXPx = offsetXPx;
        entranceOffsetYPx = offsetYPx;
      }
    } else {
      // Radius > 1: find the first transition in the target room itself
      // and approximate the entrance from that side.
      const targetRoom = roomRegistry.get(roomId);
      if (targetRoom !== undefined && targetRoom.transitions.length > 0) {
        const { offsetXPx, offsetYPx } = _computeEntranceOffset(
          targetRoom.transitions[0],
          vpWPx,
          vpHPx,
          scalePx,
        );
        entranceOffsetXPx = offsetXPx;
        entranceOffsetYPx = offsetYPx;
      }
    }

    _queue.push({
      roomId,
      radius,
      offsetXPx: entranceOffsetXPx,
      offsetYPx: entranceOffsetYPx,
      vpWPx,
      vpHPx,
      scalePx,
      wallDone: false,
      bgDone:   false,
    });
  }

  // Build the set of rooms that are part of the new schedule so eviction can
  // drop stale rooms that are no longer reachable within the warm radius.
  const keepIds = new Set<string>([currentRoom.id]);
  for (const [roomId] of nearby) keepIds.add(roomId);
  evictStalePrewarmedChunks(keepIds, getQuality());

  // Kick off the first idle callback.
  _idleHandle = _scheduleIdle(_onIdle);

  return {
    cancel(): void {
      _cancelled = true;
      if (_idleHandle !== 0) {
        _cancelIdle(_idleHandle);
        _idleHandle = 0;
      }
    },
  };
}

// ── Adoption on room entry ────────────────────────────────────────────────────

/**
 * Attempts to adopt pre-warmed chunks when the player enters `room`.
 *
 * Call this in `_makeLoadRoomPhases` Phase A, after setting up lighting and
 * theme but BEFORE the first render frame.
 *
 * Updates the prewarm stats with cache hit/miss information.
 */
export function adoptPrewarmedChunksForRoom(room: RoomDef, scalePx: number): void {
  const wallHit = adoptPrewarmedWallChunks(room.id, scalePx);
  const bgHit   = adoptPrewarmedBgChunks(room, scalePx);

  if (import.meta.env.DEV) {
    if (wallHit || bgHit) {
      console.log(`[chunkPrewarm] adopted chunks for ${room.id}: wall=${wallHit} bg=${bgHit}`);
    }
  }

  _stats = {
    ..._stats,
    wallCacheHits:   wallHit  ? _stats.wallCacheHits  + 1 : _stats.wallCacheHits,
    wallCacheMisses: !wallHit ? _stats.wallCacheMisses + 1 : _stats.wallCacheMisses,
    bgCacheHits:     bgHit    ? _stats.bgCacheHits     + 1 : _stats.bgCacheHits,
    bgCacheMisses:   !bgHit   ? _stats.bgCacheMisses   + 1 : _stats.bgCacheMisses,
  };
}

/**
 * Evicts pre-warmed chunks for rooms that are no longer nearby, and
 * enforces the per-quality global memory budget.
 *
 * Eviction order (least valuable first):
 *   1. Rooms not in `keepRoomIds` (stale / out of BFS radius).
 *   2. Remaining rooms that exceed the memory budget, ordered by:
 *      - Radius 3 first, then radius 2, then radius 1.
 *      - Within each radius, largest memory footprint first.
 *
 * Never evicts the current active room (`_currentRoomId`).
 * Safe to call at any time — does not touch in-progress idle build state.
 *
 * @param keepRoomIds  Set of room IDs that should be retained (current + nearby).
 * @param quality      Current graphics quality, used to look up the budget.
 */
export function evictStalePrewarmedChunks(
  keepRoomIds: ReadonlySet<string>,
  quality: 'low' | 'med' | 'high',
): void {
  const currentRoom = _currentRoomId;
  let evictedThisPass = 0;

  // ── Step 1: drop rooms outside the keep set ───────────────────────────────
  for (const roomId of listPrewarmedWallRoomIds()) {
    if (!keepRoomIds.has(roomId) && roomId !== currentRoom) {
      evictPrewarmedWallChunks(roomId);
      evictedThisPass++;
    }
  }
  for (const roomId of listPrewarmedBgRoomIds()) {
    if (!keepRoomIds.has(roomId) && roomId !== currentRoom) {
      evictPrewarmedBgChunks(roomId);
      // bg-only rooms (no wall prewarm) weren't counted above; count them now.
    }
  }

  // ── Step 2: enforce the memory budget ─────────────────────────────────────
  const budget = PREWARM_MEMORY_BUDGET_KB[quality];
  const ws = getPrewarmWallStats();
  const bs = getPrewarmBgStats();
  let totalMemKB = ws.memoryEstimateKB + bs.memoryEstimateKB;

  if (totalMemKB > budget) {
    // Build a list of remaining prewarm rooms with their radius and memory.
    // Rooms not currently in the queue get radius 3 (treated as speculative).
    const radiusMap = new Map<string, number>();
    for (const task of _queue) radiusMap.set(task.roomId, task.radius);

    interface EvictCandidate { roomId: string; radius: number; memKB: number }
    const candidates: EvictCandidate[] = [];
    const seen = new Set<string>();

    for (const roomId of listPrewarmedWallRoomIds()) {
      if (roomId === currentRoom) continue;
      seen.add(roomId);
      const wallMem = getPrewarmWallRoomStats(roomId)?.memoryKB ?? 0;
      const bgMem   = getPrewarmBgRoomStats(roomId)?.memoryKB   ?? 0;
      candidates.push({ roomId, radius: radiusMap.get(roomId) ?? 3, memKB: wallMem + bgMem });
    }
    for (const roomId of listPrewarmedBgRoomIds()) {
      if (roomId === currentRoom || seen.has(roomId)) continue;
      const bgMem = getPrewarmBgRoomStats(roomId)?.memoryKB ?? 0;
      candidates.push({ roomId, radius: radiusMap.get(roomId) ?? 3, memKB: bgMem });
    }

    // Sort: highest radius first; within same radius, largest memory first.
    candidates.sort((a, b) =>
      b.radius !== a.radius ? b.radius - a.radius : b.memKB - a.memKB,
    );

    for (const { roomId, memKB } of candidates) {
      if (totalMemKB <= budget) break;
      evictPrewarmedWallChunks(roomId);
      evictPrewarmedBgChunks(roomId);
      totalMemKB -= memKB;
      evictedThisPass++;
    }
  }

  _stats = {
    ..._stats,
    evictedThisPass,
    totalEvictions: _stats.totalEvictions + evictedThisPass,
  };
}

// ── Idle callback ─────────────────────────────────────────────────────────────

function _onIdle(deadline: IdleDeadline): void {
  _idleHandle = 0;

  if (_cancelled) return;
  if (_queue.length === 0) {
    _refreshStats();
    return;
  }

  const quality     = _getQuality?.()     ?? 'med';
  const lastFrameMs = _getLastFrameMs?.() ?? 0;

  // Back off when frame time is bad.
  const framePoor = lastFrameMs > FRAME_TIME_PAUSE_THRESHOLD_MS;
  const chunksLimit = framePoor ? CHUNKS_PER_IDLE_REDUCED : MAX_CHUNKS_PER_IDLE;

  // When the callback fired via timeout (didTimeout=true), skip a large build.
  if (deadline.didTimeout && framePoor) {
    _idleHandle = _scheduleIdle(_onIdle);
    _stats = { ..._stats, pausedForFrameTime: true };
    return;
  }

  const sliceStart = performance.now();
  let chunksBuilt  = 0;
  let deferredNotReady        = _stats.deferredNotReady;
  let deferredSpritesNotReady = _stats.deferredSpritesNotReady;

  while (_queue.length > 0) {
    // Check both time and chunk budget before each task.
    if (deadline.timeRemaining() < MIN_IDLE_REMAINING_MS) break;
    if (chunksBuilt >= chunksLimit) break;

    const task = _queue[0];

    // Skip radius-3 rooms on low/med quality or poor frame time.
    if (task.radius >= 3 && RADIUS3_HIGH_QUALITY_ONLY && (quality !== 'high' || framePoor)) {
      _queue.shift();
      continue;
    }

    // Skip if room is not in registry.
    const room = _roomRegistry?.get(task.roomId);
    if (room === undefined) {
      _queue.shift();
      continue;
    }

    // Defer if wall template / blocker keys not yet ready.
    // `blockerKeys === null`      means not yet computed → defer.
    // `blockerKeys === undefined` means computed, no blockers → ready.
    const entry = _runtimeCache?.get(task.roomId);
    if (entry === undefined || !isEntryFullyPrepared(entry)) {
      // Room data not ready yet; try again next idle slice.
      deferredNotReady++;
      _queue.push(_queue.shift()!);
      break;
    }

    // Defer if sprites are not ready (don't bake fallback rectangles).
    if (!areRoomSpritesReady(room)) {
      deferredSpritesNotReady++;
      _queue.push(_queue.shift()!);
      break;
    }

    const remaining = chunksLimit - chunksBuilt;

    // ── Build wall chunks ─────────────────────────────────────────────────
    // Only defer when blockerKeys is null (not yet computed).
    // undefined = computed, no blockers — _makeWallPrewarmCtx converts to empty Set.
    if (!task.wallDone && entry.blockerKeys !== null) {
      const wallSnap = _wallTemplateToSnapshot(entry.wallTemplate);
      const wallCtx  = _makeWallPrewarmCtx(room, wallSnap, entry.blockerKeys);
      const built = prewarmWallChunksForRoom(
        task.roomId,
        wallCtx,
        task.offsetXPx,
        task.offsetYPx,
        task.vpWPx,
        task.vpHPx,
        task.scalePx,
        BLOCK_SIZE_MEDIUM,
        remaining,
      );
      FP.recordPrewarmSlice(built);
      chunksBuilt += built;
      if (built === 0) task.wallDone = true;
    } else if (!task.wallDone) {
      // wallDone left false only when blockerKeys is null (should not happen
      // here because isEntryFullyPrepared already guards that), but guard
      // defensively so a no-wall room never stalls the queue.
      task.wallDone = true;
    }

    // ── Build bg chunks ───────────────────────────────────────────────────
    if (!task.bgDone && deadline.timeRemaining() >= MIN_IDLE_REMAINING_MS && chunksBuilt < chunksLimit) {
      const bgRemaining = chunksLimit - chunksBuilt;
      const bgBuilt = prewarmBgChunksForRoom(
        room,
        task.scalePx,
        task.offsetXPx,
        task.offsetYPx,
        task.vpWPx,
        task.vpHPx,
        bgRemaining,
      );
      FP.recordPrewarmSlice(bgBuilt);
      chunksBuilt += bgBuilt;
      if (bgBuilt === 0) task.bgDone = true;
    }

    // Pop task when both passes are complete.
    if (task.wallDone && task.bgDone) {
      _queue.shift();
    } else {
      // More chunks needed for this room — try again next slice.
      break;
    }
  }

  const sliceMs = performance.now() - sliceStart;

  _stats = {
    ..._refreshStatsObj(),
    chunksLastSlice:         chunksBuilt,
    msLastSlice:             sliceMs,
    currentRadius:           _queue[0]?.radius ?? _stats.currentRadius,
    pausedForFrameTime:      framePoor,
    wallCacheHits:           _stats.wallCacheHits,
    wallCacheMisses:         _stats.wallCacheMisses,
    bgCacheHits:             _stats.bgCacheHits,
    bgCacheMisses:           _stats.bgCacheMisses,
    deferredNotReady:        deferredNotReady,
    deferredSpritesNotReady: deferredSpritesNotReady,
  };

  // Schedule next slice if there's more work.
  if (_queue.length > 0 && !_cancelled) {
    _idleHandle = _scheduleIdle(_onIdle);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Constructs a `WallPrewarmContext` from a `RoomDef` and its runtime data.
 * This is the single place that maps RoomDef field names to the prewarm API.
 */
function _makeWallPrewarmCtx(
  room: RoomDef,
  wallSnapshot: WallSnapshot,
  blockerKeys: Set<string> | undefined,
): WallPrewarmContext {
  return {
    wallSnapshot,
    worldNumber:          room.worldNumber ?? 1,
    blockTheme:           room.blockTheme ?? null,
    lightingEffect:       room.lightingEffect ?? 'Ambient',
    ambientDirection:     room.ambientLightDirection ?? 'omni',
    roomWidthBlocks:      room.widthBlocks,
    roomHeightBlocks:     room.heightBlocks,
    blockerKeys:          blockerKeys ?? new Set<string>(),
    directionalBias:      room.directionalBias    ?? DEFAULT_DIRECTIONAL_BIAS,
    sideExposureStrength: room.sideExposureStrength ?? DEFAULT_SIDE_EXPOSURE_STRENGTH,
    minimumWallLight:     room.minimumWallLight   ?? DEFAULT_MINIMUM_WALL_LIGHT,
    falloffPower:         room.falloffPower       ?? DEFAULT_FALLOFF_POWER,
    backgroundLightSpill: room.backgroundLightSpill ?? DEFAULT_BACKGROUND_LIGHT_SPILL,
    solidLightSoftness:   room.solidLightSoftness ?? DEFAULT_SOLID_LIGHT_SOFTNESS,
    seamBlending:         room.blockSeamBlending  ?? 'off',
  };
}

function _refreshStatsObj(): PrewarmStats {
  const ws = getPrewarmWallStats();
  const bs = getPrewarmBgStats();
  return {
    ..._stats,
    wallRoomCount:        ws.roomCount,
    totalWallChunks:      ws.totalChunks,
    wallMemoryEstimateKB: ws.memoryEstimateKB,
    bgRoomCount:          bs.roomCount,
    totalBgChunks:        bs.totalChunks,
    bgMemoryEstimateKB:   bs.memoryEstimateKB,
    totalPrewarmMemoryKB: ws.memoryEstimateKB + bs.memoryEstimateKB,
    queueLength:          _queue.length,
  };
}

function _refreshStats(): void {
  _stats = _refreshStatsObj();
}

// End of roomRenderChunkWarmScheduler.ts
