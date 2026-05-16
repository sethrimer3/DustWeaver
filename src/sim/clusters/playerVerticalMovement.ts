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
import { WATER_GRAVITY_MULTIPLIER } from '../hazards';
import { getNearbyWallForWallJump } from './movementCollision';
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
  WALL_JUMP_X_SPEED_WORLD,
  WALL_JUMP_Y_SPEED_WORLD,
  WALL_JUMP_FIRST_BONUS_Y_SPEED_WORLD,
  WALL_JUMP_FORCE_TIME_TICKS,
  WALL_JUMP_LOCKOUT_TICKS,
  WALL_JUMP_PROXIMITY_PIXELS,
  UPWARD_BRAKE_STRENGTH_PER_SEC2,
  WALL_JUMP_SECOND_Y_MULTIPLIER,
  WALL_JUMP_SUBSEQUENT_Y_MULTIPLIER,
  SKID_JUMP_MULTIPLIER,
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
  // ── Apply gravity (unified + jump-cut + apex half-gravity) ────────
  // When grappling, use consistent gravity (no jump-cut multiplier, no
  // apex modifier) for a natural pendulum feel.  The grapple constraint
  // (step 0.25) handles the actual swing physics.
  const baseGrav = ov(debugSpeedOverrides.gravityWorld, NORMAL_GRAVITY_WORLD_PER_SEC2);
  // Water buoyancy: reduce gravity to a constant low fraction whenever any part
  // of the player overlaps a water zone.  The old submersion-lerp formula
  // (0.12 + 0.88*(1−s)) left gravity at ~56% of normal when half-submerged,
  // meaning buoyancy (520*0.5 = 260 wu/s²) could never overcome it
  // (504 wu/s²) — the player always sank.  Using a constant multiplier (0.12)
  // keeps effective gravity at only 108 wu/s² regardless of submersion, so
  // buoyancy wins whenever the player is meaningfully submerged (>~21%).
  const waterMult = world.isPlayerInWaterFlag === 1
    ? WATER_GRAVITY_MULTIPLIER
    : 1.0;
  let grav: number;
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

  // ── Fall speed cap (committed fast fall + optional upward brake) ────────
  // Skip terminal velocity cap during grapple — the swing can legitimately
  // exceed the normal fall speed cap without causing tunnelling issues
  // because the rope constraint clamps displacement each tick.
  if (world.isGrappleActiveFlag === 0 && cluster.velocityYWorld > 0) {
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
    // Bug fix: we subtract (upwardBrake + grav * waterMult) instead of just
    // upwardBrake.  Gravity was already applied above this section, so without
    // canceling it the net deceleration would be (brake - gravity) ≈ negative
    // (i.e., still accelerating).  Adding grav back cancels the gravity that
    // was already baked in, giving a true net deceleration of brakeStrength/s.
    const isBraking = cluster.isFastFallModeFlag === 1
        && world.playerJumpHeldFlag === 1
        && cluster.velocityYWorld > normalFallCap;
    if (isBraking) {
      const upwardBrake = ov(debugSpeedOverrides.upwardBrakeStrengthWorld, UPWARD_BRAKE_STRENGTH_PER_SEC2);
      cluster.velocityYWorld -= (upwardBrake + grav * waterMult) * dtSec;
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
    const baseJumpSpeed = ov(debugSpeedOverrides.jumpSpeedWorld, PLAYER_JUMP_SPEED_WORLD);
    // Skid jump boost: if jumping while skidding, increase jump height
    const skidJumpMult = ov(debugSpeedOverrides.skidJumpMultiplier, SKID_JUMP_MULTIPLIER);
    const jumpSpeed = cluster.isSkiddingFlag === 1
      ? baseJumpSpeed * skidJumpMult
      : baseJumpSpeed;
    if (cluster.isGroundedFlag === 1 || cluster.coyoteTimeTicks > 0) {
      // ── Normal ground jump ─────────────────────────────────────────
      cluster.velocityYWorld      = -jumpSpeed;
      cluster.isGroundedFlag      = 0;
      cluster.coyoteTimeTicks     = 0;
      cluster.isFastFallModeFlag  = 0;
      // Start variable jump sustain timer so holding jump sustains height.
      cluster.varJumpTimerTicks   = VAR_JUMP_TIME_TICKS;
      cluster.varJumpSpeedWorld   = -jumpSpeed;
    } else {
      // ── Wall jump (uses wall-touch flags, grace timers, and proximity) ───
      // Grace timers extend the window after leaving a wall (wall coyote time).
      // Proximity check allows wall jump when slightly away from a wall face.
      const { nearLeftDistWorld, nearRightDistWorld } = getNearbyWallForWallJump(cluster, world);
      const proximityPx = ov(debugSpeedOverrides.wallJumpProximityPixels, WALL_JUMP_PROXIMITY_PIXELS);
      const nearLeft  = nearLeftDistWorld  <= proximityPx;
      const nearRight = nearRightDistWorld <= proximityPx;

      let canJumpFromLeft  = (cluster.isTouchingWallLeftFlag  === 1
                           || cluster.wallJumpGraceLeftTicks  > 0
                           || nearLeft)
                           && cluster.wallJumpLockoutTicks === 0;
      let canJumpFromRight = (cluster.isTouchingWallRightFlag === 1
                           || cluster.wallJumpGraceRightTicks > 0
                           || nearRight)
                           && cluster.wallJumpLockoutTicks === 0;

      // When both sides are eligible, prefer the nearer wall.
      // If equidistant (e.g., touching both walls simultaneously), prefer the
      // wall on the side the player is facing / moving toward so the launch
      // direction feels intentional rather than always favouring the left wall.
      if (canJumpFromLeft && canJumpFromRight) {
        const leftDist  = cluster.isTouchingWallLeftFlag  === 1 ? 0 : nearLeftDistWorld;
        const rightDist = cluster.isTouchingWallRightFlag === 1 ? 0 : nearRightDistWorld;
        if (leftDist < rightDist) {
          canJumpFromRight = false;
        } else if (rightDist < leftDist) {
          canJumpFromLeft = false;
        } else {
          // Equal distances: prefer the side the player is moving toward (or right by default).
          if (cluster.velocityXWorld < 0) {
            canJumpFromRight = false; // moving left → prefer left wall
          } else {
            canJumpFromLeft = false;  // moving right or stationary → prefer right wall
          }
        }
      }

      if (canJumpFromLeft || canJumpFromRight) {
        const wallJumpX = ov(debugSpeedOverrides.wallJumpXWorld, WALL_JUMP_X_SPEED_WORLD);
        const wallJumpYBase = ov(debugSpeedOverrides.wallJumpYWorld, WALL_JUMP_Y_SPEED_WORLD);
        const isInitialWallJump = cluster.wallJumpCountSinceReset === 0;
        const isSecondWallJump  = cluster.wallJumpCountSinceReset === 1;
        const firstJumpY = wallJumpYBase + WALL_JUMP_FIRST_BONUS_Y_SPEED_WORLD;
        const wallJumpY = isInitialWallJump
          ? firstJumpY
          : isSecondWallJump
            ? firstJumpY * WALL_JUMP_SECOND_Y_MULTIPLIER
            : wallJumpYBase * WALL_JUMP_SUBSEQUENT_Y_MULTIPLIER;
        // wallDir = +1 if wall is to the right, -1 if wall is to the left
        const wallDir = canJumpFromRight ? 1 : -1;
        // Launch away: strong diagonal push prevents same-wall climbing.
        cluster.velocityXWorld          = -wallDir * wallJumpX;
        cluster.velocityYWorld          = -wallJumpY;
        cluster.isFastFallModeFlag      = 0;
        cluster.wallJumpLockoutTicks    = WALL_JUMP_LOCKOUT_TICKS;
        cluster.wallJumpForceTimeTicks  = WALL_JUMP_FORCE_TIME_TICKS;
        cluster.wallJumpDirX            = -wallDir; // outward direction
        cluster.isWallSlidingFlag       = 0;
        cluster.coyoteTimeTicks         = 0;
        cluster.wallJumpGraceLeftTicks  = 0;
        cluster.wallJumpGraceRightTicks = 0;
        cluster.wallJumpCountSinceReset += 1;
        if (isInitialWallJump) {
          world.wallJumpSkidDebrisBurstFlag = 1;
          world.skidDebrisXWorld = cluster.positionXWorld;
          world.skidDebrisYWorld = cluster.positionYWorld + cluster.halfHeightWorld;
        }
        // Spawn heavy debris cascade on the 3rd+ consecutive wall jump (weak/slippery).
        if (cluster.wallJumpCountSinceReset > 2) {
          world.weakWallJumpCascadeFlag = 1;
          // Spawn at the wall contact edge (player side facing the wall)
          world.weakWallJumpCascadeXWorld = cluster.positionXWorld
            + wallDir * cluster.halfWidthWorld;
          world.weakWallJumpCascadeYWorld = cluster.positionYWorld;
          world.weakWallJumpCascadeWallSideX = wallDir;
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
}
