import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import {
  applyNeedleUrchinAI,
  findEarliestNeedleWallHitT,
  fireNeedleBurst,
  segmentAabbHitT,
  shouldTriggerNeedleUrchin,
  tickNeedleUrchinProjectiles,
} from '../sim/clusters/needleUrchinAi';
import * as C from '../sim/clusters/needleUrchinConfig';
import { enemyFlagsToType } from '../levels/roomSchemaV2';
import { enemyTypeToFlags } from '../levels/roomSchemaHydrator';
import type { RoomJsonEnemy } from '../editor/roomJsonSchema';
import type { RoomEnemyDef } from '../levels/roomDef';
import { createRng } from '../sim/rng';
import { allocateNeedleUrchinSlot, spawnEnemyClusters } from '../screens/gameEnemySpawn';
import { canAddLimitedEnemy } from '../editor/editorEnemyCapacity';
import { _fillCluster, _makeEmptyCluster } from '../render/snapshotClusterInit';
import { applyPlayerDamageWithKnockback } from '../sim/playerDamage';
import { jsonToEditorRoomData } from '../editor/roomJson';
import type { RoomJsonDef } from '../editor/roomJsonSchema';
import { roomJsonDefToRoomDef } from '../levels/roomJsonToRoomDef';

function createFixture(dtMs = 1000 / 60) {
  const world = createWorldState(dtMs, 2);
  const player = createClusterState(0, 50, 20, 1, 10);
  const urchin = createClusterState(1, 20, 20, 0, C.NEEDLE_URCHIN_HP);
  urchin.isNeedleUrchinFlag = 1;
  urchin.needleUrchinSlotIndex = 0;
  urchin.needleUrchinPrevHealthPoints = C.NEEDLE_URCHIN_HP;
  urchin.halfWidthWorld = C.NEEDLE_URCHIN_HALF_SIZE_WORLD;
  urchin.halfHeightWorld = C.NEEDLE_URCHIN_HALF_SIZE_WORLD;
  world.worldWidthWorld = 200;
  world.worldHeightWorld = 200;
  world.clusters = [player, urchin];
  return { world, player, urchin };
}

function makeNeedleUrchinDef(index: number): RoomEnemyDef {
  return {
    xBlock: index + 1,
    yBlock: 1,
    kinds: [],
    particleCount: C.NEEDLE_URCHIN_HP,
    isBossFlag: 0,
    isNeedleUrchinFlag: 1,
  };
}

function armNeedle(world: ReturnType<typeof createWorldState>, x: number, y: number, velocityX: number): void {
  world.needleProjectileAliveFlag[0] = 1;
  world.needleProjectileXWorld[0] = x;
  world.needleProjectileYWorld[0] = y;
  world.needleProjectileVelXWorld[0] = velocityX;
  world.needleProjectileVelYWorld[0] = 0;
  world.needleProjectileLifetimeTicks[0] = 10;
}

function setWall(
  world: ReturnType<typeof createWorldState>,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  world.wallCount = 1;
  world.wallXWorld[0] = x;
  world.wallYWorld[0] = y;
  world.wallWWorld[0] = width;
  world.wallHWorld[0] = height;
}

function makePersistenceRoom(enemies: RoomJsonDef['enemies']): RoomJsonDef {
  return {
    id: 'enemy-persistence-test',
    name: 'Enemy Persistence Test',
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    widthBlocks: 20,
    heightBlocks: 12,
    playerSpawnBlock: [2, 2],
    interiorWalls: [],
    enemies,
    transitions: [],
    skillTombs: [],
  };
}

test('trigger uses total speed strictly above 80 and a 96-unit radius', () => {
  assert.equal(shouldTriggerNeedleUrchin(10, 0, 80, 0), false);
  assert.equal(shouldTriggerNeedleUrchin(10, 0, 0, 81), true);
  assert.equal(shouldTriggerNeedleUrchin(97, 0, 100, 0), false);
});

test('trigger includes the exact radius boundary', () => {
  assert.equal(shouldTriggerNeedleUrchin(C.NEEDLE_URCHIN_TRIGGER_RADIUS_WORLD, 0, 81, 0), true);
});

