/**
 * gameHudDebugState.ts — Builds the per-frame debug HUD state.
 *
 * Extracted from gameScreen.ts to isolate the pure computation that maps
 * world + input state into the `HudDebugState` shape expected by the
 * HUD overlay renderer.  No side effects — callers may pass the result
 * directly to `hudState.debug`.
 */

import type { WorldState } from '../sim/world';
import type { InputState } from '../input/handler';
import type { HudDebugState } from '../render/hud/overlay';
import { ZIP_JUMP_WINDOW_SECONDS } from '../sim/clusters/grappleZip';
import { WATER_GRAVITY_MULTIPLIER, WATER_BUOYANCY_FORCE_WORLD } from '../sim/hazards';

/**
 * Builds a `HudDebugState` object from current world and input state.
 *
 * Returns `undefined` when the player cluster is absent or dead — in that
 * case the caller should set `hudState.debug = undefined` so the debug panel
 * is hidden.
 *
 * @param world            Current sim world state (read-only in this function).
 * @param inputState       Current frame's raw input state.
 * @param interactInputPulseMs  Remaining ms of the interact-icon pulse (> 0 = lit).
 */
export function buildHudDebugState(
  world: WorldState,
  inputState: InputState,
  interactInputPulseMs: number,
): HudDebugState | undefined {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return undefined;

  const isStandingOnSurface =
    player.isGroundedFlag === 1 || world.isGrappleStuckFlag === 1;

  return {
    isGrounded:           player.isGroundedFlag === 1,
    isStandingOnSurface,
    coyoteTimeTicks:      player.coyoteTimeTicks,
    jumpBufferTicks:      player.jumpBufferTicks,
    isWallSlidingFlag:    player.isWallSlidingFlag === 1,
    isTouchingWallLeft:   player.isTouchingWallLeftFlag === 1,
    isTouchingWallRight:  player.isTouchingWallRightFlag === 1,
    wallJumpLockoutTicks: player.wallJumpLockoutTicks,
    isGrappleActive:      world.isGrappleActiveFlag === 1,
    grappleLengthWorld:   world.grappleLengthWorld,
    grapplePullInAmountWorld: world.grapplePullInAmountWorld,
    isGrappleMissActive:  world.isGrappleMissActiveFlag === 1,
    grappleParticleStartIndex: world.grappleParticleStartIndex,
    isGrappleChainHiddenFlag: true,
    isGrappleZipActive:   world.isGrappleZipActiveFlag === 1,
    isGrappleStuck:       world.isGrappleStuckFlag === 1,
    hasZipImpactedSurface: world.hasZipImpactedSurfaceFlag === 1,
    zipJumpWindowTicksLeft: world.isGrappleStuckFlag === 1
      ? Math.max(0, Math.round(ZIP_JUMP_WINDOW_SECONDS * 60) - world.grappleStuckStoppedTickCount)
      : 0,
    grappleInputMode:     world.grappleInputMode,
    isSkidding:           player.isSkiddingFlag === 1,
    isSliding:            player.isSlidingFlag === 1,
    isSprinting:          player.isSprintingFlag === 1,
    inputUp:    inputState.isJumpHeldFlag || inputState.isJumpTriggeredFlag,
    inputLeft:  inputState.isKeyA,
    inputRight: inputState.isKeyD,
    inputDown:  inputState.isKeyS,
    inputShift: inputState.isSprintHeldFlag,
    inputLeftClick:  inputState.isMouseDownFlag === 1,
    inputRightClick: inputState.isRightMouseDownFlag === 1,
    inputGrapple:    inputState.isGrappleHeldFlag === 1,
    inputInteract:   interactInputPulseMs > 0,
    // Water / buoyancy debug
    isInLiquid:           world.isPlayerInWaterFlag === 1,
    submergedFraction:    world.playerWaterSubmersionRatio,
    liquidSurfaceYWorld:  world.playerBuoyancySurfaceYWorld,
    depthFactor:          world.playerBuoyancyDepthFactor,
    buoyancyAccelWorldPerSec2: WATER_BUOYANCY_FORCE_WORLD
      * world.playerWaterSubmersionRatio
      * world.playerBuoyancyDepthFactor,
    gravityScale: world.isPlayerInWaterFlag === 1
      ? WATER_GRAVITY_MULTIPLIER
      : 1.0,
    playerVelocityYWorld: player.velocityYWorld,
  };
}
