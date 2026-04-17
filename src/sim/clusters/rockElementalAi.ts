/**
 * Rock Elemental AI — state machine and per-tick behavior.
 *
 * States:
 *   0 = inactive    — rock pieces on ground, not damageable, awaiting player proximity
 *   1 = activating  — lerping from ground to floating formation over ACTIVATION_DURATION_TICKS
 *   2 = active      — hovering, orbiting dust, approaching preferred distance
 *   3 = evading     — retreating away from player when too close
 *   4 = attacking   — firing a dust projectile at the player
 *   5 = regenerating — rebuilding dust count after firing
 *   6 = dead
 *
 * Called from tick.ts after applyEnemyAI (step 0.5b).
 */

import { WorldState } from '../world';
import { dist } from '../../utils/math';

// ── Tuning constants (exposed for easy adjustment) ─────────────────────────

/** Distance (world units) at which the elemental activates. (180 px) */
export const RE_ACTIVATION_RANGE_WORLD = 180.0;

/** Duration of activation transition in ticks (0.5 s at 60 fps). */
export const RE_ACTIVATION_DURATION_TICKS = 30;

/** Preferred distance from player (world units). (140 px) */
export const RE_PREFERRED_DISTANCE_WORLD = 140.0;

/** Distance below which the elemental starts evading (world units). (80 px) */
export const RE_EVADE_THRESHOLD_WORLD = 80.0;

/** Maximum hover height above the ground (world units). (40 px) */
export const RE_MAX_HOVER_HEIGHT_WORLD = 40.0;

/** Maximum distance from spawn point (world units). (220 px) */
export const RE_LEASH_RADIUS_WORLD = 220.0;

/** Horizontal movement speed (world units/s). */
export const RE_MOVE_SPEED_WORLD_PER_SEC = 65.0;

/** Acceleration blend factor per second (exponential steering). */
export const RE_ACCEL_PER_SEC = 4.0;

/** Maximum orbiting dust count. */
export const RE_MAX_DUST_COUNT = 12;

/** Orbit radius for dust particles (world units). (36 px) */
export const RE_ORBIT_RADIUS_WORLD = 36.0;

/** Orbit angular speed (radians/tick). ~medium visible rotation. */
export const RE_ORBIT_SPEED_RAD_PER_TICK = 0.04;

/** Ticks between dust regeneration events (0.8 s at 60 fps). */
export const RE_REGEN_INTERVAL_TICKS = 48;

/** Dust projectile speed (world units/s). (220 px/s) */
export const RE_PROJECTILE_SPEED_WORLD_PER_SEC = 220.0;

/** Ticks a fired dust projectile stays alive before expiring. */
export const RE_PROJECTILE_LIFETIME_TICKS = 180;

// ── State enum (numeric for zero-allocation comparison) ─────────────────────

export const RE_STATE_INACTIVE     = 0;
export const RE_STATE_ACTIVATING   = 1;
export const RE_STATE_ACTIVE       = 2;
export const RE_STATE_EVADING      = 3;
export const RE_STATE_ATTACKING    = 4;
export const RE_STATE_REGENERATING = 5;
export const RE_STATE_DEAD         = 6;

// ── Main AI update ──────────────────────────────────────────────────────────

