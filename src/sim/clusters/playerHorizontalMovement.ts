/**
 * Player horizontal physics — skid detection, wall-jump force-time override,
 * grounded/airborne acceleration and deceleration, and the fast-fall hitbox
 * width adjustment.
 *
 * Extracted from playerMovement.ts to keep each movement axis in a focused
 * module.  Call `applyPlayerHorizontalMovement` once per tick for the player
 * cluster, after `applyPlayerGravityAndJump` (so wall-jump velocity set by
 * the jump trigger is honoured by the force-time window here).
 */

import { WorldState } from '../world';
import { ClusterState } from './state';
import { PLAYER_HALF_WIDTH_WORLD } from '../../levels/roomDef';
import {
  debugSpeedOverrides,
  ov,
  GROUND_ACCELERATION_PER_SEC2,
  GROUND_DECELERATION_PER_SEC2,
  AIR_ACCELERATION_PER_SEC2,
  TURN_ACCELERATION_PER_SEC2,
  WALL_JUMP_X_SPEED_WORLD,
  SPRINT_SPEED_MULTIPLIER,
  SPRINT_FRICTION_MULTIPLIER,
  SKID_FRICTION_MULTIPLIER,
  SKID_VELOCITY_THRESHOLD_WORLD,
  FAST_FALL_VELOCITY_THRESHOLD_WORLD,
  FAST_FALL_HALF_WIDTH_WORLD,
  WALL_JUMP_AIR_ACCEL_MULTIPLIER,
  ICE_GROUND_ACCELERATION_PER_SEC2,
  ICE_GROUND_DECELERATION_PER_SEC2,
  GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC,
  AIR_MAX_INPUT_SPEED_WORLD_PER_SEC,
  GROUND_DECEL_GRACE_TICKS,
  AIR_FRICTION_PER_SEC2,
  ROCKET_BOOST_AIR_ACCEL_MULTIPLIER,
} from './movementConstants';

/**
 * Apply horizontal movement (skid detection, wall-jump force-time override,
 * grounded/airborne acceleration + deceleration) and update the fast-fall
 * hitbox width for a single player tick.
 *
 * Must be called after `applyPlayerGravityAndJump` so that any wall-jump
 * launch velocity set during the jump trigger is handled correctly by the
 * force-time window logic here.
 */