test('telegraph cancels when player slows', () => {
  const { world, player, urchin } = createFixture();
  player.velocityXWorld = 81;
  applyNeedleUrchinAI(world);
  assert.equal(urchin.needleUrchinState, C.NEEDLE_URCHIN_STATE_TELEGRAPH);
  player.velocityXWorld = 80;
  applyNeedleUrchinAI(world);
  assert.equal(urchin.needleUrchinState, C.NEEDLE_URCHIN_STATE_IDLE);
  assert.equal(world.needleProjectileAliveFlag.reduce((sum, value) => sum + value, 0), 0);
});

test('completed telegraph fires twelve evenly spaced needles aimed from the player angle', () => {
  const { world, player, urchin } = createFixture();
  player.velocityXWorld = 81;
  for (let tick = 0; tick <= C.NEEDLE_URCHIN_TELEGRAPH_TICKS; tick++) {
    applyNeedleUrchinAI(world);
  }
  assert.equal(world.needleProjectileAliveFlag.reduce((sum, value) => sum + value, 0), 12);
  const angles = Array.from({ length: 12 }, (_, index) => Math.atan2(
    world.needleProjectileVelYWorld[index],
    world.needleProjectileVelXWorld[index],
  ));
  const expectedStep = Math.PI * 2 / C.NEEDLE_URCHIN_NEEDLES_PER_BURST;
  for (let index = 0; index < angles.length; index++) {
    const next = angles[(index + 1) % angles.length];
    const difference = (next - angles[index] + Math.PI * 2) % (Math.PI * 2);
    assert.ok(Math.abs(difference - expectedStep) < 1e-6);
  }
  assert.ok(Math.abs(angles[0]) < 1e-6);
  assert.equal(urchin.needleUrchinState, C.NEEDLE_URCHIN_STATE_COOLDOWN);
});

test('cooldown lasts exactly the configured number of ticks', () => {
  const { world, urchin } = createFixture();
  urchin.needleUrchinState = C.NEEDLE_URCHIN_STATE_COOLDOWN;
  urchin.needleUrchinStateTicks = C.NEEDLE_URCHIN_COOLDOWN_TICKS;
  for (let tick = 1; tick < C.NEEDLE_URCHIN_COOLDOWN_TICKS; tick++) {
    applyNeedleUrchinAI(world);
    assert.equal(urchin.needleUrchinState, C.NEEDLE_URCHIN_STATE_COOLDOWN);
  }
  applyNeedleUrchinAI(world);
  assert.equal(urchin.needleUrchinState, C.NEEDLE_URCHIN_STATE_IDLE);
});

test('dead urchin does not finish telegraph but fired needles continue', () => {
  const { world, urchin } = createFixture();
  urchin.needleUrchinState = C.NEEDLE_URCHIN_STATE_TELEGRAPH;
  urchin.needleUrchinStateTicks = C.NEEDLE_URCHIN_TELEGRAPH_TICKS - 1;
  urchin.isAliveFlag = 0;
  applyNeedleUrchinAI(world);
  assert.equal(world.needleProjectileAliveFlag.reduce((sum, value) => sum + value, 0), 0);
  armNeedle(world, 20, 100, 60);
  tickNeedleUrchinProjectiles(world);
  assert.ok(world.needleProjectileXWorld[0] > 20);
});

test('urchin body remains stationary while active', () => {
  const { world, urchin } = createFixture();
  urchin.velocityXWorld = 20;
  urchin.velocityYWorld = -30;
  applyNeedleUrchinAI(world);
  assert.equal(urchin.velocityXWorld, 0);
  assert.equal(urchin.velocityYWorld, 0);
});

test('surviving damage starts, decrements, and refreshes hit flash', () => {
  const { world, urchin } = createFixture();
  urchin.healthPoints--;
  applyNeedleUrchinAI(world);
  assert.equal(urchin.needleUrchinHitFlashTicks, C.NEEDLE_URCHIN_HIT_FLASH_TICKS);
  applyNeedleUrchinAI(world);
  assert.equal(urchin.needleUrchinHitFlashTicks, C.NEEDLE_URCHIN_HIT_FLASH_TICKS - 1);
  urchin.healthPoints--;
  applyNeedleUrchinAI(world);
  assert.equal(urchin.needleUrchinHitFlashTicks, C.NEEDLE_URCHIN_HIT_FLASH_TICKS);
});

