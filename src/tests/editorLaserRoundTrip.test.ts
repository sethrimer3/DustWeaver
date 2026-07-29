/**
 * editorLaserRoundTrip.test.ts — persistence/editor coverage for the
 * placeable Laser Emitter hazard: palette placement, all four directions,
 * EditorRoomData <-> RoomDef, JSON, and compact-schema (V2) round trips,
 * copy, and room-resize clipping.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { EditorRoomData } from '../editor/editorElementTypes';
import type { EditorLaser } from '../editor/editorElementTypes';
import { editorRoomDataToRoomDef } from '../editor/editorRoomBuilder';
import { roomDefToEditorRoomData } from '../editor/editorRoomImporter';
import { editorRoomDataToJson } from '../editor/roomJsonSerializer';
import { jsonToEditorRoomData } from '../editor/roomJson';
import { dehydrateRoom } from '../levels/roomSchemaV2';
import { hydrateV2Room } from '../levels/roomSchemaHydrator';
import { serializeSelectedElements, pasteFromClipboard } from '../editor/editorDragCopyPaste';
import { applyRoomDimensionChange } from '../editor/editorRoomResize';
import { createEditorState } from '../editor/editorState';
import { PALETTE_ITEMS } from '../editor/editorPaletteItems';
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
    lasers: [],
    ...overrides,
  } as unknown as EditorRoomData;
}

function makeLaser(overrides: Partial<EditorLaser> = {}): EditorLaser {
  return {
    uid: 0,
    xBlock: 3,
    yBlock: 4,
    direction: 'up',
    ...overrides,
  };
}

function roundTripDef(room: EditorRoomData): EditorRoomData {
  const roomDef = editorRoomDataToRoomDef(room);
  return roomDefToEditorRoomData(roomDef, 1000).data;
}

// ── Palette registration ─────────────────────────────────────────────────────

test('the Laser Emitter is registered in the palette under the hazard/blocks category', () => {
  const item = PALETTE_ITEMS.find(i => i.id === 'laser_emitter');
  assert.ok(item, 'laser_emitter must be a registered palette item');
  assert.equal(item!.isLaserItem, 1);
  assert.equal(item!.defaultWidthBlocks, 1);
  assert.equal(item!.defaultHeightBlocks, 1);
});

// ── EditorRoomData -> RoomDef -> EditorRoomData round trip ──────────────────

test('a single laser survives EditorRoomData -> RoomDef -> EditorRoomData', () => {
  const room = makeRoom({ lasers: [makeLaser({ xBlock: 3, yBlock: 4, direction: 'up' })] });
  const reimported = roundTripDef(room);
  assert.equal((reimported.lasers ?? []).length, 1);
  const l = reimported.lasers![0];
  assert.equal(l.xBlock, 3);
  assert.equal(l.yBlock, 4);
  assert.equal(l.direction, 'up');
});

test('all four laser directions survive the RoomDef round trip', () => {
  const directions: SpikeDirection[] = ['up', 'down', 'left', 'right'];
  const room = makeRoom({
    lasers: directions.map((direction, i) => makeLaser({ uid: i, xBlock: i, yBlock: i, direction })),
  });
  const reimported = roundTripDef(room);
  assert.equal((reimported.lasers ?? []).length, 4);
  for (const direction of directions) {
    assert.ok(reimported.lasers!.some(l => l.direction === direction));
  }
});

test('multiple lasers retain unique positions and uids through the round trip', () => {
  const placements: Array<[number, number, SpikeDirection]> = [
    [2, 2, 'up'], [10, 2, 'down'], [2, 10, 'left'], [10, 10, 'right'],
  ];
  const room = makeRoom({
    lasers: placements.map(([xBlock, yBlock, direction], i) => makeLaser({ uid: i, xBlock, yBlock, direction })),
  });
  const reimported = roundTripDef(room);
  assert.equal((reimported.lasers ?? []).length, placements.length);
  const positions = new Set(reimported.lasers!.map(l => `${l.xBlock},${l.yBlock}`));
  assert.deepEqual(positions, new Set(placements.map(([x, y]) => `${x},${y}`)));
  const uids = new Set(reimported.lasers!.map(l => l.uid));
  assert.equal(uids.size, placements.length);
});

test('lasers coexist with other hazard types without disappearing', () => {
  const room = makeRoom({
    lasers: [makeLaser({ xBlock: 3, yBlock: 3, direction: 'right' })],
    lavaZones: [{ uid: 0, xBlock: 0, yBlock: 0, wBlock: 2, hBlock: 2 }],
  } as Partial<EditorRoomData>);
  const reimported = roundTripDef(room);
  assert.equal((reimported.lasers ?? []).length, 1);
  assert.equal((reimported.lavaZones ?? []).length, 1);
});

// ── JSON round trip ───────────────────────────────────────────────────────────

test('a laser survives EditorRoomData -> RoomJson -> EditorRoomData', () => {
  const room = makeRoom({ lasers: [makeLaser({ xBlock: 5, yBlock: 6, direction: 'left' })] });
  const json = editorRoomDataToJson(room);
  assert.equal((json.lasers ?? []).length, 1);
  assert.equal(json.lasers![0].direction, 'left');

  const { data: restored } = jsonToEditorRoomData(json, 1000);
  assert.equal((restored.lasers ?? []).length, 1);
  assert.equal(restored.lasers![0].xBlock, 5);
  assert.equal(restored.lasers![0].yBlock, 6);
  assert.equal(restored.lasers![0].direction, 'left');
});

// ── Compact schema V2 round trip ─────────────────────────────────────────────

test('a laser survives RoomJson -> compact V2 -> RoomJson', () => {
  const room = makeRoom({ lasers: [makeLaser({ xBlock: 7, yBlock: 8, direction: 'down' })] });
  const json = editorRoomDataToJson(room);
  const saved = dehydrateRoom(json);
  assert.ok(saved.lasers && saved.lasers.length === 1);
  assert.deepEqual(saved.lasers![0], [7, 8, 'down']);

  const rehydrated = hydrateV2Room(saved);
  assert.equal((rehydrated.lasers ?? []).length, 1);
  assert.equal(rehydrated.lasers![0].xBlock, 7);
  assert.equal(rehydrated.lasers![0].yBlock, 8);
  assert.equal(rehydrated.lasers![0].direction, 'down');
});

test('multiple lasers with all directions survive the compact V2 round trip', () => {
  const directions: SpikeDirection[] = ['up', 'down', 'left', 'right'];
  const room = makeRoom({
    lasers: directions.map((direction, i) => makeLaser({ uid: i, xBlock: i * 2, yBlock: i, direction })),
  });
  const json = editorRoomDataToJson(room);
  const saved = dehydrateRoom(json);
  const rehydrated = hydrateV2Room(saved);
  assert.equal((rehydrated.lasers ?? []).length, 4);
  for (const direction of directions) {
    assert.ok(rehydrated.lasers!.some(l => l.direction === direction));
  }
});

// ── Copy / paste ──────────────────────────────────────────────────────────────

test('copy/paste duplicates a laser with a fresh uid at the cursor position', () => {
  const state = createEditorState();
  state.roomData = makeRoom({ lasers: [makeLaser({ uid: 5, xBlock: 3, yBlock: 3, direction: 'right' })] });
  state.clipboard = serializeSelectedElements(state.roomData, [{ type: 'laser', uid: 5 }]);
  state.cursorBlockX = 10;
  state.cursorBlockY = 10;
  const pasted = pasteFromClipboard(state);
  assert.equal(pasted, true);

  const lasers = state.roomData.lasers ?? [];
  assert.equal(lasers.length, 2, 'original plus pasted copy');
  const newLaser = lasers.find(l => l.uid !== 5);
  assert.ok(newLaser, 'a new laser with a distinct uid must have been pasted');
  assert.equal(newLaser!.direction, 'right');
});

// ── Room resize clipping ──────────────────────────────────────────────────────

test('resizing the room clamps an out-of-bounds laser back inside the new dimensions', () => {
  const state = createEditorState();
  state.roomData = makeRoom({
    widthBlocks: 20, heightBlocks: 20,
    lasers: [makeLaser({ uid: 1, xBlock: 19, yBlock: 19, direction: 'up' })],
  });
  applyRoomDimensionChange(state.roomData, 'widthBlocks', 10);
  applyRoomDimensionChange(state.roomData, 'heightBlocks', 10);

  const lasers = state.roomData.lasers ?? [];
  assert.equal(lasers.length, 1, 'the laser must be clamped in place, not dropped');
  const l = lasers[0];
  assert.ok(l.xBlock <= 9, `expected xBlock <= 9, got ${l.xBlock}`);
  assert.ok(l.yBlock <= 9, `expected yBlock <= 9, got ${l.yBlock}`);
});
