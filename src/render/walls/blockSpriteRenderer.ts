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

/** Cache of loaded sprite sets keyed by worldNumber. */
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
    const brownRockBlockSprite = _loadImage('SPRITES/BLOCKS/brownRock/brownRock_block.png');
    sprites = {
      block:  brownRockBlockSprite,
      single: brownRockBlockSprite,
      edge:   brownRockBlockSprite,
      corner: brownRockBlockSprite,
      end:    brownRockBlockSprite,
      vertex: brownRockBlockSprite,
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

/** Active sprite set — updated when setActiveWorld() is called. */
let _sprites: BlockSpriteSet = getBlockSpriteSet(0);

/**
 * Set the active world number for block sprite rendering.
 * Call this when the player enters a new room with a different worldNumber.
 */
export function setActiveBlockSpriteWorld(worldNumber: number): void {
  _sprites = getBlockSpriteSet(worldNumber);
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

/** Returns the string key for a tile grid coordinate. */
function _tileKey(col: number, row: number): string {
  return `${col},${row}`;
}

/** Returns true if the cell at (col, row) is occupied by a solid wall block. */
function _isOccupied(col: number, row: number): boolean {
  return _occupied.has(_tileKey(col, row));
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

  for (let wi = 0; wi < walls.count; wi++) {
    const colStart = Math.floor(walls.xWorld[wi] / blockSizePx);
    const rowStart = Math.floor(walls.yWorld[wi] / blockSizePx);
    const colCount = Math.max(1, Math.ceil((walls.xWorld[wi] + walls.wWorld[wi]) / blockSizePx) - colStart);
    const rowCount = Math.max(1, Math.ceil((walls.yWorld[wi] + walls.hWorld[wi]) / blockSizePx) - rowStart);

    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        _occupied.add(_tileKey(colStart + c, rowStart + r));
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
  ctx.fillStyle = '#1a2535';
  ctx.fillRect(tileX, tileY, tileSizePx, tileSizePx);

  ctx.fillStyle = 'rgba(80,120,180,0.18)';
  ctx.fillRect(tileX, tileY, tileSizePx, 2);
  ctx.fillRect(tileX, tileY, 2, tileSizePx);

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(tileX, tileY + tileSizePx - 2, tileSizePx, 2);
  ctx.fillRect(tileX + tileSizePx - 2, tileY, 2, tileSizePx);
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
    ctx.translate(tileX + tileSizePx, tileY);
    ctx.rotate(_HALF_PI);
    ctx.drawImage(vertexImg, 0, 0, qSizePx, qSizePx);
    ctx.restore();
  }
  if (southSolid && eastSolid && !_isOccupied(col + 1, row + 1)) {
    ctx.save();
    ctx.translate(tileX + tileSizePx, tileY + tileSizePx);
    ctx.rotate(_PI);
    ctx.drawImage(vertexImg, 0, 0, qSizePx, qSizePx);
    ctx.restore();
  }
  if (southSolid && westSolid && !_isOccupied(col - 1, row + 1)) {
    ctx.save();
    ctx.translate(tileX, tileY + tileSizePx);
    ctx.rotate(-_HALF_PI);
    ctx.drawImage(vertexImg, 0, 0, qSizePx, qSizePx);
    ctx.restore();
  }
  if (northSolid && westSolid && !_isOccupied(col - 1, row - 1)) {
    ctx.save();
    ctx.translate(tileX, tileY);
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
 * @param blockSizePx  Block/tile size in world units (e.g. BLOCK_SIZE_MEDIUM = 12).
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
    const tileX  = col * blockSizePx * scalePx + offsetXPx;
    const tileY  = row * blockSizePx * scalePx + offsetYPx;
    const halfSz = tileSizeScreen * 0.5;
    const cx     = tileX + halfSz;
    const cy     = tileY + halfSz;

    const img = _sprites[spec.variant];

    if (isSpriteReady(img)) {
      if (spec.rotationRad === 0) {
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

    // Draw vertex overlay at concave inner corners of corner tiles.
    if (spec.variant === 'corner') {
      _drawVertexOverlays(
        ctx, col, row, tileX, tileY, tileSizeScreen,
        northSolid, eastSolid, southSolid, westSolid,
      );
    }
  }

  ctx.restore();
}
