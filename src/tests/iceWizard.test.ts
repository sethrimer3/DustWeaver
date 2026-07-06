import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { applyIceWizardAI } from '../sim/clusters/iceWizardAi';
import {
  clearIceSpikes,
  collectIceSpikeWaveTiles,
  findIceWizardSlamFloorY,
  isValidIceBubbleSummonPosition,
  spawnIceSpikeWave,
  summonIceBubblesAroundWizard,
  tickIceSpikes,
} from '../sim/clusters/iceWizardEffects';
import {
  ICE_SPIKE_ACTIVE_TICKS,
  ICE_SPIKE_RISE_TICKS,
  ICE_SPIKE_TELEGRAPH_TICKS,
  ICE_SPIKE_TOTAL_TICKS,
  ICE_WIZARD_FOOTPRINT_TILES,
  ICE_WIZARD_HALF_H,
  ICE_WIZARD_HALF_W,
  ICE_WIZARD_HP,
  ICE_WIZARD_STATE_IDLE,
  ICE_WIZARD_STATE_SLAM_DOWN,
  ICE_WIZARD_SUMMON_RECOVERY_TICKS,
  ICE_WIZARD_SUMMON_RELEASE_TICKS,
  ICE_WIZARD_SUMMON_TELEGRAPH_TICKS,
} from '../sim/clusters/iceWizardConfig';
import { spawnIceWizardForTesting } from '../screens/gameEnemySpawn';

function addWall(world: ReturnType<typeof createWorldState>, x: number, y: number, w: number, h: number): void {
  const i = world.wallCount++;
  world.wallXWorld[i] = x;
  world.wallYWorld[i] = y;
  world.wallWWorld[i] = w;
  world.wallHWorld[i] = h;
}

function countAlive(flags: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < flags.length; i++) if (flags[i] === 1) count += 1;
  return count;
}

function countAliveIceBubbles(world: ReturnType<typeof createWorldState>): number {
  let count = 0;
  for (const cluster of world.clusters) {
    if (cluster.isAliveFlag === 1 && cluster.isBubbleEnemyFlag === 1 && cluster.isIceBubbleFlag === 1) count += 1;
  }
  return count;
}

function makeIceWizardEncounter(): { world: ReturnType<typeof createWorldState>; boss: ReturnType<typeof createClusterState> } {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 360;
  world.worldHeightWorld = 280;
  const player = createClusterState(1, 176, 180, 1, 10);
  world.clusters.push(player);
  const id = spawnIceWizardForTesting(world, 176, 136);
  const boss = world.clusters.find((c) => c.entityId === id);
  assert.ok(boss);
  return { world, boss };
}

function tickIceWizardAI(world: ReturnType<typeof createWorldState>, ticks: number): void {
  for (let i = 0; i < ticks; i++) applyIceWizardAI(world);
}

function finishOneSummon(world: ReturnType<typeof createWorldState>): void {
  tickIceWizardAI(
    world,
    ICE_WIZARD_SUMMON_TELEGRAPH_TICKS +
      ICE_WIZARD_SUMMON_RELEASE_TICKS +
      ICE_WIZARD_SUMMON_RECOVERY_TICKS +
      6,
  );
}

test('Ice Wizard spawns as a grid-aligned 4x4 tile boss', () => {
  const world = createWorldState(1000 / 60, 123);
  const id = spawnIceWizardForTesting(world, 37, 42);
  const boss = world.clusters.find((c) => c.entityId === id);
  assert.ok(boss);
  assert.equal(boss.isIceWizardFlag, 1);
  assert.equal(boss.halfWidthWorld, ICE_WIZARD_HALF_W);
  assert.equal(boss.halfHeightWorld, ICE_WIZARD_HALF_H);
  assert.equal((boss.positionXWorld - ICE_WIZARD_HALF_W) % BLOCK_SIZE_MEDIUM, 0);
  assert.equal((boss.positionYWorld - ICE_WIZARD_HALF_H) % BLOCK_SIZE_MEDIUM, 0);
  assert.equal(ICE_WIZARD_FOOTPRINT_TILES, 4);
});

test('Ice Wizard slam finds an authored floor instead of assuming room bottom', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldHeightWorld = 240;
  addWall(world, 40, 112, 96, 8);
  const floorY = findIceWizardSlamFloorY(world, 48, 80, 40);
  assert.equal(floorY, 112);
});

