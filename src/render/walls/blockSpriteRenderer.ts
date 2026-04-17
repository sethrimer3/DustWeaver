/**
 * Auto-tiling block sprite renderer.
 *
 * For every block cell (sized per the BLOCK_SIZE tier) in each wall rectangle, this module:
 *   1. Builds an occupancy grid (Set of "col,row" keys).
 *   2. Computes a 4-bit neighbor mask for each occupied cell.
 *   3. Selects one of six sprite variants (block, single, edge, corner, end,
 *      vertex) plus a canvas rotation to apply before drawing.
 *   4. Draws the sprite (or a solid-colour fallback if the image is not yet
 *      loaded) for every occupied tile.
 *
 * Sprites live in ASSETS/SPRITES/level/world_1/ and are served as static
 * assets via Vite's publicDir.  The image cache is module-level so each
 * sprite is loaded exactly once.
 *
 * No per-frame allocations in the hot draw path — the occupancy Set is
 * cleared and rebuilt each call (acceptable given MAX_WALLS = 64).
 */

import { WallSnapshot } from '../snapshot';
import type { BlockTheme, LightingEffect } from '../../levels/roomDef';
import { indexToBlockTheme, WALL_THEME_DEFAULT_INDEX } from '../../levels/roomDef';
import {
  getBlockSprite1x1,
  getBlockSprite2x2,
  getPlatformSprite1x1,
  getRampSprite,
} from './proceduralBlockSprite';

// ── Sprite loading ──────────────────────────────────────────────────────────

/** Module-level image cache — populated once, reused forever. */
const _imageCache = new Map<string, HTMLImageElement>();

function _loadImage(src: string): HTMLImageElement {
  const cached = _imageCache.get(src);
  if (cached !== undefined) return cached;
  const img = new Image();
  img.src = src;
  _imageCache.set(src, img);
  return img;
}

