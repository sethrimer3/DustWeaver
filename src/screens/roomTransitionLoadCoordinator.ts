/**
 * roomTransitionLoadCoordinator.ts — Room-transition execution lifecycle.
 *
 * Extracted verbatim from the `startGameScreen` closure in gameScreen.ts
 * (BUILD 442, phase three of the architectural refactor).  Owns everything
 * that happens AFTER `gameRoomTransitionOrchestrator` decides the player has
 * crossed a transition boundary and emits a transition request:
 *
 *  - transition-path selection with fixed precedence:
 *      (1) cross-zone deferral (different worldNumber),
 *      (2) resident-world hot-swap (valid prebuilt resident),
 *      (3) prepared instant load (fully prepared runtime cache),
 *      (4) async cache-miss load (generator spread across RAF frames);
 *  - the async room-load state (formerly `asyncLoadState`) and the
 *    one-generator-phase-per-frame advancement contract;
 *  - the captured pre-transition velocity (formerly `_preTransVX/_preTransVY`),
 *    exposed to the load generator for Phase-F prewarm ordering and applied to
 *    the new player cluster (deferred until generator completion on the async
 *    path, immediate on the hot/instant paths, never twice);
 *  - the pending cross-zone activation record (`ZoneTransitionState`) and the
 *    zone-load tick that re-issues the deferred transition once the target
 *    zone is ready (capture-then-clear so the cross-zone guard cannot recurse);
 *  - resident-world registration/invalidation sequencing around each path;
 *  - transition-mode and hot-swap miss-reason classification, readiness
 *    diagnostics, and transition-profiler begin/end calls;
 *  - starting or skipping the entry-viewport warm with the same coverage
 *    criteria as before;
 *  - the blocking-gameplay contract: `isBlockingGameplay()` is true while an
 *    async load or a cross-zone load is in progress; the RAF loop must skip
 *    sim/input/render-gameplay frames and reset its frame clock afterwards so
 *    frozen load time is never charged to physics or the speedrun timer.
 *
 * ## Ordering invariants (preserved from the closure implementation)
 *
 *  - player-state capture BEFORE player detachment (hot-swap);
 *  - detachment BEFORE freezing the outgoing world (hot-swap);
 *  - outgoing-world freeze BEFORE replacing the active world;
 *  - outgoing resident invalidation BEFORE in-place target loading
 *    (instant and async paths);
 *  - active-world replacement immediately followed by the `setWorld` port
 *    (which must also update `loadRoomCtx.world`) BEFORE resident activation;
 *  - generator completion BEFORE deferred velocity application (async);
 *  - cross-zone pending-state clearing (takePendingActivation) BEFORE the
 *    target activation re-issue;
 *  - resident registration BEFORE neighborhood-readiness recalculation;
 *  - the caller resets its frame-delta accumulator after blocking frames.
 *
 * ## Ownership and lifetime
 *
 * One instance per `startGameScreen` call; discard with `reset()` in the
 * screen's cleanup function.  `reset()` abandons the in-flight generator and
 * any pending cross-zone activation.
 *
 * ## Allowed dependencies
 *
 * Node-safe imports only (movement constants, ZoneTransitionState,
 * bfsNearbyRooms, types).  Everything with a DOM- or renderer-facing import
 * graph (room loading, resident activation, entry warm, chunk prewarm
 * diagnostics, the loading overlay, the transition profiler) is injected via
 * `RoomTransitionLoadCoordinatorDeps` as narrow structural ports — which is
 * also what makes the path-selection state machine testable under plain
 * `node --test`.  This module must never import gameScreen.ts.
 */

import type { RoomDef } from '../levels/roomDef';
import type { WorldState } from '../sim/world';
import type { RngState } from '../sim/rng';
import type { TransitionDirection } from './gameTransitions';
import type { ResidentRoomManager } from './residentRoomManager';
import type { ResidentBuildScheduler } from './residentBuildScheduler';
import type { PlayerTransferSnapshot } from './playerTransfer';
import type { ResidentActivationResult } from './gameLoadRoomPhases';
import type { TransitionReadinessDiagnostic } from './roomRenderChunkWarmScheduler';
import type { TransitionProfileMode } from '../debug/transitionProfiler';
import { PLAYER_JUMP_SPEED_WORLD } from '../sim/clusters/movementConstants';
import { ZoneTransitionState } from './residentBuildScheduler';
import { bfsNearbyRooms } from './roomPrewarmNeighborhood';
import * as SM from '../debug/seamlessMetrics';

/**
 * Fraction of `PLAYER_JUMP_SPEED_WORLD` subtracted from upward-transition
 * vertical velocity to prevent over-boosted launch into the next room above.
 * (BUILD 367: reduced from 1.0 to 0.5.)
 */
export const UPWARD_TRANSITION_VY_REDUCTION = 0.5;

// ── Ports ─────────────────────────────────────────────────────────────────────

/** The subset of ResidentRoomManager the coordinator talks to. */
export type TransitionResidentManagerPort = Pick<ResidentRoomManager,
  | 'getResident'
  | 'ensureResident'
  | 'freezeRoom'
  | 'freezeSimState'
  | 'invalidateResidentWorld'
  | 'setResidentWorld'
  | 'setActiveResidentId'
  | 'recordOutgoingRoom'
  | 'evictDistantZoneAware'
  | 'recordTransitionMode'
  | 'recordPlayerTransfer'
  | 'scanOwnershipInvariant'
  | 'getFrozenEnemies'
  | 'getFrozenSimState'
  | 'restoreFrozenEnemies'
  | 'restoreSimState'
>;

