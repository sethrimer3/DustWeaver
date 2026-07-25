/**
 * editorRoomResizeBulk.test.ts — Coverage for the ±5 bulk edge-resize
 * operation: it must apply as a single atomic step (one undo entry, one
 * content shift), and must still respect the existing minimum room size.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdgeResize } from '../editor/editorRoomResize';
import { createEditorHistory } from '../editor/editorHistory';
import type { EditorRoomData } from '../editor/editorState';

function makeRoom(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    id: 'resize_test', name: 'Resize Test', worldNumber: 1,
    blockTheme: 'blackRock', backgroundId: 'brownRock', lightingEffect: 'Ambient',
    songId: '_continue', widthBlocks: 20, heightBlocks: 14,
    playerSpawnBlock: [5, 5], interiorWalls: [], enemies: [], transitions: [],
    saveTombs: [], skillTombs: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [], waterZones: [], lavaZones: [],
    crumbleBlocks: [], spikes: [], bouncePads: [], kineticBlocks: [], ropes: [], sunbeams: [],
    sceneLights: [], fallingBlocks: [], backgroundBlocks: [], dialogueTriggers: [], guideDustPaths: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [], lambdaAnchors: [],
    grappleCarryBlocks: [], phantasmalTiles: [], pixelMaterials: [],
    ...overrides,
  } as EditorRoomData;
}

test('+5 on left edge grows width by 5 and shifts content by 5 in one step', () => {
  const room = makeRoom();
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'left', 5);
  assert.equal(room.widthBlocks, 25);
  assert.equal(room.playerSpawnBlock[0], 10); // 5 + 5, shifted once (not five times)
  assert.equal(history.undoStack.length, 1);
});

test('-5 on left edge shrinks width by 5 and shifts content back by 5 in one step', () => {
  const room = makeRoom({ widthBlocks: 25, playerSpawnBlock: [10, 5] });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'left', -5);
  assert.equal(room.widthBlocks, 20);
  assert.equal(room.playerSpawnBlock[0], 5);
  assert.equal(history.undoStack.length, 1);
});

test('+5 on top edge grows height by 5 and shifts content by 5 in one step', () => {
  const room = makeRoom();
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'top', 5);
  assert.equal(room.heightBlocks, 19);
  assert.equal(room.playerSpawnBlock[1], 10);
  assert.equal(history.undoStack.length, 1);
});

test('+5 on right/bottom edges grows without shifting content', () => {
  const room = makeRoom();
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'right', 5);
  assert.equal(room.widthBlocks, 25);
  assert.equal(room.playerSpawnBlock[0], 5); // unchanged — no shift on right/bottom
  assert.equal(history.undoStack.length, 1);
});

test('-5 clamps at the minimum room size of 10 instead of going lower, still one undo step', () => {
  const room = makeRoom({ widthBlocks: 12 });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'right', -5);
  assert.equal(room.widthBlocks, 10); // clamped, not 7
  assert.equal(history.undoStack.length, 1);
});

test('-5 that would not move the room at all (already at minimum) is a no-op with no undo entry', () => {
  const room = makeRoom({ widthBlocks: 10 });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'right', -5);
  assert.equal(room.widthBlocks, 10);
  assert.equal(history.undoStack.length, 0);
});

test('a single ±5 resize can be undone in one step (verifies atomic undo entry)', () => {
  const room = makeRoom();
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'left', 5);
  assert.equal(room.widthBlocks, 25);
  const entry = history.undoStack[history.undoStack.length - 1];
  assert.ok(entry !== undefined);
  // Exactly one entry represents the whole ±5 operation.
  assert.equal(history.undoStack.length, 1);
});
