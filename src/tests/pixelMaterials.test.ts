import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PixelMaterialSystem } from '../sim/pixelMaterials/pixelMaterialSystem';
import { SolidMask, buildSolidMaskFromWorld } from '../sim/pixelMaterials/pixelMaterialSolid';
import { MATERIAL_SAND } from '../sim/pixelMaterials/pixelMaterialTypes';
import { createWorldState } from '../sim/world';
import { editorRoomDataToJson, jsonToEditorRoomData } from '../editor/roomJson';
import { dehydrateRoom, hydrateV2Room } from '../levels/roomSchemaV2';
import type { EditorRoomData } from '../editor/editorState';
import { canPlacePixelMaterialAt } from '../editor/editorHitTest';
import { pixelFromCursor, placePixelMaterialAt, paintPixelMaterialLine } from '../editor/editorPixelMaterialTool';

function makeSystem(width: number, height: number): PixelMaterialSystem {
  const solid = new SolidMask(width, height);
  const sys = new PixelMaterialSystem(width, height, solid);
  return sys;
}

// 1. Falls through empty cells
test('sand particle falls through empty cells', () => {
  const sys = makeSystem(20, 20);
  sys.place(5, 0, MATERIAL_SAND);
  for (let i = 0; i < 5; i++) sys.step();
  assert.equal(sys.getMaterialAt(5, 5), MATERIAL_SAND);
  assert.equal(sys.isOccupied(5, 0), false);
});

// 2. Stops on solid tile (8x8 tile occupies rows y=16..23 if placed at block row 2)
test('sand particle stops on top of an 8x8 solid tile', () => {
  const sys = makeSystem(20, 20);
  const solid = new SolidMask(20, 20);
  solid.markRect(0, 16, 20, 24); // one 8x8 tile row, solid
  sys.solid = solid;
  sys.place(5, 0, MATERIAL_SAND);
  for (let i = 0; i < 60; i++) sys.step();
  assert.equal(sys.getMaterialAt(5, 15), MATERIAL_SAND);
  assert.equal(sys.isOccupied(5, 16), false);
});

// 3. Collides correctly across all pixels of an 8x8 tile
test('sand collides across the full width of an 8x8 tile', () => {
  const solid = new SolidMask(24, 24);
  solid.markRect(8, 16, 16, 24); // single 8x8 tile at block (1,2)
  // Interior columns (not the tile's outer edge) rest exactly on top; the two
  // edge columns (8 and 15) may slide off sideways since the row beside them
  // at y=16 is open — correct falling-sand behaviour for a single-tile ledge.
  for (let col = 9; col < 15; col++) {
    const sys = new PixelMaterialSystem(24, 24, solid);
    sys.place(col, 0, MATERIAL_SAND);
    for (let i = 0; i < 60; i++) sys.step();
    assert.equal(sys.getMaterialAt(col, 15), MATERIAL_SAND, `column ${col} should rest at y=15`);
  }
});

// 4. Diagonal movement when downward blocked
test('sand moves diagonally when directly below is blocked', () => {
  const solid = new SolidMask(20, 20);
  solid.markRect(5, 5, 6, 20); // single-column solid pillar blocking straight down only at x=5
  const sys = new PixelMaterialSystem(20, 20, solid);
  sys.place(5, 4, MATERIAL_SAND);
  sys.step();
  // Should have moved diagonally (not stayed at (5,4), not moved straight down into solid)
  assert.equal(sys.isOccupied(5, 4), false);
  assert.equal(sys.isOccupied(5, 5), false);
  assert.ok(sys.isOccupied(4, 5) || sys.isOccupied(6, 5));
});

// Diagonal alternation: piles shouldn't all lean one direction
test('diagonal fall preference alternates deterministically, spreading a stacked pile both ways', () => {
  const solid = new SolidMask(30, 20);
  solid.markRect(0, 18, 30, 20); // flat floor across the whole width
  const sys = new PixelMaterialSystem(30, 20, solid);
  // Repeatedly drop sand down the same column — once it stacks above floor
  // level, new grains must spread diagonally off the peak to come to rest.
  for (let n = 0; n < 40; n++) {
    sys.place(15, 0, MATERIAL_SAND);
    for (let i = 0; i < 40; i++) sys.step();
  }
  let leftGain = 0;
  let rightGain = 0;
  sys.forEachParticle((x) => {
    if (x < 15) leftGain++;
    if (x > 15) rightGain++;
  });
  assert.ok(leftGain > 0 && rightGain > 0, 'sand pile should spread to both sides, not lean one way');
});

