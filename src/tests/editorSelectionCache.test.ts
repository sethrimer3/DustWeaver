/**
 * Item A regression guards: selection membership during rendering must be an
 * O(1) Set lookup whose backing Set is rebuilt only when the selection
 * actually changes — not once per render frame, and not once per drawn
 * element.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState } from '../editor/editorState';
import { editorPerfCounters, resetEditorPerfCounters } from '../editor/editorPerfCounters';
import {
  selectionKey,
  bumpSelectionRevision,
  getSelectedKeySet,
  makeIsElementSelected,
  clearSelectionCache,
} from '../editor/editorSelectionCache';
import type { SelectedElement } from '../editor/editorElementTypes';

function freshState() {
  const state = createEditorState();
  clearSelectionCache(state);
  resetEditorPerfCounters();
  return state;
}

test('createEditorState: selectionRevision starts at 0', () => {
  assert.equal(createEditorState().selectionRevision, 0);
});

test('selectionKey: canonical `${type}:${uid}` form', () => {
  assert.equal(selectionKey('wall', 12), 'wall:12');
  assert.equal(selectionKey('guideDustPath', 0), 'guideDustPath:0');
});

test('selection Set is NOT rebuilt on every render when the selection is unchanged', () => {
  const state = freshState();
  state.selectedElements = [
    { type: 'wall', uid: 1 },
    { type: 'enemy', uid: 2 },
  ] as SelectedElement[];
  bumpSelectionRevision(state);

  // Simulate 50 render frames, each asking membership for 500 elements.
  for (let frame = 0; frame < 50; frame++) {
    const isSelected = makeIsElementSelected(state);
    for (let uid = 0; uid < 500; uid++) isSelected('wall', uid);
  }

  assert.equal(
    editorPerfCounters.selectionCacheRebuilds, 1,
    'Set must be built once and reused across all subsequent renders',
  );
});

test('membership answers are correct and type-discriminated', () => {
  const state = freshState();
  state.selectedElements = [
    { type: 'wall', uid: 7 },
    { type: 'guideDustPath', uid: 3 },
    { type: 'playerSpawn', uid: 0 },
    { type: 'campaignSpawn', uid: 0 },
  ] as SelectedElement[];
  bumpSelectionRevision(state);

  const isSelected = makeIsElementSelected(state);
  assert.equal(isSelected('wall', 7), true);
  assert.equal(isSelected('wall', 3), false, 'same uid, different type must not match');
  assert.equal(isSelected('guideDustPath', 3), true);
  // playerSpawn / campaignSpawn both use uid 0 — identity must stay distinct.
  assert.equal(isSelected('playerSpawn', 0), true);
  assert.equal(isSelected('campaignSpawn', 0), true);
  assert.equal(isSelected('enemy', 0), false);
});

test('a selection change rebuilds exactly once, then caches again', () => {
  const state = freshState();
  state.selectedElements = [{ type: 'wall', uid: 1 }] as SelectedElement[];
  bumpSelectionRevision(state);
  makeIsElementSelected(state);
  makeIsElementSelected(state);
  assert.equal(editorPerfCounters.selectionCacheRebuilds, 1);

  state.selectedElements = [{ type: 'wall', uid: 2 }] as SelectedElement[];
  bumpSelectionRevision(state);
  const isSelected = makeIsElementSelected(state);
  makeIsElementSelected(state);
  assert.equal(editorPerfCounters.selectionCacheRebuilds, 2);
  assert.equal(isSelected('wall', 1), false);
  assert.equal(isSelected('wall', 2), true);
});

test('in-place push/splice are picked up even if bumpSelectionRevision is missed (length safety net)', () => {
  const state = freshState();
  state.selectedElements = [{ type: 'wall', uid: 1 }] as SelectedElement[];
  bumpSelectionRevision(state);
  assert.equal(makeIsElementSelected(state)('wall', 5), false);

  // Deliberately mutate WITHOUT bumping — the identity+length guard must catch it.
  state.selectedElements.push({ type: 'wall', uid: 5 } as SelectedElement);
  assert.equal(makeIsElementSelected(state)('wall', 5), true);

  state.selectedElements.splice(0, 1);
  assert.equal(makeIsElementSelected(state)('wall', 1), false);
});

test('clearing the selection empties the Set', () => {
  const state = freshState();
  state.selectedElements = [{ type: 'wall', uid: 1 }] as SelectedElement[];
  bumpSelectionRevision(state);
  getSelectedKeySet(state);
  state.selectedElements = [];
  bumpSelectionRevision(state);
  assert.equal(getSelectedKeySet(state).size, 0);
});