export function applyPlayerHorizontalMovement(
  cluster: ClusterState,
  world: WorldState,
  dtSec: number,
): void {
  // ── Horizontal movement (direct acceleration model) ─────────────────
  // While grappling, skip horizontal acceleration and deceleration —
  // the pendulum physics (gravity + rope constraint) governs all motion.
  // Applying platformer-style speed caps or deceleration here would fight
  // against the swing and break the physical feel.
  let inputDx   = world.playerMoveInputDxWorld;
  const isGrounded = cluster.isGroundedFlag === 1;

  // When holding down (without shift), block horizontal acceleration.
  // When holding shift+down (sliding), allow normal input.
  const isHoldingDown = world.playerCrouchHeldFlag === 1;
  if (isHoldingDown && world.playerSprintHeldFlag === 0 && isGrounded) {
    inputDx = 0;
  }

  // ── Skid detection ─────────────────────────────────────────────────
  // Skid when sprint is held, grounded, moving, and velocity is opposite
  // to the facing direction (changing direction while sprinting).
  // Ice surfaces suppress skidding — there is no traction to skid on.
  {
    const isFacingLeft = cluster.isFacingLeftFlag === 1;
    const isMovingRight = cluster.velocityXWorld > SKID_VELOCITY_THRESHOLD_WORLD;
    const isMovingLeft = cluster.velocityXWorld < -SKID_VELOCITY_THRESHOLD_WORLD;
    const isTravelingOppositeToFacing =
      (isFacingLeft && isMovingRight) || (!isFacingLeft && isMovingLeft);
    if (world.playerSprintHeldFlag === 1 && isGrounded && isTravelingOppositeToFacing && cluster.isGroundedOnIceFlag === 0) {
      cluster.isSkiddingFlag = 1;
    } else {
      cluster.isSkiddingFlag = 0;
    }
  }

  // ── Ultra ice velocity lock ─────────────────────────────────────────
  // While on ultra ice, all lateral input and deceleration is suppressed —
  // the player carries their velocity unchanged.  Grapple physics still
  // applies (handled by the grapple constraint path, which skips this block
  // entirely via the isGrappleActiveFlag check below).
  if (cluster.isOnUltraIceFlag === 1) {
    // Only perform the fast-fall hitbox adjustment; skip all input/decel.
    if (cluster.isGroundedFlag === 0
        && cluster.velocityYWorld > FAST_FALL_VELOCITY_THRESHOLD_WORLD) {
      cluster.halfWidthWorld = FAST_FALL_HALF_WIDTH_WORLD;
    } else {
      cluster.halfWidthWorld = PLAYER_HALF_WIDTH_WORLD;
    }
    return;
  }

  if (world.isGrappleActiveFlag === 0) {
    const baseRunSpeed = ov(debugSpeedOverrides.walkSpeedWorld, GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC);
    const sprintMult = ov(debugSpeedOverrides.sprintMultiplier, SPRINT_SPEED_MULTIPLIER);
    const baseGroundAccel = ov(debugSpeedOverrides.groundAccelWorld, GROUND_ACCELERATION_PER_SEC2);
    const baseGroundDecel = ov(debugSpeedOverrides.groundDecelWorld, GROUND_DECELERATION_PER_SEC2);
    const baseAirAccel = ov(debugSpeedOverrides.airAccelWorld, AIR_ACCELERATION_PER_SEC2);

    // During wall-jump force-time window, override horizontal velocity
    // to the outward launch direction — prevents immediately steering back.
    // Cancel early if the player hits a wall in the force direction.
    if (cluster.wallJumpForceTimeTicks > 0) {
      const wallJumpX = ov(debugSpeedOverrides.wallJumpXWorld, WALL_JUMP_X_SPEED_WORLD);
      const hitsWallInForceDir =
        (cluster.wallJumpDirX > 0 && cluster.isTouchingWallRightFlag === 1) ||
        (cluster.wallJumpDirX < 0 && cluster.isTouchingWallLeftFlag  === 1);
      if (hitsWallInForceDir) {
        cluster.wallJumpForceTimeTicks = 0;
      } else {
        cluster.velocityXWorld = cluster.wallJumpDirX * wallJumpX;
      }
    }

    if (cluster.wallJumpForceTimeTicks <= 0 && inputDx !== 0) {
      if (isGrounded) {
        // ── Grounded, holding input ──────────────────────────────────────
        const isOnIce = cluster.isGroundedOnIceFlag === 1;
        const groundCap = cluster.isSprintingFlag === 1
          ? baseRunSpeed * sprintMult
          : baseRunSpeed;
        const absVBefore = Math.abs(cluster.velocityXWorld);
        if (isOnIce) {
          // Ice traction: no turn boost, slow acceleration regardless of direction.
          cluster.velocityXWorld += inputDx * ICE_GROUND_ACCELERATION_PER_SEC2 * dtSec;
        } else if (absVBefore < groundCap) {
          // Below the target speed: accelerate up toward it, never overshoot.
          const isTurning = (inputDx > 0 && cluster.velocityXWorld < -1.0) ||
                            (inputDx < 0 && cluster.velocityXWorld >  1.0);
          const accel = isTurning ? TURN_ACCELERATION_PER_SEC2 : baseGroundAccel;
          cluster.velocityXWorld += inputDx * accel * dtSec;
          if (inputDx > 0 && cluster.velocityXWorld > groundCap) {
            cluster.velocityXWorld = groundCap;
          } else if (inputDx < 0 && cluster.velocityXWorld < -groundCap) {
            cluster.velocityXWorld = -groundCap;
          }
        } else if (cluster.groundedTicks > GROUND_DECEL_GRACE_TICKS) {
          // At/above the target speed and grounded long enough: bleed the
          // excess back down toward the cap (never below it) while input
          // is still held.
          let decel = baseGroundDecel;
          if (cluster.isSkiddingFlag === 1) {
            decel *= SKID_FRICTION_MULTIPLIER;
          } else if (world.playerSprintHeldFlag === 1) {
            decel *= SPRINT_FRICTION_MULTIPLIER;
          }
          const dv = decel * dtSec;
          if (cluster.velocityXWorld > 0) {
            cluster.velocityXWorld = Math.max(groundCap, cluster.velocityXWorld - dv);
          } else {
            cluster.velocityXWorld = Math.min(-groundCap, cluster.velocityXWorld + dv);
          }
        }
        // Above cap but still within the grace window: leave velocity as-is.
      } else {
        // ── Airborne, holding input: accelerate up toward the air cap only;
        // never decelerate while any direction is held. Rocket-boosted jumps
        // ignore the cap entirely, accelerating at half rate with no ceiling.
        const airCap = ov(debugSpeedOverrides.airMoveSpeedWorld, AIR_MAX_INPUT_SPEED_WORLD_PER_SEC);
        const absVBefore = Math.abs(cluster.velocityXWorld);
        const wallJumpMult = cluster.wallJumpCountSinceReset > 0
          ? ov(debugSpeedOverrides.wallJumpAirAccelMultiplier, WALL_JUMP_AIR_ACCEL_MULTIPLIER)
          : 1.0;
        const isTurning = (inputDx > 0 && cluster.velocityXWorld < -1.0) ||
                          (inputDx < 0 && cluster.velocityXWorld >  1.0);
        const accel = isTurning
          ? TURN_ACCELERATION_PER_SEC2
          : baseAirAccel * wallJumpMult;
        if (cluster.isRocketBoostedFlag === 1) {
          cluster.velocityXWorld += inputDx * accel * ROCKET_BOOST_AIR_ACCEL_MULTIPLIER * dtSec;
        } else if (absVBefore < airCap) {
          cluster.velocityXWorld += inputDx * accel * dtSec;
          if (inputDx > 0 && cluster.velocityXWorld > airCap) {
            cluster.velocityXWorld = airCap;
          } else if (inputDx < 0 && cluster.velocityXWorld < -airCap) {
            cluster.velocityXWorld = -airCap;
          }
        }
        // Already at/above the air cap and not rocket-boosted: no change.
      }
    } else if (cluster.wallJumpForceTimeTicks <= 0) {
      // No horizontal input and not in force-time.
      if (isGrounded) {
        // ── Grounded, no input: friction applies immediately, no grace delay.
        const isOnIce = cluster.isGroundedOnIceFlag === 1;
        const decel = isOnIce ? ICE_GROUND_DECELERATION_PER_SEC2 : baseGroundDecel;
        const dv = decel * dtSec;
        if (cluster.velocityXWorld > 0) {
          cluster.velocityXWorld = cluster.velocityXWorld - dv > 0 ? cluster.velocityXWorld - dv : 0;
        } else if (cluster.velocityXWorld < 0) {
          cluster.velocityXWorld = cluster.velocityXWorld + dv < 0 ? cluster.velocityXWorld + dv : 0;
        }
      } else {
        // ── Airborne, no input: light air friction.
        const dv = ov(debugSpeedOverrides.airDecelWorld, AIR_FRICTION_PER_SEC2) * dtSec;
        if (cluster.velocityXWorld > 0) {
          cluster.velocityXWorld = cluster.velocityXWorld - dv > 0 ? cluster.velocityXWorld - dv : 0;
        } else if (cluster.velocityXWorld < 0) {
          cluster.velocityXWorld = cluster.velocityXWorld + dv < 0 ? cluster.velocityXWorld + dv : 0;
        }
      }
    }
  }

  // ── Fast-fall hitbox: narrow the player box while fast-falling airborne ─
  if (cluster.isGroundedFlag === 0
      && cluster.velocityYWorld > FAST_FALL_VELOCITY_THRESHOLD_WORLD) {
    cluster.halfWidthWorld = FAST_FALL_HALF_WIDTH_WORLD;
  } else {
    // Restore full width whenever not in fast-fall (crouching only changes
    // halfHeightWorld, so it is safe to always reset halfWidthWorld here).
    cluster.halfWidthWorld = PLAYER_HALF_WIDTH_WORLD;
  }
}