/** The subset of ResidentBuildScheduler used for miss-reason classification and refresh. */
export type TransitionBuildSchedulerPort = Pick<ResidentBuildScheduler,
  | 'getActiveBuild'
  | 'hasQueuedBuild'
  | 'refreshFromNeighborhood'
  | 'takeActiveBuildForTransition'
  | 'isBuildVersionCurrent'
  | 'getRoomVersion'
>;

/**
 * Zone loading performed by ZoneResidentLoader.  The game screen binds the
 * resident manager and campaign seed so the coordinator stays decoupled from
 * both.
 */
export interface TransitionZoneLoaderPort {
  startZoneLoad(worldNumber: number): void;
  getZoneRoomIds(worldNumber: number): string[];
  /** One zone-load tick; returns true when the zone is fully ready. */
  tickZoneLoad(): boolean;
  getZoneProgress(): { worldNumber: number; residentsReady: number; totalRooms: number } | null;
  buildZoneRoomIdSet(worldNumber: number): ReadonlySet<string>;
  evictInactiveZoneResidents(activeWorldNumber: number, previousWorldNumber: number): void;
}

/** Loading-overlay presentation (GameLoadingOverlay + the initial-load flag). */
export interface TransitionOverlayPort {
  /** Standard room-load overlay (async cache-miss path). */
  showLoadingOverlay(): void;
  /** Lightweight textless cover while the entry viewport warms. */
  showEntryWarm(): void;
  showZoneLoad(worldNumber: number, totalRooms: number, isInitialLoad: boolean): void;
  updateZoneProgress(worldNumber: number, residentsReady: number, totalRooms: number): void;
}

/**
 * DEV transition profiling (transitionProfiler.ts).  The game screen wraps
 * TP.beginTransition/TP.endTransition together with its room-count and
 * prewarm-summary builders; all three methods must be no-ops in production.
 */
export interface TransitionProfilerPort {
  begin(roomId: string, mode: TransitionProfileMode, residentReady: boolean): void;
  end(room: RoomDef, diag: TransitionReadinessDiagnostic | null): void;
  isVerbose(): boolean;
}

export interface RoomTransitionLoadCoordinatorDeps {
  /** Room registry (ROOM_REGISTRY) used for radius-2 resident shell registration. */
  registry: ReadonlyMap<string, RoomDef>;
  manager: TransitionResidentManagerPort;
  buildScheduler: TransitionBuildSchedulerPort;
  zoneLoader: TransitionZoneLoaderPort;
  overlay: TransitionOverlayPort;
  profiler: TransitionProfilerPort;
  /** Level RNG passed through to restoreFrozenEnemies on the instant path. */
  levelRng: RngState;
  /** The active room.  Mutated by load phases (Phase A) and resident activation. */
  getCurrentRoom(): RoomDef;
  /** The active WorldState reference. */
  getWorld(): WorldState;
  /**
   * Replace the active WorldState (resident hot-swap).  MUST also update
   * `loadRoomCtx.world` so subsequent load phases and activation helpers
   * target the new world.
   */
  setWorld(world: WorldState): void;
  /**
   * Runtime-cache preparation state for the room: 'prepared' when the entry
   * exists and isEntryFullyPrepared, 'partial' when it exists but is not,
   * 'cold' when absent.  Only 'prepared' selects the instant path; the
   * cold/partial distinction feeds the async-path DEV diagnostics.
   */
  getRoomPreparedState(roomId: string): 'prepared' | 'partial' | 'cold';
  /** Synchronous full room load (all phases in one call) — prepared instant path. */
  loadRoomSync(room: RoomDef, spawnXBlock: number, spawnYBlock: number): void;
  /**
   * Replaces createLoadGenerator. Returns a generator that yields phase names and
   * ultimately returns a fully built, playerless WorldState.
   */
  createResidentBuildGenerator(room: RoomDef): Generator<string, WorldState, void>;
  /** playerTransfer.ts capture (BEFORE detach). */
  capturePlayerTransfer(world: WorldState): PlayerTransferSnapshot | null;
  /** playerTransfer.ts detach (kills owned particles, removes cluster). */
  detachPlayerFromWorld(world: WorldState): void;
  /** Health used when no transfer snapshot exists (PLAYER_INITIAL_HEALTH). */
  defaultPlayerHealth: number;
  /** applyResidentRoomActivation — Phase-A/B/F activation onto the swapped-in world. */
  applyResidentActivation(
    room: RoomDef,
    spawnXBlock: number,
    spawnYBlock: number,
    carryHealthPoints: number,
    playerTransfer: PlayerTransferSnapshot | undefined,
  ): ResidentActivationResult;
  /** entryViewportWarm.canSkipEntryWarm bound to the current viewport/zoom. */
  canSkipEntryWarm(room: RoomDef, spawnXBlock: number, spawnYBlock: number): boolean;
  /** Reset the screen's EntryWarmState to a fresh idle state. */
  resetEntryWarm(): void;
  /** entryViewportWarm.startEntryWarm bound to the current viewport/zoom. */
  startEntryWarm(room: RoomDef, spawnXBlock: number, spawnYBlock: number): void;
  /**
   * Synchronously build whatever entry-viewport chunks are still missing, up
   * to a bounded wall-clock budget, WITHOUT starting a blocking warm phase or
   * showing any cover.  Used only on the seamless intra-zone path as a
   * belt-and-braces close-out when the zone barrier passed but activation
   * still found a coverage gap (which is separately reported as a defect).
   */
  completeEntryCoverageNow(room: RoomDef, spawnXBlock: number, spawnYBlock: number): void;
  /**
   * True when `worldNumber`'s zone previously satisfied the full readiness
   * barrier.  Distinguishes "this crossing was promised to be seamless" from
   * an ordinary cold entry, which is what makes the strict invariant safe to
   * assert.
   */
  isZoneReady(worldNumber: number): boolean;
  /** Structured readiness facts for the seamless-invariant defect report. */
  getSeamlessDiagnosticContext(sourceRoomId: string, targetRoomId: string): Record<string, unknown>;
  /** roomRenderChunkWarmScheduler.getRoomPrewarmReadiness. */
  getRoomPrewarmReadiness(roomId: string, room: RoomDef): {
    wallPresent: boolean; bgPresent: boolean; bgRequired: boolean;
  };
  /** roomRenderChunkWarmScheduler.getLastAdoptionResult (Phase-A adoption outcome). */
  getLastAdoptionResult(): { wall: { status: string }; bg: { status: string } } | null;
  /** roomRenderChunkWarmScheduler.recordTransitionOutcome. */
  recordTransitionOutcome(
    outcome: TransitionReadinessDiagnostic['outcome'],
    diag: TransitionReadinessDiagnostic,
  ): void;
  /** Queue entry-viewport prewarm tasks for a newly ready zone's rooms. */
  queueZoneEntryViewportTasks(zoneRoomIds: string[]): void;
  areRoomSpritesReady(room: RoomDef): boolean;
  isRoomBackgroundDecodeReady(room: RoomDef): boolean;
  /** Recompute radius-1/2 readiness diagnostics after resident changes. */
  updateRadiusReadyCounts(): void;
  /** Enables the DEV console diagnostics the closure version emitted. */
  isDevMode: boolean;
}

