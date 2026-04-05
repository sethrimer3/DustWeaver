/** Added knockback speed (world units/s) per point of damage dealt. */
const DAMAGE_KNOCKBACK_SPEED_PER_DAMAGE_WORLD = 18.0;
/** Minimum knockback speed (world units/s) applied when damage is dealt. */
const MIN_DAMAGE_KNOCKBACK_SPEED_WORLD = 90.0;
/** Blend factor for smoothing the resulting knockback velocity. */
const KNOCKBACK_SMOOTH_BLEND = 0.7;
/** Fallback X direction when source and player centers are almost identical. */
const FALLBACK_KNOCKBACK_DIR_X = 1.0;

/**
 * Applies damage to a player cluster and blends in knockback away from the
 * source position toward the player center.
 *
 * Higher damage increases knockback speed linearly.
 */
export interface PlayerDamageTarget {
  healthPoints: number;
  isAliveFlag: 0 | 1;
  positionXWorld: number;
  positionYWorld: number;
  velocityXWorld: number;
  velocityYWorld: number;
  isGroundedFlag: 0 | 1;
}

export function applyPlayerDamageWithKnockback(
  player: PlayerDamageTarget,
  damagePoints: number,
  sourceXWorld: number,
  sourceYWorld: number,
): void {
  if (player.isAliveFlag === 0) return;

  const damageToApply = Math.max(0, damagePoints);
  if (damageToApply <= 0) return;

  player.healthPoints -= damageToApply;
  if (player.healthPoints <= 0) {
    player.healthPoints = 0;
    player.isAliveFlag = 0;
  }

  const dx = player.positionXWorld - sourceXWorld;
  const dy = player.positionYWorld - sourceYWorld;
  const distSq = dx * dx + dy * dy;
  let dirX = FALLBACK_KNOCKBACK_DIR_X;
  let dirY = 0.0;
  if (distSq > 0.000001) {
    const invDist = 1.0 / Math.sqrt(distSq);
    dirX = dx * invDist;
    dirY = dy * invDist;
  }

  const knockbackSpeedWorld = MIN_DAMAGE_KNOCKBACK_SPEED_WORLD + damageToApply * DAMAGE_KNOCKBACK_SPEED_PER_DAMAGE_WORLD;
  const targetVelocityXWorld = dirX * knockbackSpeedWorld;
  const targetVelocityYWorld = dirY * knockbackSpeedWorld;

  player.velocityXWorld = player.velocityXWorld * (1.0 - KNOCKBACK_SMOOTH_BLEND) + targetVelocityXWorld * KNOCKBACK_SMOOTH_BLEND;
  player.velocityYWorld = player.velocityYWorld * (1.0 - KNOCKBACK_SMOOTH_BLEND) + targetVelocityYWorld * KNOCKBACK_SMOOTH_BLEND;
  player.isGroundedFlag = 0;
}
