import { WorldState, MAX_ROPES, MAX_ROPE_SEGMENTS, MAX_GRASSHOPPERS, GRASSHOPPER_INITIAL_TIMER_MAX_TICKS } from '../sim/world';
import { nextFloat, nextFloatTriangle } from '../sim/rng';
import {
  RoomDef,
  BLOCK_SIZE_MEDIUM,
  BLOCK_SIZE_SMALL,
  PLAYER_HALF_WIDTH_WORLD,
  PLAYER_HALF_HEIGHT_WORLD,
  DEFAULT_ROPE_SEGMENT_COUNT,
  ROPE_THICKNESS_HALF_WORLD,
} from '../levels/roomDef';
import { initRopeSegments, presettleRopes } from '../sim/ropes/ropeSim';

/** Duration (ms) to show health bar after taking damage. */
export const HEALTH_BAR_DISPLAY_MS = 3000;

/** Half-width and half-height (world units) of a flying eye cluster hitbox. */
export const FLYING_EYE_HALF_SIZE_WORLD = 2.8;

/** Blocks of transition tunnel extending past room boundary. */
export const TUNNEL_DETECT_MARGIN_WORLD = 2 * BLOCK_SIZE_MEDIUM;
/** Skillbook sprite size in world units (24×24 px; 3×3 tiles). */
export const SKILLBOOK_SIZE_WORLD = 3 * BLOCK_SIZE_MEDIUM;
/** Pickup radius for skillbook collection. */
export const SKILLBOOK_PICKUP_RADIUS_WORLD = 2.2 * BLOCK_SIZE_MEDIUM;
/** Dust container sprite size in world units (24×24 px). */
export const DUST_CONTAINER_SIZE_WORLD = 3 * BLOCK_SIZE_MEDIUM;
/** Dust container shard sprite size in world units. */
export const DUST_CONTAINER_SHARD_SIZE_WORLD = 2 * BLOCK_SIZE_MEDIUM;
/** Pickup radius for dust container collection. */
export const DUST_CONTAINER_PICKUP_RADIUS_WORLD = 2.2 * BLOCK_SIZE_MEDIUM;
/** Pickup radius for dust container shard collection. */
export const DUST_CONTAINER_SHARD_PICKUP_RADIUS_WORLD = 1.7 * BLOCK_SIZE_MEDIUM;
/** Dust particles granted by one Dust Container collectible. */
export const DUST_CONTAINER_DUST_GAIN = 4;
/** Shards needed to forge one full dust container. */
export const DUST_CONTAINER_SHARDS_PER_CONTAINER = 4;

// loadRoomWalls and resolveWallSoundHardnessIndex extracted to gameRoomWalls.ts.
export { loadRoomWalls, resolveWallSoundHardnessIndex } from './gameRoomWalls';

// loadRoomHazards extracted to gameRoomHazards.ts.
export { loadRoomHazards } from './gameRoomHazards';

// loadRoomFallingBlocks extracted to gameRoomFallingBlocks.ts.
export { loadRoomFallingBlocks } from './gameRoomFallingBlocks';

// loadRoomPixelMaterials extracted to gameRoomPixelMaterials.ts.
export { loadRoomPixelMaterials, rebuildPixelMaterialSolidMask } from './gameRoomPixelMaterials';


// ── Rendering/utility helpers re-exported from gameRoomHelpers.ts ─────────────
// These were previously defined in this file but have been moved to keep
// data-loading code separate from rendering and coordinate utilities.
export { worldBgColor, drawTunnelDarkness, renderTransitionPassageGradients, screenToWorld } from './gameRoomHelpers';


// ── Spawn-block safety helpers ────────────────────────────────────────────────

/**
 * Inset from each room edge (in blocks) used when clamping and scanning for a
 * valid player spawn position.  The boundary walls occupy the outermost block
 * strip, so this keeps the spawn clear of them.
 */
const SPAWN_MARGIN_BLOCKS = 2;

/**
 * Returns true if the player's AABB, centred on the given block position,
 * overlaps any solid (non-platform, non-invisible) wall in the room.
 * Ramp walls are treated as solid for the purpose of this check.
 */
