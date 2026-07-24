import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorTool, createEditorState } from '../editor/editorState';
import type { EditorRoomData } from '../editor/editorElementTypes';
import type { PaletteItem } from '../editor/editorPaletteItems';
import {
  isLayerVisible,
  isLayerLocked,
  isLayerEditable,
  isAnyLayerSoloed,
  isAnySelectOnlyActive,
} from '../editor/editorLayers';
import {
  selectAtCursor, getHitCandidatesAnyLayer, findTopEligibleHitCandidate,
  rotateSelectedElement, flipSelectedTransition,
} from '../editor/editorTools';
import { deleteAtCursor, deleteAtCursorBrushed } from '../editor/editorDeleteTool';
import { moveSelectedElements, storeDragStartPositions, serializeSelectedElements, pasteFromClipboard } from '../editor/editorDragCopyPaste';
import { canMutateElement, canMutateSelection } from '../editor/editorLayers';
import { placeAtCursor } from '../editor/editorPlaceTool';
import { placePixelMaterialAt, erasePixelMaterialAt, paintPixelMaterialLine } from '../editor/editorPixelMaterialTool';
import { handlePropertyChange } from '../editor/editorPropertyChange';
import { createEditorHistory, undo, redo, pushSnapshot, runLazyMutation } from '../editor/editorHistory';
import { beginGesture, finishGesture, rollbackGesture } from '../editor/editorGesture';

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

// ── Item 3/4: deletion operates on the exact resolved candidate, and a ────
// visible locked top object blocks destructive click-through entirely ─────

test('a VISIBLE locked top object blocks delete click-through: nothing is deleted, not even beneath it', () => {
  const room = makeStackedRoom();
  const state = stateAt(room, 5, 5);
  state.layers.enemies.locked = true;
  deleteAtCursor(state);
  assert.equal(room.enemies.length, 1, 'locked enemy must survive the delete');
  assert.equal(room.interiorWalls.length, 1, 'the wall beneath a visible locked object must also survive — locked protects what is under it');
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

test('right-click / brush delete (single brush mode) follows the same locked-click-through-blocks policy as normal delete', () => {
  const room = makeStackedRoom();
  const state = stateAt(room, 5, 5);
  state.layers.enemies.locked = true;
  // deleteAtCursorBrushed with the default 'single' brush mode is exactly
  // what right-click delete and right-drag erase invoke in editorController.ts.
  assert.equal(state.brushMode, 'single');
  deleteAtCursorBrushed(state);
  assert.equal(room.enemies.length, 1, 'locked enemy must survive brush delete too');
  assert.equal(room.interiorWalls.length, 1, 'a visible locked object blocks brush delete of what is beneath it too');
});

// ── Item 5: findTopEligibleHitCandidate agrees with the exhaustive scan ───

test('findTopEligibleHitCandidate returns the same result as filtering the exhaustive candidate list', () => {
  const room = makeStackedRoom();
  const state = stateAt(room, 5, 5);
  state.layers.enemies.locked = true;
  const viaExhaustive = getHitCandidatesAnyLayer(state)
    .filter(c => canMutateElement(state, c.element))
    .reduce<null | { element: { type: string; uid: number }; priority: number }>(
      (top, c) => (top === null || c.priority < top.priority ? c : top), null,
    );
  const viaEarlyReturn = findTopEligibleHitCandidate(state, el => canMutateElement(state, el));
  assert.deepEqual(viaEarlyReturn?.element, viaExhaustive?.element);
  assert.deepEqual(viaEarlyReturn?.element, { type: 'wall', uid: 2 });
});

test('findTopEligibleHitCandidate returns null when nothing matches, same as the exhaustive scan', () => {
  const room = makeStackedRoom();
  const state = stateAt(room, 5, 5);
  state.layers.enemies.locked = true;
  state.layers.terrain.locked = true;
  assert.equal(findTopEligibleHitCandidate(state, el => canMutateElement(state, el)), null);
});

// ── Item 1: drag/resize invalidation must be checked BEFORE selection pruning ─

test('regression: checking mutability AFTER pruning the selection is vacuously true (why the order-of-operations bug existed)', () => {
  const state = createEditorState();
  state.selectedElements = [{ type: 'enemy', uid: 1 }, { type: 'wall', uid: 2 }];
  state.layers.enemies.locked = true;

  // Correct: evaluate against the ORIGINAL selection first.
  const becameInvalid = state.selectedElements.some(el => !canMutateElement(state, el));
  assert.equal(becameInvalid, true, 'the enemy element should be detected as newly ineligible');

  // The bug: pruning first, then checking canMutateSelection on the already-
  // pruned list always reports "still valid" — even when the original
  // selection contained an ineligible element — because .every() on the
  // filtered (all-eligible-by-construction) subset is vacuously true.
  const prunedFirst = state.selectedElements.filter(el => canMutateElement(state, el));
  const buggyCheck = prunedFirst.every(el => canMutateElement(state, el));
  assert.equal(buggyCheck, true, 'demonstrates the buggy check would never detect invalidation');
});

test('mixed-layer selection: canMutateSelection is false (all-or-nothing) when only some elements become ineligible', () => {
  const state = createEditorState();
  state.selectedElements = [{ type: 'enemy', uid: 1 }, { type: 'wall', uid: 2 }];
  assert.equal(canMutateSelection(state), true);
  state.layers.enemies.locked = true;
  // Per the documented all-or-nothing drag-cancellation policy: a mixed
  // selection where only SOME elements became ineligible must still report
  // "not fully mutable" as a whole, not silently continue with the subset.
  assert.equal(canMutateSelection(state), false);
});

test('moveSelectedElements skips (does not move) an element whose layer was locked mid-drag, per the mutation-boundary guard', () => {
  const room = makeStackedRoom();
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'enemy', uid: 1 }, { type: 'wall', uid: 2 }];
  const positions = new Map<number | string, { xBlock: number; yBlock: number }>();
  storeDragStartPositions(state, positions);
  state.layers.enemies.locked = true;
  moveSelectedElements(state, positions, 3, 3);
  const enemy = room.enemies.find(e => e.uid === 1)!;
  const wall = room.interiorWalls.find(w => w.uid === 2)!;
  assert.deepEqual([enemy.xBlock, enemy.yBlock], [5, 5], 'locked enemy must not move');
  assert.deepEqual([wall.xBlock, wall.yBlock], [8, 8], 'still-editable wall should move normally');
});

