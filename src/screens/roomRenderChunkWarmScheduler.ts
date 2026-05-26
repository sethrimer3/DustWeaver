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

import type { RoomDef, TransitionDirection } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { bfsNearbyRooms, computeEntranceOffset } from './roomPrewarmNeighborhood';
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

/**
 * Minimum pre-transition velocity magnitude (world units/frame) required on
 * either axis before velocity-direction queue ordering is applied.
 * Below this threshold the player is considered stationary and ordering is skipped.
 */
const MIN_VELOCITY_FOR_DIRECTION_ORDERING = 1;

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

// ── Transition outcome tracking ───────────────────────────────────────────────

/**
 * Records whether the most recent room transition used:
 *  - 'hot'       — instant, no overlay (chunk caches were ready and valid).
 *  - 'entryWarm' — instant load but brief textless cover while chunks warmed.
 *  - 'loading'   — full async load with "Loading…" overlay (cold cache miss).
 *  - 'none'      — no transition has occurred yet.
 */
export type TransitionOutcome = 'hot' | 'entryWarm' | 'loading' | 'none';

/**
 * Explains why the most recent transition was not 'hot'.
 *
 * Captured at transition time (inside `startTransitionLoad`) and stored in
 * `PrewarmStats.lastTransitionDiagnostic` for display in the debug panel.
 */
export interface TransitionReadinessDiagnostic {
  /** Target room ID. */
  roomId: string;
  /** Whether the runtime cache entry was fully prepared when the transition fired. */
  runtimeReady: boolean;
  /**
   * Whether prewarm wall-chunk data was present in the store at transition time
   * (captured BEFORE adoption, which clears the store entry).
   */
  wallPrewarmPresent: boolean;
  /**
   * Whether prewarm bg-chunk data was present in the store at transition time
   * (captured BEFORE adoption, which clears the store entry).
   */
  bgPrewarmPresent: boolean;
  /**
   * Whether the render-state key of the prewarm snapshot matched the active
   * room render state.  `null` when no prewarm data was present or the key
   * could not be determined at diagnostic-capture time (stale-key detection is
   * still enforced inside `adoptPrewarmedWallChunks`/`adoptPrewarmedBgChunks`
   * and logged as a DEV console warning).
   */
  renderStateKeyMatches: boolean | null;
  /** Whether the entry viewport was fully covered after adoption (canSkipEntryWarm). */
  entryViewportCovered: boolean;
  /** Transition outcome. */
  outcome: TransitionOutcome;
  /**
   * Primary reason the transition was not hot.
   *  - 'none'                  — transition was hot.
   *  - 'runtimeNotReady'       — runtime cache miss (full async overlay).
   *  - 'wallChunksMissing'     — no wall prewarm data was present.
   *  - 'bgChunksMissing'       — no bg prewarm data was present.
   *  - 'entryViewportNotCovered' — data present but did not cover the entry viewport
   *                                (may indicate stale key, partial coverage, or
   *                                wrong entrance offset — check DEV console).
   *  - 'unknown'               — outcome was not hot for an unclassified reason.
   */
  missReason:
    | 'none'
    | 'runtimeNotReady'
    | 'wallChunksMissing'
    | 'bgChunksMissing'
    | 'entryViewportNotCovered'
    | 'unknown';
}

/**
 * Records the outcome of the most recent room transition into the prewarm stats
 * so it is visible in the debug panel.
 *
 * Call this from `startTransitionLoad` in gameScreen.ts immediately after the
 * instant vs. async path is decided.
 *
 * Pass a `TransitionReadinessDiagnostic` to explain why the transition was not
 * hot — the diagnostic is shown in the debug prewarm panel.
 */
