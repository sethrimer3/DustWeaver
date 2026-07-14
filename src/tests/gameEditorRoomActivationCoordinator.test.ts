import assert from 'node:assert/strict';
import test from 'node:test';

import type { RoomDef, RoomTransitionDef } from '../levels/roomDef';
import type { WorldState } from '../sim/world';
import {
  applyGameEditorRoomActivation,
  type GameEditorRoomActivationPorts,
} from '../screens/gameEditorRoomActivationCoordinator';

interface RecordedCall {
  name: string;
  args: readonly unknown[];
}

interface HarnessOptions {
  resolvedSpawn?: readonly [number, number];
  oldWorld?: WorldState;
  newWorld?: WorldState;
  loadError?: Error;
}

function makeTransition(targetRoomId: string): RoomTransitionDef {
  return {
    direction: 'right',
    targetRoomId,
    xBlock: 0,
    yBlock: 0,
    positionBlock: 0,
    openingSizeBlocks: 1,
    targetSpawnBlock: [1, 1],
  };
}

function makeRoom(
  id: string,
  transitions: readonly RoomTransitionDef[] = [],
  worldNumber: number | 'absent' = 2,
): RoomDef {
  return {
    id,
    name: id,
    mapX: 0,
    mapY: 0,
    transitions: [...transitions],
    ...(worldNumber === 'absent' ? {} : { worldNumber }),
  } as unknown as RoomDef;
}

function makeWorld(label: string): WorldState {
  return { testLabel: label } as unknown as WorldState;
}

function createHarness(options: HarnessOptions = {}): {
  calls: RecordedCall[];
  ports: GameEditorRoomActivationPorts;
  oldWorld: WorldState;
  newWorld: WorldState;
} {
  const calls: RecordedCall[] = [];
  const oldWorld = options.oldWorld ?? makeWorld('old');
  const newWorld = options.newWorld ?? makeWorld('new');
  let activeWorld = oldWorld;
  const record = (name: string, ...args: readonly unknown[]): void => {
    calls.push({ name, args });
  };

  const ports: GameEditorRoomActivationPorts = {
    resolveSpawn: (room, spawnX, spawnY) => {
      record('resolveSpawn', room, spawnX, spawnY);
      return options.resolvedSpawn ?? [spawnX, spawnY];
    },
    bumpRoomVersion: roomId => { record('bumpRoomVersion', roomId); },
    invalidateRuntime: roomId => { record('invalidateRuntime', roomId); },
    invalidateChunkPrewarm: roomId => { record('invalidateChunkPrewarm', roomId); },
    invalidateResidentWorld: roomId => { record('invalidateResidentWorld', roomId); },
    invalidateZone: worldNumber => { record('invalidateZone', worldNumber); },
    queueRebuildAfterEdit: roomId => { record('queueRebuildAfterEdit', roomId); },
    loadRoom: (room, spawnX, spawnY, preserveCamera) => {
      record('loadRoom', room, spawnX, spawnY, preserveCamera);
      if (options.loadError !== undefined) throw options.loadError;
      activeWorld = newWorld;
    },
    getActiveWorld: () => {
      record('getActiveWorld');
      return activeWorld;
    },
    ensureResident: room => { record('ensureResident', room); },
    setActiveResidentId: roomId => { record('setActiveResidentId', roomId); },
    setResidentWorld: (roomId, world, isActive) => {
      record('setResidentWorld', roomId, world, isActive);
    },
  };

  return { calls, ports, oldWorld, newWorld };
}

function callNames(calls: readonly RecordedCall[]): string[] {
  return calls.map(call => call.name);
}

