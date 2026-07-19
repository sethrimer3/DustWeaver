/**
 * editorBackgroundModifier.test.ts — Coverage for converting background
 * blocks from standalone palette cards into a Block Modifier checkbox.
 *
 *  - The four obsolete BG palette cards are gone.
 *  - The Background modifier creates background-block data on ordinary
 *    block placement, using the currently selected theme/footprint.
 *  - The subordinate "blocks ambient light" flag round-trips.
 *  - Old rooms with legacy background blocks still round-trip unchanged
 *    through the JSON room format.
 *  - The 4 block-theme slot system: assignment, activation, replacement,
 *    persistence, and safe fallback for an unknown saved theme.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTE_ITEMS } from '../editor/editorPaletteItems';
import {
  createEditorState,
  selectBlockTheme,
  activateBlockThemeSlot,
  assignBlockThemeSlot,
} from '../editor/editorState';
import type { EditorRoomData } from '../editor/editorElementTypes';
import { placeAtCursor } from '../editor/editorPlaceTool';
import { editorRoomDataToJson, jsonToEditorRoomData } from '../editor/roomJson';

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
    backgroundBlocks: [],
    ...overrides,
  } as unknown as EditorRoomData;
}

// ── 1. The four obsolete BG cards are gone ──────────────────────────────────

test('the four standalone BG block palette cards no longer exist', () => {
  const removedIds = ['bg_block_1x1', 'bg_block_2x2', 'bg_block_light_1x1', 'bg_block_light_2x2'];
  for (const id of removedIds) {
    assert.equal(PALETTE_ITEMS.some(i => i.id === id), false, `${id} should no longer be a palette card`);
  }
});

test('no PALETTE_ITEMS entry sets isBackgroundBlockItem any more', () => {
  assert.equal(PALETTE_ITEMS.some(i => i.isBackgroundBlockItem === 1), false);
});

// ── 2. Background modifier creates background-block data ────────────────────

test('Background modifier on an ordinary 1x1 block placement creates a background block, no wall', () => {
  const room = makeRoom();
  const state = createEditorState();
  state.roomData = room;
  const item = PALETTE_ITEMS.find(i => i.id === 'block_1x1')!;
  state.selectedPaletteItem = item;
  state.pendingBlockPlacementModifier = 'background';
  state.selectedBlockTheme = 'blackRock';
  state.cursorBlockX = 5;
  state.cursorBlockY = 5;
  placeAtCursor(state);

  assert.equal(room.interiorWalls.length, 0, 'no collidable wall should be created');
  assert.equal(room.backgroundBlocks?.length, 1);
  const bg = room.backgroundBlocks![0];
  assert.equal(bg.xBlock, 5);
  assert.equal(bg.yBlock, 5);
  assert.equal(bg.wBlock, 1);
  assert.equal(bg.hBlock, 1);
  assert.equal(bg.blockTheme, 'blackRock');
  assert.equal(bg.isLightBlockingFlag, 0);
});

test('Background modifier on a 2x2 block placement uses the 2x2 footprint', () => {
  const room = makeRoom();
  const state = createEditorState();
  state.roomData = room;
  const item = PALETTE_ITEMS.find(i => i.id === 'block_2x2')!;
  state.selectedPaletteItem = item;
  state.pendingBlockPlacementModifier = 'background';
  state.cursorBlockX = 3;
  state.cursorBlockY = 3;
  placeAtCursor(state);

  assert.equal(room.backgroundBlocks?.length, 1);
  assert.equal(room.backgroundBlocks![0].wBlock, 2);
  assert.equal(room.backgroundBlocks![0].hBlock, 2);
});

// ── 3. Light-blocking flag preserved ─────────────────────────────────────────

test('Background modifier with "blocks ambient light" enabled sets isLightBlockingFlag: 1', () => {
  const room = makeRoom();
  const state = createEditorState();
  state.roomData = room;
  const item = PALETTE_ITEMS.find(i => i.id === 'block_1x1')!;
  state.selectedPaletteItem = item;
  state.pendingBlockPlacementModifier = 'background';
  state.pendingBackgroundBlocksLight = true;
  state.cursorBlockX = 2;
  state.cursorBlockY = 2;
  placeAtCursor(state);

  assert.equal(room.backgroundBlocks?.length, 1);
  assert.equal(room.backgroundBlocks![0].isLightBlockingFlag, 1);
});

// ── 4. Incompatible modifiers cannot combine ─────────────────────────────────

test('the background modifier field never simultaneously holds a cracked/falling value', () => {
  const state = createEditorState();
  // pendingBlockPlacementModifier is a single field, so setting it to
  // 'background' inherently clears out 'cracked'/'tough'/'sensitive'/'crumbling'.
  state.pendingBlockPlacementModifier = 'cracked';
  assert.notEqual(state.pendingBlockPlacementModifier as string, 'background');
  state.pendingBlockPlacementModifier = 'background';
  assert.notEqual(state.pendingBlockPlacementModifier as string, 'cracked');
});

test('placing with the background modifier never creates a crumble or falling block', () => {
  const room = makeRoom();
  const state = createEditorState();
  state.roomData = room;
  const item = PALETTE_ITEMS.find(i => i.id === 'block_1x1')!;
  state.selectedPaletteItem = item;
  state.pendingBlockPlacementModifier = 'background';
  state.cursorBlockX = 1;
  state.cursorBlockY = 1;
  placeAtCursor(state);

  assert.equal(room.crumbleBlocks?.length ?? 0, 0);
  assert.equal(room.fallingBlocks?.length ?? 0, 0);
  assert.equal(room.backgroundBlocks?.length, 1);
});

// ── 5. Legacy background blocks round-trip through the JSON room format ─────

test('existing (legacy) background blocks round-trip unchanged through editor JSON export/import', () => {
  const room = makeRoom({
    backgroundBlocks: [
      { uid: 1, xBlock: 4, yBlock: 4, wBlock: 1, hBlock: 1, blockTheme: 'brownRock', isLightBlockingFlag: 0 },
      { uid: 2, xBlock: 6, yBlock: 6, wBlock: 2, hBlock: 2, blockTheme: 'dirt', isLightBlockingFlag: 1 },
    ],
  });
  const json = editorRoomDataToJson(room);
  const { data: restored } = jsonToEditorRoomData(json, 100);
  // uid is reassigned on import (existing editor behavior for every element
  // type — see editorNewElements.test.ts) so compare everything else.
  const strip = (blocks: typeof room.backgroundBlocks) => (blocks ?? []).map(({ uid: _uid, ...rest }) => rest);
  assert.deepEqual(strip(restored.backgroundBlocks), strip(room.backgroundBlocks));
});

// ── 6. Four-slot theme assignment/activation/replacement/fallback ──────────

test('activateBlockThemeSlot switches selectedBlockTheme without touching other placement state', () => {
  const state = createEditorState();
  state.blockThemeSlots = ['blackRock', 'brownRock', 'dirt', 'blackRock'];
  state.activeBlockThemeSlotIndex = 0;
  state.selectedBlockTheme = 'blackRock';
  const item = PALETTE_ITEMS.find(i => i.id === 'block_1x1')!;
  state.selectedPaletteItem = item;
  state.placementRotationSteps = 2;
  state.pendingBlockPlacementModifier = 'cracked';

  activateBlockThemeSlot(state, 1);

  assert.equal(state.activeBlockThemeSlotIndex, 1);
  assert.equal(state.selectedBlockTheme, 'brownRock');
  // Unrelated placement state must be untouched.
  assert.equal(state.selectedPaletteItem, item);
  assert.equal(state.placementRotationSteps, 2);
  assert.equal(state.pendingBlockPlacementModifier, 'cracked');
});

test('assignBlockThemeSlot assigns, activates the slot, and updates selectedBlockTheme', () => {
  const state = createEditorState();
  state.blockThemeSlots = ['blackRock', 'brownRock', 'dirt', 'blackRock'];
  state.activeBlockThemeSlotIndex = 0;

  assignBlockThemeSlot(state, 2, 'brownRock');

  assert.equal(state.blockThemeSlots[2], 'brownRock');
  assert.equal(state.activeBlockThemeSlotIndex, 2);
  assert.equal(state.selectedBlockTheme, 'brownRock');
});

test('selectBlockTheme (plain theme-chip pick) does not disturb the 4 theme slots', () => {
  const state = createEditorState();
  const slotsBefore = state.blockThemeSlots.slice();
  selectBlockTheme(state, 'dirt');
  assert.deepEqual(state.blockThemeSlots, slotsBefore);
  assert.equal(state.selectedBlockTheme, 'dirt');
});

test('createEditorState seeds 4 always-valid theme slots and a valid active index', () => {
  const state = createEditorState();
  assert.equal(state.blockThemeSlots.length, 4);
  for (const t of state.blockThemeSlots) assert.equal(typeof t, 'string');
  assert.ok(state.activeBlockThemeSlotIndex >= 0 && state.activeBlockThemeSlotIndex < 4);
  assert.equal(state.selectedBlockTheme, state.blockThemeSlots[state.activeBlockThemeSlotIndex]);
});

// ── 7. Replace-icon click must not also invoke the slot-body handler ────────
// editorUIHelpers.ts (makeThemeSlot) transitively imports the Vite-only
// folder-theme catalogue (import.meta.glob), so it cannot be instantiated
// under the plain Node test runner — see the identical constraint documented
// in editorNewElements.test.ts. Source-scan instead: verify the replace
// button's own click handler calls stopPropagation() before invoking its
// callback, so clicking it can never also fire the slot body's onSelect.
test('makeThemeSlot: replace icon click handler calls stopPropagation before onReplace', () => {
  const helpersSrc = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../editor/editorUIHelpers.ts'),
    'utf8',
  );
  const fnStart = helpersSrc.indexOf('export function makeThemeSlot');
  assert.ok(fnStart >= 0, 'makeThemeSlot should exist in editorUIHelpers.ts');
  const fnBody = helpersSrc.slice(fnStart, fnStart + 3000);
  const replaceBtnBlock = fnBody.slice(fnBody.indexOf('replaceBtn.addEventListener'));
  const stopIdx = replaceBtnBlock.indexOf('stopPropagation');
  const callbackIdx = replaceBtnBlock.indexOf('onReplace()');
  assert.ok(stopIdx >= 0, 'replace icon click handler should call stopPropagation');
  assert.ok(callbackIdx > stopIdx, 'stopPropagation should run before onReplace()');
});

// ── 8. Background rendering uses full opacity + true 40% darkening ─────────
// folderBlockThemes.ts / backgroundBlockRenderer.ts also transitively pull in
// the Vite-only catalogue, so source-scan the same way.
test('background block rendering draws at globalAlpha = 1, not a faked-transparency blend', () => {
  const rendererSrc = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../render/walls/backgroundBlockRenderer.ts'),
    'utf8',
  );
  assert.ok(rendererSrc.includes('ctx.globalAlpha = 1'), 'background blocks must render at full alpha');
  assert.ok(!/globalAlpha\s*=\s*0\.5/.test(rendererSrc), 'must not fake darkness via 50% alpha any more');
});

test('darkened background sprites keep 60% RGB brightness (40% darker) and preserve alpha', () => {
  const themesSrc = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../render/walls/folderBlockThemes.ts'),
    'utf8',
  );
  assert.ok(themesSrc.includes('BACKGROUND_BLOCK_BRIGHTNESS = 0.6'), 'brightness constant should be 60% (40% darker)');
  // The darken loop must scale r/g/b but must not touch alpha (d[i+3]).
  const darkenFnStart = themesSrc.indexOf('function _darkenCanvas');
  const darkenFnBody = themesSrc.slice(darkenFnStart, darkenFnStart + 1200);
  assert.ok(!/d\[i \+ 3\]\s*=/.test(darkenFnBody), 'alpha channel must be left untouched');
});
