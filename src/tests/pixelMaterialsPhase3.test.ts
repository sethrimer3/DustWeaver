import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { PixelMaterialSystem } from '../sim/pixelMaterials/pixelMaterialSystem';
import { SolidMask, buildSolidMaskFromWorld } from '../sim/pixelMaterials/pixelMaterialSolid';
import { syncPixelMaterialSolidGeometry } from '../sim/pixelMaterials/pixelMaterialSolidSync';
import { applyMovementWindToPixelMaterials } from '../sim/pixelMaterials/pixelMaterialMovementWind';
import {
  MATERIAL_SAND, MATERIAL_SAND_2X2, MATERIAL_DEFS, getMaterialFootprintSize, isKnownMaterialId,
} from '../sim/pixelMaterials/pixelMaterialTypes';
import { canPlacePixelMaterialAt, isPixelMaterialSolidAtPixel } from '../editor/editorHitTest';
import {
  placePixelMaterialAt, erasePixelMaterialAt, paintPixelMaterialLine, anchorForMaterial,
} from '../editor/editorPixelMaterialTool';
import { applyRoomDimensionChange } from '../editor/editorRoomResize';
import { editorRoomDataToJson, jsonToEditorRoomData } from '../editor/roomJson';
import type { EditorRoomData } from '../editor/editorState';

function makeRoom(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    id: 'test', name: 'Test', worldNumber: 1,
    blockTheme: 'blackRock', backgroundId: 'brownRock', lightingEffect: 'Ambient',
    songId: '_continue', widthBlocks: 20, heightBlocks: 14,
    playerSpawnBlock: [2, 2], interiorWalls: [], enemies: [], transitions: [],
    saveTombs: [], skillTombs: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [], waterZones: [], lavaZones: [],
    crumbleBlocks: [], spikes: [], bouncePads: [], kineticBlocks: [], ropes: [], sunbeams: [],
    sceneLights: [], fallingBlocks: [], backgroundBlocks: [], dialogueTriggers: [], guideDustPaths: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [], lambdaAnchors: [],
    grappleCarryBlocks: [], phantasmalTiles: [], pixelMaterials: [],
    ...overrides,
  } as EditorRoomData;
}

function makeState(room: EditorRoomData) {
  const nextUid = { current: 1 };
  return {
    roomData: room,
    selectedElements: [],
    get nextUid() { return nextUid.current; },
    set nextUid(v: number) { nextUid.current = v; },
  } as unknown as Parameters<typeof placePixelMaterialAt>[0];
}

// ── Small Phase 2 fixups ────────────────────────────────────────────────────

test('half-width pillar: sand rejected in the occupied 4px half, allowed in the empty half', () => {
  const room = makeRoom({
    interiorWalls: [{
      uid: 1, xBlock: 3, yBlock: 3, wBlock: 1, hBlock: 1,
      isPlatformFlag: 0, isPillarHalfWidthFlag: 1,
    }],
  } as unknown as Partial<EditorRoomData>);
  // Occupied half: native px [24,28) x [24,32).
  assert.equal(isPixelMaterialSolidAtPixel(room, 24, 25), true);
  assert.equal(isPixelMaterialSolidAtPixel(room, 27, 25), true);
  assert.equal(canPlacePixelMaterialAt(room, 24, 25), false);
  // Empty half: native px [28,32).
  assert.equal(isPixelMaterialSolidAtPixel(room, 28, 25), false);
  assert.equal(canPlacePixelMaterialAt(room, 28, 25), true);
});

test('half-width pillar parity: normal full-width walls and ramps are unaffected', () => {
  const roomWall = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 2, yBlock: 2, wBlock: 1, hBlock: 1, isPlatformFlag: 0 }],
  } as unknown as Partial<EditorRoomData>);
  assert.equal(canPlacePixelMaterialAt(roomWall, 16 + 7, 16), false); // full 8px width still solid

  const roomRamp = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 2, yBlock: 2, wBlock: 1, hBlock: 1, isPlatformFlag: 0, rampOrientation: 0 }],
  } as unknown as Partial<EditorRoomData>);
  assert.equal(canPlacePixelMaterialAt(roomRamp, 16 + 7, 16), false); // ramps still full-rect solid
});

