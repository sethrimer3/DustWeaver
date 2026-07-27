import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState } from '../editor/editorState';
import type { EditorRoomData } from '../editor/editorElementTypes';
import { rotateSelectedElement } from '../editor/editorTools';
import { handleCrumbleModifierToggle } from '../editor/editorPropertyChange';
import { createEditorHistory, undo, redo, capturePendingSnapshot, commitPendingSnapshot } from '../editor/editorHistory';
import { editorRoomDataToJson } from '../editor/roomJsonSerializer';
import { jsonToEditorRoomData } from '../editor/roomJson';

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
    playerSpawnBlock: [18, 18],
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
    ...overrides,
  } as unknown as EditorRoomData;
}

// ── Bug 1: rotating a crumble stairs block ──────────────────────────────────

test('rotateSelectedElement cycles a crumble stairs block through all 4 orientations, preserving other properties', () => {
  const room = makeRoom({
    crumbleBlocks: [{
      uid: 5, xBlock: 3, yBlock: 4, wBlock: 1, hBlock: 1,
      stairsOrientation: 0, variant: 'fire', blockTheme: 'blackRock',
    } as never],
  });
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'crumbleBlock', uid: 5 }];

  const expectedOrientations = [1, 2, 3, 0];
  for (const expected of expectedOrientations) {
    const changed = rotateSelectedElement(state);
    assert.equal(changed, true, 'rotating a crumble stairs block must report a real change');
    const block = room.crumbleBlocks![0];
    assert.equal(block.stairsOrientation, expected);
    // Non-orientation properties must survive the rotation untouched.
    assert.equal(block.xBlock, 3);
    assert.equal(block.yBlock, 4);
    assert.equal(block.wBlock, 1);
    assert.equal(block.hBlock, 1);
    assert.equal(block.variant, 'fire');
    assert.equal(block.blockTheme, 'blackRock');
  }
});

test('rotating a crumble stairs block is undo/redo-able', () => {
  const room = makeRoom({
    crumbleBlocks: [{
      uid: 5, xBlock: 3, yBlock: 4, wBlock: 1, hBlock: 1,
      stairsOrientation: 0, variant: 'normal',
    } as never],
  });
  const history = createEditorHistory();
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'crumbleBlock', uid: 5 }];

  // Mirror the real call site (editorKeyboardShortcuts.ts): capture a pending
  // snapshot, perform the mutation, then commit it — this produces a real
  // history entry (not a hand-rolled legacy one), so both undo AND redo are
  // exercised through the actual editorHistory machinery.
  const pending = capturePendingSnapshot(room);
  const changed = rotateSelectedElement(state);
  assert.equal(changed, true);
  assert.equal(room.crumbleBlocks![0].stairsOrientation, 1);
  const commitResult = commitPendingSnapshot(history, pending);
  assert.notEqual(commitResult, 'noop');

  const restored = undo(history, room);
  assert.equal(restored!.roomData.crumbleBlocks![0].stairsOrientation, 0, 'undo must restore the original orientation');

  const redone = redo(history, restored!.roomData);
  assert.equal(redone!.roomData.crumbleBlocks![0].stairsOrientation, 1, 'redo must reapply the rotation');
});

test('rotateSelectedElement also cycles a crumble ramp block orientation', () => {
  const room = makeRoom({
    crumbleBlocks: [{ uid: 6, xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, rampOrientation: 0, variant: 'normal' } as never],
  });
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'crumbleBlock', uid: 6 }];
  const changed = rotateSelectedElement(state);
  assert.equal(changed, true);
  assert.equal(room.crumbleBlocks![0].rampOrientation, 1);
});

// ── Bug 2: Cracked checkbox conversion ───────────────────────────────────────

test('handleCrumbleModifierToggle(true) converts a multi-selection of normal walls (plain + stairs) into crumble blocks', () => {
  const room = makeRoom({
    interiorWalls: [
      { uid: 10, xBlock: 1, yBlock: 1, wBlock: 2, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0, blockTheme: 'blackRock' } as never,
      { uid: 11, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0, stairsOrientation: 2 } as never,
    ],
    crumbleBlocks: [],
  });
  const history = createEditorHistory();
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 10 }, { type: 'wall', uid: 11 }];

  const toggled = handleCrumbleModifierToggle(state, history, true);
  assert.equal(toggled, true);
  assert.equal(room.interiorWalls.length, 0, 'both walls must be removed from interiorWalls');
  assert.equal(room.crumbleBlocks!.length, 2);

  const plain = room.crumbleBlocks!.find(b => b.uid === 10)!;
  assert.equal(plain.xBlock, 1);
  assert.equal(plain.yBlock, 1);
  assert.equal(plain.wBlock, 2);
  assert.equal(plain.hBlock, 1);
  assert.equal(plain.blockTheme, 'blackRock');

  const stairs = room.crumbleBlocks!.find(b => b.uid === 11)!;
  assert.equal(stairs.stairsOrientation, 2, 'stairs orientation must be preserved through the conversion');
  assert.equal(stairs.xBlock, 5);
  assert.equal(stairs.yBlock, 5);

  // Selection descriptors must be updated to the new type so the inspector/
  // overlay stay attached to the converted elements.
  assert.deepEqual(state.selectedElements, [{ type: 'crumbleBlock', uid: 10 }, { type: 'crumbleBlock', uid: 11 }]);
});

