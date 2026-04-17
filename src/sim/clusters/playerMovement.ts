/**
 * Player-specific velocity / input logic extracted from movement.ts.
 *
 * Handles:
 *   • Cooldown / buffer timer ticks
 *   • Facing direction, sprint, slide, crouch state
 *   • Idle animation state machine
 *   • Gravity (unified + jump-cut + apex half-gravity + water buoyancy)
 *   • Variable jump sustain
 *   • Fall speed cap (normal / fast fall)
 *   • Jump trigger (ground jump, wall jump, buffered jump)
 *   • Horizontal acceleration / deceleration (direct model)
 *   • Skid detection
 */

import { WorldState } from '../world';
import { ClusterState } from './state';
import { DASH_RECHARGE_ANIM_TICKS } from './dashConstants';
import { PLAYER_HALF_HEIGHT_WORLD } from '../../levels/roomDef';
import { nextUint32 } from '../rng';
import { WATER_GRAVITY_MULTIPLIER } from '../hazards';

import {
  debugSpeedOverrides,
  ov,
  NORMAL_GRAVITY_WORLD_PER_SEC2,
  PLAYER_JUMP_SPEED_WORLD,
  JUMP_CUT_GRAVITY_MULTIPLIER,
  VAR_JUMP_TIME_TICKS,
  APEX_GRAVITY_MULTIPLIER,
  APEX_THRESHOLD_WORLD_PER_SEC,
  NORMAL_MAX_FALL_WORLD_PER_SEC,
  FAST_MAX_FALL_WORLD_PER_SEC,
  FAST_MAX_FALL_APPROACH_PER_SEC,
  JUMP_BUFFER_TICKS,
  MAX_RUN_SPEED_WORLD_PER_SEC,
  GROUND_ACCELERATION_PER_SEC2,
  GROUND_DECELERATION_PER_SEC2,
  AIR_ACCELERATION_PER_SEC2,
  AIR_DECELERATION_PER_SEC2,
  TURN_ACCELERATION_PER_SEC2,
  WALL_JUMP_X_SPEED_WORLD,
  WALL_JUMP_Y_SPEED_WORLD,
  WALL_JUMP_FIRST_BONUS_Y_SPEED_WORLD,
  WALL_JUMP_FORCE_TIME_TICKS,
  WALL_JUMP_LOCKOUT_TICKS,
  SPRINT_SPEED_MULTIPLIER,
  SPRINT_FRICTION_MULTIPLIER,
  SKID_FRICTION_MULTIPLIER,
  SKID_JUMP_MULTIPLIER,
  SKID_VELOCITY_THRESHOLD_WORLD,
  CROUCH_HALF_HEIGHT_WORLD,
  IDLE_TRIGGER_TICKS,
  IDLE_BLINK_DURATION_TICKS,
} from './movementConstants';

/**
 * Tick all player-specific velocity and input logic for a single cluster.
 * Called once per tick for the player cluster only.
 */
