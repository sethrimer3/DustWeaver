/**
 * Phase 2, Fix 1: unified placement preflight.
 *
 * `wouldPlacementSucceedAt` (editorPlaceTool.ts) is the side-effect-free
 * predicate now wired into `getPlacementStatus`'s `isValidLocation` callback
 * for the preview drawer, the controller's blocked-click toast, and (as the
 * authoritative mutation guard) `placeAt` itself. These tests verify it
 * reports the right reason for occupied/out-of-bounds/singleton-style cases,
 * that it never mutates room data or allocates a uid, and that
 * `placeAtCursor` agrees with it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorTool, createEditorState } from '../editor/editorState';
import type { EditorRoomData } from '../editor/editorElementTypes';
import type { PaletteItem } from '../editor/editorPaletteItems';
import { getPlacementStatus } from '../editor/editorLayers';
import { placeAtCursor, wouldPlacementSucceedAt } from '../editor/editorPlaceTool';

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
const TOTEM_ITEM: PaletteItem = { id: 'challenge_totem', label: 'Totem', category: 'objects' };

function baseState(item: PaletteItem | null, room: EditorRoomData) {
  const state = createEditorState();
  state.roomData = room;
  state.activeTool = EditorTool.Place;
  state.selectedPaletteItem = item;
  return state;
}

// ── Occupied ───────────────────────────────────────────────────────────────

test('preflight reports occupied for a cell already covered by a wall', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 }],
  } as Partial<EditorRoomData>);
  const state = baseState(BLOCK_ITEM, room);
  state.cursorBlockX = 5;
  state.cursorBlockY = 5;
  const result = wouldPlacementSucceedAt(state, 5, 5);
  assert.equal(result, 'occupied');
  const status = getPlacementStatus(state, () => wouldPlacementSucceedAt(state, state.cursorBlockX, state.cursorBlockY));
  assert.equal(status.allowed, false);
  assert.equal(status.reason, 'occupied');
});

test('preflight reports occupied for a duplicate challenge totem cell', () => {
  const room = makeRoom({ challengeTotems: [{ uid: 1, xBlock: 3, yBlock: 3 }] } as Partial<EditorRoomData>);
  const state = baseState(TOTEM_ITEM, room);
  assert.equal(wouldPlacementSucceedAt(state, 3, 3), 'occupied');
});

// ── Out of bounds ──────────────────────────────────────────────────────────

test('preflight reports invalid (false) for an out-of-bounds cell', () => {
  const room = makeRoom();
  const state = baseState(BLOCK_ITEM, room);
  const result = wouldPlacementSucceedAt(state, -1, 5);
  assert.equal(result, false);
  const status = getPlacementStatus(state, () => wouldPlacementSucceedAt(state, -1, 5));
  assert.equal(status.allowed, false);
  assert.equal(status.reason, 'invalid-location');
});

test('preflight reports invalid for a rect that would not fit inside the room', () => {
  const room = makeRoom({ widthBlocks: 5, heightBlocks: 5 } as Partial<EditorRoomData>);
  const wideItem: PaletteItem = { id: 'block_4x4', label: 'Big Block', category: 'blocks', defaultWidthBlocks: 4, defaultHeightBlocks: 4 };
  const state = baseState(wideItem, room);
  assert.equal(wouldPlacementSucceedAt(state, 4, 4), false);
});

// ── Singleton / capacity-like dedup ────────────────────────────────────────

test('preflight reports occupied for a duplicate save tomb (singleton-per-cell dedup)', () => {
  const room = makeRoom({ saveTombs: [{ uid: 1, xBlock: 2, yBlock: 2 }] } as Partial<EditorRoomData>);
  const saveTombItem: PaletteItem = { id: 'save_tomb', label: 'Save Tomb', category: 'objects' };
  const state = baseState(saveTombItem, room);
  assert.equal(wouldPlacementSucceedAt(state, 2, 2), 'occupied');
  assert.equal(wouldPlacementSucceedAt(state, 9, 9), true);
});

// ── Valid placement ────────────────────────────────────────────────────────

test('preflight reports allowed for a normal empty-cell block placement', () => {
  const room = makeRoom();
  const state = baseState(BLOCK_ITEM, room);
  assert.equal(wouldPlacementSucceedAt(state, 10, 10), true);
  const status = getPlacementStatus(state, () => wouldPlacementSucceedAt(state, 10, 10));
  assert.equal(status.allowed, true);
  assert.equal(status.reason, null);
});

// ── No side effects ────────────────────────────────────────────────────────

test('preflight never mutates room data or allocates a uid', () => {
  const room = makeRoom();
  const state = baseState(BLOCK_ITEM, room);
  const uidBefore = state.nextUid;
  const wallCountBefore = room.interiorWalls.length;
  const snapshot = JSON.stringify(room);

  wouldPlacementSucceedAt(state, 10, 10);
  wouldPlacementSucceedAt(state, 5, 5);
  wouldPlacementSucceedAt(state, -3, -3);

  assert.equal(state.nextUid, uidBefore, 'preflight must never allocate a uid');
  assert.equal(room.interiorWalls.length, wallCountBefore, 'preflight must never push to room arrays');
  assert.equal(JSON.stringify(room), snapshot, 'preflight must never mutate room data');
});

test('preflight result matches whether placeAtCursor actually places something', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 }],
  } as Partial<EditorRoomData>);
  const state = baseState(BLOCK_ITEM, room);

  // Occupied cell: preflight says no, and placement is a no-op.
  state.cursorBlockX = 5;
  state.cursorBlockY = 5;
  assert.equal(wouldPlacementSucceedAt(state, 5, 5), 'occupied');
  assert.equal(placeAtCursor(state), false);
  assert.equal(room.interiorWalls.length, 1);

  // Empty cell: preflight says yes, and placement actually happens.
  state.cursorBlockX = 8;
  state.cursorBlockY = 8;
  assert.equal(wouldPlacementSucceedAt(state, 8, 8), true);
  assert.equal(placeAtCursor(state), true);
  assert.equal(room.interiorWalls.length, 2);
});
