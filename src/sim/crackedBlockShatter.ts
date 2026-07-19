/**
 * Cracked-block momentum shatter.
 *
 * A crumble ("cracked") block instantly shatters — bypassing its normal 2-hit
 * damage sequence — when the player impacts its collision surface while the
 * canonical momentum-invulnerability predicate (`isHighVelocityAttacking`,
 * set once per tick by `updateMomentumCombatState`) is active.
 *
 * Called directly from the axis-separated wall sweep (`movementAxisResolvers`)
 * at the moment a genuine directional impact is detected, so it participates
 * in the same anti-tunnelling sub-stepped sweep as ordinary collision and
 * cannot be skipped by a fast-moving player.
 */

import type { WorldState } from './world';
import { MAX_SHATTER_EVENTS } from './world';

/**
 * Attempts to shatter the crumble block linked to wall `wallIndex`.
 * No-ops (returns false) if the wall is not a crumble block or is already
 * destroyed. On success, destroys the block's entire authored footprint
 * (multi-tile placements share a single wall/crumble entry, so this is a
 * single zero-out), clears its wall geometry so collision, rendering,
 * lighting/occlusion, and cached wall representations all pick up the
 * removal on the next frame, and records a shatter event for the particle
 * system.
 *
 * @param impactXWorld  Player position (world) at the moment of impact.
 * @param normalX/Y     Impacted surface normal, pointing away from the block
 *                       (e.g. -1,0 for the block's left face; 0,1 for its
 *                       bottom/ceiling face).
 */
export function tryShatterCrumbleBlockAtWall(
  world: WorldState,
  wallIndex: number,
  impactXWorld: number,
  impactYWorld: number,
  normalX: number,
  normalY: number,
  speedWorld: number = 0,
): boolean {
  if (wallIndex < 0 || wallIndex >= world.wallCount) return false;
  const ci = world.wallCrumbleBlockIndex[wallIndex];
  if (ci < 0 || ci >= world.crumbleBlockCount) return false;
  if (world.isCrumbleBlockActiveFlag[ci] === 0) return false;

  const footprintXWorld = world.wallXWorld[wallIndex] + world.wallWWorld[wallIndex] * 0.5;
  const footprintYWorld = world.wallYWorld[wallIndex] + world.wallHWorld[wallIndex] * 0.5;
  const footprintWWorld = world.wallWWorld[wallIndex];
  const footprintHWorld = world.wallHWorld[wallIndex];
  const themeIndex = world.wallThemeIndex[wallIndex];
  const variantIndex = world.crumbleBlockVariant[ci];

  // Destroy runtime state — never touches authored RoomDef data. Restoration
  // on room reload/re-entry happens naturally because loadRoomHazards()
  // rebuilds crumbleBlock*/wall* arrays from scratch from room.crumbleBlocks
  // every time a room is (re)loaded.
  world.isCrumbleBlockActiveFlag[ci] = 0;
  world.crumbleBlockHitsRemaining[ci] = 0;
  world.wallWWorld[wallIndex] = 0;
  world.wallHWorld[wallIndex] = 0;

  if (world.shatterEventCount < MAX_SHATTER_EVENTS) {
    const ei = world.shatterEventCount++;
    world.shatterEventXWorld[ei] = footprintXWorld;
    world.shatterEventYWorld[ei] = footprintYWorld;
    world.shatterEventWWorld[ei] = footprintWWorld;
    world.shatterEventHWorld[ei] = footprintHWorld;
    world.shatterEventImpactXWorld[ei] = impactXWorld;
    world.shatterEventImpactYWorld[ei] = impactYWorld;
    world.shatterEventNormalX[ei] = normalX;
    world.shatterEventNormalY[ei] = normalY;
    world.shatterEventThemeIndex[ei] = themeIndex;
    world.shatterEventVariantIndex[ei] = variantIndex;
    world.shatterEventSpeedWorld[ei] = speedWorld;
  }

  return true;
}