// 5. No duplicate occupancy
test('sand cannot occupy the same cell as another particle', () => {
  const sys = makeSystem(10, 10);
  assert.equal(sys.place(3, 3, MATERIAL_SAND), true);
  assert.equal(sys.place(3, 3, MATERIAL_SAND), false);
  assert.equal(sys.occupiedCount, 1);
});

// 6. Cannot place inside solid geometry
test('sand cannot be placed inside solid geometry', () => {
  const solid = new SolidMask(10, 10);
  solid.markRect(2, 2, 4, 4);
  const sys = new PixelMaterialSystem(10, 10, solid);
  assert.equal(sys.place(2, 2, MATERIAL_SAND), false);
  assert.equal(sys.place(3, 3, MATERIAL_SAND), false);
  assert.equal(sys.place(5, 5, MATERIAL_SAND), true);
});

// 7. Stays within room bounds
test('sand remains within room bounds and cannot fall past the floor edge', () => {
  const sys = makeSystem(10, 10);
  sys.place(0, 9, MATERIAL_SAND);
  for (let i = 0; i < 20; i++) sys.step();
  assert.equal(sys.isOccupied(0, 9), true);
  assert.equal(sys.place(-1, 0, MATERIAL_SAND), false);
  assert.equal(sys.place(0, 10, MATERIAL_SAND), false);
});

// 8. Settled sand eventually sleeps
test('settled sand eventually goes to sleep', () => {
  const solid = new SolidMask(10, 10);
  solid.markRect(0, 5, 10, 10);
  const sys = new PixelMaterialSystem(10, 10, solid);
  sys.place(5, 0, MATERIAL_SAND);
  for (let i = 0; i < 100; i++) sys.step();
  assert.equal(sys.activeCount, 0);
  assert.equal(sys.sleepingCount, 1);
});

// 9. Wind reactivates sleeping sand
test('wind wakes sleeping sand', () => {
  const solid = new SolidMask(10, 10);
  solid.markRect(0, 5, 10, 10);
  const sys = new PixelMaterialSystem(10, 10, solid);
  sys.place(5, 0, MATERIAL_SAND);
  for (let i = 0; i < 100; i++) sys.step();
  assert.equal(sys.activeCount, 0);

  sys.applyWindForce({ centerXPx: 5, centerYPx: 4, radiusPx: 3, forceX: 50, forceY: 0 });
  assert.equal(sys.activeCount, 1);
});

// 10. Wind can displace sand
test('wind can displace resting sand sideways', () => {
  const solid = new SolidMask(20, 10);
  solid.markRect(0, 5, 20, 10);
  const sys = new PixelMaterialSystem(20, 10, solid);
  sys.place(10, 4, MATERIAL_SAND);
  for (let i = 0; i < 40; i++) sys.step(); // let it settle and sleep

  sys.applyWindForce({ centerXPx: 10, centerYPx: 4, radiusPx: 3, forceX: 100, forceY: 0 });
  const startX = 10;
  for (let i = 0; i < 5; i++) sys.step();
  let foundX = -1;
  sys.forEachParticle((x) => { foundX = x; });
  assert.notEqual(foundX, startX);
});

// 11. Returns to gravity-driven settling after wind dissipates
test('sand returns to gravity-driven settling after wind dissipates', () => {
  const solid = new SolidMask(20, 12);
  solid.markRect(0, 10, 20, 12);
  const sys = new PixelMaterialSystem(20, 12, solid);
  sys.place(10, 0, MATERIAL_SAND);
  sys.applyWindForce({ centerXPx: 10, centerYPx: 0, radiusPx: 5, forceX: 200, forceY: 0 });
  for (let i = 0; i < 200; i++) sys.step();
  // Eventually settles on the floor and sleeps, regardless of the initial push
  assert.equal(sys.activeCount, 0);
  let restY = -1;
  sys.forEachParticle((_x, y) => { restY = y; });
  assert.equal(restY, 9);
});

// 12. Serialization round-trips
test('pixel-material serialization round-trips through save/load', () => {
  const sys = makeSystem(10, 10);
  sys.place(1, 1, MATERIAL_SAND);
  sys.place(2, 3, MATERIAL_SAND);
  const defs = sys.serialize();
  assert.deepEqual(defs, [
    { xPixel: 1, yPixel: 1, material: MATERIAL_SAND },
    { xPixel: 2, yPixel: 3, material: MATERIAL_SAND },
  ]);

  const reloaded = makeSystem(10, 10);
  reloaded.loadFromDefs(defs);
  assert.equal(reloaded.isOccupied(1, 1), true);
  assert.equal(reloaded.isOccupied(2, 3), true);
  assert.equal(reloaded.occupiedCount, 2);
});