function isSpriteReady(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

/** Sprite set for a single world theme. */
interface BlockSpriteSet {
  block:  HTMLImageElement;
  single: HTMLImageElement;
  edge:   HTMLImageElement;
  corner: HTMLImageElement;
  end:    HTMLImageElement;
  vertex: HTMLImageElement;
}

// ── Block-theme sprite pre-loads ────────────────────────────────────────────

// Brown Rock sprites (single flat sprite, no auto-tiling variants)
const _brownRockSprite8 = _loadImage('SPRITES/BLOCKS/brownRock/brownRock_8x8.png');
const _brownRockSprite16 = _loadImage('SPRITES/BLOCKS/brownRock/brownRock_16x16.png');
const _brownRockSprite32 = _loadImage('SPRITES/BLOCKS/brownRock/brownRock_32x32.png');

// Dirt sprites (edge/corner auto-tiling at 8x8)
const _dirtBlockSprite = _loadImage('SPRITES/BLOCKS/dirt/dirt_8x8.png');
const _dirtEdgeSprite  = _loadImage('SPRITES/BLOCKS/dirt/dirt_8x8_edge.png');
const _dirtCornerSprite = _loadImage('SPRITES/BLOCKS/dirt/dirt_8x8_corner.png');
const _dirtSprite16 = _loadImage('SPRITES/BLOCKS/dirt/dirt_16x16.png');

/** Cache of loaded sprite sets keyed by worldNumber (for legacy world-number mode). */
const _spriteSets = new Map<number, BlockSpriteSet>();

/**
 * Returns the sprite set for a given world number, loading on first access.
 *
 * W-0, W-1, W-2 use simple filenames (block.png, corner.png, …).
 * W-3 through W-9 use prefixed filenames (world_N_block.png, …).
 */
function getBlockSpriteSet(worldNumber: number): BlockSpriteSet {
  const cached = _spriteSets.get(worldNumber);
  if (cached !== undefined) return cached;

  const dir = `SPRITES/WORLDS/W-${worldNumber}/blocks`;
  let sprites: BlockSpriteSet;
  if (worldNumber === 0) {
    sprites = {
      block:  _brownRockSprite8,
      single: _brownRockSprite8,
      edge:   _brownRockSprite8,
      corner: _brownRockSprite8,
      end:    _brownRockSprite8,
      vertex: _brownRockSprite8,
    };
  } else if (worldNumber <= 2) {
    sprites = {
      block:  _loadImage(`${dir}/block.png`),
      single: _loadImage(`${dir}/single.png`),
      edge:   _loadImage(`${dir}/edge.png`),
      corner: _loadImage(`${dir}/corner.png`),
      end:    _loadImage(`${dir}/end.png`),
      vertex: _loadImage(`${dir}/vertex.png`),
    };
  } else {
    const prefix = `world_${worldNumber}_block`;
    sprites = {
      block:  _loadImage(`${dir}/${prefix}.png`),
      single: _loadImage(`${dir}/${prefix}_single.png`),
      edge:   _loadImage(`${dir}/${prefix}_edge.png`),
      corner: _loadImage(`${dir}/${prefix}_corner.png`),
      end:    _loadImage(`${dir}/${prefix}_end.png`),
      vertex: _loadImage(`${dir}/${prefix}_vertex.png`),
    };
  }
  _spriteSets.set(worldNumber, sprites);
  return sprites;
}

/** Active sprite set for world-number mode. */
let _sprites: BlockSpriteSet = getBlockSpriteSet(0);
let _activeWorldNumber = 0;

/**
 * Active block theme.  When non-null, theme-based rendering overrides the
 * world-number-based sprite selection.
 */
let _activeBlockTheme: BlockTheme | null = null;
let _activeLightingEffect: LightingEffect = 'DEFAULT';
let _activeRoomWidthBlocks = 0;
let _activeRoomHeightBlocks = 0;

/**
 * Set the active world number for block sprite rendering.
 * Call this when the player enters a room without an explicit blockTheme.
 */
export function setActiveBlockSpriteWorld(worldNumber: number): void {
  _activeWorldNumber = worldNumber;
  _sprites = getBlockSpriteSet(worldNumber);
  _activeBlockTheme = null;
}

/**
 * Set the active block theme for rendering.
 * Overrides world-number-based sprite selection until setActiveBlockSpriteWorld is called.
 */
export function setActiveBlockSpriteTheme(theme: BlockTheme): void {
  _activeBlockTheme = theme;
}

/** Sets the active lighting model and room bounds used for block shading. */
export function setActiveBlockLighting(effect: LightingEffect, roomWidthBlocks: number, roomHeightBlocks: number): void {
  _activeLightingEffect = effect;
  _activeRoomWidthBlocks = roomWidthBlocks;
  _activeRoomHeightBlocks = roomHeightBlocks;
}

function _getBrownRockSpriteForBlockSize(blockSizePx: number): HTMLImageElement {
  if (blockSizePx >= 32) return _brownRockSprite32;
  if (blockSizePx >= 16) return _brownRockSprite16;
  return _brownRockSprite8;
}

function _getDirtSprite(variant: TileVariant): HTMLImageElement {
  switch (variant) {
    case 'edge':   return _dirtEdgeSprite;
    case 'corner': return _dirtCornerSprite;
    default:       return _dirtBlockSprite;
  }
}

/**
 * Returns the 2×2 full sprite for themes that use a single dedicated 16×16
 * texture (brownRock, dirt).
 */
function _getFullSpriteFor2x2(theme: BlockTheme | null, blockSizePx: number): HTMLImageElement | null {
  if (blockSizePx !== 8) return null;
  if (theme === 'brownRock') return _brownRockSprite16;
  if (theme === 'dirt') return _dirtSprite16;
  return null;
}

/** Returns true if the active theme supports 2×2 full-sprite rendering. */
function _themeSupports2x2(theme: BlockTheme | null, blockSizePx: number): boolean {
  if (blockSizePx !== 8) return false;
  return theme === 'brownRock' || theme === 'dirt' || theme === 'blackRock';
}

/**
 * Returns the sprite image for a non-blackRock block cell (brownRock, dirt)
 * based on the auto-tile variant.
 */
function _getSpriteForLegacyTheme(
  theme: BlockTheme,
  variant: TileVariant,
  blockSizePx: number,
): HTMLImageElement {
  switch (theme) {
    case 'brownRock':
      return _getBrownRockSpriteForBlockSize(blockSizePx);
    case 'dirt':
      return _getDirtSprite(variant);
    default:
      return _getBrownRockSpriteForBlockSize(blockSizePx);
  }
}

/**
 * Maps a BlockTheme to the material name string used by the procedural sprite
 * system.  Returns null when the theme is not supported by that system.
 */
function _themeToProceduralMaterial(theme: BlockTheme | null, legacyWorldNumber: number): string | null {
  if (theme === 'blackRock') return 'blackRock';
  if (theme === null && legacyWorldNumber === 0) return 'blackRock';
  return null;
}

// ── Tile-spec lookup table ───────────────────────────────────────────────────

type TileVariant = 'block' | 'single' | 'edge' | 'corner' | 'end';

interface TileSpec {
  readonly variant:     TileVariant;
  /** Canvas rotation in radians applied around the tile centre. */
  readonly rotationRad: number;
}

// Neighbor mask bit assignments: bit0=N, bit1=E, bit2=S, bit3=W
const _N = 1;
const _E = 2;
const _S = 4;
const _W = 8;
const _HALF_PI = Math.PI * 0.5;
const _PI      = Math.PI;

/**
 * 16-entry lookup table indexed by 4-bit neighbor mask.
 *
 * Sprite default orientations (rotation 0):
 *  - end:    cap opening faces north (south neighbor is connected)
 *  - corner: SW corner exposed (N+E solid, NE open → rotate 0 for S+W)
 *  - edge:   south face exposed (N+E+W solid)
 */
const _TILE_TABLE: TileSpec[] = ((): TileSpec[] => {
  const t: TileSpec[] = new Array(16);

  const set = (mask: number, variant: TileVariant, rotationRad: number): void => {
    t[mask] = { variant, rotationRad };
  };

  // 0 neighbors — isolated
  set(0,                 'single', 0);

  // 1 neighbor — end cap; default opening faces south (S is connected),
  // rotate to face the connected side.
  set(_S,                'end', 0);           // S solid → no rotation
  set(_N,                'end', _PI);          // N solid → 180°
  set(_E,                'end', -_HALF_PI);   // E solid → -90°
  set(_W,                'end', _HALF_PI);    // W solid → +90°

  // 2 opposite neighbors — treat as interior (tunnel)
  set(_N | _S,           'block', 0);
  set(_E | _W,           'block', 0);

  // 2 adjacent neighbors — corner; default: S+W solid, NE exposed
  set(_S | _W,           'corner', 0);
  set(_N | _E,           'corner', _PI);
  set(_S | _E,           'corner', -_HALF_PI);
  set(_N | _W,           'corner', _HALF_PI);

  // 3 neighbors — edge; default sprite faces NORTH, so we add π to orient correctly.
  set(_N | _E | _W,      'edge', _PI);          // S exposed
  set(_N | _E | _S,      'edge', -_HALF_PI);    // W exposed
  set(_N | _S | _W,      'edge', _HALF_PI);     // E exposed
  set(_E | _S | _W,      'edge', 0);            // N exposed

  // 4 neighbors — fully surrounded
  set(_N | _E | _S | _W, 'block', 0);

  return t;
})();

// ── Occupancy grid ───────────────────────────────────────────────────────────

interface CachedTileCoord {
  readonly key: string;
  readonly col: number;
  readonly row: number;
  /** platformEdge for platform tiles: 0=top, 1=bottom, 2=left, 3=right. Only meaningful for platformTiles. */
  readonly platformEdge: number;
}

interface RampWallInfo {
  readonly wallIndex: number;
}

interface HalfPillarWallInfo {
  readonly wallIndex: number;
}

interface CachedWallLayout {
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
  aboveLightingDepths: Map<string, number>;
  defaultLightingDepthByRoomKey: Map<string, Map<string, number>>;
}

let _cachedWallLayout: CachedWallLayout | null = null;

/** Returns the string key for a tile grid coordinate. */
function _tileKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Returns true if the cell at (col, row) is occupied by a solid wall block. */
function _isOccupied(occupied: Set<string>, col: number, row: number): boolean {
  return occupied.has(_tileKey(col, row));
}

function _isInsideActiveRoom(col: number, row: number): boolean {
  return col >= 0 && col < _activeRoomWidthBlocks && row >= 0 && row < _activeRoomHeightBlocks;
}

/**
 * Returns how many solid tiles lie directly above this tile before open air.
 * 0 means this tile is directly exposed to air from above.
 */
function _buildDefaultLightingDepths(occupied: Set<string>): Map<string, number> {
  const depths = new Map<string, number>();
  if (_activeRoomWidthBlocks <= 0 || _activeRoomHeightBlocks <= 0) return depths;

  const qCols: number[] = [];
  const qRows: number[] = [];
  const qDepths: number[] = [];
  let qIndex = 0;

  for (const key of occupied) {
    const commaIdx = key.indexOf(',');
    const col = parseInt(key.slice(0, commaIdx), 10);
    const row = parseInt(key.slice(commaIdx + 1), 10);
    if (!_isInsideActiveRoom(col, row)) continue;

    let touchesOpenAir = false;
    for (let dy = -1; dy <= 1 && !touchesOpenAir; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nc = col + dx;
        const nr = row + dy;
        if (!_isInsideActiveRoom(nc, nr)) continue; // outside room counts as solid
        if (!_isOccupied(occupied, nc, nr)) {
          touchesOpenAir = true;
          break;
        }
      }
    }

    if (touchesOpenAir) {
      depths.set(key, 0);
      qCols.push(col);
      qRows.push(row);
      qDepths.push(0);
    }
  }

  while (qIndex < qCols.length) {
    const col = qCols[qIndex];
    const row = qRows[qIndex];
    const depth = qDepths[qIndex];
    qIndex++;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nc = col + dx;
        const nr = row + dy;
        if (!_isInsideActiveRoom(nc, nr) || !_isOccupied(occupied, nc, nr)) continue;
        const neighborKey = _tileKey(nc, nr);
        if (depths.has(neighborKey)) continue;
        const nextDepth = depth + 1;
        depths.set(neighborKey, nextDepth);
        qCols.push(nc);
        qRows.push(nr);
        qDepths.push(nextDepth);
      }
    }
  }

  const maxFallbackDepth = Math.max(_activeRoomWidthBlocks, _activeRoomHeightBlocks);
  for (const key of occupied) {
    const commaIdx = key.indexOf(',');
    const col = parseInt(key.slice(0, commaIdx), 10);
    const row = parseInt(key.slice(commaIdx + 1), 10);
    if (!_isInsideActiveRoom(col, row)) continue;
    if (!depths.has(key)) depths.set(key, maxFallbackDepth);
  }

  return depths;
}

