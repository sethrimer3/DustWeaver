/**
 * Pure spawn-block math for the visual world map's transition-linking flows.
 *
 * Extracted from editorVisualMapLinkPrompt.ts so it can be imported without
 * pulling in `../levels/rooms` (which transitively reads
 * `import.meta.env.BASE_URL` at module scope and cannot be imported under
 * the plain `node --test` runner used by src/tests/**). Has zero DOM/Vite
 * dependencies — safe to import from anywhere, including Node-based tests.
 */

import type { RoomDef, RoomTransitionDef } from '../levels/roomDef';

/**
 * Returns the [xBlock, yBlock] spawn position for a player entering a room
 * through the given transition, inset from the door edge.
 * Uses xBlock/yBlock if available, otherwise falls back to positionBlock.
 */
export function computeSpawnBlockForMapLink(
  room: RoomDef,
  transition: RoomTransitionDef,
): readonly [number, number] {
  const SPAWN_INSET_BLOCKS = 3;
  // For left/right: opening runs along Y axis → center Y = yBlock + half opening.
  // For up/down:   opening runs along X axis → center X = xBlock + half opening.
  const openingCenterY = (transition.yBlock ?? transition.positionBlock) + Math.floor(transition.openingSizeBlocks / 2);
  const openingCenterX = (transition.xBlock ?? transition.positionBlock) + Math.floor(transition.openingSizeBlocks / 2);

  if (transition.direction === 'left') {
    return [SPAWN_INSET_BLOCKS, openingCenterY];
  }
  if (transition.direction === 'right') {
    return [room.widthBlocks - SPAWN_INSET_BLOCKS - 1, openingCenterY];
  }
  if (transition.direction === 'up') {
    return [openingCenterX, SPAWN_INSET_BLOCKS];
  }
  return [openingCenterX, room.heightBlocks - SPAWN_INSET_BLOCKS - 1];
}
