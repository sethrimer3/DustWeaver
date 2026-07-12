/**
 * residentBuildScheduler.ts — Background resident-world build queue and
 * zone-transition coordination state.
 *
 * Extracted verbatim from the `startGameScreen` closure in gameScreen.ts
 * (BUILD 441).  Owns three pieces of formerly closure-scoped state:
 *
 *  1. `ResidentBuildScheduler` — the priority queue of background resident
 *     WorldState builds, the single active incremental build session, the
 *     per-room version counters used for stale-build rejection, and the
 *     frame-budget gating that decides when work may advance.
 *  2. `ZoneTransitionState` — the pending cross-zone transition record
 *     (formerly `_zoneTransitionLoad`).
 *  3. `InitialZoneLoadProgress` — startup zone-load progress
 *     (formerly `_initialResidentBuildPhase`; the dead radius-2 iteration
 *     fields were dropped — the ZoneResidentLoader drives its own queue).
 *
 * ## Ownership and lifetime
 *
 * One instance of each is created per `startGameScreen` call and must be
 * discarded with it (`ResidentBuildScheduler.reset()` in the screen's cleanup
 * function).  Room-scoped invalidation flows through `bumpRoomVersion` /
 * `queueRebuildAfterEdit`; the scheduler never outlives the screen.
 *
 * ## Allowed dependencies
 *
 * Pure/Node-safe imports only (`bfsNearbyRooms`, types).  Everything with a
 * DOM- or renderer-facing import graph (ResidentRoomManager, the build
 * generator, frame timing, dev logging) is injected via
 * `ResidentBuildSchedulerDeps` as narrow structural ports, which is also what
 * makes the queue/session state machine testable under plain `node --test`.
 *
 * ## Contracts preserved from the closure implementation
 *
 *  - Lower priority number = more urgent.  1 hot-swap proximity target,
 *    2 velocity-direction target, 3 radius-1, 4 radius-2, 5 rebuildAfterEdit.
 *  - Deduplicated by roomId; a later, more-urgent request upgrades the queued
 *    entry (or the active session) in place; priority never downgrades.
 *  - Equal-priority entries keep insertion order (stable sort).
 *  - The active room is never enqueued and is purged at dequeue time, as are
 *    rooms that became runtimeReady while queued.
 *  - At most one build session is active; one generator phase advances per
 *    `advanceFrame()` call.
 *  - Completion publishes to the resident manager ONLY if the room version
 *    captured at dequeue still matches (stale-build rejection).
 *  - A generator error drops the session without blocking queued work.
 *  - Non-urgent work (priority > 2) only starts/advances its heavy walls-build
 *    step when the previous frame had headroom, with forced-start /
 *    deferral caps so background work can never starve indefinitely.
 *  - `queueRebuildAfterEdit` intentionally bypasses roomId coalescing (it
 *    clears the dedup id first), so a room already queued at a better
 *    priority may briefly have two entries; the duplicate is purged at
 *    dequeue once the first build makes the room runtimeReady.
 */

import type { RoomDef } from '../levels/roomDef';
import type { WorldState } from '../sim/world';
import type { TransitionDirection } from './gameTransitions';
import { bfsNearbyRooms } from './roomPrewarmNeighborhood';

// ── Tuning constants (scheduler-owned) ────────────────────────────────────────

/** Priorities at or below this start even when the previous frame was slow. */
export const URGENT_RESIDENT_BUILD_PRIORITY_THRESHOLD = 2;
/**
 * Background work (builds and preload slices) only advances when the previous
 * frame took less than this many ms.  Also used by gameScreen's
 * frame-budget-driven preload slice.
 */
export const RESIDENT_BUILD_BACKGROUND_FRAME_BUDGET_MS = 10;
/** Frames a non-urgent queue head may be budget-blocked before force-starting. */
export const NON_URGENT_RESIDENT_BUILD_FORCED_START_FRAMES = 90;
/** Frames a non-urgent session's heavy walls-build step may defer. */
export const NON_URGENT_WALLS_BUILD_DEFERRAL_FRAMES_CAP = 45;

// ── Types ─────────────────────────────────────────────────────────────────────

export type ResidentBuildPriority = 1 | 2 | 3 | 4 | 5;

export type ResidentBuildReason =
  | 'initial'
  | 'adjacent'
  | 'proximity'
  | 'velocityDirection'
  | 'backtrack'
  | 'rebuildAfterEdit';

