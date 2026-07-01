/**
 * Momentum Combat system.
 *
 * When the player moves above MOMENTUM_COMBAT_MIN_SPEED in 'momentum' mode:
 *   - isHighVelocityAttacking is set on the player cluster
 *   - Contact damage FROM enemies is blocked (via playerDamage.ts guard)
 *   - The player deals damage to enemies whose AABB overlaps theirs,
 *     subject to per-enemy hit cooldown (momentumHitCooldownTicks on ClusterState)
 */

import { WorldState } from './world';
import { getCombatMode } from './combatMode';
import {
  MOMENTUM_COMBAT_MIN_SPEED,
  MOMENTUM_COMBAT_DAMAGE_SCALE,
  MOMENTUM_HIT_COOLDOWN_TICKS,
} from './momentumCombatConfig';

/**
 * Pure damage formula — exported for unit tests.
 * dmg = max(1, round(1 + (speed - threshold) * scale))
 */
export function computeMomentumDamage(speed: number): number {
  return Math.max(1, Math.round(1 + (speed - MOMENTUM_COMBAT_MIN_SPEED) * MOMENTUM_COMBAT_DAMAGE_SCALE));
}

export function tickMomentumCombat(world: WorldState): void {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0 || player.isPlayerFlag === 0) return;

  const vx = player.velocityXWorld;
  const vy = player.velocityYWorld;
  const speed = Math.sqrt(vx * vx + vy * vy);
  const inMomentumMode = getCombatMode() === 'momentum';

  player.isHighVelocityAttacking = (inMomentumMode && speed >= MOMENTUM_COMBAT_MIN_SPEED) ? 1 : 0;

  // Tick down per-enemy hit cooldowns every tick regardless of mode
  for (let i = 1; i < world.clusters.length; i++) {
    const e = world.clusters[i];
    if (e.momentumHitCooldownTicks > 0) e.momentumHitCooldownTicks--;
  }

  if (player.isHighVelocityAttacking !== 1) return;

  const px = player.positionXWorld;
  const py = player.positionYWorld;
  const phw = player.halfWidthWorld;
  const phh = player.halfHeightWorld;

  for (let i = 1; i < world.clusters.length; i++) {
    const enemy = world.clusters[i];
    if (enemy.isAliveFlag === 0 || enemy.isPlayerFlag === 1) continue;
    if (enemy.momentumHitCooldownTicks > 0) continue;

    // AABB overlap check
    const dx = Math.abs(px - enemy.positionXWorld);
    const dy = Math.abs(py - enemy.positionYWorld);
    if (dx >= phw + enemy.halfWidthWorld || dy >= phh + enemy.halfHeightWorld) continue;

    const dmg = computeMomentumDamage(speed);
    enemy.healthPoints -= dmg;
    if (enemy.healthPoints <= 0) {
      enemy.healthPoints = 0;
      enemy.isAliveFlag = 0;
    }
    enemy.momentumHitCooldownTicks = MOMENTUM_HIT_COOLDOWN_TICKS;
  }
}