// ── Async room load state ─────────────────────────────────────────────────────

/**
 * When a room transition fires and the target is not in the prepared cache,
 * the load is spread across multiple RAF frames (one generator phase per
 * frame) while the loading overlay is shown.  This prevents a single large
 * blocking spike during transitions to cold rooms.
 *
 * The player velocity captured before the transition is stored here and
 * applied once the generator completes and the new player cluster exists.
 */
/**
 * The formal state machine for cold cache misses. Builds the target room
 * as an isolated resident world in the background, then hot-swaps to it.
 */
interface BuildingResidentState {
  isActive: boolean;
  gen: Generator<string, WorldState, void> | null;
  targetRoomId: string;
  sourceRoomId: string;
  targetRenderRevision: number;
  preTransVX: number;
  preTransVY: number;
  transitionDir: TransitionDirection | null;
  spawnXBlock: number;
  spawnYBlock: number;
  hotSwapMissReason: string;
  /**
   * Room version this generator was started at.  Compared against the
   * scheduler's current version before publishing, so a room edited while the
   * load was in flight is discarded rather than published stale — the same
   * guarantee `ResidentBuildScheduler.advanceFrame` applies to its own builds.
   */
  capturedVersion: number;
  /** True when `gen` was taken over from the scheduler rather than created here. */
  adopted: boolean;
  /** Whether the loading cover has painted at least one frame yet. */
  coverPainted: boolean;
  /** Generator phases stepped so far (diagnostics). */
  phasesRun: number;
}

/** Coarse transition-execution phase, for diagnostics and tests. */
export type TransitionExecutionPhase = 'idle' | 'asyncLoading' | 'zoneLoading';

/**
 * Wall-clock budget (ms) for draining generator phases per frame on the cold
 * fallback path.
 *
 * Gameplay is already frozen behind a painted cover here, so there is no frame
 * to protect — the one-phase-per-RAF pacing that used to apply cost ~7 frames
 * (~117 ms) for a room whose real work is a fraction of that.  Slicing remains
 * correct for *speculative background* builds (ResidentBuildScheduler), which
 * is why this budget lives only on the covered path.
 *
 * 12 ms leaves room inside a 16.7 ms frame for the browser to keep the cover
 * composited and the tab responsive; the incremental wall-merge generator keeps
 * its own 4 ms internal yield safeguard, which this loop respects because it
 * only ever checks the budget *between* `next()` calls.
 */
export const LOAD_DRAIN_BUDGET_MS = 12;

// ── RoomTransitionLoadCoordinator ─────────────────────────────────────────────

export class RoomTransitionLoadCoordinator {
  private readonly deps: RoomTransitionLoadCoordinatorDeps;
  private readonly buildingResident: BuildingResidentState = {
    isActive: false,
    gen: null,
    targetRoomId: '',
    sourceRoomId: '',
    targetRenderRevision: -1,
    preTransVX: 0,
    preTransVY: 0,
    transitionDir: null,
    spawnXBlock: 0,
    spawnYBlock: 0,
    hotSwapMissReason: '',
    capturedVersion: 0,
    adopted: false,
    coverPainted: false,
    phasesRun: 0,
  };
  /**
   * Cross-zone transition state.  While active, gameplay is paused and
   * `tickZoneTransition()` drives the zone loader each frame.
   */
  private readonly zoneTransition = new ZoneTransitionState();
  /**
   * Pre-transition velocity: the player's velocity at the moment the
   * transition was triggered.  Captured in submitTransition (all paths) and
   * exposed to the load-room generator so Phase F can order the prewarm queue.
   */
  private preTransVX = 0;
  private preTransVY = 0;
  /**
   * True only for the duration of the re-issued submitTransition call made
   * from `tickZoneTransition` after the target zone became ready.  The
   * cross-zone guard skips deferral while set, so the deferred activation
   * proceeds through the normal hot-swap/instant/async selection.
   *
   * NOTE — intentional behavioral fix over the closure implementation: the
   * old code cleared the pending flag BEFORE re-calling and its guard checked
   * `!isActive`, so the re-issued call matched the cross-zone condition again
   * and re-deferred forever (the comments in gameScreen.ts and the BUILD 430
   * review both *intended* the re-issue to be treated as intra-zone, but the
   * polarity of the check made that impossible).  This flag implements the
   * documented intent while preserving the clear-pending-before-re-entry
   * ordering invariant.
   */
  private isReissuingZoneActivation = false;

