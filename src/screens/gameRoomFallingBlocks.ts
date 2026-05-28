/**
 * gameRoomFallingBlocks.ts — Room falling block loader.
 *
 * Converts editor-placed falling block tiles into runtime FallingBlockGroup
 * objects, reserving one wall slot per group in the world wall arrays.
 *
 * Extracted from gameRoom.ts to keep data-loading responsibilities focused
 * (wall/hazard/rope loading in gameRoom.ts; falling-block loading here).
 */

import type { WorldState } from '../sim/world';
import { MAX_WALLS } from '../sim/world';
import { RoomDef, BLOCK_SIZE_MEDIUM, WALL_THEME_DEFAULT_INDEX, type FallingBlockVariant } from '../levels/roomDef';
import { MAX_TILES_PER_GROUP, MAX_LANDING_CONTACTS, type FallingBlockGroup } from '../sim/fallingBlocks/fallingBlockTypes';
import { resolveWallSoundHardnessIndex } from './gameRoom';

/**
 * Converts editor-placed falling block tiles into runtime FallingBlockGroup
 * objects, reserving a wall slot per group in the world wall arrays.
 *
 * Algorithm:
 *  1. Collect all tile positions by variant.
 *  2. Run a flood-fill (BFS) to find orthogonally-connected components of the
 *     same variant — each component becomes one group.
 *  3. For each group, compute the bounding box, reserve a wall slot, and
 *     populate the FallingBlockGroup.
 *
 * Must be called AFTER loadRoomWalls so wall slots start past the static geometry.
 */
