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
import type { MomentumTrail } from '../render/clusters/momentumTrail';
import type { VerdantAfterimageTrail } from '../render/clusters/verdantAfterimageTrail';
import { isVerdantDustEquipped } from '../sim/clusters/verdantMobility';
import { getCharacterSprites, getPlayerSprite } from '../render/clusters/characterSprites';

/** Matches PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD used by renderer.ts / playerCloak.ts. */
const PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD = -1;

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
  momentumTrail?: MomentumTrail,
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

  // Update the golden momentum-combat trail — anchored at the sprite center
  // (matches the world-Y offset renderer.ts uses when positioning the sprite).
  if (momentumTrail !== undefined) {
    momentumTrail.update(elapsedMs / 1000, {
      anchorXWorld: cloakInterpXWorld,
      anchorYWorld: cloakInterpYWorld + PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD,
      velocityXWorld: cloakPlayer.velocityXWorld,
      velocityYWorld: cloakPlayer.velocityYWorld,
      isHighVelocityAttacking: cloakPlayer.isHighVelocityAttacking,
    });
  }
}

/**
 * Updates the Verdant Dust afterimage trail for the current render frame.
 * Captures the player's exact resolved displayed sprite (pose/animation
 * frame/facing already baked into the resolved `HTMLImageElement`, matching
 * `renderer.ts`'s own sprite resolution) at the render-interpolated position
 * so the trail's positions match where the sprite is actually drawn.
 *
 * No-op (and stops producing new entries — existing ones still fade) once
 * Verdant is unequipped or the player is stationary/dead.
 */
export function updateVerdantAfterimageTrailFrame(
  trail: VerdantAfterimageTrail,
  world: WorldState,
  prevClusterPosX: Float32Array,
  prevClusterPosY: Float32Array,
  renderAlpha: number,
  elapsedMs: number,
): void {
  const player = world.clusters[0];
  const dtSec = elapsedMs / 1000;
  if (player === undefined || player.isAliveFlag === 0 || player.isPlayerFlag === 0) {
    trail.update(dtSec, false, { sprite: null as unknown as HTMLImageElement, xWorld: 0, yWorld: 0, isFacingLeft: false });
    return;
  }

  const interpXWorld = prevClusterPosX[0] + (player.positionXWorld - prevClusterPosX[0]) * renderAlpha;
  const interpYWorld = prevClusterPosY[0] + (player.positionYWorld - prevClusterPosY[0]) * renderAlpha;

  const speed = Math.hypot(player.velocityXWorld, player.velocityYWorld);
  const isMoving = speed > 4.0;
  const active = isVerdantDustEquipped(world) && isMoving;

  if (!active) {
    trail.update(dtSec, false, { sprite: null as unknown as HTMLImageElement, xWorld: interpXWorld, yWorld: interpYWorld, isFacingLeft: player.isFacingLeftFlag === 1 });
    return;
  }

  const charSprites = getCharacterSprites(world.characterId);
  const isGrappling = world.isGrappleActiveFlag === 1;
  const sprite = getPlayerSprite(charSprites, player as unknown as import('../render/clusterSnapshotTypes').ClusterSnapshot, isGrappling);

  trail.update(dtSec, true, {
    sprite,
    xWorld: interpXWorld,
    yWorld: interpYWorld + PLAYER_SPRITE_CENTER_OFFSET_Y_WORLD,
    isFacingLeft: player.isFacingLeftFlag === 1,
  });
}