export function recordTransitionOutcome(
  outcome: TransitionOutcome,
  diagnostic?: TransitionReadinessDiagnostic,
): void {
  _stats = {
    ..._stats,
    lastTransitionOutcome:    outcome,
    lastTransitionDiagnostic: diagnostic ?? null,
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
  /** Chunks skipped (budget exhausted) during the most recent idle callback. */
  chunksSkippedLastSlice: number;
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
  /** Memory budget for the current quality tier (KB).  0 when scheduler not yet started. */
  memoryBudgetKB: number;
  /** Outcome of the most recent room transition. */
  lastTransitionOutcome: TransitionOutcome;
  /**
   * Readiness diagnostic for the most recent room transition.
   * `null` until a transition has occurred or if diagnostics were not captured.
   */
  lastTransitionDiagnostic: TransitionReadinessDiagnostic | null;
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
  chunksSkippedLastSlice:  0,
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
  memoryBudgetKB:          0,
  lastTransitionOutcome:   'none' as TransitionOutcome,
  lastTransitionDiagnostic: null,
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
  /**
   * Transition direction from the current room to this room (radius-1 only).
   * `undefined` for radius > 1.  Used for velocity-direction queue ordering.
   */
  transitionDir?: TransitionDirection;
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
/**
 * Most-recent viewport dimensions passed to `scheduleChunkPrewarms`.
 * Used by `ensureChunkPrewarmQueued` to create new tasks with correct params.
 */
let _lastVpWPx: number = 0;
let _lastVpHPx: number = 0;
let _lastScalePx: number = 1;
/**
 * Set of all room IDs included in the most-recent schedule (BFS neighbourhood).
 * Kept alive across idle slices so post-slice eviction does not evict rooms
 * that are within the prewarm radius but whose queue tasks have already
 * completed.
 */
let _keepIds: Set<string> = new Set<string>();

// ── Handle ────────────────────────────────────────────────────────────────────

export interface WarmScheduleHandle {
  /** Cancels all pending warm work for this schedule. */
  cancel(): void;
}

// ── BFS helper ────────────────────────────────────────────────────────────────

// ── Schedule public API ───────────────────────────────────────────────────────

/**
 * Schedules idle-time render-chunk prewarming for all rooms within
 * `MAX_PREWARM_RADIUS` hops of `currentRoom`.
 *
 * Must be called after `scheduleRoomPreloads` (or at the same time) so that
 * room runtime data and sprites have a head start before we try to build chunks.
 *
 * @param currentRoom      The room the player just entered.
 * @param roomRegistry     Map of all loaded room definitions.
 * @param runtimeCache     The shared `RoomRuntimeCache` instance.
 * @param getQuality       Returns the current graphics quality setting.
 * @param getLastFrameMs   Returns the most recent main-thread frame time (ms).
 * @param vpWPx            Viewport width (virtual pixels).
 * @param vpHPx            Viewport height (virtual pixels).
 * @param scalePx          Camera zoom factor.
 * @param preTransVelocity Player velocity at the moment of the transition trigger.
 *                         When provided, the radius-1 task whose entrance direction
 *                         matches the dominant velocity axis is moved to the front
 *                         of the queue so it is built first during idle time.
 * @returns                A handle to cancel the schedule.
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
  preTransVelocity?: { vx: number; vy: number },
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
  // Persist viewport params for `ensureChunkPrewarmQueued` task creation.
  _lastVpWPx   = vpWPx;
  _lastVpHPx   = vpHPx;
  _lastScalePx = scalePx;

  const nearby = bfsNearbyRooms(currentRoom.id, roomRegistry, MAX_PREWARM_RADIUS);

  // Build the task queue (radius-1 first, then radius-2, then radius-3).
  _queue = [];
  const currentRoomDef = roomRegistry.get(currentRoom.id);
  if (currentRoomDef === undefined) {
    // Should not happen in practice; currentRoom is always registered.
    if (import.meta.env.DEV) {
      console.warn('[chunkPrewarm] currentRoom not found in registry:', currentRoom.id);
    }
    return { cancel(): void {} };
  }
  for (const [roomId, radius, transIdx] of nearby) {
    let entranceOffsetXPx = 0;
    let entranceOffsetYPx = 0;
    let transitionDir: TransitionDirection | undefined;

    if (transIdx >= 0 && transIdx < currentRoomDef.transitions.length) {
      const t = currentRoomDef.transitions[transIdx];
      if (t.targetRoomId === roomId) {
        const { offsetXPx, offsetYPx } = computeEntranceOffset(t, vpWPx, vpHPx, scalePx);
        entranceOffsetXPx = offsetXPx;
        entranceOffsetYPx = offsetYPx;
        transitionDir = t.direction;
      }
    } else {
      // Radius > 1: find the first transition in the target room itself
      // and approximate the entrance from that side.
      const targetRoom = roomRegistry.get(roomId);
      if (targetRoom !== undefined && targetRoom.transitions.length > 0) {
        const { offsetXPx, offsetYPx } = computeEntranceOffset(
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
      transitionDir,
      wallDone: false,
      bgDone:   false,
    });
  }

  // ── Velocity-direction queue ordering ───────────────────────────────────────
  // If the player's pre-transition velocity is known and meaningful, move the
  // radius-1 task whose entrance direction matches the dominant velocity axis
  // to the front so it gets warmed first during idle time.
  // (The proximity boost in gameScreen.ts handles the most time-critical case;
  // this ordering ensures idle work targets the likeliest next room from the
  // very first idle slice.)
  if (preTransVelocity !== undefined) {
    const { vx, vy } = preTransVelocity;
    const absX = Math.abs(vx);
    const absY = Math.abs(vy);
    if (absX > MIN_VELOCITY_FOR_DIRECTION_ORDERING || absY > MIN_VELOCITY_FOR_DIRECTION_ORDERING) {
      const dominant: TransitionDirection =
        absX >= absY
          ? (vx >= 0 ? 'right' : 'left')
          : (vy >= 0 ? 'down'  : 'up');
      const idx = _queue.findIndex(t => t.radius === 1 && t.transitionDir === dominant);
      if (idx > 0) {
        _queue.unshift(_queue.splice(idx, 1)[0]);
        if (import.meta.env.DEV) {
          console.log(
            `[chunkPrewarm] velocity-ordered: ${_queue[0].roomId} (${dominant}) moved to front` +
            ` (vx=${vx.toFixed(1)} vy=${vy.toFixed(1)})`,
          );
        }
      }
    }
  }

  // Build the set of rooms that are part of the new schedule so eviction can
  // drop stale rooms that are no longer reachable within the warm radius.
  const keepIds = new Set<string>([currentRoom.id]);
  for (const [roomId] of nearby) keepIds.add(roomId);
  // Persist the keep-set so post-slice eviction passes use the same membership
  // and do not evict already-completed rooms that are still within the radius.
  _keepIds = keepIds;
  evictStalePrewarmedChunks(keepIds, getQuality());

  // Reset per-schedule deferred counters so they reflect only the new schedule.
  _stats = { ..._stats, deferredNotReady: 0, deferredSpritesNotReady: 0 };

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

// ── Priority boost API ────────────────────────────────────────────────────────

/**
 * The reason why `ensureChunkPrewarmQueued` was called.
 * Used for DEV logging only.
 */
export type EnsureQueuedReason = 'proximity' | 'velocity' | 'manual' | 'transition';

/**
 * Ensures a chunk prewarm task exists for `roomId` and is at the front of the
 * idle queue.  Unlike `prioritizeChunkPrewarm`, this **also creates a new task**
 * when the room has not been queued (e.g. was already completed on a prior
 * schedule pass, or the scheduler was restarted without including this room).
 *
 * Behaviour:
 *  - Room already at queue front → no-op (already highest priority).
 *  - Room elsewhere in queue → moved to front; idle callback kicked.
 *  - Room not in queue, prewarm data present for both wall and bg → skipped
 *    (room was fully warmed; adoption will use the cached data).
 *  - Room not in queue, prewarm data missing → new radius-1 task created at
 *    the front of the queue; idle callback kicked.
 *  - Scheduler cancelled or room not in registry → no-op.
 *
 * @param roomId  Target room to ensure is warmed.
 * @param reason  Why the ensure was requested (used in DEV log messages only).
 */
export function ensureChunkPrewarmQueued(roomId: string, reason: EnsureQueuedReason): void {
  if (_cancelled) return;

  const idx = _queue.findIndex(t => t.roomId === roomId);

  if (idx === 0) {
    // Already at the front — nothing to do.
    return;
  }

  if (idx > 0) {
    // Move existing task to the front.
    _queue.unshift(_queue.splice(idx, 1)[0]);
    if (import.meta.env.DEV) {
      console.log(`[chunkPrewarm:ensure] ${roomId} moved to front (${reason})`);
    }
    if (_idleHandle === 0 && !_cancelled) {
      _idleHandle = _scheduleIdle(_onIdle);
    }
    return;
  }

  // Room is NOT in the queue.

  // If prewarm data is already present for both wall and bg, adoption will pick
  // it up — no need to re-queue.
  const wallReady = getPrewarmWallRoomStats(roomId) !== null;
  const bgReady   = getPrewarmBgRoomStats(roomId)   !== null;
  if (wallReady && bgReady) {
    if (import.meta.env.DEV) {
      console.log(`[chunkPrewarm:ensure] ${roomId} already warmed — skip (${reason})`);
    }
    return;
  }

  // Room is not in registry — cannot create a task.
  if (_roomRegistry === null) return;
  const room = _roomRegistry.get(roomId);
  if (room === undefined) {
    if (import.meta.env.DEV) {
      console.log(`[chunkPrewarm:ensure] ${roomId} not in registry — skip (${reason})`);
    }
    return;
  }

  // Compute entrance offset from the current room's transition to this room.
  let offsetXPx = 0;
  let offsetYPx = 0;
  // Fall back to typical virtual-canvas dimensions if the scheduler has not yet
  // processed a frame (i.e. scheduleChunkPrewarms has not been called).  These
  // values match BASE_VIRTUAL_WIDTH_PX / FIXED_VIRTUAL_HEIGHT_PX in gameScreen.ts
  // and are safe defaults; in steady-state play _lastVpWPx/_lastVpHPx are always set.
  const vpW = _lastVpWPx > 0 ? _lastVpWPx : 480;
  const vpH = _lastVpHPx > 0 ? _lastVpHPx : 270;
  const sp  = _lastScalePx > 0 ? _lastScalePx : 1;
  if (_currentRoomId !== null) {
    const currentRoomDef = _roomRegistry.get(_currentRoomId);
    if (currentRoomDef !== undefined) {
      const trans = currentRoomDef.transitions.find(t => t.targetRoomId === roomId);
      if (trans !== undefined) {
        const off = computeEntranceOffset(trans, vpW, vpH, sp);
        offsetXPx = off.offsetXPx;
        offsetYPx = off.offsetYPx;
      }
    }
  }

  // Create a new radius-1 task at the front of the queue.
  _queue.unshift({
    roomId,
    radius: 1,
    offsetXPx,
    offsetYPx,
    vpWPx:  vpW,
    vpHPx:  vpH,
    scalePx: sp,
    transitionDir: undefined,
    wallDone: false,
    bgDone:   false,
  });

  // Add to the keep-set so the next eviction pass does not remove newly created data.
  _keepIds.add(roomId);

  if (import.meta.env.DEV) {
    console.log(`[chunkPrewarm:ensure] ${roomId} created new task at front (${reason})`);
  }

  if (_idleHandle === 0 && !_cancelled) {
    _idleHandle = _scheduleIdle(_onIdle);
  }
}

/**
 * Moves the warm task for `roomId` to the front of the idle queue.
 *
 * @deprecated Prefer `ensureChunkPrewarmQueued`, which also creates a task
 * if the room is not yet queued.  This wrapper is retained for any external
 * callers that only need the move-to-front behaviour.
 */
export function prioritizeChunkPrewarm(roomId: string): void {
  ensureChunkPrewarmQueued(roomId, 'manual');
}

/**
 * Returns a snapshot of the prewarm store readiness for a room, captured
 * **before** adoption (which clears the store entry).
 *
 * Intended for building `TransitionReadinessDiagnostic` in `startTransitionLoad`.
 */
export function getRoomPrewarmReadiness(roomId: string): { wallPresent: boolean; bgPresent: boolean } {
  return {
    wallPresent: getPrewarmWallRoomStats(roomId) !== null,
    bgPresent:   getPrewarmBgRoomStats(roomId)   !== null,
  };
}

/**
 * Evicts pre-warmed wall and bg chunks for `roomId` and removes it from the
 * keep-set so it will be re-queued on the next `scheduleChunkPrewarms`.
 *
 * Call this whenever editor changes invalidate a room's cached runtime data.
 * This prevents stale chunk canvases from being adopted on the next room entry.
 */
export function invalidateRoomChunkPrewarm(roomId: string): void {
  evictPrewarmedWallChunks(roomId);
  evictPrewarmedBgChunks(roomId);
  // Remove from the keep-set so the scheduler's next eviction pass does not
  // inadvertently protect it, and so that scheduleChunkPrewarms will re-add it.
  _keepIds.delete(roomId);
  if (import.meta.env.DEV) {
    console.log(`[chunkPrewarm:invalidate] evicted chunks for ${roomId}`);
  }
}

// ── Adoption on room entry ────────────────────────────────────────────────────

/**
 * Attempts to adopt pre-warmed chunks when the player enters `room`.
 *
 * Call this in `_makeLoadRoomPhases` Phase A, after setting up lighting and
 * theme but BEFORE the first render frame.
 *
 * When `renderStateKey` is provided it is forwarded to the individual adoption
 * functions so they can refuse chunks whose snapshot key no longer matches the
 * active room render state (stale-key protection).
 *
 * Updates the prewarm stats with cache hit/miss information.
 */
export function adoptPrewarmedChunksForRoom(
  room: RoomDef,
  scalePx: number,
  renderStateKey?: string,
): void {
  const wallHit = adoptPrewarmedWallChunks(room.id, scalePx, renderStateKey);
  const bgHit   = adoptPrewarmedBgChunks(room, scalePx, renderStateKey);

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
  const evictedRoomIds = new Set<string>();

  // ── Step 1: drop rooms outside the keep set ───────────────────────────────
  for (const roomId of listPrewarmedWallRoomIds()) {
    if (!keepRoomIds.has(roomId) && roomId !== currentRoom) {
      evictPrewarmedWallChunks(roomId);
      evictedRoomIds.add(roomId);
    }
  }
  for (const roomId of listPrewarmedBgRoomIds()) {
    if (!keepRoomIds.has(roomId) && roomId !== currentRoom) {
      evictPrewarmedBgChunks(roomId);
      evictedRoomIds.add(roomId);
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
      evictedRoomIds.add(roomId);
    }
  }

  const evictedThisPass = evictedRoomIds.size;
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
  let chunksBuilt   = 0;
  let chunksSkipped = 0;
  let deferredNotReady        = _stats.deferredNotReady;
  let deferredSpritesNotReady = _stats.deferredSpritesNotReady;
  // How many not-ready tasks we've skipped over in this slice.
  // When this reaches MAX_DEFERRALS_PER_SLICE the slice stops so we don't
  // loop through the entire queue when everything is blocked.
  const MAX_DEFERRALS_PER_SLICE = 3;
  let deferralCountThisSlice = 0;

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
      // Room data not ready yet; move to back and try another task this slice.
      // If too many consecutive deferrals accumulate, stop to avoid spinning.
      deferredNotReady++;
      _queue.push(_queue.shift()!);
      deferralCountThisSlice++;
      if (deferralCountThisSlice >= MAX_DEFERRALS_PER_SLICE) break;
      continue;
    }

    // Defer if sprites are not ready (don't bake fallback rectangles).
    if (!areRoomSpritesReady(room)) {
      deferredSpritesNotReady++;
      _queue.push(_queue.shift()!);
      deferralCountThisSlice++;
      if (deferralCountThisSlice >= MAX_DEFERRALS_PER_SLICE) break;
      continue;
    }

    const remaining = chunksLimit - chunksBuilt;

    // ── Build wall chunks ─────────────────────────────────────────────────
    // Only defer when blockerKeys is null (not yet computed).
    // undefined = computed, no blockers — _makeWallPrewarmCtx converts to empty Set.
    if (!task.wallDone && entry.blockerKeys !== null) {
      const wallSnap = _wallTemplateToSnapshot(entry.wallTemplate);
      const wallCtx  = _makeWallPrewarmCtx(room, wallSnap, entry.blockerKeys);
      const wallResult = prewarmWallChunksForRoom(
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
      FP.recordPrewarmSlice(wallResult.rebuilt);
      chunksBuilt   += wallResult.rebuilt;
      chunksSkipped += wallResult.skipped;
      if (wallResult.rebuilt === 0 && wallResult.skipped === 0) task.wallDone = true;
    }

    // ── Build bg chunks ───────────────────────────────────────────────────
    if (!task.bgDone && deadline.timeRemaining() >= MIN_IDLE_REMAINING_MS && chunksBuilt < chunksLimit) {
      const bgRemaining = chunksLimit - chunksBuilt;
      const bgResult = prewarmBgChunksForRoom(
        room,
        task.scalePx,
        task.offsetXPx,
        task.offsetYPx,
        task.vpWPx,
        task.vpHPx,
        bgRemaining,
      );
      FP.recordPrewarmSlice(bgResult.rebuilt);
      chunksBuilt   += bgResult.rebuilt;
      chunksSkipped += bgResult.skipped;
      if (bgResult.rebuilt === 0 && bgResult.skipped === 0) task.bgDone = true;
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

  // ── Post-slice memory budget enforcement ───────────────────────────────────
  // If chunk building during this slice pushed total prewarm memory over the
  // quality-tier budget, evict stale rooms now.  _keepIds contains all rooms
  // that are within the BFS neighbourhood of the current schedule, so
  // completed-but-still-nearby rooms are not accidentally evicted.
  if (chunksBuilt > 0 && _getQuality !== null) {
    const q = _getQuality();
    const budget = PREWARM_MEMORY_BUDGET_KB[q];
    const ws = getPrewarmWallStats();
    const bs = getPrewarmBgStats();
    if (ws.memoryEstimateKB + bs.memoryEstimateKB > budget) {
      evictStalePrewarmedChunks(_keepIds, q);
    }
  }

  _stats = {
    ..._refreshStatsObj(),
    chunksLastSlice:         chunksBuilt,
    chunksSkippedLastSlice:  chunksSkipped,
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
  const quality = _getQuality?.() ?? null;
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
    memoryBudgetKB:       quality !== null ? PREWARM_MEMORY_BUDGET_KB[quality] : 0,
  };
}

function _refreshStats(): void {
  _stats = _refreshStatsObj();
}

// End of roomRenderChunkWarmScheduler.ts
