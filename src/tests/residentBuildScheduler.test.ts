/**
 * Characterization tests for ResidentBuildScheduler / ZoneTransitionState /
 * InitialZoneLoadProgress — the resident build queue and zone-transition
 * state extracted from the startGameScreen closure (BUILD 441).
 *
 * These pin the exact queue semantics the closure implementation had:
 * roomId dedup, in-place priority upgrades (never downgrades), stable
 * equal-priority ordering, stale-version rejection at completion, single
 * active session, failure not blocking the queue, dequeue-time purging of
 * built/active rooms, frame-budget gating with urgent bypass and forced
 * start, heavy walls-step deferral, and the deliberate coalescing bypass of
 * queueRebuildAfterEdit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoomDef } from '../levels/roomDef';
import type { WorldState } from '../sim/world';
import {
  ResidentBuildScheduler,
  ZoneTransitionState,
  InitialZoneLoadProgress,
  RESIDENT_BUILD_BACKGROUND_FRAME_BUDGET_MS,
  NON_URGENT_RESIDENT_BUILD_FORCED_START_FRAMES,
  NON_URGENT_WALLS_BUILD_DEFERRAL_FRAMES_CAP,
  type ResidentBuildManagerPort,
  type ResidentBuildSchedulerDeps,
} from '../screens/residentBuildScheduler';

// ── Test harness ──────────────────────────────────────────────────────────────

function makeRoom(id: string, transitions: Array<{ targetRoomId: string }> = []): RoomDef {
  return { id, widthBlocks: 10, heightBlocks: 10, transitions } as unknown as RoomDef;
}

interface FakeManager extends ResidentBuildManagerPort {
  readyRooms: Set<string>;
  published: Array<{ roomId: string; isActive: boolean }>;
  currentBuildInfo: Array<[string | null, string | null, string | null | undefined]>;
  queueLengths: number[];
}

function makeManager(): FakeManager {
  return {
    readyRooms: new Set<string>(),
    published: [],
    currentBuildInfo: [],
    queueLengths: [],
    getResident(roomId) {
      return this.readyRooms.has(roomId) ? { runtimeReady: true } : undefined;
    },
    ensureResident() { /* recorded implicitly via published */ },
    setResidentWorld(roomId, _world, isActive) {
      this.published.push({ roomId, isActive });
      // Mirror the real manager: a stored world makes the resident runtimeReady.
      this.readyRooms.add(roomId);
    },
    setLastBuildInfo() { /* diagnostics only */ },
    setCurrentBuildInfo(roomId, reason, phase) {
      this.currentBuildInfo.push([roomId, reason, phase]);
    },
    setResidentBuildQueueLength(length) {
      this.queueLengths.push(length);
    },
  };
}

/** Generator that yields the given phases then returns a fake WorldState. */
function makeGen(phases: string[], onDone?: () => void): Generator<string, WorldState, void> {
  return (function* () {
    for (const p of phases) yield p;
    onDone?.();
    return {} as WorldState;
  })();
}

interface Harness {
  scheduler: ResidentBuildScheduler;
  manager: FakeManager;
  /** Rooms whose generator was created, in order. */
  built: string[];
  setCurrentRoom(id: string): void;
  setLastFrameMs(ms: number): void;
  publishedCallbacks: number;
  /** Phases each fake generator yields (default: one 'phaseA' step). */
  phasesByRoom: Map<string, string[]>;
  failRooms: Set<string>;
}

