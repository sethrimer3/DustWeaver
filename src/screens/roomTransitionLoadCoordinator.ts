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
  /** Incremental load generator (makeLoadRoomPhases) — async cache-miss path. */
  createLoadGenerator(room: RoomDef, spawnXBlock: number, spawnYBlock: number): Generator<void, void, void>;
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
interface AsyncRoomLoadState {
  isActive: boolean;
  gen: Generator<void, void, void> | null;
  preTransVX: number;
  preTransVY: number;
  transitionDir: TransitionDirection | null;
  /** Spawn block coordinates stored for startEntryWarm() on generator completion. */
  spawnXBlock: number;
  spawnYBlock: number;
}

/** Coarse transition-execution phase, for diagnostics and tests. */
export type TransitionExecutionPhase = 'idle' | 'asyncLoading' | 'zoneLoading';

// ── RoomTransitionLoadCoordinator ─────────────────────────────────────────────

export class RoomTransitionLoadCoordinator {
  private readonly deps: RoomTransitionLoadCoordinatorDeps;
  private readonly asyncLoad: AsyncRoomLoadState = {
    isActive: false,
    gen: null,
    preTransVX: 0,
    preTransVY: 0,
    transitionDir: null,
    spawnXBlock: 0,
    spawnYBlock: 0,
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

  constructor(deps: RoomTransitionLoadCoordinatorDeps) {
    this.deps = deps;
  }

  // ── Blocking / phase queries ──────────────────────────────────────────────

  /** True while an async cache-miss load is spreading phases across frames. */
  isAsyncLoadActive(): boolean {
    return this.asyncLoad.isActive;
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
    return this.asyncLoad.isActive || this.zoneTransition.isActive;
  }

  getPhase(): TransitionExecutionPhase {
    if (this.asyncLoad.isActive) return 'asyncLoading';
    if (this.zoneTransition.isActive) return 'zoneLoading';
    return 'idle';
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

    // ── Cross-zone transition guard (BUILD 430) ───────────────────────────
    // If the target room belongs to a different worldNumber than the current
    // room, start a zone-load session and defer activation until the zone is
    // ready.  Skip this guard when we are RE-ENTERING from the zone-load
    // completion path (zoneTransition.isActive is already false by the time
    // takePendingActivation() re-calls submitTransition).
    const targetWorldNumber = room.worldNumber ?? 1;
    const currentWorldNumber = currentRoom.worldNumber ?? 1;
    if (targetWorldNumber !== currentWorldNumber && !this.zoneTransition.isActive) {
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

    if (residentReady && targetResident !== undefined && targetResident.world !== null) {
      this._runResidentHotSwap(room, spawnXBlock, spawnYBlock, vx, vy, dir, targetResident.world, t0);
    } else if (isPrepared) {
      this._runPreparedInstant(room, spawnXBlock, spawnYBlock, vx, vy, dir, hotSwapMissReason, t0);
    } else {
      this._startAsyncCacheMiss(room, spawnXBlock, spawnYBlock, vx, vy, dir, hotSwapMissReason, preparedState);
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
    if (!this.asyncLoad.isActive || this.asyncLoad.gen === null) return;
    const phaseT0 = d.isDevMode ? performance.now() : 0;
    const result = this.asyncLoad.gen.next();
    if (d.isDevMode && phaseT0 > 0) {
      const phaseMs = performance.now() - phaseT0;
      if (phaseMs > 16) {
        console.warn(`[perf] async load phase took ${phaseMs.toFixed(1)}ms`);
      }
    }
    if (!result.done) return;

    this.asyncLoad.isActive = false;
    this.asyncLoad.gen = null;
    const world = d.getWorld();
    const currentRoom = d.getCurrentRoom();
    // Apply the deferred player velocity now that the new cluster exists.
    const player = world.clusters[0];
    if (player !== undefined && player.isPlayerFlag === 1) {
      this._applyTransitionVelocity(player, this.asyncLoad.preTransVX, this.asyncLoad.preTransVY, this.asyncLoad.transitionDir);
    }
    // Register the newly loaded room as an active resident and store the world.
    d.manager.ensureResident(currentRoom);
    d.manager.setActiveResidentId(currentRoom.id);
    d.manager.setResidentWorld(currentRoom.id, world, true);
    d.manager.evictDistantZoneAware(d.zoneLoader.buildZoneRoomIdSet(currentRoom.worldNumber ?? 1));
    // Pre-register adjacent rooms (radius ≤ 2).
    this._ensureAdjacentResidents(currentRoom.id);
    // Start the entry warm now that all load phases are complete.
    // The warm advances in subsequent gameplay frames (before bake is
    // forbidden) and holds the overlay until coverage is confirmed or
    // the timeout fires.
    d.resetEntryWarm();
    d.startEntryWarm(currentRoom, this.asyncLoad.spawnXBlock, this.asyncLoad.spawnYBlock);
    if (d.isDevMode) {
      console.log('[transition] async load complete — velocity applied, resuming gameplay');
    }
    // Refresh build queue so newly adjacent rooms are queued after async transition.
    d.buildScheduler.refreshFromNeighborhood();
    d.updateRadiusReadyCounts();
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
    // Queue zone entry viewport prewarm tasks for the new zone.
    d.queueZoneEntryViewportTasks(d.zoneLoader.getZoneRoomIds(pending.targetWorldNumber));
    this.submitTransition(pending.targetRoom, pending.spawnXBlock, pending.spawnYBlock, pending.vx, pending.vy, pending.dir);
    // Evict old-zone residents (keep some for backtrack).
    d.zoneLoader.evictInactiveZoneResidents(pending.targetWorldNumber, prevWorldNumber);
    if (d.isDevMode) {
      console.log(
        `[zoneTransition] zone ${prevWorldNumber} → ${pending.targetWorldNumber} ready, activated ${pending.targetRoom.id}`,
      );
    }
    d.buildScheduler.refreshFromNeighborhood();
    d.updateRadiusReadyCounts();
  }

  /**
   * Abandon all in-progress transition work: drops the async generator and
   * captured request data, and clears any pending cross-zone activation.
   * Call on game-screen shutdown.
   */
  reset(): void {
    this.asyncLoad.isActive = false;
    this.asyncLoad.gen = null;
    this.asyncLoad.transitionDir = null;
    this.asyncLoad.preTransVX = 0;
    this.asyncLoad.preTransVY = 0;
    this.asyncLoad.spawnXBlock = 0;
    this.asyncLoad.spawnYBlock = 0;
    this.zoneTransition.clear();
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
    if (!viewportCovered) {
      d.startEntryWarm(d.getCurrentRoom(), spawnXBlock, spawnYBlock);
      d.overlay.showEntryWarm();
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
    if (d.isDevMode && d.profiler.isVerbose()) {
      console.log(`[transition] ${room.id}: residentWorldHot done in ${(performance.now() - t0).toFixed(1)}ms`);
    }
    d.profiler.end(room, diag);
    // Refresh build queue so newly adjacent rooms are queued after transition.
    d.buildScheduler.refreshFromNeighborhood();
    d.updateRadiusReadyCounts();
  }

  /** Instant path (fully prepared cache hit + snapshot restore). */
  private _runPreparedInstant(
    room: RoomDef,
    spawnXBlock: number,
    spawnYBlock: number,
    vx: number,
    vy: number,
    dir: TransitionDirection,
    hotSwapMissReason: string,
    t0: number,
  ): void {
    const d = this.deps;
    if (d.isDevMode && d.profiler.isVerbose()) {
      console.log(`[transition] ${room.id}: prepared cache HIT — instant load (residentRestore/fallback)`);
    }
    const outgoingRoom = d.getCurrentRoom();
    const world = d.getWorld();
    // Freeze the outgoing room before loadRoom destroys its state.
    // playerDetached is NOT set (false/omitted) — the player is still present
    // at this point; this is the legacy snapshot path, not a true hot-swap.
    d.manager.ensureResident(outgoingRoom);
    d.manager.freezeRoom(world, outgoingRoom.id, outgoingRoom);
    d.manager.freezeSimState(world, outgoingRoom.id);
    // Invalidate outgoing resident world — loadRoom will corrupt it.
    d.manager.invalidateResidentWorld(outgoingRoom.id);
    // Capture prewarm-store state BEFORE loadRoom (Phase A adoption clears it).
    const { wallPresent, bgPresent, bgRequired } = d.getRoomPrewarmReadiness(room.id, room);
    const frozenEnemies = d.manager.getFrozenEnemies(room.id);
    const frozenSimState = d.manager.getFrozenSimState(room.id);
    d.loadRoomSync(room, spawnXBlock, spawnYBlock);
    // Restore frozen enemy state if this room was previously visited.
    d.manager.ensureResident(room);
    let residentMode: 'residentRestore' | 'residentFallback' = 'residentFallback';
    if (frozenEnemies !== null) {
      try {
        const restored = d.manager.restoreFrozenEnemies(world, frozenEnemies, d.levelRng);
        if (restored > 0) residentMode = 'residentRestore';
      } catch (err) {
        if (d.isDevMode) {
          console.warn('[resident] restoreFrozenEnemies failed — keeping fresh spawn', err);
        }
      }
    }
    if (frozenSimState !== null) {
      try {
        d.manager.restoreSimState(world, frozenSimState);
      } catch (err) {
        if (d.isDevMode) {
          console.warn('[resident] restoreSimState failed — keeping fresh sim state', err);
        }
      }
    }
    // Store the newly loaded world in the resident for future hot-swap.
    d.manager.setResidentWorld(room.id, world, true);
    d.manager.setActiveResidentId(room.id);
    d.manager.evictDistantZoneAware(d.zoneLoader.buildZoneRoomIdSet(room.worldNumber ?? 1));
    d.manager.recordTransitionMode(residentMode, hotSwapMissReason, d.isDevMode ? performance.now() - t0 : 0);
    this._ensureAdjacentResidents(room.id);
    // Retrieve the structured adoption result set by Phase A (adoptPrewarmedChunksForRoom).
    const adoptResult = d.getLastAdoptionResult();
    const wallAdoptStatus = adoptResult?.wall.status ?? 'missing';
    const bgAdoptStatus   = adoptResult?.bg.status   ?? 'missing';
    const renderStateKeyMatches: boolean | null =
      wallAdoptStatus === 'staleRenderState' || bgAdoptStatus === 'staleRenderState' ? false :
      wallAdoptStatus === 'adopted'          || bgAdoptStatus === 'adopted'          ? true  :
      null;
    const spritesDecoded: boolean | null    = d.areRoomSpritesReady(room);
    const backgroundDecoded: boolean | null = d.isRoomBackgroundDecodeReady(room);
    const player = world.clusters[0];
    if (player !== undefined && player.isPlayerFlag === 1) {
      this._applyTransitionVelocity(player, vx, vy, dir);
    }
    // Start the entry warm for the instant path.  Do NOT tick eagerly here:
    // chunk building inside the transition callback (before the overlay is
    // visible) can cause a hitch on the room-boundary frame.  Instead, show
    // a lightweight textless cover and let the normal RAF loop advance the
    // warm in the dedicated 'entryWarm' early branch.
    //
    // Probe the active chunk caches first: if the entry viewport is already
    // fully covered (e.g. the room was prewarmed before the player arrived),
    // skip the overlay entirely — no visible flash, no warm work needed.
    d.resetEntryWarm();
    const viewportCovered = d.canSkipEntryWarm(d.getCurrentRoom(), spawnXBlock, spawnYBlock);
    let warmStarted = false;
    if (!viewportCovered) {
      d.startEntryWarm(d.getCurrentRoom(), spawnXBlock, spawnYBlock);
      d.overlay.showEntryWarm();
      warmStarted = true;
      const missReason: TransitionReadinessDiagnostic['missReason'] =
        wallAdoptStatus === 'staleRenderState' || bgAdoptStatus === 'staleRenderState' ? 'staleRenderState' :
        !wallPresent ? 'wallChunksMissing' :
        !bgPresent   ? 'bgChunksMissing'   :
        wallAdoptStatus === 'empty' ? 'wallAdoptEmpty' :
        (bgRequired && bgAdoptStatus === 'empty') ? 'bgAdoptEmpty' :
                       'entryViewportNotCovered';
      if (d.isDevMode && d.profiler.isVerbose()) {
        console.warn(
          `[transition] ${room.id}: entryWarm — missReason: ${missReason}` +
          ` wallPresent:${wallPresent} bgPresent:${bgPresent} bgReq:${bgRequired}` +
          ` wall:${wallAdoptStatus} bg:${bgAdoptStatus}`,
        );
      }
      const diag: TransitionReadinessDiagnostic = {
        roomId: room.id,
        runtimeReady: true,
        wallPrewarmPresent: wallPresent,
        bgPrewarmPresent:   bgPresent,
        bgPrewarmRequired:  bgRequired,
        renderStateKeyMatches,
        entryViewportCovered: false,
        outcome: 'entryWarm',
        spritesDecoded,
        backgroundDecoded,
        missReason,
      };
      d.recordTransitionOutcome('entryWarm', diag);
      d.profiler.end(room, diag);
    } else {
      const diag: TransitionReadinessDiagnostic = {
        roomId: room.id,
        runtimeReady: true,
        wallPrewarmPresent: wallPresent,
        bgPrewarmPresent:   bgPresent,
        bgPrewarmRequired:  bgRequired,
        renderStateKeyMatches,
        entryViewportCovered: true,
        outcome: residentMode,
        spritesDecoded,
        backgroundDecoded,
        missReason: 'none',
      };
      d.recordTransitionOutcome(residentMode, diag);
      d.profiler.end(room, diag);
    }
    if (d.isDevMode && d.profiler.isVerbose()) {
      const warmStatus = !warmStarted ? ' (entryWarm skipped — viewport covered)' : ' (entryWarm started — overlay shown)';
      console.log(
        `[transition] ${room.id}: instant load done in ${(performance.now() - t0).toFixed(1)}ms` + warmStatus,
      );
    }
    // Refresh build queue so newly adjacent rooms are queued after transition.
    d.buildScheduler.refreshFromNeighborhood();
    d.updateRadiusReadyCounts();
  }

  /** Async path (cache miss — spread over RAF frames). */
  private _startAsyncCacheMiss(
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
    const world = d.getWorld();
    // Freeze outgoing room before the async generator destroys world state.
    // playerDetached is NOT set (false/omitted) — the player is still present
    // on the legacy async path; no false duplicate-player diagnostic should fire.
    d.manager.ensureResident(outgoingRoom);
    d.manager.freezeRoom(world, outgoingRoom.id, outgoingRoom);
    d.manager.freezeSimState(world, outgoingRoom.id);
    // Invalidate outgoing resident world — the async generator rebuilds the
    // shared `world` object in place for the target room, so any resident
    // entry still referencing it would hold wrong-room geometry.  (Mirrors
    // the same invalidation on the instant path; without it every return to
    // this room tripped the hot-swap room-id integrity guard.)
    d.manager.invalidateResidentWorld(outgoingRoom.id);
    d.manager.recordTransitionMode('legacyLoad', hotSwapMissReason);
    this.asyncLoad.preTransVX    = vx;
    this.asyncLoad.preTransVY    = vy;
    this.asyncLoad.transitionDir = dir;
    this.asyncLoad.spawnXBlock   = spawnXBlock;
    this.asyncLoad.spawnYBlock   = spawnYBlock;
    this.asyncLoad.gen           = d.createLoadGenerator(room, spawnXBlock, spawnYBlock);
    this.asyncLoad.isActive      = true;
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
    // Async transition: finalise the profile now with mode+counts; the
    // multi-frame Phase A–F timings continue to feed FP.recordLoadPhaseStep
    // for the freeze profiler, but are not attributed to this single
    // transition record (they span unrelated frames).  A separate
    // `[transition async-complete]` line is logged when the generator
    // finishes (see advanceAsyncLoad).
    d.profiler.end(room, diag);
    d.overlay.showLoadingOverlay();
    // Advance Phase A immediately (room metadata + world reset, < 1ms).
    // This sets `currentRoom = room` so `onRoomBecameActive()` — called by
    // the orchestrator right after this function returns — will trigger sprite
    // preloads for the NEW room, not the stale one.
    this.asyncLoad.gen.next();
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

  /** Pre-register adjacent rooms (radius ≤ 2) as resident shells. */
  private _ensureAdjacentResidents(roomId: string): void {
    for (const [adjId] of bfsNearbyRooms(roomId, this.deps.registry, 2)) {
      const adjRoom = this.deps.registry.get(adjId);
      if (adjRoom !== undefined) this.deps.manager.ensureResident(adjRoom);
    }
  }
}
