/**
 * Authoritative player-water movement tuning and velocity helpers.
 *
 * Up is negative on the world Y axis. Drag coefficients are exponential
 * damping rates in 1/s, so results remain stable across timestep subdivision.
 */

import type { WorldState } from '../world';
import type { ClusterState } from './state';
import {
  debugSpeedOverrides,
  NORMAL_GRAVITY_WORLD_PER_SEC2,
  ov,
  PLAYER_JUMP_SPEED_WORLD,
} from './movementConstants';

export const PLAYER_WATER_STATE_OUTSIDE = 0;
export const PLAYER_WATER_STATE_SURFACE = 1;
export const PLAYER_WATER_STATE_SUBMERGED = 2;
export type PlayerWaterState =
  | typeof PLAYER_WATER_STATE_OUTSIDE
  | typeof PLAYER_WATER_STATE_SURFACE
  | typeof PLAYER_WATER_STATE_SUBMERGED;

/** Retained gravity while the player is touching water, relative to air gravity. */
export const WATER_GRAVITY_MULTIPLIER = 0.18;
/** Baseline upward buoyancy acceleration while touching a water surface (wu/s²). */
export const WATER_BUOYANCY_BASE_ACCEL_WORLD_PER_SEC2 = 80;
/** Additional upward acceleration at full submersion (wu/s²). */
export const WATER_BUOYANCY_SUBMERSION_ACCEL_WORLD_PER_SEC2 = 280;
/** Horizontal exponential damping rate in 1/s. */
export const WATER_HORIZONTAL_DRAG_PER_SEC = 2.8;
/** Vertical exponential damping rate in 1/s. */
export const WATER_VERTICAL_DRAG_PER_SEC = 3.0;
/** Extra vertical damping near the surface, preventing buoyancy overshoot/jitter. */
export const WATER_SURFACE_VERTICAL_DRAG_BOOST_PER_SEC = 4.5;
/** Water strokes restore half of the configured normal jump speed. */
export const WATER_JUMP_STRENGTH_MULTIPLIER = 0.5;
/** Surface separation retained during exit hysteresis (world units). */
export const WATER_SURFACE_STATE_TOLERANCE_WORLD = 1;
/** Ratio required to enter the substantially-submerged state. */
export const WATER_SUBMERGED_ENTER_RATIO = 0.55;
/** Lower ratio required to leave substantially-submerged state. */
export const WATER_SUBMERGED_EXIT_RATIO = 0.35;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Integrates constant acceleration plus linear drag analytically for `dtSec`.
 * This avoids fixed-per-frame velocity subtraction and remains stable for large
 * or subdivided timesteps.
 */
export function integrateVelocityWithLinearDrag(
  velocityWorldPerSec: number,
  accelerationWorldPerSec2: number,
  dragPerSec: number,
  dtSec: number,
): number {
  if (dtSec <= 0) return velocityWorldPerSec;
  if (dragPerSec <= 0) {
    return velocityWorldPerSec + accelerationWorldPerSec2 * dtSec;
  }
  const damping = Math.exp(-dragPerSec * dtSec);
  const terminalVelocity = accelerationWorldPerSec2 / dragPerSec;
  return terminalVelocity + (velocityWorldPerSec - terminalVelocity) * damping;
}

/** Applies buoyancy, retained gravity, deliberate diving, and vertical drag. */
export function applyPlayerWaterVerticalForces(
  cluster: ClusterState,
  world: WorldState,
  dtSec: number,
): void {
  const submersion = clamp01(world.playerWaterSubmersionRatio);
  const baseGravity = ov(debugSpeedOverrides.gravityWorld, NORMAL_GRAVITY_WORLD_PER_SEC2);
  const gravityAccel = baseGravity * WATER_GRAVITY_MULTIPLIER;
  const buoyancyAccel = WATER_BUOYANCY_BASE_ACCEL_WORLD_PER_SEC2
    + WATER_BUOYANCY_SUBMERSION_ACCEL_WORLD_PER_SEC2 * submersion;
  const netAcceleration = gravityAccel - buoyancyAccel;
  const verticalDragPerSec = WATER_VERTICAL_DRAG_PER_SEC
    + WATER_SURFACE_VERTICAL_DRAG_BOOST_PER_SEC * (1 - submersion);

  cluster.velocityYWorld = integrateVelocityWithLinearDrag(
    cluster.velocityYWorld,
    netAcceleration,
    verticalDragPerSec,
    dtSec,
  );
}

/** Applies frame-rate-independent horizontal water resistance after controls. */
export function applyPlayerWaterHorizontalDrag(cluster: ClusterState, dtSec: number): void {
  cluster.velocityXWorld = integrateVelocityWithLinearDrag(
    cluster.velocityXWorld,
    0,
    WATER_HORIZONTAL_DRAG_PER_SEC,
    dtSec,
  );
}

/** Positive magnitude of the half-strength water-jump speed. */
export function getWaterJumpSpeedWorld(): number {
  return ov(debugSpeedOverrides.jumpSpeedWorld, PLAYER_JUMP_SPEED_WORLD)
    * WATER_JUMP_STRENGTH_MULTIPLIER;
}

/**
 * Restores the water-stroke threshold without adding velocity.
 * Negative Y is upward, so a numerically greater velocity is moving upward
 * more slowly than the negative threshold and is replaced.
 */
export function applyNonAdditiveWaterJump(cluster: ClusterState): void {
  const upwardVelocityThreshold = -getWaterJumpSpeedWorld();
  if (cluster.velocityYWorld > upwardVelocityThreshold) {
    cluster.velocityYWorld = upwardVelocityThreshold;
  }
}