function makeHarness(rooms: RoomDef[], opts: { currentRoomId?: string } = {}): Harness {
  const registry = new Map(rooms.map(r => [r.id, r]));
  const manager = makeManager();
  const built: string[] = [];
  let currentRoomId = opts.currentRoomId ?? 'active';
  let lastFrameMs = 0; // fast frames by default — budget always available
  const phasesByRoom = new Map<string, string[]>();
  const failRooms = new Set<string>();

  const harness: Partial<Harness> = {
    manager, built, phasesByRoom, failRooms,
    publishedCallbacks: 0,
    setCurrentRoom: (id) => { currentRoomId = id; },
    setLastFrameMs: (ms) => { lastFrameMs = ms; },
  };

  const deps: ResidentBuildSchedulerDeps = {
    registry,
    manager,
    createBuildGenerator: (room) => {
      built.push(room.id);
      if (failRooms.has(room.id)) {
        return (function* (): Generator<string, WorldState, void> {
          yield 'phaseA';
          throw new Error(`synthetic build failure for ${room.id}`);
        })();
      }
      return makeGen(phasesByRoom.get(room.id) ?? ['phaseA']);
    },
    getCurrentRoomId: () => currentRoomId,
    getLastFrameMs: () => lastFrameMs,
    onBuildPublished: () => { (harness as Harness).publishedCallbacks++; },
    isDevMode: false,
  };
  harness.scheduler = new ResidentBuildScheduler(deps);
  return harness as Harness;
}

/** Advance frames until the scheduler is idle or maxFrames elapse. */
function drain(h: Harness, maxFrames = 50): void {
  for (let i = 0; i < maxFrames; i++) {
    h.scheduler.advanceFrame();
    if (h.scheduler.getActiveBuild() === null && h.scheduler.getQueueSnapshot().length === 0) return;
  }
}

const R = (id: string) => makeRoom(id);

// ── Queue deduplication ───────────────────────────────────────────────────────

test('enqueueing the same room twice keeps a single entry', () => {
  const h = makeHarness([R('a'), R('b')]);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  assert.deepEqual(h.scheduler.getQueueSnapshot(), [['a', 3]]);
});

test('the active room is never enqueued', () => {
  const h = makeHarness([R('active'), R('a')]);
  h.scheduler.enqueue({ roomId: 'active', priority: 1, reason: 'proximity' });
  assert.deepEqual(h.scheduler.getQueueSnapshot(), []);
});

test('rooms missing from the registry are ignored', () => {
  const h = makeHarness([R('a')]);
  h.scheduler.enqueue({ roomId: 'ghost', priority: 3, reason: 'adjacent' });
  assert.deepEqual(h.scheduler.getQueueSnapshot(), []);
});

test('a room that became runtimeReady while queued is purged at dequeue, not built', () => {
  const h = makeHarness([R('a'), R('b')]);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.enqueue({ roomId: 'b', priority: 4, reason: 'adjacent' });
  h.manager.readyRooms.add('a');
  drain(h);
  assert.deepEqual(h.built, ['b']);
});

// ── Priority upgrades ─────────────────────────────────────────────────────────

test('a queued low-priority build is upgraded in place by a higher-priority request', () => {
  const h = makeHarness([R('a')]);
  h.scheduler.enqueue({ roomId: 'a', priority: 4, reason: 'adjacent' });
  h.scheduler.enqueue({ roomId: 'a', priority: 1, reason: 'proximity' });
  assert.deepEqual(h.scheduler.getQueueSnapshot(), [['a', 1]]);
});

test('priority never downgrades: a less-urgent request leaves the entry unchanged', () => {
  const h = makeHarness([R('a')]);
  h.scheduler.enqueue({ roomId: 'a', priority: 2, reason: 'velocityDirection' });
  h.scheduler.enqueue({ roomId: 'a', priority: 5, reason: 'rebuildAfterEdit' });
  assert.deepEqual(h.scheduler.getQueueSnapshot(), [['a', 2]]);
});

test('upgrade sorts ahead of previously more-urgent entries', () => {
  const h = makeHarness([R('a'), R('b')]);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.enqueue({ roomId: 'b', priority: 4, reason: 'adjacent' });
  h.scheduler.enqueue({ roomId: 'b', priority: 1, reason: 'proximity' });
  assert.deepEqual(h.scheduler.getQueueSnapshot(), [['b', 1], ['a', 3]]);
});

