import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { PLAYER_JUMP_SPEED_WORLD, NORMAL_GRAVITY_WORLD_PER_SEC2 } from '../sim/clusters/movementConstants';
import { createClusterState } from '../sim/clusters/state';
import { applyPlayerGravityAndJump } from '../sim/clusters/playerVerticalMovement';
import {
  applyPlayerWaterHorizontalDrag,
  applyPlayerWaterVerticalForces,
  getWaterJumpSpeedWorld,
  PLAYER_WATER_STATE_OUTSIDE,
  PLAYER_WATER_STATE_SUBMERGED,
  PLAYER_WATER_STATE_SURFACE,
} from '../sim/clusters/playerWaterPhysics';
import { MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED } from '../sim/momentumCombatConfig';
import { applyHazards, computePlayerWaterState } from '../sim/hazards';
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

describe('configured submerged velocity model', () => {
  test('a stationary submerged player gradually begins moving upward', () => {
    const world = createPlayerWorld(120);
    const player = world.clusters[0];
    computePlayerWaterState(world);

    applyPlayerWaterVerticalForces(player, world, DT_MS / 1000);

    assert.ok(player.velocityYWorld < 0);
    assert.ok(player.velocityYWorld > -10, 'one tick should begin a gradual rise, not launch the player');
  });

  test('normal submerged forces do not accelerate a stationary player downward', () => {
    const world = createPlayerWorld(120);
    const player = world.clusters[0];
    computePlayerWaterState(world);

    for (let i = 0; i < 30; i++) {
      applyPlayerWaterVerticalForces(player, world, DT_MS / 1000);
    }

    assert.ok(player.velocityYWorld < 0);
  });

  test('downward entry momentum is softened progressively instead of stopped', () => {
    const world = createPlayerWorld(120);
    const player = world.clusters[0];
    player.velocityYWorld = 240;
    computePlayerWaterState(world);

    applyPlayerWaterVerticalForces(player, world, DT_MS / 1000);

    assert.ok(player.velocityYWorld > 0);
    assert.ok(player.velocityYWorld < 240);
  });

  test('horizontal velocity decays while submerged', () => {
    const world = createPlayerWorld(120);
    const player = world.clusters[0];
    player.velocityXWorld = 180;

    applyPlayerWaterHorizontalDrag(player, DT_MS / 1000);

    assert.ok(player.velocityXWorld > 0);
    assert.ok(player.velocityXWorld < 180);
  });

  test('fast upward velocity also experiences vertical resistance', () => {
    const world = createPlayerWorld(120);
    const player = world.clusters[0];
    player.velocityYWorld = -300;
    computePlayerWaterState(world);

    applyPlayerWaterVerticalForces(player, world, DT_MS / 1000);

    assert.ok(player.velocityYWorld > -300);
  });

  test('drag and buoyancy are consistent across timestep subdivision', () => {
    const wholeStepWorld = createPlayerWorld(120);
    const splitStepWorld = createPlayerWorld(120);
    const wholeStepPlayer = wholeStepWorld.clusters[0];
    const splitStepPlayer = splitStepWorld.clusters[0];
    wholeStepPlayer.velocityYWorld = splitStepPlayer.velocityYWorld = 175;
    wholeStepPlayer.velocityXWorld = splitStepPlayer.velocityXWorld = -140;
    computePlayerWaterState(wholeStepWorld);
    computePlayerWaterState(splitStepWorld);

    applyPlayerWaterVerticalForces(wholeStepPlayer, wholeStepWorld, DT_MS / 1000);
    applyPlayerWaterHorizontalDrag(wholeStepPlayer, DT_MS / 1000);
    applyPlayerWaterVerticalForces(splitStepPlayer, splitStepWorld, DT_MS / 2000);
    applyPlayerWaterHorizontalDrag(splitStepPlayer, DT_MS / 2000);
    applyPlayerWaterVerticalForces(splitStepPlayer, splitStepWorld, DT_MS / 2000);
    applyPlayerWaterHorizontalDrag(splitStepPlayer, DT_MS / 2000);

    assert.ok(Math.abs(wholeStepPlayer.velocityXWorld - splitStepPlayer.velocityXWorld) < 1e-9);
    assert.ok(Math.abs(wholeStepPlayer.velocityYWorld - splitStepPlayer.velocityYWorld) < 1e-9);
  });
});