  constructor(deps: RoomTransitionLoadCoordinatorDeps) {
    this.deps = deps;
  }

  // ── Blocking / phase queries ──────────────────────────────────────────────

  /** True while an async cache-miss load is spreading phases across frames. */
  isAsyncLoadActive(): boolean {
    return this.buildingResident.isActive;
  }

  /** True while a cross-zone load is preparing the target zone. */
  isZoneTransitionActive(): boolean {
    return this.zoneTransition.isActive;
  }

  /**
   * True while transition work blocks gameplay: the RAF loop must skip
   * sim/input and hold the loading overlay while this returns true.
   */
  isBlockingGameplay(): boolean {
    return this.buildingResident.isActive || this.zoneTransition.isActive;
  }

  getPhase(): TransitionExecutionPhase {
    if (this.buildingResident.isActive) return 'asyncLoading';
    if (this.zoneTransition.isActive) return 'zoneLoading';
    return 'idle';
  }

  getActiveTransitionDirection(): TransitionDirection | null {
    if (this.buildingResident.isActive && this.buildingResident.transitionDir !== null) {
      return this.buildingResident.transitionDir;
    }
    return null;
  }

  /**
   * Velocity captured at the moment the current/most-recent transition fired.
   * Read by the load generator (Phase F) to order the prewarm queue.
   */
  getPreTransitionVelocity(): { vx: number; vy: number } {
    return { vx: this.preTransVX, vy: this.preTransVY };
  }

  // ── Transition submission (path selection) ────────────────────────────────

  /**
   * Called by `orchestrateRoomTransitions` when a room transition fires.
   *
   * Path precedence: (1) cross-zone deferral, (2) resident hot-swap,
   * (3) prepared instant, (4) async cache-miss.
   */
  submitTransition(
    room: RoomDef,
    spawnXBlock: number,
    spawnYBlock: number,
    vx: number,
    vy: number,
    dir: TransitionDirection,
  ): void {
    const d = this.deps;
    const t0 = d.isDevMode ? performance.now() : 0;
    // Capture pre-transition velocity for Phase F prewarm queue ordering.
    this.preTransVX = vx;
    this.preTransVY = vy;
    const preparedState = d.getRoomPreparedState(room.id);
    const isPrepared = preparedState === 'prepared';
    const currentRoom = d.getCurrentRoom();

    // Open a seamless-metrics record unless this is the zone-load re-issue,
    // which is a continuation of the crossing already being measured.
    if (!this.isReissuingZoneActivation) {
      SM.beginCrossing(
        currentRoom.id, room.id,
        isPrepared ? 'preparedInstant' : 'pending',
        (room.worldNumber ?? 1) === (currentRoom.worldNumber ?? 1),
        vx, vy, performance.now(),
      );
    }

    // ── Cross-zone transition guard (BUILD 430) ───────────────────────────
    // If the target room belongs to a different worldNumber than the current
    // room, start a zone-load session and defer activation until the zone is
    // ready.  Skip this guard when we are RE-ENTERING from the zone-load
    // completion path (zoneTransition.isActive is already false by the time
    // takePendingActivation() re-calls submitTransition).
    const targetWorldNumber = room.worldNumber ?? 1;
    const currentWorldNumber = currentRoom.worldNumber ?? 1;
    if (targetWorldNumber !== currentWorldNumber && !this.zoneTransition.isActive && !this.isReissuingZoneActivation) {
      this.zoneTransition.begin({
        targetRoom: room,
        spawnXBlock,
        spawnYBlock,
        vx,
        vy,
        dir,
        targetWorldNumber,
      });
      d.zoneLoader.startZoneLoad(targetWorldNumber);
      d.overlay.showZoneLoad(targetWorldNumber, d.zoneLoader.getZoneRoomIds(targetWorldNumber).length, false);
      d.profiler.begin(room.id, 'crossZoneDeferred', false);
      d.profiler.end(room, null);
      if (d.isDevMode && d.profiler.isVerbose()) {
        console.log(`[zoneTransition] cross-zone: world ${currentWorldNumber} → ${targetWorldNumber}, queued zone load`);
      }
      return;
    }

    // ── True resident world hot-swap (no loadRoom) ────────────────────────
    const targetResident = d.manager.getResident(room.id);
    // Compute the hot-swap miss reason BEFORE the guard so it is available
    // to the fallback paths below without duplicate lookups.
    const hotSwapMissReason: string = (() => {
      if (targetResident === undefined) return 'residentMissing';
      if (!targetResident.runtimeReady) {
        // Distinguish why runtimeReady is false.
        const activeBuild = d.buildScheduler.getActiveBuild();
        if (activeBuild !== null && activeBuild.roomId === room.id) {
          return `buildInProgress:${activeBuild.phase}`;
        }
        if (d.buildScheduler.hasQueuedBuild(room.id)) return 'buildQueued';
        return 'runtimeNotReady';
      }
      if (targetResident.world === null) return 'worldNull';
      if (targetResident.world.builtForRoomId !== room.id) return 'roomIdMismatch';
      return 'none'; // Should not reach here — hot-swap guard should have matched.
    })();
    // Integrity guard: a resident world must have been built for THIS room.  A
    // mismatch means a build/caching bug paired the wrong geometry with this
    // room id (e.g. another room rendering with "the fall"'s wall tiles).
    // Reject the hot-swap so the full loadRoom path rebuilds correct walls, and
    // surface the bug loudly rather than rendering corrupt geometry.
    if (
      targetResident !== undefined &&
      targetResident.world !== null &&
      targetResident.world.builtForRoomId !== room.id
    ) {
      console.error(
        `[resident] hot-swap REJECTED: resident world for "${room.id}" was built for ` +
        `"${targetResident.world.builtForRoomId}". Discarding it and falling back to full load.`,
      );
      // Drop the mis-paired world so it is rebuilt correctly and never reused.
      d.manager.invalidateResidentWorld(room.id);
    }
    const residentReady = targetResident !== undefined && targetResident.runtimeReady
      && targetResident.world !== null && targetResident.world.builtForRoomId === room.id;
    // Begin per-transition profiling (DEV-only no-op in production).
    const tpMode: TransitionProfileMode =
      residentReady ? 'residentWorldHot' :
      isPrepared    ? 'preparedInstant'  :
                      'asyncCacheMiss';
    d.profiler.begin(room.id, tpMode, residentReady);
    SM.noteMode(tpMode);

    if (residentReady && targetResident !== undefined && targetResident.world !== null) {
      this._runResidentHotSwap(room, spawnXBlock, spawnYBlock, vx, vy, dir, targetResident.world, t0);
    } else {
      // Both partial and cold states fallback to building a resident.
      // _runPreparedInstant is removed to prevent destructive cannibalization.
      this._startBuildingResident(room, spawnXBlock, spawnYBlock, vx, vy, dir, hotSwapMissReason, preparedState);
    }
  }

