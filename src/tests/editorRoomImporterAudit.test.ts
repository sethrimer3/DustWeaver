/**
 * editorRoomImporterAudit.test.ts — Round-trip regression coverage for
 * EditorRoomData collections that editorRoomDataToRoomDef() (editorRoomBuilder.ts)
 * exports onto RoomDef but that roomDefToEditorRoomData() (editorRoomImporter.ts)
 * previously failed to import back, causing them to silently disappear after
 * Save & Test or after reopening a room through the runtime RoomDef path
 * (the same class of bug as the spike-persistence issue).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { EditorRoomData } from '../editor/editorElementTypes';
import { editorRoomDataToRoomDef } from '../editor/editorRoomBuilder';
import { roomDefToEditorRoomData } from '../editor/editorRoomImporter';

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
    ...overrides,
  } as unknown as EditorRoomData;
}

function roundTrip(room: EditorRoomData): EditorRoomData {
  const roomDef = editorRoomDataToRoomDef(room);
  return roomDefToEditorRoomData(roomDef, 1000).data;
}

test('bounce pads survive the RoomDef round trip', () => {
  const room = makeRoom({
    bouncePads: [{ uid: 0, xBlock: 2, yBlock: 3, wBlock: 1, hBlock: 1, speedFactorIndex: 1 }],
  } as Partial<EditorRoomData>);
  const reimported = roundTrip(room);
  assert.equal((reimported.bouncePads ?? []).length, 1);
  assert.equal(reimported.bouncePads![0].speedFactorIndex, 1);
});

test('kinetic blocks survive the RoomDef round trip', () => {
  const room = makeRoom({
    kineticBlocks: [{ uid: 0, xBlock: 4, yBlock: 5, wBlock: 2, hBlock: 2 }],
  } as Partial<EditorRoomData>);
  const reimported = roundTrip(room);
  assert.equal((reimported.kineticBlocks ?? []).length, 1);
  assert.equal(reimported.kineticBlocks![0].wBlock, 2);
  assert.equal(reimported.kineticBlocks![0].hBlock, 2);
});

test('zip-move blocks survive the RoomDef round trip', () => {
  const room = makeRoom({
    zipMoveBlocks: [{ uid: 0, xBlock: 1, yBlock: 1, wBlock: 3, hBlock: 3, variant: 'away' }],
  } as Partial<EditorRoomData>);
  const reimported = roundTrip(room);
  assert.equal((reimported.zipMoveBlocks ?? []).length, 1);
  assert.equal(reimported.zipMoveBlocks![0].variant, 'away');
});

test('background blocks survive the RoomDef round trip', () => {
  const room = makeRoom({
    backgroundBlocks: [{ uid: 0, xBlock: 0, yBlock: 0, wBlock: 2, hBlock: 1, blockTheme: 'ice', isLightBlockingFlag: 1 }],
  } as Partial<EditorRoomData>);
  const reimported = roundTrip(room);
  assert.equal((reimported.backgroundBlocks ?? []).length, 1);
  assert.equal(reimported.backgroundBlocks![0].blockTheme, 'ice');
  assert.equal(reimported.backgroundBlocks![0].isLightBlockingFlag, 1);
});

test('challenge fields, gates, and totems survive the RoomDef round trip', () => {
  const room = makeRoom({
    challengeFields: [{ uid: 0, xBlock: 1, yBlock: 1, wBlock: 4, hBlock: 4 }],
    challengeGates: [{ uid: 0, xBlock: 2, yBlock: 2, wBlock: 1, hBlock: 1 }],
    challengeTotems: [{ uid: 0, xBlock: 3, yBlock: 3 }],
  } as Partial<EditorRoomData>);
  const reimported = roundTrip(room);
  assert.equal((reimported.challengeFields ?? []).length, 1);
  assert.equal((reimported.challengeGates ?? []).length, 1);
  assert.equal((reimported.challengeTotems ?? []).length, 1);
});

test('gates survive the RoomDef round trip', () => {
  const room = makeRoom({
    gates: [{
      schemaVersion: 1, uid: 0, kind: 'speed', xBlock: 1, yBlock: 1, wBlock: 1, hBlock: 1,
      openVisualMode: 'fade', openPersistence: 'permanent', requiredSpeed: 5,
    }],
  } as Partial<EditorRoomData>);
  const reimported = roundTrip(room);
  assert.equal((reimported.gates ?? []).length, 1);
  assert.equal(reimported.gates![0].requiredSpeed, 5);
});

test('custom block placements survive the RoomDef round trip', () => {
  const room = makeRoom({
    customBlockPlacements: [{ uid: 0, xBlock: 1, yBlock: 1, blockId: 'custom:ice_block', tileWidth: 2, tileHeight: 2 }],
  } as Partial<EditorRoomData>);
  const reimported = roundTrip(room);
  assert.equal((reimported.customBlockPlacements ?? []).length, 1);
  assert.equal(reimported.customBlockPlacements![0].blockId, 'custom:ice_block');
  assert.equal(reimported.customBlockPlacements![0].tileWidth, 2);
  assert.equal(reimported.customBlockPlacements![0].tileHeight, 2);
});

test('room-level sunrays configuration survives the RoomDef round trip', () => {
  const room = makeRoom({
    sunrays: { enabled: true, style: 'soft', source: 'top', angleDeg: 60 } as EditorRoomData['sunrays'],
  });
  const reimported = roundTrip(room);
  assert.ok(reimported.sunrays);
  assert.equal(reimported.sunrays!.enabled, true);
  assert.equal(reimported.sunrays!.angleDeg, 60);
});
