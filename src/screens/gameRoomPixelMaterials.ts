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
import { BLOCK_SIZE_MEDIUM, type RoomDef } from '../levels/roomDef';
import { PixelMaterialSystem } from '../sim/pixelMaterials/pixelMaterialSystem';
import { buildSolidMaskFromWorld } from '../sim/pixelMaterials/pixelMaterialSolid';
import { CustomBlockWindMask } from '../sim/pixelMaterials/customBlockWindMask';

/**
 * Builds the Phase 2F wind-transmission mask from the room's registered
 * windbreak placements (`RoomDef.windTransmissionBlocks` — one entry per
 * placement, see its doc comment). World units and native pixels are the
 * same scale (1 unit = 1 native px = 1 world unit — see
 * pixelMaterialTypes.ts), so block-to-world conversion (`* BLOCK_SIZE_MEDIUM`)
 * is all that's needed to get native-pixel rects.
 */
function buildCustomBlockWindMaskFromRoom(room: RoomDef, widthPx: number, heightPx: number): CustomBlockWindMask {
  const mask = new CustomBlockWindMask(widthPx, heightPx);
  for (const d of room.windTransmissionBlocks ?? []) {
    const x0 = d.xBlock * BLOCK_SIZE_MEDIUM;
    const y0 = d.yBlock * BLOCK_SIZE_MEDIUM;
    const x1 = (d.xBlock + d.wBlock) * BLOCK_SIZE_MEDIUM;
    const y1 = (d.yBlock + d.hBlock) * BLOCK_SIZE_MEDIUM;
    mask.markRect(x0, y0, x1, y1, d.tier === 'block' ? 2 : 1);
  }
  return mask;
}

export function loadRoomPixelMaterials(world: WorldState, room: RoomDef): void {
  const widthPx = Math.max(1, Math.round(world.worldWidthWorld));
  const heightPx = Math.max(1, Math.round(world.worldHeightWorld));

  const system = new PixelMaterialSystem(widthPx, heightPx);
  system.solid = buildSolidMaskFromWorld(world, widthPx, heightPx);
  system.windMask = buildCustomBlockWindMaskFromRoom(room, widthPx, heightPx);
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
