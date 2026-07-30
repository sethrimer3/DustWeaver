import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { applyClusterMovement } from '../sim/clusters/movement';
import { createClusterState } from '../sim/clusters/state';
import { tryStepUpSingleBlock } from '../sim/clusters/movementAxisResolvers';
import { createWorldState } from '../sim/world';

function makeStepWorld(stepHeightWorld = BLOCK_SIZE_SMALL) {
  const world = createWorldState();
  const player = createClusterState(1, 10, 40, 0, 100);
  player.isPlayerFlag = 1;
  player.isGroundedFlag = 1;
  player.velocityXWorld = 100;
  world.clusters.push(player);
  world.playerMoveInputDxWorld = 1;
  const floorY = player.positionYWorld + player.halfHeightWorld;
  const wallLeft = player.positionXWorld + player.halfWidthWorld;
  const wallTop = floorY - stepHeightWorld;
  world.wallCount = 1;
  world.wallXWorld[0] = wallLeft;
  world.wallYWorld[0] = wallTop;
  world.wallWWorld[0] = BLOCK_SIZE_SMALL;
  world.wallHWorld[0] = stepHeightWorld;
  world.wallRampOrientationIndex[0] = 255;
  return { world, player, wallLeft, wallTop };
}

test('pressing into a one-tile rise climbs it smoothly over four ticks', () => {
  const { world, player, wallLeft, wallTop } = makeStepWorld();
  const startY = player.positionYWorld;
  for (let tick = 1; tick <= 4; tick++) {
    player.positionXWorld += 1;
    assert.equal(tryStepUpSingleBlock(
      player, world, wallLeft, wallLeft + BLOCK_SIZE_SMALL, wallTop, 1, true,
    ), true);
    assert.equal(player.positionYWorld, startY - tick * 2);
    if (tick < 4) assert.equal(player.positionXWorld, wallLeft - player.halfWidthWorld);
  }
  assert.equal(player.positionYWorld + player.halfHeightWorld, wallTop);
});

test('automatic step-up rejects a rise taller than one tile', () => {
  const { world, player, wallLeft, wallTop } = makeStepWorld(BLOCK_SIZE_SMALL + 1);
  player.positionXWorld += 1;
  assert.equal(tryStepUpSingleBlock(
    player, world, wallLeft, wallLeft + BLOCK_SIZE_SMALL, wallTop, 1, true,
  ), false);
});

test('automatic step-up requires input pressed into the rise', () => {
  const { world, player, wallLeft, wallTop } = makeStepWorld();
  world.playerMoveInputDxWorld = 0;
  player.positionXWorld += 1;
  assert.equal(tryStepUpSingleBlock(
    player, world, wallLeft, wallLeft + BLOCK_SIZE_SMALL, wallTop, 1, true,
  ), false);
});

test('real movement loop walks the grounded player onto a one-tile block', () => {
  const world = createWorldState();
  world.dtMs = 1000 / 60;
  world.worldWidthWorld = 160;
  world.worldHeightWorld = 100;
  world.playerMoveInputDxWorld = 1;

  const player = createClusterState(1, 20, 100, 0, 100);
  player.isPlayerFlag = 1;
  player.positionYWorld = world.worldHeightWorld - player.halfHeightWorld;
  player.isGroundedFlag = 1;
  world.clusters.push(player);

  const wallLeft = 40;
  const wallTop = world.worldHeightWorld - BLOCK_SIZE_SMALL;
  world.wallCount = 1;
  world.wallXWorld[0] = wallLeft;
  world.wallYWorld[0] = wallTop;
  world.wallWWorld[0] = BLOCK_SIZE_SMALL * 4;
  world.wallHWorld[0] = BLOCK_SIZE_SMALL;
  world.wallRampOrientationIndex[0] = 255;

  for (let tick = 0; tick < 30; tick++) {
    // The command processor rewrites held input before every simulation tick.
    world.playerMoveInputDxWorld = 1;
    applyClusterMovement(world);
    if (player.positionXWorld > wallLeft) break;
  }

  assert.ok(
    player.positionXWorld > wallLeft,
    `player should cross the block's left edge, got x=${player.positionXWorld}`,
  );
  assert.equal(player.positionYWorld + player.halfHeightWorld, wallTop);
  assert.equal(player.isGroundedFlag, 1);
});

test('real movement loop walks onto a one-tile block while moving left', () => {
  const world = createWorldState();
  world.dtMs = 1000 / 60;
  world.worldWidthWorld = 160;
  world.worldHeightWorld = 100;

  const wallLeft = 64;
  const wallRight = wallLeft + BLOCK_SIZE_SMALL * 4;
  const wallTop = world.worldHeightWorld - BLOCK_SIZE_SMALL;
  world.wallCount = 1;
  world.wallXWorld[0] = wallLeft;
  world.wallYWorld[0] = wallTop;
  world.wallWWorld[0] = wallRight - wallLeft;
  world.wallHWorld[0] = BLOCK_SIZE_SMALL;
  world.wallRampOrientationIndex[0] = 255;

  const player = createClusterState(1, wallRight + 20, 100, 0, 100);
  player.isPlayerFlag = 1;
  player.positionYWorld = world.worldHeightWorld - player.halfHeightWorld;
  player.isGroundedFlag = 1;
  world.clusters.push(player);

  for (let tick = 0; tick < 30; tick++) {
    world.playerMoveInputDxWorld = -1;
    applyClusterMovement(world);
    if (player.positionXWorld < wallRight) break;
  }

  assert.ok(
    player.positionXWorld < wallRight,
    `player should cross the block's right edge, got x=${player.positionXWorld}`,
  );
  assert.equal(player.positionYWorld + player.halfHeightWorld, wallTop);
  assert.equal(player.isGroundedFlag, 1);
});

test('step-up is not undone by a later overlapping wall record', () => {
  const world = createWorldState();
  world.dtMs = 1000 / 60;
  world.worldWidthWorld = 160;
  world.worldHeightWorld = 100;

  const player = createClusterState(1, 20, 100, 0, 100);
  player.isPlayerFlag = 1;
  player.positionYWorld = world.worldHeightWorld - player.halfHeightWorld;
  player.isGroundedFlag = 1;
  world.clusters.push(player);

  const wallTop = world.worldHeightWorld - BLOCK_SIZE_SMALL;
  world.wallCount = 2;
  world.wallXWorld[0] = 40;
  world.wallYWorld[0] = wallTop;
  world.wallWWorld[0] = 32;
  world.wallHWorld[0] = BLOCK_SIZE_SMALL;
  world.wallRampOrientationIndex[0] = 255;
  world.wallXWorld[1] = 39;
  world.wallYWorld[1] = wallTop;
  world.wallWWorld[1] = 33;
  world.wallHWorld[1] = BLOCK_SIZE_SMALL;
  world.wallRampOrientationIndex[1] = 255;

  for (let tick = 0; tick < 30; tick++) {
    world.playerMoveInputDxWorld = 1;
    applyClusterMovement(world);
    if (player.positionXWorld > 40) break;
  }

  assert.ok(player.positionXWorld > 40);
  assert.equal(player.positionYWorld + player.halfHeightWorld, wallTop);
  assert.equal(player.isGroundedFlag, 1);
});
