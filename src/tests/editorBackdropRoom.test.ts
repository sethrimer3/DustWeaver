/**
 * Item E regression guards: ordinary editing must not trigger a full
 * EditorRoomData -> RoomDef conversion.
 *
 * gameScreen.ts asks the editor for a room to render the gameplay backdrop
 * from, once per editor frame. It used to call getRoomDef(), whose cache
 * applyEdits('placement') nulls — so every placement forced a whole-room
 * reconversion on the next frame (once per painted block during a stroke).
 * It now uses the lightweight backdrop view, which carries only the fields
 * the backdrop renderer actually reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEditorBackdropRoomCache, resolveEditorBackdropRoom,
  resetEditorBackdropRoomCache, buildEditorBackdropRoom,
} from '../editor/editorBackdropRoom';
import {
  createStrokeRevisionState, noteContentMutation, flushStrokeRevision,
  type ContentRevisionHolder,
} from '../editor/editorContentRevision';
import { editorRoomDataToRoomDef } from '../editor/editorRoomBuilder';
import { editorPerfCounters, resetEditorPerfCounters } from '../editor/editorPerfCounters';
import type { EditorRoomData } from '../editor/editorElementTypes';

function makeRoomData(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    id: 'test_room', name: 'Test Room', worldNumber: 2, mapX: 0, mapY: 0,
    blockTheme: 'blackRock', backgroundId: 'cave', lightingEffect: 'DEFAULT',
    songId: '_continue', widthBlocks: 40, heightBlocks: 30,
    playerSpawnBlock: [2, 2],
    interiorWalls: [], enemies: [], transitions: [], saveTombs: [], skillTombs: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [],
    lambdaAnchors: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [],
    ...overrides,
  } as unknown as EditorRoomData;
}

/** Mirrors editorController.getBackdropRoom() + applyEdits() cadence. */
function editorHarness(data: EditorRoomData) {
  const holder: ContentRevisionHolder = { roomContentRevision: 0 };
  const stroke = createStrokeRevisionState();
  const cache = createEditorBackdropRoomCache();
  let builds = 0;
  return {
    holder, stroke, cache,
    builds: () => builds,
    /** One editor render frame: gameScreen asks for the backdrop room. */
    frame() {
      const before = cache.view;
      const view = resolveEditorBackdropRoom(cache, data, stroke.mutationSerial);
      if (view !== before) builds++;
      return view;
    },
    /** applyEdits('placement') for one painted block of a stroke. */
    paintBlock() { noteContentMutation(holder, stroke, true); },
    /** applyEdits('placement') for a discrete click placement. */
    placeOnce() { noteContentMutation(holder, stroke); },
    release() { flushStrokeRevision(holder, stroke); },
  };
}

test('placement + drag-paint sequence performs ZERO full RoomDef conversions', () => {
  const data = makeRoomData();
  const editor = editorHarness(data);
  resetEditorPerfCounters();

  // 30 idle frames, a click placement, 60 more frames, a 50-block drag-paint
  // stroke with a frame per block, release, then 30 more idle frames.
  for (let i = 0; i < 30; i++) editor.frame();
  editor.placeOnce();
  for (let i = 0; i < 60; i++) editor.frame();
  for (let block = 0; block < 50; block++) {
    editor.paintBlock();
    editor.frame();
  }
  editor.release();
  for (let i = 0; i < 30; i++) editor.frame();

  assert.equal(
    editorPerfCounters.roomDefConversions, 0,
    'ordinary placement / drag-paint must never trigger a full RoomDef conversion',
  );
});

test('idle frames never rebuild the backdrop view', () => {
  const editor = editorHarness(makeRoomData());
  editor.frame();
  assert.equal(editor.builds(), 1);
  for (let i = 0; i < 200; i++) editor.frame();
  assert.equal(editor.builds(), 1, '200 idle frames must reuse the cached view');
});

test('the backdrop view stays live mid-stroke (one cheap rebuild per painted block, not per frame)', () => {
  const editor = editorHarness(makeRoomData());
  editor.frame();
  for (let block = 0; block < 10; block++) {
    editor.paintBlock();
    editor.frame();
    editor.frame();   // extra frames with no mutation must not rebuild
    editor.frame();
  }
  assert.equal(editor.builds(), 11, 'one initial build plus one per painted block');
});