export function loadRoomFallingBlocks(world: WorldState, room: RoomDef): void {
  world.fallingBlockGroups = [];

  const tileDefs = room.fallingBlocks ?? [];
  if (tileDefs.length === 0) return;

  // Build a tile lookup by "x,y" key
  type TileEntry = { xBlock: number; yBlock: number; variant: string };
  const tileMap = new Map<string, TileEntry>();
  for (const t of tileDefs) {
    tileMap.set(`${t.xBlock},${t.yBlock}`, { xBlock: t.xBlock, yBlock: t.yBlock, variant: t.variant });
  }

  const visited = new Set<string>();
  let nextGroupId = 0;

  for (const [, tile] of tileMap) {
    const startKey = `${tile.xBlock},${tile.yBlock}`;
    if (visited.has(startKey)) continue;

    // BFS to collect the orthogonally-connected component of the same variant
    const queue: TileEntry[] = [tile];
    const component: TileEntry[] = [];
    visited.add(startKey);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);

      const neighbors = [
        { xBlock: current.xBlock + 1, yBlock: current.yBlock },
        { xBlock: current.xBlock - 1, yBlock: current.yBlock },
        { xBlock: current.xBlock,     yBlock: current.yBlock + 1 },
        { xBlock: current.xBlock,     yBlock: current.yBlock - 1 },
      ];
      for (const nb of neighbors) {
        const nk = `${nb.xBlock},${nb.yBlock}`;
        if (visited.has(nk)) continue;
        const nbTile = tileMap.get(nk);
        if (nbTile === undefined || nbTile.variant !== tile.variant) continue;
        visited.add(nk);
        queue.push(nbTile);
      }
    }

    // Compute bounding box of the component
    let minX = component[0].xBlock;
    let minY = component[0].yBlock;
    let maxX = component[0].xBlock;
    let maxY = component[0].yBlock;
    for (const t of component) {
      if (t.xBlock < minX) minX = t.xBlock;
      if (t.yBlock < minY) minY = t.yBlock;
      if (t.xBlock > maxX) maxX = t.xBlock;
      if (t.yBlock > maxY) maxY = t.yBlock;
    }

    const restXWorld = minX * BLOCK_SIZE_MEDIUM;
    const restYWorld = minY * BLOCK_SIZE_MEDIUM;
    const wWorld     = (maxX - minX + 1) * BLOCK_SIZE_MEDIUM;
    const hWorld     = (maxY - minY + 1) * BLOCK_SIZE_MEDIUM;

    // Reserve a wall slot for this group (bounding-box AABB — used by the
    // movement system so the player can stand on the group).
    let wallIndex = -1;
    if (world.wallCount < MAX_WALLS) {
      wallIndex = world.wallCount++;
      world.wallXWorld[wallIndex]              = restXWorld;
      world.wallYWorld[wallIndex]              = restYWorld;
      world.wallWWorld[wallIndex]              = wWorld;
      world.wallHWorld[wallIndex]              = hWorld;
      world.wallIsPlatformFlag[wallIndex]      = 0;
      world.wallPlatformEdge[wallIndex]        = 0;
      world.wallThemeIndex[wallIndex]          = WALL_THEME_DEFAULT_INDEX;
      world.wallSoundHardnessIndex[wallIndex]  = resolveWallSoundHardnessIndex(room, undefined);
      // Falling block groups render through renderFallingBlocks(). This wall
      // slot exists only for broad collision/movement integration and must
      // stay invisible or the group's bounding box will be drawn as terrain.
      world.wallIsInvisibleFlag[wallIndex]     = 1;
      world.wallRampOrientationIndex[wallIndex]    = 255;
      world.wallIsPillarHalfWidthFlag[wallIndex]   = 0;
      world.wallIsBouncePadFlag[wallIndex]         = 0;
      world.wallBouncePadSpeedFactorIndex[wallIndex] = 0;
      world.wallIsKineticBlockFlag[wallIndex] = 0;
      world.wallKineticBlockIndex[wallIndex]  = -1;
    }

    // Clamp to hard cap (editor/importer should enforce this, but be safe)
    const tileCount = Math.min(component.length, MAX_TILES_PER_GROUP);

    // Allocate exact-size arrays so collision shape matches rendered shape.
    const tileRelXWorld = new Float32Array(tileCount);
    const tileRelYWorld = new Float32Array(tileCount);
    const colliderRelXWorld = new Float32Array(tileCount);
    const colliderRelYWorld = new Float32Array(tileCount);
    const colliderWWorld    = new Float32Array(tileCount);
    const colliderHWorld    = new Float32Array(tileCount);

    for (let ti = 0; ti < tileCount; ti++) {
      const relX = (component[ti].xBlock - minX) * BLOCK_SIZE_MEDIUM;
      const relY = (component[ti].yBlock - minY) * BLOCK_SIZE_MEDIUM;
      tileRelXWorld[ti] = relX;
      tileRelYWorld[ti] = relY;
      colliderRelXWorld[ti] = relX;
      colliderRelYWorld[ti] = relY;
      colliderWWorld[ti]    = BLOCK_SIZE_MEDIUM;
      colliderHWorld[ti]    = BLOCK_SIZE_MEDIUM;
    }

    const group: FallingBlockGroup = {
      groupId:               nextGroupId++,
      variant:               tile.variant as FallingBlockVariant,
      restXWorld,
      restYWorld,
      wWorld,
      hWorld,
      tileCount,
      tileRelXWorld,
      tileRelYWorld,
      colliderRectCount:     tileCount,
      colliderRelXWorld,
      colliderRelYWorld,
      colliderWWorld,
      colliderHWorld,
      offsetYWorld:          0,
      velocityYWorld:        0,
      shakeOffsetXWorld:     0,
      state:                 0, // FB_STATE_IDLE_STABLE
      stateTimerTicks:       0,
      hasReachedTopSpeedFlag: 0,
      crumbleTimerTicks:     0,
      lastLandingContactCount: 0,
      lastLandingContactX1World: new Float32Array(MAX_LANDING_CONTACTS),
      lastLandingContactX2World: new Float32Array(MAX_LANDING_CONTACTS),
      lastLandingContactYWorld:  new Float32Array(MAX_LANDING_CONTACTS),
      wallIndex,
      lastTriggerType:       0,
    };

    world.fallingBlockGroups.push(group);
  }
}
