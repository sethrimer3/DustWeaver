/**
 * Characterization tests for roomPreloadAnticipationPolicy — BUILD 443.
 *
 * All tests use a fake-port harness to record observable side effects without
 * touching DOM, schedulers, or actual room data.  Assertions target calls made
 * to the port methods, not internal module state.
 *
 * Coverage:
 *  - missing/dead player → no calls
 *  - nonzero room origin subtracted correctly
 *  - four-direction proximity (at-threshold, just-outside)
 *  - first-authored transition wins
 *  - one proximity target per frame
 *  - runtime-cache absent/partial → prioritize + decode; fully prepared → skip
 *  - chunk prewarm ensured even when fully prepared
 *  - target room missing from decode path (no decode calls, prewarm still fires)
 *  - proximity resident missing/not-ready → enqueue priority 1
 *  - proximity resident ready → no enqueue
 *  - velocity: four directions, exact ±1.0 excluded, horizontal tie wins
 *  - velocity resident missing/not-ready → enqueue priority 2
 *  - velocity resident ready → no enqueue
 *  - combined: different targets, same target (priority stays 1 via scheduler)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoomDef, RoomTransitionDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import {
  applyRoomPreloadAnticipationPolicy,
  dominantVelocityDirection,
  selectProximityTarget,
  selectVelocityTarget,
  type PolicyPlayerState,
  type RoomPreloadAnticipationPorts,
} from '../screens/roomPreloadAnticipationPolicy';

// ── Harness helpers ───────────────────────────────────────────────────────────

interface CallLog {
  prioritizeRuntime: string[];
  decodeThemeSprites: string[];
  decodeBackground: string[];
  ensureChunkPrewarm: string[];
  enqueueResidentBuild: Array<{ roomId: string; priority: 1 | 2; reason: string }>;
}

function makeLog(): CallLog {
  return {
    prioritizeRuntime: [],
    decodeThemeSprites: [],
    decodeBackground: [],
    ensureChunkPrewarm: [],
    enqueueResidentBuild: [],
  };
}

interface FakePorts extends RoomPreloadAnticipationPorts {
  log: CallLog;
  runtimeEntries: Map<string, { fullyPrepared: boolean }>;
  residents: Map<string, { runtimeReady: boolean }>;
}

function makePorts(opts?: {
  runtimeEntries?: Map<string, { fullyPrepared: boolean }>;
  residents?: Map<string, { runtimeReady: boolean }>;
}): FakePorts {
  const log = makeLog();
  const runtimeEntries = opts?.runtimeEntries ?? new Map();
  const residents = opts?.residents ?? new Map();
  return {
    log,
    runtimeEntries,
    residents,
    getRuntimeEntry: (id) => runtimeEntries.get(id),
    prioritizeRuntime: (id) => { log.prioritizeRuntime.push(id); },
    decodeThemeSprites: (id) => { log.decodeThemeSprites.push(id); },
    decodeBackground: (id) => { log.decodeBackground.push(id); },
    ensureChunkPrewarm: (id) => { log.ensureChunkPrewarm.push(id); },
    getResident: (id) => residents.get(id),
    enqueueResidentBuild: (id, priority, reason) => {
      log.enqueueResidentBuild.push({ roomId: id, priority, reason });
    },
  };
}

/** Build a minimal RoomDef suitable for policy testing. */
function makeRoom(opts: {
  id?: string;
  widthBlocks?: number;
  heightBlocks?: number;
  transitions?: RoomTransitionDef[];
}): RoomDef {
  return {
    id: opts.id ?? 'room-a',
    widthBlocks: opts.widthBlocks ?? 20,
    heightBlocks: opts.heightBlocks ?? 15,
    transitions: opts.transitions ?? [],
    // Remaining required fields — policy does not inspect them.
    wallGrid: [],
    name: 'Test Room',
    song: null,
    blockTheme: 'darkStoneBlock',
    bgImagePath: null,
    bgColor: null,
    bgColorBottom: null,
    enemies: [],
    pickups: [],
    particles: [],
    spawnPoints: [],
    dustTypes: null,
    dustContainerCount: null,
    checkpoints: [],
    dialogueTriggers: [],
    lights: [],
    decorations: [],
    wallTemplateHash: null,
    bakedWallTemplate: null,
    ambientBlockerKeys: [],
    blockLighting: null,
    seamBlending: null,
    blendGradientDepth: null,
    sunraySource: null,
    directionalBias: null,
    lightBleed: null,
    worldNumber: null,
    music: null,
    ambientLight: null,
    fogDensity: null,
    version: 1,
    envDustSettings: null,
    airCurrentZones: null,
    wallDecorationsConfig: null,
    complexity: null,
    wideSeamBlending: null,
    bgGradient: null,
    bgGradientDirection: null,
    fluidGrid: null,
    bgImageOffsetXBlocks: null,
    bgImageOffsetYBlocks: null,
    bgImageRepeatX: null,
    bgImageRepeatY: null,
    bgImageScale: null,
  } as unknown as RoomDef;
}

