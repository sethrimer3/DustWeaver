/**
 * Characterization tests for RoomTransitionLoadCoordinator — the room-transition
 * execution lifecycle extracted from the startGameScreen closure (BUILD 442).
 *
 * These pin the exact semantics the closure implementation had:
 * path-selection precedence (cross-zone → hot-swap → prepared instant → async),
 * hot-swap integrity rejection of mismatched builtForRoomId, the ordering
 * invariants around capture/detach/freeze/world-swap, velocity application
 * (including the upward jump-speed reduction and deferred async application),
 * the one-phase-per-frame async generator contract, cross-zone
 * capture-then-clear re-issue without recursive deferral, entry-warm
 * start/skip criteria, transition-mode and miss-reason classification, and
 * reset/abandon behavior.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoomDef } from '../levels/roomDef';
import type { WorldState } from '../sim/world';
import type { RngState } from '../sim/rng';
import { PLAYER_JUMP_SPEED_WORLD } from '../sim/clusters/movementConstants';
import {
  RoomTransitionLoadCoordinator,
  UPWARD_TRANSITION_VY_REDUCTION,
  type RoomTransitionLoadCoordinatorDeps,
  type TransitionResidentManagerPort,
  type TransitionBuildSchedulerPort,
} from '../screens/roomTransitionLoadCoordinator';

// ── Fixtures ──────────────────────────────────────────────────────────────────

interface FakePlayer {
  isPlayerFlag: number;
  isAliveFlag: number;
  velocityXWorld: number;
  velocityYWorld: number;
  velocityWrites: number;
}

function makePlayer(): FakePlayer {
  const p: FakePlayer = {
    isPlayerFlag: 1,
    isAliveFlag: 1,
    velocityXWorld: 0,
    velocityWrites: 0,
    velocityYWorld: 0,
  };
  // Count velocity applications so "never applied twice" is directly assertable.
  let vy = 0;
  Object.defineProperty(p, 'velocityYWorld', {
    get: () => vy,
    set: (v: number) => { vy = v; p.velocityWrites++; },
    enumerable: true,
  });
  return p;
}

function makeWorld(builtForRoomId: string, player: FakePlayer | null): WorldState {
  return {
    builtForRoomId,
    clusters: player !== null ? [player] : [],
  } as unknown as WorldState;
}

function makeRoom(id: string, worldNumber = 1): RoomDef {
  return {
    id,
    worldNumber,
    widthBlocks: 10,
    heightBlocks: 10,
    walls: [],
    enemies: [],
    transitions: [],
    playerSpawnBlock: [2, 2],
  } as unknown as RoomDef;
}

interface Harness {
  coord: RoomTransitionLoadCoordinator;
  deps: RoomTransitionLoadCoordinatorDeps;
  events: string[];
  /** Mutable knobs read by the fake deps. */
  state: {
    currentRoom: RoomDef;
    world: WorldState;
    residents: Map<string, { runtimeReady: boolean; world: WorldState | null }>;
    preparedState: 'prepared' | 'partial' | 'cold';
    viewportCovered: boolean;
    zoneReady: boolean;
    restoredEnemyCount: number;
    restoreThrows: boolean;
    frozenEnemies: unknown | null;
    frozenSimState: unknown | null;
    adoptionResult: { wall: { status: string }; bg: { status: string } } | null;
    prewarmReadiness: { wallPresent: boolean; bgPresent: boolean; bgRequired: boolean };
    /** Generator phases remaining for createResidentBuildGenerator. */
    loadPhases: number;
    /** Called during the load generator's Phase A (mirrors setCurrentRoom write-back). */
    transferSnapshot: { healthPoints: number; ownedParticles: unknown[] } | null;
    /** What `buildScheduler.getActiveBuild()` reports. */
    activeBuild: { roomId: string; phase: string } | null;
    /**
     * The handoff `takeActiveBuildForTransition` will surrender, or null when
     * no in-flight build matches.  Cleared on take so a second call returns
     * null — the "never build the same room twice" property.
     */
    handoff: {
      roomId: string;
      gen: Generator<string, WorldState, void>;
      capturedVersion: number;
      currentPhase: string;
      startedAtMs: number;
      reason: string;
      priority: number;
    } | null;
    /** Room version counters backing the stale-build guard. */
    roomVersions: Map<string, number>;
    /** Zones that have passed the readiness barrier (drives the seamless path). */
    readyZones: Set<number>;
    /** True while post-resize entry coverage is being rebuilt. */
    coverageRebuilding: boolean;
  };
}

