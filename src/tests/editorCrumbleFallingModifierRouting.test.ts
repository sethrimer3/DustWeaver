/**
 * editorCrumbleFallingModifierRouting.test.ts — regression coverage for the
 * Todo item "Add crumble/falling block palette entries if those block types
 * become active editor items."
 *
 * Investigation found the Block Modifier system (Cracked / Falling: Tough /
 * Sensitive / Crumbling in editorUI.ts) already supersedes standalone
 * crumble/falling palette cards for every eligible shape EXCEPT spikes,
 * where `placeAtCursor` checked `item.isSpikeItem === 1` before the crumble
 * modifier branch and always placed an ordinary, unbreakable spike even when
 * the Cracked modifier was active — a genuine UI/placement mismatch (the
 * placement preview already drew the crack overlay for this case). This file
 * covers the fix: crumble spikes now route correctly through placeAtCursor,
 * and the Falling modifier — architecturally unable to represent ramp/
 * stairs/pillar/spike shapes (EditorFallingBlock has no orientation/spike
 * fields) — no longer silently degrades those shapes into plain rectangular
 * falling tiles.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEditorState, EditorTool } from '../editor/editorState';
import { PALETTE_ITEMS } from '../editor/editorPaletteItems';
import type { EditorRoomData } from '../editor/editorElementTypes';
import { placeAtCursor, wouldPlacementSucceedAt } from '../editor/editorPlaceTool';

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
    playerSpawnBlock: [2, 2],
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
    crumbleBlocks: [],
    spikes: [],
    fallingBlocks: [],
    ...overrides,
  } as unknown as EditorRoomData;
}

function findItem(id: string) {
  const item = PALETTE_ITEMS.find(i => i.id === id);
  assert.ok(item, `palette item ${id} must exist`);
  return item!;
}

// ── Crumble spikes now route correctly through placeAtCursor ────────────────

for (const [id, size] of [['spike_1x1', '1x1'], ['spike_2x2', '2x2']] as const) {
  test(`placeAtCursor creates a crumble spike (not an ordinary spike) for ${id} with the Cracked modifier active`, () => {
    const state = createEditorState();
    state.roomData = makeRoom();
    state.activeTool = EditorTool.Place;
    state.selectedPaletteItem = findItem(id);
    state.pendingBlockPlacementModifier = 'cracked';
    state.pendingCrumbleVariant = 'fire';
    state.cursorBlockX = 4;
    state.cursorBlockY = 4;
    state.placementRotationSteps = 1; // direction 'right'

    const placed = placeAtCursor(state);
    assert.equal(placed, true);

    const room = state.roomData!;
    assert.equal((room.spikes ?? []).length, 0, 'no ordinary spike should be created');
    assert.equal((room.crumbleBlocks ?? []).length, 1, 'a crumble block must be created instead');
    const block = (room.crumbleBlocks ?? [])[0];
    assert.equal(block.spikeDirection, 'right');
    assert.equal(block.spikeSize, size);
    assert.equal(block.variant, 'fire');
    assert.equal(block.xBlock, 4);
    assert.equal(block.yBlock, 4);
    const expectedBlocks = size === '2x2' ? 2 : 1;
    assert.equal(block.wBlock, expectedBlocks);
    assert.equal(block.hBlock, expectedBlocks);
  });
}

test('an ordinary (non-cracked) spike placement is unaffected — still creates a plain EditorSpike', () => {
  const state = createEditorState();
  state.roomData = makeRoom();
  state.activeTool = EditorTool.Place;
  state.selectedPaletteItem = findItem('spike_1x1');
  state.pendingBlockPlacementModifier = 'none';
  state.cursorBlockX = 2;
  state.cursorBlockY = 2;

  const placed = placeAtCursor(state);
  assert.equal(placed, true);
  const room = state.roomData!;
  assert.equal((room.spikes ?? []).length, 1);
  assert.equal((room.crumbleBlocks ?? []).length, 0);
});

test('wouldPlacementSucceedAt reports a crumble-spike placement as occupied against an overlapping existing spike', () => {
  const state = createEditorState();
  state.roomData = makeRoom({
    spikes: [{ uid: 1, xBlock: 4, yBlock: 4, direction: 'up', size: '1x1' }] as never,
  });
  state.activeTool = EditorTool.Place;
  state.selectedPaletteItem = findItem('spike_1x1');
  state.pendingBlockPlacementModifier = 'cracked';

  const result = wouldPlacementSucceedAt(state, 4, 4);
  assert.equal(result, 'occupied');
});

// ── Falling modifier cannot silently degrade a shaped block ────────────────

const SHAPED_BLOCK_ITEM_IDS = ['stairs_1x1', 'stairs_2x2', 'ramp_1x1', 'ramp_2x2', 'pillar_half_width', 'spike_1x1', 'spike_2x2'];

for (const id of SHAPED_BLOCK_ITEM_IDS) {
  for (const modifier of ['tough', 'sensitive', 'crumbling'] as const) {
    test(`placeAtCursor never creates plain falling tiles for shaped item ${id} with Falling: ${modifier}`, () => {
      const state = createEditorState();
      state.roomData = makeRoom();
      state.activeTool = EditorTool.Place;
      state.selectedPaletteItem = findItem(id);
      state.pendingBlockPlacementModifier = modifier;
      state.cursorBlockX = 6;
      state.cursorBlockY = 6;

      placeAtCursor(state);
      const room = state.roomData!;
      assert.equal((room.fallingBlocks ?? []).length, 0,
        `${id} has no shape representation in EditorFallingBlock and must not silently place plain falling tiles`);
    });
  }
}

test('placeAtCursor still creates falling tiles for a plain 1x1 block with Falling: Tough', () => {
  const state = createEditorState();
  state.roomData = makeRoom();
  state.activeTool = EditorTool.Place;
  state.selectedPaletteItem = findItem('block_1x1');
  state.pendingBlockPlacementModifier = 'tough';
  state.cursorBlockX = 6;
  state.cursorBlockY = 6;

  const placed = placeAtCursor(state);
  assert.equal(placed, true);
  const room = state.roomData!;
  assert.equal((room.fallingBlocks ?? []).length, 1);
  assert.equal(room.fallingBlocks![0].variant, 'tough');
  assert.equal((room.interiorWalls ?? []).length, 0, 'no ordinary wall should be created alongside the falling tile');
});

test('placeAtCursor still creates falling tiles for a plain 2x2 block with Falling: Sensitive', () => {
  const state = createEditorState();
  state.roomData = makeRoom();
  state.activeTool = EditorTool.Place;
  state.selectedPaletteItem = findItem('block_2x2');
  state.pendingBlockPlacementModifier = 'sensitive';
  state.cursorBlockX = 8;
  state.cursorBlockY = 8;

  const placed = placeAtCursor(state);
  assert.equal(placed, true);
  const room = state.roomData!;
  assert.equal((room.fallingBlocks ?? []).length, 4, '2x2 footprint = 4 individual falling tiles');
  for (const fb of room.fallingBlocks!) assert.equal(fb.variant, 'sensitive');
});

// ── Platforms remain ineligible for crumble/falling at the placement layer ─

test('placeAtCursor never converts a platform into a crumble or falling block even if the modifier is pending', () => {
  for (const modifier of ['cracked', 'tough', 'sensitive', 'crumbling'] as const) {
    const state = createEditorState();
    state.roomData = makeRoom();
    state.activeTool = EditorTool.Place;
    state.selectedPaletteItem = findItem('platform');
    state.pendingBlockPlacementModifier = modifier;
    state.cursorBlockX = 3;
    state.cursorBlockY = 3;

    const placed = placeAtCursor(state);
    assert.equal(placed, true);
    const room = state.roomData!;
    assert.equal((room.crumbleBlocks ?? []).length, 0, `platform must stay ineligible for ${modifier}`);
    assert.equal((room.fallingBlocks ?? []).length, 0, `platform must stay ineligible for ${modifier}`);
    assert.equal((room.interiorWalls ?? []).length, 1, 'an ordinary platform wall should still be placed');
    assert.equal(room.interiorWalls[0].isPlatformFlag, 1);
  }
});