test('Ice spike wave stops at walls', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 240;
  world.worldHeightWorld = 160;
  addWall(world, 24, 120, 160, 8);
  addWall(world, 104, 96, 8, 24);

  const tiles = collectIceSpikeWaveTiles(world, 72, 120);
  assert.ok(tiles.some((t) => t.xWorld < 72));
  assert.ok(tiles.every((t) => t.xWorld < 104 || t.xWorld < 72), 'wave should not continue through the blocker wall');
});

test('Ice spike wave stops at gaps', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 240;
  world.worldHeightWorld = 160;
  addWall(world, 24, 120, 64, 8);
  addWall(world, 112, 120, 64, 8);

  const tiles = collectIceSpikeWaveTiles(world, 56, 120);
  assert.ok(tiles.length > 0);
  assert.ok(tiles.every((t) => t.xWorld < 88), 'wave should stop before the floor gap');
});

test('Ice spikes despawn after their lifecycle', () => {
  const world = createWorldState(1000 / 60, 123);
  addWall(world, 0, 120, 200, 8);
  spawnIceSpikeWave(world, 80, 120);
  assert.ok(countAlive(world.iceSpikeAliveFlag) > 0);

  for (let i = 0; i < ICE_SPIKE_TOTAL_TICKS + 80; i++) tickIceSpikes(world);
  assert.equal(countAlive(world.iceSpikeAliveFlag), 0);
});

test('Ice spikes only damage during the active phase', () => {
  const world = createWorldState(1000 / 60, 123);
  addWall(world, 0, 120, 200, 8);
  const player = createClusterState(1, 88, 111, 1, 10);
  world.clusters.push(player);
  spawnIceSpikeWave(world, 80, 120);
  world.iceSpikeDelayTicks[0] = 0;
  world.iceSpikeXWorld[0] = player.positionXWorld;
  world.iceSpikeBaseYWorld[0] = 120;

  tickIceSpikes(world);
  assert.equal(player.invulnerabilityTicks, 0);

  world.iceSpikeAgeTicks[0] = ICE_SPIKE_TELEGRAPH_TICKS + ICE_SPIKE_RISE_TICKS;
  tickIceSpikes(world);
  assert.ok(player.invulnerabilityTicks > 0);

  player.invulnerabilityTicks = 0;
  world.iceSpikeHitPlayerFlag[0] = 0;
  world.iceSpikeAgeTicks[0] = ICE_SPIKE_TELEGRAPH_TICKS + ICE_SPIKE_RISE_TICKS + ICE_SPIKE_ACTIVE_TICKS;
  tickIceSpikes(world);
  assert.equal(player.invulnerabilityTicks, 0);
});

test('Ice spikes are cleaned up after boss death', () => {
  const world = createWorldState(1000 / 60, 123);
  const player = createClusterState(1, 20, 20, 1, 10);
  const boss = createClusterState(2, 80, 120 - ICE_WIZARD_HALF_H - 2, 0, ICE_WIZARD_HP);
  boss.isIceWizardFlag = 1;
  boss.isAliveFlag = 0;
  world.clusters.push(player, boss);
  world.iceSpikeAliveFlag[0] = 1;

  applyIceWizardAI(world);
  assert.equal(countAlive(world.iceSpikeAliveFlag), 0);
});

test('Ice Wizard slam state spawns a floor wave on impact', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 240;
  world.worldHeightWorld = 160;
  addWall(world, 0, 120, 240, 8);
  const player = createClusterState(1, 80, 80, 1, 10);
  const boss = createClusterState(2, 80, 120 - ICE_WIZARD_HALF_H - 2, 0, ICE_WIZARD_HP);
  boss.isIceWizardFlag = 1;
  boss.halfWidthWorld = ICE_WIZARD_HALF_W;
  boss.halfHeightWorld = ICE_WIZARD_HALF_H;
  boss.iceWizardState = ICE_WIZARD_STATE_SLAM_DOWN;
  world.clusters.push(player, boss);

  applyIceWizardAI(world);

  assert.equal(boss.positionYWorld + boss.halfHeightWorld, 120);
  assert.ok(countAlive(world.iceSpikeAliveFlag) > 0);
});

