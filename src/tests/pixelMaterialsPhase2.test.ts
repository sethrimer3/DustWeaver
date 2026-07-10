import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { PixelMaterialSystem } from '../sim/pixelMaterials/pixelMaterialSystem';
import { SolidMask, buildSolidMaskFromWorld } from '../sim/pixelMaterials/pixelMaterialSolid';
import { syncPixelMaterialSolidGeometry, notifySolidGeometryChanged } from '../sim/pixelMaterials/pixelMaterialSolidSync';
import { applyMovementWindToPixelMaterials } from '../sim/pixelMaterials/pixelMaterialMovementWind';
import { MATERIAL_SAND } from '../sim/pixelMaterials/pixelMaterialTypes';
import { canPlacePixelMaterialAt, isPixelMaterialSolidAtBlockCell } from '../editor/editorHitTest';
import { applyRoomDimensionChange } from '../editor/editorRoomResize';
import { editorRoomDataToJson } from '../editor/roomJson';
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

// ── Part 1: editor/runtime solid parity ─────────────────────────────────────

test('editor rejects sand placement inside a ramp (matches runtime full-rect ramp policy)', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 2, yBlock: 2, wBlock: 1, hBlock: 1, isPlatformFlag: 0, rampOrientation: 0 }],
  } as unknown as Partial<EditorRoomData>);
  assert.equal(isPixelMaterialSolidAtBlockCell(room, 2, 2), true);
  assert.equal(canPlacePixelMaterialAt(room, 2 * 8 + 3, 2 * 8 + 3), false);
});

test('runtime solid mask treats a ramp wall as a full solid rect, matching editor rejection', () => {
  const world = createWorldState(1000 / 60, 1);
  const wi = world.wallCount++;
  world.wallXWorld[wi] = 16; // block (2,2) in native px
  world.wallYWorld[wi] = 16;
  world.wallWWorld[wi] = 8;
  world.wallHWorld[wi] = 8;
  world.wallIsPlatformFlag[wi] = 0;
  world.wallRampOrientationIndex[wi] = 0; // ramp, but still a full-rect wall entry
  const mask = buildSolidMaskFromWorld(world, 40, 40);
  assert.equal(mask.isSolid(19, 19), true);
});

test('editor rejects sand placement inside a crumble block', () => {
  const room = makeRoom({
    crumbleBlocks: [{ uid: 1, xBlock: 3, yBlock: 3, wBlock: 1, hBlock: 1, variant: 'normal' }],
  } as unknown as Partial<EditorRoomData>);
  assert.equal(canPlacePixelMaterialAt(room, 3 * 8, 3 * 8), false);
});

test('editor rejects sand placement inside a bounce pad', () => {
  const room = makeRoom({
    bouncePads: [{ uid: 1, xBlock: 4, yBlock: 4, wBlock: 1, hBlock: 1, speedFactorIndex: 0 }],
  } as unknown as Partial<EditorRoomData>);
  assert.equal(canPlacePixelMaterialAt(room, 4 * 8, 4 * 8), false);
});

test('editor rejects sand placement inside a kinetic block', () => {
  const room = makeRoom({
    kineticBlocks: [{ uid: 1, xBlock: 5, yBlock: 5, wBlock: 1, hBlock: 1 }],
  } as unknown as Partial<EditorRoomData>);
  assert.equal(canPlacePixelMaterialAt(room, 5 * 8, 5 * 8), false);
});

test('editor rejects sand placement inside a falling block tile', () => {
  const room = makeRoom({
    fallingBlocks: [{ uid: 1, xBlock: 6, yBlock: 6, variant: 'tough' }],
  } as unknown as Partial<EditorRoomData>);
  assert.equal(canPlacePixelMaterialAt(room, 6 * 8, 6 * 8), false);
});

test('editor allows sand placement through grapple-carry blocks and phantasmal tiles (not runtime wall geometry)', () => {
  const room = makeRoom({
    grappleCarryBlocks: [{ uid: 1, xBlock: 7, yBlock: 7 }],
    phantasmalTiles: [{ uid: 2, xBlock: 8, yBlock: 7 }],
  } as unknown as Partial<EditorRoomData>);
  assert.equal(canPlacePixelMaterialAt(room, 7 * 8, 7 * 8), true);
  assert.equal(canPlacePixelMaterialAt(room, 8 * 8, 7 * 8), true);
});

test('editor allows sand placement inside a one-way platform (matches runtime — sand falls through platforms)', () => {
  const room = makeRoom({
    interiorWalls: [{ uid: 1, xBlock: 9, yBlock: 9, wBlock: 1, hBlock: 1, isPlatformFlag: 1 }],
  } as unknown as Partial<EditorRoomData>);
  assert.equal(canPlacePixelMaterialAt(room, 9 * 8, 9 * 8), true);
});

