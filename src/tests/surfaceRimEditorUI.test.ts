/**
 * surfaceRimEditorUI.test.ts — Coverage for the Surface Rim inspector wiring:
 * single/multi-selection property changes, undo/redo, and copy/paste.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EditorRoomData, EditorWall } from '../editor/editorElementTypes';
import { handlePropertyChange, applyPropertyToElement } from '../editor/editorPropertyChange';
import { createEditorHistory, undo, redo } from '../editor/editorHistory';
import { serializeSelectedElements, pasteFromClipboard } from '../editor/editorDragCopyPaste';
import { createEditorState } from '../editor/editorState';
import { normalizeSurfaceRimStyle, surfaceRimStylesEqual, DEFAULT_SURFACE_RIM_STYLE } from '../render/walls/surfaceRimStyle';

function makeWall(uid: number, overrides: Partial<EditorWall> = {}): EditorWall {
  return {
    uid, xBlock: uid, yBlock: 0, wBlock: 1, hBlock: 1,
    isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0,
    ...overrides,
  } as EditorWall;
}

function makeRoom(walls: EditorWall[]): EditorRoomData {
  return {
    id: 'r', name: 'r', worldNumber: 1, mapX: 0, mapY: 0,
    blockTheme: 'blackRock', backgroundId: 'cave', lightingEffect: 'DEFAULT', songId: '_continue',
    widthBlocks: 20, heightBlocks: 20, playerSpawnBlock: [0, 0],
    interiorWalls: walls, enemies: [], transitions: [], saveTombs: [], skillTombs: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [], lambdaAnchors: [],
    dustPiles: [], grasshopperAreas: [], fireflyAreas: [], decorations: [],
    ambientLightBlockers: [], lightSources: [], backgroundBlocks: [],
  } as unknown as EditorRoomData;
}

// ── applyPropertyToElement: single wall ────────────────────────────────────────

test('applyPropertyToElement: setting wall.surfaceRim.mode creates a normalized style from scratch', () => {
  const wall = makeWall(0);
  const room = makeRoom([wall]);
  applyPropertyToElement(room, { type: 'wall', uid: 0 }, 'wall.surfaceRim.mode', 'solid');
  assert.equal(wall.surfaceRim?.mode, 'solid');
  assert.equal(wall.surfaceRim?.color, DEFAULT_SURFACE_RIM_STYLE.color);
});

test('applyPropertyToElement: setting fields back to the exact default clears surfaceRim to undefined', () => {
  const wall = makeWall(0, { surfaceRim: normalizeSurfaceRimStyle({ mode: 'solid' }) });
  const room = makeRoom([wall]);
  applyPropertyToElement(room, { type: 'wall', uid: 0 }, 'wall.surfaceRim.mode', 'default');
  assert.equal(wall.surfaceRim, undefined, 'reverting to default must clear the override, not store an explicit default object');
});

test('applyPropertyToElement: color/width/opacity/falloff/interiorDarkness all apply independently', () => {
  const wall = makeWall(0);
  const room = makeRoom([wall]);
  applyPropertyToElement(room, { type: 'wall', uid: 0 }, 'wall.surfaceRim.mode', 'inverted');
  applyPropertyToElement(room, { type: 'wall', uid: 0 }, 'wall.surfaceRim.color', 'ff7a18');
  applyPropertyToElement(room, { type: 'wall', uid: 0 }, 'wall.surfaceRim.widthPx', 5);
  applyPropertyToElement(room, { type: 'wall', uid: 0 }, 'wall.surfaceRim.opacity', 0.4);
  applyPropertyToElement(room, { type: 'wall', uid: 0 }, 'wall.surfaceRim.falloff', 'smooth');
  applyPropertyToElement(room, { type: 'wall', uid: 0 }, 'wall.surfaceRim.interiorDarkness', 0.75);
  assert.deepEqual(wall.surfaceRim, normalizeSurfaceRimStyle({
    mode: 'inverted', color: 'ff7a18', widthPx: 5, opacity: 0.4, falloff: 'smooth', interiorDarkness: 0.75,
  }));
});

// ── handlePropertyChange: multi-selection fan-out + undo/redo ─────────────────

test('handlePropertyChange: editing one control applies to every selected wall (multi-selection fan-out)', () => {
  const wallA = makeWall(0, { surfaceRim: normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff0000' }) });
  const wallB = makeWall(1, { surfaceRim: normalizeSurfaceRimStyle({ mode: 'gradient', color: '00ff00' }) });
  const room = makeRoom([wallA, wallB]);
  const history = createEditorHistory();

  // Before the edit, the two walls have different styles (a "mixed" state the inspector would show).
  assert.ok(!surfaceRimStylesEqual(wallA.surfaceRim!, wallB.surfaceRim!));

  const state = { ...createEditorState(), roomData: room, selectedElements: [{ type: 'wall', uid: 0 }, { type: 'wall', uid: 1 }] } as const;
  handlePropertyChange(state, history, 'wall.surfaceRim.color', 'abcdef');

  assert.equal(wallA.surfaceRim?.color, 'abcdef');
  assert.equal(wallB.surfaceRim?.color, 'abcdef');
  // Modes are untouched by a color-only edit — proves per-field patching, not a full overwrite.
  assert.equal(wallA.surfaceRim?.mode, 'solid');
  assert.equal(wallB.surfaceRim?.mode, 'gradient');
});

test('undo/redo: a Surface Rim edit round-trips cleanly through the editor history stack', () => {
  const wall = makeWall(0, { surfaceRim: normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff0000', widthPx: 3, opacity: 0.5 }) });
  let room = makeRoom([wall]);
  const history = createEditorHistory();

  const before = structuredClone(wall.surfaceRim);
  const state = { ...createEditorState(), roomData: room, selectedElements: [{ type: 'wall', uid: 0 }] } as const;
  handlePropertyChange(state, history, 'wall.surfaceRim.color', '00ff00');
  assert.equal(room.interiorWalls[0].surfaceRim?.color, '00ff00');

  const undone = undo(history, room);
  assert.ok(undone);
  room = undone!.roomData;
  assert.deepEqual(room.interiorWalls[0].surfaceRim, before, 'undo must restore the pre-edit style exactly');

  const redone = redo(history, room);
  assert.ok(redone);
  room = redone!.roomData;
  assert.equal(room.interiorWalls[0].surfaceRim?.color, '00ff00', 'redo must reapply the edit');
});

// ── Copy/paste ──────────────────────────────────────────────────────────────

test('copy/paste: a pasted wall carries its Surface Rim style', () => {
  const style = normalizeSurfaceRimStyle({ mode: 'inverted', color: 'd24cff', widthPx: 5, opacity: 0.7, falloff: 'smooth', interiorDarkness: 0.9 });
  const wall = makeWall(0, { surfaceRim: style });
  const room = makeRoom([wall]);
  const state = createEditorState();
  state.roomData = room;
  state.selectedElements = [{ type: 'wall', uid: 0 }];
  state.cursorBlockX = 10;
  state.cursorBlockY = 10;

  state.clipboard = serializeSelectedElements(room, state.selectedElements);
  pasteFromClipboard(state);

  const pastedUid = state.selectedElements[0].uid;
  const pasted = room.interiorWalls.find(w => w.uid === pastedUid);
  assert.ok(pasted, 'paste must insert a new wall');
  assert.notEqual(pasted!.uid, wall.uid, 'pasted wall must get a fresh uid');
  assert.ok(surfaceRimStylesEqual(pasted!.surfaceRim!, style), 'pasted wall must carry the same Surface Rim style');
});
