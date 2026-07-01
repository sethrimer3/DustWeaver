/**
 * Momentum Combat system.
 *
 * SOURCE OF TRUTH: world.combatMode (synced from the module singleton at the
 * top of each tick in tick.ts).  All sim code reads world.combatMode; the
 * module singleton in combatMode.ts is the persistence/toggle layer only.
 *
 * When the player has horizontal speed ≥ MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED
 * in 'momentum' mode:
 *   - isHighVelocityAttacking is set on the player cluster
 *   - Contact damage FROM enemies is blocked (playerDamage.ts guard)
 *   - The player deals damage to overlapping enemies (AABB), using total speed
 *     for the damage formula (rewards fast grapple arcs).
 *   - Per-enemy hit cooldown (momentumHitCooldownTicks) prevents rapid re-hits.
 *
 * Damage is routed through applyMomentumEnemyHit() which mirrors the special
 * cases in particles/forces.ts (ODC ring handler, DWA hit flash, rolling aggro,
 * bubble HP-only reduction).
 */

import { WorldState } from './world';
import { applyODCHit } from './clusters/orbitalDustCoreAi';
import { DWA_HIT_FLASH_TICKS } from './clusters/dustWeaverArchitectConfig';
import {
  MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED,
  MOMENTUM_COMBAT_MIN_SPEED,
  MOMENTUM_COMBAT_DAMAGE_SCALE,
  MOMENTUM_HIT_COOLDOWN_TICKS,
} from './momentumCombatConfig';

/**
 * Pure damage formula — exported for unit tests.
 * Activation is gated on horizontal speed; damage uses TOTAL speed so fast
 * grapple arcs (which carry both horizontal and vertical momentum) deal more.
 * dmg = max(1, round(1 + (totalSpeed - baseline) * scale))
 */
export function computeMomentumDamage(totalSpeed: number): number {
  return Math.max(1, Math.round(1 + (totalSpeed - MOMENTUM_COMBAT_MIN_SPEED) * MOMENTUM_COMBAT_DAMAGE_SCALE));
}

/**
 * Apply momentum collision damage to a single enemy cluster.
 * Mirrors the special-case routing in particles/forces.ts so that:
 *   - Orbital Dust Core → ring-aware handler (applyODCHit)
 *   - Dust Weaver Architect → HP damage + hit flash
 *   - Rolling enemies → HP damage + aggro trigger
 *   - Bubble enemies → HP reduction only (let bubbleAi.ts handle pop animation)
 *   - All others → HP damage, isAlive=0 on death
 */
function applyMomentumEnemyHit(
  world: WorldState,
  enemyIdx: number,
  dmg: number,
  hitX: number,
  hitY: number,
): void {
  const enemy = world.clusters[enemyIdx];
  if (enemy.healthPoints <= 0) return;

  if (enemy.isOrbitalDustCoreFlag === 1) {
    // ODC: ring-aware handler updates ring state, hit flash, and HP.
    applyODCHit(world, enemyIdx, hitX, hitY, dmg);
    return;
  }

  enemy.healthPoints -= dmg;

  if (enemy.isBubbleEnemyFlag === 1) {
    // Bubble: do NOT set isAliveFlag=0 — bubbleAi detects HP drop and runs pop animation.
    if (enemy.healthPoints < 0) enemy.healthPoints = 0;
  } else {
    if (enemy.healthPoints <= 0) {
      enemy.healthPoints = 0;
      enemy.isAliveFlag = 0;
    }
  }

  // DWA hit flash
  if (enemy.isDustWeaverArchitectFlag === 1 && dmg > 0) {
    enemy.dustWeaverArchitectHitFlashTicks = DWA_HIT_FLASH_TICKS;
  }

  // Rolling enemy aggro (~3 s at 60 fps)
  if (enemy.isRollingEnemyFlag === 1) {
    enemy.rollingEnemyAggressiveTicks = 180;
  }
}

/**
 * Phase 1 of momentum combat — called AFTER applyGrappleClusterConstraint.
 *
 * Reads final-frame horizontal velocity (post-movement, post-grapple) to decide
 * whether the player is in the high-velocity attack state.  Using horizontal
 * speed only means a straight vertical jump (~255 px/s upward) cannot activate
 * the state — only lateral grapple/swing momentum qualifies.
 *
 * Also ticks down per-enemy hit cooldowns.
 */
export function updateMomentumCombatState(world: WorldState): void {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0 || player.isPlayerFlag === 0) return;

  const horizontalSpeed = Math.abs(player.velocityXWorld);
  // Activation: horizontal speed only — vertical jump does not count.
  const inMomentumMode = world.combatMode === 'momentum';
  player.isHighVelocityAttacking = (inMomentumMode && horizontalSpeed >= MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED) ? 1 : 0;

  // Tick down per-enemy hit cooldowns every tick regardless of mode
  for (let i = 1; i < world.clusters.length; i++) {
    const e = world.clusters[i];
    if (e.momentumHitCooldownTicks > 0) e.momentumHitCooldownTicks--;
  }
}

/**
 * Phase 2 of momentum combat — called immediately after updateMomentumCombatState.
 *
 * Applies AABB collision damage to overlapping enemies.  Uses total speed
 * (hypot(vx, vy)) for damage so fast grapple arcs that carry vertical momentum
 * deal more than flat horizontal slides at the same horizontal speed.
 */
export function applyMomentumCombatCollisionDamage(world: WorldState): void {
  const player = world.clusters[0];
  if (player === undefined || player.isHighVelocityAttacking !== 1) return;

  const vx = player.velocityXWorld;
  const vy = player.velocityYWorld;
  const totalSpeed = Math.hypot(vx, vy);

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

    const dmg = computeMomentumDamage(totalSpeed);
    applyMomentumEnemyHit(world, i, dmg, px, py);
    enemy.momentumHitCooldownTicks = MOMENTUM_HIT_COOLDOWN_TICKS;
  }
}
