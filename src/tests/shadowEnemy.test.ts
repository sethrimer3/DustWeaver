import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import {
  appendShadowWaypoint,
  clearShadowPath,
  consumeOldestShadowWaypoint,
  recordAndMoveShadowEnemies,
  resolveShadowFatalContacts,
} from '../sim/clusters/shadowEnemyAi';
import {
  MAX_SHADOW_ENEMIES,
  SHADOW_FOLLOW_SPEED_WORLD_PER_SEC,
  SHADOW_PATH_CAPACITY,
  SHADOW_REPHASE_DELAY_TICKS,
  SHADOW_START_DELAY_TICKS,
} from '../sim/clusters/shadowEnemyConfig';
import { updateMomentumCombatState, applyMomentumCombatCollisionDamage } from '../sim/momentumCombat';
import { enemyFlagsToType } from '../levels/roomSchemaV2';
import { enemyTypeToFlags } from '../levels/roomSchemaHydrator';
import type { RoomJsonEnemy } from '../editor/roomJsonSchema';
import type { RoomEnemyDef } from '../levels/roomDef';
import { createRng } from '../sim/rng';
import { allocateShadowPathSlot, spawnEnemyClusters } from '../screens/gameEnemySpawn';
import { canAddLimitedEnemy } from '../editor/editorEnemyCapacity';
import { _makeEmptyCluster } from '../render/snapshotClusterInit';

function createFixture(dtMs = 1000 / 60) {
  const world = createWorldState(dtMs, 1);
  world.combatMode = 'momentum';
  const player = createClusterState(0, 40, 20, 1, 10);
  const shadow = createClusterState(1, 0, 20, 0, 1);
  shadow.isShadowEnemyFlag = 1;
  shadow.shadowPathSlotIndex = 0;
  shadow.shadowStartupTicks = 0;
  shadow.halfWidthWorld = 3.5;
  shadow.halfHeightWorld = 10;
  world.clusters = [player, shadow];
  world.shadowPathLastRecordedXWorld[0] = player.positionXWorld;
  world.shadowPathLastRecordedYWorld[0] = player.positionYWorld;
  return { world, player, shadow };
}

function makeShadowDef(index: number): RoomEnemyDef {
  return {
    xBlock: index + 1,
    yBlock: 1,
    kinds: [],
    particleCount: 1,
    isBossFlag: 0,
    isShadowEnemyFlag: 1,
  };
}

test('bounded queue discards the oldest unread waypoint deterministically', () => {
  const { world } = createFixture();
  for (let index = 0; index < SHADOW_PATH_CAPACITY + 2; index++) {
    appendShadowWaypoint(world, 0, index, 0);
  }
  assert.equal(world.shadowPathCount[0], SHADOW_PATH_CAPACITY);
  assert.equal(world.shadowPathHead[0], 2);
  assert.deepEqual(consumeOldestShadowWaypoint(world, 0), { xWorld: 2, yWorld: 0 });
});

test('consuming an empty shadow queue returns null without moving its head', () => {
  const { world } = createFixture();
  assert.equal(consumeOldestShadowWaypoint(world, 0), null);
  assert.equal(world.shadowPathHead[0], 0);
});

test('clearing a shadow queue resets all unread bookkeeping', () => {
  const { world } = createFixture();
  appendShadowWaypoint(world, 0, 10, 20);
  appendShadowWaypoint(world, 0, 11, 20);
  clearShadowPath(world, 0);
  assert.equal(world.shadowPathHead[0], 0);
  assert.equal(world.shadowPathCount[0], 0);
});

test('startup records path but does not move or kill', () => {
  const { world, player, shadow } = createFixture();
  shadow.shadowStartupTicks = SHADOW_START_DELAY_TICKS;
  shadow.positionXWorld = player.positionXWorld;
  const originalX = shadow.positionXWorld;
  recordAndMoveShadowEnemies(world);
  resolveShadowFatalContacts(world);
  assert.equal(shadow.positionXWorld, originalX);
  assert.equal(player.isAliveFlag, 1);
  assert.ok(world.shadowPathCount[0] > 0);
});

test('shadow follows recorded waypoints rather than steering directly', () => {
  const { world, player, shadow } = createFixture();
  clearShadowPath(world, 0);
  appendShadowWaypoint(world, 0, 0, 40);
  player.positionXWorld = 100;
  world.shadowPathLastRecordedXWorld[0] = 100;
  recordAndMoveShadowEnemies(world);
  assert.ok(shadow.positionYWorld > 20);
});

