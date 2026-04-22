/**
 * Enemy-specific velocity logic extracted from movement.ts.
 *
 * Handles:
 *   • Flying Eye: 2D steering toward/away from player, dodge, facing angle
 *   • Rock Elemental: hover vs grounded gravity
 *   • Radiant Tether: no gravity (movement via chain system)
 *   • Ground enemy: gravity, horizontal chase toward player, dodge blending
 */

import { WorldState } from '../world';
import { ClusterState } from './state';
import { ENEMY_DODGE_SPEED_WORLD } from './dashConstants';

import {
  NORMAL_GRAVITY_WORLD_PER_SEC2,
  FAST_MAX_FALL_WORLD_PER_SEC,
  ENEMY_MAX_SPEED_WORLD_PER_SEC,
  ENEMY_ACCEL_PER_SEC,
  ENEMY_ENGAGE_DIST_WORLD,
  ROLLING_ENEMY_SIGHT_RANGE_WORLD,
  FLYING_EYE_SPEED_WORLD_PER_SEC,
  FLYING_EYE_ACCEL_PER_SEC,
  FLYING_EYE_PREFERRED_DIST_WORLD,
  FLYING_EYE_PREFERRED_BAND_WORLD,
  FLYING_EYE_TURN_RATE_PER_SEC,
} from './movementConstants';

/**
 * Tick all enemy-specific velocity logic for a single cluster.
 * Called once per tick for each non-player cluster.
 *
 * @param _world - Passed for API consistency with tickPlayerMovement;
 *                 not currently read but available for future enemy mechanics.
 */