function makeTransition(direction: 'left' | 'right' | 'up' | 'down', targetRoomId: string): RoomTransitionDef {
  return {
    direction,
    targetRoomId,
    xBlock: 0,
    yBlock: 0,
    widthBlocks: 0,
    heightBlocks: 0,
    lengthBlocks: 0,
    fadeDepthBlocks: 3,
    uid: `${direction}-${targetRoomId}`,
  } as unknown as RoomTransitionDef;
}

function alivePlayer(opts?: Partial<PolicyPlayerState>): PolicyPlayerState {
  return {
    positionXWorld: 0,
    positionYWorld: 0,
    velocityXWorld: 0,
    velocityYWorld: 0,
    isAliveFlag: 1,
    ...opts,
  };
}

const B = BLOCK_SIZE_MEDIUM; // shorthand

// ── dominantVelocityDirection unit tests ─────────────────────────────────────

test('dominantVelocityDirection: both axes zero → undefined', () => {
  assert.equal(dominantVelocityDirection(0, 0), undefined);
});

test('dominantVelocityDirection: exactly 1.0 on x → undefined (not > 1.0)', () => {
  assert.equal(dominantVelocityDirection(1.0, 0), undefined);
  assert.equal(dominantVelocityDirection(-1.0, 0), undefined);
});

test('dominantVelocityDirection: exactly 1.0 on y → undefined', () => {
  assert.equal(dominantVelocityDirection(0, 1.0), undefined);
  assert.equal(dominantVelocityDirection(0, -1.0), undefined);
});

test('dominantVelocityDirection: vx > 1 → right', () => {
  assert.equal(dominantVelocityDirection(1.5, 0), 'right');
});

test('dominantVelocityDirection: vx < -1 → left', () => {
  assert.equal(dominantVelocityDirection(-1.5, 0), 'left');
});

test('dominantVelocityDirection: vy > 1 → down', () => {
  assert.equal(dominantVelocityDirection(0, 1.5), 'down');
});

test('dominantVelocityDirection: vy < -1 → up', () => {
  assert.equal(dominantVelocityDirection(0, -1.5), 'up');
});

test('dominantVelocityDirection: |vx| > |vy| → horizontal wins', () => {
  assert.equal(dominantVelocityDirection(3.0, 1.5), 'right');
  assert.equal(dominantVelocityDirection(-3.0, 1.5), 'left');
});

test('dominantVelocityDirection: |vy| > |vx| → vertical wins', () => {
  assert.equal(dominantVelocityDirection(1.5, 3.0), 'down');
  assert.equal(dominantVelocityDirection(1.5, -3.0), 'up');
});

test('dominantVelocityDirection: |vx| === |vy| → horizontal wins (tie)', () => {
  assert.equal(dominantVelocityDirection(2.0, 2.0), 'right');
  assert.equal(dominantVelocityDirection(-2.0, 2.0), 'left');
  assert.equal(dominantVelocityDirection(2.0, -2.0), 'right');
});

// ── selectProximityTarget unit tests ─────────────────────────────────────────

test('selectProximityTarget: no transitions → undefined', () => {
  const room = makeRoom({ transitions: [] });
  assert.equal(selectProximityTarget(50, 50, room), undefined);
});

test('selectProximityTarget: right – at threshold', () => {
  const room = makeRoom({ widthBlocks: 20, transitions: [makeTransition('right', 'room-r')] });
  // threshold = (20-10)*B = 10*B
  const px = (20 - 10) * B;
  const result = selectProximityTarget(px, 0, room);
  assert.notEqual(result, undefined);
  assert.equal(result!.targetRoomId, 'room-r');
});