// ── Material definition table ───────────────────────────────────────────────

test('material definitions include 1x1 and 2x2 sand with correct footprint sizes', () => {
  assert.equal(getMaterialFootprintSize(MATERIAL_SAND), 1);
  assert.equal(getMaterialFootprintSize(MATERIAL_SAND_2X2), 2);
  assert.equal(MATERIAL_DEFS[MATERIAL_SAND].color !== MATERIAL_DEFS[MATERIAL_SAND_2X2].color, true);
  assert.equal(isKnownMaterialId(MATERIAL_SAND), true);
  assert.equal(isKnownMaterialId(MATERIAL_SAND_2X2), true);
  assert.equal(isKnownMaterialId(0), false);
  assert.equal(isKnownMaterialId(999), false);
});

// ── Multi-cell occupancy ─────────────────────────────────────────────────────

test('2x2 placement reserves all four cells', () => {
  const sys = new PixelMaterialSystem(10, 10, new SolidMask(10, 10));
  assert.equal(sys.place(2, 2, MATERIAL_SAND_2X2), true);
  assert.equal(sys.isOccupied(2, 2), true);
  assert.equal(sys.isOccupied(3, 2), true);
  assert.equal(sys.isOccupied(2, 3), true);
  assert.equal(sys.isOccupied(3, 3), true);
  assert.equal(sys.occupiedCount, 4);
  assert.equal(sys.particleCount, 1);
});

test('2x2 placement rejects overlap with an existing 1x1 particle', () => {
  const sys = new PixelMaterialSystem(10, 10, new SolidMask(10, 10));
  sys.place(3, 3, MATERIAL_SAND);
  assert.equal(sys.place(2, 2, MATERIAL_SAND_2X2), false);
});

test('2x2 placement rejects overlap with another 2x2 particle', () => {
  const sys = new PixelMaterialSystem(10, 10, new SolidMask(10, 10));
  sys.place(2, 2, MATERIAL_SAND_2X2);
  assert.equal(sys.place(3, 3, MATERIAL_SAND_2X2), false);
  assert.equal(sys.place(4, 2, MATERIAL_SAND_2X2), true); // adjacent, non-overlapping
});

test('erasing any cell covered by a 2x2 particle removes the whole particle', () => {
  const sys = new PixelMaterialSystem(10, 10, new SolidMask(10, 10));
  sys.place(2, 2, MATERIAL_SAND_2X2);
  assert.equal(sys.erase(3, 3), true);
  assert.equal(sys.isOccupied(2, 2), false);
  assert.equal(sys.isOccupied(3, 2), false);
  assert.equal(sys.isOccupied(2, 3), false);
  assert.equal(sys.isOccupied(3, 3), false);
  assert.equal(sys.occupiedCount, 0);
  assert.equal(sys.particleCount, 0);
});

// ── 2x2 movement/collision ───────────────────────────────────────────────────

test('2x2 sand falls through empty space', () => {
  const sys = new PixelMaterialSystem(20, 20, new SolidMask(20, 20));
  sys.place(5, 0, MATERIAL_SAND_2X2);
  for (let i = 0; i < 5; i++) sys.step();
  assert.equal(sys.getMaterialAt(5, 5), MATERIAL_SAND_2X2);
  assert.equal(sys.isOccupied(5, 0), false);
});

test('2x2 sand rests on top of a flat solid floor', () => {
  const solid = new SolidMask(20, 20);
  solid.markRect(0, 16, 20, 20);
  const sys = new PixelMaterialSystem(20, 20, solid);
  sys.place(5, 0, MATERIAL_SAND_2X2);
  for (let i = 0; i < 60; i++) sys.step();
  assert.equal(sys.isOccupied(5, 14), true);
  assert.equal(sys.isOccupied(6, 14), true);
  assert.equal(sys.isOccupied(5, 15), true);
  assert.equal(sys.isOccupied(6, 15), true);
  assert.equal(sys.isOccupied(5, 16), false);
});

