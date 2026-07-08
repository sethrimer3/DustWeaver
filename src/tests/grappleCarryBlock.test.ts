import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState, BLOCK_SIZE_MEDIUM } from '../sim/world';
import type { WorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { fireGrapple, applyGrappleClusterConstraint } from '../sim/clusters/grapple';
import {
  GRAPPLE_CARRY_BLOCK_SIZE_WORLD,
  findGrappleCarryBlockRayHit,
  isGrappleCarryBlockPinnedToward,
  tickGrappleCarryBlocks,
} from '../sim/grappleCarryBlocks';
import { resolveClusterSolidWallCollision } from '../sim/clusters/movementCollision';
import { editorRoomDataToJson, jsonToEditorRoomData } from '../editor/roomJson';
import type { EditorRoomData } from '../editor/editorState';

function addWall(world: WorldState, x: number, y: number, w: number, h: number): void {
  const i = world.wallCount++;
  world.wallXWorld[i] = x;
  world.wallYWorld[i] = y;
  world.wallWWorld[i] = w;
  world.wallHWorld[i] = h;
}

function addCarryBlock(world: WorldState, x: number, y: number): void {
  const i = world.grappleCarryBlockCount++;
  world.grappleCarryBlockXWorld[i] = x;
  world.grappleCarryBlockYWorld[i] = y;
  world.grappleCarryBlockVelXWorld[i] = 0;
  world.grappleCarryBlockVelYWorld[i] = 0;
  world.grappleCarryBlockGroundedFlag[i] = 0;
  world.grappleCarryBlockContactFlags[i] = 0;
}

function addPhantasmalTile(world: WorldState, xBlock: number, yBlock: number): void {
  const i = world.phantasmalTileCount++;
  world.phantasmalTileXWorld[i] = xBlock * BLOCK_SIZE_MEDIUM;
  world.phantasmalTileYWorld[i] = yBlock * BLOCK_SIZE_MEDIUM;
}

test('grapple-carry block falls under gravity and rests on a normal solid floor', () => {
  const world = createWorldState(1000 / 60, 123);
  addWall(world, 0, 80, 160, 8);
  addCarryBlock(world, 40, 24);

  for (let i = 0; i < 90; i++) tickGrappleCarryBlocks(world);

  assert.equal(world.grappleCarryBlockGroundedFlag[0], 1);
  assert.equal(world.grappleCarryBlockVelYWorld[0], 0);
  assert.equal(
    world.grappleCarryBlockYWorld[0],
    80 - GRAPPLE_CARRY_BLOCK_SIZE_WORLD * 0.5,
  );
});

test('grapple-carry block collides with side walls without tunneling', () => {
  const world = createWorldState(1000 / 60, 123);
  addWall(world, 96, 0, 8, 160);
  addCarryBlock(world, 32, 40);
  world.grappleCarryBlockVelXWorld[0] = 500;

  for (let i = 0; i < 20; i++) tickGrappleCarryBlocks(world);

  assert.equal(world.grappleCarryBlockVelXWorld[0], 0);
  assert.equal(
    world.grappleCarryBlockXWorld[0],
    96 - GRAPPLE_CARRY_BLOCK_SIZE_WORLD * 0.5,
  );
  assert.equal(isGrappleCarryBlockPinnedToward(world, 0, 1, 0), true);
});

test('grapple-carry block treats phantasmal tiles as solid', () => {
  const world = createWorldState(1000 / 60, 123);
  addPhantasmalTile(world, 5, 10);
  addCarryBlock(world, 5 * BLOCK_SIZE_MEDIUM + 4, 40);

  for (let i = 0; i < 90; i++) tickGrappleCarryBlocks(world);

  assert.equal(world.grappleCarryBlockGroundedFlag[0], 1);
  assert.equal(
    world.grappleCarryBlockYWorld[0],
    10 * BLOCK_SIZE_MEDIUM - GRAPPLE_CARRY_BLOCK_SIZE_WORLD * 0.5,
  );
});

test('player collision ignores phantasmal tiles', () => {
  const world = createWorldState(1000 / 60, 123);
  addPhantasmalTile(world, 4, 4);
  const player = createClusterState(1, 4 * BLOCK_SIZE_MEDIUM + 4, 4 * BLOCK_SIZE_MEDIUM - 20, 1, 10);
  player.velocityYWorld = 240;

  resolveClusterSolidWallCollision(player, world, player.positionXWorld, player.positionYWorld, 0.25, false);

  assert.ok(player.positionYWorld > 4 * BLOCK_SIZE_MEDIUM);
  assert.equal(player.isGroundedFlag, 0);
});

test('player cannot grapple to phantasmal tiles, but can grapple to carry blocks', () => {
  const world = createWorldState(1000 / 60, 123);
  const player = createClusterState(1, 24, 44, 1, 10);
  world.clusters.push(player);
  world.hasGrappleChargeFlag = 1;
  addPhantasmalTile(world, 8, 5);

  fireGrapple(world, 8 * BLOCK_SIZE_MEDIUM + 4, 5 * BLOCK_SIZE_MEDIUM + 4);
  assert.equal(world.isGrappleActiveFlag, 0);

  addCarryBlock(world, 96, 44);
  world.hasGrappleChargeFlag = 1;
  fireGrapple(world, 128, 44);

  assert.equal(world.isGrappleActiveFlag, 1);
  assert.equal(world.grappleCarryBlockIndex, 0);
});

test('reel pulls an unobstructed carry block toward the player', () => {
  const world = createWorldState(1000 / 60, 123);
  const player = createClusterState(1, 32, 40, 1, 10);
  world.clusters.push(player);
  addCarryBlock(world, 96, 40);
  world.isGrappleActiveFlag = 1;
  world.grappleCarryBlockIndex = 0;
  world.grappleAnchorXWorld = 96;
  world.grappleAnchorYWorld = 40;
  world.grappleLengthWorld = 64;
  world.playerCrouchHeldFlag = 1;

  applyGrappleClusterConstraint(world);

  assert.ok(world.grappleCarryBlockVelXWorld[0] < 0);
  assert.equal(player.velocityXWorld, 0);
});

test('reel against a pinned carry block shortens rope for player pull instead of moving the block', () => {
  const world = createWorldState(1000 / 60, 123);
  const player = createClusterState(1, 32, 40, 1, 10);
  world.clusters.push(player);
  addWall(world, 104, 0, 8, 160);
  addCarryBlock(world, 104 - GRAPPLE_CARRY_BLOCK_SIZE_WORLD * 0.5, 40);
  world.grappleCarryBlockContactFlags[0] = 1 << 1;
  world.isGrappleActiveFlag = 1;
  world.grappleCarryBlockIndex = 0;
  world.grappleAnchorXWorld = world.grappleCarryBlockXWorld[0];
  world.grappleAnchorYWorld = 40;
  world.grappleLengthWorld = 64;
  world.playerCrouchHeldFlag = 1;

  applyGrappleClusterConstraint(world);

  assert.equal(world.grappleCarryBlockVelXWorld[0], 0);
  assert.ok(world.grappleLengthWorld < 64);
});

test('grapple targeting ray hit follows the moving carry block position', () => {
  const world = createWorldState(1000 / 60, 123);
  addCarryBlock(world, 80, 32);
  assert.notEqual(findGrappleCarryBlockRayHit(world, 16, 32, 1, 0, 120), null);

  world.grappleCarryBlockXWorld[0] = 80;
  world.grappleCarryBlockYWorld[0] = 72;
  assert.equal(findGrappleCarryBlockRayHit(world, 16, 32, 1, 0, 120), null);
  assert.notEqual(findGrappleCarryBlockRayHit(world, 16, 72, 1, 0, 120), null);
});

test('room JSON serialization preserves grapple-carry blocks and phantasmal tiles', () => {
  const room = {
    id: 'test',
    name: 'Test',
    worldNumber: 1,
    blockTheme: 'blackRock',
    backgroundId: 'brownRock',
    lightingEffect: 'Ambient',
    songId: '_continue',
    widthBlocks: 20,
    heightBlocks: 14,
    playerSpawnBlock: [2, 2],
    interiorWalls: [],
    enemies: [],
    transitions: [],
    saveTombs: [],
    skillTombs: [],
    dustPiles: [],
    grasshopperAreas: [],
    grappleCarryBlocks: [{ uid: 10, xBlock: 4, yBlock: 5 }],
    phantasmalTiles: [{ uid: 11, xBlock: 6, yBlock: 7 }],
  } as EditorRoomData;

  const json = editorRoomDataToJson(room);
  const roundTrip = jsonToEditorRoomData(json, 100).data;

  assert.deepEqual(json.grappleCarryBlocks, [{ xBlock: 4, yBlock: 5 }]);
  assert.deepEqual(json.phantasmalTiles, [{ xBlock: 6, yBlock: 7 }]);
  assert.equal(roundTrip.grappleCarryBlocks?.[0]?.xBlock, 4);
  assert.equal(roundTrip.phantasmalTiles?.[0]?.yBlock, 7);
});