/**
 * Builds and caches occupancy data from wall AABBs in world-space tile coordinates.
 *
 * Using world-space coordinates (instead of screen-space) ensures the tile
 * grid is stable — blocks translate smoothly with the camera offset rather
 * than snapping to screen-aligned grid positions.
 */
function _buildWallLayoutCache(
  walls: WallSnapshot,
  blockSizePx: number,
): CachedWallLayout {
  let signature = `${blockSizePx}|${walls.count}`;
  for (let wi = 0; wi < walls.count; wi++) {
    signature += `|${walls.xWorld[wi]},${walls.yWorld[wi]},${walls.wWorld[wi]},${walls.hWorld[wi]},${walls.isPlatformFlag[wi]},${walls.platformEdge[wi]},${walls.themeIndex[wi]},${walls.isInvisibleFlag[wi]},${walls.rampOrientationIndex[wi]},${walls.isPillarHalfWidthFlag[wi]}`;
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
    const colCount = Math.max(1, Math.ceil((walls.xWorld[wi] + walls.wWorld[wi]) / blockSizePx) - colStart);
    const rowCount = Math.max(1, Math.ceil((walls.yWorld[wi] + walls.hWorld[wi]) / blockSizePx) - rowStart);

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
          occupied.add(_tileKey(colStart + c, rowStart + r));
        }
      }
      if (wallTheme !== null) {
        for (let r = 0; r < rowCount; r++) {
          for (let c = 0; c < colCount; c++) {
            tileTheme.set(_tileKey(colStart + c, rowStart + r), wallTheme);
          }
        }
      }
      continue;
    }

    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        const col = colStart + c;
        const row = rowStart + r;
        const key = _tileKey(col, row);
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

  const aboveLightingDepths = new Map<string, number>();
  for (let i = 0; i < occupiedTiles.length; i++) {
    const tile = occupiedTiles[i];
    let depth = 0;
    let scanRow = tile.row - 1;
    while (_isOccupied(occupied, tile.col, scanRow)) {
      depth++;
      scanRow--;
    }
    aboveLightingDepths.set(tile.key, depth);
  }
  for (let i = 0; i < platformTiles.length; i++) {
    const tile = platformTiles[i];
    let depth = 0;
    let scanRow = tile.row - 1;
    while (_isOccupied(occupied, tile.col, scanRow)) {
      depth++;
      scanRow--;
    }
    aboveLightingDepths.set(tile.key, depth);
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
    aboveLightingDepths,
    defaultLightingDepthByRoomKey: new Map<string, Map<string, number>>(),
  };

  return _cachedWallLayout;
}