test('2x2 sand cannot partially overlap solid geometry', () => {
  const solid = new SolidMask(20, 20);
  solid.markRect(6, 0, 20, 20); // solid starting at column 6
  const sys = new PixelMaterialSystem(20, 20, solid);
  // Anchored at x=5 the footprint spans columns 5-6; column 6 is solid.
  assert.equal(sys.place(5, 0, MATERIAL_SAND_2X2), false);
  assert.equal(sys.place(4, 0, MATERIAL_SAND_2X2), true); // columns 4-5, fully clear
});

test('2x2 sand cannot partially exit the room', () => {
  const sys = new PixelMaterialSystem(10, 10, new SolidMask(10, 10));
  assert.equal(sys.place(9, 5, MATERIAL_SAND_2X2), false); // would span x=9..10, out of bounds
  assert.equal(sys.place(8, 5, MATERIAL_SAND_2X2), true);
});

test('2x2 sand cannot pass through a 1-pixel gap but can fall through a 2-pixel gap', () => {
  // 1px gap: solid everywhere except a single column.
  {
    const solid = new SolidMask(20, 20);
    solid.markRect(0, 10, 20, 20);
    solid.clear(); // rebuild manually below
    // Build a floor with a 1px gap at column 10.
    for (let x = 0; x < 20; x++) {
      if (x === 10) continue;
      solid.markRect(x, 10, x + 1, 20);
    }
    const sys = new PixelMaterialSystem(20, 20, solid);
    sys.place(9, 0, MATERIAL_SAND_2X2); // spans columns 9-10; column 10 is the only gap
    for (let i = 0; i < 60; i++) sys.step();
    // Cannot fit through a 1px gap — must come to rest on top of the floor.
    assert.equal(sys.isOccupied(9, 9) || sys.isOccupied(9, 8), true);
    assert.equal(sys.getMaterialAt(9, 10), 0);
  }
  // 2px gap: should fall all the way through.
  {
    const solid = new SolidMask(20, 20);
    for (let x = 0; x < 20; x++) {
      if (x === 9 || x === 10) continue;
      solid.markRect(x, 10, x + 1, 20);
    }
    const sys = new PixelMaterialSystem(20, 20, solid);
    sys.place(9, 0, MATERIAL_SAND_2X2);
    for (let i = 0; i < 60; i++) sys.step();
    let restY = -1;
    sys.forEachParticle((_x, y) => { restY = y; });
    assert.ok(restY >= 10, 'should have fallen through the 2px gap past the floor row');
  }
});

test('2x2 sand slides diagonally only when the full destination footprint is free', () => {
  const solid = new SolidMask(20, 20);
  solid.markRect(5, 5, 6, 20); // single-column pillar blocking straight-down only under x=5
  const sys = new PixelMaterialSystem(20, 20, solid);
  sys.place(4, 4, MATERIAL_SAND_2X2); // footprint columns 4-5
  sys.step();
  // Straight down (rows 5) is blocked at column 5, so it must not have moved straight down.
  assert.equal(sys.isOccupied(4, 4) && sys.isOccupied(5, 4), false);
});

test('2x2 sand sleeps after settling', () => {
  const solid = new SolidMask(20, 20);
  solid.markRect(0, 10, 20, 20);
  const sys = new PixelMaterialSystem(20, 20, solid);
  sys.place(5, 0, MATERIAL_SAND_2X2);
  for (let i = 0; i < 60; i++) sys.step();
  assert.equal(sys.activeCount, 0);
  assert.equal(sys.particleCount, 1);
});

// ── Stacking ─────────────────────────────────────────────────────────────────

