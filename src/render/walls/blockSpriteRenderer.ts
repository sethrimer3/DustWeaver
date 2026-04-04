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
import type { BlockTheme } from '../../levels/roomDef';

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

// Black Rock sprites
const _blackRockBlockVariants: readonly HTMLImageElement[] = [
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (1).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (2).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (3).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (4).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (5).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (6).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (7).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (8).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (9).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (10).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (11).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (12).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (13).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (14).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (15).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (16).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (17).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (18).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (19).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock (20).png'),
];
const _blackRockCornerVariants: readonly HTMLImageElement[] = [
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_corner (1).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_corner (2).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_corner (3).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_corner (4).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_corner (5).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_corner (6).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_corner (7).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_corner (8).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_corner (9).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_corner (10).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_corner (11).png'),
];
const _blackRockPlatformVariants: readonly HTMLImageElement[] = [
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_platform (1).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_platform (2).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_platform (3).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_platform (4).png'),
];
const _blackRockPillarVariants: readonly HTMLImageElement[] = [
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_pillar (1).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_pillar (2).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_pillar (3).png'),
  _loadImage('SPRITES/BLOCKS/blackRock/blackRock_pillar (4).png'),
];

// Brown Rock sprites (single flat sprite, no auto-tiling variants)
const _brownRockSprite8 = _loadImage('SPRITES/BLOCKS/brownRock/brownRock_8x8.png');
const _brownRockSprite16 = _loadImage('SPRITES/BLOCKS/brownRock/brownRock_16x16.png');
const _brownRockSprite32 = _loadImage('SPRITES/BLOCKS/brownRock/brownRock_32x32.png');

// Dirt sprites (edge/corner auto-tiling at 8x8)
const _dirtBlockSprite = _loadImage('SPRITES/BLOCKS/dirt/dirt_8x8.png');
const _dirtEdgeSprite  = _loadImage('SPRITES/BLOCKS/dirt/dirt_8x8_edge.png');
const _dirtCornerSprite = _loadImage('SPRITES/BLOCKS/dirt/dirt_8x8_corner.png');

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

function _hashTileCoord(col: number, row: number): number {
  let seed = (col * 73856093) ^ (row * 19349663) ^ (_activeWorldNumber * 83492791);
  seed |= 0;
  seed ^= seed >>> 16;
  seed = Math.imul(seed, 2246822519);
  seed ^= seed >>> 13;
  return seed >>> 0;
}

// Neighbor-mask constants for corner detection
const _CORNER_MASK_SW = 4 | 8;   // _S | _W
const _CORNER_MASK_NE = 1 | 2;   // _N | _E
const _CORNER_MASK_SE = 4 | 2;   // _S | _E
const _CORNER_MASK_NW = 1 | 8;   // _N | _W

function _pickBlackRockVariant(
  col: number,
  row: number,
  northSolid: boolean,
  eastSolid: boolean,
  southSolid: boolean,
  westSolid: boolean,
  // mask is pre-computed by the caller to avoid recomputing per call site;
  // it equals (northSolid?_N:0)|(eastSolid?_E:0)|(southSolid?_S:0)|(westSolid?_W:0).
  mask: number,
): HTMLImageElement {
  // Thin pillar tiles: vertically connected and narrow in width.
  const isPillarTile = northSolid && southSolid && !eastSolid && !westSolid;
  const hash = _hashTileCoord(col, row);
  if (isPillarTile) {
    return _blackRockPillarVariants[hash % _blackRockPillarVariants.length];
  }
  // Use dedicated corner sprites for 2-adjacent-neighbor (L-shaped) tiles.
  if (mask === _CORNER_MASK_SW || mask === _CORNER_MASK_NE ||
      mask === _CORNER_MASK_SE || mask === _CORNER_MASK_NW) {
    return _blackRockCornerVariants[hash % _blackRockCornerVariants.length];
  }
  return _blackRockBlockVariants[hash % _blackRockBlockVariants.length];
}

/**
 * Returns the sprite for a block cell, based on the active block theme and
 * the cell's auto-tile variant.
 */
