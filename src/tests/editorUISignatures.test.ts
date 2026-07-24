import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState, EditorTool } from '../editor/editorState';
import type { EditorState } from '../editor/editorState';
import { DEFAULT_CUSTOM_BLOCK_PROPERTIES } from '../levels/customBlockProperties';
import type { CustomBlockDef } from '../levels/customBlocks';
import {
  computeToolSig, computeBrushSig, computeCategorySig, computePaletteSelectionSig,
  computeBlockModifierSig, computeRoomMetadataSig, computeBlockThemeSig,
  computeCustomBlockRegistrySig, computePaletteStructureSig,
  computeInspectorIdentitySig, inspectorIdentitySigEquals,
} from '../editor/editorUISignatures';

function makeCustomBlockDef(overrides: Partial<CustomBlockDef> = {}): CustomBlockDef {
  return {
    id: 'block_a',
    namespacedId: 'custom:block_a',
    name: 'Block A',
    tileWidth: 1,
    tileHeight: 1,
    pixelWidth: 16,
    pixelHeight: 16,
    pixelData: new Uint8ClampedArray(16 * 16 * 4),
    properties: DEFAULT_CUSTOM_BLOCK_PROPERTIES,
    ...overrides,
  };
}

// ── Identical state -> identical signatures (no structural rebuild) ────────

test('identical state produces identical tool/brush/category/palette-selection signatures', () => {
  const a = createEditorState();
  const b = createEditorState();
  assert.equal(computeToolSig(a), computeToolSig(b));
  assert.equal(computeBrushSig(a), computeBrushSig(b));
  assert.equal(computeCategorySig(a), computeCategorySig(b));
  assert.equal(computePaletteSelectionSig(a), computePaletteSelectionSig(b));
  assert.equal(computeBlockModifierSig(a), computeBlockModifierSig(b));
  assert.equal(computePaletteStructureSig(a, null), computePaletteStructureSig(b, null));
});

// ── Tool-only change -> only the tool signature changes ─────────────────────

test('tool-only change updates only the tool signature, not brush/category/palette', () => {
  const before = createEditorState();
  const after = createEditorState();
  after.activeTool = EditorTool.Delete;

  assert.notEqual(computeToolSig(before), computeToolSig(after));
  assert.equal(computeBrushSig(before), computeBrushSig(after));
  assert.equal(computeCategorySig(before), computeCategorySig(after));
  assert.equal(computePaletteSelectionSig(before), computePaletteSelectionSig(after));
  assert.equal(computePaletteStructureSig(before, null), computePaletteStructureSig(after, null));
});

// ── Palette selection -> does not affect the structural signature ──────────

test('palette selection change does not change the palette structure signature', () => {
  const before = createEditorState();
  const after = createEditorState();
  after.selectedPaletteItem = { id: 'some_item', category: 'blocks' } as unknown as EditorState['selectedPaletteItem'];

  assert.notEqual(computePaletteSelectionSig(before), computePaletteSelectionSig(after));
  assert.equal(computePaletteStructureSig(before, null), computePaletteStructureSig(after, null),
    'selecting a palette item must not trigger a structural palette rebuild');
});

// ── Block modifier signature ─────────────────────────────────────────────────

test('block modifier signature changes when the pending modifier, crumble variant, or background-light flag changes', () => {
  const base = createEditorState();
  const sig0 = computeBlockModifierSig(base);

  const withModifier = createEditorState();
  withModifier.pendingBlockPlacementModifier = 'cracked';
  assert.notEqual(computeBlockModifierSig(withModifier), sig0);

  const withCrumble = createEditorState();
  withCrumble.pendingCrumbleVariant = 'unstable';
  assert.notEqual(computeBlockModifierSig(withCrumble), sig0);

  const withBgLight = createEditorState();
  withBgLight.pendingBackgroundBlocksLight = true;
  assert.notEqual(computeBlockModifierSig(withBgLight), sig0);
});