export function tickEnemyMovement(
  cluster: ClusterState,
  _world: WorldState,
  dtSec: number,
  playerXWorld: number,
  playerYWorld: number,
  isPlayerFound: boolean,
): void {
  // Slime enemies have their own hop AI — skip standard movement; gravity
  // is applied inside slimeAi.ts
  if (cluster.isSlimeFlag === 1 || cluster.isLargeSlimeFlag === 1) {
    return;
  }
  // Wheel enemies have their own movement AI — skip standard movement
  if (cluster.isWheelEnemyFlag === 1) {
    return;
  }
  // Bubble enemies have their own AI — skip standard gravity/movement
  if (cluster.isBubbleEnemyFlag === 1) {
    return;
  }
  // Golden Mimic has its own movement AI — velocity set in goldenMimicAi.ts
  if (cluster.isGoldenMimicFlag === 1) {
    return;
  }
  if (cluster.isFlyingEyeFlag === 1) {
    // ── Flying Eye: no gravity, 2D steering toward/away from player ────────
    if (isPlayerFound) {
      const dxToPlayer = playerXWorld - cluster.positionXWorld;
      const dyToPlayer = playerYWorld - cluster.positionYWorld;
      const distToPlayer = Math.sqrt(dxToPlayer * dxToPlayer + dyToPlayer * dyToPlayer);
      const invDist = distToPlayer > 0.5 ? 1.0 / distToPlayer : 0.0;
      const dirX = dxToPlayer * invDist;
      const dirY = dyToPlayer * invDist;

      let targetVelX: number;
      let targetVelY: number;

      const outerBand = FLYING_EYE_PREFERRED_DIST_WORLD + FLYING_EYE_PREFERRED_BAND_WORLD;
      const innerBand = FLYING_EYE_PREFERRED_DIST_WORLD - FLYING_EYE_PREFERRED_BAND_WORLD;

      if (distToPlayer > outerBand) {
        // Too far — fly toward player
        targetVelX = dirX * FLYING_EYE_SPEED_WORLD_PER_SEC;
        targetVelY = dirY * FLYING_EYE_SPEED_WORLD_PER_SEC;
      } else if (distToPlayer < innerBand) {
        // Too close — retreat away from player
        targetVelX = -dirX * FLYING_EYE_SPEED_WORLD_PER_SEC;
        targetVelY = -dirY * FLYING_EYE_SPEED_WORLD_PER_SEC;
      } else {
        // In preferred band — gentle circular drift perpendicular to player
        targetVelX = -dirY * FLYING_EYE_SPEED_WORLD_PER_SEC * 0.3;
        targetVelY =  dirX * FLYING_EYE_SPEED_WORLD_PER_SEC * 0.3;
      }

      // Flying eyes apply dodge in full 2D (both X and Y components)
      if (cluster.enemyAiDodgeTicks > 0) {
        targetVelX += cluster.enemyAiDodgeDirXWorld * ENEMY_DODGE_SPEED_WORLD * 1.6;
        targetVelY += cluster.enemyAiDodgeDirYWorld * ENEMY_DODGE_SPEED_WORLD * 1.6;
      }

      const alpha = FLYING_EYE_ACCEL_PER_SEC * dtSec;
      const clampedAlpha = alpha < 1.0 ? alpha : 1.0;
      cluster.velocityXWorld += (targetVelX - cluster.velocityXWorld) * clampedAlpha;
      cluster.velocityYWorld += (targetVelY - cluster.velocityYWorld) * clampedAlpha;
    }

    // Update facing angle to smoothly track velocity direction
    const eyeSpeed = Math.sqrt(
      cluster.velocityXWorld * cluster.velocityXWorld +
      cluster.velocityYWorld * cluster.velocityYWorld,
    );
    if (eyeSpeed > 8.0) {
      const targetAngleRad = Math.atan2(cluster.velocityYWorld, cluster.velocityXWorld);
      // Normalise to [-PI, PI] in O(1) with modulo arithmetic
      let angleDiff = ((targetAngleRad - cluster.flyingEyeFacingAngleRad + Math.PI)
        % (Math.PI * 2.0)) - Math.PI;
      if (angleDiff < -Math.PI) angleDiff += Math.PI * 2.0;
      cluster.flyingEyeFacingAngleRad += angleDiff
        * Math.min(1.0, FLYING_EYE_TURN_RATE_PER_SEC * dtSec);
    }

  } else if (cluster.isRockElementalFlag === 1) {
    // ── Rock Elemental: hover near ground, no standard gravity ─────────────
    // When inactive or activating, stay grounded (apply gravity).
    // When active+, hover: apply gentle upward force to counteract gravity,
    // constrained to a max hover height.
    if (cluster.rockElementalState >= 2) {
      // Active states: hover behavior
      // Apply reduced gravity
      const hoverGrav = 200.0; // Much lighter than normal gravity (900)
      cluster.velocityYWorld += hoverGrav * dtSec;
      
      // Cap downward velocity (gentle float)
      if (cluster.velocityYWorld > 40.0) {
        cluster.velocityYWorld = 40.0;
      }
    } else {
      // Inactive/activating: standard gravity (sit on ground)
      cluster.velocityYWorld += 900.0 * dtSec;
      if (cluster.velocityYWorld > 240.0) {
        cluster.velocityYWorld = 240.0;
      }
    }

  } else if (cluster.isRadiantTetherFlag === 1) {
    // ── Radiant Tether boss: fully floating, no gravity ─────────────────
    // Movement is handled by the chain winching system in radiantTetherAi.ts
    // No gravity, no enemy walk logic — boss moves purely via chain tension.

  } else if (cluster.isGrappleHunterFlag === 1) {
    // ── Grapple Hunter: ground-based with gravity ───────────────────────
    // Gravity always applies.
    cluster.velocityYWorld += NORMAL_GRAVITY_WORLD_PER_SEC2 * dtSec;
    if (cluster.velocityYWorld > FAST_MAX_FALL_WORLD_PER_SEC) {
      cluster.velocityYWorld = FAST_MAX_FALL_WORLD_PER_SEC;
    }

    // During attack / reel / recover, horizontal movement is managed by
    // grappleHunterAi.ts — skip the standard chase logic.
    const ghState = cluster.grappleHunterState;
    if (ghState === 2 || ghState === 3 || ghState === 4) {
      // Do nothing — AI drives velocity in these states.
    } else if (isPlayerFound) {
      // Chase state: walk toward player at moderate speed
      const GRAPPLE_HUNTER_WALK_SPEED_WORLD_PER_SEC = 50.0;
      const dxToPlayer = playerXWorld - cluster.positionXWorld;
      const absDx = dxToPlayer < 0 ? -dxToPlayer : dxToPlayer;
      let targetVelX = 0.0;
      if (absDx > 6.0) {
        targetVelX = (dxToPlayer > 0 ? 1 : -1) * GRAPPLE_HUNTER_WALK_SPEED_WORLD_PER_SEC;
      }
      const alpha = ENEMY_ACCEL_PER_SEC * dtSec;
      const clampedAlpha = alpha < 1.0 ? alpha : 1.0;
      cluster.velocityXWorld += (targetVelX - cluster.velocityXWorld) * clampedAlpha;
    }

  } else {
    // ── Ground enemy: gravity ───────────────────────────────────────────────
    cluster.velocityYWorld += NORMAL_GRAVITY_WORLD_PER_SEC2 * dtSec;
    if (cluster.velocityYWorld > FAST_MAX_FALL_WORLD_PER_SEC) {
      cluster.velocityYWorld = FAST_MAX_FALL_WORLD_PER_SEC;
    }

    if (isPlayerFound) {
      // ── Enemy horizontal walk toward player ────────────────────────────
      const dxToPlayer = playerXWorld - cluster.positionXWorld;
      const absDx = dxToPlayer < 0 ? -dxToPlayer : dxToPlayer;
      const distToPlayer = Math.sqrt(dxToPlayer * dxToPlayer +
        (playerYWorld - cluster.positionYWorld) * (playerYWorld - cluster.positionYWorld));

      // Rolling enemies only chase when in sight range or recently damaged
      const canChase = cluster.isRollingEnemyFlag === 0
        || distToPlayer <= ROLLING_ENEMY_SIGHT_RANGE_WORLD
        || cluster.rollingEnemyAggressiveTicks > 0;

      let targetVelX = 0.0;
      if (canChase) {
        if (absDx > ENEMY_ENGAGE_DIST_WORLD) {
          targetVelX = (dxToPlayer > 0 ? 1 : -1) * ENEMY_MAX_SPEED_WORLD_PER_SEC;
        } else if (absDx > 10.0) {
          targetVelX = (dxToPlayer > 0 ? 1 : -1) * ENEMY_MAX_SPEED_WORLD_PER_SEC
            * (absDx / ENEMY_ENGAGE_DIST_WORLD);
        }
      }

      // Blend in lateral dodge (X component only for ground enemies)
      if (cluster.enemyAiDodgeTicks > 0) {
        targetVelX += cluster.enemyAiDodgeDirXWorld * ENEMY_DODGE_SPEED_WORLD;
      }

      const enemyAlpha = ENEMY_ACCEL_PER_SEC * dtSec;
      const clampedEnemyAlpha = enemyAlpha < 1.0 ? enemyAlpha : 1.0;
      cluster.velocityXWorld += (targetVelX - cluster.velocityXWorld) * clampedEnemyAlpha;
    }
  }
}