function _getDefaultLightingDepths(layout: CachedWallLayout): Map<string, number> {
  const roomKey = `${_activeRoomWidthBlocks}x${_activeRoomHeightBlocks}`;
  const cached = layout.defaultLightingDepthByRoomKey.get(roomKey);
  if (cached !== undefined) return cached;

  const depths = _buildDefaultLightingDepths(layout.occupied);
  layout.defaultLightingDepthByRoomKey.set(roomKey, depths);
  return depths;
}

/**
 * Converts open-air distance (in tiles) into darkness alpha.
 * Darkness now accelerates with depth: each additional tile from open air
 * contributes twice the darkness of the previous tile.
 */
function _getDarknessAlphaFromAirDepth(airDepth: number): number {
  if (airDepth <= 0) return 0;
  const BASE_DARKNESS_STEP = 0.1;
  const acceleratedAlpha = BASE_DARKNESS_STEP * (Math.pow(2, airDepth) - 1);
  return Math.min(1, acceleratedAlpha);
}

/** Collects 2x2 wall top-left keys with their per-wall theme index. */
function _collectSolid2x2WallTopLefts(walls: WallSnapshot, blockSizePx: number): Map<string, number> {
  const topLeftMap = new Map<string, number>();
  if (blockSizePx !== 8) return topLeftMap;

  for (let wi = 0; wi < walls.count; wi++) {
    if (walls.isPlatformFlag[wi] === 1) continue;
    if (walls.isInvisibleFlag[wi] === 1) continue;

    const colStart = Math.floor(walls.xWorld[wi] / blockSizePx);
    const rowStart = Math.floor(walls.yWorld[wi] / blockSizePx);
    const colCount = Math.max(1, Math.ceil((walls.xWorld[wi] + walls.wWorld[wi]) / blockSizePx) - colStart);
    const rowCount = Math.max(1, Math.ceil((walls.yWorld[wi] + walls.hWorld[wi]) / blockSizePx) - rowStart);
    if (colCount !== 2 || rowCount !== 2) continue;
    topLeftMap.set(_tileKey(colStart, rowStart), walls.themeIndex[wi]);
  }

  return topLeftMap;
}

// ── Solid-colour fallback ─────────────────────────────────────────────────────

/** Draws a single tile as a solid-colour rectangle (used when sprites are loading). */
function _drawFallbackTile(
  ctx:         CanvasRenderingContext2D,
  tileX:       number,
  tileY:       number,
  tileSizePx:  number,
): void {
  const rx = Math.round(tileX);
  const ry = Math.round(tileY);
  const roundedSizePx = Math.round(tileSizePx);
  ctx.fillStyle = '#1a2535';
  ctx.fillRect(rx, ry, roundedSizePx, roundedSizePx);

  ctx.fillStyle = 'rgba(80,120,180,0.18)';
  ctx.fillRect(rx, ry, roundedSizePx, 2);
  ctx.fillRect(rx, ry, 2, roundedSizePx);

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(rx, ry + roundedSizePx - 2, roundedSizePx, 2);
  ctx.fillRect(rx + roundedSizePx - 2, ry, 2, roundedSizePx);
}

// ── Vertex overlay ────────────────────────────────────────────────────────────

/**
 * Draws the vertex overlay sprite at each concave inner corner of a corner
 * tile.  A concave inner corner exists at a diagonal position when both
 * sharing cardinal neighbours are solid but the diagonal cell itself is air.
 */
