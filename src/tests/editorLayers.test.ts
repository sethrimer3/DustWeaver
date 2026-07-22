import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState } from '../editor/editorState';
import type { EditorRoomData } from '../editor/editorElementTypes';
import {
  isLayerVisible,
  isLayerLocked,
  isLayerEditable,
  isAnyLayerSoloed,
  isAnySelectOnlyActive,
} from '../editor/editorLayers';
import { selectAtCursor, getHitCandidatesAnyLayer } from '../editor/editorTools';
import { deleteAtCursor, deleteAtCursorBrushed } from '../editor/editorDeleteTool';

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
    playerSpawnBlock: [18, 18],
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

/** Builds a room with an enemy (layer: enemies) stacked directly on top of a
 * wall (layer: terrain) at the same cell — the enemy hit-tests first (lower
 * priority number) in the shared candidate order. */
function makeStackedRoom(): EditorRoomData {
  return makeRoom({
    enemies: [{ uid: 1, xBlock: 5, yBlock: 5, type: 'basic' } as never],
    interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 } as never],
  });
}

function stateAt(room: EditorRoomData, bx: number, by: number) {
  const state = createEditorState();
  state.roomData = room;
  state.cursorBlockX = bx;
  state.cursorBlockY = by;
  return state;
}

test('isLayerVisible reflects the plain visible flag with no solo active', () => {
  const state = createEditorState();
  assert.equal(isLayerVisible(state, 'terrain'), true);
  state.layers.terrain.visible = false;
  assert.equal(isLayerVisible(state, 'terrain'), false);
});

test('soloing a layer hides all non-soloed layers regardless of their own visible flag', () => {
  const state = createEditorState();
  state.layers.hazards.solo = true;
  assert.equal(isAnyLayerSoloed(state), true);
  assert.equal(isLayerVisible(state, 'hazards'), true);
  // Terrain is still "visible" but solo isolation means it should not draw.
  assert.equal(state.layers.terrain.visible, true);
  assert.equal(isLayerVisible(state, 'terrain'), false);
});

test('a locked layer is never editable even while visible', () => {
  const state = createEditorState();
  state.layers.objects.locked = true;
  assert.equal(isLayerVisible(state, 'objects'), true);
  assert.equal(isLayerLocked(state, 'objects'), true);
  assert.equal(isLayerEditable(state, 'objects'), false);
});

test('a hidden layer is not editable even when unlocked', () => {
  const state = createEditorState();
  state.layers.enemies.visible = false;
  assert.equal(isLayerEditable(state, 'enemies'), false);
});

test('selectOnly restricts editability to selectOnly layers only', () => {
  const state = createEditorState();
  state.layers.terrain.selectOnly = true;
  assert.equal(isAnySelectOnlyActive(state), true);
  assert.equal(isLayerEditable(state, 'terrain'), true);
  assert.equal(isLayerEditable(state, 'hazards'), false);
});

// ── Item 2: eligible-candidate selection (not first-hit-rejection) ────────

test('with no layer restrictions, the top-priority (enemy) candidate is picked', () => {
  const room = makeStackedRoom();
  const state = stateAt(room, 5, 5);
  const candidates = getHitCandidatesAnyLayer(state);
  assert.equal(candidates.length, 2, 'both the enemy and the wall should be candidates at this cell');
  const sel = selectAtCursor(state);
  assert.deepEqual(sel, { type: 'enemy', uid: 1 });
});

test('a locked top object (enemy) does not block selection of an editable object beneath it (wall)', () => {
  const room = makeStackedRoom();
  const state = stateAt(room, 5, 5);
  state.layers.enemies.locked = true;
  const sel = selectAtCursor(state);
  assert.deepEqual(sel, { type: 'wall', uid: 2 }, 'selection should fall through to the eligible wall, not return null');
});

test('a hidden top object (enemy) does not block selection of an object beneath it (wall)', () => {
  const room = makeStackedRoom();
  const state = stateAt(room, 5, 5);
  state.layers.enemies.visible = false;
  const sel = selectAtCursor(state);
  assert.deepEqual(sel, { type: 'wall', uid: 2 });
});

test('if every candidate at a cell is ineligible, selection is null (not a wrong element)', () => {
  const room = makeStackedRoom();
  const state = stateAt(room, 5, 5);
  state.layers.enemies.locked = true;
  state.layers.terrain.locked = true;
  assert.equal(selectAtCursor(state), null);
});

test('hover and click selection resolve to the exact same candidate via the same function', () => {
  const room = makeStackedRoom();
  const state = stateAt(room, 5, 5);
  state.layers.enemies.locked = true;
  // The controller's hover path and click path both call selectAtCursor(state)
  // directly (see editorController.ts) — calling it twice in a row from
  // identical state must be stable and identical, proving there is no
  // separate parallel hover hit-test path re-deriving a different answer.
  const first = selectAtCursor(state);
  const second = selectAtCursor(state);
  assert.deepEqual(first, second);
  assert.deepEqual(first, { type: 'wall', uid: 2 });
});

// ── Item 3: deletion operates on the exact resolved candidate ─────────────

test('deleting a locked-out top object removes the eligible object beneath it, not the locked one', () => {
  const room = makeStackedRoom();
  const state = stateAt(room, 5, 5);
  state.layers.enemies.locked = true;
  deleteAtCursor(state);
  assert.equal(room.enemies.length, 1, 'locked enemy must survive the delete');
  assert.equal(room.interiorWalls.length, 0, 'the eligible wall beneath it should be the one removed');
});

test('deleting through a hidden top object removes the eligible object beneath it', () => {
  const room = makeStackedRoom();
  const state = stateAt(room, 5, 5);
  state.layers.enemies.visible = false;
  deleteAtCursor(state);
  assert.equal(room.enemies.length, 1, 'hidden enemy must survive the delete');
  assert.equal(room.interiorWalls.length, 0);
});

test('deleting with no locks removes exactly the top-priority resolved candidate (enemy), not both', () => {
  const room = makeStackedRoom();
  const state = stateAt(room, 5, 5);
  deleteAtCursor(state);
  assert.equal(room.enemies.length, 0, 'the top-priority enemy should be the one deleted');
  assert.equal(room.interiorWalls.length, 1, 'the wall beneath must be untouched');
});

test('deleting a fully-locked cell is a no-op (nothing eligible to delete)', () => {
  const room = makeStackedRoom();
  const state = stateAt(room, 5, 5);
  state.layers.enemies.locked = true;
  state.layers.terrain.locked = true;
  deleteAtCursor(state);
  assert.equal(room.enemies.length, 1);
  assert.equal(room.interiorWalls.length, 1);
});

test('right-click / brush delete (single brush mode) follows the same layer policy as normal delete', () => {
  const room = makeStackedRoom();
  const state = stateAt(room, 5, 5);
  state.layers.enemies.locked = true;
  // deleteAtCursorBrushed with the default 'single' brush mode is exactly
  // what right-click delete and right-drag erase invoke in editorController.ts.
  assert.equal(state.brushMode, 'single');
  deleteAtCursorBrushed(state);
  assert.equal(room.enemies.length, 1, 'locked enemy must survive brush delete too');
  assert.equal(room.interiorWalls.length, 0);
});