test('no-neighbor transaction preserves the complete synchronous call order', () => {
  const room = makeRoom('edited');
  const registry = new Map([[room.id, room]]);
  const harness = createHarness({ resolvedSpawn: [7, 9] });

  applyGameEditorRoomActivation(room, 3, 4, true, registry, harness.ports);

  assert.deepEqual(callNames(harness.calls), [
    'resolveSpawn',
    'bumpRoomVersion',
    'invalidateRuntime',
    'invalidateChunkPrewarm',
    'invalidateResidentWorld',
    'invalidateZone',
    'queueRebuildAfterEdit',
    'loadRoom',
    'getActiveWorld',
    'ensureResident',
    'setActiveResidentId',
    'setResidentWorld',
  ]);
  assert.deepEqual(harness.calls[0]?.args, [room, 3, 4]);
  assert.deepEqual(harness.calls[7]?.args, [room, 7, 9, true]);
  assert.deepEqual(harness.calls[11]?.args, ['edited', harness.newWorld, true]);
});

test('radius-one neighbors are invalidated and rebuilt once in authored order', () => {
  const edited = makeRoom('edited', [
    makeTransition('beta'),
    makeTransition('alpha'),
    makeTransition('beta'),
  ]);
  const beta = makeRoom('beta', [makeTransition('edited')]);
  const alpha = makeRoom('alpha', [makeTransition('edited')]);
  const registry = new Map([
    [edited.id, edited],
    [beta.id, beta],
    [alpha.id, alpha],
  ]);
  const harness = createHarness();

  applyGameEditorRoomActivation(edited, 1, 2, false, registry, harness.ports);

  assert.deepEqual(callNames(harness.calls), [
    'resolveSpawn',
    'bumpRoomVersion',
    'invalidateRuntime',
    'invalidateChunkPrewarm',
    'invalidateResidentWorld',
    'invalidateResidentWorld',
    'invalidateChunkPrewarm',
    'invalidateResidentWorld',
    'invalidateChunkPrewarm',
    'invalidateZone',
    'queueRebuildAfterEdit',
    'queueRebuildAfterEdit',
    'queueRebuildAfterEdit',
    'loadRoom',
    'getActiveWorld',
    'ensureResident',
    'setActiveResidentId',
    'setResidentWorld',
  ]);
  assert.deepEqual(
    harness.calls
      .filter(call => call.name === 'invalidateResidentWorld')
      .map(call => call.args[0]),
    ['edited', 'beta', 'alpha'],
  );
  assert.deepEqual(
    harness.calls
      .filter(call => call.name === 'invalidateChunkPrewarm')
      .map(call => call.args[0]),
    ['edited', 'beta', 'alpha'],
  );
  assert.deepEqual(
    harness.calls
      .filter(call => call.name === 'queueRebuildAfterEdit')
      .map(call => call.args[0]),
    ['edited', 'beta', 'alpha'],
  );
});

test('only the edited room receives a version bump and runtime invalidation', () => {
  const edited = makeRoom('edited', [makeTransition('neighbor')]);
  const neighbor = makeRoom('neighbor');
  const harness = createHarness();

  applyGameEditorRoomActivation(
    edited,
    0,
    0,
    false,
    new Map([[edited.id, edited], [neighbor.id, neighbor]]),
    harness.ports,
  );

  assert.deepEqual(
    harness.calls.filter(call => call.name === 'bumpRoomVersion').map(call => call.args[0]),
    ['edited'],
  );
  assert.deepEqual(
    harness.calls.filter(call => call.name === 'invalidateRuntime').map(call => call.args[0]),
    ['edited'],
  );
});

test('direct transition targets missing from the registry remain transaction neighbors', () => {
  const edited = makeRoom('edited', [makeTransition('missing')]);
  const harness = createHarness();

  applyGameEditorRoomActivation(
    edited,
    0,
    0,
    false,
    new Map([[edited.id, edited]]),
    harness.ports,
  );

  assert.deepEqual(
    harness.calls.filter(call => call.name === 'invalidateResidentWorld').map(call => call.args[0]),
    ['edited', 'missing'],
  );
  assert.deepEqual(
    harness.calls.filter(call => call.name === 'queueRebuildAfterEdit').map(call => call.args[0]),
    ['edited', 'missing'],
  );
});

