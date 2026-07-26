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
  resetWorkspacePanelLayout, EDITOR_WORKSPACE_PREFS_VERSION,
} from '../editor/editorWorkspacePreferences';
import {
  defaultPanelLayout, dockPanel, floatPanel, isPanelLayoutComplete,
} from '../editor/editorPanelLayout';

/**
 * Persistence-side coverage for the dockable-panel system: the v1 -> v2
 * workspace-preference migration, panel-layout round-tripping, per-campaign
 * isolation, debounced/flushed saving, and Reset Workspace.
 *
 * The layout *rules* themselves (reorder/move/float/redock/sanitize) are
 * covered in editorPanelLayout.test.ts; this file is about what survives a
 * trip through localStorage.
 */

function resetStorage(): void {
  (localStorage as unknown as { _data: Map<string, string> })._data.clear();
}

// ── v1 → v2 migration ───────────────────────────────────────────────────────

test('v1 record migrates without losing layers, category, brush, collapse, or scroll', () => {
  resetStorage();
  // Exactly what a pre-docking v1 record looked like.
  localStorage.setItem('dw_editor_workspace_prefs_v1__campaign_v1', JSON.stringify({
    version: 1,
    layers: { terrain: { visible: false, locked: true, selectOnly: false } },
    layerPanelCollapsed: true,
    activeCategory: 'enemies',
    brushMode: '3x3',
    sidebarScrollTop: 320,
  }));

  const loaded = loadEditorWorkspacePreferences('campaign_v1');

  // Every v1 preference survives the upgrade.
  assert.deepEqual(loaded.layers.terrain, { visible: false, locked: true, selectOnly: false });
  assert.equal(loaded.layerPanelCollapsed, true);
  assert.equal(loaded.activeCategory, 'enemies');
  assert.equal(loaded.brushMode, '3x3');
  // v1's single scroll value is reinterpreted as the LEFT sidebar's; the
  // newly independent right sidebar defaults to 0.
  assert.equal(loaded.leftSidebarScrollTop, 320);
  assert.equal(loaded.rightSidebarScrollTop, 0);
  // And the record gains a complete default panel layout.
  assert.equal(loaded.version, EDITOR_WORKSPACE_PREFS_VERSION);
  assert.equal(isPanelLayoutComplete(loaded.panelLayout), true);
  assert.deepEqual(loaded.panelLayout, defaultPanelLayout());
});

test('a v2 record leftSidebarScrollTop wins over a leftover v1 sidebarScrollTop', () => {
  resetStorage();
  localStorage.setItem('dw_editor_workspace_prefs_v1__campaign_both', JSON.stringify({
    version: 2,
    sidebarScrollTop: 111,
    leftSidebarScrollTop: 222,
    rightSidebarScrollTop: 333,
  }));
  const loaded = loadEditorWorkspacePreferences('campaign_both');
  assert.equal(loaded.leftSidebarScrollTop, 222);
  assert.equal(loaded.rightSidebarScrollTop, 333);
});

test('both sidebar scroll positions round-trip independently', () => {
  resetStorage();
  const prefs = defaultEditorWorkspacePreferences();
  prefs.leftSidebarScrollTop = 90;
  prefs.rightSidebarScrollTop = 410;
  saveEditorWorkspacePreferencesNow('campaign_scrolls', prefs);
  const loaded = loadEditorWorkspacePreferences('campaign_scrolls');
  assert.equal(loaded.leftSidebarScrollTop, 90);
  assert.equal(loaded.rightSidebarScrollTop, 410);
});

test('an invalid right-sidebar scroll falls back to 0 without disturbing the left', () => {
  resetStorage();
  localStorage.setItem('dw_editor_workspace_prefs_v1__campaign_badscroll', JSON.stringify({
    leftSidebarScrollTop: 50,
    rightSidebarScrollTop: -7,
  }));
  const loaded = loadEditorWorkspacePreferences('campaign_badscroll');
  assert.equal(loaded.leftSidebarScrollTop, 50);
  assert.equal(loaded.rightSidebarScrollTop, 0);
});

// ── Panel layout persistence ────────────────────────────────────────────────

test('a customized panel layout round-trips through save/load', () => {
  resetStorage();
  const prefs = defaultEditorWorkspacePreferences();
  prefs.panelLayout = floatPanel(
    dockPanel(defaultPanelLayout(), 'palette', 'left', 0),
    'inspector', 640, 220,
  );
  saveEditorWorkspacePreferencesNow('campaign_layout', prefs);

  const loaded = loadEditorWorkspacePreferences('campaign_layout');
  assert.equal(loaded.panelLayout.left[0], 'palette');
  assert.equal(loaded.panelLayout.right.includes('palette'), false);
  assert.deepEqual(loaded.panelLayout.floating.inspector, { xPx: 640, yPx: 220, z: 1 });
  assert.equal(isPanelLayoutComplete(loaded.panelLayout), true);
});