test('no damage does not start hit flash and snapshot copies the timer', () => {
  const { world, urchin } = createFixture();
  applyNeedleUrchinAI(world);
  assert.equal(urchin.needleUrchinHitFlashTicks, 0);
  urchin.needleUrchinHitFlashTicks = 4;
  const snapshot = _makeEmptyCluster();
  _fillCluster(snapshot, urchin);
  assert.equal(snapshot.needleUrchinHitFlashTicks, 4);
});

test('a new burst overwrites only its owner range', () => {
  const { world, urchin } = createFixture();
  const otherIndex = C.NEEDLE_URCHIN_NEEDLES_PER_BURST;
  world.needleProjectileAliveFlag[otherIndex] = 1;
  world.needleProjectileXWorld[otherIndex] = 123;
  fireNeedleBurst(world, urchin);
  assert.equal(world.needleProjectileAliveFlag.slice(0, 12).reduce((sum, value) => sum + value, 0), 12);
  assert.equal(world.needleProjectileAliveFlag[otherIndex], 1);
  assert.equal(world.needleProjectileXWorld[otherIndex], 123);
});

test('multiple urchins use independent projectile ranges', () => {
  const { world, urchin } = createFixture();
  const second = createClusterState(2, 100, 100, 0, C.NEEDLE_URCHIN_HP);
  second.isNeedleUrchinFlag = 1;
  second.needleUrchinSlotIndex = 1;
  world.clusters.push(second);
  fireNeedleBurst(world, urchin);
  const firstRange = world.needleProjectileXWorld.slice(0, 12);
  fireNeedleBurst(world, second);
  assert.deepEqual(world.needleProjectileXWorld.slice(0, 12), firstRange);
  assert.equal(world.needleProjectileAliveFlag.slice(12, 24).reduce((sum, value) => sum + value, 0), 12);
});

test('segment AABB returns the earliest swept hit', () => {
  assert.equal(segmentAabbHitT(0, 0, 10, 0, 4, -1, 6, 1), 0.4);
  assert.equal(segmentAabbHitT(0, 0, 10, 0, 12, -1, 14, 1), null);
});

test('zero-size destroyed walls are ignored', () => {
  const { world } = createFixture();
  setWall(world, 30, 0, 0, 40);
  assert.equal(findEarliestNeedleWallHitT(world, 20, 20, 40, 20), null);
  setWall(world, 30, 0, 8, 0);
  assert.equal(findEarliestNeedleWallHitT(world, 20, 20, 40, 20), null);
});

test('wall helper selects the earliest of multiple walls', () => {
  const { world } = createFixture();
  world.wallCount = 2;
  world.wallXWorld[0] = 60;
  world.wallYWorld[0] = 0;
  world.wallWWorld[0] = 8;
  world.wallHWorld[0] = 40;
  world.wallXWorld[1] = 30;
  world.wallYWorld[1] = 0;
  world.wallWWorld[1] = 8;
  world.wallHWorld[1] = 40;
  assert.equal(findEarliestNeedleWallHitT(world, 20, 20, 80, 20), 1 / 6);
});

test('dynamically removed wall stops blocking on the next projectile tick', () => {
  const { world } = createFixture();
  setWall(world, 30, 0, 8, 40);
  world.wallWWorld[0] = 0;
  assert.equal(findEarliestNeedleWallHitT(world, 20, 20, 40, 20), null);
});

test('wall collision blocks a shot that would otherwise hit the player', () => {
  const { world, player } = createFixture(100);
  player.positionXWorld = 80;
  setWall(world, 40, 0, 8, 40);
  armNeedle(world, 20, 20, 1000);
  tickNeedleUrchinProjectiles(world);
  assert.equal(world.needleProjectileAliveFlag[0], 0);
  assert.equal(player.healthPoints, 10);
  assert.equal(world.needleProjectileXWorld[0], 40);
});

test('a clearly earlier player collision still damages the player', () => {
  const { world, player } = createFixture(100);
  player.positionXWorld = 40;
  setWall(world, 80, 0, 8, 40);
  armNeedle(world, 20, 20, 1000);
  tickNeedleUrchinProjectiles(world);
  assert.equal(player.healthPoints, 9);
});