test('handleCrumbleModifierToggle(false) restores crumble blocks to walls, preserving orientation/dimensions/position', () => {
  const room = makeRoom({
    crumbleBlocks: [
      { uid: 20, xBlock: 2, yBlock: 3, wBlock: 1, hBlock: 1, stairsOrientation: 3, variant: 'ice', blockTheme: 'blackRock' } as never,
    ],
  });
  const history = createEditorHistory();
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'crumbleBlock', uid: 20 }];

  const toggled = handleCrumbleModifierToggle(state, history, false);
  assert.equal(toggled, true);
  assert.equal(room.crumbleBlocks!.length, 0);
  assert.equal(room.interiorWalls.length, 1);
  const wall = room.interiorWalls[0];
  assert.equal(wall.uid, 20);
  assert.equal(wall.xBlock, 2);
  assert.equal(wall.yBlock, 3);
  assert.equal(wall.stairsOrientation, 3, 'stairs orientation must survive un-cracking');
  assert.equal(wall.blockTheme, 'blackRock');
  assert.deepEqual(state.selectedElements, [{ type: 'wall', uid: 20 }]);
});

test('handleCrumbleModifierToggle leaves a platform wall untouched (no crumble equivalent) but still converts an eligible sibling', () => {
  const room = makeRoom({
    interiorWalls: [
      { uid: 30, xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, isPlatformFlag: 1, platformEdge: 0, isPillarHalfWidthFlag: 0 } as never,
      { uid: 31, xBlock: 1, yBlock: 0, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 } as never,
    ],
  });
  const history = createEditorHistory();
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 30 }, { type: 'wall', uid: 31 }];

  const toggled = handleCrumbleModifierToggle(state, history, true);
  assert.equal(toggled, true);
  assert.equal(room.interiorWalls.length, 1, 'the platform wall must remain (not convertible)');
  assert.equal(room.interiorWalls[0].uid, 30);
  assert.equal(room.crumbleBlocks!.length, 1);
  assert.equal(room.crumbleBlocks![0].uid, 31);
});

test('toggling Cracked on one selected block does not affect an unselected sibling from the same placement', () => {
  // Simulates two individually-hydrated blocks that happen to share an origin
  // (e.g. a 2-cell placement) — only uid 40 is selected, so uid 41 (an
  // unselected "group member") must be left completely untouched.
  const room = makeRoom({
    interiorWalls: [
      { uid: 40, xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 } as never,
      { uid: 41, xBlock: 1, yBlock: 0, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 } as never,
    ],
  });
  const history = createEditorHistory();
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 40 }];

  const toggled = handleCrumbleModifierToggle(state, history, true);
  assert.equal(toggled, true);
  assert.equal(room.interiorWalls.length, 1);
  assert.equal(room.interiorWalls[0].uid, 41, 'the unselected sibling must remain a plain wall');
  assert.equal(room.crumbleBlocks!.length, 1);
  assert.equal(room.crumbleBlocks![0].uid, 40);
});

test('handleCrumbleModifierToggle is a no-op when nothing selected is eligible', () => {
  const room = makeRoom({
    enemies: [{ uid: 50, xBlock: 0, yBlock: 0, type: 'basic' } as never],
  });
  const history = createEditorHistory();
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'enemy', uid: 50 }];
  const toggled = handleCrumbleModifierToggle(state, history, true);
  assert.equal(toggled, false);
  assert.equal(history.undoStack.length, 0, 'a no-op toggle must not push undo history');
});

// ── Bug 3 support / Bug 1 support: serialization round-trip ─────────────────

test('serialization round-trip preserves crumble stairs orientation, ramp orientation, and modifier state', () => {
  const room = makeRoom({
    crumbleBlocks: [
      { uid: 60, xBlock: 2, yBlock: 2, wBlock: 1, hBlock: 1, stairsOrientation: 1, variant: 'lightning', blockTheme: 'blackRock' } as never,
      { uid: 61, xBlock: 4, yBlock: 4, wBlock: 2, hBlock: 2, rampOrientation: 2, variant: 'normal' } as never,
    ],
  });

  const json = editorRoomDataToJson(room);
  assert.equal(json.crumbleBlocks?.length, 2);

  const { data: rehydrated } = jsonToEditorRoomData(json, 1000);
  const stairsBlock = rehydrated.crumbleBlocks!.find(b => b.xBlock === 2 && b.yBlock === 2)!;
  assert.equal(stairsBlock.stairsOrientation, 1);
  assert.equal(stairsBlock.variant, 'lightning');
  assert.equal(stairsBlock.blockTheme, 'blackRock');

  const rampBlock = rehydrated.crumbleBlocks!.find(b => b.xBlock === 4 && b.yBlock === 4)!;
  assert.equal(rampBlock.rampOrientation, 2);
  assert.equal(rampBlock.wBlock, 2);
  assert.equal(rampBlock.hBlock, 2);
});