test('zone invalidation uses the authored world number', () => {
  const room = makeRoom('edited', [], 8);
  const harness = createHarness();

  applyGameEditorRoomActivation(room, 0, 0, false, new Map([[room.id, room]]), harness.ports);

  const zoneCall = harness.calls.find(call => call.name === 'invalidateZone');
  assert.deepEqual(zoneCall?.args, [8]);
});

test('zone invalidation falls back to world one when the field is absent', () => {
  const room = makeRoom('edited', [], 'absent');
  const harness = createHarness();

  applyGameEditorRoomActivation(room, 0, 0, false, new Map([[room.id, room]]), harness.ports);

  const zoneCall = harness.calls.find(call => call.name === 'invalidateZone');
  assert.deepEqual(zoneCall?.args, [1]);
});

test('resolved spawn and false preserveCamera are forwarded unchanged', () => {
  const room = makeRoom('edited');
  const harness = createHarness({ resolvedSpawn: [12.5, 6.25] });

  applyGameEditorRoomActivation(room, -1, -2, false, new Map([[room.id, room]]), harness.ports);

  const loadCall = harness.calls.find(call => call.name === 'loadRoom');
  assert.deepEqual(loadCall?.args, [room, 12.5, 6.25, false]);
});

test('an absent preserveCamera value remains absent at the room loader boundary', () => {
  const room = makeRoom('edited');
  const harness = createHarness();

  applyGameEditorRoomActivation(
    room,
    1,
    2,
    undefined,
    new Map([[room.id, room]]),
    harness.ports,
  );

  const loadCall = harness.calls.find(call => call.name === 'loadRoom');
  assert.deepEqual(loadCall?.args, [room, 1, 2, undefined]);
});

test('fresh active world is looked up after load and registered in exact order', () => {
  const room = makeRoom('edited');
  const harness = createHarness();

  applyGameEditorRoomActivation(room, 0, 0, true, new Map([[room.id, room]]), harness.ports);

  const loadIndex = harness.calls.findIndex(call => call.name === 'loadRoom');
  assert.deepEqual(callNames(harness.calls).slice(loadIndex), [
    'loadRoom',
    'getActiveWorld',
    'ensureResident',
    'setActiveResidentId',
    'setResidentWorld',
  ]);
  const setWorldCall = harness.calls.find(call => call.name === 'setResidentWorld');
  assert.equal(setWorldCall?.args[1], harness.newWorld);
  assert.notEqual(setWorldCall?.args[1], harness.oldWorld);
});

test('a load failure propagates and prevents every post-load operation', () => {
  const room = makeRoom('edited');
  const loadError = new Error('load failed');
  const harness = createHarness({ loadError });

  assert.throws(
    () => applyGameEditorRoomActivation(
      room,
      0,
      0,
      false,
      new Map([[room.id, room]]),
      harness.ports,
    ),
    error => error === loadError,
  );

  assert.equal(harness.calls.at(-1)?.name, 'loadRoom');
  assert.equal(harness.calls.some(call => call.name === 'getActiveWorld'), false);
  assert.equal(harness.calls.some(call => call.name === 'ensureResident'), false);
  assert.equal(harness.calls.some(call => call.name === 'setResidentWorld'), false);
});

test('the transaction does not mutate the room definition or registry', () => {
  const edited = makeRoom('edited', [makeTransition('neighbor')]);
  const neighbor = makeRoom('neighbor');
  const registry = new Map([[edited.id, edited], [neighbor.id, neighbor]]);
  const roomSnapshot = structuredClone(edited);
  const registryEntries = [...registry.entries()];
  const harness = createHarness();

  applyGameEditorRoomActivation(edited, 0, 0, false, registry, harness.ports);

  assert.deepEqual(edited, roomSnapshot);
  assert.deepEqual([...registry.entries()], registryEntries);
});
