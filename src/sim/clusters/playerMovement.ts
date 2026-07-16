/**
 * Player-specific velocity / input logic extracted from movement.ts.
 *
 * Handles:
 *   • Cooldown / buffer timer ticks
 *   • Facing direction, sprint, slide, crouch state
 *   • Idle animation state machine
 *
 * Vertical physics (gravity, variable-jump sustain, fall speed cap, jump
 * trigger) live in playerVerticalMovement.ts.
 * Horizontal physics (acceleration, deceleration, skid detection) live in
 * playerHorizontalMovement.ts.
 */

import { WorldState } from '../world';
import { ClusterState } from './state';
import { DASH_RECHARGE_ANIM_TICKS } from './dashConstants';
import { PLAYER_HALF_HEIGHT_WORLD } from '../../levels/roomDef';
import { nextUint32 } from '../rng';

import {
  CROUCH_HALF_HEIGHT_WORLD,
  IDLE_TRIGGER_TICKS,
  IDLE_BLINK_DURATION_TICKS,
} from './movementConstants';
import { applyPlayerGravityAndJump } from './playerVerticalMovement';
import { applyPlayerHorizontalMovement } from './playerHorizontalMovement';
import { applyPlayerWaterHorizontalDrag } from './playerWaterPhysics';

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
  // Track consecutive airborne ticks for wall-jump intent filtering.
  // isGroundedFlag here reflects LAST tick's grounded state (collision pass
  // runs after tickPlayerMovement), which is the correct value.
  if (cluster.isGroundedFlag === 1) {
    cluster.airborneTicks = 0;
  } else {
    cluster.airborneTicks += 1;
  }
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
  if (cluster.wallJumpGraceLeftTicks > 0) {
    cluster.wallJumpGraceLeftTicks -= 1;
  }
  if (cluster.wallJumpGraceRightTicks > 0) {
    cluster.wallJumpGraceRightTicks -= 1;
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
  // Clear committed fast-fall mode when the player is on the ground.
  if (cluster.isGroundedFlag === 1) {
    cluster.isFastFallModeFlag = 0;
  }
  // Grappling resets the "first wall jump" bonus state.
  if (world.isGrappleActiveFlag === 1 || world.isGrappleStuckFlag === 1) {
    cluster.wallJumpCountSinceReset = 0;
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

  // ── Apply gravity, variable-jump sustain, fall speed cap, and jump trigger ──
  applyPlayerGravityAndJump(cluster, world, dtSec);

  // ── Horizontal movement + skid detection + fast-fall hitbox ──────────────
  applyPlayerHorizontalMovement(cluster, world, dtSec);
  if (world.isPlayerInWaterFlag === 1) {
    applyPlayerWaterHorizontalDrag(cluster, dtSec);
  }
}
