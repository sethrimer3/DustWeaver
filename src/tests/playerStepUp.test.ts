import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
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