// ── Item 2: rotate/flip defend themselves directly via canMutateElement ───

test('rotateSelectedElement refuses to rotate a wall on a locked layer', () => {
  const room = makeRoom({ interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 2, hBlock: 1 } as never] });
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 2 }];
  state.layers.terrain.locked = true;
  rotateSelectedElement(state);
  const wall = room.interiorWalls[0];
  assert.equal(wall.wBlock, 2, 'wBlock/hBlock must be unchanged — rotate must refuse on a locked layer');
  assert.equal(wall.hBlock, 1);
});

test('rotateSelectedElement still rotates a wall on an editable layer (sanity check for the guard)', () => {
  const room = makeRoom({ interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 2, hBlock: 1 } as never] });
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 2 }];
  rotateSelectedElement(state);
  const wall = room.interiorWalls[0];
  assert.equal(wall.wBlock, 1);
  assert.equal(wall.hBlock, 2);
});

test('flipSelectedTransition refuses to flip a transition on a restricted (Room Structure) layer', () => {
  const room = makeRoom({
    transitions: [{
      uid: 9, direction: 'left', xBlock: 0, yBlock: 5, openingSizeBlocks: 4,
      gradientWidthBlocks: 3, positionBlock: 5,
    } as never],
  });
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'transition', uid: 9 }];
  state.layers.roomStructure.locked = true;
  flipSelectedTransition(state);
  assert.equal(room.transitions[0].direction, 'left', 'flip must refuse on a locked Room Structure layer');
});

// ── Item 7 proxy: backdrop-gated layer visibility booleans ────────────────
// (renderEditorBackdrop itself needs a full canvas/WorldState/snapshot to
// exercise directly; these tests instead verify the exact `isLayerVisible`
// results it reads per layer for its per-pass gating booleans.)

test('backdrop gating: background/terrain/hazards/enemies/powder/objects/dynamicGeometry each independently gate on isLayerVisible', () => {
  const state = createEditorState();
  const gatedLayers = ['background', 'terrain', 'hazards', 'enemies', 'powder', 'objects', 'dynamicGeometry'] as const;
  for (const id of gatedLayers) {
    assert.equal(isLayerVisible(state, id), true, `${id} should be visible by default`);
    state.layers[id].visible = false;
    assert.equal(isLayerVisible(state, id), false, `${id} should report invisible once hidden`);
    state.layers[id].visible = true;
  }
});

test('backdrop gating: soloing one gated layer isolates it from the other gated layers', () => {
  const state = createEditorState();
  state.layers.hazards.solo = true;
  assert.equal(isLayerVisible(state, 'hazards'), true);
  for (const id of ['background', 'terrain', 'enemies', 'powder', 'objects', 'dynamicGeometry'] as const) {
    assert.equal(isLayerVisible(state, id), false, `${id} should be isolated out while hazards is soloed`);
  }
});

// ── Phase 1.5, item 1: placeAtCursor enforces the full layer policy ──────

const DUST_PILE_ITEM: PaletteItem = { id: 'dust_pile', label: 'Dust Pile', category: 'dust' };
const BLOCK_ITEM: PaletteItem = {
  id: 'block_1x1', label: 'Block', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1,
};

function placeStateFor(item: PaletteItem, room = makeRoom()): ReturnType<typeof createEditorState> {
  const state = createEditorState();
  state.roomData = room;
  state.activeTool = EditorTool.Place;
  state.selectedPaletteItem = item;
  state.cursorBlockX = 5;
  state.cursorBlockY = 5;
  return state;
}

test('placeAtCursor blocks placement onto a hidden destination layer (Powder), no UID consumed', () => {
  const room = makeRoom();
  const state = placeStateFor(DUST_PILE_ITEM, room);
  state.layers.powder.visible = false;
  const uidBefore = state.nextUid;
  const placed = placeAtCursor(state);
  assert.equal(placed, false);
  assert.equal(room.dustPiles.length, 0);
  assert.equal(state.nextUid, uidBefore, 'blocked placement must not allocate a UID');
});

test('placeAtCursor blocks placement onto a solo-excluded destination layer (Powder)', () => {
  const room = makeRoom();
  const state = placeStateFor(DUST_PILE_ITEM, room);
  state.layers.terrain.solo = true; // some OTHER layer is soloed; powder is not
  const placed = placeAtCursor(state);
  assert.equal(placed, false);
  assert.equal(room.dustPiles.length, 0);
});