test('a corrupt stored panel layout still yields a usable editor', () => {
  resetStorage();
  const badLayouts: unknown[] = [
    'not-an-object',
    42,
    { left: 'nope', right: null, floating: 'garbage' },
    { left: ['tools', 'tools', 'tools'], right: ['tools'], floating: { tools: { xPx: 'x' } } },
  ];
  badLayouts.forEach((bad, i) => {
    const key = 'campaign_badlayout_' + String(i);
    localStorage.setItem(
      'dw_editor_workspace_prefs_v1__' + key,
      JSON.stringify({ panelLayout: bad }),
    );
    const loaded = loadEditorWorkspacePreferences(key);
    assert.equal(isPanelLayoutComplete(loaded.panelLayout), true, 'corrupt layout #' + String(i));
  });
});

test('completely unparsable stored JSON never prevents the editor from opening', () => {
  resetStorage();
  localStorage.setItem('dw_editor_workspace_prefs_v1__campaign_broken', '{not valid json at all');
  const loaded = loadEditorWorkspacePreferences('campaign_broken');
  assert.deepEqual(loaded, defaultEditorWorkspacePreferences());
  assert.equal(isPanelLayoutComplete(loaded.panelLayout), true);
});

test('panel layouts are isolated per campaign', () => {
  resetStorage();
  const a = defaultEditorWorkspacePreferences();
  a.panelLayout = dockPanel(defaultPanelLayout(), 'palette', 'left', 0);
  const b = defaultEditorWorkspacePreferences();
  b.panelLayout = floatPanel(defaultPanelLayout(), 'tools', 300, 300);

  saveEditorWorkspacePreferencesNow('campaign_layout_a', a);
  saveEditorWorkspacePreferencesNow('campaign_layout_b', b);

  const loadedA = loadEditorWorkspacePreferences('campaign_layout_a');
  const loadedB = loadEditorWorkspacePreferences('campaign_layout_b');
  assert.equal(loadedA.panelLayout.left[0], 'palette');
  assert.equal(loadedA.panelLayout.floating.tools, undefined);
  assert.notEqual(loadedB.panelLayout.floating.tools, undefined);
  assert.equal(loadedB.panelLayout.left[0], 'roomDimensions');
});

test('a panel added after a layout was saved appears at its registered default location', () => {
  resetStorage();
  // Simulates a stored layout written before 'layers' and 'export' existed.
  localStorage.setItem('dw_editor_workspace_prefs_v1__campaign_newpanel', JSON.stringify({
    panelLayout: {
      left: ['roomDimensions', 'background', 'roomSong', 'inspector'],
      right: ['tools', 'brush', 'categories', 'palette'],
      floating: {},
    },
  }));
  const loaded = loadEditorWorkspacePreferences('campaign_newpanel');
  assert.equal(loaded.panelLayout.left.includes('layers'), true);
  assert.equal(loaded.panelLayout.left.includes('export'), true);
  assert.equal(isPanelLayoutComplete(loaded.panelLayout), true);
});

// ── Reset Workspace ─────────────────────────────────────────────────────────

test('Reset Workspace restores the complete default panel layout, redocking floats', () => {
  let layout = defaultPanelLayout();
  layout = dockPanel(layout, 'palette', 'left', 0);
  layout = floatPanel(layout, 'inspector', 500, 500);
  layout = floatPanel(layout, 'tools', 600, 600);
  assert.notDeepEqual(layout, defaultPanelLayout());

  const reset = resetWorkspacePanelLayout();
  assert.deepEqual(reset, defaultPanelLayout());
  assert.deepEqual(reset.floating, {}, 'every floating window is redocked');
  assert.deepEqual(reset.right, ['tools', 'brush', 'categories', 'palette']);
  assert.equal(isPanelLayoutComplete(reset), true);
});

// ── Debounced saving / flush ────────────────────────────────────────────────

test('a panel layout change is not written during the debounce window, and flush forces it', () => {
  resetStorage();
  const saver = createDebouncedWorkspacePreferencesSaver('campaign_layout_debounce', 10_000);
  const prefs = defaultEditorWorkspacePreferences();
  prefs.panelLayout = floatPanel(defaultPanelLayout(), 'palette', 42, 84);

  saver.schedule(prefs);
  // Nothing written yet — an in-progress gesture must never hit storage.
  assert.deepEqual(
    loadEditorWorkspacePreferences('campaign_layout_debounce').panelLayout,
    defaultPanelLayout(),
  );

  // Closing the editor flushes the final state.
  saver.flush();
  assert.deepEqual(
    loadEditorWorkspacePreferences('campaign_layout_debounce').panelLayout.floating.palette,
    { xPx: 42, yPx: 84, z: 1 },
  );
  saver.cancel();
});

test('rapid successive layout changes coalesce into a single stored result', async () => {
  resetStorage();
  const saver = createDebouncedWorkspacePreferencesSaver('campaign_layout_coalesce', 20);
  for (const x of [10, 20, 30, 40]) {
    const prefs = defaultEditorWorkspacePreferences();
    prefs.panelLayout = floatPanel(defaultPanelLayout(), 'tools', x, x);
    saver.schedule(prefs);
  }
  await new Promise(resolve => setTimeout(resolve, 45));
  const loaded = loadEditorWorkspacePreferences('campaign_layout_coalesce');
  assert.deepEqual(loaded.panelLayout.floating.tools, { xPx: 40, yPx: 40, z: 1 },
    'only the final scheduled layout is persisted');
  saver.cancel();
});
