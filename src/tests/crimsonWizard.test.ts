import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { findCrimsonWizardFloorY, steerCrimsonWizardMovement } from '../sim/clusters/crimsonWizardAi';
import { spawnCrimsonFireDust, spawnCrimsonMeteor, spawnCrimsonTelegraph, tickCrimsonWizardEffects } from '../sim/clusters/crimsonWizardEffects';
import { CW_ROOM_MARGIN, MAX_CW_FIRE_DUST } from '../sim/clusters/crimsonWizardConfig';

test('Crimson Wizard steering clamps to room bounds and tracks facing', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 160;
  world.worldHeightWorld = 120;
  const player = createClusterState(1, 40, 60, 1, 10);
  const boss = createClusterState(2, 152, 60, 0, 48);
  boss.isCrimsonWizardFlag = 1;
  boss.crimsonWizardVelXWorld = 4;
  world.clusters.push(player, boss);

  steerCrimsonWizardMovement(world, boss, player);

  assert.equal(boss.crimsonWizardFacingX, -1);
  assert.ok(boss.positionXWorld <= world.worldWidthWorld - CW_ROOM_MARGIN - boss.halfWidthWorld);
  assert.ok(boss.positionXWorld >= CW_ROOM_MARGIN + boss.halfWidthWorld);
  assert.ok(boss.positionYWorld <= world.worldHeightWorld - CW_ROOM_MARGIN - boss.halfHeightWorld);
  assert.ok(boss.positionYWorld >= CW_ROOM_MARGIN + boss.halfHeightWorld);
  assert.ok(boss.crimsonWizardVelXWorld <= 0, 'edge clamp should not preserve outward wall velocity');
});

test('Crimson Wizard floor lookup uses the nearest floor under a pillar x position', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldHeightWorld = 180;
  world.wallCount = 2;
  world.wallXWorld[0] = 0;
  world.wallYWorld[0] = 150;
  world.wallWWorld[0] = 200;
  world.wallHWorld[0] = 12;
  world.wallXWorld[1] = 60;
  world.wallYWorld[1] = 92;
  world.wallWWorld[1] = 32;
  world.wallHWorld[1] = 8;

  assert.equal(findCrimsonWizardFloorY(world, 70), 92);
  assert.equal(findCrimsonWizardFloorY(world, 20), 150);
});

test('Crimson Wizard fire dust stays capped by the fixed buffer', () => {
  const world = createWorldState(1000 / 60, 123);
  for (let i = 0; i < MAX_CW_FIRE_DUST + 12; i++) {
    spawnCrimsonFireDust(world, 40, 40, 0, -0.2, 40);
  }
  let alive = 0;
  for (let i = 0; i < world.cwFireDustAliveFlag.length; i++) {
    if (world.cwFireDustAliveFlag[i] === 1) alive += 1;
  }
  assert.equal(alive, MAX_CW_FIRE_DUST);
});

test('Crimson Wizard telegraphs expire without leaking slots', () => {
  const world = createWorldState(1000 / 60, 123);
  spawnCrimsonTelegraph(world, 50, 50, 8, 1, 2);
  assert.equal(world.cwTelegraphAliveFlag[0], 1);
  tickCrimsonWizardEffects(world);
  assert.equal(world.cwTelegraphAliveFlag[0], 1);
  tickCrimsonWizardEffects(world);
  assert.equal(world.cwTelegraphAliveFlag[0], 0);
});

test('Crimson Wizard meteors despawn on floor impact and leave capped burst particles', () => {
  const world = createWorldState(1000 / 60, 123);
  world.worldWidthWorld = 160;
  world.worldHeightWorld = 120;
  world.clusters.push(createClusterState(1, 30, 60, 1, 10));
  spawnCrimsonMeteor(world, 80, 116, 80, 140);

  tickCrimsonWizardEffects(world);

  assert.equal(world.cwProjectileAliveFlag[0], 0);
  let aliveDust = 0;
  for (let i = 0; i < world.cwFireDustAliveFlag.length; i++) {
    if (world.cwFireDustAliveFlag[i] === 1) aliveDust += 1;
  }
  assert.ok(aliveDust > 0);
  assert.ok(aliveDust <= MAX_CW_FIRE_DUST);
});