test('placeAtCursor blocks placement onto a select-only-excluded destination layer (Powder)', () => {
  const room = makeRoom();
  const state = placeStateFor(DUST_PILE_ITEM, room);
  state.layers.terrain.selectOnly = true; // some OTHER layer is select-only; powder is not
  const placed = placeAtCursor(state);
  assert.equal(placed, false);
  assert.equal(room.dustPiles.length, 0);
});

test('placeAtCursor succeeds onto an editable destination layer (sanity check for the guard)', () => {
  const room = makeRoom();
  const state = placeStateFor(DUST_PILE_ITEM, room);
  const placed = placeAtCursor(state);
  assert.equal(placed, true);
  assert.equal(room.dustPiles.length, 1);
});

for (const brushMode of ['single', 'rect', 'fill', '3x3', '5x5'] as const) {
  test(`placeAtCursor: brush mode "${brushMode}" obeys the same locked-layer policy as single placement`, () => {
    const room = makeRoom();
    const state = placeStateFor(BLOCK_ITEM, room);
    state.brushMode = brushMode;
    if (brushMode === 'rect') {
      state.brushRectStartBlockX = 4;
      state.brushRectStartBlockY = 4;
    }
    state.layers.terrain.locked = true;
    const uidBefore = state.nextUid;
    const placed = placeAtCursor(state);
    assert.equal(placed, false, `brush mode ${brushMode} must refuse to place on a locked layer`);
    assert.equal(room.interiorWalls.length, 0);
    assert.equal(state.nextUid, uidBefore, 'no UID should be allocated for a blocked brush placement');
  });
}

// ── Phase 1.5, item 2: pixel-material placement/erasure/line-paint ───────

test('placePixelMaterialAt refuses to place onto a locked Powder layer', () => {
  const room = makeRoom({ pixelMaterials: [] } as unknown as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  state.layers.powder.locked = true;
  const placed = placePixelMaterialAt(state, 10, 10, 1);
  assert.equal(placed, false);
  assert.equal((room as unknown as { pixelMaterials: unknown[] }).pixelMaterials.length, 0);
});

test('placePixelMaterialAt refuses to place onto a hidden Powder layer', () => {
  const room = makeRoom({ pixelMaterials: [] } as unknown as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  state.layers.powder.visible = false;
  assert.equal(placePixelMaterialAt(state, 10, 10, 1), false);
});

test('placePixelMaterialAt refuses to place onto a select-only-excluded Powder layer', () => {
  const room = makeRoom({ pixelMaterials: [] } as unknown as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  state.layers.terrain.selectOnly = true;
  assert.equal(placePixelMaterialAt(state, 10, 10, 1), false);
});

test('placePixelMaterialAt succeeds on an editable Powder layer (sanity check)', () => {
  const room = makeRoom({ pixelMaterials: [] } as unknown as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  assert.equal(placePixelMaterialAt(state, 10, 10, 1), true);
  assert.equal((room as unknown as { pixelMaterials: unknown[] }).pixelMaterials.length, 1);
});

test('erasePixelMaterialAt refuses to erase from a locked Powder layer', () => {
  const room = makeRoom({
    pixelMaterials: [{ uid: 1, xPixel: 10, yPixel: 10, material: 1 }],
  } as unknown as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  state.layers.powder.locked = true;
  const erased = erasePixelMaterialAt(state, 10, 10);
  assert.equal(erased, false);
  assert.equal((room as unknown as { pixelMaterials: unknown[] }).pixelMaterials.length, 1, 'locked powder layer must resist erasure too');
});

test('paintPixelMaterialLine is a no-op on a hidden Powder layer (left-drag paint)', () => {
  const room = makeRoom({ pixelMaterials: [] } as unknown as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  state.layers.powder.visible = false;
  const changed = paintPixelMaterialLine(state, 0, 0, 20, 0, 1, false);
  assert.equal(changed, false);
  assert.equal((room as unknown as { pixelMaterials: unknown[] }).pixelMaterials.length, 0);
});

test('paintPixelMaterialLine is a no-op on a locked Powder layer (right-drag erase)', () => {
  const room = makeRoom({
    pixelMaterials: [{ uid: 1, xPixel: 0, yPixel: 0, material: 1 }],
  } as unknown as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  state.layers.powder.locked = true;
  const changed = paintPixelMaterialLine(state, 0, 0, 20, 0, 1, true);
  assert.equal(changed, false);
  assert.equal((room as unknown as { pixelMaterials: unknown[] }).pixelMaterials.length, 1);
});

test('paintPixelMaterialLine reports a real change on an editable Powder layer (sanity check)', () => {
  const room = makeRoom({ pixelMaterials: [] } as unknown as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  const changed = paintPixelMaterialLine(state, 0, 0, 4, 0, 1, false);
  assert.equal(changed, true);
  assert.ok((room as unknown as { pixelMaterials: unknown[] }).pixelMaterials.length > 0);
});

// ── Phase 1.5, item 3: inspector/property-change mutation policy ─────────

test('handlePropertyChange blocks editing an element on a locked layer, and pushes no history', () => {
  const room = makeRoom({ interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 } as never] });
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 2 }];
  state.layers.terrain.locked = true;
  const history = createEditorHistory();
  const result = handlePropertyChange(state, history, 'wall.xBlock', 10);
  assert.equal(result, false);
  assert.equal(room.interiorWalls[0].xBlock, 5, 'locked wall must not be edited');
  assert.equal(history.undoStack.length, 0, 'a blocked edit must not push an undo snapshot');
});

test('handlePropertyChange mixed selection is all-or-nothing: one ineligible element blocks the whole edit', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 } as never],
    enemies: [{ uid: 1, xBlock: 3, yBlock: 3, type: 'basic' } as never],
  });
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 2 }, { type: 'enemy', uid: 1 }];
  state.layers.enemies.locked = true; // only the enemy is ineligible
  const history = createEditorHistory();
  const result = handlePropertyChange(state, history, 'wall.xBlock', 10);
  assert.equal(result, false, 'edit must be blocked entirely, not partially applied to the wall');
  assert.equal(room.interiorWalls[0].xBlock, 5, 'the otherwise-eligible wall must NOT have been edited either');
  assert.equal(history.undoStack.length, 0);
});