test('room JSON serialization preserves pixel materials', () => {
  const room = {
    id: 'test', name: 'Test', worldNumber: 1,
    blockTheme: 'blackRock', backgroundId: 'brownRock', lightingEffect: 'Ambient',
    songId: '_continue', widthBlocks: 20, heightBlocks: 14,
    playerSpawnBlock: [2, 2], interiorWalls: [], enemies: [], transitions: [],
    saveTombs: [], skillTombs: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [], waterZones: [], lavaZones: [],
    crumbleBlocks: [], spikes: [], bouncePads: [], kineticBlocks: [], ropes: [], sunbeams: [],
    sceneLights: [], fallingBlocks: [], backgroundBlocks: [], dialogueTriggers: [], guideDustPaths: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [], lambdaAnchors: [],
    grappleCarryBlocks: [], phantasmalTiles: [],
    pixelMaterials: [{ uid: 1, xPixel: 40, yPixel: 12, material: 1 }],
  } as EditorRoomData;

  const json = editorRoomDataToJson(room);
  const roundTrip = jsonToEditorRoomData(json, 100).data;

  assert.deepEqual(json.pixelMaterials, [{ xPixel: 40, yPixel: 12, material: 1 }]);
  assert.equal(roundTrip.pixelMaterials?.[0]?.xPixel, 40);
  assert.equal(roundTrip.pixelMaterials?.[0]?.yPixel, 12);
});

test('SavedRoomV2 dehydrate/hydrate round-trips pixel materials (campaign-store & file-cache path)', () => {
  const room = {
    id: 'roomB', name: 'Room B', worldNumber: 1,
    blockTheme: 'blackRock', backgroundId: 'brownRock', lightingEffect: 'Ambient',
    songId: '_continue', widthBlocks: 20, heightBlocks: 14,
    playerSpawnBlock: [2, 2], interiorWalls: [], enemies: [], transitions: [],
    saveTombs: [], skillTombs: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [], waterZones: [], lavaZones: [],
    crumbleBlocks: [], spikes: [], bouncePads: [], kineticBlocks: [], ropes: [], sunbeams: [],
    sceneLights: [], fallingBlocks: [], backgroundBlocks: [], dialogueTriggers: [], guideDustPaths: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [], lambdaAnchors: [],
    grappleCarryBlocks: [], phantasmalTiles: [],
    pixelMaterials: [
      { uid: 1, xPixel: 40, yPixel: 12, material: 1 },
      { uid: 2, xPixel: 41, yPixel: 12, material: 1 },
    ],
  } as EditorRoomData;

  const json = editorRoomDataToJson(room);
  const saved = dehydrateRoom(json);
  assert.deepEqual(saved.pixelMaterials, [[40, 12, 1], [41, 12, 1]]);

  const rehydrated = hydrateV2Room(saved);
  assert.deepEqual(rehydrated.pixelMaterials, [
    { xPixel: 40, yPixel: 12, material: 1 },
    { xPixel: 41, yPixel: 12, material: 1 },
  ]);
});

// 13. Legacy rooms without pixel-material data load fine
test('legacy rooms without pixelMaterials field load without error', () => {
  const sys = makeSystem(10, 10);
  sys.loadFromDefs([]);
  assert.equal(sys.occupiedCount, 0);

  // Malformed / out-of-bounds entries are skipped, not thrown
  sys.loadFromDefs([
    { xPixel: NaN as unknown as number, yPixel: 1, material: 1 },
    { xPixel: 999, yPixel: 999, material: 1 },
    { xPixel: 3, yPixel: 3, material: 1 },
  ]);
  assert.equal(sys.occupiedCount, 1);
  assert.equal(sys.isOccupied(3, 3), true);
});

// 14. Room transitions clear old simulation state
test('loading a new room replaces the pixel material system (no stale state)', () => {
  const world = createWorldState(1000 / 60, 1);
  world.pixelMaterialSystem.place(1, 1, MATERIAL_SAND);
  assert.equal(world.pixelMaterialSystem.occupiedCount, 1);

  world.worldWidthWorld = 100;
  world.worldHeightWorld = 80;
  world.pixelMaterialSystem = new PixelMaterialSystem(100, 80, buildSolidMaskFromWorld(world, 100, 80));
  assert.equal(world.pixelMaterialSystem.occupiedCount, 0);
});

// Solid mask: room-edge / bounds behavior
test('solid occupancy mask treats out-of-bounds cells as solid (room edges)', () => {
  const mask = new SolidMask(10, 10);
  assert.equal(mask.isSolid(-1, 5), true);
  assert.equal(mask.isSolid(10, 5), true);
  assert.equal(mask.isSolid(5, -1), true);
  assert.equal(mask.isSolid(5, 10), true);
  assert.equal(mask.isSolid(5, 5), false);
});

