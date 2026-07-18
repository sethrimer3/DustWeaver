import type { ClusterState } from './state';
import type { WorldState } from '../world';
import { MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED } from '../momentumCombatConfig';
import { applyPlayerDamageWithKnockback } from '../playerDamage';
import {
  MT_FIRE_GRACE_TICKS, MT_LINE_OF_SIGHT_EPSILON_WORLD, MT_MAX_CLOSE_RATE_WORLD_PER_SEC,
  MT_MAX_RING_RADIUS_WORLD, MT_MUZZLE_OFFSET_WORLD, MT_RECOVERY_RATE_WORLD_PER_SEC,
  MT_SHOT_COOLDOWN_TICKS, MT_SHOT_DAMAGE, MT_SHOT_FLASH_TICKS,
} from './momentumTurretConfig';

export function momentumTurretFacingVector(facing: number): readonly [number, number] {
  switch (facing) {
    case 1: return [0, 1];
    case 2: return [-1, 0];
    case 3: return [0, -1];
    default: return [1, 0];
  }
}

export function segmentIntersectsAabb(
  x0: number, y0: number, x1: number, y1: number,
  minX: number, minY: number, maxX: number, maxY: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let tMin = 0;
  let tMax = 1;
  const axes: readonly [number, number, number][] = [[x0, dx, minX], [y0, dy, minY]];
  const maxima = [maxX, maxY];
  for (let axis = 0; axis < 2; axis++) {
    const [start, delta, low] = axes[axis];
    const high = maxima[axis];
    if (Math.abs(delta) < 1e-9) {
      if (start < low || start > high) return false;
      continue;
    }
    let near = (low - start) / delta;
    let far = (high - start) / delta;
    if (near > far) [near, far] = [far, near];
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    if (tMin > tMax) return false;
  }
  return tMax >= 0 && tMin <= 1;
}

export function momentumTurretHasLineOfSight(world: WorldState, turret: ClusterState, player: ClusterState): boolean {
  const [fx, fy] = momentumTurretFacingVector(turret.momentumTurretFacingIndex);
  const muzzleX = turret.positionXWorld + fx * (MT_MUZZLE_OFFSET_WORLD + MT_LINE_OF_SIGHT_EPSILON_WORLD);
  const muzzleY = turret.positionYWorld + fy * (MT_MUZZLE_OFFSET_WORLD + MT_LINE_OF_SIGHT_EPSILON_WORLD);
  for (let i = 0; i < world.wallCount; i++) {
    if (segmentIntersectsAabb(muzzleX, muzzleY, player.positionXWorld, player.positionYWorld,
      world.wallXWorld[i], world.wallYWorld[i],
      world.wallXWorld[i] + world.wallWWorld[i], world.wallYWorld[i] + world.wallHWorld[i])) return false;
  }
  return true;
}

export function updateMomentumTurretLock(turret: ClusterState, horizontalSpeed: number, dtMs: number): void {
  const speedRatio = Math.max(0, Math.min(1, horizontalSpeed / MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED));
  if (horizontalSpeed >= MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED) {
    turret.momentumTurretFireGraceTicks = 0;
    turret.momentumTurretTargetRadiusWorld = Math.min(MT_MAX_RING_RADIUS_WORLD,
      turret.momentumTurretTargetRadiusWorld + MT_RECOVERY_RATE_WORLD_PER_SEC * dtMs / 1000);
    return;
  }
  if (turret.momentumTurretFireGraceTicks > 0) {
    turret.momentumTurretFireGraceTicks--;
    return;
  }
  const dangerFactor = 1 - speedRatio;
  const closeRate = MT_MAX_CLOSE_RATE_WORLD_PER_SEC * dangerFactor * dangerFactor;
  const previous = turret.momentumTurretTargetRadiusWorld;
  turret.momentumTurretTargetRadiusWorld = Math.max(0, previous - closeRate * dtMs / 1000);
  if (previous > 0 && turret.momentumTurretTargetRadiusWorld === 0) {
    turret.momentumTurretFireGraceTicks = MT_FIRE_GRACE_TICKS;
  }
}

export function applyMomentumTurretAI(world: WorldState): void {
  const player = world.clusters[0];
  if (!player || player.isPlayerFlag !== 1 || player.isAliveFlag === 0) return;
  for (let i = 1; i < world.clusters.length; i++) {
    const turret = world.clusters[i];
    if (turret.isMomentumTurretFlag !== 1 || turret.isAliveFlag === 0) continue;
    turret.velocityXWorld = 0;
    turret.velocityYWorld = 0;
    if (turret.momentumTurretShotFlashTicks > 0) turret.momentumTurretShotFlashTicks--;
    if (turret.momentumTurretCooldownTicks > 0) {
      turret.momentumTurretCooldownTicks--;
      turret.momentumTurretHasLineOfSightFlag = 0;
      continue;
    }
    const visible = momentumTurretHasLineOfSight(world, turret, player);
    turret.momentumTurretHasLineOfSightFlag = visible ? 1 : 0;
    if (!visible) continue;
    const graceBefore = turret.momentumTurretFireGraceTicks;
    updateMomentumTurretLock(turret, Math.abs(player.velocityXWorld), world.dtMs);
    if (graceBefore === 1 && turret.momentumTurretFireGraceTicks === 0 &&
        Math.abs(player.velocityXWorld) < MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED) {
      applyPlayerDamageWithKnockback(player, MT_SHOT_DAMAGE, turret.positionXWorld, turret.positionYWorld);
      turret.momentumTurretShotFlashTicks = MT_SHOT_FLASH_TICKS;
      turret.momentumTurretCooldownTicks = MT_SHOT_COOLDOWN_TICKS;
      turret.momentumTurretTargetRadiusWorld = MT_MAX_RING_RADIUS_WORLD;
    }
  }
}