function isSpawnBlockInSolidWall(room: RoomDef, xBlock: number, yBlock: number): boolean {
  const cx = xBlock * BLOCK_SIZE_MEDIUM;
  const cy = yBlock * BLOCK_SIZE_MEDIUM;
  const pLeft   = cx - PLAYER_HALF_WIDTH_WORLD;
  const pRight  = cx + PLAYER_HALF_WIDTH_WORLD;
  const pTop    = cy - PLAYER_HALF_HEIGHT_WORLD;
  const pBottom = cy + PLAYER_HALF_HEIGHT_WORLD;

  for (let wi = 0; wi < room.walls.length; wi++) {
    const wall = room.walls[wi];
    if (wall.isPlatformFlag === 1)  continue; // platforms don't block vertical spawn
    if (wall.isInvisibleFlag === 1) continue; // invisible boundary walls are passable

    // Half-width pillars use half the declared block-width; full walls scale 1:1.
    const wallWidthScale = wall.isPillarHalfWidthFlag === 1 ? 0.5 : 1;
    const wLeft   = wall.xBlock * BLOCK_SIZE_MEDIUM;
    const wTop    = wall.yBlock * BLOCK_SIZE_MEDIUM;
    const wRight  = wLeft + wall.wBlock * BLOCK_SIZE_MEDIUM * wallWidthScale;
    const wBottom = wTop  + wall.hBlock * BLOCK_SIZE_MEDIUM;

    if (pLeft < wRight && pRight > wLeft && pTop < wBottom && pBottom > wTop) {
      return true;
    }
  }
  return false;
}

/**
 * Scans the room (inside the SPAWN_MARGIN_BLOCKS border) and returns the first
 * block position whose player AABB does not overlap any solid wall.
 * Falls back to the room centre if every candidate block is blocked.
 */
export function findOpenSpawnBlock(room: RoomDef): [number, number] {
  const maxX = room.widthBlocks  - 1 - SPAWN_MARGIN_BLOCKS;
  const maxY = room.heightBlocks - 1 - SPAWN_MARGIN_BLOCKS;
  for (let y = SPAWN_MARGIN_BLOCKS; y <= maxY; y++) {
    for (let x = SPAWN_MARGIN_BLOCKS; x <= maxX; x++) {
      if (!isSpawnBlockInSolidWall(room, x, y)) {
        return [x, y];
      }
    }
  }
  // Absolute fallback: room centre
  return [Math.floor(room.widthBlocks / 2), Math.floor(room.heightBlocks / 2)];
}

/**
 * Resolves a desired spawn block to a valid, open position.
 *
 * 1. Clamps the position to the playable bounds
 *    ([SPAWN_MARGIN_BLOCKS, dimension − 1 − SPAWN_MARGIN_BLOCKS] on each axis).
 * 2. If the clamped position is inside a solid wall, falls back to
 *    `findOpenSpawnBlock` and logs a warning.
 */
export function resolveSpawnBlock(
  room: RoomDef,
  xBlock: number,
  yBlock: number,
): readonly [number, number] {
  const maxX = room.widthBlocks  - 1 - SPAWN_MARGIN_BLOCKS;
  const maxY = room.heightBlocks - 1 - SPAWN_MARGIN_BLOCKS;
  const cx = Math.min(Math.max(SPAWN_MARGIN_BLOCKS, xBlock), maxX);
  const cy = Math.min(Math.max(SPAWN_MARGIN_BLOCKS, yBlock), maxY);

  if (!isSpawnBlockInSolidWall(room, cx, cy)) {
    return [cx, cy] as const;
  }

  console.warn(
    `[gameRoom] Spawn block [${xBlock}, ${yBlock}] is inside a wall in room '${room.id}'. Finding open spawn.`,
  );
  return findOpenSpawnBlock(room);
}


// ── Rope destructibility index constants ──────────────────────────────────────
const ROPE_DESTR_INDESTRUCTIBLE = 0;
const ROPE_DESTR_PLAYER_ONLY = 1;
const ROPE_DESTR_ANY = 2;

/**
 * Loads rope definitions from a RoomDef into the WorldState rope buffers.
 * Initialises Verlet segment positions as a straight line from anchor A to B,
 * then pre-settles the rope by running many Verlet iterations so it starts in
 * its natural sagged shape on first render.
 */
