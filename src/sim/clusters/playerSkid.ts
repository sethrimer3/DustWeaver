/**
 * Player skid state — the authoritative activation/termination phase for the
 * Movement V2 skid technique.
 *
 * A skid begins when the player deliberately reverses horizontal input while
 * grounded and moving at or above walking speed. It has nothing to do with
 * sprint (removed entirely in Movement V2): any grounded reversal at
 * sufficient speed qualifies, Shift or no Shift.
 *
 * This must run BEFORE `applyPlayerGravityAndJump` (the jump trigger reads
 * `cluster.isSkiddingFlag` / `cluster.skidEntryVelocityXWorld` to decide
 * whether to grant a skid jump). Running it earlier — rather than relying on
 * last tick's flag, as the old sprint-skid detection did inside
 * `applyPlayerHorizontalMovement` — means a same-tick reversal-plus-jump
 * press is handled correctly instead of being lost for one tick.
 */

import { WorldState } from '../world';
import { ClusterState } from './state';
import { debugSpeedOverrides, ov, GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC, SKID_ENTRY_SPEED_EPSILON_WORLD } from './movementConstants';

/**
 * Update `cluster.isSkiddingFlag` and `cluster.skidEntryVelocityXWorld` for
 * this tick. Call once per player tick, before vertical (jump) movement.
 */
export function updatePlayerSkidState(cluster: ClusterState, world: WorldState): void {
  const isGrounded = cluster.isGroundedFlag === 1;
  // A skid that was active when the player left the ground (without
  // consuming a skid jump) stays consumable through the coyote-time window,
  // mirroring how coyote time extends ordinary jump eligibility — the skid
  // jump paths (direct + coyote) share one authoritative height calculation.
  const isCoyoteEligible = cluster.coyoteTimeTicks > 0;
  const isGrappling = world.isGrappleActiveFlag === 1 || world.isGrappleStuckFlag === 1;
  const isOnIce = cluster.isGroundedOnIceFlag === 1 || cluster.isOnUltraIceFlag === 1;
  const isInWater = world.isPlayerInWaterFlag === 1;
  const isIncompatibleState = isGrappling || isOnIce || isInWater;

  if (isIncompatibleState) {
    cluster.isSkiddingFlag = 0;
    return;
  }

  const inputDx = world.playerMoveInputDxWorld;
  const velocityX = cluster.velocityXWorld;

  if (cluster.isSkiddingFlag === 1) {
    // ── Continuation ────────────────────────────────────────────────────
    if (!isGrounded && !isCoyoteEligible) {
      // Fully airborne beyond the coyote grace without consuming the jump.
      cluster.isSkiddingFlag = 0;
      return;
    }
    // Stays active only while input still opposes the ORIGINAL travel
    // direction and velocity has not yet crossed into the new direction.
    const entryWasPositive = cluster.skidEntryVelocityXWorld > 0;
    const stillOpposing = entryWasPositive ? inputDx < 0 : inputDx > 0;
    const stillOriginalDirection = entryWasPositive ? velocityX > 0 : velocityX < 0;
    if (stillOpposing && stillOriginalDirection) {
      return; // Remains active; skidEntryVelocityXWorld stays latched.
    }
    cluster.isSkiddingFlag = 0;
    return;
  }

  // ── Entry — requires actually being grounded (coyote time only extends
  // an already-active skid; it does not let a new one begin mid-air) ──────
  if (!isGrounded) return;
  if (inputDx === 0 || velocityX === 0) return;
  const isOpposite = (inputDx > 0 && velocityX < 0) || (inputDx < 0 && velocityX > 0);
  if (!isOpposite) return;

  const walkingSpeed = ov(debugSpeedOverrides.walkSpeedWorld, GROUND_MAX_INPUT_SPEED_WORLD_PER_SEC);
  if (Math.abs(velocityX) < walkingSpeed - SKID_ENTRY_SPEED_EPSILON_WORLD) return;

  cluster.isSkiddingFlag = 1;
  cluster.skidEntryVelocityXWorld = velocityX;
}

/** Clears active skid state — called when a skid jump consumes it. */
export function clearPlayerSkidState(cluster: ClusterState): void {
  cluster.isSkiddingFlag = 0;
}
