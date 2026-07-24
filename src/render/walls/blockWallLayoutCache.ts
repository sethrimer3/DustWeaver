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
import { CHUNK_SIZE_BLOCKS } from './chunkRenderCache';
import * as FP from '../../debug/perfFreezeProfiler';
import { buildSurfaceExposureMap, type SurfaceExposureMap, type TileSolidityGrid } from '../../sim/world/surfaceExposure';
import { isPlainRectOrientationIndex } from '../../levels/stairsGeometry';
import { type SurfaceRimStyle, SURFACE_RIM_STYLE_INDEX_DEFAULT } from './surfaceRimStyle';

// ── Fast layout signature hash ─────────────────────────────────────────────────

/**
 * Computes a cheap wall-layout signature using a Knuth multiplicative hash.
 *
 * Instead of building a multi-kilobyte string via repeated `+=` for every
 * wall every frame, we fold the wall data into a single 32-bit integer using
 * `Math.imul` (hardware 32-bit multiply). The result is encoded as
 * `"${visibleCount}|${hash32}"` — compact, fast, and collision-resistant
 * enough for frame-level invalidation.
 *
 * Moving invisible falling-block slots are excluded (same exclusion as before)
 * to prevent spurious cache misses while blocks fall.
 */
function _computeLayoutSignature(walls: WallSnapshot, blockSizePx: number): string {
  let h = (blockSizePx * 31 + walls.count) | 0;
  let visible = 0;
  for (let wi = 0; wi < walls.count; wi++) {
    if (walls.isInvisibleFlag[wi] === 1) continue;
    visible++;
    // Fold 5 fields (x, y, w, h, flags) into h using cheap imul chaining.
    h = Math.imul(h, 1664525) + 1013904223 | 0;
    h = h ^ (walls.xWorld[wi] | 0);
    h = Math.imul(h, 1664525) + 1013904223 | 0;
    h = h ^ (walls.yWorld[wi] | 0);
    h = Math.imul(h, 1664525) + 1013904223 | 0;
    h = h ^ ((walls.wWorld[wi] | 0) + (walls.hWorld[wi] << 16) | 0);
    h = Math.imul(h, 1664525) + 1013904223 | 0;
    h = h ^ (
      (walls.isPlatformFlag[wi])        |
      (walls.platformEdge[wi]      << 1) |
      (walls.themeIndex[wi]        << 3) |
      // Full orientation index, not just an "is shaped" bit: a stair and a ramp
      // occupying the same rect must produce different layout signatures.
      (walls.rampOrientationIndex[wi]  << 11) |
      (walls.isPillarHalfWidthFlag[wi] << 20)
    );
    // Rim style edits must invalidate the layout cache too — fold the index
    // in separately (it doesn't fit the bitpacked word above: values can
    // exceed its remaining bit budget once a room has many distinct styles).
    h = Math.imul(h, 1664525) + 1013904223 | 0;
    h = h ^ (walls.surfaceRimStyleIndex[wi] | 0);
  }
  return `${visible}|${h >>> 0}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CachedTileCoord {
  readonly key: string;
  readonly col: number;
  readonly row: number;
  /** platformEdge for platform tiles: 0=top, 1=bottom, 2=left, 3=right. Only meaningful for platformTiles. */
  readonly platformEdge: number;
}

/**
 * A wall whose solid area is not its full bounding rectangle — stairs, or a
 * legacy ramp.  Rendered by `renderShapedWallPass` from the shape's template
 * mask instead of via the regular tile grid.
 */
export interface ShapedWallInfo {
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
  /** Shaped walls (stairs, legacy ramps): rendered from their template mask. */
  shapedWalls: ShapedWallInfo[];
  /** Half-pillar walls (isPillarHalfWidthFlag === 1): rendered narrow. */
  halfPillarWalls: HalfPillarWallInfo[];
  /** Per-tile theme: maps tile key → BlockTheme (null = use room default). */
  tileTheme: Map<string, BlockTheme | null>;
  /**
   * Per-tile Surface Rim style: maps tile key → SurfaceRimStyle, only for
   * tiles belonging to a wall with a non-default style (mirrors `tileTheme`).
   * Absence (no map entry) means "use the default exposed-edge presentation".
   */
  tileSurfaceRim: Map<string, SurfaceRimStyle>;
  /**
   * Authoritative tile-level open-air exposure, built from the same
   * `occupied` set above but room-bounds aware (out-of-bounds neighbours
   * never count as open air — unlike the raw N/E/S/W `isWallOccupied`
   * checks the tile passes used before this was added). This is the single
   * source of truth for "which sides of this tile are exposed"; the 1×1 and
   * 2×2 wall tile passes read it via `getSurfaceMaskAtTile` instead of
   * re-deriving exposure from `occupied` themselves.
   */
  surfaceExposureMap: SurfaceExposureMap;
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

  // ── Per-chunk buckets (BUILD 288) ───────────────────────────────────────────
  // Pre-bucketed tile/wall lists keyed by chunk coordinates "${cx},${cy}"
  // (where cx = Math.floor(col / CHUNK_SIZE_BLOCKS)).
  //
  // These allow each wall tile pass to iterate only the items that overlap a
  // specific chunk, making chunk rebuilds O(items-in-chunk) instead of
  // O(all-room-tiles).  Items that straddle a chunk boundary are included in
  // every overlapping chunk's list.

  /** 1×1 occupied tiles grouped by chunk key. */
  occupiedByChunkKey: Map<string, CachedTileCoord[]>;
  /** Platform tiles grouped by chunk key. */
  platformByChunkKey: Map<string, CachedTileCoord[]>;
  /** Shaped walls grouped by every chunk they overlap. */
  shapedByChunkKey: Map<string, ShapedWallInfo[]>;
  /** Half-pillar walls grouped by every chunk they overlap. */
  halfPillarByChunkKey: Map<string, HalfPillarWallInfo[]>;
  /**
   * 2×2 solid-wall top-left entries grouped by every chunk the 2×2 block
   * overlaps (up to 4 chunks at a chunk-boundary corner).
   * Each entry is [topLeftKey, wallThemeIndex].
   */
  solid2x2ByChunkKey: Map<string, Array<readonly [string, number]>>;
}

// ── Module-level layout cache ─────────────────────────────────────────────────

let _cachedWallLayout: CachedWallLayout | null = null;

// ── Prewarm layout helpers ────────────────────────────────────────────────────

/**
 * Returns the currently cached wall layout, or null if none has been built yet.
 *
 * Used by the render chunk prewarmer to save the active room's layout before
 * temporarily computing an adjacent room's layout, so it can be restored
 * afterward without forcing a full layout rebuild on the next render frame.
 */
export function getCurrentWallLayout(): CachedWallLayout | null {
  return _cachedWallLayout;
}

/**
 * Installs a pre-built layout into the module-level cache slot, bypassing
 * the normal signature check.
 *
 * Used by the render chunk prewarmer to:
 *   1. Restore the active room's layout after a prewarm pass.
 *   2. Pre-install an adjacent room's layout before room entry so the first
 *      `renderVisibleChunks` call does not trigger full chunk invalidation.
 */
export function setPrebuiltWallLayout(layout: CachedWallLayout): void {
  _cachedWallLayout = layout;
}

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
    // Shaped walls (stairs, legacy ramps) are drawn from their template mask by
    // the shaped-wall path, never as solid 2×2 blocks.
    if (!isPlainRectOrientationIndex(walls.rampOrientationIndex[wi])) continue;
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
  widthBlocks: number,
  heightBlocks: number,
): CachedWallLayout {
  const _sigT0 = import.meta.env?.DEV ? performance.now() : 0;
  const signature = `${widthBlocks}x${heightBlocks}|${_computeLayoutSignature(walls, blockSizePx)}`;
  const _sigMs = import.meta.env?.DEV ? performance.now() - _sigT0 : 0;

  if (_cachedWallLayout !== null &&
      _cachedWallLayout.signature === signature &&
      _cachedWallLayout.blockSizePx === blockSizePx) {
    if (import.meta.env?.DEV) FP.recordLayoutWork(_sigMs, 0, walls.count);
    return _cachedWallLayout;
  }

  const _rebuildT0 = import.meta.env?.DEV ? performance.now() : 0;

  const occupied = new Set<string>();
  const platformOccupied = new Set<string>();
  const platformEdgeByKey = new Map<string, number>();
  const tileTheme = new Map<string, BlockTheme | null>();
  const tileSurfaceRim = new Map<string, SurfaceRimStyle>();
  const shapedWalls: ShapedWallInfo[] = [];
  const halfPillarWalls: HalfPillarWallInfo[] = [];

  for (let wi = 0; wi < walls.count; wi++) {
    // Skip invisible boundary walls
    if (walls.isInvisibleFlag[wi] === 1) continue;

    // Shaped walls (stairs, legacy ramps) render from their template mask —
    // skip them from the regular tile grid.
    if (!isPlainRectOrientationIndex(walls.rampOrientationIndex[wi])) {
      shapedWalls.push({ wallIndex: wi });
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
    const rimIdx = walls.surfaceRimStyleIndex[wi];
    const wallRimStyle: SurfaceRimStyle | null = rimIdx !== SURFACE_RIM_STYLE_INDEX_DEFAULT
      ? (walls.surfaceRimStyleTable[rimIdx] ?? null)
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
      if (wallRimStyle !== null) {
        for (let r = 0; r < rowCount; r++) {
          for (let c = 0; c < colCount; c++) {
            tileSurfaceRim.set(wallTileKey(colStart + c, rowStart + r), wallRimStyle);
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
        if (wallRimStyle !== null) {
          tileSurfaceRim.set(key, wallRimStyle);
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

  // Wrap the already-computed `occupied` set as a TileSolidityGrid — this
  // reuses the exact same solidity data the rest of this cache uses (no
  // re-decomposition of wall AABBs), just adds room-bounds awareness so
  // out-of-bounds neighbours are never treated as open air.
  const solidityGrid: TileSolidityGrid = {
    widthBlocks,
    heightBlocks,
    blockSizePx,
    isSolidAt: (col: number, row: number): boolean => occupied.has(wallTileKey(col, row)),
  };
  const surfaceExposureMap = buildSurfaceExposureMap(solidityGrid);

  _cachedWallLayout = {
    signature,
    blockSizePx,
    occupied,
    platformOccupied,
    occupiedTiles,
    platformTiles,
    shapedWalls,
    halfPillarWalls,
    tileTheme,
    tileSurfaceRim,
    surfaceExposureMap,
    ambientDepthsByKey: new Map<string, Map<string, number>>(),
    solid2x2Map: _buildSolid2x2Map(walls, blockSizePx),
    occupiedByChunkKey:   new Map(),
    platformByChunkKey:   new Map(),
    shapedByChunkKey:       new Map(),
    halfPillarByChunkKey: new Map(),
    solid2x2ByChunkKey:   new Map(),
  };

  // Build per-chunk buckets AFTER all arrays are populated so the bucket maps
  // reflect the final state and chunk rebuilds are O(items-in-chunk).
  _buildChunkBuckets(_cachedWallLayout, walls);

  if (import.meta.env?.DEV) FP.recordLayoutWork(_sigMs, performance.now() - _rebuildT0, walls.count);

  return _cachedWallLayout;
}

// ── Per-chunk bucket builder ───────────────────────────────────────────────────

/**
 * Populates the five `*ByChunkKey` bucket maps on `layout`.
 *
 * Called once per layout cache rebuild.  After this, each wall tile pass can
 * look up pre-bucketed items by chunk key instead of scanning the full arrays.
 *
 * Items that straddle a chunk boundary are included in every overlapping
 * chunk's list so every affected chunk renders them correctly.
 */
function _buildChunkBuckets(layout: CachedWallLayout, walls: WallSnapshot): void {
  const BSZ = layout.blockSizePx;

  // ── 1×1 occupied tiles: each tile belongs to exactly one chunk ─────────────
  for (const tile of layout.occupiedTiles) {
    const ck = `${Math.floor(tile.col / CHUNK_SIZE_BLOCKS)},${Math.floor(tile.row / CHUNK_SIZE_BLOCKS)}`;
    let arr = layout.occupiedByChunkKey.get(ck);
    if (arr === undefined) { arr = []; layout.occupiedByChunkKey.set(ck, arr); }
    arr.push(tile);
  }

  // ── Platform tiles: same as occupied tiles ─────────────────────────────────
  for (const tile of layout.platformTiles) {
    const ck = `${Math.floor(tile.col / CHUNK_SIZE_BLOCKS)},${Math.floor(tile.row / CHUNK_SIZE_BLOCKS)}`;
    let arr = layout.platformByChunkKey.get(ck);
    if (arr === undefined) { arr = []; layout.platformByChunkKey.set(ck, arr); }
    arr.push(tile);
  }

  // ── Shaped walls: may span multiple tile-columns/rows → multiple chunks ─────
  for (const shapedInfo of layout.shapedWalls) {
    const wi = shapedInfo.wallIndex;
    const colFirst = Math.floor(walls.xWorld[wi] / BSZ);
    const rowFirst = Math.floor(walls.yWorld[wi] / BSZ);
    const colLast  = Math.max(colFirst, Math.ceil((walls.xWorld[wi] + walls.wWorld[wi]) / BSZ) - 1);
    const rowLast  = Math.max(rowFirst, Math.ceil((walls.yWorld[wi] + walls.hWorld[wi]) / BSZ) - 1);
    const cxMin = Math.floor(colFirst / CHUNK_SIZE_BLOCKS);
    const cxMax = Math.floor(colLast  / CHUNK_SIZE_BLOCKS);
    const cyMin = Math.floor(rowFirst / CHUNK_SIZE_BLOCKS);
    const cyMax = Math.floor(rowLast  / CHUNK_SIZE_BLOCKS);
    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const ck = `${cx},${cy}`;
        let arr = layout.shapedByChunkKey.get(ck);
        if (arr === undefined) { arr = []; layout.shapedByChunkKey.set(ck, arr); }
        arr.push(shapedInfo);
      }
    }
  }

  // ── Half-pillar walls: same multi-chunk logic as shaped walls ──────────────
  for (const hpInfo of layout.halfPillarWalls) {
    const wi = hpInfo.wallIndex;
    const colFirst = Math.floor(walls.xWorld[wi] / BSZ);
    const rowFirst = Math.floor(walls.yWorld[wi] / BSZ);
    const colLast  = Math.max(colFirst, Math.ceil((walls.xWorld[wi] + walls.wWorld[wi]) / BSZ) - 1);
    const rowLast  = Math.max(rowFirst, Math.ceil((walls.yWorld[wi] + walls.hWorld[wi]) / BSZ) - 1);
    const cxMin = Math.floor(colFirst / CHUNK_SIZE_BLOCKS);
    const cxMax = Math.floor(colLast  / CHUNK_SIZE_BLOCKS);
    const cyMin = Math.floor(rowFirst / CHUNK_SIZE_BLOCKS);
    const cyMax = Math.floor(rowLast  / CHUNK_SIZE_BLOCKS);
    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const ck = `${cx},${cy}`;
        let arr = layout.halfPillarByChunkKey.get(ck);
        if (arr === undefined) { arr = []; layout.halfPillarByChunkKey.set(ck, arr); }
        arr.push(hpInfo);
      }
    }
  }

  // ── 2×2 solid-wall blocks: top-left at (col, row) spans [col, col+1]×[row, row+1] ──
  // A 2×2 block can overlap up to 4 chunks when its top-left sits at a chunk corner.
  for (const [topLeftKey, themeIdx] of layout.solid2x2Map) {
    const ci  = topLeftKey.indexOf(',');
    const col = parseInt(topLeftKey.slice(0, ci), 10);
    const row = parseInt(topLeftKey.slice(ci + 1), 10);
    const cxMin = Math.floor( col      / CHUNK_SIZE_BLOCKS);
    const cxMax = Math.floor((col + 1) / CHUNK_SIZE_BLOCKS);
    const cyMin = Math.floor( row      / CHUNK_SIZE_BLOCKS);
    const cyMax = Math.floor((row + 1) / CHUNK_SIZE_BLOCKS);
    const entry = [topLeftKey, themeIdx] as const;
    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const ck = `${cx},${cy}`;
        let arr = layout.solid2x2ByChunkKey.get(ck);
        if (arr === undefined) { arr = []; layout.solid2x2ByChunkKey.set(ck, arr); }
        arr.push(entry);
      }
    }
  }
}
