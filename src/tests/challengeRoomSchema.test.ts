import test from 'node:test';
import assert from 'node:assert/strict';
import type { RoomJsonDef } from '../editor/roomJsonSchema';
import { jsonToEditorRoomData } from '../editor/roomJson';
import { editorRoomDataToJson } from '../editor/roomJsonSerializer';
import { dehydrateRoom } from '../levels/roomSchemaV2';
import { hydrateV2Room } from '../levels/roomSchemaHydrator';
import { roomJsonDefToRoomDef } from '../levels/roomJsonToRoomDef';

function room(overrides: Partial<RoomJsonDef> = {}): RoomJsonDef {
  return {
    id: 'challenge-room', name: 'Challenge Room', worldNumber: 1,
    widthBlocks: 20, heightBlocks: 15, playerSpawnBlock: [1, 1],
    interiorWalls: [], enemies: [], transitions: [], skillTombs: [], ...overrides,
  } as RoomJsonDef;
}

test('old room JSON defaults challenge elements to empty editor/runtime arrays', () => {
  const editor = jsonToEditorRoomData(room(), 0).data;
  assert.deepEqual([editor.challengeFields, editor.challengeGates, editor.challengeTotems, editor.gates], [[], [], [], []]);
  const runtime = roomJsonDefToRoomDef(room());
  assert.deepEqual([runtime.challengeFields, runtime.challengeGates, runtime.challengeTotems, runtime.gates], [[], [], [], []]);
});

test('challenge elements survive editor, saved-schema, hydration, and runtime round trip', () => {
  const source = room({
    challengeFields: [{ uid: 10, xBlock: 2, yBlock: 3, wBlock: 4, hBlock: 5 }],
    challengeGates: [{ uid: 11, xBlock: 8, yBlock: 2, wBlock: 1, hBlock: 4 }],
    challengeTotems: [{ uid: 12, xBlock: 12, yBlock: 7 }],
  });
  const verbose = editorRoomDataToJson(jsonToEditorRoomData(source, 0).data);
  const hydrated = hydrateV2Room(dehydrateRoom(verbose));
  const runtime = roomJsonDefToRoomDef(hydrated);
  assert.deepEqual(runtime.challengeFields, source.challengeFields);
  assert.deepEqual(runtime.challengeGates, []);
  assert.deepEqual(runtime.gates, [{
    ...source.challengeGates![0], schemaVersion: 1, kind: 'challenge', openVisualMode: 'fadeAway',
    openPersistence: 'untilPlayerLeavesRoom',
  }]);
  assert.deepEqual(runtime.challengeTotems, source.challengeTotems);
});

test('invalid challenge rectangles normalize to finite positive in-bounds integers with unique UIDs', () => {
  const editor = jsonToEditorRoomData(room({ challengeFields: [
    { uid: 1, xBlock: -4, yBlock: 14, wBlock: 0, hBlock: 99 },
    { uid: 1, xBlock: 19, yBlock: 14, wBlock: 2.5, hBlock: Number.NaN },
  ] }), 0).data;
  assert.deepEqual(editor.challengeFields?.map(({ xBlock, yBlock, wBlock, hBlock }) => ({ xBlock, yBlock, wBlock, hBlock })), [
    { xBlock: 0, yBlock: 14, wBlock: 1, hBlock: 1 },
    { xBlock: 19, yBlock: 14, wBlock: 1, hBlock: 1 },
  ]);
  assert.notEqual(editor.challengeFields?.[0].uid, editor.challengeFields?.[1].uid);
});

test('all shared gate kinds and settings survive editor and saved-room round trips', () => {
  const gates = [
    { schemaVersion: 1, uid: 20, kind: 'enemy', xBlock: 1, yBlock: 2, wBlock: 2, hBlock: 3, openVisualMode: 'darkRecessed', openPersistence: 'forever' },
    { schemaVersion: 1, uid: 21, kind: 'challenge', xBlock: 4, yBlock: 2, wBlock: 1, hBlock: 4, openVisualMode: 'fadeAway', openPersistence: 'untilPlayerLeavesRoom' },
    { schemaVersion: 1, uid: 22, kind: 'heart', xBlock: 6, yBlock: 2, wBlock: 3, hBlock: 1, openVisualMode: 'powder', openPersistence: 'untilPlayerSaves' },
    { schemaVersion: 1, uid: 23, kind: 'speed', xBlock: 10, yBlock: 2, wBlock: 2, hBlock: 4, openVisualMode: 'fadeAway', openPersistence: 'untilPlayerSaves', requiredSpeed: 234.5 },
  ] as const;
  const source = room({ gates: gates.map(gate => ({ ...gate })) });
  const verbose = editorRoomDataToJson(jsonToEditorRoomData(source, 0).data);
  assert.deepEqual(verbose.gates, gates);
  assert.deepEqual(roomJsonDefToRoomDef(hydrateV2Room(dehydrateRoom(verbose))).gates, gates);
});
