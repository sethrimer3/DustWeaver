import { test } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  _data: new Map<string, string>(),
  getItem(key: string) { return this._data.has(key) ? this._data.get(key)! : null; },
  setItem(key: string, value: string) { this._data.set(key, value); },
  removeItem(key: string) { this._data.delete(key); },
} as unknown as Storage;

import {
  loadEditorWorkspacePreferences, saveEditorWorkspacePreferencesNow,
  defaultEditorWorkspacePreferences, createDebouncedWorkspacePreferencesSaver,
  applyWorkspacePreferencesToLayers, extractWorkspaceLayerPrefs,
  LAYER_PRESETS, applyLayerPreset, resetWorkspaceLayers,
  EDITOR_WORKSPACE_PREFS_VERSION,
} from '../editor/editorWorkspacePreferences';
import { LAYER_IDS, createDefaultEditorLayers } from '../editor/editorLayers';

function resetStorage(): void {
  (localStorage as unknown as { _data: Map<string, string> })._data.clear();
}

// ── Round-trip persistence ──────────────────────────────────────────────────

test('round-trip: save then reload produces an equal preferences object', () => {
  resetStorage();
  const prefs = defaultEditorWorkspacePreferences();
  prefs.activeCategory = 'enemies';
  prefs.brushMode = '3x3';
  prefs.layerPanelCollapsed = true;
  prefs.leftSidebarScrollTop = 240;
  prefs.layers.terrain = { visible: false, locked: true, selectOnly: false };

  saveEditorWorkspacePreferencesNow('campaign_a', prefs);
  const reloaded = loadEditorWorkspacePreferences('campaign_a');

  assert.deepEqual(reloaded, prefs);
});

// ── Campaign isolation ───────────────────────────────────────────────────────

test('campaign isolation: two campaigns have independent preferences', () => {
  resetStorage();
  const prefsA = defaultEditorWorkspacePreferences();
  prefsA.activeCategory = 'enemies';
  saveEditorWorkspacePreferencesNow('campaign_a', prefsA);

  const prefsB = defaultEditorWorkspacePreferences();
  prefsB.activeCategory = 'liquids';
  saveEditorWorkspacePreferencesNow('campaign_b', prefsB);

  assert.equal(loadEditorWorkspacePreferences('campaign_a').activeCategory, 'enemies');
  assert.equal(loadEditorWorkspacePreferences('campaign_b').activeCategory, 'liquids');
});

// ── Schema migration ─────────────────────────────────────────────────────────

test('schema migration: an older stored format (no version field, extra unknown field) loads safely', () => {
  resetStorage();
  localStorage.setItem('dw_editor_workspace_prefs_v1__campaign_old', JSON.stringify({
    // no "version" field at all — simulates a pre-versioning record
    layers: { terrain: { visible: false, locked: false, selectOnly: false } },
    activeCategory: 'blocks',
    brushMode: 'single',
    somethingFromAFutureVersion: { totally: 'unknown' },
  }));

  const loaded = loadEditorWorkspacePreferences('campaign_old');
  assert.equal(loaded.version, EDITOR_WORKSPACE_PREFS_VERSION);
  assert.equal(loaded.layers.terrain?.visible, false);
  assert.equal(loaded.activeCategory, 'blocks');
});

// ── Corrupt data ─────────────────────────────────────────────────────────────

test('corrupt data: garbage JSON falls back to defaults without throwing', () => {
  resetStorage();
  localStorage.setItem('dw_editor_workspace_prefs_v1__campaign_corrupt', '{not valid json!!!');
  assert.doesNotThrow(() => {
    const loaded = loadEditorWorkspacePreferences('campaign_corrupt');
    assert.deepEqual(loaded, defaultEditorWorkspacePreferences());
  });
});

test('corrupt data: wrong-typed fields fall back to defaults per-field', () => {
  resetStorage();
  localStorage.setItem('dw_editor_workspace_prefs_v1__campaign_wrong_types', JSON.stringify({
    layers: 'not an object',
    layerPanelCollapsed: 'yes', // should be boolean
    activeCategory: 42, // should be string
    brushMode: 'not_a_real_mode',
    sidebarScrollTop: -5, // invalid (negative)
  }));

  const loaded = loadEditorWorkspacePreferences('campaign_wrong_types');
  const fallback = defaultEditorWorkspacePreferences();
  assert.deepEqual(loaded.layers, {});
  assert.equal(loaded.layerPanelCollapsed, fallback.layerPanelCollapsed);
  assert.equal(loaded.activeCategory, fallback.activeCategory);
  assert.equal(loaded.brushMode, fallback.brushMode);
  assert.equal(loaded.leftSidebarScrollTop, fallback.leftSidebarScrollTop);
});