test('solid mask marks an 8x8 world tile as a full 8x8 solid block, ignoring internal boundaries', () => {
  const world = createWorldState(1000 / 60, 1);
  const wi = world.wallCount++;
  world.wallXWorld[wi] = 8;
  world.wallYWorld[wi] = 8;
  world.wallWWorld[wi] = 8;
  world.wallHWorld[wi] = 8;
  const mask = buildSolidMaskFromWorld(world, 32, 32);
  for (let y = 8; y < 16; y++) {
    for (let x = 8; x < 16; x++) {
      assert.equal(mask.isSolid(x, y), true, `(${x},${y}) should be solid`);
    }
  }
  assert.equal(mask.isSolid(7, 8), false);
  assert.equal(mask.isSolid(16, 8), false);
});

test('solid occupancy mask ignores one-way platforms (sand falls through)', () => {
  const world = createWorldState(1000 / 60, 1);
  const wi = world.wallCount++;
  world.wallXWorld[wi] = 0;
  world.wallYWorld[wi] = 8;
  world.wallWWorld[wi] = 16;
  world.wallHWorld[wi] = 8;
  world.wallIsPlatformFlag[wi] = 1;
  const mask = buildSolidMaskFromWorld(world, 16, 16);
  assert.equal(mask.isSolid(4, 10), false);
});

// 15/16. Editor coordinate conversion + drag paint gap-free line
test('editor pixel-cursor conversion maps native-pixel world coordinates directly (1 world unit = 1 native px)', () => {
  const state = { cursorWorldX: 12.7, cursorWorldY: 3.2 } as unknown as Parameters<typeof pixelFromCursor>[0];
  const px = pixelFromCursor(state);
  assert.equal(px.x, 12);
  assert.equal(px.y, 3);
});

test('canPlacePixelMaterialAt rejects out-of-bounds, solid, and duplicate cells', () => {
  const room = {
    widthBlocks: 4, heightBlocks: 4,
    interiorWalls: [{ uid: 1, xBlock: 1, yBlock: 1, wBlock: 1, hBlock: 1, isPlatformFlag: 0 }],
    fallingBlocks: [],
    pixelMaterials: [{ uid: 2, xPixel: 5, yPixel: 5, material: 1 }],
  } as unknown as EditorRoomData;

  assert.equal(canPlacePixelMaterialAt(room, -1, 0), false);
  assert.equal(canPlacePixelMaterialAt(room, 100, 100), false);
  assert.equal(canPlacePixelMaterialAt(room, 9, 9), false); // inside the 1,1 solid tile (8..16 x 8..16)
  assert.equal(canPlacePixelMaterialAt(room, 5, 5), false); // already occupied
  assert.equal(canPlacePixelMaterialAt(room, 0, 0), true);
});

test('drag-paint line fill leaves no gaps between two pixel points', () => {
  const room = {
    widthBlocks: 10, heightBlocks: 10,
    interiorWalls: [], fallingBlocks: [], pixelMaterials: [],
  } as unknown as EditorRoomData;
  const nextUid = { current: 1 };
  const state = {
    roomData: room,
    selectedElements: [],
    get nextUid() { return nextUid.current; },
    set nextUid(v: number) { nextUid.current = v; },
  } as unknown as Parameters<typeof paintPixelMaterialLine>[0];

  paintPixelMaterialLine(state, 0, 0, 9, 4, 1, false);
  // Every intermediate column should have at least one painted cell (Bresenham continuity)
  const xs = new Set<number>();
  for (const p of room.pixelMaterials!) xs.add(p.xPixel);
  for (let x = 0; x <= 9; x++) assert.ok(xs.has(x), `column ${x} should have a painted pixel`);
});

// 17. Existing tile editing remains unchanged (sanity: placing a pixel material
// does not touch interiorWalls / block-grid arrays)
test('placing a pixel-material particle does not affect block-grid tile arrays', () => {
  const room = {
    widthBlocks: 10, heightBlocks: 10,
    interiorWalls: [{ uid: 1, xBlock: 2, yBlock: 2, wBlock: 1, hBlock: 1, isPlatformFlag: 0 }],
    fallingBlocks: [], pixelMaterials: [],
  } as unknown as EditorRoomData;
  const nextUid = { current: 1 };
  const state = {
    roomData: room,
    selectedElements: [],
    get nextUid() { return nextUid.current; },
    set nextUid(v: number) { nextUid.current = v; },
  } as unknown as Parameters<typeof placePixelMaterialAt>[0];

  placePixelMaterialAt(state, 0, 0, 1);
  assert.equal(room.interiorWalls.length, 1);
  assert.equal(room.interiorWalls[0].xBlock, 2);
});