function makeHarness(rooms: RoomDef[]): Harness {
  const events: string[] = [];
  const registry = new Map(rooms.map(r => [r.id, r]));
  const state: Harness['state'] = {
    currentRoom: rooms[0],
    world: makeWorld(rooms[0].id, makePlayer()),
    residents: new Map(),
    preparedState: 'cold',
    viewportCovered: true,
    zoneReady: false,
    restoredEnemyCount: 0,
    restoreThrows: false,
    frozenEnemies: null,
    frozenSimState: null,
    adoptionResult: null,
    prewarmReadiness: { wallPresent: false, bgPresent: false, bgRequired: false },
    loadPhases: 6,
    transferSnapshot: { healthPoints: 7, ownedParticles: [1, 2, 3] },
    activeBuild: null,
    handoff: null,
    roomVersions: new Map<string, number>(),
    readyZones: new Set<number>(),
    coverageRebuilding: false,
  };

  const manager = {
    getResident: (roomId: string) => state.residents.get(roomId),
    ensureResident: (room: RoomDef) => { events.push(`ensureResident:${room.id}`); },
    freezeRoom: (_w: WorldState, roomId: string, _room: RoomDef, opts?: { playerDetached?: boolean }) => {
      events.push(`freezeRoom:${roomId}:detached=${opts?.playerDetached === true}`);
    },
    freezeSimState: (_w: WorldState, roomId: string) => { events.push(`freezeSimState:${roomId}`); },
    invalidateResidentWorld: (roomId: string) => { events.push(`invalidate:${roomId}`); },
    setResidentWorld: (roomId: string, _w: WorldState, isActive: boolean) => {
      events.push(`setResidentWorld:${roomId}:active=${isActive}`);
    },
    setActiveResidentId: (roomId: string) => { events.push(`setActiveResidentId:${roomId}`); },
    recordOutgoingRoom: (roomId: string) => { events.push(`recordOutgoingRoom:${roomId}`); },
    evictDistantZoneAware: () => { events.push('evictDistantZoneAware'); },
    recordTransitionMode: (mode: string, missReason = '', _ms = 0, loadRoomSkipped = false) => {
      events.push(`recordTransitionMode:${mode}:${missReason}:skipped=${loadRoomSkipped}`);
    },
    recordPlayerTransfer: (captured: number, restored: number, skipped: number) => {
      events.push(`recordPlayerTransfer:${captured}:${restored}:${skipped}`);
    },
    scanOwnershipInvariant: () => { events.push('scanOwnershipInvariant'); },
    getFrozenEnemies: () => state.frozenEnemies,
    getFrozenSimState: () => state.frozenSimState,
    restoreFrozenEnemies: () => {
      if (state.restoreThrows) throw new Error('restore failed');
      events.push('restoreFrozenEnemies');
      return state.restoredEnemyCount;
    },
    restoreSimState: () => { events.push('restoreSimState'); },
  } as unknown as TransitionResidentManagerPort;

  const buildScheduler = {
    getActiveBuild: () => state.activeBuild,
    hasQueuedBuild: () => false,
    refreshFromNeighborhood: () => { events.push('refreshFromNeighborhood'); },
    takeActiveBuildForTransition: (roomId: string) => {
      if (state.handoff === null || state.handoff.roomId !== roomId) return null;
      const h = state.handoff;
      state.handoff = null;              // ownership transfers exactly once
      state.activeBuild = null;
      events.push(`takeActiveBuildForTransition:${roomId}:${h.currentPhase}`);
      return h;
    },
    isBuildVersionCurrent: (roomId: string, captured: number) =>
      (state.roomVersions.get(roomId) ?? 0) === captured,
    getRoomVersion: (roomId: string) => state.roomVersions.get(roomId) ?? 0,
  } as unknown as TransitionBuildSchedulerPort;

  const deps: RoomTransitionLoadCoordinatorDeps = {
    registry,
    manager,
    buildScheduler,
    zoneLoader: {
      startZoneLoad: (w) => { events.push(`startZoneLoad:${w}`); },
      getZoneRoomIds: (w) => rooms.filter(r => (r.worldNumber ?? 1) === w).map(r => r.id),
      tickZoneLoad: () => { events.push('tickZoneLoad'); return state.zoneReady; },
      getZoneProgress: () => ({ worldNumber: 2, residentsReady: 1, totalRooms: 3 }),
      buildZoneRoomIdSet: (w) => new Set(rooms.filter(r => (r.worldNumber ?? 1) === w).map(r => r.id)),
      evictInactiveZoneResidents: (active, prev) => { events.push(`evictInactiveZone:${active}:${prev}`); },
    },
    overlay: {
      showLoadingOverlay: () => { events.push('overlay.showLoadingOverlay'); },
      showEntryWarm: () => { events.push('overlay.showEntryWarm'); },
      showZoneLoad: (w, total, initial) => { events.push(`overlay.showZoneLoad:${w}:${total}:${initial}`); },
      updateZoneProgress: (w, ready, total) => { events.push(`overlay.zoneProgress:${w}:${ready}:${total}`); },
    },
    profiler: {
      begin: (roomId, mode, residentReady) => { events.push(`profiler.begin:${roomId}:${mode}:${residentReady}`); },
      end: (room, diag) => { events.push(`profiler.end:${room.id}:${diag === null ? 'null' : diag.outcome}`); },
      isVerbose: () => false,
    },
    levelRng: { s0: 1, s1: 2, s2: 3, s3: 4 } as unknown as RngState,
    getCurrentRoom: () => state.currentRoom,
    getWorld: () => state.world,
    setWorld: (w) => { state.world = w; events.push(`setWorld:${(w as unknown as { builtForRoomId: string }).builtForRoomId}`); },
    getRoomPreparedState: () => state.preparedState,
    loadRoomSync: (room) => {
      events.push(`loadRoomSync:${room.id}`);
      // Mirror Phase A: currentRoom becomes the target; world is rebuilt in place.
      state.currentRoom = room;
      (state.world as unknown as { builtForRoomId: string }).builtForRoomId = room.id;
    },
    createResidentBuildGenerator: (room) => {
      events.push(`createResidentBuildGenerator:${room.id}`);
      function* gen(): Generator<string, WorldState, void> {
        for (let i = 0; i < state.loadPhases - 1; i++) {
          events.push(`loadPhase:${room.id}:${i}`);
          yield `phase${i}`;
        }
        if (state.world === undefined) console.error("STATE.WORLD IS UNDEFINED!");
        return state.world;
      }
      return gen();
    },
    capturePlayerTransfer: () => { events.push('capturePlayerTransfer'); return state.transferSnapshot as never; },
    detachPlayerFromWorld: () => { events.push('detachPlayerFromWorld'); },
    defaultPlayerHealth: 10,
    applyResidentActivation: (room, _sx, _sy, carryHealth) => {
      events.push(`applyResidentActivation:${room.id}:hp=${carryHealth}`);
      // Mirror Phase A write-back during activation.
      state.currentRoom = room;
      return { particlesRestored: 3, particlesSkipped: 0 };
    },
    canSkipEntryWarm: (room) => { events.push(`canSkipEntryWarm:${room.id}`); return state.viewportCovered; },
    resetEntryWarm: () => { events.push('resetEntryWarm'); },
    startEntryWarm: (room, sx, sy) => { events.push(`startEntryWarm:${room.id}:${sx}:${sy}`); },
    completeEntryCoverageNow: (room, sx, sy) => {
      events.push(`completeEntryCoverageNow:${room.id}:${sx}:${sy}`);
    },
    isZoneReady: (worldNumber) => state.readyZones.has(worldNumber),
    isEntryCoverageRebuilding: () => state.coverageRebuilding,
    getSeamlessDiagnosticContext: () => ({}),
    getRoomPrewarmReadiness: () => { events.push('getRoomPrewarmReadiness'); return state.prewarmReadiness; },
    getLastAdoptionResult: () => state.adoptionResult,
    recordTransitionOutcome: (outcome, diag) => {
      events.push(`recordTransitionOutcome:${outcome}:missReason=${diag.missReason}`);
    },
    queueZoneEntryViewportTasks: (ids) => { events.push(`queueZoneEntryViewportTasks:${ids.length}`); },
    areRoomSpritesReady: () => true,
    isRoomBackgroundDecodeReady: () => true,
    updateRadiusReadyCounts: () => { events.push('updateRadiusReadyCounts'); },
    isDevMode: false,
  };

  return { coord: new RoomTransitionLoadCoordinator(deps), deps, events, state };
}

