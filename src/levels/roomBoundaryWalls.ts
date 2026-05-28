/**
 * roomBoundaryWalls.ts — Shared complete boundary wall generation.
 *
 * Produces four solid invisible edge walls covering the full perimeter of a
 * room.  Transition openings are NOT cut into these walls.
 *
 * Design decision (BUILD 420):
 *   Transitions are now trigger strips that sit just inside the boundary — they
 *   are NOT holes in the wall geometry.  The boundary wall is always complete.
 *   A player entering a trigger strip triggers the room transition before
 *   the solid boundary wall can hard-block them.
 *
 *   Do NOT reintroduce wall gaps for transitions here.  Transition zone geometry
 *   is defined separately in RoomTransitionDef and detected by checkRoomTransitions().
 *
 * Shared by:
 *   - roomJsonLoader.ts     (runtime loading path)
 *   - editorRoomBuilder.ts  (editor → RoomDef conversion path)
 *   - roomJsonSerializer.ts (bake path during export)
 */

import type { RoomWallDef } from './roomDef';

/**
 * Builds four complete solid edge walls for a room of the given dimensions.
 *
 * All four walls use `isInvisibleFlag: 1` so they are not rendered but do
 * participate in collision — matching the previous invisible boundary wall
 * convention.
 *
 * Wall layout (all in block units):
 *   Top wall:    x=0,          y=0,              w=widthBlocks,  h=1
 *   Bottom wall: x=0,          y=heightBlocks-1, w=widthBlocks,  h=1
 *   Left wall:   x=0,          y=1,              w=1,            h=heightBlocks-2
 *   Right wall:  x=widthBlocks-1, y=1,           w=1,            h=heightBlocks-2
 *
 * The top and bottom walls span the full width (including corners).
 * The left and right walls fill only the interior height (rows 1…h-2) to avoid
 * double-covering the corner cells already claimed by top/bottom.
 */
export function buildCompleteBoundaryWalls(widthBlocks: number, heightBlocks: number): RoomWallDef[] {
  // Guard against degenerate rooms.
  if (widthBlocks < 2 || heightBlocks < 2) return [];

  const walls: RoomWallDef[] = [
    // Top edge — full width
    { xBlock: 0, yBlock: 0,               wBlock: widthBlocks,  hBlock: 1, isInvisibleFlag: 1 },
    // Bottom edge — full width
    { xBlock: 0, yBlock: heightBlocks - 1, wBlock: widthBlocks, hBlock: 1, isInvisibleFlag: 1 },
    // Left edge — interior height only (corners owned by top/bottom)
    { xBlock: 0,              yBlock: 1, wBlock: 1, hBlock: heightBlocks - 2, isInvisibleFlag: 1 },
    // Right edge — interior height only
    { xBlock: widthBlocks - 1, yBlock: 1, wBlock: 1, hBlock: heightBlocks - 2, isInvisibleFlag: 1 },
  ];

  return walls;
}