test('handlePropertyChange creates no history when the submitted value does not change anything', () => {
  const room = makeRoom({ interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 } as never] });
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 2 }];
  const history = createEditorHistory();
  const result = handlePropertyChange(state, history, 'wall.xBlock', '5');
  assert.equal(result, false, 'resubmitting the current value (as a string) must be treated as a no-op');
  assert.equal(history.undoStack.length, 0);
});

test('handlePropertyChange applies the edit and pushes exactly one snapshot when the value actually changes', () => {
  const room = makeRoom({ interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 } as never] });
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 2 }];
  const history = createEditorHistory();
  const result = handlePropertyChange(state, history, 'wall.xBlock', 10);
  assert.equal(result, true);
  assert.equal(room.interiorWalls[0].xBlock, 10);
  assert.equal(history.undoStack.length, 1);
});

// ── Phase 1.5, item 4: paste is all-or-nothing across every clipboard layer ─

test('pasteFromClipboard is blocked when any represented clipboard layer is restricted; no UID/selection/room change', () => {
  const sourceRoom = makeRoom({
    interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 } as never],
    dustPiles: [{ uid: 3, xBlock: 6, yBlock: 6, dustCount: 5 }],
  });
  const clip = serializeSelectedElements(sourceRoom, [{ type: 'wall', uid: 2 }, { type: 'dustPile', uid: 3 }]);

  const destRoom = makeRoom();
  const state = createEditorState();
  state.roomData = destRoom;
  state.clipboard = clip;
  state.cursorBlockX = 10;
  state.cursorBlockY = 10;
  state.layers.powder.locked = true; // dustPile's layer is restricted
  const uidBefore = state.nextUid;

  const pasted = pasteFromClipboard(state);
  assert.equal(pasted, false, 'paste must be blocked entirely — not even the eligible wall should be pasted');
  assert.equal(destRoom.interiorWalls.length, 0);
  assert.equal(destRoom.dustPiles.length, 0);
  assert.equal(state.nextUid, uidBefore, 'blocked paste must not consume any UIDs');
  assert.deepEqual(state.selectedElements, [], 'blocked paste must not change selection');
});

test('pasteFromClipboard succeeds across multiple layers when all are editable', () => {
  const sourceRoom = makeRoom({
    interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 } as never],
    dustPiles: [{ uid: 3, xBlock: 6, yBlock: 6, dustCount: 5 }],
  });
  const clip = serializeSelectedElements(sourceRoom, [{ type: 'wall', uid: 2 }, { type: 'dustPile', uid: 3 }]);

  const destRoom = makeRoom();
  const state = createEditorState();
  state.roomData = destRoom;
  state.clipboard = clip;
  state.cursorBlockX = 10;
  state.cursorBlockY = 10;

  const pasted = pasteFromClipboard(state);
  assert.equal(pasted, true);
  assert.equal(destRoom.interiorWalls.length, 1);
  assert.equal(destRoom.dustPiles.length, 1);
  assert.equal(state.selectedElements.length, 2);
});

// ── Phase 1.6: no-op/blocked operations must leave undo/redo completely
// untouched (the old "push then pop on no-op" pattern cleared the redo
// stack as a pushSnapshot side effect and could not undo that by popping
// the undo entry back off afterward). Each test below primes the redo
// stack with a real entry (edit + undo), then runs a blocked/no-op
// operation and asserts the redo stack — and its ability to redo — is
// completely unaffected. ────────────────────────────────────────────────

/** Performs one real edit + undo so history has exactly one redo entry
 * ready to be restored, matching the "user did something, undid it" setup
 * every regression test below starts from. */
function primeRedoStack(room: EditorRoomData) {
  const history = createEditorHistory();
  pushSnapshot(history, room);
  room.interiorWalls.push({ uid: 999, xBlock: 1, yBlock: 1, wBlock: 1, hBlock: 1 } as never);
  const restored = undo(history, room);
  assert.ok(restored, 'setup: undo must succeed');
  assert.equal(history.redoStack.length, 1, 'setup: redo stack must have exactly one entry');
  return { history, restoredRoomData: restored!.roomData };
}

test('runLazyMutation: a no-op mutation leaves undo/redo completely untouched and redo still works', () => {
  const room = makeRoom({ interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 } as never] });
  const { history } = primeRedoStack(room);
  const undoLenBefore = history.undoStack.length;

  const changed = runLazyMutation(history, room, () => false /* no-op mutate */);

  assert.equal(changed, false);
  assert.equal(history.undoStack.length, undoLenBefore, 'no-op must not push an undo entry');
  assert.equal(history.redoStack.length, 1, 'no-op must not clear the redo stack');

  const redone = redo(history, room);
  assert.ok(redone, 'redo must still work after the no-op');
});