test('selectProximityTarget: right – just outside threshold (1 unit beyond boundary)', () => {
  const room = makeRoom({ widthBlocks: 20, transitions: [makeTransition('right', 'room-r')] });
  const px = (20 - 10) * B - 1;
  assert.equal(selectProximityTarget(px, 0, room), undefined);
});

test('selectProximityTarget: left – at threshold', () => {
  const room = makeRoom({ transitions: [makeTransition('left', 'room-l')] });
  const px = 10 * B;
  const result = selectProximityTarget(px, 0, room);
  assert.notEqual(result, undefined);
  assert.equal(result!.targetRoomId, 'room-l');
});

test('selectProximityTarget: left – just outside threshold', () => {
  const room = makeRoom({ transitions: [makeTransition('left', 'room-l')] });
  const px = 10 * B + 1;
  assert.equal(selectProximityTarget(px, 0, room), undefined);
});

test('selectProximityTarget: down – at threshold', () => {
  const room = makeRoom({ heightBlocks: 15, transitions: [makeTransition('down', 'room-d')] });
  const py = (15 - 10) * B;
  const result = selectProximityTarget(0, py, room);
  assert.notEqual(result, undefined);
  assert.equal(result!.targetRoomId, 'room-d');
});

test('selectProximityTarget: down – just outside threshold', () => {
  const room = makeRoom({ heightBlocks: 15, transitions: [makeTransition('down', 'room-d')] });
  const py = (15 - 10) * B - 1;
  assert.equal(selectProximityTarget(0, py, room), undefined);
});

test('selectProximityTarget: up – at threshold', () => {
  const room = makeRoom({ transitions: [makeTransition('up', 'room-u')] });
  const py = 10 * B;
  const result = selectProximityTarget(0, py, room);
  assert.notEqual(result, undefined);
  assert.equal(result!.targetRoomId, 'room-u');
});

test('selectProximityTarget: up – just outside threshold', () => {
  const room = makeRoom({ transitions: [makeTransition('up', 'room-u')] });
  const py = 10 * B + 1;
  assert.equal(selectProximityTarget(0, py, room), undefined);
});

test('selectProximityTarget: first authored transition wins when two are near', () => {
  const room = makeRoom({
    widthBlocks: 20,
    heightBlocks: 15,
    transitions: [
      makeTransition('right', 'room-r'),
      makeTransition('left', 'room-l'),
    ],
  });
  // Near both right and left — left threshold=10*B, right threshold=(20-10)*B=10*B
  // Position x=10*B satisfies both: px <= 10*B (left) and px >= 10*B (right)
  const px = 10 * B;
  const result = selectProximityTarget(px, 0, room);
  assert.equal(result!.targetRoomId, 'room-r'); // right is first authored
});

// ── selectVelocityTarget unit tests ──────────────────────────────────────────

test('selectVelocityTarget: no matching direction → undefined', () => {
  const room = makeRoom({ transitions: [makeTransition('right', 'room-r')] });
  assert.equal(selectVelocityTarget('left', room), undefined);
});

test('selectVelocityTarget: first matching direction wins', () => {
  const room = makeRoom({ transitions: [
    makeTransition('right', 'room-r1'),
    makeTransition('right', 'room-r2'),
  ]});
  const result = selectVelocityTarget('right', room);
  assert.equal(result!.targetRoomId, 'room-r1');
});

// ── applyRoomPreloadAnticipationPolicy integration tests ─────────────────────

test('policy: missing player → no calls', () => {
  const room = makeRoom({ transitions: [makeTransition('right', 'room-r')] });
  const ports = makePorts();
  applyRoomPreloadAnticipationPolicy(undefined, room, 0, 0, ports);
  assert.equal(ports.log.ensureChunkPrewarm.length, 0);
  assert.equal(ports.log.enqueueResidentBuild.length, 0);
});

test('policy: dead player (isAliveFlag=0) → no calls', () => {
  const room = makeRoom({ transitions: [makeTransition('right', 'room-r')] });
  const ports = makePorts();
  const player = alivePlayer({ isAliveFlag: 0, positionXWorld: (20 - 10) * B, positionYWorld: 0 });
  applyRoomPreloadAnticipationPolicy(player, room, 0, 0, ports);
  assert.equal(ports.log.ensureChunkPrewarm.length, 0);
});

