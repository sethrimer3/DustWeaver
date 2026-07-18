/**
 * Player vertical physics — gravity, variable-jump sustain, fall speed cap,
 * and the jump trigger (ground jump + wall jump).
 *
 * Extracted from playerMovement.ts to keep each movement axis in a focused
 * module.  Call `applyPlayerGravityAndJump` once per tick for the player
 * cluster, after timer tick-downs and before horizontal movement.
 */

import { WorldState } from '../world';
import { ClusterState } from './state';
import { attemptWallJump } from './playerWallJump';
import {
  applyNonAdditiveWaterJump,
  applyPlayerWaterVerticalForces,
} from './playerWaterPhysics';
import { clearPlayerSkidState } from './playerSkid';
import { computeSkidJumpSpeedWorld } from './skidJumpHeight';
import {
  debugSpeedOverrides,
  ov,
  NORMAL_GRAVITY_WORLD_PER_SEC2,
  PLAYER_JUMP_SPEED_WORLD,
  JUMP_CUT_GRAVITY_MULTIPLIER,
  VAR_JUMP_TIME_TICKS,
  APEX_FLOAT_VELOCITY_THRESHOLD,
  APEX_FLOAT_GRAVITY_MULTIPLIER,
  NORMAL_MAX_FALL_WORLD_PER_SEC,
  FAST_MAX_FALL_WORLD_PER_SEC,
  JUMP_BUFFER_TICKS,
  UPWARD_BRAKE_STRENGTH_PER_SEC2,
  GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC,
} from './movementConstants';

/**
 * Apply gravity, variable-jump sustain, fall-speed cap, and the jump trigger
 * (ground jump + wall jump) for a single player tick.
 *
 * Must be called after the timer tick-downs at the top of `tickPlayerMovement`
 * (so coyote / wall-grace timers are already decremented) and before
 * `applyPlayerHorizontalMovement` (so wall-jump velocity is set before
 * horizontal force-time logic runs).
 */