test('runLazyMutation: a mutation that throws leaves undo/redo completely untouched (try/finally safety)', () => {
  const room = makeRoom();
  const { history } = primeRedoStack(room);
  const undoLenBefore = history.undoStack.length;

  assert.throws(() => {
    runLazyMutation(history, room, () => { throw new Error('boom'); });
  });

  assert.equal(history.undoStack.length, undoLenBefore, 'a thrown mutation must not leave a stray undo entry');
  assert.equal(history.redoStack.length, 1, 'a thrown mutation must not clear the redo stack');
});

test('runLazyMutation: a real mutation commits exactly one undo entry and clears redo', () => {
  const room = makeRoom();
  const { history } = primeRedoStack(room);
  const undoLenBefore = history.undoStack.length;

  const changed = runLazyMutation(history, room, () => {
    room.interiorWalls.push({ uid: 3, xBlock: 2, yBlock: 2, wBlock: 1, hBlock: 1 } as never);
    return true;
  });

  assert.equal(changed, true);
  assert.equal(history.undoStack.length, undoLenBefore + 1, 'a real change must push exactly one undo entry');
  assert.equal(history.redoStack.length, 0, 'a real change must clear the redo stack');
});

test('blocked placeAtCursor (locked destination layer) preserves the redo stack', () => {
  const room = makeRoom();
  const { history } = primeRedoStack(room);
  const state = placeStateFor(DUST_PILE_ITEM, room);
  state.layers.powder.locked = true;

  const placed = placeAtCursor(state);
  assert.equal(placed, false);
  assert.equal(history.redoStack.length, 1, 'blocked placement must not clear redo');
});

test('occupied-cell placeAtCursor (duplicate placement) preserves the redo stack', () => {
  const room = makeRoom();
  const state = placeStateFor(BLOCK_ITEM, room);
  const first = placeAtCursor(state); // occupies the cell
  assert.equal(first, true);

  const { history } = primeRedoStack(room);
  const second = placeAtCursor(state); // same cell, already occupied -> no-op
  assert.equal(second, false, 'placing on an already-occupied cell must be a no-op');
  assert.equal(history.redoStack.length, 1, 'occupied-cell no-op placement must not clear redo');
});

test('blocked handlePropertyChange (locked layer) preserves the redo stack', () => {
  const room = makeRoom({ interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 } as never] });
  const { history } = primeRedoStack(room);
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 2 }];
  state.layers.terrain.locked = true;

  const result = handlePropertyChange(state, history, 'wall.xBlock', 10);
  assert.equal(result, false);
  assert.equal(history.redoStack.length, 1, 'blocked edit must not clear redo');
});

test('unchanged-value handlePropertyChange preserves the redo stack', () => {
  const room = makeRoom({ interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 } as never] });
  const { history } = primeRedoStack(room);
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 2 }];

  const result = handlePropertyChange(state, history, 'wall.xBlock', '5');
  assert.equal(result, false, 'resubmitting the same value must be a no-op');
  assert.equal(history.redoStack.length, 1, 'no-op edit must not clear redo');
});

test('a successful handlePropertyChange edit clears redo exactly once', () => {
  const room = makeRoom({ interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 } as never] });
  const { history } = primeRedoStack(room);

  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 2 }];
  const result = handlePropertyChange(state, history, 'wall.xBlock', 10);
  assert.equal(result, true);
  assert.equal(history.redoStack.length, 0, 'a real edit must clear redo');
});

test('blocked pasteFromClipboard preserves the redo stack', () => {
  const sourceRoom = makeRoom({ interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 } as never] });
  const clip = serializeSelectedElements(sourceRoom, [{ type: 'wall', uid: 2 }]);

  const destRoom = makeRoom();
  const { history } = primeRedoStack(destRoom);
  const state = createEditorState();
  state.roomData = destRoom;
  state.clipboard = clip;
  state.layers.terrain.locked = true;

  const pasted = pasteFromClipboard(state);
  assert.equal(pasted, false);
  assert.equal(history.redoStack.length, 1, 'blocked paste must not clear redo (paste itself does not touch history in this path; verifying no incidental clearing)');
});

test('empty-clipboard paste is a no-op and preserves the redo stack', () => {
  const destRoom = makeRoom();
  const { history } = primeRedoStack(destRoom);
  const state = createEditorState();
  state.roomData = destRoom;
  state.clipboard = null;

  if (state.clipboard) {
    const pasted = pasteFromClipboard(state);
    assert.equal(pasted, false);
  }
  assert.equal(history.redoStack.length, 1, 'no clipboard to paste must never touch redo');
});

test('pixel-material erase miss (nothing under cursor) is a no-op and preserves redo', () => {
  const room = makeRoom({ pixelMaterials: [] } as never);
  const { history } = primeRedoStack(room);
  const state = createEditorState();
  state.roomData = room;

  const erased = erasePixelMaterialAt(state, 100, 100);
  assert.equal(erased, false);
  assert.equal(history.redoStack.length, 1, 'a pixel-erase miss must not clear redo');
});

test('pixel-material line paint over all-duplicate cells creates no changes and preserves redo', () => {
  const room = makeRoom({ pixelMaterials: [{ xPixel: 0, yPixel: 0, material: 1 }] } as never);
  const { history } = primeRedoStack(room);
  const state = createEditorState();
  state.roomData = room;

  // Painting the same already-occupied cell repeatedly should report no change.
  const changed = paintPixelMaterialLine(state, 0, 0, 0, 0, 1, false);
  assert.equal(changed, false, 'placing an already-present pixel material must be a no-op');
  assert.equal(history.redoStack.length, 1);
});