export function tickPlayerMovement(
  cluster: ClusterState,
  world: WorldState,
  dtSec: number,
): void {
  // ── Tick down all cooldown / buffer timers ──────────────────────────
  if (cluster.dashCooldownTicks > 0) {
    cluster.dashCooldownTicks -= 1;
    if (cluster.dashCooldownTicks === 0) {
      cluster.dashRechargeAnimTicks = DASH_RECHARGE_ANIM_TICKS;
    }
  }
  if (cluster.dashRechargeAnimTicks > 0) {
    cluster.dashRechargeAnimTicks -= 1;
  }
  if (cluster.coyoteTimeTicks > 0) {
    cluster.coyoteTimeTicks -= 1;
  }
  if (cluster.jumpBufferTicks > 0) {
    cluster.jumpBufferTicks -= 1;
  }
  if (cluster.wallJumpLockoutTicks > 0) {
    cluster.wallJumpLockoutTicks -= 1;
  }
  if (cluster.wallJumpForceTimeTicks > 0) {
    cluster.wallJumpForceTimeTicks -= 1;
  }
  if (cluster.varJumpTimerTicks > 0) {
    cluster.varJumpTimerTicks -= 1;
  }
  if (cluster.invulnerabilityTicks > 0) {
    cluster.invulnerabilityTicks -= 1;
  }
  if (cluster.hurtTicks > 0) {
    cluster.hurtTicks -= 1;
  }
  // Grappling resets the "first wall jump" bonus state.
  if (world.isGrappleActiveFlag === 1 || world.isGrappleStuckFlag === 1) {
    cluster.hasUsedWallJumpSinceResetFlag = 0;
  }

  // ── Update player facing direction ──────────────────────────────────
  {
    const inputDxForFacing = world.playerMoveInputDxWorld;
    if (inputDxForFacing < 0) {
      cluster.isFacingLeftFlag = 1;
    } else if (inputDxForFacing > 0) {
      cluster.isFacingLeftFlag = 0;
    }
  }

  // ── Sprint state ──────────────────────────────────────────────────
  {
    if (world.playerSprintHeldFlag === 1 && cluster.isGroundedFlag === 1) {
      cluster.isSprintingFlag = 1;
    } else {
      cluster.isSprintingFlag = 0;
    }
  }

  // ── Slide state (shift + down on ground) ──────────────────────────
  {
    if (world.playerSprintHeldFlag === 1 && world.playerCrouchHeldFlag === 1
      && cluster.isGroundedFlag === 1) {
      cluster.isSlidingFlag = 1;
    } else {
      cluster.isSlidingFlag = 0;
    }
  }

  // ── Crouch state ──────────────────────────────────────────────────
  {
    const wasCrouching = cluster.isCrouchingFlag === 1;
    if (world.playerCrouchHeldFlag === 1 && cluster.isGroundedFlag === 1) {
      cluster.isCrouchingFlag = 1;
      if (!wasCrouching) {
        // Entering crouch: shrink hitbox, keep bottom edge stable
        const oldHalfH = cluster.halfHeightWorld;
        cluster.halfHeightWorld = CROUCH_HALF_HEIGHT_WORLD;
        cluster.positionYWorld += oldHalfH - CROUCH_HALF_HEIGHT_WORLD;
      }
    } else {
      cluster.isCrouchingFlag = 0;
      if (wasCrouching) {
        // Exiting crouch: restore hitbox height, keep bottom edge stable
        cluster.halfHeightWorld = PLAYER_HALF_HEIGHT_WORLD;
        cluster.positionYWorld -= PLAYER_HALF_HEIGHT_WORLD - CROUCH_HALF_HEIGHT_WORLD;
      }
    }
  }

  // ── Idle animation state machine ──────────────────────────────────
  {
    const isMoving = world.playerMoveInputDxWorld !== 0;
    if (isMoving || world.isGrappleActiveFlag === 1) {
      // Reset idle state when moving or grappling
      cluster.playerIdleTimerTicks = 0;
      cluster.playerIdleAnimState = 0;
      cluster.playerIdleNextSwitchTicks = 0;
    } else {
      cluster.playerIdleTimerTicks += 1;
      if (cluster.playerIdleTimerTicks >= IDLE_TRIGGER_TICKS) {
        if (cluster.playerIdleNextSwitchTicks > 0) {
          cluster.playerIdleNextSwitchTicks -= 1;
        }
        if (cluster.playerIdleNextSwitchTicks <= 0) {
          // Time to switch idle animation
          if (cluster.playerIdleAnimState === 0) {
            // Currently standing → pick an idle animation
            const roll = nextUint32(world.rng) % 100;
            if (roll < 1) {
              // 1/100 chance → idle2
              cluster.playerIdleAnimState = 2;
              // idle2 duration: 2 seconds ± 1 second (60-180 ticks)
              cluster.playerIdleNextSwitchTicks = 120 + (nextUint32(world.rng) % 121) - 60;
            } else if (roll < 10) {
              // 9/100 chance → idleBlink
              cluster.playerIdleAnimState = 3;
              cluster.playerIdleNextSwitchTicks = IDLE_BLINK_DURATION_TICKS;
            } else {
              // 90/100 chance → idle1
              cluster.playerIdleAnimState = 1;
              // idle1 duration: 2 seconds ± 1 second (60-180 ticks)
              cluster.playerIdleNextSwitchTicks = 120 + (nextUint32(world.rng) % 121) - 60;
            }
          } else {
            // Was in an idle animation → return to standing
            cluster.playerIdleAnimState = 0;
            // Next switch in 2 seconds ± 1 second (60-180 ticks)
            cluster.playerIdleNextSwitchTicks = 120 + (nextUint32(world.rng) % 121) - 60;
          }
        }
      }
    }
  }

  // ── Apply gravity (unified + jump-cut + apex half-gravity) ────────
  // When grappling, use consistent gravity (no jump-cut multiplier, no
  // apex modifier) for a natural pendulum feel.  The grapple constraint
  // (step 0.25) handles the actual swing physics.
  const baseGrav = ov(debugSpeedOverrides.gravityWorld, NORMAL_GRAVITY_WORLD_PER_SEC2);
  // Water buoyancy reduces effective gravity when the player is submerged.
  const waterMult = world.isPlayerInWaterFlag === 1 ? WATER_GRAVITY_MULTIPLIER : 1.0;
  let grav: number;
  if (world.isGrappleActiveFlag === 1) {
    // Consistent gravity for pendulum swing.
    grav = baseGrav;
  } else if (cluster.velocityYWorld < 0) {
    // Rising: check for apex half-gravity, then jump-cut multiplier.
    const absVy = -cluster.velocityYWorld; // positive magnitude
    if (
      absVy < APEX_THRESHOLD_WORLD_PER_SEC &&
      world.playerJumpHeldFlag === 1
    ) {
      // Apex band: reduce gravity for a brief floaty feel at the top.
      grav = baseGrav * APEX_GRAVITY_MULTIPLIER;
    } else if (world.playerJumpHeldFlag === 0) {
      // Jump released while rising: apply jump-cut heavy gravity.
      grav = baseGrav * JUMP_CUT_GRAVITY_MULTIPLIER;
    } else {
      grav = baseGrav;
    }
  } else {
    // Falling: check for apex half-gravity (vy just crossed zero, near apex).
    const absVy = cluster.velocityYWorld; // already positive when falling
    if (
      absVy < APEX_THRESHOLD_WORLD_PER_SEC &&
      world.playerJumpHeldFlag === 1
    ) {
      grav = baseGrav * APEX_GRAVITY_MULTIPLIER;
    } else {
      grav = baseGrav;
    }
  }
  cluster.velocityYWorld += grav * waterMult * dtSec;

  // ── Variable jump sustain ────────────────────────────────────────────
  // While the sustain timer is running and the player holds jump, prevent
  // gravity from eating into the initial launch speed.  If jump is released,
  // cancel the sustain immediately.
  if (cluster.varJumpTimerTicks > 0 && world.isGrappleActiveFlag === 0) {
    if (world.playerJumpHeldFlag === 1) {
      // Cap vy so it doesn't decay past the stored launch speed (negative = up).
      if (cluster.velocityYWorld > cluster.varJumpSpeedWorld) {
        cluster.velocityYWorld = cluster.varJumpSpeedWorld;
      }
    } else {
      // Jump released — cancel sustain immediately.
      cluster.varJumpTimerTicks = 0;
    }
  }

  // ── Fall speed cap (normal fall vs fast fall) ────────────────────────
  // Skip terminal velocity cap during grapple — the swing can legitimately
  // exceed the normal fall speed cap without causing tunnelling issues
  // because the rope constraint clamps displacement each tick.
  if (world.isGrappleActiveFlag === 0 && cluster.velocityYWorld > 0) {
    const normalFallCap = ov(debugSpeedOverrides.normalFallCapWorld, NORMAL_MAX_FALL_WORLD_PER_SEC);
    const fastFallCap = ov(debugSpeedOverrides.fastFallCapWorld, FAST_MAX_FALL_WORLD_PER_SEC);
    // Determine current max fall speed: fast fall if holding down in midair.
    // Use crouch-held input as the authoritative "down" signal because
    // playerMoveInputDyWorld is not guaranteed on keyboard movement paths.
    const isHoldingDown = world.playerMoveInputDyWorld > 0 || world.playerCrouchHeldFlag === 1;
    let maxFall: number;
    if (isHoldingDown) {
      // Smoothly approach fastMaxFall from the current cap
      const currentCap = cluster.velocityYWorld < normalFallCap
        ? normalFallCap
        : cluster.velocityYWorld;
      maxFall = currentCap + FAST_MAX_FALL_APPROACH_PER_SEC * dtSec;
      if (maxFall > fastFallCap) maxFall = fastFallCap;
    } else {
      maxFall = normalFallCap;
    }
    if (cluster.velocityYWorld > maxFall) {
      cluster.velocityYWorld = maxFall;
    }
  }


  // ── Jump trigger ─────────────────────────────────────────────────────
  // While the grapple is active the jump button controls rope pull-in
  // (handled in grapple.ts step 0.25), so normal / wall jumps are skipped.
  if (world.playerJumpTriggeredFlag === 1 && world.isGrappleActiveFlag === 0) {
    const baseJumpSpeed = ov(debugSpeedOverrides.jumpSpeedWorld, PLAYER_JUMP_SPEED_WORLD);
    // Skid jump boost: if jumping while skidding, increase jump height by 50%
    const jumpSpeed = cluster.isSkiddingFlag === 1
      ? baseJumpSpeed * SKID_JUMP_MULTIPLIER
      : baseJumpSpeed;
    if (cluster.isGroundedFlag === 1 || cluster.coyoteTimeTicks > 0) {
      // ── Normal ground jump ─────────────────────────────────────────
      cluster.velocityYWorld      = -jumpSpeed;
      cluster.isGroundedFlag      = 0;
      cluster.coyoteTimeTicks     = 0;
      // Start variable jump sustain timer so holding jump sustains height.
      cluster.varJumpTimerTicks   = VAR_JUMP_TIME_TICKS;
      cluster.varJumpSpeedWorld   = -jumpSpeed;
    } else {
      // ── Wall jump (uses wall-touch flags from the previous tick) ───
      const canJumpFromLeft  = cluster.isTouchingWallLeftFlag  === 1
                            && cluster.wallJumpLockoutTicks === 0;
      const canJumpFromRight = cluster.isTouchingWallRightFlag === 1
                            && cluster.wallJumpLockoutTicks === 0;

      if (canJumpFromLeft || canJumpFromRight) {
        const wallJumpX = ov(debugSpeedOverrides.wallJumpXWorld, WALL_JUMP_X_SPEED_WORLD);
        const wallJumpYBase = ov(debugSpeedOverrides.wallJumpYWorld, WALL_JUMP_Y_SPEED_WORLD);
        const isInitialWallJump = cluster.hasUsedWallJumpSinceResetFlag === 0;
        const wallJumpY = isInitialWallJump
          ? wallJumpYBase + WALL_JUMP_FIRST_BONUS_Y_SPEED_WORLD
          : wallJumpYBase - 10.0;
        // wallDir = +1 if wall is to the right, -1 if wall is to the left
        const wallDir = canJumpFromRight ? 1 : -1;
        // Launch away: strong diagonal push prevents same-wall climbing.
        cluster.velocityXWorld          = -wallDir * wallJumpX;
        cluster.velocityYWorld          = -wallJumpY;
        cluster.wallJumpLockoutTicks    = WALL_JUMP_LOCKOUT_TICKS;
        cluster.wallJumpForceTimeTicks  = WALL_JUMP_FORCE_TIME_TICKS;
        cluster.wallJumpDirX            = -wallDir; // outward direction
        cluster.isWallSlidingFlag       = 0;
        cluster.coyoteTimeTicks         = 0;
        cluster.hasUsedWallJumpSinceResetFlag = 1;
        if (isInitialWallJump) {
          world.wallJumpSkidDebrisBurstFlag = 1;
          world.skidDebrisXWorld = cluster.positionXWorld;
          world.skidDebrisYWorld = cluster.positionYWorld + cluster.halfHeightWorld;
        }
        // Start variable jump sustain for wall jumps too.
        cluster.varJumpTimerTicks       = VAR_JUMP_TIME_TICKS;
        cluster.varJumpSpeedWorld       = -wallJumpY;
      } else {
        // Fully airborne and no usable wall — buffer the jump
        cluster.jumpBufferTicks = JUMP_BUFFER_TICKS;
      }
    }
    world.playerJumpTriggeredFlag = 0;
  }

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
  {
    const isFacingLeft = cluster.isFacingLeftFlag === 1;
    const isMovingRight = cluster.velocityXWorld > SKID_VELOCITY_THRESHOLD_WORLD;
    const isMovingLeft = cluster.velocityXWorld < -SKID_VELOCITY_THRESHOLD_WORLD;
    const isTravelingOppositeToFacing =
      (isFacingLeft && isMovingRight) || (!isFacingLeft && isMovingLeft);
    if (world.playerSprintHeldFlag === 1 && isGrounded && isTravelingOppositeToFacing) {
      cluster.isSkiddingFlag = 1;
    } else {
      cluster.isSkiddingFlag = 0;
    }
  }

  if (world.isGrappleActiveFlag === 0) {
    const baseRunSpeed = ov(debugSpeedOverrides.walkSpeedWorld, MAX_RUN_SPEED_WORLD_PER_SEC);
    const sprintMult = ov(debugSpeedOverrides.sprintMultiplier, SPRINT_SPEED_MULTIPLIER);
    const baseGroundAccel = ov(debugSpeedOverrides.groundAccelWorld, GROUND_ACCELERATION_PER_SEC2);
    const baseGroundDecel = ov(debugSpeedOverrides.groundDecelWorld, GROUND_DECELERATION_PER_SEC2);
    const baseAirAccel = ov(debugSpeedOverrides.airAccelWorld, AIR_ACCELERATION_PER_SEC2);
    const baseAirDecel = ov(debugSpeedOverrides.airDecelWorld, AIR_DECELERATION_PER_SEC2);

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
      // Reversing direction uses a higher turn acceleration for snappy feel
      const isTurning = (inputDx > 0 && cluster.velocityXWorld < -1.0) ||
                        (inputDx < 0 && cluster.velocityXWorld >  1.0);
      let accel: number;
      if (isTurning) {
        accel = TURN_ACCELERATION_PER_SEC2;
      } else if (isGrounded) {
        accel = baseGroundAccel;
      } else {
        accel = baseAirAccel;
      }
      cluster.velocityXWorld += inputDx * accel * dtSec;
      // Clamp to max run speed only in the direction of input
      // Sprint increases the max speed by 50% when grounded and holding shift
      const maxSpeed = cluster.isSprintingFlag === 1
        ? baseRunSpeed * sprintMult
        : baseRunSpeed;
      if (inputDx > 0 && cluster.velocityXWorld > maxSpeed) {
        cluster.velocityXWorld = maxSpeed;
      } else if (inputDx < 0 && cluster.velocityXWorld < -maxSpeed) {
        cluster.velocityXWorld = -maxSpeed;
      }
    } else if (cluster.wallJumpForceTimeTicks <= 0) {
      // No horizontal input and not in force-time — decelerate toward zero.
      // Friction is modified by sprint (50% less) and skid (50% more).
      let decel: number;
      if (isGrounded) {
        decel = baseGroundDecel;
        if (cluster.isSkiddingFlag === 1) {
          decel *= SKID_FRICTION_MULTIPLIER;
        } else if (world.playerSprintHeldFlag === 1) {
          decel *= SPRINT_FRICTION_MULTIPLIER;
        }
      } else {
        decel = baseAirDecel;
      }
      const dv    = decel * dtSec;
      if (cluster.velocityXWorld > 0) {
        cluster.velocityXWorld = cluster.velocityXWorld - dv > 0 ? cluster.velocityXWorld - dv : 0;
      } else if (cluster.velocityXWorld < 0) {
        cluster.velocityXWorld = cluster.velocityXWorld + dv < 0 ? cluster.velocityXWorld + dv : 0;
      }
    }
  }
}
