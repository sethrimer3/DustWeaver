import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { applyHeraldAI, steerHeraldMovement } from '../sim/clusters/heraldAi';
import {
  clearPhantasmalGeometry,
  collectPhantasmalSpikeSurfaceCandidates,
  spawnPhantasmalBlocks,
  spawnPhantasmalSpikes,
  spawnVoidSphere,
  tickPhantasmalGeometry,
  tickVoidSpheres,
} from '../sim/clusters/heraldEffects';
import { applyVoidLensDistortion } from '../render/effects/voidLensDistortion';
import {
  HERALD_ATTACK_COOLDOWN_TICKS,
  HERALD_CAST_TICKS,
  HERALD_RECOVER_TICKS,
  HERALD_ROOM_MARGIN,
  MAX_PHANTASMAL_BLOCKS,
  MAX_PHANTASMAL_SPIKES,
  MAX_VOID_SPHERES,
  PHANTASMAL_BLOCK_BREAK_SPEED,
  PHANTASMAL_BLOCK_FORM_TICKS,
  PHANTASMAL_BLOCK_LIFETIME_TICKS,
  PHANTASMAL_SPIKE_TELEGRAPH_TICKS,
  VOID_HERALD_BOSS_NAME,
  VOID_SPHERE_BOUNDS_MARGIN_WORLD,
  VOID_SPHERE_LIFETIME_TICKS,
  VOID_SPHERE_SPEED_WORLD,
} from '../sim/clusters/heraldConfig';

function addWall(world: ReturnType<typeof createWorldState>, x: number, y: number, w: number, h: number): void {
  const i = world.wallCount++;
  world.wallXWorld[i] = x;
  world.wallYWorld[i] = y;
  world.wallWWorld[i] = w;
  world.wallHWorld[i] = h;
}

function countAlive(flags: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === 1) count += 1;
  }
  return count;
}

test('canonical boss name is The Void Herald', () => {
  assert.equal(VOID_HERALD_BOSS_NAME, 'The Void Herald');
});

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

test('Phantasmal Spike placement uses exposed solid surfaces', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 200;
  world.worldHeightWorld = 160;
  addWall(world, 40, 100, 96, 12);
  const player = createClusterState(1, 20, 20, 1, 10);
  const candidates = collectPhantasmalSpikeSurfaceCandidates(world, player);

  assert.ok(candidates.length > 0);
  assert.ok(candidates.some((c) => c.direction === 0 && c.yWorld < 100));
  assert.ok(candidates.every((c) => c.xWorld >= 0 && c.xWorld <= world.worldWidthWorld));
});

test('Phantasmal Spikes telegraph before damaging and then expire', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 200;
  world.worldHeightWorld = 160;
  addWall(world, 40, 100, 96, 12);
  const player = createClusterState(1, 88, 91, 1, 10);
  world.clusters.push(player);
  const spawned = spawnPhantasmalSpikes(world, 1);
  assert.equal(spawned, 1);
  world.phantasmalSpikeXWorld[0] = player.positionXWorld;
  world.phantasmalSpikeYWorld[0] = player.positionYWorld;

  tickPhantasmalGeometry(world);
  assert.equal(player.invulnerabilityTicks, 0);

  world.phantasmalSpikeAgeTicks[0] = PHANTASMAL_SPIKE_TELEGRAPH_TICKS;
  tickPhantasmalGeometry(world);
  assert.ok(player.invulnerabilityTicks > 0);

  player.invulnerabilityTicks = 0;
  for (let i = 0; i < 200; i++) tickPhantasmalGeometry(world);
  assert.equal(world.phantasmalSpikeAliveFlag[0], 0);
});

test('Phantasmal Blocks spawn around the boss and expire', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 240;
  world.worldHeightWorld = 180;
  const player = createClusterState(1, 30, 30, 1, 10);
  const boss = createClusterState(2, 120, 90, 0, 40);
  boss.isHeraldFlag = 1;
  world.clusters.push(player, boss);

  const spawned = spawnPhantasmalBlocks(world, boss, player, 3);
  assert.ok(spawned > 0);
  assert.ok(countAlive(world.phantasmalBlockAliveFlag) <= MAX_PHANTASMAL_BLOCKS);
  assert.notEqual(world.phantasmalBlockXWorld[0], boss.positionXWorld);

  for (let i = 0; i < PHANTASMAL_BLOCK_LIFETIME_TICKS + 1; i++) tickPhantasmalGeometry(world);
  assert.equal(countAlive(world.phantasmalBlockAliveFlag), 0);
});