test('equal priorities keep insertion order (deterministic stable ordering)', () => {
  const h = makeHarness([R('a'), R('b'), R('c')]);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.enqueue({ roomId: 'b', priority: 3, reason: 'adjacent' });
  h.scheduler.enqueue({ roomId: 'c', priority: 3, reason: 'adjacent' });
  drain(h);
  assert.deepEqual(h.built, ['a', 'b', 'c']);
});

test('a more-urgent request for the in-flight room upgrades the session without queueing a duplicate', () => {
  const h = makeHarness([R('a')]);
  h.phasesByRoom.set('a', ['phaseA', 'phaseC']);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.advanceFrame(); // session started
  assert.equal(h.scheduler.getActiveBuild()?.roomId, 'a');
  h.scheduler.enqueue({ roomId: 'a', priority: 1, reason: 'proximity' });
  assert.deepEqual(h.scheduler.getQueueSnapshot(), []); // no duplicate entry
  drain(h);
  assert.deepEqual(h.built, ['a']); // generator was not restarted
  assert.equal(h.manager.published.length, 1);
});

// ── Stale-version rejection ───────────────────────────────────────────────────

test('a build whose room version changed mid-flight is discarded, not published', () => {
  const h = makeHarness([R('a')]);
  h.phasesByRoom.set('a', ['phaseA', 'phaseC', 'phaseD_fluid']);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.advanceFrame(); // start + first phase
  h.scheduler.bumpRoomVersion('a'); // room edited while building
  drain(h);
  assert.equal(h.manager.published.length, 0);
  assert.equal(h.publishedCallbacks, 0);
  assert.equal(h.scheduler.getActiveBuild(), null); // session cleared cleanly
});

test('a build started after the version bump publishes normally', () => {
  const h = makeHarness([R('a')]);
  h.scheduler.bumpRoomVersion('a');
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  drain(h);
  assert.deepEqual(h.manager.published, [{ roomId: 'a', isActive: false }]);
  assert.equal(h.publishedCallbacks, 1);
});

test('stale discard leaves the queue valid: the next entry builds normally', () => {
  const h = makeHarness([R('a'), R('b')]);
  h.phasesByRoom.set('a', ['phaseA', 'phaseC']);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.enqueue({ roomId: 'b', priority: 4, reason: 'adjacent' });
  h.scheduler.advanceFrame(); // start a
  h.scheduler.bumpRoomVersion('a');
  drain(h);
  assert.deepEqual(h.built, ['a', 'b']);
  assert.deepEqual(h.manager.published.map(p => p.roomId), ['b']);
});

test('queueRebuildAfterEdit bypasses coalescing: a second entry is recorded and later purged once built', () => {
  const h = makeHarness([R('a'), R('b')]);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.queueRebuildAfterEdit('a');
  // Characterized closure behavior: duplicate entry (pri 3 + pri 5) exists.
  assert.deepEqual(h.scheduler.getQueueSnapshot(), [['a', 3], ['a', 5]]);
  drain(h);
  // The room builds exactly once; the duplicate is purged as runtimeReady.
  assert.deepEqual(h.built, ['a']);
  assert.equal(h.manager.published.length, 1);
  assert.deepEqual(h.scheduler.getQueueSnapshot(), []);
});

// ── Active-session behavior ───────────────────────────────────────────────────

test('only one session is active at a time; completion starts the next queued entry', () => {
  const h = makeHarness([R('a'), R('b')]);
  h.phasesByRoom.set('a', ['phaseA', 'phaseC']);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.enqueue({ roomId: 'b', priority: 3, reason: 'adjacent' });
  h.scheduler.advanceFrame();
  assert.equal(h.scheduler.getActiveBuild()?.roomId, 'a');
  assert.deepEqual(h.built, ['a']); // b not started yet
  drain(h);
  assert.deepEqual(h.built, ['a', 'b']);
  assert.deepEqual(h.manager.published.map(p => p.roomId), ['a', 'b']);
});