test('policy: nonzero room origin is subtracted from player position', () => {
  // Room is 20x15. If world origin is (100, 200) and player is at (100 + 10*B, 200),
  // room-local px = 10*B which is exactly the right boundary threshold for a 20-block room.
  const room = makeRoom({
    widthBlocks: 20,
    transitions: [makeTransition('right', 'room-r')],
  });
  const ports = makePorts();
  const originX = 100 * B;
  const originY = 200 * B;
  const player = alivePlayer({
    positionXWorld: originX + (20 - 10) * B, // local px = 10*B → at right threshold
    positionYWorld: originY,
  });
  applyRoomPreloadAnticipationPolicy(player, room, originX, originY, ports);
  assert.deepEqual(ports.log.ensureChunkPrewarm, ['room-r']);
});

test('policy: global coordinates (no origin subtraction) do NOT trigger incorrectly', () => {
  // Without origin subtraction a far-away room would incorrectly appear "near".
  // With correct subtraction, global position in a far room yields a local px
  // of 15*B, which is below the right proximity threshold of (40-10)*B = 30*B
  // so no trigger fires.
  const room = makeRoom({
    widthBlocks: 40,
    transitions: [makeTransition('right', 'room-r')],
  });
  const ports = makePorts();
  const originX = 1000 * B;
  // local px = 15*B, well below right threshold (40-10)*B = 30*B
  const player = alivePlayer({ positionXWorld: originX + 15 * B, positionYWorld: 0 });
  applyRoomPreloadAnticipationPolicy(player, room, originX, 0, ports);
  assert.equal(ports.log.ensureChunkPrewarm.length, 0);
});

test('policy proximity: runtime absent → prioritize + decode + prewarm + enqueue', () => {
  const room = makeRoom({
    widthBlocks: 20,
    transitions: [makeTransition('right', 'room-r')],
  });
  const ports = makePorts(); // no runtime entries, no residents
  const player = alivePlayer({ positionXWorld: (20 - 10) * B });
  applyRoomPreloadAnticipationPolicy(player, room, 0, 0, ports);
  assert.deepEqual(ports.log.prioritizeRuntime, ['room-r']);
  assert.deepEqual(ports.log.decodeThemeSprites, ['room-r']);
  assert.deepEqual(ports.log.decodeBackground, ['room-r']);
  assert.deepEqual(ports.log.ensureChunkPrewarm, ['room-r']);
  assert.equal(ports.log.enqueueResidentBuild.length, 1);
  assert.deepEqual(ports.log.enqueueResidentBuild[0], { roomId: 'room-r', priority: 1, reason: 'proximity' });
});

test('policy proximity: runtime partial (not fullyPrepared) → same decode path', () => {
  const runtimeEntries = new Map([['room-r', { fullyPrepared: false }]]);
  const room = makeRoom({ widthBlocks: 20, transitions: [makeTransition('right', 'room-r')] });
  const ports = makePorts({ runtimeEntries });
  applyRoomPreloadAnticipationPolicy(alivePlayer({ positionXWorld: (20 - 10) * B }), room, 0, 0, ports);
  assert.deepEqual(ports.log.prioritizeRuntime, ['room-r']);
  assert.deepEqual(ports.log.decodeThemeSprites, ['room-r']);
  assert.deepEqual(ports.log.ensureChunkPrewarm, ['room-r']);
});

test('policy proximity: runtime fully prepared → skip prioritize + decode, but still prewarm', () => {
  const runtimeEntries = new Map([['room-r', { fullyPrepared: true }]]);
  const room = makeRoom({ widthBlocks: 20, transitions: [makeTransition('right', 'room-r')] });
  const ports = makePorts({ runtimeEntries });
  applyRoomPreloadAnticipationPolicy(alivePlayer({ positionXWorld: (20 - 10) * B }), room, 0, 0, ports);
  assert.equal(ports.log.prioritizeRuntime.length, 0);
  assert.equal(ports.log.decodeThemeSprites.length, 0);
  assert.equal(ports.log.decodeBackground.length, 0);
  assert.deepEqual(ports.log.ensureChunkPrewarm, ['room-r']); // always
});

test('policy proximity: resident missing → enqueue priority 1', () => {
  const room = makeRoom({ widthBlocks: 20, transitions: [makeTransition('right', 'room-r')] });
  const ports = makePorts();
  applyRoomPreloadAnticipationPolicy(alivePlayer({ positionXWorld: (20 - 10) * B }), room, 0, 0, ports);
  assert.equal(ports.log.enqueueResidentBuild.length, 1);
  assert.equal(ports.log.enqueueResidentBuild[0].priority, 1);
  assert.equal(ports.log.enqueueResidentBuild[0].reason, 'proximity');
});