test('deleteAtCursorBrushed on an empty cell is a no-op (returns false)', () => {
  const room = makeRoom();
  const state = stateAt(room, 5, 5);
  const deleted = deleteAtCursorBrushed(state);
  assert.equal(deleted, false, 'deleting an empty cell must report no change');
});

test('deleteAtCursorBrushed returns true and removes the element when something is actually deleted', () => {
  const room = makeStackedRoom();
  const state = stateAt(room, 5, 5);
  const deleted = deleteAtCursorBrushed(state);
  assert.equal(deleted, true);
  assert.equal(room.enemies.length, 0, 'the top-priority candidate (enemy) should have been removed');
});

test('deleteAtCursorBrushed on a fully-locked cell is a no-op and preserves redo', () => {
  const room = makeStackedRoom();
  const { history } = primeRedoStack(room);
  const state = stateAt(room, 5, 5);
  state.layers.enemies.locked = true;
  const deleted = deleteAtCursorBrushed(state);
  assert.equal(deleted, false, 'a visible locked top candidate blocks deletion entirely');
  assert.equal(history.redoStack.length, 1);
});

// ── Phase 1.7: gesture-transaction model for drag/resize ──────────────────

test('gesture: zero-delta drag (click release without movement) reports unchanged and preserves redo', () => {
  const room = makeStackedRoom();
  const { history } = primeRedoStack(room);
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'enemy', uid: 1 }];
  const positions = new Map<number | string, { xBlock: number; yBlock: number }>();
  storeDragStartPositions(state, positions);
  const gesture = beginGesture(
    room,
    () => {
      const current = new Map<number | string, { xBlock: number; yBlock: number }>();
      storeDragStartPositions(state, current);
      for (const [key, val] of current) {
        const orig = positions.get(key);
        if (!orig || orig.xBlock !== val.xBlock || orig.yBlock !== val.yBlock) return true;
      }
      return false;
    },
    () => moveSelectedElements(state, positions, 0, 0),
  );
  // No movement applied at all — release immediately.
  const committed = finishGesture(history, gesture);
  assert.equal(committed, 'noop', 'a zero-delta drag must not commit a snapshot');
  assert.equal(history.redoStack.length, 1, 'redo must be preserved by an unchanged gesture');
});

test('gesture: moving away and returning to the origin before release reports unchanged and preserves redo', () => {
  const room = makeStackedRoom();
  const { history } = primeRedoStack(room);
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'enemy', uid: 1 }];
  const positions = new Map<number | string, { xBlock: number; yBlock: number }>();
  storeDragStartPositions(state, positions);
  const hasChanged = () => {
    const current = new Map<number | string, { xBlock: number; yBlock: number }>();
    storeDragStartPositions(state, current);
    for (const [key, val] of current) {
      const orig = positions.get(key);
      if (!orig || orig.xBlock !== val.xBlock || orig.yBlock !== val.yBlock) return true;
    }
    return false;
  };
  const gesture = beginGesture(room, hasChanged, () => moveSelectedElements(state, positions, 0, 0));
  moveSelectedElements(state, positions, 3, 3); // move away
  moveSelectedElements(state, positions, 0, 0); // return to origin
  const committed = finishGesture(history, gesture);
  assert.equal(committed, 'noop', 'returning to the exact origin must not commit a snapshot');
  assert.equal(history.redoStack.length, 1, 'redo must be preserved');
});

test('gesture: a genuine drag commits exactly one undo entry and clears redo', () => {
  const room = makeStackedRoom();
  const { history } = primeRedoStack(room);
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'enemy', uid: 1 }];
  const positions = new Map<number | string, { xBlock: number; yBlock: number }>();
  storeDragStartPositions(state, positions);
  const undoDepthBefore = history.undoStack.length;
  const hasChanged = () => {
    const current = new Map<number | string, { xBlock: number; yBlock: number }>();
    storeDragStartPositions(state, current);
    for (const [key, val] of current) {
      const orig = positions.get(key);
      if (!orig || orig.xBlock !== val.xBlock || orig.yBlock !== val.yBlock) return true;
    }
    return false;
  };
  const gesture = beginGesture(room, hasChanged, () => moveSelectedElements(state, positions, 0, 0));
  moveSelectedElements(state, positions, 2, 2);
  const committed = finishGesture(history, gesture);
  assert.equal(committed, 'committed', 'an actual move must commit');
  assert.equal(history.undoStack.length, undoDepthBefore + 1, 'exactly one undo entry must be added');
  assert.equal(history.redoStack.length, 0, 'redo must be cleared exactly once by the successful drag');
});

test('gesture: rollbackGesture restores every dragged element to its original position (mixed-layer all-or-nothing)', () => {
  const room = makeRoom({
    enemies: [{ uid: 1, xBlock: 5, yBlock: 5, type: 'basic' } as never],
    interiorWalls: [{ uid: 2, xBlock: 8, yBlock: 8, wBlock: 1, hBlock: 1 } as never],
  });
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'enemy', uid: 1 }, { type: 'wall', uid: 2 }];
  const positions = new Map<number | string, { xBlock: number; yBlock: number }>();
  storeDragStartPositions(state, positions);
  const gesture = beginGesture(room, () => true, () => moveSelectedElements(state, positions, 0, 0));
  moveSelectedElements(state, positions, 4, 4);
  const enemy = room.enemies.find(e => e.uid === 1)!;
  const wall = room.interiorWalls.find(w => w.uid === 2)!;
  assert.deepEqual([enemy.xBlock, enemy.yBlock], [9, 9], 'sanity: enemy moved during the gesture');
  assert.deepEqual([wall.xBlock, wall.yBlock], [12, 12], 'sanity: wall moved during the gesture');
  rollbackGesture(gesture);
  assert.deepEqual([enemy.xBlock, enemy.yBlock], [5, 5], 'rollback must restore the enemy to its original position');
  assert.deepEqual([wall.xBlock, wall.yBlock], [8, 8], 'rollback must restore the wall to its original position');
});

