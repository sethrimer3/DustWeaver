import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { PLAYER_JUMP_SPEED_WORLD, NORMAL_GRAVITY_WORLD_PER_SEC2 } from '../sim/clusters/movementConstants';
import { createClusterState } from '../sim/clusters/state';
import { applyPlayerGravityAndJump } from '../sim/clusters/playerVerticalMovement';
import { computePlayerWaterState } from '../sim/hazards';
import { createWorldState, type WorldState } from '../sim/world';

const DT_MS = 1000 / 60;

function createPlayerWorld(playerYWorld: number): WorldState {
  const world = createWorldState(DT_MS, 123);
  const player = createClusterState(1, 100, playerYWorld, 1, 10);
  world.clusters.push(player);
  world.waterZoneCount = 1;
  world.waterZoneXWorld[0] = 80;
  world.waterZoneYWorld[0] = 100;
  world.waterZoneWWorld[0] = 40;
  world.waterZoneHWorld[0] = 100;
  return world;
}

describe('player water contact characterization', () => {
  test('a player whose feet only touch the surface remains outside water', () => {
    const world = createPlayerWorld(90);

    computePlayerWaterState(world);

    assert.equal(world.isPlayerInWaterFlag, 0);
    assert.equal(world.playerWaterSubmersionRatio, 0);
  });

  test('a shallow AABB overlap is detected before the player center enters water', () => {
    const world = createPlayerWorld(91);

    computePlayerWaterState(world);

    assert.equal(world.isPlayerInWaterFlag, 1);
    assert.ok(Math.abs(world.playerWaterSubmersionRatio - 0.05) < 1e-9);
  });

  test('a fully covered player reports full submersion', () => {
    const world = createPlayerWorld(120);

    computePlayerWaterState(world);

    assert.equal(world.isPlayerInWaterFlag, 1);
    assert.equal(world.playerWaterSubmersionRatio, 1);
  });
});

describe('movement behavior outside water characterization', () => {
  test('airborne gravity keeps the normal configured acceleration', () => {
    const world = createPlayerWorld(50);
    const player = world.clusters[0];
    computePlayerWaterState(world);

    applyPlayerGravityAndJump(player, world, DT_MS / 1000);

    const expectedVelocity = NORMAL_GRAVITY_WORLD_PER_SEC2 * DT_MS / 1000;
    assert.ok(Math.abs(player.velocityYWorld - expectedVelocity) < 1e-9);
  });

  test('a grounded jump still applies the full normal jump impulse', () => {
    const world = createPlayerWorld(50);
    const player = world.clusters[0];
    player.isGroundedFlag = 1;
    world.playerJumpTriggeredFlag = 1;
    computePlayerWaterState(world);

    applyPlayerGravityAndJump(player, world, DT_MS / 1000);

    assert.equal(player.velocityYWorld, -PLAYER_JUMP_SPEED_WORLD);
    assert.equal(player.isGroundedFlag, 0);
    assert.equal(world.playerJumpTriggeredFlag, 0);
  });
});
