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
 * BUILD 561
 */

import type { RoomDef, TransitionDirection } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { bfsNearbyRooms, computeEntranceOffset } from './roomPrewarmNeighborhood';
import { computeDirectedEntryViewport } from './transitionEntryGeometry';
import type { PrewarmAdoptResult, DirectedEntry } from '../render/walls/roomRenderCacheStore';
import { isWallPrewarmViewportCovered, isBgPrewarmViewportCovered, getCacheBundle } from '../render/walls/roomRenderCacheStore';
import {
  makeWallPrewarmCtx,
  wallTemplateToSnapshot,
  computeRoomRenderStateKey,
} from '../render/walls/roomRenderState';
import {
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
import type { RoomRuntimeCache, RoomRuntimeEntry } from './roomRuntimeCache';
import { isEntryFullyPrepared } from './roomRuntimeCache';
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

// ── Transition outcome tracking ───────────────────────────────────────────────

/**
 * Records whether the most recent room transition used:
 *  - 'residentWorldHot' — TRUE hot-swap; resident WorldState activated, loadRoom NOT called.
 *  - 'residentHot'      — snapshot-restore (loadRoom ran, snapshots patched back).
 *                         Kept for backward compatibility; prefer 'residentRestore' in new code.
 *  - 'residentRestore'  — snapshot-restore (loadRoom ran, frozen enemy state patched back).
 *  - 'residentFallback' — loadRoom ran but no frozen state to restore (first visit via instant path).
 *  - 'hot'              — instant, no overlay (chunk caches were ready and valid).
 *  - 'entryWarm'        — instant load but brief textless cover while chunks warmed.
 *  - 'loading'          — full async load with "Loading…" overlay (cold cache miss).
 *  - 'none'             — no transition has occurred yet.
 */
export type TransitionOutcome = 'residentWorldHot' | 'residentHot' | 'residentRestore' | 'residentFallback' | 'hot' | 'entryWarm' | 'loading' | 'none';

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
   * For rooms with no background blocks this is always `true`.
   */
  bgPrewarmPresent: boolean;
  /**
   * Whether background blocks are required for this room (`false` for rooms
   * with no background blocks, in which case `bgPrewarmPresent` is trivially true).
   */
  bgPrewarmRequired: boolean;
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
   * Whether all folder-based sprites for the target room were decoded at transition time.
   * `null` when the information was not available.
   */
  spritesDecoded: boolean | null;
  /**
   * Whether the background image for the target room was decoded at transition time.
   * `null` when the information was not available.
   */
  backgroundDecoded: boolean | null;
  /**
   * Primary reason the transition was not hot.
   *  - 'none'                  — transition was hot.
   *  - 'runtimeNotReady'       — runtime cache miss (full async overlay).
   *  - 'wallChunksMissing'     — no wall prewarm data was present.
   *  - 'bgChunksMissing'       — no bg prewarm data was present.
   *  - 'staleRenderState'      — prewarm snapshot existed but its renderStateKey did not
   *                               match the current room render state (wall or bg).
   *  - 'wallAdoptEmpty'        — wall prewarm data existed but yielded zero clean chunks.
   *  - 'bgAdoptEmpty'          — bg prewarm data existed but yielded zero clean chunks.
   *  - 'entryViewportNotCovered' — data present but did not cover the entry viewport
   *                                (may indicate partial coverage or wrong entrance offset).
   *  - 'unknown'               — outcome was not hot for an unclassified reason.
   */
  missReason:
    | 'none'
    | 'runtimeNotReady'
    | 'wallChunksMissing'
    | 'bgChunksMissing'
    | 'staleRenderState'
    | 'wallAdoptEmpty'
    | 'bgAdoptEmpty'
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
  /**
   * COUNT OF DEFERRAL EVENTS (not a distinct-room count): incremented every
   * time a radius-3 task already in the active queue is rotated to the back
   * because frame time was poor while quality is 'high'. The same task can
   * be deferred multiple times across slices, so this number can exceed the
   * number of radius-3 rooms. Resets each schedule.
   * Quality-tier suspension (low/med) does NOT increment this counter — see
   * `suspendedRadius3Count` for that case.
   */
  deferredRadius3Events: number;
  /**
   * Radius-3 tasks currently held out of the active queue because graphics
   * quality is not 'high'. These are NOT deferral events — they are parked
   * so the active queue is never repeatedly rotated through ineligible work.
   * They resume into the active queue automatically once quality returns to
   * 'high', without requiring a new room transition.
   */
  suspendedRadius3Count: number;
  /** Radius-3 tasks currently present in the active (non-suspended) queue. */
  activeRadius3Count: number;
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
  deferredRadius3Events:   0,
  suspendedRadius3Count:   0,
  activeRadius3Count:      0,
  lastTransitionOutcome:   'none' as TransitionOutcome,
  lastTransitionDiagnostic: null,
};

/** Read-only snapshot of prewarm stats. Updates every idle callback. */
export function getPrewarmStats(): Readonly<PrewarmStats> {
  return _stats;
}