function _getSpriteForTheme(
  theme: BlockTheme,
  col: number, row: number,
  northSolid: boolean, eastSolid: boolean, southSolid: boolean, westSolid: boolean,
  mask: number,
  variant: TileVariant,
  blockSizePx: number,
): HTMLImageElement {
  switch (theme) {
    case 'blackRock':
      return _pickBlackRockVariant(col, row, northSolid, eastSolid, southSolid, westSolid, mask);
    case 'brownRock':
      return _getBrownRockSpriteForBlockSize(blockSizePx);
    case 'dirt':
      return _getDirtSprite(variant);
  }
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

/** Reusable occupancy set; cleared at the start of each renderWallSprites call. */
const _occupied = new Set<string>();
/** Reusable occupancy set for one-way platform tiles. */
const _platformOccupied = new Set<string>();

/** Returns the string key for a tile grid coordinate. */
function _tileKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Returns true if the cell at (col, row) is occupied by a solid wall block. */
function _isOccupied(col: number, row: number): boolean {
  return _occupied.has(_tileKey(col, row));
}

/**
 * Returns how many solid tiles lie directly above this tile before open air.
 * 0 means this tile is directly exposed to air from above.
 */
function _blocksToOpenAirAbove(col: number, row: number): number {
  let depth = 0;
  let scanRow = row - 1;
  while (_isOccupied(col, scanRow)) {
    depth++;
    scanRow--;
  }
  return depth;
}

/**
 * Populates _occupied from all wall AABBs in world-space tile coordinates.
 *
 * Using world-space coordinates (instead of screen-space) ensures the tile
 * grid is stable — blocks translate smoothly with the camera offset rather
 * than snapping to screen-aligned grid positions.
 */
function _buildOccupancy(
  walls:         WallSnapshot,
  blockSizePx:   number,
): void {
  _occupied.clear();
  _platformOccupied.clear();

  for (let wi = 0; wi < walls.count; wi++) {
    const colStart = Math.floor(walls.xWorld[wi] / blockSizePx);
    const rowStart = Math.floor(walls.yWorld[wi] / blockSizePx);
    const colCount = Math.max(1, Math.ceil((walls.xWorld[wi] + walls.wWorld[wi]) / blockSizePx) - colStart);
    const rowCount = Math.max(1, Math.ceil((walls.yWorld[wi] + walls.hWorld[wi]) / blockSizePx) - rowStart);

    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        if (walls.isPlatformFlag[wi] === 1) {
          _platformOccupied.add(_tileKey(colStart + c, rowStart + r));
        } else {
          _occupied.add(_tileKey(colStart + c, rowStart + r));
        }
      }
    }
  }
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
  if (northSolid && eastSolid && !_isOccupied(col + 1, row - 1)) {
    ctx.save();
    ctx.translate(Math.round(tileX + tileSizePx), Math.round(tileY));
    ctx.rotate(_HALF_PI);
    ctx.drawImage(vertexImg, 0, 0, qSizePx, qSizePx);
    ctx.restore();
  }
  if (southSolid && eastSolid && !_isOccupied(col + 1, row + 1)) {
    ctx.save();
    ctx.translate(Math.round(tileX + tileSizePx), Math.round(tileY + tileSizePx));
    ctx.rotate(_PI);
    ctx.drawImage(vertexImg, 0, 0, qSizePx, qSizePx);
    ctx.restore();
  }
  if (southSolid && westSolid && !_isOccupied(col - 1, row + 1)) {
    ctx.save();
    ctx.translate(Math.round(tileX), Math.round(tileY + tileSizePx));
    ctx.rotate(-_HALF_PI);
    ctx.drawImage(vertexImg, 0, 0, qSizePx, qSizePx);
    ctx.restore();
  }
  if (northSolid && westSolid && !_isOccupied(col - 1, row - 1)) {
    ctx.save();
    ctx.translate(Math.round(tileX), Math.round(tileY));
    ctx.rotate(0);
    ctx.drawImage(vertexImg, 0, 0, qSizePx, qSizePx);
    ctx.restore();
  }
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

  // Determine rendering mode
  const theme = _activeBlockTheme;
  // In world-number mode, world 0 uses blackRock sprites (legacy behaviour)
  const isLegacyBlackRock = (theme === null) && (_activeWorldNumber === 0);
  // World-number mode for worlds 1+ uses the world-specific sprite set
  const isWorldMode = (theme === null) && !isLegacyBlackRock;

  _buildOccupancy(walls, blockSizePx);

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  for (const key of _occupied) {
    const commaIdx = key.indexOf(',');
    const col = parseInt(key.slice(0, commaIdx), 10);
    const row = parseInt(key.slice(commaIdx + 1), 10);

    const northSolid = _isOccupied(col,     row - 1);
    const eastSolid  = _isOccupied(col + 1, row    );
    const southSolid = _isOccupied(col,     row + 1);
    const westSolid  = _isOccupied(col - 1, row    );

    const mask =
      (northSolid ? _N : 0) |
      (eastSolid  ? _E : 0) |
      (southSolid ? _S : 0) |
      (westSolid  ? _W : 0);

    const spec = _TILE_TABLE[mask];

    // Convert world-space tile position to screen space for smooth scrolling
    const tileX  = Math.round(col * blockSizePx * scalePx + offsetXPx);
    const tileY  = Math.round(row * blockSizePx * scalePx + offsetYPx);
    const halfSz = Math.round(tileSizeScreen * 0.5);
    const cx     = Math.round(tileX + tileSizeScreen * 0.5);
    const cy     = Math.round(tileY + tileSizeScreen * 0.5);

    let img: HTMLImageElement;
    let skipRotation: boolean;

    if (theme !== null) {
      // Theme-based rendering (new system)
      img = _getSpriteForTheme(theme, col, row, northSolid, eastSolid, southSolid, westSolid, mask, spec.variant, blockSizePx);
      // Only blackRock and brownRock skip rotation (flat/random tiles)
      skipRotation = (theme === 'blackRock' || theme === 'brownRock');
    } else if (isLegacyBlackRock) {
      // World 0 legacy: blackRock sprites
      img = _pickBlackRockVariant(col, row, northSolid, eastSolid, southSolid, westSolid, mask);
      skipRotation = true;
    } else {
      // World 1+ legacy: world-specific auto-tiling sprites
      img = _sprites[spec.variant];
      skipRotation = false;
    }

    if (isSpriteReady(img)) {
      if (skipRotation || spec.rotationRad === 0) {
        ctx.drawImage(img, tileX, tileY, tileSizeScreen, tileSizeScreen);
      } else {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(spec.rotationRad);
        ctx.drawImage(img, -halfSz, -halfSz, tileSizeScreen, tileSizeScreen);
        ctx.restore();
      }
    } else {
      _drawFallbackTile(ctx, tileX, tileY, tileSizeScreen);
    }

    // Darken each tile by 10% for each solid block between it and open air.
    const airDepth = _blocksToOpenAirAbove(col, row);
    const darknessAlpha = Math.min(1, airDepth * 0.1);
    if (darknessAlpha > 0) {
      ctx.fillStyle = `rgba(0,0,0,${darknessAlpha})`;
      ctx.fillRect(tileX, tileY, tileSizeScreen, tileSizeScreen);
    }

    // Draw vertex overlays only in world 1+ legacy mode (those worlds have vertex.png).
    // Theme-based modes and world-0 blackRock do not use vertex overlays.
    if (isWorldMode && spec.variant === 'corner') {
      _drawVertexOverlays(
        ctx, col, row, tileX, tileY, tileSizeScreen,
        northSolid, eastSolid, southSolid, westSolid,
      );
    }
  }

  for (const key of _platformOccupied) {
    const commaIdx = key.indexOf(',');
    const col = parseInt(key.slice(0, commaIdx), 10);
    const row = parseInt(key.slice(commaIdx + 1), 10);

    const tileX = Math.round(col * blockSizePx * scalePx + offsetXPx);
    const tileY = Math.round(row * blockSizePx * scalePx + offsetYPx);
    const hash = _hashTileCoord(col, row);

    let img: HTMLImageElement;
    if (theme === 'blackRock' || isLegacyBlackRock) {
      img = _blackRockPlatformVariants[hash % _blackRockPlatformVariants.length];
    } else if (theme === 'brownRock') {
      img = _getBrownRockSpriteForBlockSize(blockSizePx);
    } else if (theme === 'dirt') {
      img = _dirtBlockSprite;
    } else {
      img = _sprites.end;
    }

    if (isSpriteReady(img)) {
      ctx.drawImage(img, tileX, tileY, tileSizeScreen, tileSizeScreen);
    } else {
      _drawFallbackTile(ctx, tileX, tileY, tileSizeScreen);
    }

    const airDepth = _blocksToOpenAirAbove(col, row);
    const darknessAlpha = Math.min(1, airDepth * 0.1);
    if (darknessAlpha > 0) {
      ctx.fillStyle = `rgba(0,0,0,${darknessAlpha})`;
      ctx.fillRect(tileX, tileY, tileSizeScreen, tileSizeScreen);
    }
  }

  ctx.restore();
}