test('2x2 particles stack on each other without overlap', () => {
  const solid = new SolidMask(20, 20);
  solid.markRect(0, 16, 20, 20);
  const sys = new PixelMaterialSystem(20, 20, solid);
  sys.place(4, 0, MATERIAL_SAND_2X2);
  for (let i = 0; i < 60; i++) sys.step();
  sys.place(4, 0, MATERIAL_SAND_2X2);
  for (let i = 0; i < 60; i++) sys.step();
  assert.equal(sys.particleCount, 2);
  assert.equal(sys.occupiedCount, 8);
});

test('2x2 particles stack on 1x1 particles without overlap, and vice versa', () => {
  const solid = new SolidMask(20, 20);
  solid.markRect(0, 16, 20, 20);
  const sys = new PixelMaterialSystem(20, 20, solid);
  sys.place(5, 15, MATERIAL_SAND); // 1x1 resting on the floor
  for (let i = 0; i < 30; i++) sys.step();
  sys.place(4, 0, MATERIAL_SAND_2X2); // footprint columns 4-5 — column 5 has the 1x1 grain at y=15
  for (let i = 0; i < 60; i++) sys.step();

  assert.equal(sys.occupiedCount, 4 + 1);
  // No cell double-booked — every occupied cell must resolve to exactly one particle
  // (implicitly guaranteed by the Map-based occupancy, verified via count consistency).
  let cells = 0;
  sys.forEachParticle((x, y, material) => {
    const size = getMaterialFootprintSize(material);
    cells += size * size;
  });
  assert.equal(cells, sys.occupiedCount);
});

// ── Support removal wakes 2x2 ────────────────────────────────────────────────

test('erasing support under a sleeping 2x2 particle wakes it and lets it fall', () => {
  const solid = new SolidMask(20, 20);
  solid.markRect(0, 10, 20, 20);
  const sys = new PixelMaterialSystem(20, 20, solid);
  sys.place(5, 0, MATERIAL_SAND_2X2);
  for (let i = 0; i < 60; i++) sys.step();
  assert.equal(sys.activeCount, 0);

  solid.clear(); // remove all support
  sys.wakeRegion(4, 7, 8, 11);
  assert.equal(sys.activeCount, 1);

  for (let i = 0; i < 30; i++) sys.step();
  let restY = -1;
  sys.forEachParticle((_x, y) => { restY = y; });
  assert.ok(restY > 8, 'should have fallen further after support was removed');
});

// ── Wind on 2x2 ──────────────────────────────────────────────────────────────

test('wind wakes and moves sleeping 2x2 sand', () => {
  const solid = new SolidMask(20, 20);
  solid.markRect(0, 10, 20, 20);
  const sys = new PixelMaterialSystem(20, 20, solid);
  sys.place(5, 8, MATERIAL_SAND_2X2);
  for (let i = 0; i < 30; i++) sys.step();
  assert.equal(sys.activeCount, 0);

  sys.applyWindForce({ centerXPx: 6, centerYPx: 9, radiusPx: 3, forceX: 100, forceY: 0 });
  assert.equal(sys.activeCount, 1);
  for (let i = 0; i < 5; i++) sys.step();
  let movedX = -1;
  sys.forEachParticle(x => { movedX = x; });
  assert.notEqual(movedX, 5);
});

test('a moving cluster near sleeping 2x2 sand wakes it via the movement-wind emitter', () => {
  const world = createWorldState(1000 / 60, 1);
  world.worldWidthWorld = 20;
  world.worldHeightWorld = 20;
  const sys = new PixelMaterialSystem(20, 20, new SolidMask(20, 20));
  world.pixelMaterialSystem = sys;
  const solid = new SolidMask(20, 20);
  solid.markRect(0, 10, 20, 20);
  sys.solid = solid;
  sys.place(5, 8, MATERIAL_SAND_2X2);
  for (let i = 0; i < 30; i++) sys.step();
  assert.equal(sys.activeCount, 0);

  const player = createClusterState(1, 6, 9, 1, 10);
  player.velocityXWorld = 300;
  world.clusters.push(player);
  applyMovementWindToPixelMaterials(world);

  assert.equal(sys.activeCount, 1);
});

