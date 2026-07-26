import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState, EditorTool } from '../editor/editorState';
import type { EditorRoomData, EditorWall } from '../editor/editorElementTypes';
import { resolveHoverAtCursor, resetHoverResolutionCache } from '../editor/editorTools';
import { editorPerfCounters, resetEditorPerfCounters } from '../editor/editorPerfCounters';
import { getEditorWallTopology, resetEditorWallTopologyCache, isElementInViewport, type EditorViewport } from '../editor/editorRendererHelpers';
import { drawEditorWalls } from '../editor/editorOverlayDrawers';

function makeWall(uid: number, overrides: Partial<EditorWall> = {}): EditorWall {
  return {
    uid, xBlock: uid * 5, yBlock: 0, wBlock: 1, hBlock: 1,
    isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0,
    ...overrides,
  } as EditorWall;
}

function makeRoom(walls: EditorWall[] = []): EditorRoomData {
  return {
    id: 'test-room', name: 'Test Room', worldNumber: 1, mapX: 0, mapY: 0,
    blockTheme: 'blackRock', backgroundId: 'cave', lightingEffect: 'DEFAULT', songId: '_continue',
    widthBlocks: 50, heightBlocks: 30, playerSpawnBlock: [0, 0],
    interiorWalls: walls, enemies: [], transitions: [], saveTombs: [], skillTombs: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [], lambdaAnchors: [],
    dustPiles: [], grasshopperAreas: [], fireflyAreas: [], decorations: [],
    ambientLightBlockers: [], lightSources: [], backgroundBlocks: [],
  } as unknown as EditorRoomData;
}

function makeDummyCtx(): CanvasRenderingContext2D {
  const props: Record<string, unknown> = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalCompositeOperation: 'source-over',
  };
  return new Proxy(props, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

test('resolveHoverAtCursor: change gating avoids redundant hover scans on static frames', () => {
  resetEditorPerfCounters();
  resetHoverResolutionCache();

  const room = makeRoom([makeWall(1, { xBlock: 5, yBlock: 5 })]);
  const state = createEditorState();
  state.roomData = room;
  state.activeTool = EditorTool.Select;
  state.cursorBlockX = 5;
  state.cursorBlockY = 5;

  // Initial call performs a scan.
  const el1 = resolveHoverAtCursor(state, 1);
  assert.equal(el1?.type, 'wall');
  assert.equal(el1?.uid, 1);
  assert.equal(editorPerfCounters.hoverScans, 1);

  // Second call with identical cursor, room, mutationSerial, and layers must not scan again.
  const el2 = resolveHoverAtCursor(state, 1);
  assert.equal(el2, el1);
  assert.equal(editorPerfCounters.hoverScans, 1, 'static idle frame must reuse cached hover result');

  // Moving the cursor must trigger a scan.
  state.cursorBlockX = 6;
  const el3 = resolveHoverAtCursor(state, 1);
  assert.equal(el3, null);
  assert.equal(editorPerfCounters.hoverScans, 2, 'moving cursor invalidates hover cache');

  // Changing mutationSerial must trigger a scan even at same cursor position.
  resolveHoverAtCursor(state, 2);
  assert.equal(editorPerfCounters.hoverScans, 3, 'mutationSerial bump invalidates hover cache');

  // Changing layer selectability (e.g. locking terrain layer) must trigger a scan.
  state.layers['terrain'].locked = true;
  resolveHoverAtCursor(state, 2);
  assert.equal(editorPerfCounters.hoverScans, 4, 'layer state change invalidates hover cache');
});

test('getEditorWallTopology: caches wall topology by room and mutationSerial', () => {
  resetEditorPerfCounters();
  resetEditorWallTopologyCache();

  const room = makeRoom([makeWall(1, { xBlock: 0, yBlock: 0, wBlock: 2, hBlock: 2 })]);

  const top1 = getEditorWallTopology(room, 10);
  assert.equal(editorPerfCounters.wallTopologyRebuilds, 1);
  assert.equal(top1.occupied.has('0,0'), true);
  assert.equal(top1.occupied.has('1,1'), true);

  // Calling again with same mutationSerial should serve from cache.
  const top2 = getEditorWallTopology(room, 10);
  assert.equal(top2, top1);
  assert.equal(editorPerfCounters.wallTopologyRebuilds, 1);

  // Calling with new mutationSerial should rebuild.
  getEditorWallTopology(room, 11);
  assert.equal(editorPerfCounters.wallTopologyRebuilds, 2);
});

test('isElementInViewport and overlay culling: off-screen elements are skipped in draw passes', () => {
  resetEditorPerfCounters();
  resetEditorWallTopologyCache();

  // Create two walls: one inside viewport [0, 0, 10, 10], one outside [100, 100, 1, 1].
  const wallIn = makeWall(1, { xBlock: 2, yBlock: 2, wBlock: 2, hBlock: 2 });
  const wallOut = makeWall(2, { xBlock: 100, yBlock: 100, wBlock: 2, hBlock: 2 });
  const room = makeRoom([wallIn, wallOut]);

  const viewport: EditorViewport = {
    minCol: 0, maxCol: 10,
    minRow: 0, maxRow: 10,
    canvasWidth: 800, canvasHeight: 600,
  };

  assert.equal(isElementInViewport(viewport, 2, 2, 2, 2), true);
  assert.equal(isElementInViewport(viewport, 100, 100, 2, 2), false);

  const ctx = makeDummyCtx();
  const state = createEditorState();
  state.roomData = room;

  drawEditorWalls(ctx, room, () => false, 0, 0, 1, viewport, 100);

  // Both walls are visited in the loop, but only wallIn should be drawn after culling.
  assert.equal(editorPerfCounters.overlayElementsVisited, 2);
  assert.equal(editorPerfCounters.overlayElementsDrawn, 1);
});