function player0(h: Harness): FakePlayer {
  return (h.state.world as unknown as { clusters: FakePlayer[] }).clusters[0];
}

// ── Path-selection precedence ─────────────────────────────────────────────────

test('precedence 1: different worldNumber defers cross-zone even when a valid resident exists', () => {
  const a = makeRoom('a', 1), b = makeRoom('b', 2);
  const h = makeHarness([a, b]);
  h.state.residents.set('b', { runtimeReady: true, world: makeWorld('b', makePlayer()) });
  h.coord.submitTransition(b, 2, 2, 1, 0, 'right');
  assert.equal(h.coord.isZoneTransitionActive(), true);
  assert.equal(h.coord.isBlockingGameplay(), true);
  assert.equal(h.coord.getPhase(), 'zoneLoading');
  assert.ok(h.events.includes('startZoneLoad:2'));
  assert.ok(h.events.includes('overlay.showZoneLoad:2:1:false'));
  assert.ok(h.events.includes('profiler.begin:b:crossZoneDeferred:false'));
  assert.ok(h.events.includes('profiler.end:b:null'));
  // No load or hot-swap happened yet.
  assert.ok(!h.events.some(e => e.startsWith('setWorld') || e.startsWith('loadRoomSync') || e.startsWith('createResidentBuildGenerator')));
});

test('precedence 2: valid runtime-ready resident selects the hot-swap path', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.state.residents.set('b', { runtimeReady: true, world: makeWorld('b', makePlayer()) });
  h.state.preparedState = 'prepared'; // prepared too — hot-swap must win
  h.coord.submitTransition(b, 2, 2, 1, 0, 'right');
  assert.ok(h.events.includes('profiler.begin:b:residentWorldHot:true'));
  assert.ok(h.events.includes('setWorld:b'));
  assert.ok(!h.events.some(e => e.startsWith('loadRoomSync')));
  assert.equal(h.coord.isBlockingGameplay(), false);
});

test('precedence 3: prepared cache without valid resident falls back to async build', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.state.preparedState = 'prepared';
  h.coord.submitTransition(b, 2, 2, 1, 0, 'right');
  assert.ok(h.events.includes('profiler.begin:b:preparedInstant:false'));
  assert.ok(h.events.includes('createResidentBuildGenerator:b'));
  assert.ok(!h.events.some(e => e.startsWith('setWorld')));
});