  // ── Per-frame advancement ─────────────────────────────────────────────────

  /**
   * Advance the async cache-miss load by exactly one generator phase.  Call
   * once per RAF frame while `isAsyncLoadActive()`.  On completion: applies
   * the deferred velocity, registers the new resident world, starts the entry
   * warm, and refreshes the build neighborhood — after which gameplay may
   * resume (the caller must still reset its frame clock).
   */
  advanceAsyncLoad(): void {
    const d = this.deps;
    if (!this.buildingResident.isActive || this.buildingResident.gen === null) return;

    // First call after submitTransition: the cover was only *requested* last
    // frame, so yield this one frame to let it composite before spending the
    // drain budget.  Without this the browser can show the pre-transition frame
    // frozen for the whole drain instead of the cover.
    if (!this.buildingResident.coverPainted) {
      this.buildingResident.coverPainted = true;
      return;
    }

    // Drain as many phases as fit the budget.  Gameplay is already frozen and
    // covered, so there is no frame to protect — see LOAD_DRAIN_BUDGET_MS.
    const startedAt = performance.now();
    let result: IteratorResult<string, WorldState>;
    let longestPhaseMs = 0;
    do {
      const phaseT0 = performance.now();
      result = this.buildingResident.gen.next();
      this.buildingResident.phasesRun++;
      const phaseMs = performance.now() - phaseT0;
      if (phaseMs > longestPhaseMs) longestPhaseMs = phaseMs;
    } while (!result.done && performance.now() - startedAt < LOAD_DRAIN_BUDGET_MS);

    SM.noteGeneratorProgress(this.buildingResident.phasesRun, longestPhaseMs);
    if (d.isDevMode && longestPhaseMs > 16) {
      console.warn(`[perf] async load phase took ${longestPhaseMs.toFixed(1)}ms`);
    }
    if (!result.done) return;

    this.buildingResident.isActive = false;
    this.buildingResident.gen = null;

    // Stale guard: a room edited while this generator was in flight must not
    // publish. Mirrors ResidentBuildScheduler.advanceFrame's version check —
    // preserved across an adopted (taken-over) generator too.
    if (!d.buildScheduler.isBuildVersionCurrent(
      this.buildingResident.targetRoomId, this.buildingResident.capturedVersion,
    )) {
      if (d.isDevMode) {
        console.warn(
          `[transition] async load DISCARDED (stale): ${this.buildingResident.targetRoomId}` +
          ` ver=${this.buildingResident.capturedVersion}`,
        );
      }
      return;
    }

    // The generator yielded the fully built, playerless resident world.
    const targetWorld = result.value;
    const targetRoomId = this.buildingResident.targetRoomId;
    const targetRoom = d.registry.get(targetRoomId);
    if (!targetRoom) {
      console.error(`[resident] fallback build complete but target room "${targetRoomId}" is missing from registry`);
      return;
    }
    
    // Complete the legacy "async fallback" by treating this as a delayed hot-swap.
    // Ensure the built world is registered.
    d.manager.ensureResident(targetRoom);
    d.manager.setResidentWorld(targetRoomId, targetWorld, false);
    
    // Now hot-swap to it. We use performance.now() to measure the swap time.
    const dir = this.buildingResident.transitionDir ?? 'right';
    this._runResidentHotSwap(
      targetRoom, 
      this.buildingResident.spawnXBlock, 
      this.buildingResident.spawnYBlock, 
      this.buildingResident.preTransVX, 
      this.buildingResident.preTransVY, 
      dir, 
      targetWorld, 
      performance.now()
    );

    if (d.isDevMode) {
      console.log('[transition] async load complete — velocity applied, resuming gameplay');
    }
  }