test('editor still allows placement in empty air and rejects duplicates and out-of-bounds', () => {
  const room = makeRoom();
  assert.equal(canPlacePixelMaterialAt(room, 10, 10), true);
  room.pixelMaterials!.push({ uid: 99, xPixel: 10, yPixel: 10, material: MATERIAL_SAND });
  assert.equal(canPlacePixelMaterialAt(room, 10, 10), false);
  assert.equal(canPlacePixelMaterialAt(room, -1, 0), false);
  assert.equal(canPlacePixelMaterialAt(room, room.widthBlocks * 8, 0), false);
});

// ── Part 2: room resize clipping ────────────────────────────────────────────

test('shrinking room width removes pixel materials past the new right edge', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 14 });
  room.pixelMaterials = [
    { uid: 1, xPixel: 5, yPixel: 5, material: MATERIAL_SAND },
    { uid: 2, xPixel: 150, yPixel: 5, material: MATERIAL_SAND }, // past new width (10*8=80)
  ];
  applyRoomDimensionChange(room, 'widthBlocks', 10);
  assert.equal(room.pixelMaterials.length, 1);
  assert.equal(room.pixelMaterials[0].xPixel, 5);
});

test('shrinking room height removes pixel materials past the new bottom edge', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 14 });
  room.pixelMaterials = [
    { uid: 1, xPixel: 5, yPixel: 5, material: MATERIAL_SAND },
    { uid: 2, xPixel: 5, yPixel: 100, material: MATERIAL_SAND }, // past new height (10*8=80)
  ];
  applyRoomDimensionChange(room, 'heightBlocks', 10);
  assert.equal(room.pixelMaterials.length, 1);
  assert.equal(room.pixelMaterials[0].yPixel, 5);
});

test('expanding the room does not mutate existing valid pixel materials', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 14 });
  room.pixelMaterials = [{ uid: 1, xPixel: 5, yPixel: 5, material: MATERIAL_SAND }];
  applyRoomDimensionChange(room, 'widthBlocks', 40);
  assert.equal(room.pixelMaterials.length, 1);
  assert.equal(room.pixelMaterials[0].xPixel, 5);
  assert.equal(room.pixelMaterials[0].yPixel, 5);
});

test('export filters out-of-bounds pixel materials even if malformed data exists', () => {
  const room = makeRoom({ widthBlocks: 10, heightBlocks: 10 });
  room.pixelMaterials = [
    { uid: 1, xPixel: 5, yPixel: 5, material: MATERIAL_SAND },
    { uid: 2, xPixel: 9999, yPixel: 9999, material: MATERIAL_SAND }, // malformed / OOB
    { uid: 3, xPixel: -5, yPixel: 5, material: MATERIAL_SAND },
  ];
  const json = editorRoomDataToJson(room);
  assert.deepEqual(json.pixelMaterials, [{ xPixel: 5, yPixel: 5, material: MATERIAL_SAND }]);
});

// ── Part 3: pixel-level erase ────────────────────────────────────────────────

test('pixel erase removes only the exact native-pixel cell, independent of the 8x8 block grid', () => {
  const room = makeRoom();
  room.pixelMaterials = [
    { uid: 1, xPixel: 20, yPixel: 20, material: MATERIAL_SAND },
    { uid: 2, xPixel: 21, yPixel: 20, material: MATERIAL_SAND }, // same block (2,2), different pixel
  ];
  const idx = room.pixelMaterials.findIndex(p => p.xPixel === 20 && p.yPixel === 20);
  room.pixelMaterials.splice(idx, 1);
  assert.equal(room.pixelMaterials.length, 1);
  assert.equal(room.pixelMaterials[0].xPixel, 21);
});

// ── Part 4: dynamic solid-mask sync ──────────────────────────────────────────

function makeSandWorld(): ReturnType<typeof createWorldState> {
  const world = createWorldState(1000 / 60, 1);
  world.worldWidthWorld = 40;
  world.worldHeightWorld = 40;
  world.pixelMaterialSystem = new PixelMaterialSystem(40, 40, new SolidMask(40, 40));
  return world;
}

