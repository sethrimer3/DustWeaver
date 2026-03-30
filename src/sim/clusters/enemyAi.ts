/**
 * Enemy AI — per-tick combat decisions for enemy clusters.
 *
 * Each alive enemy cluster independently decides each tick whether to:
 *   • Attack  — fling particles toward the player when in range and cooldown elapsed.
 *   • Block   — form a shield when player particles are bearing down on the enemy.
 *   • Dodge   — burst sideways to avoid incoming attacks and feel more alive.
 *
 * Decisions are stored directly on ClusterState fields (enemyAttackTriggeredFlag,
 * enemyAiIsBlockingFlag, enemyAiDodge*) so they can be consumed in the same tick
 * by the combat and movement systems.
 *
 * Called as step 0.5 in the tick pipeline, before combat forces (step 4.5).
 */

import { WorldState } from '../world';
import { nextFloat } from '../rng';
import { DASH_COOLDOWN_TICKS, DASH_RECHARGE_ANIM_TICKS, ENEMY_DODGE_SPEED_WORLD } from './dashConstants';

// Re-export shared constants so callers that previously imported from this module
// don't need to change their import paths.
export { DASH_COOLDOWN_TICKS, DASH_RECHARGE_ANIM_TICKS, ENEMY_DODGE_SPEED_WORLD };

// ---- AI tuning constants -------------------------------------------------

/** Distance (world units) at which an enemy starts launching attacks. */
const ENEMY_ATTACK_RANGE_WORLD = 320.0;
/** Ticks between enemy attack launches (~2 seconds at 60 fps). */
const ENEMY_ATTACK_COOLDOWN_TICKS = 120;
/** Distance at which incoming player particles trigger a block response. */
const ENEMY_BLOCK_DETECTION_RANGE_WORLD = 160.0;
/** Ticks an enemy block stance lasts before auto-releasing. */
const ENEMY_BLOCK_DURATION_TICKS = 55;
/** Ticks between an enemy can block again after releasing. */
const ENEMY_BLOCK_COOLDOWN_TICKS = 60;
/** Per-tick probability of starting a spontaneous dodge burst. */
const ENEMY_DODGE_CHANCE_PER_TICK = 0.025;
/** Duration of a single dodge burst (ticks). */
const ENEMY_DODGE_DURATION_TICKS = 22;
/** Speed (world units / sec) of a dodge burst. */
export const ENEMY_DASH_SPEED_WORLD = ENEMY_DODGE_SPEED_WORLD;

