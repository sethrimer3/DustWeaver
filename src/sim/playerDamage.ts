/** Added knockback speed (world units/s) per point of damage dealt. */
const DAMAGE_KNOCKBACK_SPEED_PER_DAMAGE_WORLD = 18.0;
/** Minimum knockback speed (world units/s) applied when damage is dealt. */
const MIN_DAMAGE_KNOCKBACK_SPEED_WORLD = 90.0;
/** Fixed upward lift added to knockback velocity (world units/s, negative = up). */
const KNOCKBACK_VERTICAL_LIFT_WORLD = 60.0;
/** Blend factor for smoothing the resulting knockback velocity. */
const KNOCKBACK_SMOOTH_BLEND = 0.7;
/** Fallback X direction when source and player are at the same X position. */
const FALLBACK_KNOCKBACK_DIR_X = 1.0;
/** Threshold for considering two X positions identical when computing knockback direction. */
const HORIZONTAL_POSITION_EPSILON_WORLD = 0.01;


const INVULNERABILITY_DURATION_TICKS = 90;
/** Ticks of hurt visual feedback after taking damage (~0.33 s at 60 fps). */
const HURT_VISUAL_DURATION_TICKS = 20;

/**
 * Applies damage to a player cluster and blends in knockback away from the
 * source position toward the player center.
 *
 * Higher damage increases knockback speed linearly.
 * Grants INVULNERABILITY_DURATION_TICKS of invulnerability after each hit
 * and starts the HURT_VISUAL_DURATION_TICKS visual feedback window.
 */
export interface PlayerDamageTarget {
  healthPoints: number;
  isAliveFlag: 0 | 1;
  positionXWorld: number;
  positionYWorld: number;
  velocityXWorld: number;
  velocityYWorld: number;
  isGroundedFlag: 0 | 1;
  invulnerabilityTicks: number;
  hurtTicks: number;
}

export function applyPlayerDamageWithKnockback(
  player: PlayerDamageTarget,
  damagePoints: number,
  sourceXWorld: number,
  _sourceYWorld: number,
): void {
  if (player.isAliveFlag === 0) return;
  if (player.invulnerabilityTicks > 0) return;

  const damageToApply = Math.max(0, damagePoints);
  if (damageToApply <= 0) return;

  player.healthPoints -= damageToApply;
  if (player.healthPoints <= 0) {
    player.healthPoints = 0;
    player.isAliveFlag = 0;
  }

  // Horizontal knockback direction based solely on whether the source is to
  // the left or right of the player — prevents diagonal sources from pushing
  // the player into the floor.
  const dx = player.positionXWorld - sourceXWorld;
  const dirX = Math.abs(dx) > HORIZONTAL_POSITION_EPSILON_WORLD ? (dx > 0 ? 1.0 : -1.0) : FALLBACK_KNOCKBACK_DIR_X;

  const knockbackSpeedWorld = MIN_DAMAGE_KNOCKBACK_SPEED_WORLD + damageToApply * DAMAGE_KNOCKBACK_SPEED_PER_DAMAGE_WORLD;
  const targetVelocityXWorld = dirX * knockbackSpeedWorld;
  // Always add upward lift regardless of vertical source offset so damage feels
  // impactful from any angle.
  const targetVelocityYWorld = -KNOCKBACK_VERTICAL_LIFT_WORLD;

  player.velocityXWorld = player.velocityXWorld * (1.0 - KNOCKBACK_SMOOTH_BLEND) + targetVelocityXWorld * KNOCKBACK_SMOOTH_BLEND;
  player.velocityYWorld = player.velocityYWorld * (1.0 - KNOCKBACK_SMOOTH_BLEND) + targetVelocityYWorld * KNOCKBACK_SMOOTH_BLEND;
  player.isGroundedFlag = 0;

  player.invulnerabilityTicks = INVULNERABILITY_DURATION_TICKS;
  player.hurtTicks = HURT_VISUAL_DURATION_TICKS;
}
