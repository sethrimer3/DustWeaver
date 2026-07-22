import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState } from '../editor/editorState';
import {
  isLayerVisible,
  isLayerLocked,
  isLayerEditable,
  isAnyLayerSoloed,
  isAnySelectOnlyActive,
} from '../editor/editorLayers';

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
