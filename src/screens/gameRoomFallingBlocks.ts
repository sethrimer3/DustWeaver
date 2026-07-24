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
import { SURFACE_RIM_STYLE_INDEX_DEFAULT } from '../render/walls/surfaceRimStyle';
import { MAX_TILES_PER_GROUP, MAX_LANDING_CONTACTS, type FallingBlockGroup } from '../sim/fallingBlocks/fallingBlockTypes';
import { resolveWallSoundHardnessIndex } from './gameRoom';

/**
 * Converts editor-placed falling block tiles into runtime FallingBlockGroup
 * objects, reserving exact-footprint wall slots per group in the world wall
 * arrays.
 *
 * Algorithm:
 *  1. Collect all tile positions by variant + block theme.
 *  2. Run a flood-fill (BFS) to find orthogonally-connected components of the
 *     same variant and theme — each component becomes one group.
 *  3. For each group, compute the bounding box (used only for broad-phase
 *     culling and dust placement) plus one wall slot per exact horizontal run
 *     of occupied tiles per row (see `mergeOccupiedRowRuns`), so holes in
 *     concave/irregular shapes never gain collision.
 *
 * Must be called AFTER loadRoomWalls so wall slots start past the static geometry.
 */
export function loadRoomFallingBlocks(world: WorldState, room: RoomDef): void {
  world.fallingBlockGroups = [];

  const tileDefs = room.fallingBlocks ?? [];
  if (tileDefs.length === 0) return;

  // Build a tile lookup by "x,y" key
  type TileEntry = { xBlock: number; yBlock: number; variant: string; blockTheme: string | null };
  const tileMap = new Map<string, TileEntry>();
  for (const t of tileDefs) {
    tileMap.set(`${t.xBlock},${t.yBlock}`, {
      xBlock: t.xBlock,
      yBlock: t.yBlock,
      variant: t.variant,
      blockTheme: t.blockTheme ?? null,
    });
  }

  const visited = new Set<string>();
  let nextGroupId = 0;

  for (const [, tile] of tileMap) {
    const startKey = `${tile.xBlock},${tile.yBlock}`;
    if (visited.has(startKey)) continue;

    // BFS to collect the orthogonally-connected component of the same
    // variant AND block theme (a differently-themed tile is a visually
    // distinct structure and must not silently merge into this one).
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
        if (nbTile === undefined || nbTile.variant !== tile.variant || nbTile.blockTheme !== tile.blockTheme) continue;
        visited.add(nk);
        queue.push(nbTile);
      }
    }

    // Compute bounding box of the component (broad-phase / dust placement only —
    // NEVER used as a solid collider; see wall-slot reservation below).
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

    // Clamp to hard cap (editor/importer should enforce this, but be safe)
    const tileCount = Math.min(component.length, MAX_TILES_PER_GROUP);

    // Allocate exact-size arrays so collision shape matches rendered shape.
    const tileRelXWorld = new Float32Array(tileCount);
    const tileRelYWorld = new Float32Array(tileCount);
    const colliderRelXWorld = new Float32Array(tileCount);
    const colliderRelYWorld = new Float32Array(tileCount);
    const colliderWWorld    = new Float32Array(tileCount);
    const colliderHWorld    = new Float32Array(tileCount);

    const occupiedXBlock = new Int32Array(tileCount);
    const occupiedYBlock = new Int32Array(tileCount);

    for (let ti = 0; ti < tileCount; ti++) {
      const relX = (component[ti].xBlock - minX) * BLOCK_SIZE_MEDIUM;
      const relY = (component[ti].yBlock - minY) * BLOCK_SIZE_MEDIUM;
      tileRelXWorld[ti] = relX;
      tileRelYWorld[ti] = relY;
      colliderRelXWorld[ti] = relX;
      colliderRelYWorld[ti] = relY;
      colliderWWorld[ti]    = BLOCK_SIZE_MEDIUM;
      colliderHWorld[ti]    = BLOCK_SIZE_MEDIUM;
      occupiedXBlock[ti] = component[ti].xBlock - minX;
      occupiedYBlock[ti] = component[ti].yBlock - minY;
    }

    // Reserve exact-footprint wall slots: merge occupied tiles into horizontal
    // runs per row so a real hole in the shape never gets a solid collider,
    // while still using far fewer wall slots than one-per-tile.
    const runs = mergeOccupiedRowRuns(occupiedXBlock, occupiedYBlock);
    const wallSlotCount = runs.length;
    const wallIndices = new Int32Array(wallSlotCount).fill(-1);
    const wallSlotRelXWorld = new Float32Array(wallSlotCount);
    const wallSlotRelYWorld = new Float32Array(wallSlotCount);
    const wallSlotWWorld    = new Float32Array(wallSlotCount);
    const wallSlotHWorld    = new Float32Array(wallSlotCount);

    for (let ri = 0; ri < runs.length; ri++) {
      const run = runs[ri];
      const relX = run.xBlock * BLOCK_SIZE_MEDIUM;
      const relY = run.yBlock * BLOCK_SIZE_MEDIUM;
      const w    = run.lengthBlocks * BLOCK_SIZE_MEDIUM;
      const h    = BLOCK_SIZE_MEDIUM;
      wallSlotRelXWorld[ri] = relX;
      wallSlotRelYWorld[ri] = relY;
      wallSlotWWorld[ri]    = w;
      wallSlotHWorld[ri]    = h;

      if (world.wallCount < MAX_WALLS) {
        const wallIndex = world.wallCount++;
        wallIndices[ri] = wallIndex;
        world.wallXWorld[wallIndex]              = restXWorld + relX;
        world.wallYWorld[wallIndex]              = restYWorld + relY;
        world.wallWWorld[wallIndex]              = w;
        world.wallHWorld[wallIndex]              = h;
        world.wallIsPlatformFlag[wallIndex]      = 0;
        world.wallPlatformEdge[wallIndex]        = 0;
        world.wallThemeIndex[wallIndex]          = WALL_THEME_DEFAULT_INDEX;
        world.wallSurfaceRimStyleIndex[wallIndex] = SURFACE_RIM_STYLE_INDEX_DEFAULT;
        world.wallSoundHardnessIndex[wallIndex]  = resolveWallSoundHardnessIndex(room, undefined);
        // Falling block groups render through renderFallingBlocks(). These wall
        // slots exist only for collision/movement integration and must stay
        // invisible or the group's footprint will be drawn again as terrain.
        world.wallIsInvisibleFlag[wallIndex]     = 1;
        world.wallRampOrientationIndex[wallIndex]    = 255;
        world.wallIsPillarHalfWidthFlag[wallIndex]   = 0;
        world.wallIsBouncePadFlag[wallIndex]         = 0;
        world.wallBouncePadSpeedFactorIndex[wallIndex] = 0;
        world.wallIsKineticBlockFlag[wallIndex] = 0;
        world.wallKineticBlockIndex[wallIndex]  = -1;
      }
    }

    const group: FallingBlockGroup = {
      groupId:               nextGroupId++,
      variant:               tile.variant as FallingBlockVariant,
      blockThemeId:          tile.blockTheme,
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
      wallSlotCount,
      wallIndices,
      wallSlotRelXWorld,
      wallSlotRelYWorld,
      wallSlotWWorld,
      wallSlotHWorld,
      lastTriggerType:       0,
    };

    world.fallingBlockGroups.push(group);
  }
}