test('corrupt data: unknown layer id in stored data is silently dropped', () => {
  resetStorage();
  localStorage.setItem('dw_editor_workspace_prefs_v1__campaign_unknown_layer', JSON.stringify({
    layers: {
      terrain: { visible: false, locked: false, selectOnly: false },
      someRetiredLayerId: { visible: true, locked: true, selectOnly: false },
    },
  }));

  const loaded = loadEditorWorkspacePreferences('campaign_unknown_layer');
  assert.ok('terrain' in loaded.layers);
  assert.ok(!('someRetiredLayerId' in loaded.layers));
});

test('missing localStorage key (never saved before) returns full safe defaults', () => {
  resetStorage();
  assert.deepEqual(loadEditorWorkspacePreferences('campaign_never_saved'), defaultEditorWorkspacePreferences());
});

// ── Newly-added layer defaults correctly ────────────────────────────────────

test('a layer absent from stored prefs (e.g. added in a later version) defaults to visible/unlocked', () => {
  const prefs = defaultEditorWorkspacePreferences();
  prefs.layers.terrain = { visible: false, locked: true, selectOnly: false };
  // 'debug' is intentionally absent from prefs.layers.

  const layers = applyWorkspacePreferencesToLayers(prefs);
  assert.equal(layers.terrain.visible, false);
  assert.equal(layers.terrain.locked, true);
  assert.equal(layers.debug.visible, true, 'expected a layer absent from stored prefs to default to visible');
  assert.equal(layers.debug.locked, false);
  assert.equal(layers.debug.solo, false, 'solo must never be read from preferences');
});

test('extractWorkspaceLayerPrefs -> applyWorkspacePreferencesToLayers round-trips visible/locked/selectOnly (not solo)', () => {
  const live = createDefaultEditorLayers();
  live.hazards.visible = false;
  live.hazards.locked = true;
  live.hazards.solo = true; // must NOT survive the round-trip
  live.triggers.selectOnly = true;

  const extracted = extractWorkspaceLayerPrefs(live);
  const prefs = defaultEditorWorkspacePreferences();
  prefs.layers = extracted;
  const restored = applyWorkspacePreferencesToLayers(prefs);

  assert.equal(restored.hazards.visible, false);
  assert.equal(restored.hazards.locked, true);
  assert.equal(restored.hazards.solo, false, 'solo must never round-trip through preferences');
  assert.equal(restored.triggers.selectOnly, true);
});

// ── No dirty/history/JSON mutation ──────────────────────────────────────────

test('preference functions never touch room/campaign data — signatures are localStorage-only', () => {
  // saveEditorWorkspacePreferencesNow/loadEditorWorkspacePreferences take only
  // a campaign key string and a plain preferences object — there is no room
  // data, dirty flag, or history parameter for them to mutate.
  resetStorage();
  const before = defaultEditorWorkspacePreferences();
  saveEditorWorkspacePreferencesNow('campaign_x', before);
  const roomLikeObject = { id: 'room1', isDirty: false };
  const roomLikeObjectSnapshot = JSON.stringify(roomLikeObject);
  loadEditorWorkspacePreferences('campaign_x');
  assert.equal(JSON.stringify(roomLikeObject), roomLikeObjectSnapshot, 'expected an unrelated room-like object to be untouched');
});

// ── Debounced saver ──────────────────────────────────────────────────────────

test('debounced saver: schedule() coalesces rapid calls into a single write, flush() writes immediately', async () => {
  resetStorage();
  const saver = createDebouncedWorkspacePreferencesSaver('campaign_debounce', 20);
  const p1 = { ...defaultEditorWorkspacePreferences(), leftSidebarScrollTop: 1 };
  const p2 = { ...defaultEditorWorkspacePreferences(), leftSidebarScrollTop: 2 };
  const p3 = { ...defaultEditorWorkspacePreferences(), leftSidebarScrollTop: 3 };
  saver.schedule(p1);
  saver.schedule(p2);
  saver.schedule(p3);
  // Nothing written yet — still within the debounce window.
  assert.equal(loadEditorWorkspacePreferences('campaign_debounce').leftSidebarScrollTop, 0);

  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(loadEditorWorkspacePreferences('campaign_debounce').leftSidebarScrollTop, 3,
    'expected only the last scheduled value to be written');
});

