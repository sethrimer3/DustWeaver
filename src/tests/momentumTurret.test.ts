import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClusterState } from '../sim/clusters/state';
import { createWorldState } from '../sim/world';
import { applyMomentumTurretAI, momentumTurretHasLineOfSight, segmentIntersectsAabb, updateMomentumTurretLock } from '../sim/clusters/momentumTurretAi';
import { MT_FIRE_GRACE_TICKS, MT_MAX_RING_RADIUS_WORLD, MT_SHOT_COOLDOWN_TICKS } from '../sim/clusters/momentumTurretConfig';
import { MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED } from '../sim/momentumCombatConfig';
import { applyMomentumCombatCollisionDamage, updateMomentumCombatState } from '../sim/momentumCombat';
import { enemyFlagsToType } from '../levels/roomSchemaV2';
import { enemyTypeToFlags } from '../levels/roomSchemaHydrator';
import type { RoomJsonEnemy } from '../editor/roomJsonSchema';

function fixture() {
  const world = createWorldState(1000 / 60, 1); world.combatMode = 'momentum';
  const player = createClusterState(0, 80, 20, 1, 10);
  const turret = createClusterState(1, 20, 20, 0, 2);
  turret.isMomentumTurretFlag = 1; turret.momentumTurretFacingIndex = 0;
  turret.momentumTurretTargetRadiusWorld = MT_MAX_RING_RADIUS_WORLD;
  turret.halfWidthWorld = turret.halfHeightWorld = 4; world.clusters = [player, turret];
  return { world, player, turret };
}

test('stopped closes at maximum rate and half-safe closes quadratically slower', () => {
  const a = fixture().turret; const b = fixture().turret;
  updateMomentumTurretLock(a, 0, 1000); updateMomentumTurretLock(b, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED / 2, 1000);
  assert.equal(a.momentumTurretTargetRadiusWorld, 8); assert.equal(b.momentumTurretTargetRadiusWorld, 23);
});
test('safe speed recovers and radius remains clamped', () => {
  const { turret } = fixture(); turret.momentumTurretTargetRadiusWorld = 27;
  updateMomentumTurretLock(turret, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED, 1000); assert.equal(turret.momentumTurretTargetRadiusWorld, 28);
  turret.momentumTurretTargetRadiusWorld = 0.1; updateMomentumTurretLock(turret, 0, 1000); assert.equal(turret.momentumTurretTargetRadiusWorld, 0);
});
test('segment AABB detects between but not beyond endpoint', () => {
  assert.equal(segmentIntersectsAabb(0, 0, 10, 0, 4, -1, 6, 1), true); assert.equal(segmentIntersectsAabb(0, 0, 10, 0, 12, -1, 14, 1), false);
});
test('line of sight includes invisible wall AABBs', () => {
  const { world, player, turret } = fixture(); world.wallCount = 1; world.wallXWorld[0] = 45; world.wallYWorld[0] = 0; world.wallWWorld[0] = 8; world.wallHWorld[0] = 40; world.wallIsInvisibleFlag[0] = 1;
  assert.equal(momentumTurretHasLineOfSight(world, turret, player), false); world.wallXWorld[0] = 100; assert.equal(momentumTurretHasLineOfSight(world, turret, player), true);
});
test('broken sight freezes lock and reacquisition resumes', () => {
  const { world, player, turret } = fixture(); turret.momentumTurretTargetRadiusWorld = 5; turret.momentumTurretFireGraceTicks = 3;
  world.wallCount = 1; world.wallXWorld[0] = 45; world.wallYWorld[0] = 0; world.wallWWorld[0] = 8; world.wallHWorld[0] = 40; applyMomentumTurretAI(world);
  assert.equal(turret.momentumTurretTargetRadiusWorld, 5); assert.equal(turret.momentumTurretFireGraceTicks, 3); world.wallCount = 0; player.velocityXWorld = 0; applyMomentumTurretAI(world); assert.equal(turret.momentumTurretFireGraceTicks, 2);
});
test('zero radius starts grace and safe speed cancels it', () => {
  const { world, player, turret } = fixture(); turret.momentumTurretTargetRadiusWorld = 0.01; applyMomentumTurretAI(world);
  assert.equal(turret.momentumTurretFireGraceTicks, MT_FIRE_GRACE_TICKS); assert.equal(player.healthPoints, 10); player.velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED; applyMomentumTurretAI(world); assert.equal(turret.momentumTurretFireGraceTicks, 0); assert.ok(turret.momentumTurretTargetRadiusWorld > 0);
});
test('grace expiry damages once and cooldown prevents repeats', () => {
  const { world, player, turret } = fixture(); turret.momentumTurretTargetRadiusWorld = 0; turret.momentumTurretFireGraceTicks = 1; applyMomentumTurretAI(world);
  assert.equal(player.healthPoints, 9); assert.equal(turret.momentumTurretCooldownTicks, MT_SHOT_COOLDOWN_TICKS); applyMomentumTurretAI(world); assert.equal(player.healthPoints, 9);
});
test('dead turrets do not target and live turrets remain stationary', () => {
  const dead = fixture(); dead.turret.isAliveFlag = 0; applyMomentumTurretAI(dead.world); assert.equal(dead.turret.momentumTurretHasLineOfSightFlag, 0);
  const live = fixture(); live.turret.velocityXWorld = 10; live.turret.velocityYWorld = -4; applyMomentumTurretAI(live.world); assert.equal(live.turret.velocityXWorld, 0); assert.equal(live.turret.velocityYWorld, 0);
});
test('compact room schema round-trips turret facing', () => {
  const type = enemyFlagsToType({ isMomentumTurret: true, momentumTurretFacingIndex: 3 } as RoomJsonEnemy); assert.equal(type, 'momentumTurret');
  const restored = enemyTypeToFlags(type, { xBlock: 1, yBlock: 2, kinds: ['Physical'], particleCount: 0, isBoss: false, momentumTurretFacingIndex: 3 }); assert.equal(restored.isMomentumTurret, true); assert.equal(restored.momentumTurretFacingIndex, 3);
});
test('existing momentum overlap kills turret', () => {
  const { world, player, turret } = fixture(); player.positionXWorld = turret.positionXWorld; player.positionYWorld = turret.positionYWorld; player.velocityXWorld = 400; updateMomentumCombatState(world); applyMomentumCombatCollisionDamage(world); assert.equal(turret.isAliveFlag, 0);
});