function _drawVertexOverlays(
  ctx:         CanvasRenderingContext2D,
  occupied:    Set<string>,
  col:         number,
  row:         number,
  tileX:       number,
  tileY:       number,
  tileSizePx:  number,
  northSolid:  boolean,
  eastSolid:   boolean,
  southSolid:  boolean,
  westSolid:   boolean,
): void {
  const vertexImg = _sprites.vertex;
  if (!isSpriteReady(vertexImg)) return;

  const qSizePx  = tileSizePx * 0.5;

  // Each diagonal corner: draw vertex overlay when both adjacent cardinals
  // are solid but the diagonal cell is air (concave inner corner).
  if (northSolid && eastSolid && !_isOccupied(occupied, col + 1, row - 1)) {
    ctx.save();
    ctx.translate(Math.round(tileX + tileSizePx), Math.round(tileY));
    ctx.rotate(_HALF_PI);
    ctx.drawImage(vertexImg, 0, 0, qSizePx, qSizePx);
    ctx.restore();
  }
  if (southSolid && eastSolid && !_isOccupied(occupied, col + 1, row + 1)) {
    ctx.save();
    ctx.translate(Math.round(tileX + tileSizePx), Math.round(tileY + tileSizePx));
    ctx.rotate(_PI);
    ctx.drawImage(vertexImg, 0, 0, qSizePx, qSizePx);
    ctx.restore();
  }
  if (southSolid && westSolid && !_isOccupied(occupied, col - 1, row + 1)) {
    ctx.save();
    ctx.translate(Math.round(tileX), Math.round(tileY + tileSizePx));
    ctx.rotate(-_HALF_PI);
    ctx.drawImage(vertexImg, 0, 0, qSizePx, qSizePx);
    ctx.restore();
  }
  if (northSolid && westSolid && !_isOccupied(occupied, col - 1, row - 1)) {
    ctx.save();
    ctx.translate(Math.round(tileX), Math.round(tileY));
    ctx.rotate(0);
    ctx.drawImage(vertexImg, 0, 0, qSizePx, qSizePx);
    ctx.restore();
  }
}

// ── Platform and ramp draw helpers ───────────────────────────────────────────

/** Draws a 3-pixel thick solid-color platform line at the specified edge. */
function _drawPlatformLine(
  ctx: CanvasRenderingContext2D,
  tileX: number, tileY: number,
  tileSizeScreen: number,
  platformEdge: number,
  scalePx: number,
): void {
  const LINE_PX = Math.max(1, Math.round(3 * scalePx));
  switch (platformEdge) {
    case 0: ctx.fillRect(tileX, tileY, tileSizeScreen, LINE_PX); break;
    case 1: ctx.fillRect(tileX, tileY + tileSizeScreen - LINE_PX, tileSizeScreen, LINE_PX); break;
    case 2: ctx.fillRect(tileX, tileY, LINE_PX, tileSizeScreen); break;
    case 3: ctx.fillRect(tileX + tileSizeScreen - LINE_PX, tileY, LINE_PX, tileSizeScreen); break;
  }
}

/**
 * Draws a ramp as a solid-color filled triangle with a hypotenuse edge stroke.
 * Used as fallback for non-blackRock themes and while procedural sprites load.
 */
function _drawRampTriangle(
  ctx: CanvasRenderingContext2D,
  wxPx: number, wyPx: number,
  wwPx: number, whPx: number,
  ori: number,
  fillColor: string,
  edgeColor: string,
  scalePx: number,
): void {
  const x0 = wxPx;        const y0 = wyPx;         // TL
  const x1 = wxPx + wwPx; const y1 = wyPx;         // TR
  const x2 = wxPx;        const y2 = wyPx + whPx;  // BL
  const x3 = wxPx + wwPx; const y3 = wyPx + whPx;  // BR

  ctx.fillStyle = fillColor;
  ctx.beginPath();
  switch (ori) {
    case 0: ctx.moveTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x1, y1); break; // /
    case 1: ctx.moveTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x0, y0); break; // \
    case 2: ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); break; // ⌐
    case 3: ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x3, y3); break; // ¬
  }
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = Math.max(1, scalePx);
  ctx.beginPath();
  switch (ori) {
    case 0: ctx.moveTo(x2, y2); ctx.lineTo(x1, y1); break;
    case 1: ctx.moveTo(x3, y3); ctx.lineTo(x0, y0); break;
    case 2: ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); break;
    case 3: ctx.moveTo(x0, y0); ctx.lineTo(x3, y3); break;
  }
  ctx.stroke();
  ctx.lineWidth = 1;
}

// ── Public render function ────────────────────────────────────────────────────

/**
 * Renders all walls using context-sensitive (auto-tiling) block sprites.
 *
 * Replaces the plain solid-colour wall renderer.  Falls back to solid-colour
 * drawing per tile while sprite images are still loading, so blocks are never
 * invisible on the first frame.
 *
 * @param ctx          The 2D canvas rendering context.
 * @param snapshot     Current world snapshot — walls read from snapshot.walls.
 * @param offsetXPx    Horizontal pixel offset (camera translation).
 * @param offsetYPx    Vertical pixel offset (camera translation).
 * @param scalePx      Scale factor (world units → screen pixels).
 * @param blockSizePx  Block/tile size in world units (e.g. BLOCK_SIZE_MEDIUM = 8).
 */