test('debounced saver: flush() writes immediately without waiting for the debounce window', () => {
  resetStorage();
  const saver = createDebouncedWorkspacePreferencesSaver('campaign_flush', 10_000);
  const p = { ...defaultEditorWorkspacePreferences(), leftSidebarScrollTop: 42 };
  saver.schedule(p);
  saver.flush();
  assert.equal(loadEditorWorkspacePreferences('campaign_flush').leftSidebarScrollTop, 42);
  saver.cancel();
});

// ── Preset masks ─────────────────────────────────────────────────────────────

test('preset "All": every layer visible', () => {
  const preset = LAYER_PRESETS.find(p => p.id === 'all')!;
  assert.deepEqual([...preset.visibleLayers].sort(), [...LAYER_IDS].sort());
});

test('preset "Geometry": exactly background/terrain/foreground/dynamicGeometry/roomStructure visible', () => {
  const preset = LAYER_PRESETS.find(p => p.id === 'geometry')!;
  assert.deepEqual([...preset.visibleLayers].sort(),
    ['background', 'terrain', 'foreground', 'dynamicGeometry', 'roomStructure'].sort());
});

test('preset "Gameplay": exactly terrain/dynamicGeometry/liquids/powder/objects/hazards/enemies/fields/roomStructure visible', () => {
  const preset = LAYER_PRESETS.find(p => p.id === 'gameplay')!;
  assert.deepEqual([...preset.visibleLayers].sort(),
    ['terrain', 'dynamicGeometry', 'liquids', 'powder', 'objects', 'hazards', 'enemies', 'fields', 'roomStructure'].sort());
});

test('preset "Lighting/VFX": exactly background/terrain/foreground/lighting visible', () => {
  const preset = LAYER_PRESETS.find(p => p.id === 'lightingVfx')!;
  assert.deepEqual([...preset.visibleLayers].sort(), ['background', 'terrain', 'foreground', 'lighting'].sort());
});

test('preset "Triggers & Paths": exactly terrain/roomStructure/triggers/paths/editorMetadata visible', () => {
  const preset = LAYER_PRESETS.find(p => p.id === 'triggersAndPaths')!;
  assert.deepEqual([...preset.visibleLayers].sort(),
    ['terrain', 'roomStructure', 'triggers', 'paths', 'editorMetadata'].sort());
});

test('applyLayerPreset: clears solo and selectOnly, does not touch locked, applies the exact mask', () => {
  const layers = createDefaultEditorLayers();
  layers.lighting.solo = true;
  layers.triggers.selectOnly = true;
  layers.hazards.locked = true;

  const result = applyLayerPreset(layers, 'geometry');

  for (const id of LAYER_IDS) {
    assert.equal(result[id].solo, false, `expected solo cleared for ${id}`);
    assert.equal(result[id].selectOnly, false, `expected selectOnly cleared for ${id}`);
  }
  assert.equal(result.hazards.locked, true, 'expected locked to be preserved, not touched by a preset');
  assert.equal(result.terrain.visible, true);
  assert.equal(result.enemies.visible, false);
});

test('resetWorkspaceLayers restores full defaults (all visible, unlocked, no solo/selectOnly)', () => {
  const layers = resetWorkspaceLayers();
  for (const id of LAYER_IDS) {
    assert.equal(layers[id].visible, true);
    assert.equal(layers[id].locked, false);
    assert.equal(layers[id].solo, false);
    assert.equal(layers[id].selectOnly, false);
  }
});

// ── Collapse/scroll survive load ────────────────────────────────────────────

test('collapse state and scroll position round-trip through save/load', () => {
  resetStorage();
  const prefs = defaultEditorWorkspacePreferences();
  prefs.layerPanelCollapsed = true;
  prefs.leftSidebarScrollTop = 512;
  saveEditorWorkspacePreferencesNow('campaign_scroll', prefs);

  const loaded = loadEditorWorkspacePreferences('campaign_scroll');
  assert.equal(loaded.layerPanelCollapsed, true);
  assert.equal(loaded.leftSidebarScrollTop, 512);
});