test('teleport clears pre-teleport points and records only the new route', () => {
  const { world, player, shadow } = createFixture();
  appendShadowWaypoint(world, 0, 2, 2);
  appendShadowWaypoint(world, 0, 3, 3);
  player.positionXWorld = 200;
  recordAndMoveShadowEnemies(world);
  assert.equal(shadow.shadowRephaseTicks, SHADOW_REPHASE_DELAY_TICKS);
  assert.equal(world.shadowPathCount[0], 1);
  assert.deepEqual(consumeOldestShadowWaypoint(world, 0), { xWorld: 200, yWorld: 20 });
});

test('rephase records the player while the shadow stays stationary and nonfatal', () => {
  const { world, player, shadow } = createFixture();
  player.positionXWorld = 200;
  recordAndMoveShadowEnemies(world);
  const originalX = shadow.positionXWorld;
  for (let tick = 1; tick < 8; tick++) {
    player.positionXWorld = 200 + tick;
    recordAndMoveShadowEnemies(world);
    resolveShadowFatalContacts(world);
  }
  assert.equal(shadow.positionXWorld, originalX);
  assert.equal(shadow.velocityXWorld, 0);
  assert.equal(player.isAliveFlag, 1);
  assert.equal(world.shadowPathCount[0], 8);
});

test('rephase completion relocates to and consumes the oldest waypoint without movement', () => {
  const { world, player, shadow } = createFixture();
  player.positionXWorld = 200;
  recordAndMoveShadowEnemies(world);
  for (let tick = 1; tick <= SHADOW_REPHASE_DELAY_TICKS; tick++) {
    player.positionXWorld = 200 + tick;
    recordAndMoveShadowEnemies(world);
  }
  assert.equal(shadow.positionXWorld, 200);
  assert.notEqual(shadow.positionXWorld, player.positionXWorld);
  assert.equal(shadow.velocityXWorld, 0);
  assert.equal(shadow.shadowRephaseRelocatedThisTickFlag, 1);
  assert.deepEqual(consumeOldestShadowWaypoint(world, 0), { xWorld: 201, yWorld: 20 });
});

test('fatal contact remains disabled on the relocation tick', () => {
  const { world, player, shadow } = createFixture();
  player.positionXWorld = 200;
  recordAndMoveShadowEnemies(world);
  for (let tick = 0; tick < SHADOW_REPHASE_DELAY_TICKS; tick++) {
    recordAndMoveShadowEnemies(world);
  }
  shadow.positionXWorld = player.positionXWorld;
  shadow.positionYWorld = player.positionYWorld;
  resolveShadowFatalContacts(world);
  assert.equal(player.isAliveFlag, 1);
});

test('shadow resumes route following on the tick after relocation', () => {
  const { world, player, shadow } = createFixture();
  player.positionXWorld = 200;
  recordAndMoveShadowEnemies(world);
  for (let tick = 1; tick <= SHADOW_REPHASE_DELAY_TICKS; tick++) {
    player.positionXWorld = 200 + tick;
    recordAndMoveShadowEnemies(world);
  }
  const relocatedX = shadow.positionXWorld;
  recordAndMoveShadowEnemies(world);
  assert.ok(shadow.positionXWorld > relocatedX);
});

test('two shadows rephase independently', () => {
  const { world, player, shadow } = createFixture();
  const second = createClusterState(2, 20, 20, 0, 1);
  second.isShadowEnemyFlag = 1;
  second.shadowPathSlotIndex = 1;
  second.shadowStartupTicks = 0;
  world.clusters.push(second);
  world.shadowPathLastRecordedXWorld[1] = player.positionXWorld;
  world.shadowPathLastRecordedYWorld[1] = player.positionYWorld;
  player.positionXWorld = 200;
  recordAndMoveShadowEnemies(world);
  second.shadowRephaseTicks = 7;
  recordAndMoveShadowEnemies(world);
  assert.equal(shadow.shadowRephaseTicks, SHADOW_REPHASE_DELAY_TICKS - 1);
  assert.equal(second.shadowRephaseTicks, 6);
});

test('shadow slot allocator returns the first available slot', () => {
  const { world, shadow } = createFixture();
  shadow.shadowPathSlotIndex = 2;
  assert.equal(allocateShadowPathSlot(world), 0);
});

test('shadow slot allocator returns minus one when all four slots are occupied', () => {
  const world = createWorldState(1000 / 60, 9);
  for (let slot = 0; slot < MAX_SHADOW_ENEMIES; slot++) {
    const shadow = createClusterState(slot + 1, 0, 0, 0, 1);
    shadow.isShadowEnemyFlag = 1;
    shadow.shadowPathSlotIndex = slot;
    world.clusters.push(shadow);
  }
  assert.equal(allocateShadowPathSlot(world), -1);
});