export function applyPlayerGravityAndJump(
  cluster: ClusterState,
  world: WorldState,
  dtSec: number,
): void {
  const isTouchingWater = world.isPlayerInWaterFlag === 1;
  // ── Apply gravity (unified + jump-cut + apex half-gravity) ────────
  // When grappling, use consistent gravity (no jump-cut multiplier, no
  // apex modifier) for a natural pendulum feel.  The grapple constraint
  // (step 0.25) handles the actual swing physics.
  const baseGrav = ov(debugSpeedOverrides.gravityWorld, NORMAL_GRAVITY_WORLD_PER_SEC2);
  let grav = 0;
  if (isTouchingWater) {
    applyPlayerWaterVerticalForces(cluster, world, dtSec);
  } else {
    if (world.isGrappleActiveFlag === 1) {
      // Consistent gravity for pendulum swing.
      grav = baseGrav;
    } else if (cluster.velocityYWorld < 0) {
      // Rising: check for apex float, then jump-cut multiplier.
      const absVy = -cluster.velocityYWorld; // positive magnitude
      if (
        absVy < ov(debugSpeedOverrides.apexFloatVelocityThreshold, APEX_FLOAT_VELOCITY_THRESHOLD) &&
        world.playerJumpHeldFlag === 1
      ) {
        // Apex band: reduce gravity for a brief floaty feel at the top.
        // Fast-fall cannot be active while rising (cleared on jump), so no guard needed here.
        grav = baseGrav * ov(debugSpeedOverrides.apexFloatGravityMultiplier, APEX_FLOAT_GRAVITY_MULTIPLIER);
      } else if (world.playerJumpHeldFlag === 0) {
        // Jump released while rising: apply jump-cut heavy gravity.
        grav = baseGrav * JUMP_CUT_GRAVITY_MULTIPLIER;
      } else {
        grav = baseGrav;
      }
    } else {
      // Falling: check for apex float (vy just crossed zero, near apex).
      // Fast fall overrides apex float; early jump release is already handled above.
      const absVy = cluster.velocityYWorld; // already positive when falling
      if (
        absVy < ov(debugSpeedOverrides.apexFloatVelocityThreshold, APEX_FLOAT_VELOCITY_THRESHOLD) &&
        world.playerJumpHeldFlag === 1 &&
        cluster.isFastFallModeFlag === 0
      ) {
        grav = baseGrav * ov(debugSpeedOverrides.apexFloatGravityMultiplier, APEX_FLOAT_GRAVITY_MULTIPLIER);
      } else {
        grav = baseGrav;
      }
    }
    cluster.velocityYWorld += grav * dtSec;
  }

  // ── Variable jump sustain ────────────────────────────────────────────
  // While the sustain timer is running and the player holds jump, prevent
  // gravity from eating into the initial launch speed.  If jump is released,
  // cancel the sustain immediately.
  if (!isTouchingWater && cluster.varJumpTimerTicks > 0 && world.isGrappleActiveFlag === 0) {
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

  // ── Fall speed cap (committed fast fall + optional upward brake) ────────
  // Skip terminal velocity cap during grapple — the swing can legitimately
  // exceed the normal fall speed cap without causing tunnelling issues
  // because the rope constraint clamps displacement each tick.
  if (!isTouchingWater && world.isGrappleActiveFlag === 0 && cluster.velocityYWorld > 0) {
    const normalFallCap = ov(debugSpeedOverrides.normalFallCapWorld, NORMAL_MAX_FALL_WORLD_PER_SEC);
    const fastFallCap = ov(debugSpeedOverrides.fastFallCapWorld, FAST_MAX_FALL_WORLD_PER_SEC);
    // Enter committed fast-fall mode when holding down while falling.
    // Use crouch-held input as the authoritative "down" signal because
    // playerMoveInputDyWorld is not guaranteed on keyboard movement paths.
    const isHoldingDown = world.playerMoveInputDyWorld > 0 || world.playerCrouchHeldFlag === 1;
    if (isHoldingDown) {
      cluster.isFastFallModeFlag = 1;
    }

    // Apply terminal velocity cap FIRST so gravity cannot push velocity above
    // fastFallCap before the brake runs.  Without this, gravity adds ~15 units
    // per tick, the cap would then restore it to fastFallCap each frame, and
    // the brake would be completely nullified.
    const maxFall = cluster.isFastFallModeFlag === 1 ? fastFallCap : normalFallCap;
    if (cluster.velocityYWorld > maxFall) {
      cluster.velocityYWorld = maxFall;
    }

    // Upward brake: holding jump while in committed fast-fall brakes descent
    // back toward normalFallCap.  Once at or below normalFallCap, exit mode.
    //
    // Bug fix: we subtract (upwardBrake + grav) instead of just
    // upwardBrake.  Gravity was already applied above this section, so without
    // canceling it the net deceleration would be (brake - gravity) ≈ negative
    // (i.e., still accelerating).  Adding grav back cancels the gravity that
    // was already baked in, giving a true net deceleration of brakeStrength/s.
    const isBraking = cluster.isFastFallModeFlag === 1
        && world.playerJumpHeldFlag === 1
        && cluster.velocityYWorld > normalFallCap;
    if (isBraking) {
      const upwardBrake = ov(debugSpeedOverrides.upwardBrakeStrengthWorld, UPWARD_BRAKE_STRENGTH_PER_SEC2);
      cluster.velocityYWorld -= (upwardBrake + grav) * dtSec;
      if (cluster.velocityYWorld <= normalFallCap) {
        cluster.velocityYWorld = normalFallCap;
        cluster.isFastFallModeFlag = 0;
      }
    }

    // DEBUG: fast-fall brake diagnostics removed (verified correct)
  }


  // ── Jump trigger ─────────────────────────────────────────────────────
  // While the grapple is active the jump button controls rope pull-in
  // (handled in grapple.ts step 0.25), so normal / wall jumps are skipped.
  if (world.playerJumpTriggeredFlag === 1 && world.isGrappleActiveFlag === 0) {
    if (isTouchingWater) {
      applyNonAdditiveWaterJump(cluster);
      cluster.isGroundedFlag = 0;
      cluster.isFastFallModeFlag = 0;
      cluster.varJumpTimerTicks = 0;
      world.playerJumpTriggeredFlag = 0;
      return;
    }
    const baseJumpSpeed = ov(debugSpeedOverrides.jumpSpeedWorld, PLAYER_JUMP_SPEED_WORLD);
    const gravityWorld = ov(debugSpeedOverrides.gravityWorld, NORMAL_GRAVITY_WORLD_PER_SEC2);
    // Skid jump boost: an active skid (this tick's authoritative state, set
    // by updatePlayerSkidState before this function runs — including on a
    // same-tick reversal + jump press) grants a speed-scaled apex-height
    // bonus derived from the entry speed latched at skid start. Direct
    // grounded jumps and coyote jumps share this one authoritative
    // calculation (computeSkidJumpSpeedWorld); the landing-buffered ground
    // jump path in movement.ts uses the same helper.
    const isSkidJump = cluster.isSkiddingFlag === 1;
    const walkingSpeed = ov(debugSpeedOverrides.walkSpeedWorld, GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC);
    const jumpSpeed = isSkidJump
      ? computeSkidJumpSpeedWorld(cluster.skidEntryVelocityXWorld, walkingSpeed, baseJumpSpeed, gravityWorld)
      : baseJumpSpeed;
    if (cluster.isGroundedFlag === 1 || cluster.coyoteTimeTicks > 0) {
      // ── Normal ground jump ─────────────────────────────────────────
      // Jumping directly off a rocket block grants uncapped horizontal air
      // acceleration (at half rate) until the player next lands.
      cluster.isRocketBoostedFlag = cluster.isGroundedOnRocketFlag === 1 ? 1 : 0;
      cluster.velocityYWorld      = -jumpSpeed;
      cluster.isGroundedFlag      = 0;
      cluster.coyoteTimeTicks     = 0;
      cluster.isFastFallModeFlag  = 0;
      // Start variable jump sustain timer so holding jump sustains height.
      cluster.varJumpTimerTicks   = VAR_JUMP_TIME_TICKS;
      cluster.varJumpSpeedWorld   = -jumpSpeed;
      if (isSkidJump) {
        clearPlayerSkidState(cluster);
      }
    } else {
      // ── Wall jump (intent-filtered — see playerWallJump.ts) ───────────────
      // attemptWallJump applies wall-face quality filtering (vertical overlap
      // + ledge suppression) and intent checks (wall slide, away input, airborne
      // ticks) before allowing a wall jump.  This prevents accidental launches off
      // small ledges, stair steps, or block corners.
      const fired = attemptWallJump(cluster, world);
      if (!fired) {
        // Fully airborne and no usable wall — buffer the jump. The buffer is
        // also consumed the instant a wall becomes touchable (movement.ts),
        // mirroring landing-buffered ground jumps.
        cluster.jumpBufferTicks = JUMP_BUFFER_TICKS;
      }
    }
    world.playerJumpTriggeredFlag = 0;
  }
}
