/**
 * blockWallLayoutCache.ts — Wall occupancy grid and layout cache for the
 * auto-tiling block sprite renderer.
 *
 * Extracted from blockSpriteRenderer.ts so that the sprite-drawing logic and
 * the wall-geometry bookkeeping live in separate, focused modules.
 *
 * Exported symbols are used exclusively by blockSpriteRenderer.ts.
 */

import { WallSnapshot } from '../snapshot';
import type { BlockTheme } from '../../levels/roomDef';
import { indexToBlockTheme, WALL_THEME_DEFAULT_INDEX } from '../../levels/roomDef';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CachedTileCoord {
  readonly key: string;
  readonly col: number;
  readonly row: number;
  /** platformEdge for platform tiles: 0=top, 1=bottom, 2=left, 3=right. Only meaningful for platformTiles. */
  readonly platformEdge: number;
}

export interface RampWallInfo {
  readonly wallIndex: number;
}

export interface HalfPillarWallInfo {
  readonly wallIndex: number;
}

export interface CachedWallLayout {
  signature: string;
  blockSizePx: number;
  occupied: Set<string>;
  platformOccupied: Set<string>;
  occupiedTiles: CachedTileCoord[];
  platformTiles: CachedTileCoord[];
  /** Ramp walls (rampOrientationIndex !== 255): rendered as filled triangles. */
  rampWalls: RampWallInfo[];
  /** Half-pillar walls (isPillarHalfWidthFlag === 1): rendered narrow. */
  halfPillarWalls: HalfPillarWallInfo[];
  /** Per-tile theme: maps tile key → BlockTheme (null = use room default). */
  tileTheme: Map<string, BlockTheme | null>;
  /**
   * Per-(room-size × direction × blockers) cache of computed ambient depths.
   * Keyed by `"widthxheight|direction|blockerSig"` so a room that keeps the
   * same wall layout but toggles ambient direction or blocker edits reuses
   * the same outer layout cache.
   */
  ambientDepthsByKey: Map<string, Map<string, number>>;
  /**
   * Maps top-left tile key of each 2×2 solid wall to its wall theme index.
   * Computed once per layout and reused across frames to avoid per-frame Map allocation.
   */
  solid2x2Map: Map<string, number>;
}

// ── Module-level layout cache ─────────────────────────────────────────────────

let _cachedWallLayout: CachedWallLayout | null = null;

// ── Tile-key helpers ──────────────────────────────────────────────────────────

/** Returns the string key for a tile grid coordinate. */
export function wallTileKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Returns true if the cell at (col, row) is occupied by a solid wall block. */
export function isWallOccupied(occupied: Set<string>, col: number, row: number): boolean {
  return occupied.has(wallTileKey(col, row));
}

// ── 2×2 solid block map ───────────────────────────────────────────────────────

/** Builds the 2×2 solid-wall top-left map from raw wall data. Called once per layout build. */
function _buildSolid2x2Map(walls: WallSnapshot, blockSizePx: number): Map<string, number> {
  const topLeftMap = new Map<string, number>();
  if (blockSizePx !== 8) return topLeftMap;

  for (let wi = 0; wi < walls.count; wi++) {
    if (walls.isPlatformFlag[wi] === 1) continue;
    if (walls.isInvisibleFlag[wi] === 1) continue;
    // Ramp walls are rendered by the ramp path (triangles/sprites), never as solid 2×2 blocks.
    if (walls.rampOrientationIndex[wi] !== 255) continue;
    // Half-pillar walls are rendered by the half-pillar path, never as solid 2×2 blocks.
    if (walls.isPillarHalfWidthFlag[wi] === 1) continue;

    const colStart = Math.floor(walls.xWorld[wi] / blockSizePx);
    const rowStart = Math.floor(walls.yWorld[wi] / blockSizePx);
    const colCount = Math.max(0, Math.ceil((walls.xWorld[wi] + walls.wWorld[wi]) / blockSizePx) - colStart);
    const rowCount = Math.max(0, Math.ceil((walls.yWorld[wi] + walls.hWorld[wi]) / blockSizePx) - rowStart);
    // Skip zero-dimension walls (e.g. destroyed crumble/breakable blocks).
    if (colCount === 0 || rowCount === 0) continue;
    // Tile the wall into non-overlapping 2×2 sub-blocks. Any trailing
    // odd column or row falls through to the 1×1 rendering path because
    // those cells are never added to _coveredBy2x2Keys.
    for (let r = 0; r + 1 < rowCount; r += 2) {
      for (let c = 0; c + 1 < colCount; c += 2) {
        topLeftMap.set(wallTileKey(colStart + c, rowStart + r), walls.themeIndex[wi]);
      }
    }
  }

  return topLeftMap;
}

// ── Layout cache builder ──────────────────────────────────────────────────────

/**
 * Builds and caches occupancy data from wall AABBs in world-space tile coordinates.
 *
 * Using world-space coordinates (instead of screen-space) ensures the tile
 * grid is stable — blocks translate smoothly with the camera offset rather
 * than snapping to screen-aligned grid positions.
 */