test('sand sleeps on a support, wakes and falls when the support (crumble block) is destroyed', () => {
  const world = makeSandWorld();
  const wi = world.wallCount++;
  world.wallXWorld[wi] = 0; world.wallYWorld[wi] = 20; world.wallWWorld[wi] = 40; world.wallHWorld[wi] = 8;
  world.crumbleBlockWallIndex[world.crumbleBlockCount] = wi;
  world.crumbleBlockCount++;
  world.pixelMaterialSystem.solid = buildSolidMaskFromWorld(world, 40, 40);

  world.pixelMaterialSystem.place(10, 0, MATERIAL_SAND);
  for (let i = 0; i < 100; i++) {
    syncPixelMaterialSolidGeometry(world);
    world.pixelMaterialSystem.step();
  }
  assert.equal(world.pixelMaterialSystem.getMaterialAt(10, 19), MATERIAL_SAND);
  assert.equal(world.pixelMaterialSystem.activeCount, 0); // asleep

  // Destroy the crumble block (as sim/hazards.ts does — zero the wall rect).
  world.wallWWorld[wi] = 0;
  world.wallHWorld[wi] = 0;

  syncPixelMaterialSolidGeometry(world);
  assert.equal(world.pixelMaterialSystem.activeCount, 1); // woken by the sync

  for (let i = 0; i < 30; i++) {
    syncPixelMaterialSolidGeometry(world);
    world.pixelMaterialSystem.step();
  }
  assert.equal(world.pixelMaterialSystem.isOccupied(10, 19), false);
  assert.ok(world.pixelMaterialSystem.getMaterialAt(10, 39) === MATERIAL_SAND); // fell to the floor (room bound)
});

test('adding solid support (falling block landing) prevents sand from entering the new solid area', () => {
  const world = makeSandWorld();
  world.pixelMaterialSystem.solid = buildSolidMaskFromWorld(world, 40, 40);
  world.pixelMaterialSystem.place(10, 0, MATERIAL_SAND);

  // Simulate a falling block's wall slot appearing mid-room-life.
  const wi = world.wallCount++;
  world.fallingBlockGroups.push({ wallIndex: wi } as unknown as (typeof world.fallingBlockGroups)[number]);
  world.wallXWorld[wi] = 0; world.wallYWorld[wi] = 15; world.wallWWorld[wi] = 40; world.wallHWorld[wi] = 8;

  syncPixelMaterialSolidGeometry(world);
  for (let i = 0; i < 30; i++) {
    syncPixelMaterialSolidGeometry(world);
    world.pixelMaterialSystem.step();
  }
  assert.equal(world.pixelMaterialSystem.isOccupied(10, 15), false);
  assert.equal(world.pixelMaterialSystem.getMaterialAt(10, 14), MATERIAL_SAND);
});

test('notifySolidGeometryChanged wakes sleeping particles within the given bounds only', () => {
  const world = makeSandWorld();
  world.pixelMaterialSystem.solid = buildSolidMaskFromWorld(world, 40, 40);
  const wi = world.wallCount++;
  world.wallXWorld[wi] = 0; world.wallYWorld[wi] = 20; world.wallWWorld[wi] = 40; world.wallHWorld[wi] = 8;
  world.pixelMaterialSystem.solid = buildSolidMaskFromWorld(world, 40, 40);
  world.pixelMaterialSystem.place(5, 19, MATERIAL_SAND);
  world.pixelMaterialSystem.place(35, 19, MATERIAL_SAND);
  for (let i = 0; i < 30; i++) world.pixelMaterialSystem.step();
  assert.equal(world.pixelMaterialSystem.activeCount, 0);

  notifySolidGeometryChanged(world, { x0: 0, y0: 15, x1: 10, y1: 22 });
  // Only the particle within bounds should wake.
  let awakeAtFive = false;
  let awakeAtThirtyFive = false;
  world.pixelMaterialSystem.forEachParticle((x, _y, _m, active) => {
    if (x === 5 && active) awakeAtFive = true;
    if (x === 35 && active) awakeAtThirtyFive = true;
  });
  assert.equal(awakeAtFive, true);
  assert.equal(awakeAtThirtyFive, false);
});

// ── Part 6: movement-driven wind ─────────────────────────────────────────────

test('a stationary cluster emits no wind impulses', () => {
  const world = makeSandWorld();
  const player = createClusterState(1, 10, 10, 1, 10);
  world.clusters.push(player);
  world.pixelMaterialSystem.resetWindDiagnostics();
  applyMovementWindToPixelMaterials(world);
  assert.equal(world.pixelMaterialSystem.windImpulsesThisTick, 0);
});

test('a fast-moving player emits wind impulses above the movement threshold', () => {
  const world = makeSandWorld();
  const player = createClusterState(1, 10, 10, 1, 10);
  player.velocityXWorld = 300;
  world.clusters.push(player);
  world.pixelMaterialSystem.resetWindDiagnostics();
  applyMovementWindToPixelMaterials(world);
  assert.ok(world.pixelMaterialSystem.windImpulsesThisTick > 0);
});

