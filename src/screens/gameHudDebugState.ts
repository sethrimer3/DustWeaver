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
import {
  WATER_BUOYANCY_BASE_ACCEL_WORLD_PER_SEC2,
  WATER_BUOYANCY_SUBMERSION_ACCEL_WORLD_PER_SEC2,
  WATER_GRAVITY_MULTIPLIER,
} from '../sim/clusters/playerWaterPhysics';
import {
  computeLogicalWallSurface,
  computeGroundConnectedExclusion,
  isContactInsideGroundExclusion,
  canWallJumpFromSurface,
  canWallSlideOnSurface,
  MIN_WALL_SLIDE_SURFACE_HEIGHT_WORLD,
} from '../sim/clusters/playerWallSurface';
import { getIceMoteAuraDebugInfo } from '../sim/iceMoteAura';

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

  // ── Wall eligibility diagnostics ─────────────────────────────────────────
  // Compute logical wall surface and exclusion zone for whichever side the
  // player is currently touching (prefer left; fall back to right; else none).
  let wallDbgSide: 'left' | 'right' | 'none' = 'none';
  let wallDbgRawPartHeightWorld       = 0;
  let wallDbgLogicalWallHeightWorld   = 0;
  let wallDbgContactYWorld            = 0;
  let wallDbgGroundFloor              = false;
  let wallDbgExclusionMinY            = 0;
  let wallDbgExclusionMaxY            = 0;
  let wallDbgContactInExclusion       = false;
  let wallDbgJumpAllowed              = false;
  let wallDbgSlideAllowed             = false;
  let wallDbgSlideSuppressedShort     = false;
  let wallDbgActionSuppressedExclusion = false;
  let wallDbgAdjacentFloorTopY        = Infinity;

  const isTouchLeft  = player.isTouchingWallLeftFlag  === 1;
  const isTouchRight = player.isTouchingWallRightFlag === 1;

  if (isTouchLeft || isTouchRight) {
    wallDbgSide = isTouchLeft ? 'left' : 'right';
    const side   = wallDbgSide;
    const hw     = player.halfWidthWorld;
    const hh     = player.halfHeightWorld;
    const posX   = player.positionXWorld;
    const posY   = player.positionYWorld;
    const faceX  = side === 'left'
      ? posX - hw   // wall to the left: its right face = player's left edge
      : posX + hw;  // wall to the right: its left face = player's right edge
    const playerTop    = posY - hh;
    const playerBottom = posY + hh;

    const surface   = computeLogicalWallSurface(faceX, side, playerTop, playerBottom, world);
    const exclusion = computeGroundConnectedExclusion(surface, side, world);
    const contactY  = playerBottom;
    const inExcl    = isContactInsideGroundExclusion(contactY, exclusion);
    const jumpOk    = player.wallJumpLockoutTicks === 0
      ? canWallJumpFromSurface(surface, exclusion, contactY)
      : false;
    const slideOk   = canWallSlideOnSurface(surface, exclusion, contactY);

    wallDbgRawPartHeightWorld        = surface.rawPartitionHeightWorld;
    wallDbgLogicalWallHeightWorld    = surface.height;
    wallDbgContactYWorld             = contactY;
    wallDbgGroundFloor               = exclusion.hasGroundConnectedFloor;
    wallDbgExclusionMinY             = exclusion.exclusionMinY;
    wallDbgExclusionMaxY             = exclusion.exclusionMaxY;
    wallDbgContactInExclusion        = inExcl;
    wallDbgJumpAllowed               = jumpOk;
    wallDbgSlideAllowed              = slideOk;
    wallDbgSlideSuppressedShort      = !slideOk && !inExcl &&
      surface.height < MIN_WALL_SLIDE_SURFACE_HEIGHT_WORLD;
    wallDbgActionSuppressedExclusion = inExcl;
    wallDbgAdjacentFloorTopY         = exclusion.adjacentFloorTopY;
  }

  // Ice Mote Aura debug (captured once before the return object).
  const iceMoteDbg = getIceMoteAuraDebugInfo();

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
    inputUp:    inputState.isJumpHeldFlag || inputState.isGamepadJumpHeldFlag || inputState.isJumpTriggeredFlag,
    inputLeft:  inputState.isKeyA,
    inputRight: inputState.isKeyD,
    inputDown:  inputState.isKeyS || inputState.isGamepadDownHeldFlag,
    inputLeftClick:  inputState.isMouseDownFlag === 1,
    inputRightClick: inputState.isRightMouseDownFlag === 1,
    inputGrapple:    inputState.isGrappleHeldFlag === 1,
    inputInteract:   interactInputPulseMs > 0,
    // Water / buoyancy debug
    isInLiquid:           world.isPlayerInWaterFlag === 1,
    submergedFraction:    world.playerWaterSubmersionRatio,
    liquidSurfaceYWorld:  world.playerBuoyancySurfaceYWorld,
    depthFactor:          world.playerBuoyancyDepthFactor,
    buoyancyAccelWorldPerSec2: world.isPlayerInWaterFlag === 1
      ? WATER_BUOYANCY_BASE_ACCEL_WORLD_PER_SEC2
        + WATER_BUOYANCY_SUBMERSION_ACCEL_WORLD_PER_SEC2 * world.playerWaterSubmersionRatio
      : 0,
    gravityScale: world.isPlayerInWaterFlag === 1
      ? WATER_GRAVITY_MULTIPLIER
      : 1.0,
    playerVelocityYWorld: player.velocityYWorld,
    // Wall eligibility diagnostics
    wallDbgSide,
    wallDbgRawPartHeightWorld,
    wallDbgLogicalWallHeightWorld,
    wallDbgContactYWorld,
    wallDbgGroundFloor,
    wallDbgExclusionMinY,
    wallDbgExclusionMaxY,
    wallDbgContactInExclusion,
    wallDbgJumpAllowed,
    wallDbgSlideAllowed,
    wallDbgSlideSuppressedShort,
    wallDbgActionSuppressedExclusion,
    wallDbgAdjacentFloorTopY,
    // Ice Mote Aura debug
    iceMoteAuraActive:      iceMoteDbg.isActive,
    iceMoteAuraFrozenCount: iceMoteDbg.frozenZoneCount,
    iceMoteAuraRadiusWorld: iceMoteDbg.radiusWorld,
  };
}