// ── Room metadata signature ──────────────────────────────────────────────────

test('room metadata signature reflects id/dimensions/background/song and is empty with no room', () => {
  const state = createEditorState();
  assert.equal(computeRoomMetadataSig(state), '');

  state.roomData = { id: 'r1', widthBlocks: 10, heightBlocks: 8, backgroundId: 'cave', songId: '_continue' } as unknown as EditorState['roomData'];
  const sig1 = computeRoomMetadataSig(state);
  assert.notEqual(sig1, '');

  const changedDims = { ...state, roomData: { ...state.roomData, widthBlocks: 11 } } as unknown as EditorState;
  assert.notEqual(computeRoomMetadataSig(changedDims), sig1);
});

// ── Block theme signature includes the open replace-picker slot ────────────

test('block theme signature changes when the replace-picker slot opens or closes', () => {
  const state = createEditorState();
  const closed = computeBlockThemeSig(state, null);
  const openedSlot0 = computeBlockThemeSig(state, 0);
  const openedSlot1 = computeBlockThemeSig(state, 1);
  assert.notEqual(closed, openedSlot0);
  assert.notEqual(openedSlot0, openedSlot1);
});

// ── Custom Blocks: rename/property/usage change triggers a rebuild ──────────

test('custom-block rename changes the registry signature', () => {
  const state = createEditorState();
  state.activeCategory = 'customBlocks';
  state.customBlockRegistry.set('block_a', makeCustomBlockDef());
  const before = computePaletteStructureSig(state, null);

  state.customBlockRegistry.set('block_a', makeCustomBlockDef({ name: 'Renamed Block' }));
  const after = computePaletteStructureSig(state, null);

  assert.notEqual(before, after, 'expected a rename to change the Custom Blocks structural signature');
});

test('custom-block property change changes the registry signature', () => {
  const state = createEditorState();
  state.activeCategory = 'customBlocks';
  state.customBlockRegistry.set('block_a', makeCustomBlockDef());
  const before = computePaletteStructureSig(state, null);

  state.customBlockRegistry.set('block_a', makeCustomBlockDef({
    properties: { ...DEFAULT_CUSTOM_BLOCK_PROPERTIES, collision: 'oneWay' },
  }));
  const after = computePaletteStructureSig(state, null);

  assert.notEqual(before, after, 'expected a property change to change the Custom Blocks structural signature');
});

test('custom-block usage-count change changes the registry signature', () => {
  const state = createEditorState();
  state.activeCategory = 'customBlocks';
  state.customBlockRegistry.set('block_a', makeCustomBlockDef());
  state.customBlockUsage.set('block_a', 0);
  const before = computePaletteStructureSig(state, null);

  state.customBlockUsage.set('block_a', 3);
  const after = computePaletteStructureSig(state, null);

  assert.notEqual(before, after, 'expected a usage-count change to change the Custom Blocks structural signature');
});

test('custom-block ordering change changes the registry signature', () => {
  const stateA = createEditorState();
  stateA.activeCategory = 'customBlocks';
  stateA.customBlockRegistry.set('block_a', makeCustomBlockDef({ id: 'block_a' }));
  stateA.customBlockRegistry.set('block_b', makeCustomBlockDef({ id: 'block_b', name: 'Block B' }));

  const stateB = createEditorState();
  stateB.activeCategory = 'customBlocks';
  stateB.customBlockRegistry.set('block_b', makeCustomBlockDef({ id: 'block_b', name: 'Block B' }));
  stateB.customBlockRegistry.set('block_a', makeCustomBlockDef({ id: 'block_a' }));

  assert.notEqual(computeCustomBlockRegistrySig(stateA), computeCustomBlockRegistrySig(stateB),
    'expected insertion-order (Map iteration order) to be reflected in the signature');
});

