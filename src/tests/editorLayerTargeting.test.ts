/**
 * Phase 2: placement-target semantics, layer-state stability, placement
 * block-reason correctness, and panel-presentation helpers.
 *
 * See editorLayers.ts for getPlacementTargetLayer / getSelectedElementLayers /
 * getPlacementStatus, the Phase 2 replacement for the old overloaded
 * getActiveLayerId().
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorTool, createEditorState } from '../editor/editorState';
import type { EditorRoomData } from '../editor/editorElementTypes';
import type { PaletteItem } from '../editor/editorPaletteItems';
import {
  getPlacementTargetLayer,
  getSelectedElementLayers,
  getPlacementStatus,
  describePlacementBlockReason,
} from '../editor/editorLayers';
import { placeAtCursor } from '../editor/editorPlaceTool';

function makeRoom(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    id: 'test_room', name: 'Test Room', worldNumber: 1, mapX: 0, mapY: 0,
    blockTheme: 'blackRock', backgroundId: 'cave', lightingEffect: 'DEFAULT', songId: '_continue',
    widthBlocks: 20, heightBlocks: 20, playerSpawnBlock: [18, 18],
    interiorWalls: [], enemies: [], transitions: [], saveTombs: [], skillTombs: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [],
    lambdaAnchors: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [],
    ...overrides,
  } as unknown as EditorRoomData;
}

const BLOCK_ITEM: PaletteItem = {
  id: 'block_1x1', label: 'Block', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1,
};
const HAZARD_ITEM: PaletteItem = { id: 'spike_1x1', label: 'Spike', category: 'specialBlocks' };
const PIXEL_ITEM: PaletteItem = {
  id: 'sand_1x1', label: 'Sand', category: 'dust', isPixelMaterialItem: 1, pixelMaterialId: 1,
};

function baseState(item: PaletteItem | null, tool: EditorTool = EditorTool.Place) {
  const state = createEditorState();
  state.roomData = makeRoom();
  state.activeTool = tool;
  state.selectedPaletteItem = item;
  return state;
}

// ── Item 1: target semantics per tool ────────────────────────────────────

test('Place + terrain block item targets Terrain', () => {
  const state = baseState(BLOCK_ITEM);
  assert.equal(getPlacementTargetLayer(state), 'terrain');
});

test('Place + Background modifier targets Background instead of Terrain', () => {
  const state = baseState(BLOCK_ITEM);
  state.pendingBlockPlacementModifier = 'background';
  assert.equal(getPlacementTargetLayer(state), 'background');
});

test('Place + hazard item targets Hazards', () => {
  const state = baseState(HAZARD_ITEM);
  assert.equal(getPlacementTargetLayer(state), 'hazards');
});

test('Place + pixel material item targets Powder', () => {
  const state = baseState(PIXEL_ITEM);
  assert.equal(getPlacementTargetLayer(state), 'powder');
});

test('Select tool has no placement target even with an item selected', () => {
  const state = baseState(BLOCK_ITEM, EditorTool.Select);
  assert.equal(getPlacementTargetLayer(state), null);
});

test('Delete tool has no placement target even with an item selected', () => {
  const state = baseState(BLOCK_ITEM, EditorTool.Delete);
  assert.equal(getPlacementTargetLayer(state), null);
});

test('switching tool away from Place clears the placement target', () => {
  const state = baseState(BLOCK_ITEM);
  assert.equal(getPlacementTargetLayer(state), 'terrain');
  state.activeTool = EditorTool.Select;
  assert.equal(getPlacementTargetLayer(state), null);
});

test('Place tool with no palette item selected has no placement target', () => {
  const state = baseState(null);
  assert.equal(getPlacementTargetLayer(state), null);
});

test('changing category without a placeable item creates no false target', () => {
  const state = baseState(null, EditorTool.Select);
  state.activeCategory = 'blocks';
  assert.equal(getPlacementTargetLayer(state), null);
});

// ── Item 1: selection-layer semantics ─────────────────────────────────────

test('getSelectedElementLayers derives layers from selection, purely informational', () => {
  const state = createEditorState();
  state.selectedElements = [{ type: 'wall', uid: 1 }, { type: 'enemy', uid: 2 }] as never;
  const layers = getSelectedElementLayers(state);
  assert.equal(layers.has('terrain'), true);
  assert.equal(layers.has('enemies'), true);
  assert.equal(layers.size, 2);
  // Must not mutate visibility/lock/solo/selectOnly state.
  assert.equal(state.layers.terrain.visible, true);
  assert.equal(state.layers.enemies.locked, false);
});

test('empty selection yields an empty selected-element-layers set', () => {
  const state = createEditorState();
  assert.equal(getSelectedElementLayers(state).size, 0);
});

// ── Item 3: layer-state stability (no auto-reveal) ────────────────────────

test('selecting a palette item never unhides or un-solos its destination layer', () => {
  const state = createEditorState();
  state.roomData = makeRoom();
  state.layers.terrain.visible = false;
  state.activeTool = EditorTool.Place;
  state.selectedPaletteItem = BLOCK_ITEM;
  // Reading the target must not itself mutate anything.
  assert.equal(getPlacementTargetLayer(state), 'terrain');
  assert.equal(state.layers.terrain.visible, false, 'layer visibility must stay untouched');
});

test('Background modifier never alters Terrain or Background visibility', () => {
  const state = createEditorState();
  state.roomData = makeRoom();
  state.layers.background.visible = false;
  state.activeTool = EditorTool.Place;
  state.selectedPaletteItem = BLOCK_ITEM;
  state.pendingBlockPlacementModifier = 'background';
  assert.equal(getPlacementTargetLayer(state), 'background');
  assert.equal(state.layers.background.visible, false);
  assert.equal(state.layers.terrain.visible, true);
});

test('a restricted target stays restricted (blocked placement does not touch layer state)', () => {
  const state = createEditorState();
  state.roomData = makeRoom();
  state.layers.terrain.locked = true;
  state.activeTool = EditorTool.Place;
  state.selectedPaletteItem = BLOCK_ITEM;
  state.cursorBlockX = 5;
  state.cursorBlockY = 5;
  const placed = placeAtCursor(state);
  assert.equal(placed, false);
  assert.equal(state.layers.terrain.locked, true, 'blocked placement must not unlock the layer');
});

// ── Item 5: placement status / block-reason correctness ──────────────────

test('getPlacementStatus reports hidden reason for a hidden target layer', () => {
  const state = baseState(BLOCK_ITEM);
  state.layers.terrain.visible = false;
  const status = getPlacementStatus(state);
  assert.equal(status.allowed, false);
  assert.equal(status.reason, 'hidden');
  assert.equal(status.targetLayer, 'terrain');
});

test('getPlacementStatus reports locked reason for a locked target layer', () => {
  const state = baseState(BLOCK_ITEM);
  state.layers.terrain.locked = true;
  const status = getPlacementStatus(state);
  assert.equal(status.allowed, false);
  assert.equal(status.reason, 'locked');
});

test('getPlacementStatus reports solo-excluded when another layer is soloed', () => {
  const state = baseState(BLOCK_ITEM);
  state.layers.enemies.solo = true;
  const status = getPlacementStatus(state);
  assert.equal(status.allowed, false);
  assert.equal(status.reason, 'solo-excluded');
});

test('getPlacementStatus reports select-only-excluded when another layer is select-only', () => {
  const state = baseState(BLOCK_ITEM);
  state.layers.enemies.selectOnly = true;
  const status = getPlacementStatus(state);
  assert.equal(status.allowed, false);
  assert.equal(status.reason, 'select-only-excluded');
});

test('getPlacementStatus reports allowed with no reason for a normal target', () => {
  const state = baseState(BLOCK_ITEM);
  const status = getPlacementStatus(state);
  assert.equal(status.allowed, true);
  assert.equal(status.reason, null);
});

test('getPlacementStatus reports no-item when nothing is selected', () => {
  const state = baseState(null);
  const status = getPlacementStatus(state);
  assert.equal(status.allowed, false);
  assert.equal(status.reason, 'no-item');
  assert.equal(status.targetLayer, null);
});

test('getPlacementStatus uses Powder restrictions for a pixel-material target', () => {
  const state = baseState(PIXEL_ITEM);
  state.layers.powder.locked = true;
  const status = getPlacementStatus(state);
  assert.equal(status.targetLayer, 'powder');
  assert.equal(status.allowed, false);
  assert.equal(status.reason, 'locked');
});

test('getPlacementStatus uses Background restrictions when Background modifier is active', () => {
  const state = baseState(BLOCK_ITEM);
  state.pendingBlockPlacementModifier = 'background';
  state.layers.background.visible = false;
  state.layers.terrain.locked = true; // Terrain restriction must NOT apply here
  const status = getPlacementStatus(state);
  assert.equal(status.targetLayer, 'background');
  assert.equal(status.allowed, false);
  assert.equal(status.reason, 'hidden');
});

test('describePlacementBlockReason produces a concise, layer-specific message', () => {
  assert.equal(describePlacementBlockReason('locked', 'terrain'), 'Terrain layer is locked.');
  assert.equal(describePlacementBlockReason('hidden', 'background'), 'Background layer is hidden.');
  assert.equal(describePlacementBlockReason('solo-excluded', 'hazards'), 'Hazards is excluded by Solo mode.');
  assert.equal(
    describePlacementBlockReason('select-only-excluded', 'powder'),
    'Powder / Dust Motes is outside the current select-only scope.',
  );
});

// ── Panel-presentation helpers (pure state, no DOM/canvas needed) ────────

test('placement-target and selected-content markers are distinguishable states', () => {
  const state = createEditorState();
  state.roomData = makeRoom();
  state.activeTool = EditorTool.Place;
  state.selectedPaletteItem = BLOCK_ITEM;
  state.selectedElements = [{ type: 'enemy', uid: 1 }] as never;
  const target = getPlacementTargetLayer(state);
  const selLayers = getSelectedElementLayers(state);
  assert.equal(target, 'terrain');
  assert.equal(selLayers.has('enemies'), true);
  assert.equal(selLayers.has('terrain'), false, 'target and selection markers must be independently computed');
});

test('a multi-layer selection marks every represented layer', () => {
  const state = createEditorState();
  state.selectedElements = [
    { type: 'wall', uid: 1 }, { type: 'enemy', uid: 2 }, { type: 'spike', uid: 3 },
  ] as never;
  const layers = getSelectedElementLayers(state);
  assert.equal(layers.has('terrain'), true);
  assert.equal(layers.has('enemies'), true);
  assert.equal(layers.has('hazards'), true);
  assert.equal(layers.size, 3);
});

test('non-Place tools show no placement target regardless of selection contents', () => {
  const state = createEditorState();
  state.activeTool = EditorTool.Select;
  state.selectedElements = [{ type: 'wall', uid: 1 }] as never;
  assert.equal(getPlacementTargetLayer(state), null);
});
