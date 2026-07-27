/**
 * editorFieldsPaletteCategory.test.ts — canonical "fields" palette category.
 *
 * Covers the fields-palette-consolidation refactor: `challenge_field` and
 * `timestop_field` both live under one canonical `fields` category (rather
 * than `challenge_field` under `triggers` and `timestop_field` under a
 * dedicated, never-rendered `timeStop` category), the retired `timeStop`
 * category id is fully gone, legacy persisted `timeStop` workspace state
 * normalizes instead of producing a blank palette, and no
 * `PALETTE_CATEGORIES` entry with items can silently fail to render (the bug
 * that caused the empty TimeStop Field palette in the first place).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  _data: new Map<string, string>(),
  getItem(key: string) { return this._data.has(key) ? this._data.get(key)! : null; },
  setItem(key: string, value: string) { this._data.set(key, value); },
  removeItem(key: string) { this._data.delete(key); },
} as unknown as Storage;

import {
  PALETTE_CATEGORIES, PALETTE_CATEGORY_LABELS, PALETTE_ITEMS,
} from '../editor/editorPaletteItems';
import {
  loadEditorWorkspacePreferences, saveEditorWorkspacePreferencesNow, defaultEditorWorkspacePreferences,
} from '../editor/editorWorkspacePreferences';
import { createEditorState, EditorTool } from '../editor/editorState';
import { placeAtCursor } from '../editor/editorPlaceTool';

function resetStorage(): void {
  (localStorage as unknown as { _data: Map<string, string> })._data.clear();
}

// ── Canonical category exists ────────────────────────────────────────────────

test('a canonical "fields" category exists with label "Fields"', () => {
  assert.ok(PALETTE_CATEGORIES.includes('fields'));
  assert.equal(PALETTE_CATEGORY_LABELS.fields, 'Fields');
});

test('no "timeStop" category exists anymore', () => {
  assert.ok(!(PALETTE_CATEGORIES as readonly string[]).includes('timeStop'));
  assert.ok(!('timeStop' in PALETTE_CATEGORY_LABELS));
});

test('challenge_field and timestop_field both belong to the "fields" category', () => {
  const challengeField = PALETTE_ITEMS.find(i => i.id === 'challenge_field');
  const timestopField = PALETTE_ITEMS.find(i => i.id === 'timestop_field');
  assert.ok(challengeField, 'challenge_field must exist in PALETTE_ITEMS');
  assert.ok(timestopField, 'timestop_field must exist in PALETTE_ITEMS');
  assert.equal(challengeField!.category, 'fields');
  assert.equal(timestopField!.category, 'fields');
});

// ── Legacy workspace-state normalization ─────────────────────────────────────

test('a persisted legacy "timeStop" activeCategory normalizes to "fields" on load', () => {
  resetStorage();
  const legacy = { ...defaultEditorWorkspacePreferences(), activeCategory: 'timeStop' };
  localStorage.setItem('dw_editor_workspace_prefs_v1__campaign_legacy', JSON.stringify(legacy));

  const loaded = loadEditorWorkspacePreferences('campaign_legacy');
  assert.equal(loaded.activeCategory, 'fields');
});

test('a persisted unknown/garbage activeCategory falls back to the default rather than crashing', () => {
  resetStorage();
  const garbage = { ...defaultEditorWorkspacePreferences(), activeCategory: 'not_a_real_category' };
  localStorage.setItem('dw_editor_workspace_prefs_v1__campaign_garbage', JSON.stringify(garbage));

  const loaded = loadEditorWorkspacePreferences('campaign_garbage');
  assert.equal(loaded.activeCategory, defaultEditorWorkspacePreferences().activeCategory);
});

test('a valid, non-legacy activeCategory still round-trips normally', () => {
  resetStorage();
  const prefs = defaultEditorWorkspacePreferences();
  prefs.activeCategory = 'fields';
  saveEditorWorkspacePreferencesNow('campaign_fields', prefs);
  assert.equal(loadEditorWorkspacePreferences('campaign_fields').activeCategory, 'fields');
});

// ── Placement still works for both field types ───────────────────────────────

function makeRoom() {
  return {
    id: 'test_room', name: 'Test Room', worldNumber: 1, mapX: 0, mapY: 0,
    blockTheme: 'blackRock', backgroundId: 'cave', lightingEffect: 'DEFAULT', songId: '_continue',
    widthBlocks: 20, heightBlocks: 20, playerSpawnBlock: [2, 2],
    interiorWalls: [], enemies: [], transitions: [], saveTombs: [], skillTombs: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [],
    lambdaAnchors: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [], decorations: [],
    ambientLightBlockers: [], lightSources: [], waterZones: [], lavaZones: [],
    timeStopFields: [], challengeFields: [],
  } as unknown as import('../editor/editorElementTypes').EditorRoomData;
}

test('placing Challenge Field from the palette still works after the category move', () => {
  const state = createEditorState();
  state.activeTool = EditorTool.Place;
  state.roomData = makeRoom();
  const item = PALETTE_ITEMS.find(i => i.id === 'challenge_field');
  assert.ok(item);
  state.selectedPaletteItem = item!;
  state.cursorBlockX = 4;
  state.cursorBlockY = 4;

  placeAtCursor(state);

  assert.equal(state.roomData.challengeFields?.length, 1);
});

test('placing TimeStop Field from the palette still works after the category move', () => {
  const state = createEditorState();
  state.activeTool = EditorTool.Place;
  state.roomData = makeRoom();
  const item = PALETTE_ITEMS.find(i => i.id === 'timestop_field');
  assert.ok(item);
  state.selectedPaletteItem = item!;
  state.cursorBlockX = 5;
  state.cursorBlockY = 5;

  placeAtCursor(state);

  assert.equal(state.roomData.timeStopFields?.length, 1);
});

// ── Regression guard: no category with items can silently vanish from the
// palette's generic preview-grid rendering path ────────────────────────────
//
// This is a structural stand-in for the actual root cause: editorUI.ts used
// to gate its 2-column preview grid behind a hand-maintained allowlist of
// category names, and 'timeStop' had been left off it — so the category tab
// existed and had one item, but rendered nothing. The fix made the grid
// default-on for every category except 'blocks' (custom theme-slot UI) and
// 'customBlocks' (dynamic registry-driven UI, no PALETTE_ITEMS entries).
// Any future category that isn't one of those two must render generically.

test('every PALETTE_CATEGORIES entry with PALETTE_ITEMS is not "blocks" or "customBlocks" (would otherwise need a rendering special-case)', () => {
  const categoriesWithItems = new Set(PALETTE_ITEMS.map(i => i.category));
  for (const category of categoriesWithItems) {
    if (category === 'blocks') continue; // has its own dedicated theme-slot UI, expected
    assert.notEqual(category, 'customBlocks', 'customBlocks items come from the dynamic registry, not PALETTE_ITEMS');
  }
  // Sanity: every category actually used by an item must be a real, current category.
  for (const category of categoriesWithItems) {
    assert.ok(PALETTE_CATEGORIES.includes(category), `category "${category}" used by a palette item must be listed in PALETTE_CATEGORIES`);
  }
});