test('custom-block spriteRevision change (a pixel edit) changes the registry signature, without hashing the pixel buffer', () => {
  const state = createEditorState();
  state.activeCategory = 'customBlocks';
  state.customBlockRegistry.set('block_a', makeCustomBlockDef({ spriteRevision: 0 }));
  const before = computePaletteStructureSig(state, null);

  // Same pixelData reference/content — only spriteRevision changed, which is
  // exactly what a sprite-pixel edit does (see editorController.ts's
  // bumpSpriteRevision helper). This proves the signature reacts to the
  // revision counter alone, not to a full pixel-buffer comparison.
  state.customBlockRegistry.set('block_a', makeCustomBlockDef({ spriteRevision: 1 }));
  const after = computePaletteStructureSig(state, null);

  assert.notEqual(before, after, 'expected a spriteRevision bump to change the Custom Blocks structural signature');
});

test('custom-block selection change does NOT change the palette structure signature (patched via selection, not rebuilt)', () => {
  const state = createEditorState();
  state.activeCategory = 'customBlocks';
  state.customBlockRegistry.set('block_a', makeCustomBlockDef());
  state.customBlockRegistry.set('block_b', makeCustomBlockDef({ id: 'block_b', name: 'Block B' }));
  const before = computePaletteStructureSig(state, null);
  const beforeSelectionSig = computePaletteSelectionSig(state);

  state.selectedPaletteItem = {
    id: 'custom:block_b', category: 'customBlocks', customBlockId: 'block_b',
  } as unknown as EditorState['selectedPaletteItem'];
  const after = computePaletteStructureSig(state, null);
  const afterSelectionSig = computePaletteSelectionSig(state);

  assert.equal(before, after, 'expected selecting a custom block to leave the structural signature unchanged');
  assert.notEqual(beforeSelectionSig, afterSelectionSig, 'expected the selection signature itself to change so styling can still be patched');
});

test('unrelated state change while Custom Blocks is open does not change the registry signature', () => {
  const state = createEditorState();
  state.activeCategory = 'customBlocks';
  state.customBlockRegistry.set('block_a', makeCustomBlockDef());
  const before = computePaletteStructureSig(state, null);

  state.activeTool = EditorTool.Delete; // unrelated
  const after = computePaletteStructureSig(state, null);

  assert.equal(before, after);
});

// ── Inspector identity ────────────────────────────────────────────────────────

test('inspector identity signature only changes when selection identity actually changes', () => {
  const state = createEditorState();
  const sigEmpty = computeInspectorIdentitySig(state);
  assert.equal(sigEmpty.uid, -1);

  state.selectedElements = [{ uid: 5, type: 'wall' } as unknown as EditorState['selectedElements'][number]];
  const sigSelected = computeInspectorIdentitySig(state);
  assert.notEqual(sigSelected.uid, sigEmpty.uid);
  assert.ok(!inspectorIdentitySigEquals(sigEmpty, sigSelected));

  const sigSelectedAgain = computeInspectorIdentitySig(state);
  assert.ok(inspectorIdentitySigEquals(sigSelected, sigSelectedAgain),
    'expected an unrelated re-read of the same selection to produce an equal identity signature');
});

test('inspector identity signature changes when a dialogue trigger\'s entry count changes', () => {
  const state = createEditorState();
  state.selectedElements = [{ uid: 7, type: 'dialogueTrigger' } as unknown as EditorState['selectedElements'][number]];
  state.roomData = {
    dialogueTriggers: [{ uid: 7, entries: [{ text: 'a' }] }],
  } as unknown as EditorState['roomData'];
  const sigBefore = computeInspectorIdentitySig(state);

  state.roomData = {
    dialogueTriggers: [{ uid: 7, entries: [{ text: 'a' }, { text: 'b' }] }],
  } as unknown as EditorState['roomData'];
  const sigAfter = computeInspectorIdentitySig(state);

  assert.ok(!inspectorIdentitySigEquals(sigBefore, sigAfter));
});