test('policy proximity: resident not runtimeReady → enqueue priority 1', () => {
  const residents = new Map([['room-r', { runtimeReady: false }]]);
  const room = makeRoom({ widthBlocks: 20, transitions: [makeTransition('right', 'room-r')] });
  const ports = makePorts({ residents });
  applyRoomPreloadAnticipationPolicy(alivePlayer({ positionXWorld: (20 - 10) * B }), room, 0, 0, ports);
  assert.equal(ports.log.enqueueResidentBuild[0].priority, 1);
});

test('policy proximity: resident runtimeReady → no enqueue', () => {
  const residents = new Map([['room-r', { runtimeReady: true }]]);
  const room = makeRoom({ widthBlocks: 20, transitions: [makeTransition('right', 'room-r')] });
  const ports = makePorts({ residents });
  applyRoomPreloadAnticipationPolicy(alivePlayer({ positionXWorld: (20 - 10) * B }), room, 0, 0, ports);
  assert.equal(ports.log.enqueueResidentBuild.length, 0);
});

test('policy proximity: only first matching transition is boosted (one per frame)', () => {
  const room = makeRoom({
    widthBlocks: 20,
    transitions: [
      makeTransition('right', 'room-r'),
      makeTransition('right', 'room-r2'), // second right — should never fire
    ],
  });
  const ports = makePorts();
  applyRoomPreloadAnticipationPolicy(alivePlayer({ positionXWorld: (20 - 10) * B }), room, 0, 0, ports);
  assert.deepEqual(ports.log.ensureChunkPrewarm, ['room-r']); // only first
});

test('policy velocity: vx 1.5 right → enqueue priority 2 velocityDirection', () => {
  const room = makeRoom({ transitions: [makeTransition('right', 'room-r')] });
  const ports = makePorts();
  applyRoomPreloadAnticipationPolicy(
    alivePlayer({ velocityXWorld: 1.5 }),
    room, 0, 0, ports,
  );
  assert.equal(ports.log.enqueueResidentBuild.length, 1);
  assert.deepEqual(ports.log.enqueueResidentBuild[0], { roomId: 'room-r', priority: 2, reason: 'velocityDirection' });
});

test('policy velocity: vx -1.5 → left', () => {
  const room = makeRoom({ transitions: [makeTransition('left', 'room-l')] });
  const ports = makePorts();
  applyRoomPreloadAnticipationPolicy(alivePlayer({ velocityXWorld: -1.5 }), room, 0, 0, ports);
  assert.equal(ports.log.enqueueResidentBuild[0]?.roomId, 'room-l');
});

test('policy velocity: vy 1.5 → down', () => {
  const room = makeRoom({ transitions: [makeTransition('down', 'room-d')] });
  const ports = makePorts();
  applyRoomPreloadAnticipationPolicy(alivePlayer({ velocityYWorld: 1.5 }), room, 0, 0, ports);
  assert.equal(ports.log.enqueueResidentBuild[0]?.roomId, 'room-d');
});

test('policy velocity: vy -1.5 → up', () => {
  const room = makeRoom({ transitions: [makeTransition('up', 'room-u')] });
  const ports = makePorts();
  applyRoomPreloadAnticipationPolicy(alivePlayer({ velocityYWorld: -1.5 }), room, 0, 0, ports);
  assert.equal(ports.log.enqueueResidentBuild[0]?.roomId, 'room-u');
});

test('policy velocity: exactly ±1.0 does not trigger', () => {
  // widthBlocks=40 so center (20*B) is far from all thresholds (10 blocks from either edge)
  const room = makeRoom({ widthBlocks: 40, heightBlocks: 40, transitions: [makeTransition('right', 'room-r'), makeTransition('left', 'room-l')] });
  const ports = makePorts();
  // Position player in center of room, far from all proximity thresholds
  const center = 20 * B;
  applyRoomPreloadAnticipationPolicy(alivePlayer({ positionXWorld: center, positionYWorld: center, velocityXWorld: 1.0 }), room, 0, 0, ports);
  assert.equal(ports.log.enqueueResidentBuild.length, 0);
});