  /**
   * Advance the cross-zone load by one zone-loader tick.  Call once per RAF
   * frame while `isZoneTransitionActive()`.  When the target zone becomes
   * ready, the pending activation is taken (clearing `isActive` BEFORE the
   * re-issued submitTransition call so the cross-zone guard treats it as a
   * normal intra-zone transition — submitTransition is synchronous JS, so no
   * RAF can interleave between the clear and the call), the target room is
   * activated through the normal path, and old-zone residents are evicted.
   *
   * After this returns, check `isZoneTransitionActive()`: if still true, the
   * zone is still loading (hold the overlay, skip gameplay); if false, the
   * activation ran this frame and gameplay may fall through (any async or
   * entry-warm state it spawned is caught by the caller's other branches).
   */
  tickZoneTransition(): void {
    const d = this.deps;
    if (!this.zoneTransition.isActive) return;
    const zoneReady = d.zoneLoader.tickZoneLoad();
    const progress = d.zoneLoader.getZoneProgress();
    if (progress !== null) {
      d.overlay.updateZoneProgress(progress.worldNumber, progress.residentsReady, progress.totalRooms);
    }
    if (!zoneReady) return;

    // Zone ready — activate target room via submitTransition (takes hot-swap).
    const pending = this.zoneTransition.takePendingActivation();
    const prevWorldNumber = d.getCurrentRoom().worldNumber ?? 1;
    this.isReissuingZoneActivation = true;
    try {
      this.submitTransition(pending.targetRoom, pending.spawnXBlock, pending.spawnYBlock, pending.vx, pending.vy, pending.dir);
    } finally {
      this.isReissuingZoneActivation = false;
    }
    // Evict old-zone residents (keep some for backtrack).
    d.zoneLoader.evictInactiveZoneResidents(pending.targetWorldNumber, prevWorldNumber);
    if (d.isDevMode) {
      console.log(
        `[zoneTransition] zone ${prevWorldNumber} → ${pending.targetWorldNumber} ready, activated ${pending.targetRoom.id}`,
      );
    }
  }

  /**
   * Abandon all in-progress transition work: drops the async generator and
   * captured request data, and clears any pending cross-zone activation.
   * Call on game-screen shutdown.
   */
  reset(): void {
    this.buildingResident.isActive = false;
    this.buildingResident.gen = null;
    this.buildingResident.transitionDir = null;
    this.buildingResident.preTransVX = 0;
    this.buildingResident.preTransVY = 0;
    this.buildingResident.spawnXBlock = 0;
    this.buildingResident.spawnYBlock = 0;
    this.zoneTransition.clear();
    this.isReissuingZoneActivation = false;
    this.preTransVX = 0;
    this.preTransVY = 0;
  }

  // ── Path implementations ──────────────────────────────────────────────────