test('precedence 4: cold cache selects the async path and blocks gameplay', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.coord.submitTransition(b, 2, 2, 1, 0, 'right');
  assert.ok(h.events.includes('profiler.begin:b:asyncCacheMiss:false'));
  assert.ok(h.events.includes('createResidentBuildGenerator:b'));
  assert.equal(h.coord.isAsyncLoadActive(), true);
  assert.equal(h.coord.isBlockingGameplay(), true);
  assert.equal(h.coord.getPhase(), 'asyncLoading');
});

test('non-runtime-ready resident falls through (miss reason runtimeNotReady)', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.state.residents.set('b', { runtimeReady: false, world: null });
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  assert.ok(h.events.includes('recordTransitionMode:legacyLoad:runtimeNotReady:skipped=false'));
});

// ── Resident integrity ────────────────────────────────────────────────────────

test('mismatched builtForRoomId is rejected, invalidated, and falls back safely', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.state.residents.set('b', { runtimeReady: true, world: makeWorld('WRONG_ROOM', null) });
  h.state.preparedState = 'prepared';
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  assert.ok(h.events.includes('invalidate:b'), 'mis-paired resident world must be invalidated');
  assert.ok(h.events.includes('createResidentBuildGenerator:b'), 'falls back to async build path');
  assert.ok(h.events.includes('profiler.begin:b:preparedInstant:false'));
  // Miss reason classification for the fallback path.
  assert.ok(h.events.includes('recordTransitionMode:legacyLoad:roomIdMismatch:skipped=false'));
  assert.ok(!h.events.includes('setWorld:WRONG_ROOM'), 'never hot-swaps the mismatched world');
});

test('hot-swap miss reasons: residentMissing and worldNull', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  assert.ok(h.events.includes('recordTransitionMode:legacyLoad:residentMissing:skipped=false'));

  const h2 = makeHarness([a, b]);
  h2.state.residents.set('b', { runtimeReady: true, world: null });
  h2.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  assert.ok(h2.events.includes('recordTransitionMode:legacyLoad:worldNull:skipped=false'));
});

test('hot-swap ordering: capture → detach → freeze(playerDetached) → swap → activation; outgoing frozen once', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.state.residents.set('b', { runtimeReady: true, world: makeWorld('b', makePlayer()) });
  h.coord.submitTransition(b, 3, 4, 0, 0, 'right');
  const idx = (e: string): number => h.events.indexOf(e);
  assert.ok(idx('capturePlayerTransfer') < idx('detachPlayerFromWorld'));
  assert.ok(idx('detachPlayerFromWorld') < idx('freezeRoom:a:detached=true'));
  assert.ok(idx('freezeRoom:a:detached=true') < idx('setWorld:b'));
  assert.ok(idx('setWorld:b') < idx('setResidentWorld:a:active=false'));
  assert.ok(idx('setResidentWorld:a:active=false') < idx('applyResidentActivation:b:hp=7'));
  assert.ok(idx('applyResidentActivation:b:hp=7') < idx('setResidentWorld:b:active=true'));
  assert.equal(h.events.filter(e => e.startsWith('freezeRoom:')).length, 1, 'outgoing frozen exactly once');
  assert.ok(h.events.includes('recordOutgoingRoom:a'));
  assert.ok(h.events.includes('recordTransitionMode:residentWorldHot::skipped=true'));
  assert.ok(h.events.includes('recordPlayerTransfer:3:3:0'));
  // Resident registration precedes neighborhood readiness recalculation.
  assert.ok(idx('setResidentWorld:b:active=true') < idx('updateRadiusReadyCounts'));
});


// ── Velocity behavior ─────────────────────────────────────────────────────────

test('hot-swap velocity: horizontal preserved, ordinary vertical preserved, applied exactly once', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  const targetPlayer = makePlayer();
  h.state.residents.set('b', { runtimeReady: true, world: makeWorld('b', targetPlayer) });
  h.coord.submitTransition(b, 2, 2, 3.5, 1.25, 'right');
  assert.equal(targetPlayer.velocityXWorld, 3.5);
  assert.equal(targetPlayer.velocityYWorld, 1.25);
  assert.equal(targetPlayer.velocityWrites, 1);
});

test('upward transitions subtract the jump-speed reduction (constant, not literal)', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  const targetPlayer = makePlayer();
  h.state.residents.set('b', { runtimeReady: true, world: makeWorld('b', targetPlayer) });
  h.coord.submitTransition(b, 2, 2, 0, -8, 'up');
  assert.equal(targetPlayer.velocityYWorld, -8 - PLAYER_JUMP_SPEED_WORLD * UPWARD_TRANSITION_VY_REDUCTION);
});

