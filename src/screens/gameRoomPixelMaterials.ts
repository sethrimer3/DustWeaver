/**
 * gameRoomPixelMaterials.ts — Room pixel-material (falling sand) loader.
 *
 * Rebuilds the room's solid-occupancy mask from the just-loaded wall geometry
 * and creates a fresh `PixelMaterialSystem` sized to the room's world
 * dimensions, then seeds it with the room's authored placements.
 *
 * Must be called AFTER loadRoomWalls/loadRoomFallingBlocks so the wall arrays
 * (including falling-block wall slots) are current when the solid mask is built.
 */

import type { WorldState } from '../sim/world';
import type { RoomDef } from '../levels/roomDef';
import { PixelMaterialSystem } from '../sim/pixelMaterials/pixelMaterialSystem';
import { buildSolidMaskFromWorld } from '../sim/pixelMaterials/pixelMaterialSolid';

export function loadRoomPixelMaterials(world: WorldState, room: RoomDef): void {
  const widthPx = Math.max(1, Math.round(world.worldWidthWorld));
  const heightPx = Math.max(1, Math.round(world.worldHeightWorld));

  const system = new PixelMaterialSystem(widthPx, heightPx);
  system.solid = buildSolidMaskFromWorld(world, widthPx, heightPx);
  system.loadFromDefs(room.pixelMaterials ?? []);

  world.pixelMaterialSystem = system;
}

/**
 * Rebuilds only the solid-occupancy mask from current wall geometry, without
 * discarding placed particles. Call this after any in-place wall mutation
 * that doesn't go through a full room reload (e.g. editor tile paint/erase
 * against the live preview world).
 */
export function rebuildPixelMaterialSolidMask(world: WorldState): void {
  const widthPx = world.pixelMaterialSystem.widthPx;
  const heightPx = world.pixelMaterialSystem.heightPx;
  world.pixelMaterialSystem.solid = buildSolidMaskFromWorld(world, widthPx, heightPx);
}