  /** True resident world hot-swap — no loadRoom call. */
  private _runResidentHotSwap(
    room: RoomDef,
    spawnXBlock: number,
    spawnYBlock: number,
    vx: number,
    vy: number,
    dir: TransitionDirection,
    targetWorld: WorldState,
    t0: number,
  ): void {
    const d = this.deps;
    if (d.isDevMode && d.profiler.isVerbose()) {
      console.log(`[transition] ${room.id}: residentWorldHot — skipping loadRoom`);
    }
    const outgoingRoom = d.getCurrentRoom();
    // Record the outgoing room id for the backtrackHot diagnostic.
    const outgoingRoomId = outgoingRoom.id;
    const outgoingWorld = d.getWorld();
    // Capture player state (health, facing, owned dust particles) BEFORE detach.
    const playerTransferSnap = d.capturePlayerTransfer(outgoingWorld);
    const carryHealthPoints  = playerTransferSnap?.healthPoints ?? d.defaultPlayerHealth;
    // Detach player: kills owned particles, removes cluster, clears grapple flags.
    d.detachPlayerFromWorld(outgoingWorld);
    // Freeze outgoing world snapshot AFTER removing player (enemies only).
    // Pass playerDetached:true so freezeRoom asserts the player is gone.
    d.manager.ensureResident(outgoingRoom);
    d.manager.freezeRoom(outgoingWorld, outgoingRoomId, outgoingRoom, { playerDetached: true });
    d.manager.freezeSimState(outgoingWorld, outgoingRoomId);
    // Switch active world to the target resident's pre-built WorldState.
    // setWorld also updates loadRoomCtx.world so activation targets it.
    d.setWorld(targetWorld);
    // Store the detached outgoing world as a frozen resident (runtimeReady=true).
    // This enables instant backtracking: the outgoing room is ready to hot-swap
    // without a loadRoom rebuild.
    d.manager.setResidentWorld(outgoingRoomId, outgoingWorld, false);
    d.manager.recordOutgoingRoom(outgoingRoomId);
    // Apply Phase-A renderer, Phase-B player spawn (with particle transfer),
    // Phase-F env/camera.
    const { particlesRestored, particlesSkipped } = d.applyResidentActivation(
      room, spawnXBlock, spawnYBlock, carryHealthPoints,
      playerTransferSnap ?? undefined,
    );
    const player = targetWorld.clusters[0];
    if (player !== undefined && player.isPlayerFlag === 1) {
      this._applyTransitionVelocity(player, vx, vy, dir);
    }
    d.manager.setResidentWorld(room.id, targetWorld, true);
    d.manager.setActiveResidentId(room.id);
    d.manager.evictDistantZoneAware(d.zoneLoader.buildZoneRoomIdSet(room.worldNumber ?? 1));
    d.manager.recordTransitionMode('residentWorldHot', '', d.isDevMode ? performance.now() - t0 : 0, true);
    d.manager.recordPlayerTransfer(
      playerTransferSnap?.ownedParticles.length ?? 0,
      particlesRestored,
      particlesSkipped,
    );
    if (d.isDevMode) {
      d.manager.scanOwnershipInvariant();
    }
    this._ensureAdjacentResidents(room.id);
    const { wallPresent, bgPresent, bgRequired } = d.getRoomPrewarmReadiness(room.id, room);
    const adoptResult = d.getLastAdoptionResult();
    const wallStatus = adoptResult?.wall.status ?? 'missing';
    const bgStatus   = adoptResult?.bg.status   ?? 'missing';
    const renderKeyMatches: boolean | null =
      wallStatus === 'staleRenderState' || bgStatus === 'staleRenderState' ? false :
      wallStatus === 'adopted' || bgStatus === 'adopted' ? true : null;
    d.resetEntryWarm();
    const viewportCovered = d.canSkipEntryWarm(d.getCurrentRoom(), spawnXBlock, spawnYBlock);
    // An intra-zone crossing out of a zone that already passed the readiness
    // barrier is *supposed* to be covered — the barrier's whole contract is
    // that every directed intra-zone entry is activatable without warming.
    // A miss here is a defect in the producer/predicate/retention chain, not a
    // normal fallback, so surface it loudly with everything needed to find the
    // cause rather than silently showing a cover.
    const isIntraZone = (room.worldNumber ?? 1) === (outgoingRoom.worldNumber ?? 1);
    const zoneWasReady = d.isZoneReady(room.worldNumber ?? 1);
    if (!viewportCovered) {
      if (isIntraZone && zoneWasReady) {
        this._reportSeamlessInvariantViolation(
          outgoingRoom, room, spawnXBlock, spawnYBlock,
          { wallPresent, bgPresent, bgRequired, wallStatus, bgStatus },
        );
      }
      if (isIntraZone && zoneWasReady) {
        // Close the gap in-place, this frame, before anything renders: no
        // overlay, no blocked frames, no pop-in.  Bounded so a pathological
        // miss degrades to one long frame rather than a stall; because the
        // zone barrier already passed, the real shortfall is a chunk or two.
        d.completeEntryCoverageNow(d.getCurrentRoom(), spawnXBlock, spawnYBlock);
      } else {
        // Genuine cold entry (cross-zone arrival, or a zone that never
        // completed its barrier) — the covered warm path is correct here.
        d.startEntryWarm(d.getCurrentRoom(), spawnXBlock, spawnYBlock);
        d.overlay.showEntryWarm();
      }
    }
    // Record the outcome diagnostic and emit the compact transition summary.
    const diag: TransitionReadinessDiagnostic = !viewportCovered ? {
      roomId: room.id,
      runtimeReady: true,
      wallPrewarmPresent: wallPresent,
      bgPrewarmPresent:   bgPresent,
      bgPrewarmRequired:  bgRequired,
      renderStateKeyMatches: renderKeyMatches,
      entryViewportCovered: false,
      outcome: 'entryWarm',
      spritesDecoded: d.areRoomSpritesReady(room),
      backgroundDecoded: d.isRoomBackgroundDecodeReady(room),
      missReason: 'entryViewportNotCovered',
    } : {
      roomId: room.id,
      runtimeReady: true,
      wallPrewarmPresent: wallPresent,
      bgPrewarmPresent:   bgPresent,
      bgPrewarmRequired:  bgRequired,
      renderStateKeyMatches: renderKeyMatches,
      entryViewportCovered: true,
      outcome: 'residentWorldHot',
      spritesDecoded: d.areRoomSpritesReady(room),
      backgroundDecoded: d.isRoomBackgroundDecodeReady(room),
      missReason: 'none',
    };
    d.recordTransitionOutcome(diag.outcome, diag);
    SM.noteMissReason(diag.missReason);
    if (t0 > 0) SM.noteActivationMs(performance.now() - t0);
    if (d.isDevMode && d.profiler.isVerbose()) {
      console.log(`[transition] ${room.id}: residentWorldHot done in ${(performance.now() - t0).toFixed(1)}ms`);
    }
    d.profiler.end(room, diag);
    // Refresh build queue so newly adjacent rooms are queued after transition.
    d.buildScheduler.refreshFromNeighborhood();
    d.updateRadiusReadyCounts();
  }