test('async velocity is deferred to generator completion and applied exactly once', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.state.loadPhases = 3;
  h.coord.submitTransition(b, 2, 2, 5, -2, 'up');
  const p = player0(h);
  assert.equal(p.velocityWrites, 0, 'no velocity while loading');
  h.coord.advanceAsyncLoad(); // phase 2
  assert.equal(p.velocityWrites, 0);
  h.coord.advanceAsyncLoad(); // done
  assert.equal(h.coord.isAsyncLoadActive(), false);
  assert.equal(p.velocityXWorld, 5);
  assert.equal(p.velocityYWorld, -2 - PLAYER_JUMP_SPEED_WORLD * UPWARD_TRANSITION_VY_REDUCTION);
  assert.equal(p.velocityWrites, 1);
});

test('getPreTransitionVelocity reflects the most recent request (Phase-F prewarm ordering)', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.coord.submitTransition(b, 2, 2, 4.5, -1.5, 'left');
  assert.deepEqual(h.coord.getPreTransitionVelocity(), { vx: 4.5, vy: -1.5 });
});

// ── Async lifecycle ───────────────────────────────────────────────────────────

test('async lifecycle: starts inactive, one generator, zero work at submit, drains under budget', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  assert.equal(h.coord.isAsyncLoadActive(), false);
  h.state.loadPhases = 4;
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  // The active room remains the outgoing room during async loading.
  assert.equal(h.state.currentRoom.id, 'a');
  assert.equal(h.events.filter(e => e.startsWith('createResidentBuildGenerator')).length, 1);
  // No generator work runs inside the transition callback any more: that frame
  // is still simulating the player, and the cover has not painted yet.
  assert.equal(
    h.events.filter(e => e.startsWith('loadPhase:')).length, 0,
    'no phase executed at submit time',
  );
  // First advance is the cover-paint yield — still no generator work.
  h.coord.advanceAsyncLoad();
  assert.equal(
    h.events.filter(e => e.startsWith('loadPhase:')).length, 0,
    'first advance yields one frame so the cover composites',
  );
  assert.equal(h.coord.isAsyncLoadActive(), true);
  // Second advance drains every remaining phase within LOAD_DRAIN_BUDGET_MS —
  // these fake phases are effectively free, so the whole load completes here
  // rather than costing one RAF frame per phase.
  h.coord.advanceAsyncLoad();
  assert.equal(h.coord.isAsyncLoadActive(), false, 'drained to completion in one covered frame');
  // Completion side effects, each once.
  assert.equal(h.state.currentRoom.id, 'b', 'currentRoom updates on completion');
  assert.equal(h.events.filter(e => e === 'setResidentWorld:b:active=true').length, 1);

  assert.equal(h.events.filter(e => e === 'refreshFromNeighborhood').length, 1);
  assert.ok(h.events.includes('overlay.showLoadingOverlay'));
  assert.ok(h.events.includes('recordTransitionOutcome:loading:missReason=runtimeNotReady'));
  // Further advancement is a safe no-op.
  const n = h.events.length;
  h.coord.advanceAsyncLoad();
  assert.equal(h.events.length, n);
});



test('async freeze/save: outgoing room is NOT frozen during submit, but during hot-swap', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.state.loadPhases = 3; // Ensure it takes 2 advances to finish
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  const idx = (e: string): number => h.events.indexOf(e);
  assert.ok(!h.events.includes('freezeRoom:a:detached=true'));
  assert.ok(idx('createResidentBuildGenerator:b') > -1);
  
  h.coord.advanceAsyncLoad(); // phase 1
  h.coord.advanceAsyncLoad(); // returns world and triggers hot-swap
  assert.ok(idx('freezeRoom:a:detached=true') > idx('createResidentBuildGenerator:b'));
  assert.ok(!h.events.includes('invalidate:a')); // Saved as resident, not invalidated
});

test('reset abandons the async generator and pending state cleanly', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.coord.submitTransition(b, 2, 2, 1, 1, 'right');
  assert.equal(h.coord.isAsyncLoadActive(), true);
  h.coord.reset();
  assert.equal(h.coord.isAsyncLoadActive(), false);
  assert.equal(h.coord.isBlockingGameplay(), false);
  const n = h.events.length;
  h.coord.advanceAsyncLoad(); // must not touch the dropped generator
  assert.equal(h.events.length, n);
});

// ── Cross-zone lifecycle ──────────────────────────────────────────────────────

test('cross-zone: progress forwarded while loading; gameplay stays blocked', () => {
  const a = makeRoom('a', 1), b = makeRoom('b', 2);
  const h = makeHarness([a, b]);
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  h.coord.tickZoneTransition();
  assert.ok(h.events.includes('overlay.zoneProgress:2:1:3'));
  assert.equal(h.coord.isZoneTransitionActive(), true);
  assert.equal(h.coord.isBlockingGameplay(), true);
});