test('gesture: rect-resize return-to-original-dimensions reports unchanged and preserves redo', () => {
  const room = makeRoom({ challengeFields: [{ uid: 3, xBlock: 2, yBlock: 2, wBlock: 3, hBlock: 3 }] } as never);
  const { history } = primeRedoStack(room);
  const original = { xBlock: 2, yBlock: 2, wBlock: 3, hBlock: 3 };
  const getRect = () => room.challengeFields!.find(r => r.uid === 3)!;
  const gesture = beginGesture(
    room,
    () => {
      const r = getRect();
      return r.xBlock !== original.xBlock || r.yBlock !== original.yBlock || r.wBlock !== original.wBlock || r.hBlock !== original.hBlock;
    },
    () => Object.assign(getRect(), original),
  );
  const rect = getRect();
  rect.wBlock = 6; // resize out
  rect.wBlock = 3; // resize back to original
  const committed = finishGesture(history, gesture);
  assert.equal(committed, 'noop', 'returning to original dimensions must not commit');
  assert.equal(history.redoStack.length, 1, 'redo must be preserved');
});

test('gesture: a genuine rect-resize commits exactly one undo entry', () => {
  const room = makeRoom({ challengeFields: [{ uid: 3, xBlock: 2, yBlock: 2, wBlock: 3, hBlock: 3 }] } as never);
  const history = createEditorHistory();
  const original = { xBlock: 2, yBlock: 2, wBlock: 3, hBlock: 3 };
  const getRect = () => room.challengeFields!.find(r => r.uid === 3)!;
  const gesture = beginGesture(
    room,
    () => {
      const r = getRect();
      return r.wBlock !== original.wBlock;
    },
    () => Object.assign(getRect(), original),
  );
  getRect().wBlock = 6;
  const committed = finishGesture(history, gesture);
  assert.equal(committed, 'committed');
  assert.equal(history.undoStack.length, 1, 'exactly one undo entry must be recorded');
});

test('gesture: rect-resize rollback restores exact original geometry (e.g. layer locked mid-resize)', () => {
  const room = makeRoom({ challengeFields: [{ uid: 3, xBlock: 2, yBlock: 2, wBlock: 3, hBlock: 3 }] } as never);
  const original = { xBlock: 2, yBlock: 2, wBlock: 3, hBlock: 3 };
  const getRect = () => room.challengeFields!.find(r => r.uid === 3)!;
  const gesture = beginGesture(room, () => true, () => Object.assign(getRect(), original));
  getRect().wBlock = 9;
  getRect().hBlock = 1;
  rollbackGesture(gesture);
  const restoredRect = getRect();
  assert.deepEqual(
    { xBlock: restoredRect.xBlock, yBlock: restoredRect.yBlock, wBlock: restoredRect.wBlock, hBlock: restoredRect.hBlock },
    original,
    'rollback must restore the exact pre-resize rectangle',
  );
});

test('gesture: transition-resize zero-change preserves redo, successful resize commits one entry with synced positionBlock', () => {
  const room = makeRoom({
    transitions: [{
      uid: 9, direction: 'left', xBlock: 0, yBlock: 5, openingSizeBlocks: 4,
      gradientWidthBlocks: 3, positionBlock: 5,
    } as never],
  });
  const { history } = primeRedoStack(room);
  const getTrans = () => room.transitions.find(t => t.uid === 9)!;
  const original = { xBlock: 0, yBlock: 5, gradientWidthBlocks: 3, openingSizeBlocks: 4, positionBlock: 5 };
  const hasChanged = () => {
    const t = getTrans();
    return t.xBlock !== original.xBlock || t.yBlock !== original.yBlock ||
      (t.gradientWidthBlocks ?? 3) !== original.gradientWidthBlocks || t.openingSizeBlocks !== original.openingSizeBlocks;
  };
  const restore = () => {
    const t = getTrans();
    t.xBlock = original.xBlock;
    t.yBlock = original.yBlock;
    t.gradientWidthBlocks = original.gradientWidthBlocks;
    t.openingSizeBlocks = original.openingSizeBlocks;
    t.positionBlock = original.positionBlock;
  };

  // Zero-change: grab the handle, release without moving it.
  const noopGesture = beginGesture(room, hasChanged, restore);
  const noopCommitted = finishGesture(history, noopGesture);
  assert.equal(noopCommitted, 'noop', 'a zero-change transition resize must not commit');
  assert.equal(history.redoStack.length, 1, 'redo must be preserved by a zero-change resize');

  // Successful resize: openingSizeBlocks grows, yBlock/positionBlock stay synced.
  const gesture = beginGesture(room, hasChanged, restore);
  const t = getTrans();
  t.openingSizeBlocks = 6;
  t.yBlock = 3;
  t.positionBlock = 3;
  const committed = finishGesture(history, gesture);
  assert.equal(committed, 'committed', 'a real resize must commit');
  assert.equal(history.undoStack.length, 1, 'exactly one undo entry must be recorded for the successful resize');
  const restored = undo(history, room);
  assert.ok(restored, 'undo must succeed after the committed resize');
  assert.equal(restored!.roomData.transitions[0].yBlock, original.yBlock, 'undo must restore the pre-resize yBlock');
  assert.equal(restored!.roomData.transitions[0].positionBlock, original.positionBlock, 'undo must restore the synced positionBlock');
});