export interface ResidentBuildRequest {
  roomId: string;
  /** Resolved from the registry when omitted; request is ignored if absent there too. */
  room?: RoomDef;
  priority: ResidentBuildPriority;
  reason: ResidentBuildReason;
}

interface ResidentBuildTask {
  roomId: string;
  room: RoomDef;
  priority: ResidentBuildPriority;
  reason: ResidentBuildReason;
}

interface ResidentBuildSession {
  task: ResidentBuildTask;
  gen: Generator<string, WorldState, void>;
  t0: number;
  /** Room version at dequeue time — compared at completion for stale rejection. */
  capturedVersion: number;
  currentPhase: string;
  /** Consecutive frames the non-urgent walls_build step has been deferred. */
  deferredFrames: number;
}

/**
 * The subset of ResidentRoomManager the scheduler talks to.  Structural so
 * tests can substitute a plain object without importing the manager.
 */
export interface ResidentBuildManagerPort {
  getResident(roomId: string): { readonly runtimeReady: boolean } | undefined;
  ensureResident(room: RoomDef): void;
  setResidentWorld(roomId: string, world: WorldState, isActive: boolean): void;
  setLastBuildInfo(roomId: string, durationMs: number): void;
  setCurrentBuildInfo(roomId: string | null, reason: string | null, phase?: string | null): void;
  setResidentBuildQueueLength(length: number, byPriority?: [number, number, number, number, number]): void;
}

/**
 * Creates the incremental build generator for one room.  The game screen
 * binds `createResidentBuildGenerator` with its campaign seed, runtime cache,
 * and long-phase diagnostics callback.
 */
export type ResidentBuildGeneratorFactory = (
  room: RoomDef,
  opts: { reason: ResidentBuildReason; priority: ResidentBuildPriority },
) => Generator<string, WorldState, void>;

export interface ResidentBuildSchedulerDeps {
  /** Room registry (ROOM_REGISTRY) used to resolve rooms and BFS adjacency. */
  registry: ReadonlyMap<string, RoomDef>;
  manager: ResidentBuildManagerPort;
  createBuildGenerator: ResidentBuildGeneratorFactory;
  /** The active room — never built in the background. */
  getCurrentRoomId(): string;
  /** Previous frame's wall-clock cost, for background budget gating. */
  getLastFrameMs(): number;
  /** Fired after a build result is published to the manager (not on stale discard). */
  onBuildPublished(): void;
  /** Enables the DEV console diagnostics that the closure version emitted. */
  isDevMode: boolean;
}

// ── ResidentBuildScheduler ────────────────────────────────────────────────────

export class ResidentBuildScheduler {
  private readonly deps: ResidentBuildSchedulerDeps;
  private readonly queue: ResidentBuildTask[] = [];
  private readonly queueIds = new Set<string>();
  private queueDirty = false;
  private activeSession: ResidentBuildSession | null = null;
  /** Per-room version counters for the stale-build guard. */
  private readonly roomVersions = new Map<string, number>();
  private nonUrgentBlockedFrames = 0;

  constructor(deps: ResidentBuildSchedulerDeps) {
    this.deps = deps;
  }

  /**
   * Enqueue a resident build.  Deduplicates by roomId and ignores the active
   * room.  A more-urgent request upgrades the queued entry — or the active
   * session — in place; a less-urgent request for known work is a no-op.
   */
  enqueue(request: ResidentBuildRequest): void {
    if (request.roomId === this.deps.getCurrentRoomId()) return; // Never build active room.
    const room = request.room ?? this.deps.registry.get(request.roomId);
    if (room === undefined) return;
    // If the room is already being built, upgrade the session's priority/reason
    // in-place rather than cancelling it.  Restarting the generator wastes the
    // work done so far; the generator output is the same regardless of priority.
    if (this.activeSession !== null && this.activeSession.task.roomId === request.roomId) {
      if (request.priority < this.activeSession.task.priority) {
        this.activeSession.task.priority = request.priority;
        this.activeSession.task.reason   = request.reason;
        // Reflect the upgraded priority in diagnostics immediately.
        this.deps.manager.setCurrentBuildInfo(
          this.activeSession.task.roomId,
          this.activeSession.task.reason,
          this.activeSession.currentPhase,
        );
        if (this.deps.isDevMode) {
          console.log(
            `[resident] priority upgrade for active session: ${request.roomId}` +
            ` → ${request.priority} (${request.reason})`,
          );
        }
      }
      return; // Session already running — no need to queue.
    }
    if (this.queueIds.has(request.roomId)) {
      // Update priority if the new request is more urgent.
      const idx = this.queue.findIndex(t => t.roomId === request.roomId);
      if (idx >= 0 && request.priority < this.queue[idx].priority) {
        this.queue[idx].priority = request.priority;
        this.queue[idx].reason   = request.reason;
        this.queueDirty = true;
      }
      return;
    }
    this.queueIds.add(request.roomId);
    this.queue.push({ roomId: request.roomId, room, priority: request.priority, reason: request.reason });
    this.queueDirty = true;
  }