test('a fast-moving enemy emits wind through the same movement-emitter path as the player', () => {
  const world = makeSandWorld();
  const enemy = createClusterState(2, 10, 10, 0, 10);
  enemy.velocityXWorld = -300;
  world.clusters.push(enemy);
  world.pixelMaterialSystem.resetWindDiagnostics();
  applyMovementWindToPixelMaterials(world);
  assert.ok(world.pixelMaterialSystem.windImpulsesThisTick > 0);
});

test('resting sand near a fast-moving entity is disturbed (woken) by movement wind', () => {
  const world = makeSandWorld();
  world.pixelMaterialSystem.solid = buildSolidMaskFromWorld(world, 40, 40);
  const wi = world.wallCount++;
  world.wallXWorld[wi] = 0; world.wallYWorld[wi] = 20; world.wallWWorld[wi] = 40; world.wallHWorld[wi] = 8;
  world.pixelMaterialSystem.solid = buildSolidMaskFromWorld(world, 40, 40);
  // Place already resting on the floor (row 19) so it only needs the sleep
  // delay, not fall time, before the wind-disturbance assertion below.
  world.pixelMaterialSystem.place(10, 19, MATERIAL_SAND);
  for (let i = 0; i < 30; i++) world.pixelMaterialSystem.step();
  assert.equal(world.pixelMaterialSystem.activeCount, 0);

  const player = createClusterState(1, 10, 19, 1, 10);
  player.velocityXWorld = 300;
  world.clusters.push(player);
  applyMovementWindToPixelMaterials(world);

  assert.equal(world.pixelMaterialSystem.activeCount, 1);
});

test('sand far away from a moving entity is not disturbed by local movement wind', () => {
  const world = makeSandWorld();
  world.pixelMaterialSystem.solid = buildSolidMaskFromWorld(world, 40, 40);
  const wi = world.wallCount++;
  world.wallXWorld[wi] = 0; world.wallYWorld[wi] = 20; world.wallWWorld[wi] = 40; world.wallHWorld[wi] = 8;
  world.pixelMaterialSystem.solid = buildSolidMaskFromWorld(world, 40, 40);
  // Place already resting (row 19) at the far edge of the room.
  world.pixelMaterialSystem.place(39, 19, MATERIAL_SAND);
  for (let i = 0; i < 30; i++) world.pixelMaterialSystem.step();
  assert.equal(world.pixelMaterialSystem.activeCount, 0);

  const player = createClusterState(1, 2, 19, 1, 10);
  player.velocityXWorld = 300;
  world.clusters.push(player);
  applyMovementWindToPixelMaterials(world);

  assert.equal(world.pixelMaterialSystem.activeCount, 0);
});

test('sand settles again under gravity after movement wind stops', () => {
  const world = makeSandWorld();
  world.pixelMaterialSystem.solid = buildSolidMaskFromWorld(world, 40, 40);
  const wi = world.wallCount++;
  world.wallXWorld[wi] = 0; world.wallYWorld[wi] = 20; world.wallWWorld[wi] = 40; world.wallHWorld[wi] = 8;
  world.pixelMaterialSystem.solid = buildSolidMaskFromWorld(world, 40, 40);
  world.pixelMaterialSystem.place(10, 19, MATERIAL_SAND);
  for (let i = 0; i < 30; i++) world.pixelMaterialSystem.step();
  assert.equal(world.pixelMaterialSystem.activeCount, 0);

  const player = createClusterState(1, 10, 19, 1, 10);
  player.velocityXWorld = 300;
  world.clusters.push(player);
  applyMovementWindToPixelMaterials(world);
  assert.equal(world.pixelMaterialSystem.activeCount, 1);

  // Movement stops (velocity back to 0) — no further wind after this point.
  // The push may have slid the grain sideways along the floor before it
  // resettles; only the "asleep again, still on the floor row" behavior is
  // asserted, not its exact resting column.
  player.velocityXWorld = 0;
  for (let i = 0; i < 100; i++) {
    world.pixelMaterialSystem.step();
  }
  assert.equal(world.pixelMaterialSystem.activeCount, 0);
  assert.equal(world.pixelMaterialSystem.occupiedCount, 1);
  let restingRow = -1;
  world.pixelMaterialSystem.forEachParticle((_x, y) => { restingRow = y; });
  assert.equal(restingRow, 19);
});

// ── Footprint abstraction (Part 8) sanity ───────────────────────────────────

test('getMaterialFootprintSize / place() keep 1x1 sand behavior identical', () => {
  const system = new PixelMaterialSystem(10, 10, new SolidMask(10, 10));
  assert.equal(system.place(3, 3, MATERIAL_SAND), true);
  assert.equal(system.place(3, 3, MATERIAL_SAND), false);
  assert.equal(system.occupiedCount, 1);
});
