/**
 * Phase 3.1, Fix 1: operation-level brush preflight.
 *
 * `evaluateBrushOperation` (editorPlaceTool.ts) evaluates the same effective
 * cell set `placeAtCursor` actually touches for the active brush mode, and
 * reports how many of those cells would succeed vs. be blocked. Policy: the
 * whole operation is blocked only when `validCount === 0`; a brush with
 * partial occupancy is allowed (mutation already handles partial success).
 * Layer restrictions block the whole operation regardless of cell validity.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorTool, createEditorState } from '../editor/editorState';
import type { EditorRoomData } from '../editor/editorElementTypes';
import type { PaletteItem } from '../editor/editorPaletteItems';
import { placeAtCursor, evaluateBrushOperation } from '../editor/editorPlaceTool';

function makeRoom(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    id: 'test_room', name: 'Test Room', worldNumber: 1, mapX: 0, mapY: 0,
    blockTheme: 'blackRock', backgroundId: 'cave', lightingEffect: 'DEFAULT', songId: '_continue',
    widthBlocks: 30, heightBlocks: 30, playerSpawnBlock: [28, 28],
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

function baseState(item: PaletteItem | null, room: EditorRoomData) {
  const state = createEditorState();
  state.roomData = room;
  state.activeTool = EditorTool.Place;
  state.selectedPaletteItem = item;
  return state;
}

// ── Partial success across brush modes ────────────────────────────────────

test('3x3 brush: occupied center cell with valid surrounding cells is allowed (partial success)', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 10, yBlock: 10, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 }],
  } as Partial<EditorRoomData>);
  const state = baseState(BLOCK_ITEM, room);
  state.brushMode = '3x3';
  state.cursorBlockX = 10;
  state.cursorBlockY = 10;
  const result = evaluateBrushOperation(state);
  assert.equal(result.validCount, 8);
  assert.equal(result.blockedCount, 1);
  assert.equal(result.reason, null);
});

test('5x5 brush: all cells occupied blocks the entire operation', () => {
  const walls = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      walls.push({ uid: walls.length + 1, xBlock: 10 + dx, yBlock: 10 + dy, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 });
    }
  }
  const room = makeRoom({ interiorWalls: walls } as Partial<EditorRoomData>);
  const state = baseState(BLOCK_ITEM, room);
  state.brushMode = '5x5';
  state.cursorBlockX = 10;
  state.cursorBlockY = 10;
  const result = evaluateBrushOperation(state);
  assert.equal(result.validCount, 0);
  assert.equal(result.blockedCount, 25);
  assert.equal(result.reason, 'occupied');
});

test('rect brush: partial occupancy inside the dragged rect is allowed', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 }],
  } as Partial<EditorRoomData>);
  const state = baseState(BLOCK_ITEM, room);
  state.brushMode = 'rect';
  state.brushRectStartBlockX = 4;
  state.brushRectStartBlockY = 4;
  state.cursorBlockX = 6;
  state.cursorBlockY = 6;
  const result = evaluateBrushOperation(state);
  // 3x3 rect area, one cell occupied.
  assert.equal(result.validCount, 8);
  assert.equal(result.blockedCount, 1);
  assert.equal(result.reason, null);
});

test('rect brush: first click (anchor pending) is always allowed', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 6, yBlock: 6, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 }],
  } as Partial<EditorRoomData>);
  const state = baseState(BLOCK_ITEM, room);
  state.brushMode = 'rect';
  state.brushRectStartBlockX = null;
  state.brushRectStartBlockY = null;
  state.cursorBlockX = 6;
  state.cursorBlockY = 6;
  const result = evaluateBrushOperation(state);
  assert.deepEqual(result, { validCount: 1, blockedCount: 0, reason: null });
});

test('fill brush: partial occupancy within the flood-filled region is allowed', () => {
  // A 3x3 empty pocket with one occupied interior cell — fill should still
  // succeed for the remaining empty cells.
  const walls = [];
  for (let x = 0; x < 30; x++) {
    walls.push({ uid: walls.length + 1, xBlock: x, yBlock: 0, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 });
    walls.push({ uid: walls.length + 1, xBlock: x, yBlock: 4, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 });
  }
  for (let y = 0; y < 5; y++) {
    walls.push({ uid: walls.length + 1, xBlock: 0, yBlock: y, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 });
    walls.push({ uid: walls.length + 1, xBlock: 4, yBlock: y, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 });
  }
  // Interior empty pocket is x:1..3, y:1..3 (9 cells) — occupy one of them.
  walls.push({ uid: walls.length + 1, xBlock: 2, yBlock: 2, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 });
  const room = makeRoom({ interiorWalls: walls } as Partial<EditorRoomData>);
  const state = baseState(BLOCK_ITEM, room);
  state.brushMode = 'fill';
  state.cursorBlockX = 1;
  state.cursorBlockY = 1;
  const result = evaluateBrushOperation(state);
  assert.equal(result.validCount, 8, 'the 8 remaining empty cells of the pocket should be fillable');
  assert.equal(result.blockedCount, 0, 'the occupied cell is never a flood-fill target in the first place');
  assert.equal(result.reason, null);
});

// ── Layer restrictions block the entire operation ─────────────────────────

test('locked layer blocks the entire brush operation regardless of cell validity', () => {
  const room = makeRoom();
  const state = baseState(BLOCK_ITEM, room);
  state.brushMode = '3x3';
  state.cursorBlockX = 10;
  state.cursorBlockY = 10;
  state.layers.terrain.locked = true;
  const result = evaluateBrushOperation(state);
  assert.equal(result.validCount, 0);
  assert.equal(result.blockedCount, 0);
  assert.equal(result.reason, 'locked');
});

test('hidden layer blocks the entire brush operation', () => {
  const room = makeRoom();
  const state = baseState(BLOCK_ITEM, room);
  state.brushMode = 'single';
  state.cursorBlockX = 10;
  state.cursorBlockY = 10;
  state.layers.terrain.visible = false;
  const result = evaluateBrushOperation(state);
  assert.equal(result.validCount, 0);
  assert.equal(result.reason, 'hidden');
});

// ── Preview/mutation parity ────────────────────────────────────────────────

test('preflight validCount>0 matches placeAtCursor actually placing something', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 10, yBlock: 10, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 }],
  } as Partial<EditorRoomData>);
  const state = baseState(BLOCK_ITEM, room);
  state.brushMode = '3x3';
  state.cursorBlockX = 10;
  state.cursorBlockY = 10;

  const preflight = evaluateBrushOperation(state);
  assert.ok(preflight.validCount > 0);

  const wallCountBefore = room.interiorWalls.length;
  const placed = placeAtCursor(state);
  assert.equal(placed, true);
  assert.equal(room.interiorWalls.length, wallCountBefore + preflight.validCount);
});

test('preflight never mutates room data or allocates a uid', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 10, yBlock: 10, wBlock: 1, hBlock: 1, isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0 }],
  } as Partial<EditorRoomData>);
  const state = baseState(BLOCK_ITEM, room);
  state.brushMode = '3x3';
  state.cursorBlockX = 10;
  state.cursorBlockY = 10;
  const uidBefore = state.nextUid;
  const wallCountBefore = room.interiorWalls.length;
  const snapshot = JSON.stringify(room);

  evaluateBrushOperation(state);

  assert.equal(state.nextUid, uidBefore);
  assert.equal(room.interiorWalls.length, wallCountBefore);
  assert.equal(JSON.stringify(room), snapshot);
});