  /**
   * Repopulate the queue from a radius-2 BFS of the current room.  Called
   * after every transition and after the initial load so the queue always
   * reflects the player's neighbourhood.  Radius-1 rooms get priority 3;
   * radius-2 rooms priority 4.
   */
  refreshFromNeighborhood(): void {
    for (const [adjId, adjDist] of bfsNearbyRooms(this.deps.getCurrentRoomId(), this.deps.registry, 2)) {
      const adjResident = this.deps.manager.getResident(adjId);
      if (adjResident !== undefined && adjResident.runtimeReady) continue;
      this.enqueue({ roomId: adjId, priority: adjDist === 1 ? 3 : 4, reason: 'adjacent' });
    }
  }

  /**
   * Increment a room's version so in-flight or queued build work captured
   * before the bump is rejected at completion (stale-build guard).
   */
  bumpRoomVersion(roomId: string): void {
    this.roomVersions.set(roomId, (this.roomVersions.get(roomId) ?? 0) + 1);
  }

  /**
   * Queue a post-edit rebuild.  Intentionally bypasses roomId coalescing
   * (clears the dedup id first) so the rebuild request is recorded even when
   * the room is already queued at a more urgent priority; the resulting
   * duplicate entry is purged at dequeue once the room is runtimeReady.
   * Callers must invalidate the resident world and bump the room version
   * themselves (see the editor rebuild path in gameScreen.ts).
   */
  queueRebuildAfterEdit(roomId: string): void {
    this.queueIds.delete(roomId); // allow re-enqueue at rebuild priority
    this.enqueue({ roomId, priority: 5, reason: 'rebuildAfterEdit' });
  }

  /** RoomId and current phase of the in-flight build, or null when idle. */
  getActiveBuild(): { roomId: string; phase: string } | null {
    if (this.activeSession === null) return null;
    return { roomId: this.activeSession.task.roomId, phase: this.activeSession.currentPhase };
  }

  /** True when the room has a queued (not yet started) build entry. */
  hasQueuedBuild(roomId: string): boolean {
    return this.queueIds.has(roomId);
  }

  /** Queue snapshot for tests/diagnostics: `[roomId, priority]` in dequeue order. */
  getQueueSnapshot(): Array<[string, ResidentBuildPriority]> {
    this.sortIfDirty();
    return this.queue.map(t => [t.roomId, t.priority]);
  }