test('player impact position uses the selected swept collision time', () => {
  const { world, player } = createFixture(100);
  player.positionXWorld = 50;
  armNeedle(world, 20, 20, 1000);
  tickNeedleUrchinProjectiles(world);
  const expectedEntryX = player.positionXWorld - player.halfWidthWorld - C.NEEDLE_PROJECTILE_HALF_WIDTH_WORLD;
  assert.ok(Math.abs(world.needleProjectileXWorld[0] - expectedEntryX) < 1e-6);
});

test('a despawned projectile cannot damage the player twice', () => {
  const { world, player } = createFixture(100);
  player.positionXWorld = 40;
  armNeedle(world, 20, 20, 1000);
  tickNeedleUrchinProjectiles(world);
  player.invulnerabilityTicks = 0;
  tickNeedleUrchinProjectiles(world);
  assert.equal(player.healthPoints, 9);
});

test('equal and near-equal wall/player collisions resolve in favor of terrain', () => {
  for (const wallOffset of [0, C.NEEDLE_COLLISION_T_EPSILON * 50]) {
    const { world, player } = createFixture(100);
    player.positionXWorld = 50;
    const playerEntryX = player.positionXWorld - player.halfWidthWorld - C.NEEDLE_PROJECTILE_HALF_WIDTH_WORLD;
    setWall(world, playerEntryX + wallOffset, 0, 8, 40);
    armNeedle(world, 20, 20, 1000);
    tickNeedleUrchinProjectiles(world);
    assert.equal(player.healthPoints, 10);
    assert.equal(world.needleProjectileAliveFlag[0], 0);
  }
});

test('invisible and one-way wall geometry remains a solid projectile blocker', () => {
  const { world } = createFixture();
  setWall(world, 30, 0, 8, 40);
  world.wallIsInvisibleFlag[0] = 1;
  world.wallIsPlatformFlag[0] = 1;
  assert.equal(findEarliestNeedleWallHitT(world, 20, 20, 40, 20), 0.5);
});

test('projectile lifetime expires exactly at zero and room bounds despawn', () => {
  const { world } = createFixture();
  armNeedle(world, 20, 100, 0);
  world.needleProjectileLifetimeTicks[0] = 1;
  tickNeedleUrchinProjectiles(world);
  assert.equal(world.needleProjectileAliveFlag[0], 0);
  armNeedle(world, 199, 100, 120);
  tickNeedleUrchinProjectiles(world);
  assert.equal(world.needleProjectileAliveFlag[0], 0);
});

test('projectile remains alive while lifetime is still positive', () => {
  const { world } = createFixture();
  armNeedle(world, 20, 100, 0);
  world.needleProjectileLifetimeTicks[0] = 2;
  tickNeedleUrchinProjectiles(world);
  assert.equal(world.needleProjectileLifetimeTicks[0], 1);
  assert.equal(world.needleProjectileAliveFlag[0], 1);
});

test('needle bypasses momentum immunity but respects ordinary invulnerability', () => {
  const { world, player } = createFixture();
  player.positionXWorld = 22;
  player.isHighVelocityAttacking = 1;
  armNeedle(world, 20, 20, 180);
  tickNeedleUrchinProjectiles(world);
  assert.equal(player.healthPoints, 9);
  player.invulnerabilityTicks = 10;
  armNeedle(world, 20, 20, 180);
  tickNeedleUrchinProjectiles(world);
  assert.equal(player.healthPoints, 9);
});

test('damage helper callers retain default momentum protection', () => {
  const { player } = createFixture();
  player.isHighVelocityAttacking = 1;
  applyPlayerDamageWithKnockback(player, 1, 0, 0);
  assert.equal(player.healthPoints, 10);
});

