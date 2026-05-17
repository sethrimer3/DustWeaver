/**
 * gamePlayerCloakUpdate.ts — Per-frame procedural cloak animation update.
 *
 * Extracted from gameScreen.ts to isolate the two cloak update calls that run
 * every render frame after physics ticks complete:
 *
 *   updatePlayerCloaks  — drives both PlayerCloak (main trailing cloak) and
 *                         PhantomCloakExtension (grapple phantom extension),
 *                         using the render-interpolated player position so the
 *                         cloaks track the sprite position rather than the raw
 *                         post-tick physics position.
 *
 * The render-interpolated position avoids a one-tick lead that would make the
 * cloak root appear to detach and jitter relative to the player body at display
 * refresh rates above 60 Hz.
 *
 * Both objects are mutated in place; this function has no return value and does
 * not touch world physics state.
 */

import type { WorldState } from '../sim/world';
import type { PlayerCloak } from '../render/clusters/playerCloak';
import type { PhantomCloakExtension } from '../render/clusters/phantomCloak';

/**
 * Updates the procedural player cloak and phantom-cloak extension for the
 * current render frame.
 *
 * Does nothing when no player cluster is present or the player is dead.
 *
 * @param playerCloak           Main trailing-cloak renderer (mutated).
 * @param phantomCloak          Grapple phantom extension (mutated).
 * @param world                 Current simulation world state (read-only view).
 * @param prevClusterPosX       Pre-tick cluster X positions for render interpolation.
 * @param prevClusterPosY       Pre-tick cluster Y positions for render interpolation.
 * @param renderAlpha           Fractional progress within the current tick (0–1).
 * @param elapsedMs             Wall-clock elapsed time this frame in milliseconds.
 */
export function updatePlayerCloaks(
  playerCloak: PlayerCloak,
  phantomCloak: PhantomCloakExtension,
  world: WorldState,
  prevClusterPosX: Float32Array,
  prevClusterPosY: Float32Array,
  renderAlpha: number,
  elapsedMs: number,
): void {
  const cloakPlayer = world.clusters[0];
  if (cloakPlayer === undefined || cloakPlayer.isAliveFlag === 0 || cloakPlayer.isPlayerFlag === 0) return;

  // Use the render-interpolated player position so the cloak chain anchor
  // matches the pixel position where the player sprite will be drawn.
  // Using raw physics positionXWorld instead causes the cloak root to sit
  // one-tick ahead of the sprite at non-60 Hz refresh rates, making the
  // cloak appear to detach and jitter relative to the player body.
  const cloakInterpXWorld = prevClusterPosX[0] + (cloakPlayer.positionXWorld - prevClusterPosX[0]) * renderAlpha;
  const cloakInterpYWorld = prevClusterPosY[0] + (cloakPlayer.positionYWorld - prevClusterPosY[0]) * renderAlpha;

  playerCloak.update(elapsedMs / 1000, {
    positionXWorld: cloakInterpXWorld,
    positionYWorld: cloakInterpYWorld,
    velocityXWorld: cloakPlayer.velocityXWorld,
    velocityYWorld: cloakPlayer.velocityYWorld,
    isFacingLeftFlag: cloakPlayer.isFacingLeftFlag,
    isGroundedFlag: cloakPlayer.isGroundedFlag,
    isSprintingFlag: cloakPlayer.isSprintingFlag,
    isCrouchingFlag: cloakPlayer.isCrouchingFlag,
    isWallSlidingFlag: cloakPlayer.isWallSlidingFlag,
    halfWidthWorld: cloakPlayer.halfWidthWorld,
    halfHeightWorld: cloakPlayer.halfHeightWorld,
  });

  // Update phantom cloak extension — roots at the main cloak's tip.
  phantomCloak.update(elapsedMs / 1000, {
    positionXWorld:    cloakInterpXWorld,
    positionYWorld:    cloakInterpYWorld,
    velocityXWorld:    cloakPlayer.velocityXWorld,
    velocityYWorld:    cloakPlayer.velocityYWorld,
    isFacingLeftFlag:  cloakPlayer.isFacingLeftFlag,
    isGrappleActiveFlag: world.isGrappleActiveFlag,
    rootXWorld:        playerCloak.getTipXWorld(),
    rootYWorld:        playerCloak.getTipYWorld(),
  });
}