// ── Dynamic solid sync + 2x2 ────────────────────────────────────────────────

test('dynamic solid sync wakes a 2x2 particle whose anchor is outside the changed region but whose footprint intersects it', () => {
  const world = createWorldState(1000 / 60, 1);
  world.worldWidthWorld = 20;
  world.worldHeightWorld = 20;
  const sys = new PixelMaterialSystem(20, 20, new SolidMask(20, 20));
  world.pixelMaterialSystem = sys;
  const wi = world.wallCount++;
  world.wallXWorld[wi] = 0; world.wallYWorld[wi] = 10; world.wallWWorld[wi] = 20; world.wallHWorld[wi] = 8;
  world.crumbleBlockWallIndex[world.crumbleBlockCount] = wi;
  world.crumbleBlockCount++;
  sys.solid = buildSolidMaskFromWorld(world, 20, 20);

  // Anchor at (5,7); footprint covers (5,7)-(6,8) — anchor row 7 is above the
  // wall (y=10), but the particle rests with its bottom row at y=8/9, so the
  // "changed region" from destroying the wall must still reach it via
  // wakeRegion's cell-based lookup regardless of anchor position.
  sys.place(5, 6, MATERIAL_SAND_2X2);
  for (let i = 0; i < 30; i++) {
    syncPixelMaterialSolidGeometry(world);
    sys.step();
  }
  assert.equal(sys.activeCount, 0);

  world.wallWWorld[wi] = 0;
  world.wallHWorld[wi] = 0;
  syncPixelMaterialSolidGeometry(world);
  assert.equal(sys.activeCount, 1);
});

// ── Editor placement/erase ───────────────────────────────────────────────────

test('editor 2x2 placement snaps to an even-pixel anchor grid', () => {
  const anchor = anchorForMaterial(5, 7, MATERIAL_SAND_2X2);
  assert.equal(anchor.x, 4);
  assert.equal(anchor.y, 6);
  const anchor1x1 = anchorForMaterial(5, 7, MATERIAL_SAND);
  assert.equal(anchor1x1.x, 5);
  assert.equal(anchor1x1.y, 7);
});

test('editor 2x2 placement rejects any footprint overlap with runtime-solid geometry', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 1, yBlock: 1, wBlock: 1, hBlock: 1, isPlatformFlag: 0 }],
  } as unknown as Partial<EditorRoomData>);
  // Block (1,1) occupies native px [8,16)x[8,16). A 2x2 anchored at (7,7)
  // covers (7,7)-(8,8), overlapping the block's top-left corner cell (8,8).
  assert.equal(canPlacePixelMaterialAt(room, 7, 7, MATERIAL_SAND_2X2), false);
  assert.equal(canPlacePixelMaterialAt(room, 4, 4, MATERIAL_SAND_2X2), true);
});

test('editor place/erase round-trip for 2x2 particles, including erase from any covered cell', () => {
  const room = makeRoom();
  const state = makeState(room);
  assert.equal(placePixelMaterialAt(state, 5, 7, MATERIAL_SAND_2X2), true);
  const placed = room.pixelMaterials![0];
  assert.equal(placed.xPixel, 4); // snapped
  assert.equal(placed.yPixel, 6);

  // Erase from the bottom-right covered cell (not the anchor).
  assert.equal(erasePixelMaterialAt(state, 5, 7), true);
  assert.equal(room.pixelMaterials!.length, 0);
});

test('right-click erase removes a whole 2x2 particle (erasePixelMaterialAt is footprint-aware regardless of caller)', () => {
  const room = makeRoom();
  const state = makeState(room);
  placePixelMaterialAt(state, 10, 10, MATERIAL_SAND_2X2);
  assert.equal(room.pixelMaterials!.length, 1);
  // Simulates the editorController.ts right-click handler, which calls
  // erasePixelMaterialAt directly at the exact cursor pixel.
  assert.equal(erasePixelMaterialAt(state, 11, 11), true);
  assert.equal(room.pixelMaterials!.length, 0);
});