test('cross-zone completion: pending cleared before re-issue, no recursive deferral, old zone evicted', () => {
  const a = makeRoom('a', 1), b = makeRoom('b', 2);
  const h = makeHarness([a, b]);
  h.state.residents.set('b', { runtimeReady: true, world: makeWorld('b', makePlayer()) });
  h.coord.submitTransition(b, 2, 2, 1, 0, 'right');
  h.state.zoneReady = true;
  h.coord.tickZoneTransition();
  assert.equal(h.coord.isZoneTransitionActive(), false);
  // The re-issued activation went through the hot-swap path, not a second deferral.
  assert.equal(h.events.filter(e => e.startsWith('startZoneLoad')).length, 1, 'zone load started exactly once');
  assert.ok(h.events.includes('setWorld:b'), 're-issued transition hot-swapped the target');
  assert.ok(h.events.includes('evictInactiveZone:2:1'), 'old-zone residents evicted after activation');
  const idx = (e: string): number => h.events.indexOf(e);
  assert.ok(idx('setWorld:b') < idx('evictInactiveZone:2:1'), 'activation precedes old-zone eviction');
});

test('regression: re-issued cross-zone activation without a ready resident falls to async, not re-deferral', () => {
  // The closure implementation cleared the pending flag before the re-issued
  // startTransitionLoad, whose guard checked `!isActive` — so the re-issue
  // matched the cross-zone condition again and deferred forever.  The
  // coordinator must instead run the deferred activation through the normal
  // path selection (async here, since nothing is resident or prepared).
  const a = makeRoom('a', 1), b = makeRoom('b', 2);
  const h = makeHarness([a, b]);
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  h.state.zoneReady = true;
  h.coord.tickZoneTransition();
  assert.equal(h.coord.isZoneTransitionActive(), false, 'must not re-defer');
  assert.equal(h.events.filter(e => e.startsWith('startZoneLoad')).length, 1);
  assert.ok(h.events.includes('createResidentBuildGenerator:b'), 'deferred activation took the async path');
  assert.equal(h.coord.isAsyncLoadActive(), true);
});

test('reset clears pending cross-zone work', () => {
  const a = makeRoom('a', 1), b = makeRoom('b', 2);
  const h = makeHarness([a, b]);
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  assert.equal(h.coord.isZoneTransitionActive(), true);
  h.coord.reset();
  assert.equal(h.coord.isZoneTransitionActive(), false);
  const n = h.events.length;
  h.coord.tickZoneTransition(); // no-op while inactive
  assert.equal(h.events.length, n);
});

// ── Seamless intra-zone activation ───────────────────────────────────────────
//
// The contract: once a zone has passed its readiness barrier, an intra-zone
// crossing must present NO loading UI at all — no standard overlay, no entry
// warm cover — and must not block gameplay frames.  These tests pin that so a
// future change cannot quietly reintroduce a cover on the ordinary path.

test('seamless: ready intra-zone hot-swap shows no overlay and starts no entry warm', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.state.readyZones.add(1);
  h.state.residents.set('b', { runtimeReady: true, world: makeWorld('b', makePlayer()) });
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');

  assert.ok(!h.events.some(e => e.startsWith('overlay.')), 'no overlay of any kind');
  assert.ok(!h.events.some(e => e.startsWith('startEntryWarm')), 'no blocking entry warm');
  assert.equal(h.coord.isBlockingGameplay(), false, 'no gameplay-blocked frames');
  assert.ok(h.events.includes('recordTransitionOutcome:residentWorldHot:missReason=none'));
});

test('seamless: an uncovered viewport in a ready zone closes out inline, still no cover', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.state.readyZones.add(1);
  h.state.viewportCovered = false;           // the defect case
  h.state.residents.set('b', { runtimeReady: true, world: makeWorld('b', makePlayer()) });
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');

  assert.ok(
    h.events.includes('completeEntryCoverageNow:b:2:2'),
    'gap is closed synchronously, before anything renders',
  );
  assert.ok(!h.events.includes('overlay.showEntryWarm'), 'never covers on the seamless path');
  assert.ok(!h.events.some(e => e.startsWith('startEntryWarm')), 'never starts a blocking warm');
  assert.equal(h.coord.isBlockingGameplay(), false);
});

test('seamless: a NOT-ready zone still uses the covered entry-warm path', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  // readyZones intentionally empty — this is a genuine cold entry.
  h.state.viewportCovered = false;
  h.state.residents.set('b', { runtimeReady: true, world: makeWorld('b', makePlayer()) });
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');

  assert.ok(h.events.includes('overlay.showEntryWarm'), 'cold entry keeps its cover');
  assert.ok(h.events.some(e => e.startsWith('startEntryWarm:b')));
  assert.ok(!h.events.some(e => e.startsWith('completeEntryCoverageNow')));
});

test('seamless: momentum, facing and health survive a ready intra-zone crossing', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.state.readyZones.add(1);
  const targetPlayer = makePlayer();
  h.state.residents.set('b', { runtimeReady: true, world: makeWorld('b', targetPlayer) });
  h.coord.submitTransition(b, 2, 2, 6.25, -3.5, 'right');

  assert.equal(targetPlayer.velocityXWorld, 6.25, 'horizontal momentum preserved exactly');
  assert.equal(targetPlayer.velocityYWorld, -3.5, 'vertical momentum preserved exactly');
  assert.equal(targetPlayer.velocityWrites, 1, 'applied exactly once');
  // healthPoints from the transfer snapshot (7), not the default (10).
  assert.ok(h.events.includes('applyResidentActivation:b:hp=7'), 'carried health, not a fresh spawn');
});