export function renderWallSprites(
  ctx:         CanvasRenderingContext2D,
  snapshot:    { readonly walls: WallSnapshot },
  offsetXPx:   number,
  offsetYPx:   number,
  scalePx:     number,
  blockSizePx: number,
): void {
  const walls = snapshot.walls;
  if (walls.count === 0) return;

  const tileSizeScreen = blockSizePx * scalePx;

  // Determine rendering mode: room-level default theme
  const roomTheme = _activeBlockTheme;
  // In world-number mode, world 0 uses blackRock sprites (legacy behaviour)
  const isLegacyBlackRock = (roomTheme === null) && (_activeWorldNumber === 0);
  // World-number mode for worlds 1+ uses the world-specific sprite set
  const isWorldMode = (roomTheme === null) && !isLegacyBlackRock;

  const wallLayout = _buildWallLayoutCache(walls, blockSizePx);
  const solid2x2Map = _collectSolid2x2WallTopLefts(walls, blockSizePx);
  const coveredBy2x2Keys = new Set<string>();

  // Determine which 2x2 blocks should render as full sprites.
  // Mark covered tiles for each 2x2 block whose resolved theme supports 2x2.
  for (const [topLeftKey, wallThemeIdx] of solid2x2Map) {
    const resolvedTheme: BlockTheme | null = wallThemeIdx !== WALL_THEME_DEFAULT_INDEX
      ? indexToBlockTheme(wallThemeIdx)
      : roomTheme;
    if (!_themeSupports2x2(resolvedTheme, blockSizePx)) continue;
    const commaIdx = topLeftKey.indexOf(',');
    const col = parseInt(topLeftKey.slice(0, commaIdx), 10);
    const row = parseInt(topLeftKey.slice(commaIdx + 1), 10);
    coveredBy2x2Keys.add(_tileKey(col, row));
    coveredBy2x2Keys.add(_tileKey(col + 1, row));
    coveredBy2x2Keys.add(_tileKey(col, row + 1));
    coveredBy2x2Keys.add(_tileKey(col + 1, row + 1));
  }

  const defaultLightingDepths = _activeLightingEffect === 'DEFAULT'
    ? _getDefaultLightingDepths(wallLayout)
    : null;

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Draw 2×2 full sprites.
  // blackRock: procedural sprite from 2×2 base pool + 2×2 block template.
  // brownRock / dirt: single dedicated 16×16 flat sprite (legacy).
  if (coveredBy2x2Keys.size > 0) {
    const drawSize = tileSizeScreen * 2;
    for (const [topLeftKey, wallThemeIdx] of solid2x2Map) {
      const resolvedTheme: BlockTheme | null = wallThemeIdx !== WALL_THEME_DEFAULT_INDEX
        ? indexToBlockTheme(wallThemeIdx)
        : roomTheme;
      if (!_themeSupports2x2(resolvedTheme, blockSizePx)) continue;

      const commaIdx = topLeftKey.indexOf(',');
      const col = parseInt(topLeftKey.slice(0, commaIdx), 10);
      const row = parseInt(topLeftKey.slice(commaIdx + 1), 10);
      const tileX = Math.round(col * blockSizePx * scalePx + offsetXPx);
      const tileY = Math.round(row * blockSizePx * scalePx + offsetYPx);

      const material = _themeToProceduralMaterial(resolvedTheme, _activeWorldNumber);
      if (material !== null) {
        // Procedural path: base sprite cut with 2×2 block template.
        const procSprite = getBlockSprite2x2(col, row, material, blockSizePx, _activeWorldNumber);
        if (procSprite !== null) {
          ctx.drawImage(procSprite, tileX, tileY, drawSize, drawSize);
        } else {
          _drawFallbackTile(ctx, tileX, tileY, drawSize);
        }
      } else {
        // Legacy flat-sprite path (brownRock, dirt).
        const sprite = _getFullSpriteFor2x2(resolvedTheme, blockSizePx);
        if (sprite !== null && isSpriteReady(sprite)) {
          ctx.drawImage(sprite, tileX, tileY, drawSize, drawSize);
        } else {
          _drawFallbackTile(ctx, tileX, tileY, drawSize);
        }
      }
    }
  }

  for (let ti = 0; ti < wallLayout.occupiedTiles.length; ti++) {
    const tile = wallLayout.occupiedTiles[ti];
    const key = tile.key;
    const col = tile.col;
    const row = tile.row;

    const northSolid = _isOccupied(wallLayout.occupied, col,     row - 1);
    const eastSolid  = _isOccupied(wallLayout.occupied, col + 1, row    );
    const southSolid = _isOccupied(wallLayout.occupied, col,     row + 1);
    const westSolid  = _isOccupied(wallLayout.occupied, col - 1, row    );

    const mask =
      (northSolid ? _N : 0) |
      (eastSolid  ? _E : 0) |
      (southSolid ? _S : 0) |
      (westSolid  ? _W : 0);

    const spec = _TILE_TABLE[mask];

    // Convert world-space tile position to screen space for smooth scrolling
    const tileX  = Math.round(col * blockSizePx * scalePx + offsetXPx);
    const tileY  = Math.round(row * blockSizePx * scalePx + offsetYPx);
    const tileKey = key;

    if (coveredBy2x2Keys.has(tileKey)) {
      const airDepth = _activeLightingEffect === 'DEFAULT'
        ? (defaultLightingDepths?.get(tileKey) ?? 0)
        : (wallLayout.aboveLightingDepths.get(tileKey) ?? 0);
      const darknessAlpha = _getDarknessAlphaFromAirDepth(airDepth);
      if (darknessAlpha > 0) {
        ctx.fillStyle = `rgba(0,0,0,${darknessAlpha})`;
        ctx.fillRect(tileX, tileY, tileSizeScreen, tileSizeScreen);
      }
      continue;
    }

    // Resolve per-tile theme: use tile-level override if present, else room default
    const tileTheme: BlockTheme | null = wallLayout.tileTheme.get(tileKey) ?? roomTheme;
    const tileIsLegacyBlackRock = (tileTheme === null) && (_activeWorldNumber === 0);

    const material = _themeToProceduralMaterial(tileTheme, _activeWorldNumber);

    if (material !== null) {
      // Procedural path (blackRock): base sprite cut with 1×1 block template.
      const procSprite = getBlockSprite1x1(col, row, material, blockSizePx, _activeWorldNumber);
      if (procSprite !== null) {
        ctx.drawImage(procSprite, tileX, tileY, tileSizeScreen, tileSizeScreen);
      } else {
        _drawFallbackTile(ctx, tileX, tileY, tileSizeScreen);
      }
    } else if (!tileIsLegacyBlackRock && tileTheme !== null) {
      // Legacy flat-sprite / auto-tiling path (brownRock, dirt).
      const img = _getSpriteForLegacyTheme(tileTheme, spec.variant, blockSizePx);
      if (isSpriteReady(img)) {
        if (tileTheme === 'brownRock' || spec.rotationRad === 0) {
          ctx.drawImage(img, tileX, tileY, tileSizeScreen, tileSizeScreen);
        } else {
          const halfSz = Math.round(tileSizeScreen * 0.5);
          const cx     = Math.round(tileX + tileSizeScreen * 0.5);
          const cy     = Math.round(tileY + tileSizeScreen * 0.5);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(spec.rotationRad);
          ctx.drawImage(img, -halfSz, -halfSz, tileSizeScreen, tileSizeScreen);
          ctx.restore();
        }
      } else {
        _drawFallbackTile(ctx, tileX, tileY, tileSizeScreen);
      }
    } else {
      // World 1+ legacy: world-specific auto-tiling sprites.
      const img = _sprites[spec.variant];
      if (isSpriteReady(img)) {
        if (spec.rotationRad === 0) {
          ctx.drawImage(img, tileX, tileY, tileSizeScreen, tileSizeScreen);
        } else {
          const halfSz = Math.round(tileSizeScreen * 0.5);
          const cx     = Math.round(tileX + tileSizeScreen * 0.5);
          const cy     = Math.round(tileY + tileSizeScreen * 0.5);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(spec.rotationRad);
          ctx.drawImage(img, -halfSz, -halfSz, tileSizeScreen, tileSizeScreen);
          ctx.restore();
        }
      } else {
        _drawFallbackTile(ctx, tileX, tileY, tileSizeScreen);
      }
    }

    const airDepth = _activeLightingEffect === 'DEFAULT'
      ? (defaultLightingDepths?.get(tileKey) ?? 0)
      : (wallLayout.aboveLightingDepths.get(tileKey) ?? 0);
    const darknessAlpha = _getDarknessAlphaFromAirDepth(airDepth);
    if (darknessAlpha > 0) {
      ctx.fillStyle = `rgba(0,0,0,${darknessAlpha})`;
      ctx.fillRect(tileX, tileY, tileSizeScreen, tileSizeScreen);
    }

    // Draw vertex overlays only in world 1+ legacy mode (those worlds have vertex.png).
    // Theme-based modes and world-0 blackRock do not use vertex overlays.
    if (isWorldMode && spec.variant === 'corner') {
      _drawVertexOverlays(
        ctx, wallLayout.occupied, col, row, tileX, tileY, tileSizeScreen,
        northSolid, eastSolid, southSolid, westSolid,
      );
    }
  }

  for (let ti = 0; ti < wallLayout.platformTiles.length; ti++) {
    const tile = wallLayout.platformTiles[ti];
    const key = tile.key;
    const col = tile.col;
    const row = tile.row;

    const tileX = Math.round(col * blockSizePx * scalePx + offsetXPx);
    const tileY = Math.round(row * blockSizePx * scalePx + offsetYPx);

    // platformEdge is stored in the tile from the cache building pass (no per-draw wall scan).
    const platformEdgeForTile = tile.platformEdge;

    // Resolve theme for this platform tile.
    const platTheme: BlockTheme | null = wallLayout.tileTheme.get(key) ?? roomTheme;
    const platMaterial = _themeToProceduralMaterial(platTheme, _activeWorldNumber);

    if (platMaterial !== null) {
      // Procedural path (blackRock): base sprite cut with platform template.
      const procSprite = getPlatformSprite1x1(col, row, platMaterial, blockSizePx, platformEdgeForTile, _activeWorldNumber);
      if (procSprite !== null) {
        ctx.drawImage(procSprite, tileX, tileY, tileSizeScreen, tileSizeScreen);
      } else {
        // Fallback: thin solid-color line while sprites are loading.
        ctx.fillStyle = '#8899aa';
        _drawPlatformLine(ctx, tileX, tileY, tileSizeScreen, platformEdgeForTile, scalePx);
      }
    } else {
      // Legacy flat-color line (brownRock, dirt, world 1+).
      const isLegacyBlackRockPlatform = (platTheme === null) && (_activeWorldNumber === 0);
      let lineColor: string;
      if (platTheme === 'dirt') {
        lineColor = '#8b6914';
      } else if (platTheme === 'brownRock' || (platTheme === null && !isLegacyBlackRockPlatform)) {
        lineColor = '#8a7050';
      } else {
        lineColor = '#8899aa';
      }
      ctx.fillStyle = lineColor;
      _drawPlatformLine(ctx, tileX, tileY, tileSizeScreen, platformEdgeForTile, scalePx);
    }

    const tileKey = key;
    const airDepth = _activeLightingEffect === 'DEFAULT'
      ? (defaultLightingDepths?.get(tileKey) ?? 0)
      : (wallLayout.aboveLightingDepths.get(tileKey) ?? 0);
    const darknessAlpha = _getDarknessAlphaFromAirDepth(airDepth);
    if (darknessAlpha > 0) {
      ctx.fillStyle = `rgba(0,0,0,${darknessAlpha})`;
      ctx.fillRect(tileX, tileY, tileSizeScreen, tileSizeScreen);
    }
  }

  // ── Ramp rendering ────────────────────────────────────────────────────────
  // blackRock: procedural sprite from base pool + ramp template.
  // Other themes: filled solid-color triangle with edge highlight (legacy).
  for (let ri = 0; ri < wallLayout.rampWalls.length; ri++) {
    const wi = wallLayout.rampWalls[ri].wallIndex;
    const ori = walls.rampOrientationIndex[wi];
    const wxPx = walls.xWorld[wi] * scalePx + offsetXPx;
    const wyPx = walls.yWorld[wi] * scalePx + offsetYPx;
    const wwPx = walls.wWorld[wi] * scalePx;
    const whPx = walls.hWorld[wi] * scalePx;

    // Resolve theme for this ramp wall.
    const rampTheme: BlockTheme | null = walls.themeIndex[wi] !== WALL_THEME_DEFAULT_INDEX
      ? indexToBlockTheme(walls.themeIndex[wi])
      : roomTheme;
    const rampMaterial = _themeToProceduralMaterial(rampTheme, _activeWorldNumber);

    if (rampMaterial !== null) {
      // Procedural path (blackRock): base sprite cut with ramp template.
      const col = Math.floor(walls.xWorld[wi] / blockSizePx);
      const row = Math.floor(walls.yWorld[wi] / blockSizePx);
      const widthBlocks  = Math.max(1, Math.round(walls.wWorld[wi] / blockSizePx));
      const heightBlocks = Math.max(1, Math.round(walls.hWorld[wi] / blockSizePx));
      const procSprite = getRampSprite(col, row, widthBlocks, heightBlocks, ori, rampMaterial, blockSizePx, _activeWorldNumber);
      if (procSprite !== null) {
        ctx.drawImage(procSprite, Math.round(wxPx), Math.round(wyPx), Math.round(wwPx), Math.round(whPx));
      } else {
        // Fallback: solid triangle while sprites are loading.
        _drawRampTriangle(ctx, wxPx, wyPx, wwPx, whPx, ori, '#1a2535', '#5080b0', scalePx);
      }
    } else {
      // Legacy solid-color triangle path (brownRock, dirt, world 1+).
      const isLegacyBR = (rampTheme === null) && (_activeWorldNumber === 0);
      let fillColor: string;
      if (rampTheme === 'dirt') {
        fillColor = '#5a3e1b';
      } else if (rampTheme === 'brownRock' || (rampTheme === null && !isLegacyBR)) {
        fillColor = '#4a3828';
      } else {
        fillColor = '#1a2535';
      }
      let edgeColor: string;
      if (rampTheme === 'dirt') {
        edgeColor = '#8b6914';
      } else if (rampTheme === 'brownRock' || (rampTheme === null && !isLegacyBR)) {
        edgeColor = '#7a5840';
      } else {
        edgeColor = '#5080b0';
      }
      _drawRampTriangle(ctx, wxPx, wyPx, wwPx, whPx, ori, fillColor, edgeColor, scalePx);
    }
  }

  // ── Half-pillar walls ─────────────────────────────────────────────────────
  // Draw half-width pillars as centered narrow rectangles.
  for (let pi = 0; pi < wallLayout.halfPillarWalls.length; pi++) {
    const wi = wallLayout.halfPillarWalls[pi].wallIndex;
    const wxPx = walls.xWorld[wi] * scalePx + offsetXPx;
    const wyPx = walls.yWorld[wi] * scalePx + offsetYPx;
    const wwPx = walls.wWorld[wi] * scalePx;
    const whPx = walls.hWorld[wi] * scalePx;

    // Resolve theme color
    const pillarTheme: BlockTheme | null = walls.themeIndex[wi] !== WALL_THEME_DEFAULT_INDEX
      ? indexToBlockTheme(walls.themeIndex[wi])
      : roomTheme;
    const isLegacyBR2 = (pillarTheme === null) && (_activeWorldNumber === 0);
    let pillarFill: string;
    let pillarEdge: string;
    if (pillarTheme === 'dirt') {
      pillarFill = '#5a3e1b'; pillarEdge = '#8b6914';
    } else if (pillarTheme === 'brownRock' || (pillarTheme === null && !isLegacyBR2)) {
      pillarFill = '#4a3828'; pillarEdge = '#7a5840';
    } else {
      pillarFill = '#1a2535'; pillarEdge = '#5080b0';
    }

    // Draw the pillar centered horizontally within its AABB
    const pillarWidthPx = wwPx; // width already 4 px (half BLOCK_SIZE_MEDIUM)
    ctx.fillStyle = pillarFill;
    ctx.fillRect(Math.round(wxPx), Math.round(wyPx), Math.round(pillarWidthPx), Math.round(whPx));
    ctx.strokeStyle = pillarEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(wxPx) + 0.5, Math.round(wyPx) + 0.5,
      Math.round(pillarWidthPx) - 1, Math.round(whPx) - 1);
  }

  ctx.restore();
}