export function loadRoomRopes(world: WorldState, room: RoomDef): void {
  const ropes = room.ropes ?? [];
  const count = Math.min(ropes.length, MAX_ROPES);
  world.ropeCount = count;
  // Reset grapple-to-rope attachment state
  world.grappleRopeIndex = -1;
  world.grappleRopeAttachSegF = 0.0;

  for (let r = 0; r < count; r++) {
    const def = ropes[r];
    const segCount = Math.max(2, Math.min(def.segmentCount ?? DEFAULT_ROPE_SEGMENT_COUNT, MAX_ROPE_SEGMENTS));
    world.ropeSegmentCount[r] = segCount;

    // All room elements use block units where 1 block = BLOCK_SIZE_SMALL world units.
    // BLOCK_SIZE_MEDIUM and BLOCK_SIZE_LARGE are aliased to BLOCK_SIZE_SMALL in the
    // current codebase (all tiers = 8), so BLOCK_SIZE_SMALL is the canonical multiplier.
    const ax = def.anchorAXBlock * BLOCK_SIZE_SMALL;
    const ay = def.anchorAYBlock * BLOCK_SIZE_SMALL;
    const bx = def.anchorBXBlock * BLOCK_SIZE_SMALL;
    const by = def.anchorBYBlock * BLOCK_SIZE_SMALL;

    world.ropeAnchorAXWorld[r] = ax;
    world.ropeAnchorAYWorld[r] = ay;
    world.ropeAnchorBXWorld[r] = bx;
    world.ropeAnchorBYWorld[r] = by;
    // Default: both anchors fixed (isAnchorBFixed undefined or true → pinned).
    world.ropeIsAnchorBFixedFlag[r] = def.isAnchorBFixed !== false ? 1 : 0;

    const destr = def.destructibility ?? 'indestructible';
    world.ropeDestructibilityIndex[r] =
      destr === 'playerOnly' ? ROPE_DESTR_PLAYER_ONLY :
      destr === 'any'        ? ROPE_DESTR_ANY :
                               ROPE_DESTR_INDESTRUCTIBLE;

    // Thickness: half-world-units from ROPE_THICKNESS_HALF_WORLD table.
    const thickIdx = def.thicknessIndex ?? 0;
    world.ropeHalfThickWorld[r] = ROPE_THICKNESS_HALF_WORLD[thickIdx];

    // Rest length = straight-line distance / (segCount - 1)
    const dx = bx - ax;
    const dy = by - ay;
    const totalLen = Math.sqrt(dx * dx + dy * dy);
    world.ropeSegRestLenWorld[r] = segCount > 1 ? totalLen / (segCount - 1) : totalLen;

    initRopeSegments(world, r);
  }

  // Pre-settle all ropes: run Verlet iterations so they appear sagged on first frame.
  if (count > 0) {
    presettleRopes(world);
  }
}

/**
 * Resets and spawns all grasshoppers for the given room into world state.
 * Grasshoppers are placed randomly within each authored grasshopper area.
 */
export function loadRoomGrasshoppers(world: WorldState, room: RoomDef): void {
  world.grasshopperCount = 0;
  if (!room.grasshopperAreas) return;

  for (const area of room.grasshopperAreas) {
    const areaXWorld = area.xBlock * BLOCK_SIZE_MEDIUM;
    const areaYWorld = area.yBlock * BLOCK_SIZE_MEDIUM;
    const areaWidthWorld = area.wBlock * BLOCK_SIZE_MEDIUM;
    const areaHeightWorld = area.hBlock * BLOCK_SIZE_MEDIUM;
    for (let g = 0; g < area.count && world.grasshopperCount < MAX_GRASSHOPPERS; g++) {
      const gi = world.grasshopperCount++;
      world.grasshopperXWorld[gi] = areaXWorld + areaWidthWorld  * 0.5
        + nextFloatTriangle(world.rng) * areaWidthWorld  * 0.5;
      world.grasshopperYWorld[gi] = areaYWorld + areaHeightWorld * 0.5
        + nextFloatTriangle(world.rng) * areaHeightWorld * 0.5;
      world.grasshopperVelXWorld[gi] = 0;
      world.grasshopperVelYWorld[gi] = 0;
      world.grasshopperHopTimerTicks[gi] = nextFloat(world.rng) * GRASSHOPPER_INITIAL_TIMER_MAX_TICKS;
      world.isGrasshopperAliveFlag[gi] = 1;
    }
  }
}