  /**
   * Advance background build work by at most one generator phase, then start
   * a new session if idle, budget permitting.  Call once per RAF frame.
   */
  advanceFrame(): void {
    this.sortIfDirty();

    // Step 1: advance the active session one phase.
    if (this.activeSession !== null) {
      const sess = this.activeSession;
      const lastFrameMs = this.deps.getLastFrameMs();
      const isNonUrgent = sess.task.priority > URGENT_RESIDENT_BUILD_PRIORITY_THRESHOLD;
      // The current phase is 'phaseD_walls_lookup', meaning the NEXT gen.next()
      // call will execute the expensive phaseD_walls_build step.  Gate that
      // step on frame budget so large rooms don't cause a hitch when build
      // priority is non-urgent.
      const isAboutToRunHeavyWallsBuild = sess.currentPhase === 'phaseD_walls_lookup';
      const shouldDeferHeavyWallsStep = isNonUrgent
        && isAboutToRunHeavyWallsBuild
        && lastFrameMs >= RESIDENT_BUILD_BACKGROUND_FRAME_BUDGET_MS
        && sess.deferredFrames < NON_URGENT_WALLS_BUILD_DEFERRAL_FRAMES_CAP;
      if (shouldDeferHeavyWallsStep) {
        sess.deferredFrames++;
      } else {
        sess.deferredFrames = 0;
        try {
          const phaseResult = sess.gen.next();
          if (phaseResult.done) {
            // Generator returned the completed WorldState.
            const buildMs = performance.now() - sess.t0;
            const currentVer = this.roomVersions.get(sess.task.roomId) ?? 0;
            if (sess.capturedVersion === currentVer) {
              this.deps.manager.ensureResident(sess.task.room);
              this.deps.manager.setResidentWorld(sess.task.roomId, phaseResult.value, false);
              this.deps.manager.setLastBuildInfo(sess.task.roomId, buildMs);
              if (this.deps.isDevMode) {
                console.log(
                  `[resident] incremental build done: ${sess.task.roomId}` +
                  ` (reason=${sess.task.reason} pri=${sess.task.priority}) in ${buildMs.toFixed(1)}ms`,
                );
              }
              this.deps.onBuildPublished();
            } else if (this.deps.isDevMode) {
              console.warn(
                `[resident] incremental build DISCARDED (stale): ${sess.task.roomId}` +
                ` ver=${sess.capturedVersion} but current=${currentVer}`,
              );
            }
            this.activeSession = null;
            this.deps.manager.setCurrentBuildInfo(null, null, null);
          } else {
            sess.currentPhase = phaseResult.value;
            this.deps.manager.setCurrentBuildInfo(sess.task.roomId, sess.task.reason, phaseResult.value);
          }
        } catch (sessErr) {
          if (this.deps.isDevMode) {
            console.warn(`[resident] incremental build FAILED: ${sess.task.roomId}`, sessErr);
          }
          this.activeSession = null;
          this.deps.manager.setCurrentBuildInfo(null, null, null);
        }
      }
    }

    // Step 2: start a new session if idle and the queue has work.
    // Priority-1/2 tasks (near-boundary / velocity-direction targets) may
    // start even when the previous frame was over budget so urgent transition
    // candidates don't starve under sustained load.  Background priorities
    // (3–5) respect the budget gate, with a forced start after enough
    // consecutive blocked frames.
    const nextPriority = this.queue.length > 0 ? this.queue[0].priority : null;
    const lastFrameMs = this.deps.getLastFrameMs();
    const isUrgentHead = nextPriority !== null && nextPriority <= URGENT_RESIDENT_BUILD_PRIORITY_THRESHOLD;
    if (nextPriority !== null && !isUrgentHead && lastFrameMs >= RESIDENT_BUILD_BACKGROUND_FRAME_BUDGET_MS) {
      this.nonUrgentBlockedFrames++;
    } else {
      this.nonUrgentBlockedFrames = 0;
    }
    const forceStartNonUrgent = nextPriority !== null
      && nextPriority > URGENT_RESIDENT_BUILD_PRIORITY_THRESHOLD
      && this.nonUrgentBlockedFrames >= NON_URGENT_RESIDENT_BUILD_FORCED_START_FRAMES;
    const canStartSession = nextPriority !== null
      && (isUrgentHead || lastFrameMs < RESIDENT_BUILD_BACKGROUND_FRAME_BUDGET_MS || forceStartNonUrgent);
    if (this.activeSession === null && this.queue.length > 0 && canStartSession) {
      // Purge already-built or active-room entries from the front of the queue.
      let dequeued: ResidentBuildTask | null = null;
      while (this.queue.length > 0) {
        const candidate = this.queue[0];
        if (candidate.roomId === this.deps.getCurrentRoomId()) {
          this.queue.shift();
          this.queueIds.delete(candidate.roomId);
          continue;
        }
        const existing = this.deps.manager.getResident(candidate.roomId);
        if (existing !== undefined && existing.runtimeReady) {
          this.queue.shift();
          this.queueIds.delete(candidate.roomId);
          continue;
        }
        dequeued = this.queue.shift()!;
        this.queueIds.delete(dequeued.roomId);
        break;
      }
      if (dequeued !== null) {
        if (dequeued.priority > URGENT_RESIDENT_BUILD_PRIORITY_THRESHOLD) {
          this.nonUrgentBlockedFrames = 0;
        }
        this.activeSession = {
          task:            dequeued,
          gen:             this.deps.createBuildGenerator(dequeued.room, {
            reason:   dequeued.reason,
            priority: dequeued.priority,
          }),
          t0:              performance.now(),
          capturedVersion: this.roomVersions.get(dequeued.roomId) ?? 0,
          currentPhase:    'starting',
          deferredFrames:  0,
        };
        this.deps.manager.setCurrentBuildInfo(dequeued.roomId, dequeued.reason, 'starting');
      }
    }

    // Step 3: update diagnostics each frame.
    const byPriority: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    for (const t of this.queue) {
      byPriority[(t.priority - 1) as 0 | 1 | 2 | 3 | 4]++;
    }
    this.deps.manager.setResidentBuildQueueLength(this.queue.length, byPriority);
  }