export function applyEnemyAI(world: WorldState): void {
  const { clusters, isAliveFlag, ownerEntityId, behaviorMode,
          positionXWorld, positionYWorld, velocityXWorld, velocityYWorld,
          particleCount, rng } = world;

  // Find player cluster
  let playerX = 0.0;
  let playerY = 0.0;
  let playerFound = false;
  for (let ci = 0; ci < clusters.length; ci++) {
    const c = clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerX = c.positionXWorld;
      playerY = c.positionYWorld;
      playerFound = true;
      break;
    }
  }

  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci];
    if (cluster.isPlayerFlag === 1 || cluster.isAliveFlag === 0) continue;
    // Skip specialized enemies that have their own AI modules
    if (cluster.isRadiantTetherFlag === 1) continue;

    // ── Tick down cooldowns ────────────────────────────────────────────────
    if (cluster.enemyAiAttackCooldownTicks > 0) {
      cluster.enemyAiAttackCooldownTicks -= 1;
    }
    if (cluster.dashCooldownTicks > 0) {
      const wasOnCooldown = cluster.dashCooldownTicks > 0;
      cluster.dashCooldownTicks -= 1;
      if (wasOnCooldown && cluster.dashCooldownTicks === 0) {
        cluster.dashRechargeAnimTicks = DASH_RECHARGE_ANIM_TICKS;
      }
    }
    if (cluster.dashRechargeAnimTicks > 0) {
      cluster.dashRechargeAnimTicks -= 1;
    }
    if (cluster.enemyAiBlockRemainingTicks > 0) {
      cluster.enemyAiBlockRemainingTicks -= 1;
      if (cluster.enemyAiBlockRemainingTicks === 0) {
        cluster.enemyAiIsBlockingFlag = 0;
        // Small cooldown before re-blocking (reuse attackCooldown slot as a
        // stand-in to prevent instant re-block after release)
      }
    }
    if (cluster.enemyAiDodgeTicks > 0) {
      cluster.enemyAiDodgeTicks -= 1;
      if (cluster.enemyAiDodgeTicks === 0) {
        cluster.enemyAiDodgeDirXWorld = 0.0;
        cluster.enemyAiDodgeDirYWorld = 0.0;
      }
    }

    // Clear per-tick trigger flag
    cluster.enemyAttackTriggeredFlag = 0;

    if (!playerFound) continue;

    const dxToPlayer = playerX - cluster.positionXWorld;
    const dyToPlayer = playerY - cluster.positionYWorld;
    const distToPlayer = Math.sqrt(dxToPlayer * dxToPlayer + dyToPlayer * dyToPlayer);

    const invDist = distToPlayer > 0.5 ? 1.0 / distToPlayer : 0.0;
    const dirToPlayerX = dxToPlayer * invDist;
    const dirToPlayerY = dyToPlayer * invDist;

    // ── Detect incoming player attack particles ────────────────────────────
    // Scan all alive player particles in attack mode that are heading toward
    // this enemy cluster within the detection range.
    let incomingThreatCount = 0;
    for (let i = 0; i < particleCount; i++) {
      if (isAliveFlag[i] === 0) continue;
      if (behaviorMode[i] !== 1) continue; // attack mode only

      // Check ownership: is this a player particle?
      const ownerId = ownerEntityId[i];
      let isPlayerParticle = false;
      for (let cj = 0; cj < clusters.length; cj++) {
        if (clusters[cj].entityId === ownerId && clusters[cj].isPlayerFlag === 1) {
          isPlayerParticle = true;
          break;
        }
      }
      if (!isPlayerParticle) continue;

      const px = positionXWorld[i];
      const py = positionYWorld[i];
      const dxToEnemy = cluster.positionXWorld - px;
      const dyToEnemy = cluster.positionYWorld - py;
      const distToEnemy = Math.sqrt(dxToEnemy * dxToEnemy + dyToEnemy * dyToEnemy);
      if (distToEnemy > ENEMY_BLOCK_DETECTION_RANGE_WORLD) continue;

      // Particle must be generally moving toward this enemy
      const vx = velocityXWorld[i];
      const vy = velocityYWorld[i];
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed < 50.0) continue;
      // Dot product of velocity direction with direction-to-enemy
      const dot = (vx * dxToEnemy + vy * dyToEnemy) / (speed * distToEnemy + 0.001);
      if (dot > 0.5) incomingThreatCount++;
    }

    // ── Block decision ─────────────────────────────────────────────────────
    if (incomingThreatCount >= 1 && cluster.enemyAiIsBlockingFlag === 0
        && cluster.enemyAiBlockRemainingTicks === 0) {
      cluster.enemyAiIsBlockingFlag = 1;
      if (cluster.isRollingEnemyFlag === 1) {
        // Rolling enemies form a crescent shield on the player-facing side.
        // Block direction points TOWARD the player so the crescent is between
        // enemy and player.
        cluster.enemyAiBlockDirXWorld = dirToPlayerX;
        cluster.enemyAiBlockDirYWorld = dirToPlayerY;
      } else {
        // Other enemies shield the back side (existing behaviour)
        cluster.enemyAiBlockDirXWorld = -dirToPlayerX;
        cluster.enemyAiBlockDirYWorld = -dirToPlayerY;
      }
      cluster.enemyAiBlockRemainingTicks = ENEMY_BLOCK_DURATION_TICKS;
      // Stagger next attack a bit (don't attack while blocking)
      if (cluster.enemyAiAttackCooldownTicks < ENEMY_BLOCK_COOLDOWN_TICKS) {
        cluster.enemyAiAttackCooldownTicks = ENEMY_BLOCK_COOLDOWN_TICKS;
      }
    }

    // ── Attack decision ────────────────────────────────────────────────────
    if (distToPlayer <= ENEMY_ATTACK_RANGE_WORLD
        && cluster.enemyAiAttackCooldownTicks === 0
        && cluster.enemyAiIsBlockingFlag === 0) {
      cluster.enemyAttackTriggeredFlag = 1;
      cluster.enemyAttackDirXWorld = dirToPlayerX;
      cluster.enemyAttackDirYWorld = dirToPlayerY;
      cluster.enemyAiAttackCooldownTicks = ENEMY_ATTACK_COOLDOWN_TICKS;
    }

    // ── Dodge / weave decision ─────────────────────────────────────────────
    // Spontaneous lateral dodge: adds life and unpredictability.
    // Also triggered when threatened (incoming particles detected).
    // Flying eyes dodge more eagerly and dash directly away from threats.
    const flyingEyeThreatened = cluster.isFlyingEyeFlag === 1 && incomingThreatCount >= 1;
    const shouldDodge = cluster.enemyAiDodgeTicks === 0
      && cluster.dashCooldownTicks === 0
      && (incomingThreatCount >= 2 || nextFloat(rng) < ENEMY_DODGE_CHANCE_PER_TICK
          || flyingEyeThreatened);

    if (shouldDodge) {
      if (flyingEyeThreatened) {
        // Flying eye dashes directly away from the player when threatened
        cluster.enemyAiDodgeDirXWorld = -dirToPlayerX;
        cluster.enemyAiDodgeDirYWorld = -dirToPlayerY;
      } else {
        // Ground enemy / non-threatened flying eye: perpendicular dodge
        const side = nextFloat(rng) < 0.5 ? 1.0 : -1.0;
        cluster.enemyAiDodgeDirXWorld = -dirToPlayerY * side;
        cluster.enemyAiDodgeDirYWorld =  dirToPlayerX * side;
      }
      cluster.enemyAiDodgeTicks = ENEMY_DODGE_DURATION_TICKS;
      cluster.dashCooldownTicks  = DASH_COOLDOWN_TICKS;
    }
  }
}