test('movement uses 150 world units per second and honors a large-timestep budget', () => {
  const { world, player, shadow } = createFixture(100);
  clearShadowPath(world, 0);
  appendShadowWaypoint(world, 0, 2, 20);
  appendShadowWaypoint(world, 0, 10, 20);
  appendShadowWaypoint(world, 0, 50, 20);
  world.shadowPathLastRecordedXWorld[0] = player.positionXWorld;
  recordAndMoveShadowEnemies(world);
  assert.equal(shadow.positionXWorld, SHADOW_FOLLOW_SPEED_WORLD_PER_SEC * 0.1);
  assert.equal(world.shadowPathCount[0], 2);
});

test('dead shadows neither record, move, nor kill', () => {
  const { world, player, shadow } = createFixture();
  shadow.isAliveFlag = 0;
  shadow.positionXWorld = player.positionXWorld;
  const count = world.shadowPathCount[0];
  recordAndMoveShadowEnemies(world);
  resolveShadowFatalContacts(world);
  assert.equal(world.shadowPathCount[0], count);
  assert.equal(player.isAliveFlag, 1);
});

test('surviving contact kills immediately despite invulnerability', () => {
  const { world, player, shadow } = createFixture();
  shadow.positionXWorld = player.positionXWorld;
  shadow.positionYWorld = player.positionYWorld;
  player.invulnerabilityTicks = 99;
  player.isHighVelocityAttacking = 1;
  resolveShadowFatalContacts(world);
  assert.equal(player.isAliveFlag, 0);
  assert.equal(player.healthPoints, 0);
});

test('momentum collision kills the one-HP shadow before fatal contact', () => {
  const { world, player, shadow } = createFixture();
  shadow.positionXWorld = player.positionXWorld;
  shadow.positionYWorld = player.positionYWorld;
  player.velocityXWorld = 400;
  updateMomentumCombatState(world);
  applyMomentumCombatCollisionDamage(world);
  resolveShadowFatalContacts(world);
  assert.equal(shadow.isAliveFlag, 0);
  assert.equal(player.isAliveFlag, 1);
});

test('fifth shadow is rejected at runtime without consuming an entity id', () => {
  const world = createWorldState(1000 / 60, 2);
  world.clusters.push(createClusterState(1, 0, 0, 1, 10));
  const nextEntityId = spawnEnemyClusters(
    world,
    Array.from({ length: MAX_SHADOW_ENEMIES + 1 }, (_, index) => makeShadowDef(index)),
    2,
    createRng(42),
  );
  const shadows = world.clusters.filter((cluster) => cluster.isShadowEnemyFlag === 1);
  assert.equal(shadows.length, MAX_SHADOW_ENEMIES);
  assert.ok(shadows.every((cluster) => cluster.shadowPathSlotIndex >= 0));
  assert.equal(nextEntityId, 2 + MAX_SHADOW_ENEMIES);
});

test('capacity rejection does not prevent later room enemies from spawning', () => {
  const world = createWorldState(1000 / 60, 12);
  world.clusters.push(createClusterState(1, 0, 0, 1, 10));
  const basicEnemy: RoomEnemyDef = {
    xBlock: 10,
    yBlock: 2,
    kinds: [],
    particleCount: 2,
    isBossFlag: 0,
  };
  spawnEnemyClusters(
    world,
    [...Array.from({ length: MAX_SHADOW_ENEMIES + 1 }, (_, index) => makeShadowDef(index)), basicEnemy],
    2,
    createRng(51),
  );
  const lastCluster = world.clusters.at(-1);
  assert.equal(lastCluster?.entityId, 2 + MAX_SHADOW_ENEMIES);
  assert.equal(lastCluster?.isShadowEnemyFlag, 0);
});

test('editor capacity rejects a fifth shadow', () => {
  const enemies = Array.from({ length: MAX_SHADOW_ENEMIES }, () => ({
    isShadowEnemyFlag: 1 as const,
    isNeedleUrchinFlag: 0 as const,
  }));
  assert.equal(canAddLimitedEnemy({ enemies }, 'shadow'), false);
});

test('new world reconstruction clears shadow path arrays', () => {
  const { world } = createFixture();
  appendShadowWaypoint(world, 0, 10, 10);
  const reconstructed = createWorldState(1000 / 60, 3);
  assert.equal(reconstructed.shadowPathCount[0], 0);
  assert.equal(reconstructed.shadowPathHead[0], 0);
});

test('snapshot no longer contains shadow hit-flash state', () => {
  const snapshotCluster = _makeEmptyCluster();
  assert.equal('shadowHitFlashTicks' in snapshotCluster, false);
});

test('compact schema preserves shadow identity', () => {
  const type = enemyFlagsToType({ isShadowEnemy: true } as RoomJsonEnemy);
  assert.equal(type, 'shadow');
  const flags = enemyTypeToFlags(type, {
    xBlock: 1,
    yBlock: 1,
    kinds: ['Void'],
    particleCount: 1,
    isBoss: false,
  });
  assert.equal(flags.isShadowEnemy, true);
});
