/**
 * Enemy AI — per-tick movement decisions for enemy clusters.
 *
 * Each alive enemy cluster independently decides each tick whether to dodge.
 * Attack and block decisions have been removed (see ENEMY_COMBAT_ARCHIVE.md).
 *
 * Called as step 0.5 in the tick pipeline.
 */

import { WorldState } from '../world';
import { nextFloat } from '../rng';
import { DASH_COOLDOWN_TICKS, DASH_RECHARGE_ANIM_TICKS, ENEMY_DODGE_SPEED_WORLD } from './dashConstants';
import { dist } from '../../utils/math';

// Re-export shared constants so callers that previously imported from this module
// don't need to change their import paths.
export { DASH_COOLDOWN_TICKS, DASH_RECHARGE_ANIM_TICKS, ENEMY_DODGE_SPEED_WORLD };

// ---- AI tuning constants -------------------------------------------------

/** Per-tick probability of starting a spontaneous dodge burst. */
const ENEMY_DODGE_CHANCE_PER_TICK = 0.025;
/** Duration of a single dodge burst (ticks). */
const ENEMY_DODGE_DURATION_TICKS = 22;

export function applyEnemyAI(world: WorldState): void {
  const { clusters, rng } = world;

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
    if (cluster.isGrappleHunterFlag === 1) continue;
    if (cluster.isBubbleEnemyFlag === 1) continue;

    // ── Tick down cooldowns ────────────────────────────────────────────────
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
    if (cluster.enemyAiDodgeTicks > 0) {
      cluster.enemyAiDodgeTicks -= 1;
      if (cluster.enemyAiDodgeTicks === 0) {
        cluster.enemyAiDodgeDirXWorld = 0.0;
        cluster.enemyAiDodgeDirYWorld = 0.0;
      }
    }

    if (!playerFound) continue;

    const dxToPlayer = playerX - cluster.positionXWorld;
    const dyToPlayer = playerY - cluster.positionYWorld;
    const distToPlayer = dist(cluster.positionXWorld, cluster.positionYWorld, playerX, playerY);

    const invDist = distToPlayer > 0.5 ? 1.0 / distToPlayer : 0.0;
    const dirToPlayerX = dxToPlayer * invDist;
    const dirToPlayerY = dyToPlayer * invDist;

    // ── Dodge / weave decision ─────────────────────────────────────────────
    // Spontaneous lateral dodge: adds life and unpredictability.
    const shouldDodge = cluster.enemyAiDodgeTicks === 0
      && cluster.dashCooldownTicks === 0
      && nextFloat(rng) < ENEMY_DODGE_CHANCE_PER_TICK;

    if (shouldDodge) {
      // Ground enemy / flying enemy: perpendicular dodge
      const side = nextFloat(rng) < 0.5 ? 1.0 : -1.0;
      cluster.enemyAiDodgeDirXWorld = -dirToPlayerY * side;
      cluster.enemyAiDodgeDirYWorld =  dirToPlayerX * side;
      cluster.enemyAiDodgeTicks = ENEMY_DODGE_DURATION_TICKS;
      cluster.dashCooldownTicks  = DASH_COOLDOWN_TICKS;
    }
  }
}