test('seamless: immediate A->B->A backtrack is hot both ways, no overlay', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.state.readyZones.add(1);
  h.state.residents.set('b', { runtimeReady: true, world: makeWorld('b', makePlayer()) });
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  assert.equal(h.state.currentRoom.id, 'b');

  // The outgoing room must have been stored back as a ready resident — that is
  // what makes the return crossing hot instead of a rebuild.
  assert.ok(h.events.includes('setResidentWorld:a:active=false'), 'outgoing room retained');
  h.state.residents.set('a', { runtimeReady: true, world: makeWorld('a', makePlayer()) });

  const before = h.events.length;
  h.coord.submitTransition(a, 3, 3, 0, 0, 'left');
  const backEvents = h.events.slice(before);
  assert.equal(h.state.currentRoom.id, 'a');
  assert.ok(!backEvents.some(e => e.startsWith('overlay.')), 'backtrack shows no overlay');
  assert.ok(
    !backEvents.some(e => e.startsWith('createResidentBuildGenerator')),
    'backtrack does not rebuild',
  );
});

// ── In-flight build ownership transfer ───────────────────────────────────────

/** A generator that records each phase it runs, for takeover assertions. */
function makeTrackedGen(
  events: string[], roomId: string, phases: number, world: WorldState,
): Generator<string, WorldState, void> {
  function* gen(): Generator<string, WorldState, void> {
    for (let i = 0; i < phases; i++) {
      events.push(`loadPhase:${roomId}:${i}`);
      yield `phase${i}`;
    }
    return world;
  }
  return gen();
}

test('takeover: an in-flight build is adopted, not restarted, at an early phase', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  const gen = makeTrackedGen(h.events, 'b', 5, makeWorld('b', makePlayer()));
  gen.next(); // scheduler already ran phase 0
  h.state.activeBuild = { roomId: 'b', phase: 'phase0' };
  h.state.handoff = {
    roomId: 'b', gen, capturedVersion: 0, currentPhase: 'phase0',
    startedAtMs: 0, reason: 'adjacent', priority: 3,
  };

  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  assert.ok(h.events.includes('takeActiveBuildForTransition:b:phase0'), 'ownership taken');
  assert.ok(
    !h.events.some(e => e.startsWith('createResidentBuildGenerator')),
    'no second generator for the same room',
  );
  // Phase 0 must not run twice — the adopted generator resumes where it was.
  assert.equal(h.events.filter(e => e === 'loadPhase:b:0').length, 1, 'no phase re-run');
});

test('takeover: adopting a build at its FINAL phase completes almost immediately', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  const targetWorld = makeWorld('b', makePlayer());
  const gen = makeTrackedGen(h.events, 'b', 5, targetWorld);
  for (let i = 0; i < 4; i++) gen.next();   // 4 of 5 phases already done
  h.state.activeBuild = { roomId: 'b', phase: 'phase3' };
  h.state.handoff = {
    roomId: 'b', gen, capturedVersion: 0, currentPhase: 'phase3',
    startedAtMs: 0, reason: 'adjacent', priority: 3,
  };

  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  h.coord.advanceAsyncLoad();  // cover-paint yield
  h.coord.advanceAsyncLoad();  // drains the single remaining phase
  assert.equal(h.coord.isAsyncLoadActive(), false, 'near-complete build finishes at once');
  assert.equal(h.state.currentRoom.id, 'b');
  // Exactly 5 phases across the whole lifetime — none repeated by a restart.
  assert.equal(h.events.filter(e => e.startsWith('loadPhase:b:')).length, 5);
});

test('takeover: mid-phase adoption resumes and never double-publishes', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  const gen = makeTrackedGen(h.events, 'b', 6, makeWorld('b', makePlayer()));
  gen.next(); gen.next(); gen.next();
  h.state.activeBuild = { roomId: 'b', phase: 'phase2' };
  h.state.handoff = {
    roomId: 'b', gen, capturedVersion: 0, currentPhase: 'phase2',
    startedAtMs: 0, reason: 'velocityTarget', priority: 1,
  };

  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  h.coord.advanceAsyncLoad();
  h.coord.advanceAsyncLoad();
  assert.equal(h.coord.isAsyncLoadActive(), false);
  assert.equal(
    h.events.filter(e => e === 'setResidentWorld:b:active=true').length, 1,
    'published exactly once',
  );
  assert.equal(h.events.filter(e => e.startsWith('loadPhase:b:')).length, 6);
  // A second take must return null — ownership moved, so the scheduler can
  // never publish a competing world for this room.
  assert.equal(h.state.handoff, null);
});

test('takeover: no in-flight build for the target still creates a fresh generator', () => {
  const a = makeRoom('a'), b = makeRoom('b'), c = makeRoom('c');
  const h = makeHarness([a, b, c]);
  // Scheduler is busy with a DIFFERENT room — must not be raided.
  h.state.activeBuild = { roomId: 'c', phase: 'phase1' };
  h.state.handoff = {
    roomId: 'c', gen: makeTrackedGen(h.events, 'c', 3, makeWorld('c', null)),
    capturedVersion: 0, currentPhase: 'phase1', startedAtMs: 0,
    reason: 'adjacent', priority: 3,
  };
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  assert.ok(h.events.includes('createResidentBuildGenerator:b'));
  assert.ok(!h.events.some(e => e.startsWith('takeActiveBuildForTransition')));
  assert.notEqual(h.state.handoff, null, 'a build for another room is left alone');
});

