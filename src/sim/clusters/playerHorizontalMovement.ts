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
  MOVEMENT_V2_MAX_INPUT_SPEED_WORLD_PER_SEC,
  GROUND_DECEL_GRACE_TICKS,
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
    const baseRunSpeed = ov(debugSpeedOverrides.walkSpeedWorld, MOVEMENT_V2_MAX_INPUT_SPEED_WORLD_PER_SEC);
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
        // ── Grounded: turn acceleration / ground acceleration + speed cap ──
        const isOnIce = cluster.isGroundedOnIceFlag === 1;
        if (isOnIce) {
          // Ice traction: no turn boost, slow acceleration regardless of direction.
          cluster.velocityXWorld += inputDx * ICE_GROUND_ACCELERATION_PER_SEC2 * dtSec;
        } else {
          const isTurning = (inputDx > 0 && cluster.velocityXWorld < -1.0) ||
                            (inputDx < 0 && cluster.velocityXWorld >  1.0);
          const accel = isTurning ? TURN_ACCELERATION_PER_SEC2 : baseGroundAccel;
          cluster.velocityXWorld += inputDx * accel * dtSec;
        }
        const maxSpeed = cluster.isSprintingFlag === 1
          ? baseRunSpeed * sprintMult
          : baseRunSpeed;
        if (inputDx > 0 && cluster.velocityXWorld > maxSpeed) {
          cluster.velocityXWorld = maxSpeed;
        } else if (inputDx < 0 && cluster.velocityXWorld < -maxSpeed) {
          cluster.velocityXWorld = -maxSpeed;
        }
      } else {
        // ── Airborne: uncapped acceleration, no air resistance ─────────────
        // Input keeps accelerating the player with no speed ceiling; momentum
        // earned in the air (grapple launch, bounce pads, wall jumps, etc.)
        // is never clamped back down.
        const wallJumpMult = cluster.wallJumpCountSinceReset > 0
          ? ov(debugSpeedOverrides.wallJumpAirAccelMultiplier, WALL_JUMP_AIR_ACCEL_MULTIPLIER)
          : 1.0;
        const isTurning = (inputDx > 0 && cluster.velocityXWorld < -1.0) ||
                          (inputDx < 0 && cluster.velocityXWorld >  1.0);
        const accel = isTurning
          ? TURN_ACCELERATION_PER_SEC2
          : baseAirAccel * wallJumpMult;
        cluster.velocityXWorld += inputDx * accel * dtSec;
      }
    } else if (cluster.wallJumpForceTimeTicks <= 0) {
      // No horizontal input and not in force-time.
      if (isGrounded) {
        // ── Grounded: friction only kicks in after a sustained grounded
        // window (GROUND_DECEL_GRACE_TICKS) — repeated jumping keeps
        // resetting groundedTicks to 0, so a player who keeps hopping never
        // decelerates.
        if (cluster.groundedTicks > GROUND_DECEL_GRACE_TICKS) {
          const isOnIce = cluster.isGroundedOnIceFlag === 1;
          let decel = isOnIce ? ICE_GROUND_DECELERATION_PER_SEC2 : baseGroundDecel;
          if (!isOnIce) {
            if (cluster.isSkiddingFlag === 1) {
              decel *= SKID_FRICTION_MULTIPLIER;
            } else if (world.playerSprintHeldFlag === 1) {
              decel *= SPRINT_FRICTION_MULTIPLIER;
            }
          }
          const dv = decel * dtSec;
          if (cluster.velocityXWorld > 0) {
            cluster.velocityXWorld = cluster.velocityXWorld - dv > 0 ? cluster.velocityXWorld - dv : 0;
          } else if (cluster.velocityXWorld < 0) {
            cluster.velocityXWorld = cluster.velocityXWorld + dv < 0 ? cluster.velocityXWorld + dv : 0;
          }
        }
      }
      // ── Airborne, no input: no air resistance — velocity is left unchanged.
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
