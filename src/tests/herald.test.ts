import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { applyHeraldAI, steerHeraldMovement } from '../sim/clusters/heraldAi';
import { spawnVoidSphere, tickVoidSpheres } from '../sim/clusters/heraldEffects';
import { applyVoidLensDistortion } from '../render/effects/voidLensDistortion';
import {
  HERALD_ATTACK_COOLDOWN_TICKS,
  HERALD_CAST_TICKS,
  HERALD_RECOVER_TICKS,
  HERALD_ROOM_MARGIN,
  MAX_VOID_SPHERES,
  VOID_SPHERE_BOUNDS_MARGIN_WORLD,
  VOID_SPHERE_LIFETIME_TICKS,
  VOID_SPHERE_SPEED_WORLD,
} from '../sim/clusters/heraldConfig';

test('The Herald can be created and spawned into a world', () => {
  const world = createWorldState(1000 / 60, 123);
  const player = createClusterState(1, 40, 40, 1, 10);
  const boss = createClusterState(2, 80, 40, 0, 40);
  boss.isHeraldFlag = 1;
  world.clusters.push(player, boss);

  assert.equal(world.clusters.length, 2);
  assert.equal(world.clusters[1].isHeraldFlag, 1);
});

test('Herald idle steering clamps position to room bounds', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 160;
  world.worldHeightWorld = 120;
  const boss = createClusterState(2, 158, 60, 0, 40);
  boss.isHeraldFlag = 1;
  boss.heraldVelXWorld = 5;

  steerHeraldMovement(world, boss);

  assert.ok(boss.positionXWorld <= world.worldWidthWorld - HERALD_ROOM_MARGIN - boss.halfWidthWorld);
  assert.ok(boss.positionXWorld >= HERALD_ROOM_MARGIN + boss.halfWidthWorld);
});

test('Herald cast cycle fires a Void Sphere and returns to idle', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 200;
  world.worldHeightWorld = 160;
  const player = createClusterState(1, 40, 80, 1, 10);
  const boss = createClusterState(2, 120, 80, 0, 40);
  boss.isHeraldFlag = 1;
  boss.heraldAttackCooldownTicks = 0;
  world.clusters.push(player, boss);

  const totalTicks = HERALD_CAST_TICKS + HERALD_RECOVER_TICKS + 1;
  for (let i = 0; i < totalTicks; i++) applyHeraldAI(world);

  let aliveCount = 0;
  for (let i = 0; i < world.voidSphereAliveFlag.length; i++) {
    if (world.voidSphereAliveFlag[i] === 1) aliveCount += 1;
  }
  assert.equal(aliveCount, 1);
  assert.equal(boss.heraldAttackCooldownTicks, HERALD_ATTACK_COOLDOWN_TICKS);
});

test('Void Spheres move through walls instead of colliding with them', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 200;
  world.worldHeightWorld = 200;
  world.wallCount = 1;
  world.wallXWorld[0] = 40;
  world.wallYWorld[0] = 40;
  world.wallWWorld[0] = 40;
  world.wallHWorld[0] = 200;

  // Aim straight through the wall's footprint.
  spawnVoidSphere(world, 20, 60, 120, 60, VOID_SPHERE_SPEED_WORLD);
  for (let i = 0; i < 150; i++) tickVoidSpheres(world);

  assert.equal(world.voidSphereAliveFlag[0], 1);
  assert.ok(world.voidSphereXWorld[0] > 80, 'sphere should have passed straight through the wall x-range');
});

test('Void Spheres despawn after their lifetime expires', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 4000;
  world.worldHeightWorld = 4000;
  spawnVoidSphere(world, 100, 100, 100, 100, 0); // zero net velocity, stays in bounds
  world.voidSphereVelXWorld[0] = 0;
  world.voidSphereVelYWorld[0] = 0;

  for (let i = 0; i < VOID_SPHERE_LIFETIME_TICKS - 1; i++) tickVoidSpheres(world);
  assert.equal(world.voidSphereAliveFlag[0], 1);

  tickVoidSpheres(world);
  assert.equal(world.voidSphereAliveFlag[0], 0);
});

test('Void Spheres despawn once they leave the room bounds plus margin', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 100;
  world.worldHeightWorld = 100;
  spawnVoidSphere(world, 90, 50, 400, 50, 5);

  let ticksUntilDead = 0;
  for (let i = 0; i < 200 && world.voidSphereAliveFlag[0] === 1; i++) {
    tickVoidSpheres(world);
    ticksUntilDead += 1;
  }

  assert.equal(world.voidSphereAliveFlag[0], 0);
  assert.ok(world.voidSphereXWorld[0] >= world.worldWidthWorld + VOID_SPHERE_BOUNDS_MARGIN_WORLD - 1);
  assert.ok(ticksUntilDead < VOID_SPHERE_LIFETIME_TICKS);
});

test('Active Void Sphere count stays capped at MAX_VOID_SPHERES', () => {
  const world = createWorldState(1000 / 60, 123);
  for (let i = 0; i < MAX_VOID_SPHERES + 10; i++) {
    spawnVoidSphere(world, 50, 50, 60, 60, VOID_SPHERE_SPEED_WORLD);
  }
  let alive = 0;
  for (let i = 0; i < world.voidSphereAliveFlag.length; i++) {
    if (world.voidSphereAliveFlag[i] === 1) alive += 1;
  }
  assert.equal(alive, MAX_VOID_SPHERES);
  assert.equal(world.voidSphereAliveFlag.length, MAX_VOID_SPHERES);
});

test('Distortion render path does not crash with zero spheres', () => {
  const ctx = {
    getImageData() {
      throw new Error('should not be called when there are no circles');
    },
  } as unknown as CanvasRenderingContext2D;

  assert.doesNotThrow(() => applyVoidLensDistortion(ctx, [], 480, 270));
});