test('takeover: stale-version rejection survives the handoff', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  const gen = makeTrackedGen(h.events, 'b', 3, makeWorld('b', makePlayer()));
  gen.next();
  h.state.activeBuild = { roomId: 'b', phase: 'phase0' };
  h.state.handoff = {
    roomId: 'b', gen, capturedVersion: 0, currentPhase: 'phase0',
    startedAtMs: 0, reason: 'adjacent', priority: 3,
  };
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');

  // Room edited mid-load (e.g. the editor rebuild path bumped its version).
  h.state.roomVersions.set('b', 1);

  h.coord.advanceAsyncLoad();
  h.coord.advanceAsyncLoad();
  assert.equal(h.coord.isAsyncLoadActive(), false);
  assert.ok(
    !h.events.includes('setResidentWorld:b:active=true'),
    'a build started at a stale version must not publish',
  );
});

test('cross-zone: a PRELOADED target zone crosses seamlessly, with no zone-load screen', () => {
  const a = makeRoom('a', 1), b = makeRoom('b', 2);
  const h = makeHarness([a, b]);
  // The neighbour preloader already brought zone 2 to full readiness.
  h.state.readyZones.add(1);
  h.state.readyZones.add(2);
  const targetPlayer = makePlayer();
  h.state.residents.set('b', { runtimeReady: true, world: makeWorld('b', targetPlayer) });

  h.coord.submitTransition(b, 2, 2, 5.5, 0, 'right');

  assert.equal(h.coord.isZoneTransitionActive(), false, 'no deferral for a ready zone');
  assert.ok(!h.events.some(e => e.startsWith('overlay.')), 'no zone-load screen');
  assert.ok(!h.events.some(e => e.startsWith('startZoneLoad')), 'no zone-load session started');
  assert.equal(h.state.currentRoom.id, 'b', 'activated immediately');
  assert.equal(targetPlayer.velocityXWorld, 5.5, 'momentum carried across the zone boundary');
  assert.equal(h.coord.isBlockingGameplay(), false, 'no gameplay-blocked frames');
});

test('cross-zone: an UNPREPARED target zone still defers behind the zone-load screen', () => {
  const a = makeRoom('a', 1), b = makeRoom('b', 2);
  const h = makeHarness([a, b]);
  h.state.readyZones.add(1);   // zone 2 deliberately NOT ready
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');

  assert.equal(h.coord.isZoneTransitionActive(), true, 'unprepared zone must still load');
  assert.ok(h.events.some(e => e.startsWith('startZoneLoad:2')));
  assert.ok(h.events.some(e => e.startsWith('overlay.showZoneLoad')));
});

test('resize transient: coverage miss still closes out inline, but is NOT reported as a defect', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.state.readyZones.add(1);
  h.state.viewportCovered = false;
  h.state.coverageRebuilding = true;          // a resize is still settling
  h.state.residents.set('b', { runtimeReady: true, world: makeWorld('b', makePlayer()) });

  const errors: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => { errors.push(String(args[0])); };
  try {
    h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  } finally {
    console.error = realError;
  }

  assert.ok(
    !errors.some(e => e.includes('INVARIANT VIOLATED')),
    'a post-resize coverage miss is an expected transient, not a defect to report',
  );
  // The player must still be protected: gap closed inline, no cover.
  assert.ok(h.events.includes('completeEntryCoverageNow:b:2:2'));
  assert.ok(!h.events.some(e => e.startsWith('overlay.')));
  assert.equal(h.coord.isBlockingGameplay(), false);
});

test('invariant: a ready zone falling back to a build is reported, not normalised', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.state.readyZones.add(1);
  // Zone says ready, yet the target has no resident — exactly the class of
  // defect (`residentMissing`) the strict diagnostic exists to surface.
  const errors: unknown[][] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    // isDevMode is false in the harness, so the report is suppressed; assert the
    // path still routes to a build rather than silently claiming to be seamless.
    h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  } finally {
    console.error = realError;
  }
  assert.ok(h.events.includes('createResidentBuildGenerator:b'), 'falls back to a build');
  assert.ok(
    h.events.some(e => e.startsWith('recordTransitionMode:legacyLoad:residentMissing')),
    'the exact miss reason is recorded for diagnosis',
  );
});

test('fallback drain: a cold load completes without one frame per phase', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  h.state.loadPhases = 9;   // more phases than the old path had frames budgeted
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  h.coord.advanceAsyncLoad();   // cover-paint yield only
  assert.equal(h.events.filter(e => e.startsWith('loadPhase:')).length, 0);
  h.coord.advanceAsyncLoad();   // drains all 8 remaining phases
  assert.equal(h.coord.isAsyncLoadActive(), false, '9-phase load took ONE covered frame');
  assert.equal(h.state.currentRoom.id, 'b');
});