  /** Discard all queued work, the active session, and version counters. */
  reset(): void {
    this.queue.length = 0;
    this.queueIds.clear();
    this.queueDirty = false;
    this.activeSession = null;
    this.roomVersions.clear();
    this.nonUrgentBlockedFrames = 0;
  }

  private sortIfDirty(): void {
    if (this.queueDirty) {
      // Stable sort: equal priorities keep insertion order.
      this.queue.sort((a, b) => a.priority - b.priority);
      this.queueDirty = false;
    }
  }
}

// ── ZoneTransitionState ───────────────────────────────────────────────────────

/** Everything needed to re-issue the deferred transition once the zone is ready. */
export interface PendingZoneTransition {
  targetRoom: RoomDef;
  spawnXBlock: number;
  spawnYBlock: number;
  vx: number;
  vy: number;
  dir: TransitionDirection;
  targetWorldNumber: number;
}

/**
 * Cross-zone transition state (formerly the `_zoneTransitionLoad` record).
 * While active, gameplay is paused and the zone loader ticks each frame; when
 * the zone is ready the caller takes the pending activation — which clears
 * `isActive` BEFORE the deferred `startTransitionLoad` call so its cross-zone
 * guard treats the re-issue as a normal intra-zone transition.
 */
export class ZoneTransitionState {
  private pending: PendingZoneTransition | null = null;

  get isActive(): boolean {
    return this.pending !== null;
  }

  /** Record a deferred cross-zone transition.  Only valid while inactive. */
  begin(transition: PendingZoneTransition): void {
    this.pending = transition;
  }

  /**
   * Return the pending activation and clear `isActive` in one step
   * (the capture-then-clear contract).  Throws if no transition is pending —
   * callers must check `isActive` first.
   */
  takePendingActivation(): PendingZoneTransition {
    const taken = this.pending;
    if (taken === null) {
      throw new Error('ZoneTransitionState.takePendingActivation() called while inactive');
    }
    this.pending = null;
    return taken;
  }
}

// ── InitialZoneLoadProgress ───────────────────────────────────────────────────

/**
 * Startup zone-load progress (formerly `_initialResidentBuildPhase`).
 * Gameplay, sim, input, and transitions stay blocked while `isActive`.
 * The ZoneResidentLoader drives the actual build queue; this only tracks
 * blocking state and overlay/diagnostic progress.
 */
export class InitialZoneLoadProgress {
  private active = false;
  private builtCount = 0;
  private failedCount = 0;
  private totalCount = 0;
  private startedAtMs = 0;

  get isActive(): boolean { return this.active; }
  get built(): number { return this.builtCount; }
  get failed(): number { return this.failedCount; }
  get total(): number { return this.totalCount; }

  /** Begin blocking gameplay for a zone load of `totalRooms` rooms. */
  begin(totalRooms: number): void {
    this.active = true;
    this.builtCount = 0;
    this.failedCount = 0;
    this.totalCount = totalRooms;
    this.startedAtMs = 0; // stamped on the first build frame
  }

  /** Update progress from the zone loader's per-frame report. */
  recordProgress(built: number, total: number): void {
    this.builtCount = built;
    this.totalCount = total;
  }

  /**
   * Elapsed ms since the first build frame.  Stamps the start timestamp on
   * first call so overlay-paint yield frames are not counted.
   */
  elapsedMs(nowMs: number): number {
    if (this.startedAtMs === 0) this.startedAtMs = nowMs;
    return nowMs - this.startedAtMs;
  }

  /** Zone load complete — unblock gameplay. */
  finish(): void {
    this.active = false;
  }
}