test('Phantasmal Block low-speed impact resists without breaking', () => {
  const world = createWorldState(1000 / 60, 123);
  const player = createClusterState(1, 80, 80, 1, 10);
  const boss = createClusterState(2, 120, 80, 0, 40);
  world.clusters.push(player, boss);
  spawnPhantasmalBlocks(world, boss, player, 1);
  world.phantasmalBlockXWorld[0] = player.positionXWorld;
  world.phantasmalBlockYWorld[0] = player.positionYWorld;
  world.phantasmalBlockAgeTicks[0] = PHANTASMAL_BLOCK_FORM_TICKS;
  player.velocityXWorld = PHANTASMAL_BLOCK_BREAK_SPEED - 40;

  tickPhantasmalGeometry(world);
  assert.equal(world.phantasmalBlockAliveFlag[0], 1);
  assert.ok(world.phantasmalBlockFlashTicks[0] > 0);
});

test('Phantasmal Block high-speed impact breaks and shoves away', () => {
  const world = createWorldState(1000 / 60, 123);
  const player = createClusterState(1, 90, 80, 1, 10);
  const boss = createClusterState(2, 120, 80, 0, 40);
  world.clusters.push(player, boss);
  spawnPhantasmalBlocks(world, boss, player, 1);
  world.phantasmalBlockXWorld[0] = 80;
  world.phantasmalBlockYWorld[0] = 80;
  world.phantasmalBlockAgeTicks[0] = PHANTASMAL_BLOCK_FORM_TICKS;
  player.velocityXWorld = PHANTASMAL_BLOCK_BREAK_SPEED + 20;

  tickPhantasmalGeometry(world);
  assert.equal(world.phantasmalBlockAliveFlag[0], 0);
  assert.equal(countAlive(world.phantasmalShockwaveAliveFlag), 1);
  assert.ok(player.velocityXWorld > PHANTASMAL_BLOCK_BREAK_SPEED);
});

test('Phantasmal Block shockwave direction is stable at block center', () => {
  const world = createWorldState(1000 / 60, 123);
  const player = createClusterState(1, 80, 80, 1, 10);
  const boss = createClusterState(2, 120, 80, 0, 40);
  world.clusters.push(player, boss);
  spawnPhantasmalBlocks(world, boss, player, 1);
  world.phantasmalBlockXWorld[0] = 80;
  world.phantasmalBlockYWorld[0] = 80;
  world.phantasmalBlockAgeTicks[0] = PHANTASMAL_BLOCK_FORM_TICKS;
  player.velocityXWorld = 0;
  player.velocityYWorld = PHANTASMAL_BLOCK_BREAK_SPEED + 5;

  tickPhantasmalGeometry(world);
  assert.ok(Number.isFinite(player.velocityXWorld));
  assert.ok(Number.isFinite(player.velocityYWorld));
  assert.ok(Math.abs(player.velocityYWorld) > PHANTASMAL_BLOCK_BREAK_SPEED);
});

test('Phantasmal Geometry cleanup clears spikes blocks and shockwaves', () => {
  const world = createWorldState(1000 / 60, 123);
  world.phantasmalSpikeAliveFlag[0] = 1;
  world.phantasmalBlockAliveFlag[0] = 1;
  world.phantasmalShockwaveAliveFlag[0] = 1;

  clearPhantasmalGeometry(world);

  assert.equal(countAlive(world.phantasmalSpikeAliveFlag), 0);
  assert.equal(countAlive(world.phantasmalBlockAliveFlag), 0);
  assert.equal(countAlive(world.phantasmalShockwaveAliveFlag), 0);
});

test('Active Phantasmal Geometry counts stay capped', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 320;
  world.worldHeightWorld = 220;
  addWall(world, 20, 140, 240, 12);
  const boss = createClusterState(2, 160, 80, 0, 40);
  const spikes = spawnPhantasmalSpikes(world, MAX_PHANTASMAL_SPIKES + 20);
  const blocks = spawnPhantasmalBlocks(world, boss, undefined, MAX_PHANTASMAL_BLOCKS + 20);

  assert.ok(spikes <= MAX_PHANTASMAL_SPIKES);
  assert.ok(blocks <= MAX_PHANTASMAL_BLOCKS);
  assert.equal(world.phantasmalSpikeAliveFlag.length, MAX_PHANTASMAL_SPIKES);
  assert.equal(world.phantasmalBlockAliveFlag.length, MAX_PHANTASMAL_BLOCKS);
});