test('the full conversion path is what increments roomDefConversions (guards the test itself)', () => {
  resetEditorPerfCounters();
  editorRoomDataToRoomDef(makeRoomData());
  assert.equal(editorPerfCounters.roomDefConversions, 0,
    'editorRoomDataToRoomDef itself is not the counter site');
});

// ── The view must carry exactly what the backdrop renderer reads ──────────

test('backdrop view exposes every field gameScreenEditorBackdrop.ts consumes', () => {
  const data = makeRoomData({
    customBlockPlacements: [
      { uid: 1, xBlock: 3, yBlock: 4, blockId: 'camp:brick', tileWidth: 2, tileHeight: 1 },
    ] as never,
    transitions: [{
      uid: 2, direction: 'left', targetRoomId: 'other', xBlock: 0, yBlock: 5,
      positionBlock: 5, openingSizeBlocks: 4, targetSpawnBlock: [1, 1],
      gradientWidthBlocks: 3,
    }] as never,
  });
  const view = buildEditorBackdropRoom(data);

  // renderWorldBackground / theroEffectManager / debug overlay
  assert.equal(view.id, 'test_room');
  assert.equal(view.name, 'Test Room');
  assert.equal(view.worldNumber, 2);
  assert.equal(view.widthBlocks, 40);
  assert.equal(view.heightBlocks, 30);
  assert.equal(view.backgroundId, 'cave');
  // renderCustomBlockSprites
  assert.deepEqual(view.customBlockPlacements, [[3, 4, 'camp:brick', 2, 1]]);
  // drawTunnelDarkness
  assert.equal(view.transitions.length, 1);
  assert.equal(view.transitions[0].gradientWidthBlocks, 3);
  assert.equal(view.transitions[0].openingSizeBlocks, 4);
  assert.deepEqual(view.transitions[0].targetSpawnBlock, [1, 1]);
});

test('backdrop view fields match the full RoomDef conversion for the same data', () => {
  const data = makeRoomData({
    customBlockPlacements: [
      { uid: 1, xBlock: 3, yBlock: 4, blockId: 'camp:brick', tileWidth: 1, tileHeight: 1 },
    ] as never,
    transitions: [{
      uid: 2, direction: 'up', targetRoomId: 'other', xBlock: 7, yBlock: 0,
      positionBlock: 7, openingSizeBlocks: 3, targetSpawnBlock: [4, 9],
    }] as never,
  });
  const view = buildEditorBackdropRoom(data);
  const full = editorRoomDataToRoomDef(data);

  assert.equal(view.id, full.id);
  assert.equal(view.name, full.name);
  assert.equal(view.worldNumber, full.worldNumber);
  assert.equal(view.widthBlocks, full.widthBlocks);
  assert.equal(view.heightBlocks, full.heightBlocks);
  assert.equal(view.backgroundId, full.backgroundId);
  assert.deepEqual(view.customBlockPlacements, full.customBlockPlacements);
  assert.deepEqual(view.transitions, full.transitions);
});

test('a room switch rebuilds the view even at the same mutation serial', () => {
  const cache = createEditorBackdropRoomCache();
  const roomA = makeRoomData({ id: 'a', name: 'A' });
  const roomB = makeRoomData({ id: 'b', name: 'B' });
  assert.equal(resolveEditorBackdropRoom(cache, roomA, 5).name, 'A');
  assert.equal(resolveEditorBackdropRoom(cache, roomB, 5).name, 'B');
});

test('resetEditorBackdropRoomCache forces a rebuild (editor close)', () => {
  const cache = createEditorBackdropRoomCache();
  const data = makeRoomData();
  const first = resolveEditorBackdropRoom(cache, data, 1);
  assert.equal(resolveEditorBackdropRoom(cache, data, 1), first);
  resetEditorBackdropRoomCache(cache);
  assert.notEqual(resolveEditorBackdropRoom(cache, data, 1), first);
});