test('a failed build clears the session and does not block subsequent work', () => {
  const h = makeHarness([R('a'), R('b')]);
  h.failRooms.add('a');
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.enqueue({ roomId: 'b', priority: 4, reason: 'adjacent' });
  drain(h);
  assert.deepEqual(h.manager.published.map(p => p.roomId), ['b']);
  assert.equal(h.scheduler.getActiveBuild(), null);
});

test('a queue head matching the current room is purged at dequeue', () => {
  const h = makeHarness([R('a'), R('b')]);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.enqueue({ roomId: 'b', priority: 4, reason: 'adjacent' });
  h.setCurrentRoom('a'); // player moved into a while it was queued
  drain(h);
  assert.deepEqual(h.built, ['b']);
});

test('reset() discards queue, session, and version counters', () => {
  const h = makeHarness([R('a')]);
  h.phasesByRoom.set('a', ['phaseA', 'phaseC']);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.advanceFrame();
  h.scheduler.reset();
  assert.equal(h.scheduler.getActiveBuild(), null);
  assert.deepEqual(h.scheduler.getQueueSnapshot(), []);
  drain(h);
  assert.equal(h.manager.published.length, 0); // nothing resumes after reset
});

// ── Frame-budget gating ───────────────────────────────────────────────────────

test('non-urgent work does not start while the previous frame is over budget', () => {
  const h = makeHarness([R('a')]);
  h.setLastFrameMs(RESIDENT_BUILD_BACKGROUND_FRAME_BUDGET_MS); // at/over budget
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.advanceFrame();
  assert.equal(h.scheduler.getActiveBuild(), null);
  assert.deepEqual(h.built, []);
});

test('urgent (priority ≤ 2) work starts even when the previous frame is over budget', () => {
  const h = makeHarness([R('a')]);
  h.setLastFrameMs(50);
  h.scheduler.enqueue({ roomId: 'a', priority: 1, reason: 'proximity' });
  h.scheduler.advanceFrame();
  assert.equal(h.scheduler.getActiveBuild()?.roomId, 'a');
});

test('non-urgent work force-starts after enough consecutive blocked frames', () => {
  const h = makeHarness([R('a')]);
  h.setLastFrameMs(50);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  for (let i = 0; i < NON_URGENT_RESIDENT_BUILD_FORCED_START_FRAMES - 1; i++) {
    h.scheduler.advanceFrame();
    assert.equal(h.scheduler.getActiveBuild(), null, `unexpectedly started at frame ${i}`);
  }
  h.scheduler.advanceFrame(); // frame that reaches the forced-start threshold
  assert.equal(h.scheduler.getActiveBuild()?.roomId, 'a');
});

test('non-urgent heavy walls step defers on slow frames up to the cap, then proceeds', () => {
  const h = makeHarness([R('a')]);
  h.phasesByRoom.set('a', ['phaseD_walls_lookup', 'phaseD_walls_build']);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.advanceFrame(); // start session (fast frame)
  h.scheduler.advanceFrame(); // runs first phase → currentPhase = phaseD_walls_lookup
  assert.equal(h.scheduler.getActiveBuild()?.phase, 'phaseD_walls_lookup');
  h.setLastFrameMs(50); // now frames are slow
  for (let i = 0; i < NON_URGENT_WALLS_BUILD_DEFERRAL_FRAMES_CAP; i++) {
    h.scheduler.advanceFrame();
    assert.equal(h.scheduler.getActiveBuild()?.phase, 'phaseD_walls_lookup', `advanced during deferral frame ${i}`);
  }
  h.scheduler.advanceFrame(); // deferral cap reached — heavy step proceeds
  assert.equal(h.scheduler.getActiveBuild()?.phase, 'phaseD_walls_build');
});

