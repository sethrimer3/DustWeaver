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

import type { ChallengeModeState } from './challengeMode';
import { consumeChallengeReturn } from './challengeMode';
import { getPlayerMoteCount, normalizeMoteCount } from './playerMoteLife';


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
  isHighVelocityAttacking?: 0 | 1;
  halfWidthWorld?: number;
  halfHeightWorld?: number;
  challengeMode?: ChallengeModeState | null;
  challengeReturnGuard?: 0 | 1;
}

export interface PlayerDamageOptions {
  challengeState?: ChallengeModeState;
  clearTransientMovement?: () => void;
  bypassMomentumInvulnerability?: boolean;
}

export function applyPlayerDamageWithKnockback(
  player: PlayerDamageTarget,
  damagePoints: number,
  sourceXWorld: number,
  _sourceYWorld: number,
  options?: PlayerDamageOptions,
): boolean {
  if (player.isAliveFlag === 0) return false;
  if (player.invulnerabilityTicks > 0) return false;
  if (player.isHighVelocityAttacking === 1 && options?.bypassMomentumInvulnerability !== true) return false; // momentum combat invulnerability
  if (player.challengeReturnGuard === 1) return false;

  const damageToApply = normalizeMoteCount(Math.ceil(damagePoints));
  if (damageToApply <= 0) return false;

  const challenge = options?.challengeState ?? player.challengeMode ?? undefined;
  if (challenge?.isActive) {
    const anchorXWorld = challenge.anchorXWorld;
    const anchorYWorld = challenge.anchorYWorld;
    if (!consumeChallengeReturn(challenge)) return false;
    player.positionXWorld = anchorXWorld;
    player.positionYWorld = anchorYWorld;
    player.velocityXWorld = 0;
    player.velocityYWorld = 0;
    player.isGroundedFlag = 0;
    player.challengeReturnGuard = 1;
    options?.clearTransientMovement?.();
    return true;
  }

  // Reaching zero motes is survivable. A subsequent otherwise-valid damage
  // event at zero is fatal through this canonical pipeline.
  if (getPlayerMoteCount(player) === 0) {
    player.healthPoints = 0;
    player.isAliveFlag = 0;
    return true;
  }

  player.healthPoints = Math.max(0, getPlayerMoteCount(player) - damageToApply);

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
  return true;
}

export function killPlayerImmediately(player: PlayerDamageTarget): void {
  if (player.isAliveFlag === 0) return;
  player.healthPoints = 0;
  player.isAliveFlag = 0;
}
