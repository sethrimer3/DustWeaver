/**
 * Regression tests for the "gradient width edit moves the transition" bug.
 *
 * Changing `transition.gradientWidthBlocks` must resize only the visual
 * gradient depth. It must never mutate `xBlock`, `yBlock`, `positionBlock`,
 * `openingSizeBlocks`, `targetRoomId`, `targetSpawnBlock`, or any other
 * transition field — the authored crossing/trigger line (which sits at the
 * transition's near edge, see gameTransitions.ts checkRoomTransitions) must
 * stay fixed regardless of direction.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyPropertyToElement, handlePropertyChange } from '../editor/editorPropertyChange';
import { createEditorHistory, undo, redo } from '../editor/editorHistory';
import { createEditorState } from '../editor/editorState';
import type { EditorRoomData, EditorTransition, SelectedElement } from '../editor/editorElementTypes';

function makeEditorRoomData(transitions: EditorTransition[]): EditorRoomData {
  return {
    id: 'test_room',
    name: 'Test Room',
    worldNumber: 1,
    widthBlocks: 20,
    heightBlocks: 20,
    playerSpawnBlock: [1, 1],
    interiorWalls: [],
    enemies: [],
    transitions,
    saveTombs: [],
  } as unknown as EditorRoomData;
}

function makeEditorTransition(overrides: Partial<EditorTransition> = {}): EditorTransition {
  return {
    uid: 1,
    direction: 'right',
    xBlock: 5,
    yBlock: 7,
    openingSizeBlocks: 6,
    gradientWidthBlocks: 3,
    targetRoomId: 'other_room',
    targetSpawnBlock: [2, 2],
    positionBlock: 7,
    fadeColor: '#123456',
    gradientOpacity: 0.5,
    isSecretDoor: false,
    longTransition: false,
    ...overrides,
  } as EditorTransition;
}

// ── applyPropertyToElement: all four directions ─────────────────────────────

for (const direction of ['left', 'right', 'up', 'down'] as const) {
  test(`gradientWidthBlocks widen: ${direction} transition position stays fixed`, () => {
    const trans = makeEditorTransition({ direction, xBlock: 5, yBlock: 7, gradientWidthBlocks: 3 });
    const roomData = makeEditorRoomData([trans]);
    const el: SelectedElement = { type: 'transition', uid: 1 };
    const before = structuredClone(trans);

    applyPropertyToElement(roomData, el, 'transition.gradientWidthBlocks', 8);

    const after = roomData.transitions[0];
    assert.equal(after.gradientWidthBlocks, 8);
    assert.equal(after.xBlock, before.xBlock);
    assert.equal(after.yBlock, before.yBlock);
    assert.equal(after.positionBlock, before.positionBlock);
    assert.equal(after.openingSizeBlocks, before.openingSizeBlocks);
    assert.equal(after.targetRoomId, before.targetRoomId);
    assert.deepEqual(after.targetSpawnBlock, before.targetSpawnBlock);
    assert.equal(after.fadeColor, before.fadeColor);
    assert.equal(after.gradientOpacity, before.gradientOpacity);
    assert.equal(after.isSecretDoor, before.isSecretDoor);
    assert.equal(after.longTransition, before.longTransition);
  });

  test(`gradientWidthBlocks narrow: ${direction} transition position stays fixed`, () => {
    const trans = makeEditorTransition({ direction, xBlock: 5, yBlock: 7, gradientWidthBlocks: 8 });
    const roomData = makeEditorRoomData([trans]);
    const el: SelectedElement = { type: 'transition', uid: 1 };
    const before = structuredClone(trans);

    applyPropertyToElement(roomData, el, 'transition.gradientWidthBlocks', 3);

    const after = roomData.transitions[0];
    assert.equal(after.gradientWidthBlocks, 3);
    assert.equal(after.xBlock, before.xBlock);
    assert.equal(after.yBlock, before.yBlock);
    assert.equal(after.positionBlock, before.positionBlock);
    assert.equal(after.openingSizeBlocks, before.openingSizeBlocks);
  });

  test(`gradientWidthBlocks clamps to minimum of 2 for ${direction}, without moving position`, () => {
    const trans = makeEditorTransition({ direction, xBlock: 5, yBlock: 7, gradientWidthBlocks: 5 });
    const roomData = makeEditorRoomData([trans]);
    const el: SelectedElement = { type: 'transition', uid: 1 };
    const before = structuredClone(trans);

    applyPropertyToElement(roomData, el, 'transition.gradientWidthBlocks', 0);

    const after = roomData.transitions[0];
    assert.equal(after.gradientWidthBlocks, 2);
    assert.equal(after.xBlock, before.xBlock);
    assert.equal(after.yBlock, before.yBlock);
  });

  test(`legacy ${direction} transition with omitted gradientWidthBlocks: explicit edit clamps and doesn't move position`, () => {
    const trans = makeEditorTransition({ direction, xBlock: 5, yBlock: 7, gradientWidthBlocks: undefined });
    const roomData = makeEditorRoomData([trans]);
    const el: SelectedElement = { type: 'transition', uid: 1 };
    const before = structuredClone(trans);

    applyPropertyToElement(roomData, el, 'transition.gradientWidthBlocks', 1);

    const after = roomData.transitions[0];
    assert.equal(after.gradientWidthBlocks, 2);
    assert.equal(after.xBlock, before.xBlock);
    assert.equal(after.yBlock, before.yBlock);
  });
}

// ── handlePropertyChange: multi-selection, undo/redo ─────────────────────────

test('multi-selection gradientWidthBlocks edit resizes both transitions without moving either', () => {
  const t1 = makeEditorTransition({ uid: 1, direction: 'right', xBlock: 5, yBlock: 7, gradientWidthBlocks: 3 });
  const t2 = makeEditorTransition({ uid: 2, direction: 'down', xBlock: 10, yBlock: 12, gradientWidthBlocks: 3 });
  const roomData = makeEditorRoomData([t1, t2]);
  const state = createEditorState();
  state.roomData = roomData;
  state.selectedElements = [
    { type: 'transition', uid: 1 },
    { type: 'transition', uid: 2 },
  ];
  const history = createEditorHistory();

  const result = handlePropertyChange(state, history, 'transition.gradientWidthBlocks', 6);
  assert.equal(result, true);

  assert.equal(roomData.transitions[0].gradientWidthBlocks, 6);
  assert.equal(roomData.transitions[0].xBlock, 5);
  assert.equal(roomData.transitions[0].yBlock, 7);
  assert.equal(roomData.transitions[1].gradientWidthBlocks, 6);
  assert.equal(roomData.transitions[1].xBlock, 10);
  assert.equal(roomData.transitions[1].yBlock, 12);
});

test('undo/redo restores gradientWidthBlocks changes without positional drift', () => {
  const trans = makeEditorTransition({ direction: 'right', xBlock: 5, yBlock: 7, gradientWidthBlocks: 3 });
  const roomData = makeEditorRoomData([trans]);
  const state = createEditorState();
  state.roomData = roomData;
  state.selectedElements = [{ type: 'transition', uid: 1 }];
  const history = createEditorHistory();

  handlePropertyChange(state, history, 'transition.gradientWidthBlocks', 9);
  assert.equal(state.roomData!.transitions[0].gradientWidthBlocks, 9);
  assert.equal(state.roomData!.transitions[0].xBlock, 5);

  const afterUndo = undo(history, state.roomData!);
  assert.ok(afterUndo);
  state.roomData = afterUndo!.roomData;
  assert.equal(state.roomData.transitions[0].gradientWidthBlocks, 3);
  assert.equal(state.roomData.transitions[0].xBlock, 5);
  assert.equal(state.roomData.transitions[0].yBlock, 7);

  const afterRedo = redo(history, state.roomData);
  assert.ok(afterRedo);
  state.roomData = afterRedo!.roomData;
  assert.equal(state.roomData.transitions[0].gradientWidthBlocks, 9);
  assert.equal(state.roomData.transitions[0].xBlock, 5);
  assert.equal(state.roomData.transitions[0].yBlock, 7);
});

test('re-submitting the same gradientWidthBlocks value is a no-op (no snapshot pushed)', () => {
  const trans = makeEditorTransition({ direction: 'right', xBlock: 5, yBlock: 7, gradientWidthBlocks: 4 });
  const roomData = makeEditorRoomData([trans]);
  const state = createEditorState();
  state.roomData = roomData;
  state.selectedElements = [{ type: 'transition', uid: 1 }];
  const history = createEditorHistory();

  const result = handlePropertyChange(state, history, 'transition.gradientWidthBlocks', 4);
  assert.equal(result, false);
  assert.equal(roomData.transitions[0].xBlock, 5);
  assert.equal(roomData.transitions[0].gradientWidthBlocks, 4);
});

// ── Copy/paste: property edit on a pasted transition doesn't move it ────────

test('copy/paste then gradientWidthBlocks edit does not move the pasted transition', () => {
  const original = makeEditorTransition({ uid: 1, direction: 'down', xBlock: 5, yBlock: 15, gradientWidthBlocks: 3 });
  const pasted = structuredClone(original);
  pasted.uid = 2;
  const roomData = makeEditorRoomData([original, pasted]);
  const el: SelectedElement = { type: 'transition', uid: 2 };

  applyPropertyToElement(roomData, el, 'transition.gradientWidthBlocks', 7);

  assert.equal(roomData.transitions[1].gradientWidthBlocks, 7);
  assert.equal(roomData.transitions[1].xBlock, 5);
  assert.equal(roomData.transitions[1].yBlock, 15);
  // The original (unselected) transition must be completely untouched.
  assert.deepEqual(roomData.transitions[0], original);
});