/** One exact merged horizontal run of occupied tiles within a single row. */
interface OccupiedRowRun {
  /** Local block-column of the run's left edge (relative to the group's minX). */
  xBlock: number;
  /** Local block-row (relative to the group's minY). */
  yBlock: number;
  /** Number of contiguous occupied tiles in this run. */
  lengthBlocks: number;
}

/**
 * Merge a set of occupied local tile coordinates into exact horizontal runs —
 * one rect per contiguous stretch of occupied tiles in each row. This never
 * fills a hole and never spans an empty cell, unlike a bounding-box AABB.
 */
function mergeOccupiedRowRuns(xBlocks: Int32Array, yBlocks: Int32Array): OccupiedRowRun[] {
  // Group tile x-coordinates by row.
  const rowToXs = new Map<number, number[]>();
  for (let i = 0; i < xBlocks.length; i++) {
    const y = yBlocks[i];
    let xs = rowToXs.get(y);
    if (xs === undefined) { xs = []; rowToXs.set(y, xs); }
    xs.push(xBlocks[i]);
  }

  const runs: OccupiedRowRun[] = [];
  for (const [y, xs] of rowToXs) {
    xs.sort((a, b) => a - b);
    let runStart = xs[0];
    let runPrev = xs[0];
    for (let i = 1; i <= xs.length; i++) {
      const x = i < xs.length ? xs[i] : null;
      if (x !== null && x === runPrev + 1) {
        runPrev = x;
        continue;
      }
      runs.push({ xBlock: runStart, yBlock: y, lengthBlocks: runPrev - runStart + 1 });
      if (x !== null) { runStart = x; runPrev = x; }
    }
  }
  return runs;
}