  /** Async path (cache miss — spread over RAF frames). */
  private _startBuildingResident(
    room: RoomDef,
    spawnXBlock: number,
    spawnYBlock: number,
    vx: number,
    vy: number,
    dir: TransitionDirection,
    hotSwapMissReason: string,
    preparedState: 'partial' | 'cold' | 'prepared',
  ): void {
    const d = this.deps;
    if (d.isDevMode && d.profiler.isVerbose()) {
      console.warn(`[transition] ${room.id}: cache MISS (${preparedState}) — async load`);
    }
    const outgoingRoom = d.getCurrentRoom();
    
    // We do NOT invalidate the outgoing resident world. The async load builds 
    // the target room in an isolated world and then hot-swaps to it, preserving
    // the source room for backtracking.
    d.manager.recordTransitionMode('legacyLoad', hotSwapMissReason);
    
    this.buildingResident.preTransVX    = vx;
    this.buildingResident.preTransVY    = vy;
    this.buildingResident.transitionDir = dir;
    this.buildingResident.spawnXBlock   = spawnXBlock;
    this.buildingResident.spawnYBlock   = spawnYBlock;
    this.buildingResident.sourceRoomId  = outgoingRoom.id;
    this.buildingResident.targetRoomId  = room.id;
    this.buildingResident.hotSwapMissReason = hotSwapMissReason;
    this.buildingResident.coverPainted  = false;
    this.buildingResident.phasesRun     = 0;

    // Take over an in-flight background build rather than restarting it.  The
    // RAF loop stops advancing the scheduler while this load blocks gameplay,
    // so a session left behind would be frozen mid-build while we rebuilt the
    // identical room from Phase A — double work, and the near-complete build
    // discarded.  Ownership transfer also guarantees only one generator for
    // this room exists at a time.
    const handoff = d.buildScheduler.takeActiveBuildForTransition(room.id);
    if (handoff !== null) {
      this.buildingResident.gen             = handoff.gen;
      this.buildingResident.capturedVersion = handoff.capturedVersion;
      this.buildingResident.adopted         = true;
      if (d.isDevMode) {
        console.log(
          `[transition] ${room.id}: adopted in-flight build at phase=${handoff.currentPhase}` +
          ` (reason=${handoff.reason})`,
        );
      }
    } else {
      this.buildingResident.gen             = d.createResidentBuildGenerator(room);
      this.buildingResident.capturedVersion = d.buildScheduler.getRoomVersion(room.id);
      this.buildingResident.adopted         = false;
    }
    this.buildingResident.isActive      = true;

    const diag: TransitionReadinessDiagnostic = {
      roomId: room.id,
      runtimeReady: false,
      wallPrewarmPresent: false,
      bgPrewarmPresent:   false,
      bgPrewarmRequired:  (room.backgroundBlocks?.length ?? 0) > 0,
      renderStateKeyMatches: null,
      entryViewportCovered: false,
      outcome: 'loading',
      spritesDecoded: null,
      backgroundDecoded: null,
      missReason: 'runtimeNotReady',
    };
    d.recordTransitionOutcome('loading', diag);
    d.profiler.end(room, diag);
    d.overlay.showLoadingOverlay();

    // No generator work runs here.  The first `advanceAsyncLoad()` yields one
    // frame so the cover composites, then drains under LOAD_DRAIN_BUDGET_MS.
    // (The old code stepped Phase A synchronously inside the transition
    // callback, spending it on the frame the player was still being simulated.)
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Apply the captured transition velocity to the player cluster.  Upward
   * transitions subtract a jump-speed fraction to prevent over-boosted launch.
   */
  private _applyTransitionVelocity(
    player: { velocityXWorld: number; velocityYWorld: number },
    vx: number,
    vy: number,
    dir: TransitionDirection | null,
  ): void {
    player.velocityXWorld = vx;
    player.velocityYWorld = dir === 'up'
      ? vy - PLAYER_JUMP_SPEED_WORLD * UPWARD_TRANSITION_VY_REDUCTION
      : vy;
  }

  /**
   * Reports a violation of the seamless-intra-zone contract: the target zone
   * passed its readiness barrier, yet activation found the entry viewport
   * uncovered.  Emits every fact needed to locate the cause without a repro —
   * source/target room and zone, resident state, scheduler state, active build
   * room+phase, runtime-cache state, prewarm presence, directed-entry key,
   * render-state-key comparison, decode readiness, and the exact miss reason.
   *
   * Intentionally `console.error`: this path is a defect to fix, never a
   * fallback to normalise.  DEV-gated so production players never see it.
   */
  private _reportSeamlessInvariantViolation(
    sourceRoom: RoomDef,
    targetRoom: RoomDef,
    spawnXBlock: number,
    spawnYBlock: number,
    prewarm: {
      wallPresent: boolean; bgPresent: boolean; bgRequired: boolean;
      wallStatus: string; bgStatus: string;
    },
  ): void {
    const d = this.deps;
    if (!d.isDevMode) return;
    const resident   = d.manager.getResident(targetRoom.id);
    const activeBuild = d.buildScheduler.getActiveBuild();
    const transitionIndex = sourceRoom.transitions.findIndex(t => t.targetRoomId === targetRoom.id);
    console.error(
      '[seamless] INVARIANT VIOLATED — zone reported ready but the intra-zone entry viewport was not covered.\n' +
      JSON.stringify({
        sourceRoomId: sourceRoom.id,
        targetRoomId: targetRoom.id,
        sourceZone:   sourceRoom.worldNumber ?? 1,
        targetZone:   targetRoom.worldNumber ?? 1,
        directedEntryKey: transitionIndex >= 0 ? `${sourceRoom.id}:${transitionIndex}` : 'unresolved',
        activationSpawnBlock: [spawnXBlock, spawnYBlock],
        resident: {
          exists:          resident !== undefined,
          runtimeReady:    resident?.runtimeReady ?? false,
          worldPresent:    (resident?.world ?? null) !== null,
          builtForRoomId:  resident?.world?.builtForRoomId ?? null,
        },
        scheduler: {
          activeBuildRoomId: activeBuild?.roomId ?? null,
          activeBuildPhase:  activeBuild?.phase  ?? null,
          hasQueuedBuild:    d.buildScheduler.hasQueuedBuild(targetRoom.id),
        },
        runtimeCachePrepared: d.getRoomPreparedState(targetRoom.id),
        prewarm: {
          wallPresent: prewarm.wallPresent,
          bgPresent:   prewarm.bgPresent,
          bgRequired:  prewarm.bgRequired,
        },
        adoption: { wallStatus: prewarm.wallStatus, bgStatus: prewarm.bgStatus },
        renderStateKeyMatches:
          prewarm.wallStatus === 'staleRenderState' || prewarm.bgStatus === 'staleRenderState'
            ? false
            : prewarm.wallStatus === 'adopted' || prewarm.bgStatus === 'adopted',
        decode: {
          spritesReady:    d.areRoomSpritesReady(targetRoom),
          backgroundReady: d.isRoomBackgroundDecodeReady(targetRoom),
        },
        fallbackReason: 'entryViewportNotCovered',
        extra: d.getSeamlessDiagnosticContext(sourceRoom.id, targetRoom.id),
      }, null, 2),
    );
  }

  /** Pre-register adjacent rooms (radius ≤ 2) as resident shells. */
  private _ensureAdjacentResidents(roomId: string): void {
    for (const [adjId] of bfsNearbyRooms(roomId, this.deps.registry, 2)) {
      const adjRoom = this.deps.registry.get(adjId);
      if (adjRoom !== undefined) this.deps.manager.ensureResident(adjRoom);
    }
  }
}