test('urgent session is never deferred by the heavy walls gate', () => {
  const h = makeHarness([R('a')]);
  h.phasesByRoom.set('a', ['phaseD_walls_lookup', 'phaseD_walls_build']);
  h.setLastFrameMs(50);
  h.scheduler.enqueue({ roomId: 'a', priority: 1, reason: 'proximity' });
  h.scheduler.advanceFrame(); // start
  h.scheduler.advanceFrame(); // phaseD_walls_lookup
  h.scheduler.advanceFrame(); // heavy step runs despite slow frames
  assert.equal(h.scheduler.getActiveBuild()?.phase, 'phaseD_walls_build');
});

// ── refreshFromNeighborhood ───────────────────────────────────────────────────

test('refreshFromNeighborhood enqueues radius-1 at priority 3 and radius-2 at priority 4, skipping ready rooms', () => {
  // active → a → b (chain), plus active → c where c is already ready.
  const active = makeRoom('active', [{ targetRoomId: 'a' }, { targetRoomId: 'c' }]);
  const a = makeRoom('a', [{ targetRoomId: 'b' }]);
  const rooms = [active, a, makeRoom('b'), makeRoom('c')];
  const h = makeHarness(rooms);
  h.manager.readyRooms.add('c');
  h.scheduler.refreshFromNeighborhood();
  const snap = new Map(h.scheduler.getQueueSnapshot());
  assert.equal(snap.get('a'), 3);
  assert.equal(snap.get('b'), 4);
  assert.equal(snap.has('c'), false);
});

// ── ZoneTransitionState ───────────────────────────────────────────────────────

test('zone transition: begin/take round-trips the pending activation and clears isActive', () => {
  const z = new ZoneTransitionState();
  assert.equal(z.isActive, false);
  const room = R('target');
  z.begin({ targetRoom: room, spawnXBlock: 3, spawnYBlock: 4, vx: 1, vy: -2, dir: 'up', targetWorldNumber: 2 });
  assert.equal(z.isActive, true);
  const taken = z.takePendingActivation();
  assert.equal(z.isActive, false); // cleared BEFORE the caller re-issues the transition
  assert.equal(taken.targetRoom, room);
  assert.deepEqual(
    [taken.spawnXBlock, taken.spawnYBlock, taken.vx, taken.vy, taken.dir, taken.targetWorldNumber],
    [3, 4, 1, -2, 'up', 2],
  );
});

test('zone transition: taking while inactive throws', () => {
  const z = new ZoneTransitionState();
  assert.throws(() => z.takePendingActivation());
});

// ── InitialZoneLoadProgress ───────────────────────────────────────────────────

test('initial zone load: begin/progress/finish transitions and lazy start timestamp', () => {
  const p = new InitialZoneLoadProgress();
  assert.equal(p.isActive, false);
  p.begin(18);
  assert.equal(p.isActive, true);
  assert.deepEqual([p.built, p.failed, p.total], [0, 0, 18]);
  // First elapsed call stamps t0 — overlay-paint frames before it don't count.
  assert.equal(p.elapsedMs(1000), 0);
  assert.equal(p.elapsedMs(1250), 250);
  p.recordProgress(7, 18);
  assert.deepEqual([p.built, p.total], [7, 18]);
  p.finish();
  assert.equal(p.isActive, false);
});

// ── takeActiveBuildForTransition (build ownership transfer) ───────────────────
//
// The transition coordinator takes over an in-flight background build instead
// of restarting it from Phase A. These pin the two properties that make that
// safe: the scheduler must forget the session entirely (so it can never publish
// a competing world), and the version captured at the original dequeue must
// travel with the handoff so stale-build rejection still applies.

test('takeActiveBuildForTransition transfers the live generator and clears the session', () => {
  const h = makeHarness([makeRoom('a')]);
  h.phasesByRoom.set('a', ['p0', 'p1', 'p2', 'p3']);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.advanceFrame();   // start session
  h.scheduler.advanceFrame();   // run a phase
  assert.equal(h.scheduler.getActiveBuild()?.roomId, 'a', 'session is live');

  const handoff = h.scheduler.takeActiveBuildForTransition('a');
  assert.notEqual(handoff, null);
  assert.equal(handoff?.roomId, 'a');
  assert.equal(typeof handoff?.gen.next, 'function', 'the actual generator is transferred');
  assert.equal(h.scheduler.getActiveBuild(), null, 'scheduler forgot the session');
});

