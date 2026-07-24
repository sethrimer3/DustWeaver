import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState } from '../editor/editorState';
import { LAYER_IDS } from '../editor/editorLayers';
import { buildEditorRenderMask, isLayerVisibleInMask } from '../editor/editorRenderMask';
import { getLayerForParticleKind } from '../editor/editorParticleLayers';
import { ParticleKind } from '../sim/particles/kinds';

test('buildEditorRenderMask: all layers visible by default', () => {
  const state = createEditorState();
  const mask = buildEditorRenderMask(state);
  for (const id of LAYER_IDS) {
    assert.equal(mask.isLayerVisible(id), true);
  }
  assert.equal(mask.activeSoloLayer, null);
});

test('buildEditorRenderMask: solo collapses visibility to soloed layers only', () => {
  const state = createEditorState();
  state.layers.lighting.solo = true;
  const mask = buildEditorRenderMask(state);
  assert.equal(mask.isLayerVisible('lighting'), true);
  assert.equal(mask.isLayerVisible('powder'), false);
  assert.equal(mask.isLayerVisible('debug'), false);
  assert.equal(mask.activeSoloLayer, 'lighting');
  assert.equal(mask.isLayerSolo('lighting'), true);
  assert.equal(mask.isLayerSolo('powder'), false);
});

test('buildEditorRenderMask: hiding a layer (no solo) only affects that layer', () => {
  const state = createEditorState();
  state.layers.debug.visible = false;
  const mask = buildEditorRenderMask(state);
  assert.equal(mask.isLayerVisible('debug'), false);
  assert.equal(mask.isLayerVisible('powder'), true);
});

test('isLayerVisibleInMask: null/undefined mask means runtime — everything visible', () => {
  assert.equal(isLayerVisibleInMask(null, 'debug'), true);
  assert.equal(isLayerVisibleInMask(undefined, 'lighting'), true);
});

test('isLayerVisibleInMask: defers to the mask when one is supplied', () => {
  const state = createEditorState();
  state.layers.editorMetadata.visible = false;
  const mask = buildEditorRenderMask(state);
  assert.equal(isLayerVisibleInMask(mask, 'editorMetadata'), false);
  assert.equal(isLayerVisibleInMask(mask, 'terrain'), true);
});

test('getLayerForParticleKind: classifies gameplay dust motes as powder', () => {
  assert.equal(getLayerForParticleKind(ParticleKind.Golden), 'powder');
  assert.equal(getLayerForParticleKind(ParticleKind.Ice), 'powder');
  assert.equal(getLayerForParticleKind(ParticleKind.Void), 'powder');
});

test('getLayerForParticleKind: classifies fluid/water/lava as liquids', () => {
  assert.equal(getLayerForParticleKind(ParticleKind.Fluid), 'liquids');
  assert.equal(getLayerForParticleKind(ParticleKind.Water), 'liquids');
  assert.equal(getLayerForParticleKind(ParticleKind.Lava), 'liquids');
});

test('getLayerForParticleKind: out-of-range kind defaults to powder', () => {
  assert.equal(getLayerForParticleKind(999), 'powder');
});