describe('non-additive repeated water jumps', () => {
  test('a water jump restores half normal jump speed from slower upward motion', () => {
    const world = createPlayerWorld(120);
    const player = world.clusters[0];
    world.playerJumpTriggeredFlag = 1;
    computePlayerWaterState(world);

    applyPlayerGravityAndJump(player, world, DT_MS / 1000);

    assert.equal(player.velocityYWorld, -getWaterJumpSpeedWorld());
  });

  test('a water jump adds nothing when already moving upward faster than the threshold', () => {
    const jumpedWorld = createPlayerWorld(120);
    const controlWorld = createPlayerWorld(120);
    jumpedWorld.clusters[0].velocityYWorld = -220;
    controlWorld.clusters[0].velocityYWorld = -220;
    jumpedWorld.playerJumpTriggeredFlag = 1;
    computePlayerWaterState(jumpedWorld);
    computePlayerWaterState(controlWorld);

    applyPlayerGravityAndJump(jumpedWorld.clusters[0], jumpedWorld, DT_MS / 1000);
    applyPlayerGravityAndJump(controlWorld.clusters[0], controlWorld, DT_MS / 1000);

    assert.ok(Math.abs(
      jumpedWorld.clusters[0].velocityYWorld - controlWorld.clusters[0].velocityYWorld,
    ) < 1e-9);
  });

  test('repeated water jumps restore but never stack the half-strength velocity', () => {
    const world = createPlayerWorld(120);
    const player = world.clusters[0];
    computePlayerWaterState(world);

    for (let i = 0; i < 5; i++) {
      world.playerJumpTriggeredFlag = 1;
      applyPlayerGravityAndJump(player, world, DT_MS / 1000);
      assert.equal(player.velocityYWorld, -getWaterJumpSpeedWorld());
    }
  });

  test('water jumping does not require grounded or coyote state', () => {
    const world = createPlayerWorld(120);
    const player = world.clusters[0];
    player.isGroundedFlag = 0;
    player.coyoteTimeTicks = 0;
    world.playerJumpTriggeredFlag = 1;
    computePlayerWaterState(world);

    applyPlayerGravityAndJump(player, world, DT_MS / 1000);

    assert.equal(player.velocityYWorld, -PLAYER_JUMP_SPEED_WORLD * 0.5);
  });
});

describe('stable surface classification and float equilibrium', () => {
  test('submerged and surface states use hysteresis instead of alternating near one threshold', () => {
    const world = createPlayerWorld(102); // 60% submerged
    computePlayerWaterState(world);
    assert.equal(world.playerWaterState, PLAYER_WATER_STATE_SUBMERGED);

    world.clusters[0].positionYWorld = 98; // 40%, above exit threshold
    computePlayerWaterState(world);
    assert.equal(world.playerWaterState, PLAYER_WATER_STATE_SUBMERGED);

    world.clusters[0].positionYWorld = 97; // 35%, still at exit boundary
    computePlayerWaterState(world);
    assert.equal(world.playerWaterState, PLAYER_WATER_STATE_SUBMERGED);

    world.clusters[0].positionYWorld = 96; // 30%, leaves submerged state
    computePlayerWaterState(world);
    assert.equal(world.playerWaterState, PLAYER_WATER_STATE_SURFACE);

    world.clusters[0].positionYWorld = 100; // 50%, below re-entry threshold
    computePlayerWaterState(world);
    assert.equal(world.playerWaterState, PLAYER_WATER_STATE_SURFACE);
  });

  test('upper-surface entry and exit publish one deterministic visual event each', () => {
    const world = createPlayerWorld(89);
    const player = world.clusters[0];
    computePlayerWaterState(world);
    assert.equal(world.playerWaterState, 0);

    player.velocityYWorld = 90;
    player.positionYWorld = 92;
    applyHazards(world);
    assert.equal(world.playerWaterSurfaceEventSequence, 1);
    assert.equal(world.playerWaterSurfaceEventKind, 1);
    assert.equal(world.playerWaterSurfaceEventYWorld, 100);

    computePlayerWaterState(world);
    player.velocityYWorld = -120;
    player.positionYWorld = 88;
    applyHazards(world);
    assert.equal(world.playerWaterSurfaceEventSequence, 2);
    assert.equal(world.playerWaterSurfaceEventKind, 2);
    assert.equal(world.playerWaterSurfaceEventYWorld, 100);
  });

  test('passive buoyancy reaches a stable exposed surface position without trapping below it', () => {
    const world = createPlayerWorld(145);
    const player = world.clusters[0];
    let outsideTransitions = 0;
    let previousInWater = 1;

    for (let i = 0; i < 600; i++) {
      computePlayerWaterState(world);
      applyPlayerGravityAndJump(player, world, DT_MS / 1000);
      player.positionYWorld += player.velocityYWorld * DT_MS / 1000;
      computePlayerWaterState(world);
      if (previousInWater === 1 && world.isPlayerInWaterFlag === 0) outsideTransitions += 1;
      previousInWater = world.isPlayerInWaterFlag;
    }

    assert.equal(world.playerWaterState, PLAYER_WATER_STATE_SURFACE);
    assert.ok(player.positionYWorld - player.halfHeightWorld < 100, 'the player upper body should clear the surface');
    assert.ok(Math.abs(player.velocityYWorld) < 0.5, 'surface equilibrium should settle without jitter');
    assert.ok(outsideTransitions <= 1, 'passive buoyancy should not repeatedly bounce across the surface');
  });
});

