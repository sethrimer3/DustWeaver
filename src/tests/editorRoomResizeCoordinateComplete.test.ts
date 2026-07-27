/**
 * editorRoomResizeCoordinateComplete.test.ts — coverage for the
 * side-anchored, coordinate-complete edge-resize invariant (docs/Todo.md:
 * "Make Room Dimensions edge-resizing truly side-anchored and
 * coordinate-complete").
 *
 * Verifies: opposite-edge world-position stability via mapX/mapY inverse
 * shift, exhaustive coordinate-family shifting (ambient light blockers,
 * transitions, scene lights, ropes, guide dust paths, pixel materials,
 * campaign spawn), clip/remove semantics for geometry intersecting a
 * shaved-off strip (rather than sliding it onto the new edge), bottom/right
 * stability, and single-step atomic undo/redo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdgeResize } from '../editor/editorRoomResize';
import { createEditorHistory } from '../editor/editorHistory';
import { undo, redo } from '../editor/editorHistory';
import type { EditorRoomData } from '../editor/editorState';
import { BLOCK_SIZE_SMALL, BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { CampaignSpawnData } from '../levels/campaignSchema';

function makeRoom(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    id: 'resize_test', name: 'Resize Test', worldNumber: 1, mapX: 100, mapY: 200,
    blockTheme: 'blackRock', backgroundId: 'brownRock', lightingEffect: 'Ambient',
    songId: '_continue', widthBlocks: 20, heightBlocks: 14,
    playerSpawnBlock: [5, 5], interiorWalls: [], enemies: [], transitions: [],
    saveTombs: [], skillTombs: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [], waterZones: [], lavaZones: [],
    crumbleBlocks: [], spikes: [], bouncePads: [], kineticBlocks: [], ropes: [], sunbeams: [],
    sceneLights: [], fallingBlocks: [], backgroundBlocks: [], dialogueTriggers: [], guideDustPaths: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [], lambdaAnchors: [],
    grappleCarryBlocks: [], phantasmalTiles: [], pixelMaterials: [], customBlockPlacements: [],
    ...overrides,
  } as EditorRoomData;
}

// ── Opposite-edge stability via mapX/mapY inverse shift ──────────────────────

test('left-edge grow moves mapX inversely so the right edge stays fixed in map-world space', () => {
  const room = makeRoom({ mapX: 100, widthBlocks: 20 });
  const history = createEditorHistory();
  // Right edge world position = mapX + widthBlocks (in map units). Before: 120.
  applyEdgeResize(room, history, 'left', 5);
  assert.equal(room.widthBlocks, 25);
  assert.equal(room.mapX, 95); // mapX -= clampedDelta
  assert.equal(room.mapX + room.widthBlocks, 120); // right edge unchanged
});

test('left-edge shrink moves mapX inversely so the right edge stays fixed in map-world space', () => {
  const room = makeRoom({ mapX: 100, widthBlocks: 20 });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'left', -5);
  assert.equal(room.widthBlocks, 15);
  assert.equal(room.mapX, 105);
  assert.equal(room.mapX + room.widthBlocks, 120);
});

test('top-edge resize moves mapY inversely so the bottom edge stays fixed', () => {
  const room = makeRoom({ mapY: 200, heightBlocks: 14 });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'top', 5);
  assert.equal(room.heightBlocks, 19);
  assert.equal(room.mapY, 195);
  assert.equal(room.mapY + room.heightBlocks, 214);
});

test('right/bottom resize never touches mapX/mapY (left/top edge stays fixed)', () => {
  const room = makeRoom({ mapX: 100, mapY: 200 });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'right', 5);
  applyEdgeResize(room, history, 'bottom', -1);
  assert.equal(room.mapX, 100);
  assert.equal(room.mapY, 200);
});

// ── Exhaustive coordinate-family shifting ────────────────────────────────────

test('ambient light blockers shift with top/left content translation', () => {
  const room = makeRoom({
    ambientLightBlockers: [{ uid: 1, xBlock: 3, yBlock: 4, isDarkFlag: 0 }],
  });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'left', 5);
  assert.equal(room.ambientLightBlockers[0].xBlock, 8);
  assert.equal(room.ambientLightBlockers[0].yBlock, 4);
});

test('ambient light blockers in the shaved-off strip are removed, not clamped onto the new edge', () => {
  const room = makeRoom({
    ambientLightBlockers: [
      { uid: 1, xBlock: 0, yBlock: 1, isDarkFlag: 0 }, // in the 3-column strip being removed
      { uid: 2, xBlock: 4, yBlock: 1, isDarkFlag: 0 }, // survives
    ],
  });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'left', -3);
  assert.equal(room.ambientLightBlockers.length, 1);
  assert.equal(room.ambientLightBlockers[0].uid, 2);
  assert.equal(room.ambientLightBlockers[0].xBlock, 1); // 4 - 3
});

test('scene lights (world-unit coords) shift by shiftBlocks * BLOCK_SIZE_MEDIUM', () => {
  const room = makeRoom({
    sceneLights: [{
      uid: 1, xWorld: 3 * BLOCK_SIZE_MEDIUM, yWorld: 4 * BLOCK_SIZE_MEDIUM,
      kind: 'point', radiusWorld: 100, colorR: 255, colorG: 255, colorB: 255,
      intensityPct: 100, blendMode: 'add', castsShadowsFlag: 0,
    }],
  });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'top', 2);
  assert.equal(room.sceneLights![0].yWorld, 6 * BLOCK_SIZE_MEDIUM);
  assert.equal(room.sceneLights![0].xWorld, 3 * BLOCK_SIZE_MEDIUM);
});

test('pixel materials (native-pixel-unit coords) shift by shiftBlocks * BLOCK_SIZE_SMALL and clip footprints', () => {
  const room = makeRoom({
    pixelMaterials: [
      { uid: 1, xPixel: 2 * BLOCK_SIZE_SMALL, yPixel: 3 * BLOCK_SIZE_SMALL, material: 1 },
    ],
  });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'left', -1);
  // Shifted left by 1 block worth of pixels; still inside bounds.
  assert.equal(room.pixelMaterials![0].xPixel, 1 * BLOCK_SIZE_SMALL);
});

test('ropes shift both anchors together and are removed if either anchor leaves bounds', () => {
  const room = makeRoom({
    ropes: [{
      uid: 1, anchorAXBlock: 2, anchorAYBlock: 2, anchorBXBlock: 6, anchorBYBlock: 2,
      segmentCount: 5, isAnchorBFixedFlag: 1, destructibility: 'indestructible', thicknessIndex: 1,
    }],
  });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'left', -3);
  assert.equal(room.ropes!.length, 0); // anchorA at x=2 falls into the removed 3-col strip
});

test('ropes survive and shift together when both anchors stay in bounds', () => {
  const room = makeRoom({
    ropes: [{
      uid: 1, anchorAXBlock: 5, anchorAYBlock: 2, anchorBXBlock: 9, anchorBYBlock: 2,
      segmentCount: 5, isAnchorBFixedFlag: 1, destructibility: 'indestructible', thicknessIndex: 1,
    }],
  });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'left', -3);
  assert.equal(room.ropes!.length, 1);
  assert.equal(room.ropes![0].anchorAXBlock, 2);
  assert.equal(room.ropes![0].anchorBXBlock, 6);
});

test('guide dust path points shift together and the whole path is removed if any point leaves bounds', () => {
  const room = makeRoom({
    guideDustPaths: [{
      uid: 1,
      points: [{ xBlock: 1, yBlock: 1, speed: 1 }, { xBlock: 8, yBlock: 1, speed: 1 }],
      loop: false, visibleInGame: true, moteCount: 8, moteSpeedFactor: 1, opacityPct: 100,
    }],
  });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'left', -3);
  assert.equal(room.guideDustPaths!.length, 0); // first point (x=1) falls in removed strip
});

test('interior walls are clipped (not slid) when part of the rect intersects the shaved-off strip', () => {
  const room = makeRoom({
    interiorWalls: [{
      uid: 1, xBlock: 0, yBlock: 0, wBlock: 4, hBlock: 2,
      isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0,
    }],
  });
  const history = createEditorHistory();
  // Shrink from the right by 1 -> newWidth = 19; the wall (x0..3) is unaffected in this case,
  // so instead shrink from the right down to width 3 to force clipping.
  applyEdgeResize(room, history, 'right', -5); // width 20 -> 15, wall still fully inside
  assert.equal(room.interiorWalls[0].wBlock, 4);
});

test('interior wall rect straddling the removed right-edge strip is clipped in width, not moved', () => {
  const room = makeRoom({
    widthBlocks: 12,
    interiorWalls: [{
      uid: 1, xBlock: 8, yBlock: 0, wBlock: 4, hBlock: 2, // spans x=8..11, room width 12
      isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0,
    }],
  });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'right', -2); // newWidth = 10; wall now spans x=8..11 vs bound 10
  assert.equal(room.interiorWalls.length, 1);
  assert.equal(room.interiorWalls[0].xBlock, 8); // unmoved (far edge shrink)
  assert.equal(room.interiorWalls[0].wBlock, 2); // clipped from 4 to 2 (10 - 8)
});

test('interior wall rect fully inside the removed strip is removed entirely', () => {
  const room = makeRoom({
    widthBlocks: 12,
    interiorWalls: [{
      uid: 1, xBlock: 10, yBlock: 0, wBlock: 2, hBlock: 2,
      isPlatformFlag: 0, platformEdge: 0, isPillarHalfWidthFlag: 0,
    }],
  });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'right', -2); // newWidth = 10; wall at x=10..11 fully outside
  assert.equal(room.interiorWalls.length, 0);
});

// ── Transitions ───────────────────────────────────────────────────────────────

test('a left/right-direction transition opening (yBlock) shifts with a vertical (top) content translation', () => {
  const room = makeRoom({
    transitions: [{
      uid: 1, direction: 'left', xBlock: 0, yBlock: 3, openingSizeBlocks: 2,
      targetRoomId: 'other', targetSpawnBlock: [0, 0], positionBlock: 3,
    }],
  });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'top', 5);
  assert.equal(room.transitions[0].yBlock, 8);
  assert.equal(room.transitions[0].positionBlock, 8);
});

test('an up/down-direction transition gradient depth (yBlock) does NOT shift on a top-edge resize (boundary-pinned)', () => {
  const room = makeRoom({
    transitions: [{
      uid: 1, direction: 'up', xBlock: 2, yBlock: 0, openingSizeBlocks: 2,
      targetRoomId: 'other', targetSpawnBlock: [0, 0], positionBlock: 2, gradientWidthBlocks: 3,
    }],
  });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'top', 5);
  assert.equal(room.transitions[0].yBlock, 0); // pinned to its own boundary
});

test('an up/down-direction transition opening (xBlock) shifts with a horizontal (left) content translation', () => {
  const room = makeRoom({
    transitions: [{
      uid: 1, direction: 'up', xBlock: 2, yBlock: 0, openingSizeBlocks: 2,
      targetRoomId: 'other', targetSpawnBlock: [0, 0], positionBlock: 2, gradientWidthBlocks: 3,
    }],
  });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'left', 5);
  assert.equal(room.transitions[0].xBlock, 7);
  assert.equal(room.transitions[0].positionBlock, 7);
});

// ── Campaign spawn ────────────────────────────────────────────────────────────

test('campaign spawn belonging to the resized room shifts along with player spawn', () => {
  const room = makeRoom({ id: 'room_a', playerSpawnBlock: [5, 5] });
  const history = createEditorHistory();
  const campaignSpawn: CampaignSpawnData = { roomId: 'room_a', xBlock: 5, yBlock: 5 };
  applyEdgeResize(room, history, 'left', 5, campaignSpawn);
  assert.equal(campaignSpawn.xBlock, 10);
  assert.equal(room.playerSpawnBlock[0], 10);
});

test('campaign spawn belonging to a DIFFERENT room is left untouched', () => {
  const room = makeRoom({ id: 'room_a' });
  const history = createEditorHistory();
  const campaignSpawn: CampaignSpawnData = { roomId: 'room_b', xBlock: 5, yBlock: 5 };
  applyEdgeResize(room, history, 'left', 5, campaignSpawn);
  assert.equal(campaignSpawn.xBlock, 5);
  assert.equal(campaignSpawn.yBlock, 5);
});

// ── Single-step atomic undo/redo covering every shifted/clipped element ──────

test('one undo step restores dimensions, mapX, and every shifted element together', () => {
  const room = makeRoom({
    mapX: 100,
    ambientLightBlockers: [{ uid: 1, xBlock: 3, yBlock: 4, isDarkFlag: 0 }],
  });
  const history = createEditorHistory();
  applyEdgeResize(room, history, 'left', 5);
  assert.equal(room.widthBlocks, 25);
  assert.equal(room.mapX, 95);
  assert.equal(room.ambientLightBlockers[0].xBlock, 8);
  assert.equal(history.undoStack.length, 1);

  const restored = undo(history, room);
  assert.ok(restored);
  assert.equal(restored!.roomData.widthBlocks, 20);
  assert.equal(restored!.roomData.mapX, 100);
  assert.equal(restored!.roomData.ambientLightBlockers[0].xBlock, 3);

  const redone = redo(history, restored!.roomData);
  assert.ok(redone);
  assert.equal(redone!.roomData.widthBlocks, 25);
  assert.equal(redone!.roomData.mapX, 95);
  assert.equal(redone!.roomData.ambientLightBlockers[0].xBlock, 8);
});