test('after a take, advanceFrame never publishes that build', () => {
  const h = makeHarness([makeRoom('a')]);
  h.phasesByRoom.set('a', ['p0', 'p1', 'p2']);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.advanceFrame();
  const handoff = h.scheduler.takeActiveBuildForTransition('a');
  assert.notEqual(handoff, null);

  const publishedBefore = h.manager.published.length;
  for (let i = 0; i < 10; i++) h.scheduler.advanceFrame();
  assert.equal(
    h.manager.published.length, publishedBefore,
    'scheduler must not publish a world it no longer owns',
  );
  assert.ok(
    !h.manager.published.some(p => p.roomId === 'a'),
    'no redundant publish for the taken room',
  );
});

test('a take also removes any queued duplicate so the room cannot rebuild behind it', () => {
  const h = makeHarness([makeRoom('a'), makeRoom('b')]);
  h.phasesByRoom.set('a', ['p0', 'p1']);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.advanceFrame();               // 'a' becomes the active session
  h.scheduler.enqueue({ roomId: 'b', priority: 3, reason: 'adjacent' });

  h.scheduler.takeActiveBuildForTransition('a');
  const builtBefore = h.built.filter(id => id === 'a').length;
  for (let i = 0; i < 10; i++) h.scheduler.advanceFrame();
  assert.equal(
    h.built.filter(id => id === 'a').length, builtBefore,
    'no second generator is ever created for the taken room',
  );
  assert.ok(h.built.includes('b'), 'unrelated queued work still proceeds');
});

test('takeActiveBuildForTransition returns null for a non-matching or idle room', () => {
  const h = makeHarness([makeRoom('a'), makeRoom('b')]);
  assert.equal(h.scheduler.takeActiveBuildForTransition('a'), null, 'idle scheduler');

  h.phasesByRoom.set('a', ['p0', 'p1']);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.advanceFrame();
  assert.equal(
    h.scheduler.takeActiveBuildForTransition('b'), null,
    'a build for a different room is not surrendered',
  );
  assert.equal(h.scheduler.getActiveBuild()?.roomId, 'a', 'and is left running');
});

test('capturedVersion travels with the handoff and drives stale rejection', () => {
  const h = makeHarness([makeRoom('a')]);
  h.phasesByRoom.set('a', ['p0', 'p1']);
  h.scheduler.enqueue({ roomId: 'a', priority: 3, reason: 'adjacent' });
  h.scheduler.advanceFrame();

  const handoff = h.scheduler.takeActiveBuildForTransition('a');
  assert.notEqual(handoff, null);
  assert.equal(
    h.scheduler.isBuildVersionCurrent('a', handoff!.capturedVersion), true,
    'unedited room: the handoff is still publishable',
  );

  h.scheduler.bumpRoomVersion('a');   // e.g. an editor rebuild landed mid-load
  assert.equal(
    h.scheduler.isBuildVersionCurrent('a', handoff!.capturedVersion), false,
    'edited room: the in-flight result must be discarded, not published',
  );
});

test('getRoomVersion reports the counter a freshly started build should capture', () => {
  const h = makeHarness([makeRoom('a')]);
  assert.equal(h.scheduler.getRoomVersion('a'), 0, 'unknown room starts at 0');
  h.scheduler.bumpRoomVersion('a');
  assert.equal(h.scheduler.getRoomVersion('a'), 1);
  assert.equal(h.scheduler.isBuildVersionCurrent('a', 1), true);
  assert.equal(h.scheduler.isBuildVersionCurrent('a', 0), false);
});