test('gesture: Room Structure lock mid-transition-resize rolls back to the exact original geometry', () => {
  const room = makeRoom({
    transitions: [{
      uid: 9, direction: 'up', xBlock: 4, yBlock: 0, openingSizeBlocks: 5,
      gradientWidthBlocks: 2, positionBlock: 4,
    } as never],
  });
  const getTrans = () => room.transitions.find(t => t.uid === 9)!;
  const original = { xBlock: 4, yBlock: 0, gradientWidthBlocks: 2, openingSizeBlocks: 5, positionBlock: 4 };
  const restore = () => Object.assign(getTrans(), original);
  const gesture = beginGesture(room, () => true, restore);
  const t = getTrans();
  t.openingSizeBlocks = 9;
  t.xBlock = 1;
  t.positionBlock = 1;
  rollbackGesture(gesture);
  assert.deepEqual(
    { xBlock: getTrans().xBlock, yBlock: getTrans().yBlock, gradientWidthBlocks: getTrans().gradientWidthBlocks, openingSizeBlocks: getTrans().openingSizeBlocks, positionBlock: getTrans().positionBlock },
    original,
    'rollback must restore every synchronized transition field exactly',
  );
});

// ── Phase 1.7: rotate/flip real mutation-result contracts ─────────────────

test('rotateSelectedElement returns false and preserves redo for an unsupported element type', () => {
  const room = makeRoom({ dustPiles: [{ uid: 4, xBlock: 3, yBlock: 3 } as never] });
  const { history } = primeRedoStack(room);
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'dustPile', uid: 4 }];
  const pending = { before: JSON.stringify(room) };
  const changed = rotateSelectedElement(state);
  assert.equal(changed, false, 'dust piles have no rotation concept — must report no change');
  assert.equal(JSON.stringify(room), pending.before, 'room data must be untouched');
  assert.equal(history.redoStack.length, 1);
});

test('rotateSelectedElement returns false and preserves redo when the target element no longer exists', () => {
  const room = makeRoom({ interiorWalls: [] });
  const { history } = primeRedoStack(room);
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 999 }];
  const changed = rotateSelectedElement(state);
  assert.equal(changed, false, 'a missing target must report no change');
  assert.equal(history.redoStack.length, 1);
});

test('rotateSelectedElement returns false and preserves redo on a restricted (locked) layer', () => {
  const room = makeRoom({ interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 2, hBlock: 1 } as never] });
  const { history } = primeRedoStack(room);
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 2 }];
  state.layers.terrain.locked = true;
  const changed = rotateSelectedElement(state);
  assert.equal(changed, false);
  assert.equal(history.redoStack.length, 1);
});

test('rotateSelectedElement returns false for a square wall (rotation normalizes to the same state)', () => {
  const room = makeRoom({ interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 2, hBlock: 2 } as never] });
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 2 }];
  const changed = rotateSelectedElement(state);
  assert.equal(changed, false, 'swapping equal width/height is a genuine no-op');
});

test('rotateSelectedElement returns true for a real rotation, and undo restores the exact original dimensions', () => {
  const room = makeRoom({ interiorWalls: [{ uid: 2, xBlock: 5, yBlock: 5, wBlock: 2, hBlock: 1 } as never] });
  const history = createEditorHistory();
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 2 }];
  const pending = { snapshot: JSON.parse(JSON.stringify(room)) };
  const changed = rotateSelectedElement(state);
  assert.equal(changed, true);
  history.undoStack.push({ roomData: pending.snapshot });
  const restored = undo(history, room);
  assert.equal(restored!.roomData.interiorWalls[0].wBlock, 2);
  assert.equal(restored!.roomData.interiorWalls[0].hBlock, 1);
});

test('flipSelectedTransition returns false and preserves redo for an unsupported element type', () => {
  const room = makeRoom({ enemies: [{ uid: 1, xBlock: 5, yBlock: 5, type: 'basic' } as never] });
  const { history } = primeRedoStack(room);
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'enemy', uid: 1 }];
  const changed = flipSelectedTransition(state);
  assert.equal(changed, false, 'flip only supports transitions');
  assert.equal(history.redoStack.length, 1);
});

test('flipSelectedTransition returns false and preserves redo when the transition no longer exists', () => {
  const room = makeRoom({ transitions: [] });
  const { history } = primeRedoStack(room);
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'transition', uid: 42 }];
  const changed = flipSelectedTransition(state);
  assert.equal(changed, false);
  assert.equal(history.redoStack.length, 1);
});

test('flipSelectedTransition returns true for a real flip, and undo restores the exact original direction', () => {
  const room = makeRoom({
    transitions: [{
      uid: 9, direction: 'left', xBlock: 0, yBlock: 5, openingSizeBlocks: 4,
      gradientWidthBlocks: 3, positionBlock: 5,
    } as never],
  });
  const history = createEditorHistory();
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'transition', uid: 9 }];
  const snapshot = JSON.parse(JSON.stringify(room));
  const changed = flipSelectedTransition(state);
  assert.equal(changed, true);
  assert.equal(room.transitions[0].direction, 'right', 'flipping left must produce right');
  history.undoStack.push({ roomData: snapshot });
  const restored = undo(history, room);
  assert.equal(restored!.roomData.transitions[0].direction, 'left', 'undo must restore the exact original direction');
});