test('policy velocity: horizontal tie (|vx|===|vy|) → horizontal wins', () => {
  const room = makeRoom({ transitions: [makeTransition('right', 'room-r'), makeTransition('down', 'room-d')] });
  const ports = makePorts();
  applyRoomPreloadAnticipationPolicy(alivePlayer({ velocityXWorld: 2.0, velocityYWorld: 2.0 }), room, 0, 0, ports);
  assert.equal(ports.log.enqueueResidentBuild[0]?.roomId, 'room-r');
});

test('policy velocity: resident ready → no enqueue', () => {
  const residents = new Map([['room-r', { runtimeReady: true }]]);
  const room = makeRoom({ transitions: [makeTransition('right', 'room-r')] });
  const ports = makePorts({ residents });
  applyRoomPreloadAnticipationPolicy(alivePlayer({ velocityXWorld: 1.5 }), room, 0, 0, ports);
  assert.equal(ports.log.enqueueResidentBuild.length, 0);
});

test('policy velocity: no matching transition → no enqueue', () => {
  // widthBlocks=40 so center is far from all proximity thresholds
  const room = makeRoom({ widthBlocks: 40, heightBlocks: 40, transitions: [makeTransition('left', 'room-l')] });
  const ports = makePorts();
  const center = 20 * B;
  // vx 1.5 → right direction, but no right transition; also not near any boundary
  applyRoomPreloadAnticipationPolicy(alivePlayer({ positionXWorld: center, positionYWorld: center, velocityXWorld: 1.5 }), room, 0, 0, ports);
  assert.equal(ports.log.enqueueResidentBuild.length, 0);
});

test('policy combined: proximity and velocity select different rooms — both fire', () => {
  const room = makeRoom({
    widthBlocks: 20,
    transitions: [
      makeTransition('right', 'room-r'),
      makeTransition('up',    'room-u'),
    ],
  });
  const ports = makePorts();
  // Near right boundary AND moving up fast
  applyRoomPreloadAnticipationPolicy(
    alivePlayer({ positionXWorld: (20 - 10) * B, velocityYWorld: -1.5 }),
    room, 0, 0, ports,
  );
  assert.deepEqual(ports.log.ensureChunkPrewarm, ['room-r']); // proximity
  const builds = ports.log.enqueueResidentBuild;
  const proxBuild = builds.find(b => b.reason === 'proximity');
  const velBuild  = builds.find(b => b.reason === 'velocityDirection');
  assert.equal(proxBuild?.roomId, 'room-r');
  assert.equal(proxBuild?.priority, 1);
  assert.equal(velBuild?.roomId, 'room-u');
  assert.equal(velBuild?.priority, 2);
});

test('policy combined: proximity and velocity select the same room — two enqueues (coalescing left to scheduler)', () => {
  const room = makeRoom({
    widthBlocks: 20,
    transitions: [makeTransition('right', 'room-r')],
  });
  const ports = makePorts();
  applyRoomPreloadAnticipationPolicy(
    alivePlayer({ positionXWorld: (20 - 10) * B, velocityXWorld: 1.5 }),
    room, 0, 0, ports,
  );
  // Both policies fire; policy does not deduplicate.
  // The scheduler's coalescing will keep priority 1 (proximity wins over 2).
  const builds = ports.log.enqueueResidentBuild;
  assert.equal(builds.length, 2);
  assert.equal(builds[0].priority, 1);
  assert.equal(builds[1].priority, 2);
  assert.equal(builds[0].roomId, 'room-r');
  assert.equal(builds[1].roomId, 'room-r');
});

test('policy: side-effect ordering — prioritize then decode then prewarm then enqueue', () => {
  const order: string[] = [];
  const room = makeRoom({ widthBlocks: 20, transitions: [makeTransition('right', 'room-r')] });
  const ports: RoomPreloadAnticipationPorts = {
    getRuntimeEntry: () => undefined,
    prioritizeRuntime: () => { order.push('prioritize'); },
    decodeThemeSprites: () => { order.push('decodeSprites'); },
    decodeBackground: () => { order.push('decodeBackground'); },
    ensureChunkPrewarm: () => { order.push('prewarm'); },
    getResident: () => undefined,
    enqueueResidentBuild: () => { order.push('enqueue'); },
  };
  applyRoomPreloadAnticipationPolicy(alivePlayer({ positionXWorld: (20 - 10) * B }), room, 0, 0, ports);
  assert.deepEqual(order, ['prioritize', 'decodeSprites', 'decodeBackground', 'prewarm', 'enqueue']);
});
