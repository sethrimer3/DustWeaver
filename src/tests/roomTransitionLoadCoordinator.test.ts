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
    getActiveBuild: () => null,
    hasQueuedBuild: () => false,
    refreshFromNeighborhood: () => { events.push('refreshFromNeighborhood'); },
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

test('async lifecycle: starts inactive, one generator, phase A advanced synchronously, one phase per frame', () => {
  const a = makeRoom('a'), b = makeRoom('b');
  const h = makeHarness([a, b]);
  assert.equal(h.coord.isAsyncLoadActive(), false);
  h.state.loadPhases = 4;
  h.coord.submitTransition(b, 2, 2, 0, 0, 'right');
  // The active room remains the outgoing room during async loading.
  assert.equal(h.state.currentRoom.id, 'a');
  assert.equal(h.events.filter(e => e.startsWith('createResidentBuildGenerator')).length, 1);
  const phasesAfterSubmit = h.events.filter(e => e.startsWith('loadPhase:')).length;
  assert.equal(phasesAfterSubmit, 1, 'exactly one phase executed at submit time');
  h.coord.advanceAsyncLoad();
  assert.equal(h.events.filter(e => e.startsWith('loadPhase:')).length, 2, 'one phase per frame');
  assert.equal(h.coord.isAsyncLoadActive(), true);
  h.coord.advanceAsyncLoad(); // phase 3
  h.coord.advanceAsyncLoad(); // done
  assert.equal(h.coord.isAsyncLoadActive(), false);
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
  assert.ok(h.events.includes('queueZoneEntryViewportTasks:1'));
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


