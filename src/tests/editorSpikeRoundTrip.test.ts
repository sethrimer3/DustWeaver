/**
 * editorSpikeRoundTrip.test.ts — Regression coverage for the spike-persistence
 * bug: roomDefToEditorRoomData() (editorRoomImporter.ts) previously dropped
 * `room.spikes` entirely, so spikes disappeared after Save & Test or after
 * reopening a room through the runtime RoomDef path.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { EditorRoomData, EditorSpike } from '../editor/editorElementTypes';
import { editorRoomDataToRoomDef } from '../editor/editorRoomBuilder';
import { roomDefToEditorRoomData } from '../editor/editorRoomImporter';
import type { SpikeDirection } from '../levels/roomDef';

function makeRoom(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    id: 'test_room',
    name: 'Test Room',
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    blockTheme: 'blackRock',
    backgroundId: 'cave',
    lightingEffect: 'DEFAULT',
    songId: '_continue',
    widthBlocks: 20,
    heightBlocks: 20,
    playerSpawnBlock: [2, 2],
    interiorWalls: [],
    enemies: [],
    transitions: [],
    saveTombs: [],
    skillTombs: [],
    dustContainers: [],
    dustContainerPieces: [],
    dustBoostJars: [],
    dustSwarms: [],
    lambdaAnchors: [],
    dustPiles: [],
    grasshopperAreas: [],
    fireflyAreas: [],
    decorations: [],
    ambientLightBlockers: [],
    lightSources: [],
    spikes: [],
    ...overrides,
  } as unknown as EditorRoomData;
}

function makeSpike(overrides: Partial<EditorSpike> = {}): EditorSpike {
  return {
    uid: 0,
    xBlock: 3,
    yBlock: 4,
    direction: 'up',
    size: '1x1',
    blockTheme: undefined,
    ...overrides,
  };
}

function roundTrip(room: EditorRoomData): EditorRoomData {
  const roomDef = editorRoomDataToRoomDef(room);
  return roomDefToEditorRoomData(roomDef, 1000).data;
}

test('a single 1x1 spike survives EditorRoomData -> RoomDef -> EditorRoomData', () => {
  const room = makeRoom({ spikes: [makeSpike({ xBlock: 3, yBlock: 4, direction: 'up' })] });
  const reimported = roundTrip(room);

  assert.equal((reimported.spikes ?? []).length, 1);
  const sp = reimported.spikes![0];
  assert.equal(sp.xBlock, 3);
  assert.equal(sp.yBlock, 4);
  assert.equal(sp.direction, 'up');
  assert.equal(sp.size, '1x1');
});

test('a 2x2 spike preserves its size through the round trip', () => {
  const room = makeRoom({ spikes: [makeSpike({ xBlock: 5, yBlock: 6, direction: 'down', size: '2x2' })] });
  const reimported = roundTrip(room);

  assert.equal((reimported.spikes ?? []).length, 1);
  assert.equal(reimported.spikes![0].size, '2x2');
});

test('all four spike directions survive the round trip', () => {
  const directions: SpikeDirection[] = ['up', 'down', 'left', 'right'];
  const room = makeRoom({
    spikes: directions.map((direction, i) => makeSpike({ uid: i, xBlock: i, yBlock: i, direction })),
  });
  const reimported = roundTrip(room);

  assert.equal((reimported.spikes ?? []).length, 4);
  for (const direction of directions) {
    assert.ok(
      reimported.spikes!.some(sp => sp.direction === direction),
      `expected a spike with direction ${direction} to survive the round trip`,
    );
  }
});

test('a spike with a theme override preserves blockTheme through the round trip', () => {
  const room = makeRoom({ spikes: [makeSpike({ xBlock: 1, yBlock: 1, blockTheme: 'ice' })] });
  const reimported = roundTrip(room);

  assert.equal((reimported.spikes ?? []).length, 1);
  assert.equal(reimported.spikes![0].blockTheme, 'ice');
});

test('a spike with no theme override defaults to undefined (room theme) through the round trip', () => {
  const room = makeRoom({ spikes: [makeSpike({ xBlock: 1, yBlock: 1, blockTheme: undefined })] });
  const reimported = roundTrip(room);

  assert.equal(reimported.spikes![0].blockTheme, undefined);
});

test('multiple spikes retain their positions and count through the round trip', () => {
  const placements: Array<[number, number, SpikeDirection]> = [
    [2, 2, 'up'],
    [10, 2, 'down'],
    [2, 10, 'left'],
    [10, 10, 'right'],
    [6, 6, 'up'],
  ];
  const room = makeRoom({
    spikes: placements.map(([xBlock, yBlock, direction], i) =>
      makeSpike({ uid: i, xBlock, yBlock, direction })),
  });
  const reimported = roundTrip(room);

  assert.equal((reimported.spikes ?? []).length, placements.length);
  const positions = new Set(reimported.spikes!.map(sp => `${sp.xBlock},${sp.yBlock}`));
  assert.deepEqual(positions, new Set(placements.map(([x, y]) => `${x},${y}`)));

  // uids assigned during reimport must be unique.
  const uids = new Set(reimported.spikes!.map(sp => sp.uid));
  assert.equal(uids.size, placements.length);
});

test('spikes do not disappear when the room also contains other hazard types', () => {
  const room = makeRoom({
    spikes: [makeSpike({ xBlock: 3, yBlock: 3, direction: 'up' })],
    lavaZones: [{ uid: 0, xBlock: 0, yBlock: 0, wBlock: 2, hBlock: 2 }],
  } as Partial<EditorRoomData>);
  const reimported = roundTrip(room);

  assert.equal((reimported.spikes ?? []).length, 1);
  assert.equal((reimported.lavaZones ?? []).length, 1);
});