test('Ice spike cleanup helper clears transient hazards for room reset paths', () => {
  const world = createWorldState(1000 / 60, 123);
  world.iceSpikeAliveFlag[0] = 1;
  clearIceSpikes(world);
  assert.equal(countAlive(world.iceSpikeAliveFlag), 0);
});

test('Ice Wizard HP thresholds summon Ice Bubbles exactly once', () => {
  const { world, boss } = makeIceWizardEncounter();

  boss.healthPoints = ICE_WIZARD_HP * 0.75;
  finishOneSummon(world);
  assert.equal(countAliveIceBubbles(world), 2);
  assert.equal(boss.iceWizardSummonTriggeredMask & 1, 1);
  assert.equal(boss.iceWizardState, ICE_WIZARD_STATE_IDLE);

  finishOneSummon(world);
  assert.equal(countAliveIceBubbles(world), 2, '75% summon should not repeat');

  boss.healthPoints = ICE_WIZARD_HP * 0.50;
  finishOneSummon(world);
  assert.equal(countAliveIceBubbles(world), 5);
  finishOneSummon(world);
  assert.equal(countAliveIceBubbles(world), 5, '50% summon should not repeat');

  boss.healthPoints = ICE_WIZARD_HP * 0.25;
  finishOneSummon(world);
  assert.equal(countAliveIceBubbles(world), 9);
  finishOneSummon(world);
  assert.equal(countAliveIceBubbles(world), 9, '25% summon should not repeat');
});

test('Ice Wizard damage crossing multiple thresholds queues summons in order', () => {
  const { world, boss } = makeIceWizardEncounter();

  boss.healthPoints = ICE_WIZARD_HP * 0.45;
  finishOneSummon(world);
  assert.equal(countAliveIceBubbles(world), 2);
  assert.equal(boss.iceWizardSummonPendingMask & 2, 2, '50% threshold should remain queued after the 75% summon');

  finishOneSummon(world);
  assert.equal(countAliveIceBubbles(world), 5);
  assert.equal(boss.iceWizardSummonPendingMask, 0);
});

test('Ice Bubble summons avoid walls and room bounds', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 180;
  world.worldHeightWorld = 140;
  const spawned = summonIceBubblesAroundWizard(world, 24, 24, 4);

  assert.ok(spawned < 4, 'out-of-bounds preferred positions should be skipped when no safe fallback exists');
  for (const cluster of world.clusters) {
    if (cluster.isIceBubbleFlag !== 1) continue;
    assert.equal(isValidIceBubbleSummonPosition(world, cluster.positionXWorld, cluster.positionYWorld), true);
  }
});

test('Ice Bubble summons relocate blocked preferred positions when nearby air is available', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 360;
  world.worldHeightWorld = 280;
  addWall(world, 166, 64, 20, 20);

  const spawned = summonIceBubblesAroundWizard(world, 176, 136, 1);

  assert.equal(spawned, 1);
  const bubble = world.clusters.find((c) => c.isIceBubbleFlag === 1);
  assert.ok(bubble);
  assert.equal(isValidIceBubbleSummonPosition(world, bubble.positionXWorld, bubble.positionYWorld), true);
  assert.notEqual(bubble.positionYWorld, 72, 'blocked preferred spawn should move to a nearby safe position');
});

test('Ice Wizard summon state returns to the normal idle/slam loop', () => {
  const { world, boss } = makeIceWizardEncounter();

  boss.healthPoints = ICE_WIZARD_HP * 0.75;
  finishOneSummon(world);

  assert.equal(boss.iceWizardState, ICE_WIZARD_STATE_IDLE);
  assert.equal(boss.iceWizardCurrentSummonThresholdIndex, -1);
  assert.equal(boss.iceWizardSummonPendingMask, 0);
  assert.equal(boss.iceWizardSummonReleasedFlag, 0);
});

test('New Ice Wizard instances start with clear threshold state after room reset', () => {
  const first = makeIceWizardEncounter();
  first.boss.healthPoints = ICE_WIZARD_HP * 0.75;
  finishOneSummon(first.world);
  assert.equal(countAliveIceBubbles(first.world), 2);
  assert.notEqual(first.boss.iceWizardSummonTriggeredMask, 0);

  const second = makeIceWizardEncounter();
  assert.equal(second.boss.iceWizardSummonTriggeredMask, 0);
  assert.equal(second.boss.iceWizardSummonPendingMask, 0);
  assert.equal(countAliveIceBubbles(second.world), 0);
});
