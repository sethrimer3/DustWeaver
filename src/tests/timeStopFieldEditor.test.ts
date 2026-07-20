/**
 * timeStopFieldEditor.test.ts — Editor-side TimeStop Field tests.
 *
 * Covers: JSON round trip through the actual editor save/load pipeline,
 * RoomDef <-> EditorRoomData conversion, undo/redo preservation, copy/paste
 * preservation with fresh uids, and non-interference with existing fields
 * (water/lava) and normal walls.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import type { EditorRoomData, EditorTimeStopField } from '../editor/editorElementTypes';
import { createEditorState } from '../editor/editorState';
import { editorRoomDataToJson, jsonToEditorRoomData } from '../editor/roomJson';
import { serializeSelectedElements, pasteFromClipboard } from '../editor/editorDragCopyPaste';
import { createEditorHistory, pushSnapshot, undo, redo } from '../editor/editorHistory';
import { editorRoomDataToRoomDef } from '../editor/editorRoomBuilder';
import { roomDefToEditorRoomData } from '../editor/editorRoomBuilder';
import { placeAtCursor } from '../editor/editorPlaceTool';
import { deleteAtCursor } from '../editor/editorDeleteTool';
import { PALETTE_ITEMS } from '../editor/editorPaletteItems';
import { isCellCoveredByTimeStopField } from '../editor/editorHitTest';

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
    waterZones: [],
    lavaZones: [],
    timeStopFields: [],
    ...overrides,
  } as unknown as EditorRoomData;
}

// ── Editor placement (click + erase) ─────────────────────────────────────────

test('placing a TimeStop Field tile via the Place tool adds it to room.timeStopFields', () => {
  const state = createEditorState();
  state.roomData = makeRoom();
  const item = PALETTE_ITEMS.find(i => i.id === 'timestop_field');
  assert.ok(item, 'palette must contain the timestop_field item');
  state.selectedPaletteItem = item!;
  state.cursorBlockX = 5;
  state.cursorBlockY = 6;

  placeAtCursor(state);

  assert.equal(state.roomData.timeStopFields?.length, 1);
  assert.deepEqual(
    { xBlock: state.roomData.timeStopFields![0].xBlock, yBlock: state.roomData.timeStopFields![0].yBlock },
    { xBlock: 5, yBlock: 6 },
  );
});

test('placing the same cell twice is idempotent (no duplicate)', () => {
  const state = createEditorState();
  state.roomData = makeRoom();
  state.selectedPaletteItem = PALETTE_ITEMS.find(i => i.id === 'timestop_field')!;
  state.cursorBlockX = 2;
  state.cursorBlockY = 2;
  placeAtCursor(state);
  placeAtCursor(state);
  assert.equal(state.roomData.timeStopFields?.length, 1);
});

test('erasing a placed TimeStop Field tile removes it', () => {
  const state = createEditorState();
  state.roomData = makeRoom();
  state.selectedPaletteItem = PALETTE_ITEMS.find(i => i.id === 'timestop_field')!;
  state.cursorBlockX = 3;
  state.cursorBlockY = 3;
  placeAtCursor(state);
  assert.equal(isCellCoveredByTimeStopField(state.roomData, 3, 3), true);

  deleteAtCursor(state);
  assert.equal(state.roomData.timeStopFields?.length ?? 0, 0);
});

test('erasing one cell of a larger placed rectangle splits it, keeping the rest', () => {
  const state = createEditorState();
  state.roomData = makeRoom({
    timeStopFields: [{ uid: 1, xBlock: 0, yBlock: 0, wBlock: 3, hBlock: 1 }],
  });
  state.cursorBlockX = 1;
  state.cursorBlockY = 0;
  deleteAtCursor(state);

  // Middle cell removed — left and right 1-wide remainders should remain,
  // covering (0,0) and (2,0) but not (1,0).
  assert.equal(isCellCoveredByTimeStopField(state.roomData, 0, 0), true);
  assert.equal(isCellCoveredByTimeStopField(state.roomData, 1, 0), false);
  assert.equal(isCellCoveredByTimeStopField(state.roomData, 2, 0), true);
});

test('placing a TimeStop Field tile does not affect existing water/lava zones or walls', () => {
  const state = createEditorState();
  state.roomData = makeRoom({
    waterZones: [{ uid: 10, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 }],
    interiorWalls: [{ uid: 11, xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1 } as never],
  });
  state.selectedPaletteItem = PALETTE_ITEMS.find(i => i.id === 'timestop_field')!;
  state.cursorBlockX = 5;
  state.cursorBlockY = 5; // same cell as the existing water zone

  placeAtCursor(state);

  assert.equal(state.roomData.waterZones?.length, 1, 'existing water zone must be untouched');
  assert.equal(state.roomData.interiorWalls.length, 1, 'existing wall must be untouched');
  assert.equal(state.roomData.timeStopFields?.length, 1, 'TimeStop Field is an independent layer — placement over water succeeds');
});

// ── JSON round trip ───────────────────────────────────────────────────────────

test('TimeStop Field tiles round-trip xBlock/yBlock/wBlock/hBlock exactly through JSON save/load', () => {
  const room = makeRoom({
    timeStopFields: [
      { uid: 1, xBlock: 3, yBlock: 4, wBlock: 2, hBlock: 1 },
      { uid: 2, xBlock: 9, yBlock: 1, wBlock: 1, hBlock: 3 },
    ],
  });
  const json = editorRoomDataToJson(room);
  const reparsed = JSON.parse(JSON.stringify(json));
  const { data: loaded } = jsonToEditorRoomData(reparsed, 1000);

  assert.equal(loaded.timeStopFields?.length, 2);
  const sorted = [...loaded.timeStopFields!].sort((a, b) => a.xBlock - b.xBlock);
  assert.deepEqual(
    sorted.map(z => ({ xBlock: z.xBlock, yBlock: z.yBlock, wBlock: z.wBlock, hBlock: z.hBlock })),
    [{ xBlock: 3, yBlock: 4, wBlock: 2, hBlock: 1 }, { xBlock: 9, yBlock: 1, wBlock: 1, hBlock: 3 }],
  );
  // uid is session-local, freshly assigned — never persisted.
  const uids = loaded.timeStopFields!.map(z => z.uid);
  assert.equal(new Set(uids).size, 2);
  for (const u of uids) assert.ok(u >= 1000);
});

test('a room with no TimeStop Field tiles omits the key from JSON (old-room compatibility)', () => {
  const room = makeRoom({ timeStopFields: [] });
  const json = editorRoomDataToJson(room);
  assert.equal((json as { timeStopFields?: unknown }).timeStopFields, undefined);
});

// ── RoomDef <-> EditorRoomData (gameplay export / import direction) ─────────

test('editorRoomDataToRoomDef -> roomDefToEditorRoomData round-trips TimeStop Field placements', () => {
  const room = makeRoom({
    timeStopFields: [{ uid: 5, xBlock: 2, yBlock: 2, wBlock: 1, hBlock: 1 }],
  });
  const roomDef = editorRoomDataToRoomDef(room);
  assert.equal(roomDef.timeStopFields?.length, 1);
  assert.deepEqual(
    { xBlock: roomDef.timeStopFields![0].xBlock, yBlock: roomDef.timeStopFields![0].yBlock },
    { xBlock: 2, yBlock: 2 },
  );

  const { data: reimported } = roomDefToEditorRoomData(roomDef);
  assert.equal(reimported.timeStopFields?.length, 1);
});

// ── Undo / redo ───────────────────────────────────────────────────────────────

test('undo restores TimeStop Field cells removed by a subsequent edit; redo re-removes them', () => {
  const history = createEditorHistory();
  const withField = makeRoom({ timeStopFields: [{ uid: 1, xBlock: 4, yBlock: 4, wBlock: 1, hBlock: 1 }] });
  pushSnapshot(history, withField);

  const withoutField = makeRoom({ timeStopFields: [] });
  const undone = undo(history, withoutField);
  assert.ok(undone);
  assert.equal(undone!.roomData.timeStopFields?.length, 1, 'undo must restore the erased TimeStop Field tile');

  const redone = redo(history, undone!.roomData);
  assert.ok(redone);
  assert.equal(redone!.roomData.timeStopFields?.length, 0, 'redo must re-apply the erase');
});

// ── Copy / paste ──────────────────────────────────────────────────────────────

test('copy-pasting a TimeStop Field tile preserves its type and gets a fresh distinct uid', () => {
  const state = createEditorState();
  const room = makeRoom({ timeStopFields: [{ uid: 42, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 }] });
  state.roomData = room;
  state.nextUid = 100;

  const clipboard = serializeSelectedElements(room, [{ type: 'timeStopField', uid: 42 }]);
  state.clipboard = clipboard;
  state.cursorBlockX = 9;
  state.cursorBlockY = 9;

  pasteFromClipboard(state);

  assert.equal(room.timeStopFields!.length, 2, 'original plus one pasted copy');
  const original = room.timeStopFields!.find((z: EditorTimeStopField) => z.uid === 42);
  assert.ok(original, 'original tile must remain untouched');
  const pasted = room.timeStopFields!.find((z: EditorTimeStopField) => z.uid !== 42);
  assert.ok(pasted, 'a new tile with a distinct uid must have been created');
  assert.notEqual(pasted!.uid, 42);
  assert.equal(pasted!.wBlock, 1);
  assert.equal(pasted!.hBlock, 1);
});