test('ninth urchin is rejected at runtime and editor capacity', () => {
  const world = createWorldState(1000 / 60, 4);
  world.clusters.push(createClusterState(1, 0, 0, 1, 10));
  const nextEntityId = spawnEnemyClusters(
    world,
    Array.from({ length: C.MAX_NEEDLE_URCHINS + 1 }, (_, index) => makeNeedleUrchinDef(index)),
    2,
    createRng(44),
  );
  const urchins = world.clusters.filter((cluster) => cluster.isNeedleUrchinFlag === 1);
  assert.equal(urchins.length, C.MAX_NEEDLE_URCHINS);
  assert.ok(urchins.every((cluster) => cluster.needleUrchinSlotIndex >= 0));
  assert.ok(urchins.every((cluster) => cluster.needleUrchinPrevHealthPoints === C.NEEDLE_URCHIN_HP));
  assert.equal(nextEntityId, 2 + C.MAX_NEEDLE_URCHINS);

  const enemies = Array.from({ length: C.MAX_NEEDLE_URCHINS }, () => ({
    isShadowEnemyFlag: 0 as const,
    isNeedleUrchinFlag: 1 as const,
  }));
  assert.equal(canAddLimitedEnemy({ enemies }, 'needleUrchin'), false);
});

test('needle urchin slot allocator returns minus one only when all ranges are occupied', () => {
  const world = createWorldState(1000 / 60, 14);
  assert.equal(allocateNeedleUrchinSlot(world), 0);
  for (let slot = 0; slot < C.MAX_NEEDLE_URCHINS; slot++) {
    const urchin = createClusterState(slot + 1, 0, 0, 0, C.NEEDLE_URCHIN_HP);
    urchin.isNeedleUrchinFlag = 1;
    urchin.needleUrchinSlotIndex = slot;
    world.clusters.push(urchin);
  }
  assert.equal(allocateNeedleUrchinSlot(world), -1);
});

test('new world reconstruction clears all needle projectile ranges', () => {
  const { world } = createFixture();
  armNeedle(world, 20, 20, 180);
  const reconstructed = createWorldState(1000 / 60, 5);
  assert.equal(reconstructed.needleProjectileAliveFlag.reduce((sum, value) => sum + value, 0), 0);
});

test('full editor JSON round trip preserves Shadow and Needle Urchin', async () => {
  const source = makePersistenceRoom([
    {
      xBlock: 4,
      yBlock: 5,
      kinds: ['Void'],
      particleCount: 1,
      isBoss: false,
      isShadowEnemy: true,
    },
    {
      xBlock: 8,
      yBlock: 5,
      kinds: ['Golden'],
      particleCount: 3,
      isBoss: false,
      isNeedleUrchin: true,
    },
  ]);
  const parsed = JSON.parse(JSON.stringify(source)) as RoomJsonDef;
  const editorData = jsonToEditorRoomData(parsed, 1).data;
  const { editorRoomDataToJson } = await import('../editor/roomJsonSerializer');
  const serialized = editorRoomDataToJson(editorData);
  assert.equal(serialized.enemies[0].isShadowEnemy, true);
  assert.equal(serialized.enemies[1].isNeedleUrchin, true);
});

test('runtime room conversion preserves both flags and old JSON defaults them off', () => {
  const source = makePersistenceRoom([
    { xBlock: 4, yBlock: 5, kinds: ['Void'], particleCount: 1, isBoss: false, isShadowEnemy: true },
    { xBlock: 8, yBlock: 5, kinds: ['Golden'], particleCount: 3, isBoss: false, isNeedleUrchin: true },
    { xBlock: 10, yBlock: 5, kinds: ['Golden'], particleCount: 2, isBoss: false },
  ]);
  const runtime = roomJsonDefToRoomDef(source);
  assert.equal(runtime.enemies[0].isShadowEnemyFlag, 1);
  assert.equal(runtime.enemies[1].isNeedleUrchinFlag, 1);
  assert.equal(runtime.enemies[2].isShadowEnemyFlag, 0);
  assert.equal(runtime.enemies[2].isNeedleUrchinFlag, 0);

  const editor = jsonToEditorRoomData(source, 1).data;
  assert.equal(editor.enemies[2].isShadowEnemyFlag, 0);
  assert.equal(editor.enemies[2].isNeedleUrchinFlag, 0);
});

test('compact schema preserves urchin identity', () => {
  const type = enemyFlagsToType({ isNeedleUrchin: true } as RoomJsonEnemy);
  assert.equal(type, 'needleUrchin');
  const flags = enemyTypeToFlags(type, {
    xBlock: 1,
    yBlock: 1,
    kinds: ['Golden'],
    particleCount: 3,
    isBoss: false,
  });
  assert.equal(flags.isNeedleUrchin, true);
});