/** Last structured adoption result from `adoptPrewarmedChunksForRoom`. */
let _lastAdoptionResult: { wall: PrewarmAdoptResult; bg: PrewarmAdoptResult } | null = null;

/**
 * Returns the structured adoption result from the most recent call to
 * `adoptPrewarmedChunksForRoom`.  `null` before any room has been entered.
 *
 * Useful for building `TransitionReadinessDiagnostic` after `loadRoom` returns.
 */
export function getLastAdoptionResult(): { wall: PrewarmAdoptResult; bg: PrewarmAdoptResult } | null {
  return _lastAdoptionResult;
}

// ── Scheduler state ───────────────────────────────────────────────────────────

interface WarmTask {
  roomId: string;
  radius: number;
  /** Explicit directed entry identity if this task is warming for a specific transition. */
  directedEntry?: DirectedEntry;
  /**
   * Stable identity of the directed transition this task satisfies
   * (`${sourceRoomId}:${transitionIndex}`), or `undefined` for generic
   * room-level warm tasks.  Used by `addZoneEntryViewportTasks` to recognise
   * a requirement that already has an in-flight task, so the producer can be
   * called every frame without growing the queue.
   */
  entryKey?: string;
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
/**
 * Authoritative schedule-owned priority metadata: room ID -> effective
 * prewarm radius. Unlike `_queue` membership, this survives a task
 * completing (leaving `_queue`) so a completed radius-1 room is never
 * misclassified as speculative radius-3 during memory-budget eviction.
 * Rebuilt from scratch on every `scheduleChunkPrewarms` call (new BFS
 * neighbourhood); individual task-creation paths only ADD entries and never
 * downgrade a room already tracked at a more valuable (lower) radius.
 * Entries are removed by `invalidateRoomChunkPrewarm`. Rooms absent from
 * this map are truly unknown/non-scheduled and are treated as the lowest
 * value (see `evictStalePrewarmedChunks`'s `UNKNOWN_ROOM_RADIUS` fallback).
 */
let _roomPriority: Map<string, number> = new Map();
/**
 * Radius-3 tasks parked out of the active `_queue` because graphics quality
 * is not 'high'. Kept separate from temporary frame-time deferral (which
 * just rotates a task to the back of `_queue`) so the active queue is never
 * repeatedly churned through work that cannot execute until the quality
 * setting itself changes. Resumed into `_queue` automatically once a slice
 * observes quality has returned to 'high' — see `_reconcileRadius3Suspension`.
 */
let _suspendedRadius3: WarmTask[] = [];
/**
 * Quality tier observed on the most recent slice. `null` forces a
 * reconciliation check on the next slice (e.g. right after a schedule
 * (re)start). Comparing against this avoids scanning `_queue`/
 * `_suspendedRadius3` on every slice — only an actual quality change does.
 */
let _lastQualitySeen: 'low' | 'med' | 'high' | null = null;
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
/**
 * Rooms belonging to the active zone, whose pre-warmed chunks back a zone-load
 * readiness requirement and therefore must not be evicted.
 *
 * Mirrors `RoomRuntimeCache.setPinnedRooms` for the render-chunk store.  The
 * quality-tier memory budget is a *soft* limit against these: a zone whose
 * entry viewports do not fit in the budget must exceed it rather than evict
 * coverage the readiness barrier is waiting on — otherwise warming and
 * eviction thrash against each other and the load never completes.
 */
let _zonePinnedRoomIds: ReadonlySet<string> = new Set<string>();

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
  // Fresh BFS neighbourhood → fresh authoritative priority map and cleared
  // suspension state (discards suspended tasks from the prior neighbourhood).
  _roomPriority = new Map();
  _suspendedRadius3 = [];
  _lastQualitySeen = null;
  const currentRoomDef = roomRegistry.get(currentRoom.id);
  if (currentRoomDef === undefined) {
    // Should not happen in practice; currentRoom is always registered.
    if (import.meta.env?.DEV) {
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
    // Authoritative priority: this BFS pass is the source of truth for this
    // room's radius for the lifetime of this schedule, independent of when
    // (or whether) its task finishes and leaves `_queue`.
    _roomPriority.set(roomId, radius);
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
        if (import.meta.env?.DEV) {
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
  _stats = { ..._stats, deferredNotReady: 0, deferredSpritesNotReady: 0, deferredRadius3Events: 0 };

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
    if (import.meta.env?.DEV) {
      console.log(`[chunkPrewarm:ensure] ${roomId} moved to front (${reason})`);
    }
    if (_idleHandle === 0 && !_cancelled) {
      _idleHandle = _scheduleIdle(_onIdle);
    }
    return;
  }

  // Room is NOT in the active queue. It may still be parked in the
  // quality-tier suspension list (e.g. a radius-3 BFS candidate suspended
  // because quality was not 'high') — drop it from there so this explicit
  // priority request never leaves a duplicate stale task behind.
  const suspendedIdx = _suspendedRadius3.findIndex(t => t.roomId === roomId);
  if (suspendedIdx >= 0) {
    _suspendedRadius3.splice(suspendedIdx, 1);
  }

  // If prewarm data is already present for both wall and bg, adoption will pick
  // it up — no need to re-queue.  For rooms with no background blocks, bg is
  // inherently ready (there is nothing to warm).
  if (_roomRegistry === null) return;
  const room = _roomRegistry.get(roomId);
  if (room === undefined) {
    if (import.meta.env?.DEV) {
      console.log(`[chunkPrewarm:ensure] ${roomId} not in registry — skip (${reason})`);
    }
    return;
  }

  const wallReady = getPrewarmWallRoomStats(roomId) !== null;
  const hasBg     = (room.backgroundBlocks?.length ?? 0) > 0;
  const bgReady   = !hasBg || getPrewarmBgRoomStats(roomId) !== null;
  if (wallReady && bgReady) {
    if (import.meta.env?.DEV) {
      console.log(`[chunkPrewarm:ensure] ${roomId} already warmed — skip (${reason})`);
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

  // Authoritative priority: only upgrade (never downgrade) — a room already
  // tracked at a more valuable radius (e.g. a completed radius-1 BFS entry)
  // must not be demoted just because an ensure-request re-touches it at the
  // generic radius-1 task-creation default.
  _roomPriority.set(roomId, Math.min(_roomPriority.get(roomId) ?? Infinity, 1));

  // Add to the keep-set so the next eviction pass does not remove newly created data.
  _keepIds.add(roomId);

  if (import.meta.env?.DEV) {
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
 * `bgPrewarmRequired` is `false` when the room has no background blocks —
 * that room is inherently bg-ready regardless of whether prewarm data exists.
 *
 * Intended for building `TransitionReadinessDiagnostic` in `startTransitionLoad`.
 */
export function getRoomPrewarmReadiness(
  roomId: string,
  room: RoomDef,
): { wallPresent: boolean; bgPresent: boolean; bgRequired: boolean } {
  const hasBg = (room.backgroundBlocks?.length ?? 0) > 0;
  return {
    wallPresent: getPrewarmWallRoomStats(roomId) !== null,
    bgPresent:   !hasBg || getPrewarmBgRoomStats(roomId) !== null,
    bgRequired:  hasBg,
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
  // Drop authoritative priority metadata so a stale radius classification
  // cannot protect this room during a later eviction pass, and drop any
  // parked suspended task so invalidation cannot be silently undone by a
  // later quality-change resume.
  _roomPriority.delete(roomId);
  const suspendedIdx = _suspendedRadius3.findIndex(t => t.roomId === roomId);
  if (suspendedIdx >= 0) {
    _suspendedRadius3.splice(suspendedIdx, 1);
  }
  if (import.meta.env?.DEV) {
    console.log(`[chunkPrewarm:invalidate] evicted chunks for ${roomId}`);
  }
}

// ── Zone entry-viewport warm ─────────────────────────────────────────────────

/**
 * Marks `roomIds` as belonging to the active zone, protecting their pre-warmed
 * render chunks from both stale-set and memory-budget eviction.
 *
 * The render-chunk counterpart of `RoomRuntimeCache.setPinnedRooms`, and it
 * must be kept in step with it: zone-load readiness requires entry-viewport
 * coverage for every same-zone transition, so any room whose chunks can be
 * evicted mid-load is a requirement that can be un-satisfied after being
 * satisfied — warming and eviction then thrash and the barrier never closes.
 *
 * Replaces the previous set entirely; pass an empty iterable to unpin.
 */
export function setPinnedPrewarmRooms(roomIds: Iterable<string>): void {
  _zonePinnedRoomIds = new Set<string>(roomIds);
}

/** Room IDs currently protected by `setPinnedPrewarmRooms` (diagnostics). */
export function getPinnedPrewarmRoomIds(): ReadonlySet<string> {
  return _zonePinnedRoomIds;
}

/**
 * Outcome of one `addZoneEntryViewportTasks` pass, so the caller can assert the
 * invariant that every unsatisfied zone-entry readiness requirement has an
 * executable or active task behind it.
 *
 * `isZoneEntryReadinessComplete` requires wall (and, where applicable, bg)
 * viewport coverage for *every* same-zone directed transition.  This producer
 * is the only thing that creates the tasks which generate that coverage, so
 * the two must enumerate the same requirement set.  Returning the counts makes
 * a mismatch observable instead of silently deadlocking the load.
 */
export interface ZoneEntryQueueResult {
  /** Same-zone directed transitions that require coverage. */
  required: number;
  /** Requirements already satisfied by existing prewarm data. */
  covered: number;
  /** Requirements that already had an in-flight task (no duplicate created). */
  alreadyQueued: number;
  /** Tasks newly appended to the queue by this pass. */
  added: number;
  /**
   * Requirements that could NOT be queued because their source or target
   * runtime-cache entry was absent / not fully prepared, or the target's
   * render-state key was not yet computable.  These are the requirements with
   * no executable task — a non-empty list means readiness cannot progress
   * until the underlying room data is prepared.
   */
  blocked: string[];
}

/**
 * Ensures a prewarm task exists for every same-zone directed transition whose
 * entry viewport is not yet covered.  Tasks are added to the END of the idle
 * queue so they do not displace proximity or velocity-direction tasks for the
 * current room.
 *
 * **Idempotent — safe (and intended) to call every frame while a zone load is
 * active.**  Requirements that are already covered, or that already have an
 * in-flight task with the same directed-entry identity, are skipped rather
 * than re-queued.  This is what guarantees the readiness barrier can never
 * wait on a requirement that has no task: if a task is dropped, completes
 * without achieving coverage, or was never creatable because room data was not
 * ready at the time, the next call re-creates it.
 *
 * (Previously this was a one-shot call latched by the caller.  On a cold zone
 * load it ran before any resident build had populated `RoomRuntimeCache`, so
 * every transition hit the `continue` paths below, zero tasks were queued, and
 * the latch prevented any retry — leaving `isZoneEntryReadinessComplete()`
 * permanently false with an empty queue and the loading overlay stuck at N/N.)
 *
 * @param zoneRoomIds   Room IDs belonging to the zone.
 * @param registry      Full room registry.
 * @param runtimeCache  The shared `RoomRuntimeCache` instance.
 * @param vpWPx         Viewport width  (virtual pixels).
 * @param vpHPx         Viewport height (virtual pixels).
 * @param scalePx       Camera scale factor (usually 1.0).
 */
export function addZoneEntryViewportTasks(
  zoneRoomIds: readonly string[],
  registry:    ReadonlyMap<string, RoomDef>,
  runtimeCache: RoomRuntimeCache,
  vpWPx:       number,
  vpHPx:       number,
  scalePx:     number,
): ZoneEntryQueueResult {
  const result: ZoneEntryQueueResult = {
    required: 0, covered: 0, alreadyQueued: 0, added: 0, blocked: [],
  };
  if (_cancelled) return result;
  if (!runtimeCache) return result;

  // On a cold app launch this runs before any room transition has ever called
  // `scheduleChunkPrewarms()` — the only other place that sets the module-level
  // `_roomRegistry`/`_runtimeCache`/`_getQuality`/`_getLastFrameMs` singletons.
  // Without this, `_runSlice` reads `_roomRegistry === null`, treats every
  // queued task's room as "not in registry", and silently drops it — so the
  // corresponding `isWallPrewarmViewportCovered`/`isBgPrewarmViewportCovered`
  // checks in `isZoneEntryReadinessComplete()` can never pass, and the initial
  // zone-load readiness barrier hangs forever (observed as the loading overlay
  // stuck at "N/N" after all resident builds finish). Only fill in state that
  // is still unset — an active `scheduleChunkPrewarms()` schedule (real room
  // transition) must not be clobbered by a later zone-load call.
  if (_roomRegistry === null) _roomRegistry = registry;
  if (_runtimeCache === null) _runtimeCache = runtimeCache;
  if (_getQuality === null) _getQuality = () => 'med';
  if (_getLastFrameMs === null) _getLastFrameMs = () => 0;

  for (const sourceId of zoneRoomIds) {
    const sourceRoom = registry.get(sourceId);
    if (!sourceRoom) continue;

    for (let i = 0; i < sourceRoom.transitions.length; i++) {
      const trans = sourceRoom.transitions[i];
      if (!zoneRoomIds.includes(trans.targetRoomId)) continue;

      const targetRoom = registry.get(trans.targetRoomId);
      if (!targetRoom) continue;

      // This directed transition is a readiness requirement from here on —
      // count it before any early-out so `required` matches exactly what
      // `isZoneEntryReadinessComplete` will demand.
      result.required++;
      const entryKey = `${sourceId}:${i}`;

      const sourceRuntime = runtimeCache.get(sourceId);
      const targetRuntime = runtimeCache.get(trans.targetRoomId);
      const targetRenderKey =
        targetRuntime !== undefined ? computeRenderStateKeyForEntry(targetRoom, targetRuntime) : null;
      if (sourceRuntime === undefined || targetRuntime === undefined || !targetRenderKey) {
        // Room data not prepared yet — this requirement has no executable task
        // this frame.  Reported, not swallowed; a later call will queue it once
        // the runtime entry exists.
        result.blocked.push(entryKey);
        continue;
      }

      // Warm the SWEPT entry region — the union of the camera viewport over
      // every spawn the runtime can actually produce for this crossing — not
      // the single viewport implied by the authored `targetSpawnBlock` hint.
      // The hint is not what activation uses (see transitionEntryGeometry.ts),
      // so warming it left `canSkipEntryWarm()` false on essentially every
      // crossing.  Costs ~1.14x a single viewport on the shipping campaign.
      const swept = computeDirectedEntryViewport(sourceRoom, i, targetRoom, vpWPx, vpHPx, scalePx);
      if (swept === null) {
        result.blocked.push(entryKey);
        continue;
      }

      const entry: DirectedEntry = {
        sourceRoomId: sourceId,
        sourceTransitionKey: `${sourceId}:${i}`,
        targetRoomId: trans.targetRoomId,
        targetSpawnBlock: trans.targetSpawnBlock,
        targetRenderKey,
        targetRenderRevision: targetRuntime.renderRevision,
        vpWPx: swept.vpWPx,
        vpHPx: swept.vpHPx,
        scalePx
      };

      const off = { offsetXPx: swept.offsetXPx, offsetYPx: swept.offsetYPx };

      // Check if already covered
      const wallReady = isWallPrewarmViewportCovered(entry, off.offsetXPx, off.offsetYPx);
      const hasBg = (targetRoom.backgroundBlocks?.length ?? 0) > 0;
      const bgReady = !hasBg || isBgPrewarmViewportCovered(entry, off.offsetXPx, off.offsetYPx);

      if (wallReady && bgReady) { result.covered++; continue; }

      // Idempotency: never create a second task for a requirement that already
      // has one in flight (active queue or quality-tier suspension).
      if (_queue.some(t => t.entryKey === entryKey) ||
          _suspendedRadius3.some(t => t.entryKey === entryKey)) {
        result.alreadyQueued++;
        continue;
      }

      _queue.push({
        roomId: entry.targetRoomId,
        radius: 2,
        directedEntry: entry,
        entryKey,
        offsetXPx: off.offsetXPx,
        offsetYPx: off.offsetYPx,
        // MUST be the SWEPT dimensions, not the raw viewport.  The coverage
        // predicate this task exists to satisfy (`isWallPrewarmViewportCovered`
        // via `collectZoneEntryReadinessReport`) tests `swept.vpWPx/vpHPx`,
        // which are the base viewport grown by the spawn spread.  Warming only
        // the base viewport built a strictly smaller region than the predicate
        // demands: the task completed, was popped, the requirement was still
        // uncovered, the next frame re-queued an identical task — an unbounded
        // loop with the zone overlay stuck at "N/N".
        vpWPx: swept.vpWPx,
        vpHPx: swept.vpHPx,
        scalePx,
        transitionDir: undefined,
        wallDone: false,
        bgDone: false,
      });
      _roomPriority.set(entry.targetRoomId, Math.min(_roomPriority.get(entry.targetRoomId) ?? Infinity, 2));
      // Zone-entry tasks are readiness-critical: protect their output from the
      // post-slice memory-budget eviction pass that would otherwise be free to
      // drop a just-built bundle and re-open the requirement.
      _keepIds.add(entry.targetRoomId);
      result.added++;
    }
  }

  if (result.added > 0) {
    if (import.meta.env?.DEV) {
      console.log(`[chunkPrewarm:zone] addZoneEntryViewportTasks: added ${result.added} tasks`);
    }
    if (_idleHandle === 0 && !_cancelled) {
      _idleHandle = _scheduleIdle(_onIdle);
    }
  }

  return result;
}

function computeRenderStateKeyForEntry(room: RoomDef, runtime: RoomRuntimeEntry): string | null {
  if (runtime.blockerKeys === null) return null;
  // undefined means computed successfully with no blockers, pass it through
  return computeRoomRenderStateKey(room, runtime.blockerKeys as ReadonlySet<string> | undefined);
}

/**
 * One unsatisfied zone-entry readiness requirement, with the exact
 * subcondition that failed rather than a bare `false`.
 */
export interface ZoneEntryReadinessFailure {
  /** `${sourceRoomId}:${transitionIndex}`, or the room id for room-level failures. */
  entryKey: string;
  sourceRoomId: string;
  /** `null` for room-level failures that occur before a transition is examined. */
  targetRoomId: string | null;
  reason:
    | 'sourceRoomNotInRegistry'
    | 'sourceRuntimeEntryAbsent'
    | 'sourceRuntimeNotFullyPrepared'
    | 'targetRoomNotInRegistry'
    | 'targetRuntimeEntryAbsent'
    | 'targetRuntimeNotFullyPrepared'
    | 'targetSpritesNotDecoded'
    | 'targetRenderStateKeyNotComputable'
    | 'wallViewportNotCovered'
    | 'bgViewportNotCovered';
}

/**
 * Aggregate report of every unsatisfied same-zone directed-entry requirement.
 *
 * Unlike `isZoneEntryReadinessComplete` (which short-circuits), this evaluates
 * **all** requirements so the zone-load diagnostic snapshot can name every
 * blocking subcondition at once instead of revealing them one reload at a time.
 * Pure — no console output, safe to call from a diagnostic path.
 */
export function collectZoneEntryReadinessReport(
  zoneRoomIds: readonly string[],
  registry:    ReadonlyMap<string, RoomDef>,
  runtimeCache: RoomRuntimeCache,
  vpWPx:       number,
  vpHPx:       number,
  scalePx:     number,
): { required: number; satisfied: number; failures: ZoneEntryReadinessFailure[] } {
  const failures: ZoneEntryReadinessFailure[] = [];
  let required  = 0;
  let satisfied = 0;
  if (!runtimeCache) {
    return { required: 0, satisfied: 0, failures: [] };
  }

  for (const sourceId of zoneRoomIds) {
    const sourceRoom = registry.get(sourceId);
    if (!sourceRoom) {
      failures.push({ entryKey: sourceId, sourceRoomId: sourceId, targetRoomId: null, reason: 'sourceRoomNotInRegistry' });
      continue;
    }

    // Source room's own static runtime data must be prepared before any of its
    // outgoing transitions can be considered ready.
    const sourceRuntime = runtimeCache.get(sourceId);
    if (sourceRuntime === undefined) {
      failures.push({ entryKey: sourceId, sourceRoomId: sourceId, targetRoomId: null, reason: 'sourceRuntimeEntryAbsent' });
      continue;
    }
    if (!isEntryFullyPrepared(sourceRuntime)) {
      failures.push({ entryKey: sourceId, sourceRoomId: sourceId, targetRoomId: null, reason: 'sourceRuntimeNotFullyPrepared' });
      continue;
    }

    for (let i = 0; i < sourceRoom.transitions.length; i++) {
      const trans = sourceRoom.transitions[i];
      if (!zoneRoomIds.includes(trans.targetRoomId)) continue;

      required++;
      const entryKey = `${sourceId}:${i}`;
      const push = (reason: ZoneEntryReadinessFailure['reason']): void => {
        failures.push({ entryKey, sourceRoomId: sourceId, targetRoomId: trans.targetRoomId, reason });
      };

      const targetRoom = registry.get(trans.targetRoomId);
      if (!targetRoom)                      { push('targetRoomNotInRegistry'); continue; }

      const targetRuntime = runtimeCache.get(trans.targetRoomId);
      if (targetRuntime === undefined)      { push('targetRuntimeEntryAbsent'); continue; }
      if (!isEntryFullyPrepared(targetRuntime)) { push('targetRuntimeNotFullyPrepared'); continue; }
      if (!areRoomSpritesReady(targetRoom)) { push('targetSpritesNotDecoded'); continue; }

      const targetRenderKey = computeRenderStateKeyForEntry(targetRoom, targetRuntime);
      if (!targetRenderKey)                 { push('targetRenderStateKeyNotComputable'); continue; }

      // MUST use the same swept-region derivation as addZoneEntryViewportTasks
      // above: producer and predicate enumerating different requirements is
      // exactly what let a zone report ready while activation still needed an
      // entry warm.  Both now route through transitionEntryGeometry.ts.
      const swept = computeDirectedEntryViewport(sourceRoom, i, targetRoom, vpWPx, vpHPx, scalePx);
      if (swept === null)                   { push('targetRenderStateKeyNotComputable'); continue; }

      const entry: DirectedEntry = {
        sourceRoomId: sourceId,
        sourceTransitionKey: entryKey,
        targetRoomId: trans.targetRoomId,
        targetSpawnBlock: trans.targetSpawnBlock,
        targetRenderKey,
        targetRenderRevision: targetRuntime.renderRevision,
        vpWPx: swept.vpWPx,
        vpHPx: swept.vpHPx,
        scalePx,
      };
      const off = { offsetXPx: swept.offsetXPx, offsetYPx: swept.offsetYPx };

      if (!isWallPrewarmViewportCovered(entry, off.offsetXPx, off.offsetYPx)) {
        push('wallViewportNotCovered');
        continue;
      }
      const hasBg = (targetRoom.backgroundBlocks?.length ?? 0) > 0;
      if (hasBg && !isBgPrewarmViewportCovered(entry, off.offsetXPx, off.offsetYPx)) {
        push('bgViewportNotCovered');
        continue;
      }
      satisfied++;
    }
  }

  return { required, satisfied, failures };
}

/**
 * Validates that every same-zone directed transition is fully covered and ready.
 *
 * Strictness is unchanged: this is true only when `collectZoneEntryReadinessReport`
 * finds zero unsatisfied requirements.
 */
export function isZoneEntryReadinessComplete(
  zoneRoomIds: readonly string[],
  registry:    ReadonlyMap<string, RoomDef>,
  runtimeCache: RoomRuntimeCache,
  vpWPx:       number,
  vpHPx:       number,
  scalePx:     number,
): boolean {
  if (!runtimeCache) return false;
  return collectZoneEntryReadinessReport(
    zoneRoomIds, registry, runtimeCache, vpWPx, vpHPx, scalePx,
  ).failures.length === 0;
}

// ── Adoption on room entry ────────────────────────────────────────────────────

/**
 * Attempts to adopt pre-warmed chunks when the player enters `room`.
 *
 * Call this in `_makeLoadRoomPhases` Phase A, after setting up lighting and
 * theme but BEFORE the first render frame.
 *
 * `renderStateKey` is forwarded to the individual adoption functions so they
 * can refuse chunks whose snapshot key no longer matches the active room
 * render state (stale-key protection).
 *
 * Updates the prewarm stats with cache hit/miss information.
 *
 * @returns The structured adoption results for both wall and bg, so callers can
 *   record diagnostics (e.g. `staleRenderState` miss reasons).
 */
export function adoptPrewarmedChunksForRoom(
  room: RoomDef,
  scalePx: number,
  renderStateKey: string,
): { wall: PrewarmAdoptResult; bg: PrewarmAdoptResult } {
  const wallResult = adoptPrewarmedWallChunks(room.id, scalePx, renderStateKey);
  const bgResult   = adoptPrewarmedBgChunks(room, scalePx, renderStateKey);

  const wallHit = wallResult.status === 'adopted';
  const bgHit   = bgResult.status === 'adopted';

  if (import.meta.env?.DEV) {
    if (wallHit || bgHit) {
      console.log(`[chunkPrewarm] adopted chunks for ${room.id}: wall=${wallResult.status} bg=${bgResult.status}`);
    } else if (wallResult.status !== 'missing' || bgResult.status !== 'missing') {
      console.log(`[chunkPrewarm] adoption outcome for ${room.id}: wall=${wallResult.status} bg=${bgResult.status}`);
    }
  }

  _stats = {
    ..._stats,
    wallCacheHits:   wallHit  ? _stats.wallCacheHits  + 1 : _stats.wallCacheHits,
    wallCacheMisses: !wallHit ? _stats.wallCacheMisses + 1 : _stats.wallCacheMisses,
    bgCacheHits:     bgHit    ? _stats.bgCacheHits     + 1 : _stats.bgCacheHits,
    bgCacheMisses:   !bgHit   ? _stats.bgCacheMisses   + 1 : _stats.bgCacheMisses,
  };

  _lastAdoptionResult = { wall: wallResult, bg: bgResult };

  return { wall: wallResult, bg: bgResult };
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
  const isProtected = (roomId: string): boolean =>
    roomId === currentRoom || _zonePinnedRoomIds.has(roomId) || (getCacheBundle(roomId)?.pinned ?? false);

  // ── Step 1: drop rooms outside the keep set ───────────────────────────────
  for (const roomId of listPrewarmedWallRoomIds()) {
    if (isProtected(roomId)) continue;
    if (!keepRoomIds.has(roomId)) {
      evictPrewarmedWallChunks(roomId);
      evictedRoomIds.add(roomId);
    }
  }
  for (const roomId of listPrewarmedBgRoomIds()) {
    if (isProtected(roomId)) continue;
    if (!keepRoomIds.has(roomId)) {
      evictPrewarmedBgChunks(roomId);
      evictedRoomIds.add(roomId);
    }
  }

  // ── Step 2: enforce the memory budget ─────────────────────────────────────
  // The budget governs *discretionary* prewarm memory only.  Chunks belonging
  // to the active zone are pinned because zone readiness requires them, so
  // counting them toward the budget would just make every pass scan a
  // candidate list it cannot act on — and, before pinning existed, made the
  // scheduler evict readiness-critical coverage as fast as it was rebuilt.
  const budget = PREWARM_MEMORY_BUDGET_KB[quality];
  const UNKNOWN_ROOM_RADIUS = MAX_PREWARM_RADIUS + 1;

  // Single scan: every evictable room is both a budget contributor and an
  // eviction candidate, so collecting them together keeps the two consistent.
  interface EvictCandidate { roomId: string; radius: number; memKB: number }
  const candidates: EvictCandidate[] = [];
  const seen = new Set<string>();
  let totalMemKB = 0;

  for (const roomId of listPrewarmedWallRoomIds()) {
    if (isProtected(roomId)) continue;
    seen.add(roomId);
    const memKB = (getPrewarmWallRoomStats(roomId)?.memoryKB ?? 0)
                + (getPrewarmBgRoomStats(roomId)?.memoryKB   ?? 0);
    totalMemKB += memKB;
    candidates.push({ roomId, radius: _roomPriority.get(roomId) ?? UNKNOWN_ROOM_RADIUS, memKB });
  }
  for (const roomId of listPrewarmedBgRoomIds()) {
    if (seen.has(roomId) || isProtected(roomId)) continue;
    const memKB = getPrewarmBgRoomStats(roomId)?.memoryKB ?? 0;
    totalMemKB += memKB;
    candidates.push({ roomId, radius: _roomPriority.get(roomId) ?? UNKNOWN_ROOM_RADIUS, memKB });
  }

  if (totalMemKB > budget) {
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
  _runSlice(deadline);
}

/**
 * Runs one bounded slice of chunk-prewarm work against a caller-supplied
 * deadline, identical in behaviour to the `requestIdleCallback`-driven path.
 *
 * `requestIdleCallback` alone is an unreliable cadence source in a
 * continuously-rendering canvas game: browsers rarely report genuine idle
 * time between animation frames, so real progress often only happens when
 * the `IDLE_TIMEOUT_MS` forced-callback fires — multiple seconds apart.  A
 * player can easily reach an adjacent room well before that, leaving
 * "preloaded" rooms still cold on arrival.
 *
 * `runChunkPrewarmSliceNow` lets `gameScreen.ts`'s own RAF loop drive
 * progress deterministically from *measured* spare frame time (see the
 * frame-budget preload slice in gameScreen.ts), which is both more frequent
 * and safer than a forced idle timeout — the caller already knows exactly
 * how much time is actually spare this frame, rather than the browser
 * guessing after a multi-second wait.
 *
 * Safe to call every frame: it is a no-op when the queue is empty or the
 * schedule has been cancelled, and internally respects the same per-slice
 * chunk/time budgets as the idle path.
 */
export function runChunkPrewarmSliceNow(maxMs: number): void {
  // Even when the active queue is empty, a slice must still run if radius-3
  // work is parked in quality-tier suspension — that is what lets suspended
  // work resume as soon as quality returns to 'high', driven by this same
  // per-frame call site rather than a new dedicated poll.
  if (_cancelled || (_queue.length === 0 && _suspendedRadius3.length === 0)) return;
  // Cancel any pending idle callback so this slice and the idle-triggered
  // slice never double-process the same queue head in the same tick.
  if (_idleHandle !== 0) {
    _cancelIdle(_idleHandle);
    _idleHandle = 0;
  }
  _runSlice({ timeRemaining: () => maxMs, didTimeout: false });
}

/**
 * Reconciles radius-3 tasks between the active `_queue` and quality-tier
 * suspension whenever the observed quality tier changes:
 *  - Quality leaves 'high': every radius-3 task still in `_queue` is moved
 *    into `_suspendedRadius3` so the active queue is never repeatedly
 *    rotated through work that cannot execute until quality changes back.
 *  - Quality returns to 'high': every suspended task is moved back into
 *    `_queue` so it becomes eligible again without a new room transition.
 *
 * No-ops when quality hasn't changed since the last call (`_lastQualitySeen`),
 * so this never scans `_queue`/`_suspendedRadius3` on quality-stable slices.
 */
function _reconcileRadius3Suspension(quality: 'low' | 'med' | 'high'): void {
  if (quality === _lastQualitySeen) return;
  _lastQualitySeen = quality;
  if (!RADIUS3_HIGH_QUALITY_ONLY) return;

  if (quality !== 'high') {
    if (_queue.length === 0) return;
    const stillActive: WarmTask[] = [];
    for (const task of _queue) {
      if (task.radius >= 3) _suspendedRadius3.push(task);
      else stillActive.push(task);
    }
    _queue = stillActive;
  } else if (_suspendedRadius3.length > 0) {
    _queue.push(..._suspendedRadius3);
    _suspendedRadius3 = [];
  }
}

function _runSlice(deadline: IdleDeadline): void {
  if (_cancelled) return;

  const quality     = _getQuality?.()     ?? 'med';
  const lastFrameMs = _getLastFrameMs?.() ?? 0;
  _reconcileRadius3Suspension(quality);

  if (_queue.length === 0) {
    _refreshStats();
    return;
  }

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
  let deferredRadius3Events   = _stats.deferredRadius3Events;
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

    // Quality-tier ineligibility (low/med) is handled entirely by
    // `_reconcileRadius3Suspension` above — a radius-3 task never reaches
    // this point while quality isn't 'high', so no per-slice quality check
    // is needed here. Only TEMPORARY poor-frame-time deferral remains: defer
    // (rotate to the back, not discard) so warming resumes automatically
    // once frame time recovers, without waiting for a new room transition.
    if (task.radius >= 3 && RADIUS3_HIGH_QUALITY_ONLY && framePoor) {
      deferredRadius3Events++;
      _queue.push(_queue.shift()!);
      deferralCountThisSlice++;
      if (deferralCountThisSlice >= MAX_DEFERRALS_PER_SLICE) break;
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
    // undefined = computed, no blockers — makeWallPrewarmCtx converts to empty Set.
    if (!task.wallDone && entry.blockerKeys !== null) {
      const wallSnap = wallTemplateToSnapshot(entry.wallTemplate);
      const wallCtx  = makeWallPrewarmCtx(room, wallSnap, entry.blockerKeys, entry.renderRevision);
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
    deferredRadius3Events:   deferredRadius3Events,
    suspendedRadius3Count:   _suspendedRadius3.length,
    activeRadius3Count:      _queue.reduce((n, t) => t.radius >= 3 ? n + 1 : n, 0),
  };

  // Schedule next slice if there's more work.
  if (_queue.length > 0 && !_cancelled) {
    _idleHandle = _scheduleIdle(_onIdle);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    suspendedRadius3Count: _suspendedRadius3.length,
    activeRadius3Count:    _queue.reduce((n, t) => t.radius >= 3 ? n + 1 : n, 0),
  };
}

function _refreshStats(): void {
  _stats = _refreshStatsObj();
}

// End of roomRenderChunkWarmScheduler.ts