describe('stone-skip water bounce', () => {
  test('a shallow, fast impact skips off the surface instead of submerging', () => {
    const world = createPlayerWorld(89);
    const player = world.clusters[0];
    computePlayerWaterState(world);

    player.velocityXWorld = 300;
    player.velocityYWorld = 100; // atan2(100, 300) ≈ 18.4° — shallow
    player.positionYWorld = 92;
    applyHazards(world);

    assert.equal(world.playerWaterSkipEventSequence, 1);
    assert.ok(player.velocityYWorld < 0, 'vertical velocity should flip upward');
    assert.ok(Math.abs(player.velocityYWorld + 100) < 1e-9, 'incoming vy should mirror exactly (no steepening needed)');
    assert.equal(world.isPlayerInWaterFlag, 0, 'the player should not actually enter the water');
    assert.equal(world.playerWaterState, PLAYER_WATER_STATE_OUTSIDE);
  });

  test('a steep impact (>= 45 degrees) submerges normally instead of skipping', () => {
    const world = createPlayerWorld(89);
    const player = world.clusters[0];
    computePlayerWaterState(world);

    player.velocityXWorld = 50;
    player.velocityYWorld = 300; // atan2(300, 50) ≈ 80.5° — steep
    player.positionYWorld = 92;
    applyHazards(world);

    assert.equal(world.playerWaterSkipEventSequence, 0, 'no skip event should fire');
    assert.equal(player.velocityYWorld, 300, 'velocity should be untouched by the skip logic');
    assert.equal(world.isPlayerInWaterFlag, 1);
  });

  test('a shallow but slow impact (below invulnerability speed) submerges normally', () => {
    const world = createPlayerWorld(89);
    const player = world.clusters[0];
    computePlayerWaterState(world);

    const belowThreshold = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED - 50;
    player.velocityXWorld = belowThreshold;
    player.velocityYWorld = 20; // shallow angle, but total speed is below the skip threshold
    assert.ok(Math.hypot(player.velocityXWorld, player.velocityYWorld) < MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED);
    player.positionYWorld = 92;
    applyHazards(world);

    assert.equal(world.playerWaterSkipEventSequence, 0, 'no skip event should fire below the speed threshold');
    assert.equal(player.velocityYWorld, 20);
    assert.equal(world.isPlayerInWaterFlag, 1);
  });

  test('a near-flat impact is steepened to the minimum 5 degree launch angle', () => {
    const world = createPlayerWorld(89);
    const player = world.clusters[0];
    computePlayerWaterState(world);

    player.velocityXWorld = 500;
    player.velocityYWorld = 10; // atan2(10, 500) ≈ 1.1° — almost flat
    player.positionYWorld = 92;
    applyHazards(world);

    assert.equal(world.playerWaterSkipEventSequence, 1);
    const expectedMinVy = -500 * Math.tan((5 * Math.PI) / 180);
    assert.ok(Math.abs(player.velocityYWorld - expectedMinVy) < 1e-6, 'launch should be steepened to the 5° minimum');
    assert.ok(player.velocityYWorld < -10, 'the steepened launch should exceed the raw mirrored vy');
  });

  test('the skip event carries the incoming impact velocity for the droplet spray', () => {
    const world = createPlayerWorld(89);
    const player = world.clusters[0];
    computePlayerWaterState(world);

    player.velocityXWorld = 300;
    player.velocityYWorld = 100;
    player.positionYWorld = 92;
    applyHazards(world);

    assert.equal(world.playerWaterSkipEventVelocityXWorld, 300);
    assert.equal(world.playerWaterSkipEventVelocityYWorld, 100);
    assert.equal(world.playerWaterSkipEventXWorld, player.positionXWorld);
  });
});