export function getWallLayoutCache(
  walls: WallSnapshot,
  blockSizePx: number,
): CachedWallLayout {
  let signature = `${blockSizePx}|${walls.count}`;
  for (let wi = 0; wi < walls.count; wi++) {
    // Invisible walls (e.g. falling-block collision slots) are never rendered
    // as visible geometry, so they must not contribute to the visible-layout
    // signature.  Excluding them prevents moving invisible walls from
    // invalidating the baked wall sprite cache every frame while a block falls.
    if (walls.isInvisibleFlag[wi] === 1) continue;
    signature += `|${walls.xWorld[wi]},${walls.yWorld[wi]},${walls.wWorld[wi]},${walls.hWorld[wi]},${walls.isPlatformFlag[wi]},${walls.platformEdge[wi]},${walls.themeIndex[wi]},${walls.rampOrientationIndex[wi]},${walls.isPillarHalfWidthFlag[wi]}`;
  }

  if (_cachedWallLayout !== null &&
      _cachedWallLayout.signature === signature &&
      _cachedWallLayout.blockSizePx === blockSizePx) {
    return _cachedWallLayout;
  }

  const occupied = new Set<string>();
  const platformOccupied = new Set<string>();
  const platformEdgeByKey = new Map<string, number>();
  const tileTheme = new Map<string, BlockTheme | null>();
  const rampWalls: RampWallInfo[] = [];
  const halfPillarWalls: HalfPillarWallInfo[] = [];

  for (let wi = 0; wi < walls.count; wi++) {
    // Skip invisible boundary walls
    if (walls.isInvisibleFlag[wi] === 1) continue;

    // Ramp walls render as triangles — skip them from the regular tile grid
    if (walls.rampOrientationIndex[wi] !== 255) {
      rampWalls.push({ wallIndex: wi });
      continue;
    }

    const colStart = Math.floor(walls.xWorld[wi] / blockSizePx);
    const rowStart = Math.floor(walls.yWorld[wi] / blockSizePx);
    const colCount = Math.max(0, Math.ceil((walls.xWorld[wi] + walls.wWorld[wi]) / blockSizePx) - colStart);
    const rowCount = Math.max(0, Math.ceil((walls.yWorld[wi] + walls.hWorld[wi]) / blockSizePx) - rowStart);

    // Skip zero-dimension walls (e.g. destroyed crumble/breakable blocks).
    if (colCount === 0 || rowCount === 0) continue;

    const wallTheme: BlockTheme | null = walls.themeIndex[wi] !== WALL_THEME_DEFAULT_INDEX
      ? indexToBlockTheme(walls.themeIndex[wi])
      : null;

    // Half-pillar walls: add to normal occupied for lighting/neighbor purposes but
    // record for separate narrow rendering.
    const isHalfPillar = walls.isPillarHalfWidthFlag[wi] === 1;
    if (isHalfPillar) {
      halfPillarWalls.push({ wallIndex: wi });
      // Add to occupied so neighbor detection works; these tiles still block movement.
      for (let r = 0; r < rowCount; r++) {
        for (let c = 0; c < colCount; c++) {
          occupied.add(wallTileKey(colStart + c, rowStart + r));
        }
      }
      if (wallTheme !== null) {
        for (let r = 0; r < rowCount; r++) {
          for (let c = 0; c < colCount; c++) {
            tileTheme.set(wallTileKey(colStart + c, rowStart + r), wallTheme);
          }
        }
      }
      continue;
    }

    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        const col = colStart + c;
        const row = rowStart + r;
        const key = wallTileKey(col, row);
        if (walls.isPlatformFlag[wi] === 1) {
          platformOccupied.add(key);
          platformEdgeByKey.set(key, walls.platformEdge[wi]);
        } else {
          occupied.add(key);
        }
        if (wallTheme !== null) {
          tileTheme.set(key, wallTheme);
        }
      }
    }
  }

  const occupiedTiles: CachedTileCoord[] = [];
  for (const key of occupied) {
    const commaIdx = key.indexOf(',');
    occupiedTiles.push({
      key,
      col: parseInt(key.slice(0, commaIdx), 10),
      row: parseInt(key.slice(commaIdx + 1), 10),
      platformEdge: 0,
    });
  }

  const platformTiles: CachedTileCoord[] = [];
  for (const key of platformOccupied) {
    const commaIdx = key.indexOf(',');
    platformTiles.push({
      key,
      col: parseInt(key.slice(0, commaIdx), 10),
      row: parseInt(key.slice(commaIdx + 1), 10),
      platformEdge: platformEdgeByKey.get(key) ?? 0,
    });
  }

  _cachedWallLayout = {
    signature,
    blockSizePx,
    occupied,
    platformOccupied,
    occupiedTiles,
    platformTiles,
    rampWalls,
    halfPillarWalls,
    tileTheme,
    ambientDepthsByKey: new Map<string, Map<string, number>>(),
    solid2x2Map: _buildSolid2x2Map(walls, blockSizePx),
  };

  return _cachedWallLayout;
}