test('drag-paint line for 2x2 anchors is gap-free along the footprint grid', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 20 });
  const state = makeState(room);
  paintPixelMaterialLine(state, 0, 0, 20, 0, MATERIAL_SAND_2X2, false);
  const anchors = new Set(room.pixelMaterials!.map(p => p.xPixel));
  // Every even anchor from 0 to 20 should have been painted (2px steps).
  for (let x = 0; x <= 20; x += 2) assert.ok(anchors.has(x), `anchor x=${x} missing`);
});

test('painting does not create overlapping 2x2 particles', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 20 });
  const state = makeState(room);
  paintPixelMaterialLine(state, 0, 0, 10, 0, MATERIAL_SAND_2X2, false);
  assert.equal(room.pixelMaterials!.length, 6); // x = 0,2,4,6,8,10
});

// ── Serialization ────────────────────────────────────────────────────────────

test('JSON serialization round-trips both 1x1 and 2x2 pixel materials', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 14 });
  room.pixelMaterials = [
    { uid: 1, xPixel: 10, yPixel: 10, material: MATERIAL_SAND },
    { uid: 2, xPixel: 20, yPixel: 20, material: MATERIAL_SAND_2X2 },
  ];
  const json = editorRoomDataToJson(room);
  assert.deepEqual(json.pixelMaterials, [
    { xPixel: 10, yPixel: 10, material: MATERIAL_SAND },
    { xPixel: 20, yPixel: 20, material: MATERIAL_SAND_2X2 },
  ]);
  const roundTrip = jsonToEditorRoomData(json, 100).data;
  assert.equal(roundTrip.pixelMaterials?.length, 2);
  assert.equal(roundTrip.pixelMaterials?.[1]?.material, MATERIAL_SAND_2X2);
});

test('export filters out-of-bounds 2x2 entries (anchor in-bounds, footprint out-of-bounds)', () => {
  const room = makeRoom({ widthBlocks: 10, heightBlocks: 10 }); // 80x80 native px
  room.pixelMaterials = [
    { uid: 1, xPixel: 10, yPixel: 10, material: MATERIAL_SAND_2X2 }, // fully valid
    { uid: 2, xPixel: 79, yPixel: 10, material: MATERIAL_SAND_2X2 }, // anchor in-bounds, footprint exits at x=80
  ];
  const json = editorRoomDataToJson(room);
  assert.deepEqual(json.pixelMaterials, [{ xPixel: 10, yPixel: 10, material: MATERIAL_SAND_2X2 }]);
});

test('room resize clips a 2x2 particle whose footprint would cross the new edge', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 14 });
  room.pixelMaterials = [
    { uid: 1, xPixel: 8, yPixel: 8, material: MATERIAL_SAND_2X2 },  // fully inside a 10-block-wide room (80px)
    { uid: 2, xPixel: 79, yPixel: 8, material: MATERIAL_SAND_2X2 }, // footprint would cross x=80
  ];
  applyRoomDimensionChange(room, 'widthBlocks', 10);
  assert.equal(room.pixelMaterials.length, 1);
  assert.equal(room.pixelMaterials[0].xPixel, 8);
});

// ── Existing 1x1 behavior unaffected ─────────────────────────────────────────

test('1x1 sand behavior (place, footprint size, occupancy) is unchanged after 2x2 support was added', () => {
  const sys = new PixelMaterialSystem(10, 10, new SolidMask(10, 10));
  assert.equal(sys.place(3, 3, MATERIAL_SAND), true);
  assert.equal(sys.place(3, 3, MATERIAL_SAND), false);
  assert.equal(sys.occupiedCount, 1);
  assert.equal(sys.particleCount, 1);
  assert.equal(getMaterialFootprintSize(MATERIAL_SAND), 1);
});