export function applyRockElementalAI(world: WorldState): void {
  const dtSec = world.dtMs / 1000.0;

  // Find player
  let playerX = 0.0;
  let playerY = 0.0;
  let playerFound = false;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerX = c.positionXWorld;
      playerY = c.positionYWorld;
      playerFound = true;
      break;
    }
  }

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isRockElementalFlag !== 1) continue;
    if (cluster.isAliveFlag === 0) {
      cluster.rockElementalState = RE_STATE_DEAD;
      continue;
    }

    const state = cluster.rockElementalState;
    cluster.rockElementalStateTicks += 1;

    // Distance to player
    const dxToPlayer = playerFound ? playerX - cluster.positionXWorld : 0;
    const distToPlayer = playerFound ? dist(cluster.positionXWorld, cluster.positionYWorld, playerX, playerY) : 0;

    // Distance from spawn (for leash)
    const dxFromSpawn = cluster.positionXWorld - cluster.rockElementalSpawnXWorld;
    const distFromSpawn = dist(cluster.positionXWorld, cluster.positionYWorld, cluster.rockElementalSpawnXWorld, cluster.rockElementalSpawnYWorld);

    switch (state) {
      // ── INACTIVE ──────────────────────────────────────────────────────
      case RE_STATE_INACTIVE:
        // Not damageable, no movement.
        // Check activation trigger.
        if (playerFound && distToPlayer <= RE_ACTIVATION_RANGE_WORLD) {
          cluster.rockElementalState = RE_STATE_ACTIVATING;
          cluster.rockElementalStateTicks = 0;
          cluster.rockElementalActivationProgress = 0;
        }
        break;

      // ── ACTIVATING ────────────────────────────────────────────────────
      case RE_STATE_ACTIVATING: {
        const progress = cluster.rockElementalStateTicks / RE_ACTIVATION_DURATION_TICKS;
        cluster.rockElementalActivationProgress = progress < 1.0 ? progress : 1.0;
        if (cluster.rockElementalStateTicks >= RE_ACTIVATION_DURATION_TICKS) {
          cluster.rockElementalState = RE_STATE_REGENERATING;
          cluster.rockElementalStateTicks = 0;
          cluster.rockElementalActivationProgress = 1.0;
        }
        break;
      }

      // ── ACTIVE (hovering, approaching preferred distance) ──────────────
      case RE_STATE_ACTIVE:
        if (playerFound && distToPlayer < RE_EVADE_THRESHOLD_WORLD) {
          cluster.rockElementalState = RE_STATE_EVADING;
          cluster.rockElementalStateTicks = 0;
        } else if (cluster.rockElementalDustCount >= RE_MAX_DUST_COUNT) {
          // Ready to fire
          cluster.rockElementalState = RE_STATE_ATTACKING;
          cluster.rockElementalStateTicks = 0;
        }
        // Movement handled below
        break;

      // ── EVADING ───────────────────────────────────────────────────────
      case RE_STATE_EVADING:
        if (!playerFound || distToPlayer >= RE_PREFERRED_DISTANCE_WORLD) {
          cluster.rockElementalState = RE_STATE_ACTIVE;
          cluster.rockElementalStateTicks = 0;
        }
        // Movement handled below (retreat direction)
        break;

      // ── ATTACKING (fire one dust projectile) ──────────────────────────
      case RE_STATE_ATTACKING:
        // Attack is handled by the dust system; transition back immediately
        // The dust system reads this state to know when to fire.
        // After one tick in attacking state, go to regenerating.
        if (cluster.rockElementalStateTicks >= 2) {
          cluster.rockElementalState = RE_STATE_REGENERATING;
          cluster.rockElementalStateTicks = 0;
        }
        break;

      // ── REGENERATING (building up dust orbit) ─────────────────────────
      case RE_STATE_REGENERATING:
        cluster.rockElementalRegenTicks += 1;
        if (cluster.rockElementalRegenTicks >= RE_REGEN_INTERVAL_TICKS) {
          cluster.rockElementalRegenTicks = 0;
          if (cluster.rockElementalDustCount < RE_MAX_DUST_COUNT) {
            cluster.rockElementalDustCount += 1;
          }
        }
        if (cluster.rockElementalDustCount >= RE_MAX_DUST_COUNT) {
          cluster.rockElementalState = RE_STATE_ACTIVE;
          cluster.rockElementalStateTicks = 0;
        }
        break;

      // ── DEAD ──────────────────────────────────────────────────────────
      case RE_STATE_DEAD:
        // No behavior
        break;
    }

    // ── Movement (active states only) ──────────────────────────────────────
    if (state >= RE_STATE_ACTIVE && state <= RE_STATE_REGENERATING) {
      // Update orbit angle
      cluster.rockElementalOrbitAngleRad += RE_ORBIT_SPEED_RAD_PER_TICK;
      if (cluster.rockElementalOrbitAngleRad > Math.PI * 2.0) {
        cluster.rockElementalOrbitAngleRad -= Math.PI * 2.0;
      }

      let targetVelX = 0.0;

      if (playerFound) {
        const invDist = distToPlayer > 0.5 ? 1.0 / distToPlayer : 0.0;
        const dirX = dxToPlayer * invDist;

        if (state === RE_STATE_EVADING) {
          // Move away from player
          targetVelX = -dirX * RE_MOVE_SPEED_WORLD_PER_SEC;
        } else if (distToPlayer > RE_PREFERRED_DISTANCE_WORLD + 20.0) {
          // Approach player
          targetVelX = dirX * RE_MOVE_SPEED_WORLD_PER_SEC;
        } else if (distToPlayer < RE_PREFERRED_DISTANCE_WORLD - 20.0) {
          // Too close, drift away
          targetVelX = -dirX * RE_MOVE_SPEED_WORLD_PER_SEC * 0.5;
        }
        // else in sweet spot — gentle hover (targetVelX stays 0)
      }

      // Leash: if too far from spawn, pull back
      if (distFromSpawn > RE_LEASH_RADIUS_WORLD) {
        const leashPull = (distFromSpawn - RE_LEASH_RADIUS_WORLD) / 50.0;
        const pullDirX = -dxFromSpawn / (distFromSpawn + 0.001);
        targetVelX += pullDirX * RE_MOVE_SPEED_WORLD_PER_SEC * Math.min(leashPull, 1.5);
      }

      // Exponential blend
      const alpha = RE_ACCEL_PER_SEC * dtSec;
      const clampedAlpha = alpha < 1.0 ? alpha : 1.0;
      cluster.velocityXWorld += (targetVelX - cluster.velocityXWorld) * clampedAlpha;

      // Hover: gently float near ground level (apply small upward force to counteract gravity)
      // The gravity is applied by the ground enemy section of movement.ts
      // Rock Elementals should hover, so we cancel gravity and hover
      // This is handled in movement.ts where we skip gravity for rock elementals
    }
  }
}
