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
import type { BlockTheme, LightingEffect, AmbientLightDirection } from '../../levels/roomDef';
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
let _activeLightingEffect: LightingEffect = 'Ambient';
let _activeAmbientDirection: AmbientLightDirection = 'omni';
let _activeRoomWidthBlocks = 0;
let _activeRoomHeightBlocks = 0;
/**
 * Active set of {@link import('../../levels/roomDef').RoomAmbientLightBlockerDef}
 * tile keys (`"col,row"`). Treated as opaque to ambient-light propagation
 * (but NOT to collision, NOT to local lights — see roomDef.ts docs).
 */
let _activeAmbientBlockerKeys: ReadonlySet<string> = new Set();
/**
 * Short signature of the active blocker set, used to detect blocker changes
 * when rebuilding the wall-layout cache. Set to `''` when the set is empty.
 */
let _activeAmbientBlockerSig = '';

/**
 * Dark ambient-light blocker tile keys (`"col,row"`).
 * These cells draw a solid black overlay over the room background,
 * hiding secret areas from view.  They also participate in the normal
 * ambient-light propagation block (same as clear blockers).
 */
let _activeDarkBlockerKeys: ReadonlySet<string> = new Set();

/**
 * Set the active world number for block sprite rendering.
 * Call this when the player enters a room without an explicit blockTheme.
 */
export function setActiveBlockSpriteWorld(worldNumber: number): void {
  _activeWorldNumber = worldNumber;
  _sprites = getBlockSpriteSet(worldNumber);
  _activeBlockTheme = null;
  _invalidateBakedWallCanvas();
}

/**
 * Set the active block theme for rendering.
 * Overrides world-number-based sprite selection until setActiveBlockSpriteWorld is called.
 */
export function setActiveBlockSpriteTheme(theme: BlockTheme): void {
  _activeBlockTheme = theme;
  _invalidateBakedWallCanvas();
}

/**
 * Sets the active ambient-lighting model and room bounds used for block shading.
 *
 * @param effect          Which lighting mode is active. Legacy values `'DEFAULT'`
 *                        and `'Above'` are accepted and mapped to `'Ambient'`
 *                        with direction `'omni'` / `'down'` respectively
 *                        (unless a direction is explicitly supplied).
 * @param roomWidthBlocks  Room width in block units.
 * @param roomHeightBlocks Room height in block units.
 * @param direction        Ambient/skylight direction. Omitted ⇒ use the
 *                         direction implied by the legacy mode name.
 * @param ambientBlockers  Optional set of `"col,row"` tile keys that are
 *                         opaque to ambient-light propagation. Authored data
 *                         from {@link import('../../levels/roomDef').RoomAmbientLightBlockerDef}.
 */
export function setActiveBlockLighting(
  effect: LightingEffect,
  roomWidthBlocks: number,
  roomHeightBlocks: number,
  direction?: AmbientLightDirection,
  ambientBlockers?: ReadonlySet<string>,
): void {
  _activeLightingEffect = effect;
  _activeRoomWidthBlocks = roomWidthBlocks;
  _activeRoomHeightBlocks = roomHeightBlocks;

  // Resolve direction: explicit > inferred-from-legacy-mode > sensible default.
  if (direction !== undefined) {
    _activeAmbientDirection = direction;
  } else if (effect === 'Above') {
    _activeAmbientDirection = 'down';
  } else {
    // 'DEFAULT', 'Ambient', 'DarkRoom', 'FullyLit' → omni by default
    _activeAmbientDirection = 'omni';
  }

  // Build a stable signature from the blocker set; order-independent by using
  // a sorted join of keys. Cheap for typical authored counts (<~128).
  const blockerKeys = ambientBlockers ?? new Set<string>();
  _activeAmbientBlockerKeys = blockerKeys;
  if (blockerKeys.size === 0) {
    _activeAmbientBlockerSig = '';
  } else {
    const arr: string[] = [];
    for (const k of blockerKeys) arr.push(k);
    arr.sort();
    _activeAmbientBlockerSig = arr.join(';');
  }

  _invalidateBakedWallCanvas();
}

/**
 * Sets the active set of dark ambient-light blocker tile keys.
 * Dark blockers are rendered as solid black overlays over the room background
 * before the wall sprites are drawn.  Call this when entering a room (same
 * timing as {@link setActiveBlockLighting}).
 *
 * @param darkBlockerKeys  Set of `"col,row"` tile keys for dark blockers.
 *                         Pass `undefined` or an empty set to clear.
 */
export function setActiveDarkAmbientBlockers(darkBlockerKeys?: ReadonlySet<string>): void {
  _activeDarkBlockerKeys = darkBlockerKeys ?? new Set();
}

/**
 * Draws a solid black rectangle over every dark ambient-light blocker cell.
 * Call this after the procedural background effects and before rendering wall
 * sprites so the darkness layer covers the background but not the geometry.
 *
 * @param ctx          The 2D canvas rendering context.
 * @param offsetXPx    Horizontal pixel offset (camera translation).
 * @param offsetYPx    Vertical pixel offset (camera translation).
 * @param zoom         Scale factor (world units → screen pixels).
 * @param blockSizePx  Block/tile size in world units (e.g. BLOCK_SIZE_SMALL = 8).
 */
export function renderDarkAmbientBlockerOverlay(
  ctx: CanvasRenderingContext2D,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  blockSizePx: number,
): void {
  if (_activeDarkBlockerKeys.size === 0) return;
  const tileSizePx = blockSizePx * zoom;
  ctx.fillStyle = '#000000';
  for (const key of _activeDarkBlockerKeys) {
    const commaIdx = key.indexOf(',');
    const col = parseInt(key.slice(0, commaIdx), 10);
    const row = parseInt(key.slice(commaIdx + 1), 10);
    ctx.fillRect(
      Math.round(col * tileSizePx + offsetXPx),
      Math.round(row * tileSizePx + offsetYPx),
      Math.ceil(tileSizePx),
      Math.ceil(tileSizePx),
    );
  }
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

/**
 * Unit 2-D vector associated with each {@link AmbientLightDirection} value.
 *
 * The vector points in the direction light TRAVELS (e.g. `'down-right'` →
 * (+1, +1) normalised, meaning light enters the room from the upper-left
 * and moves toward the lower-right). The `'omni'` value returns (0,0),
 * signalling the solver to skip directional biasing.
 */
function _ambientDirectionVector(dir: AmbientLightDirection): { dx: number; dy: number } {
  switch (dir) {
    case 'omni':       return { dx:  0, dy:  0 };
    case 'down':       return { dx:  0, dy:  1 };
    case 'down-right': return { dx:  1, dy:  1 };
    case 'down-left':  return { dx: -1, dy:  1 };
    case 'up':         return { dx:  0, dy: -1 };
    case 'up-right':   return { dx:  1, dy: -1 };
    case 'up-left':    return { dx: -1, dy: -1 };
    case 'left':       return { dx: -1, dy:  0 };
    case 'right':      return { dx:  1, dy:  0 };
  }
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
 * Unified ambient-light depth solver.
 *
 * Two-phase algorithm that replaces the legacy split between `'DEFAULT'`
 * (omni BFS from any air-touching solid) and `'Above'` (vertical scan only):
 *
 * 1. **Lit-air flood**: compute the set of in-room AIR cells that are
 *    "connected to the sky". Seeds are air cells on a room edge that faces
 *    the ambient-light direction (or every edge, for `'omni'`). The flood
 *    propagates through empty cells only, skipping solids and skipping
 *    `ambientBlockers`. When a direction is set, a cell only propagates into
 *    neighbours whose offset dot-producted with the direction vector is
 *    `≥ 0`, so light naturally spills in a diagonal cone instead of bending
 *    around arbitrary corners.
 *
 * 2. **Solid depth BFS**: every solid cell 8-adjacent to a lit-air cell is
 *    depth 0 ("directly exposed"). BFS outward through adjacent solids
 *    assigns each deeper solid an incrementing depth, which drives the
 *    exponential darkness tint in {@link _getDarknessAlphaFromAirDepth}.
 *
 * Air cells inside an enclosed/blocked pocket never enter the lit-air set, so
 * solid walls adjacent to them stay at `maxFallbackDepth` (fully dark). When
 * a breakable wall is destroyed its tile becomes empty, the wall-layout
 * signature changes, and this function is re-run — light then spills in
 * naturally on the next bake. See `ambientLightBlockers` docs in
 * `roomDef.ts` for the full authoring model.
 */
function _buildAmbientDepths(
  occupied: Set<string>,
  blockers: ReadonlySet<string>,
  direction: AmbientLightDirection,
): Map<string, number> {
  const depths = new Map<string, number>();
  if (_activeRoomWidthBlocks <= 0 || _activeRoomHeightBlocks <= 0) return depths;

  const { dx: directionVectorX, dy: directionVectorY } = _ambientDirectionVector(direction);
  const isOmni = directionVectorX === 0 && directionVectorY === 0;

  // ── Phase 1: flood-fill "lit air" cells ──────────────────────────────────
  // `litAir` tracks which empty cells are connected to the sky.
  const litAir = new Set<string>();
  const airQueueCols: number[] = [];
  const airQueueRows: number[] = [];
  let airQueueIndex = 0;

  const pushAirSeed = (c: number, r: number): void => {
    if (!_isInsideActiveRoom(c, r)) return;
    const key = _tileKey(c, r);
    if (litAir.has(key)) return;
    if (occupied.has(key)) return;       // solid: not a sky-seed
    if (blockers.has(key)) return;       // authored blocker: opaque to ambient
    litAir.add(key);
    airQueueCols.push(c);
    airQueueRows.push(r);
  };

  // Seed the "sky side" of the room.
  //
  // For `'omni'` mode we preserve the legacy `'DEFAULT'` semantics by seeding
  // EVERY non-blocker air cell — so a fully-enclosed room with only interior
  // air still has lit walls around the air, and authored hidden pockets are
  // created exclusively by painting `ambientLightBlockers` over the pocket's
  // air cells (those cells fail the `!blockers.has(key)` check and stay dark).
  //
  // For a directional mode, seeds come from the edges facing the sky (i.e.
  // the sides opposite to the direction vector); the flood then propagates
  // inward through connected air, so a hidden pocket walled off from the
  // sky-facing edge naturally stays dark.
  if (isOmni) {
    for (let r = 0; r < _activeRoomHeightBlocks; r++) {
      for (let c = 0; c < _activeRoomWidthBlocks; c++) {
        const key = _tileKey(c, r);
        if (occupied.has(key)) continue;
        if (blockers.has(key)) continue;
        litAir.add(key);
      }
    }
    // Omni mode doesn't need to flood — every eligible air cell is already
    // in `litAir` — so skip the queue-based propagation below.
  } else {
    const seedTop    = directionVectorY > 0;  // light moves downward ⇒ enters from top
    const seedBottom = directionVectorY < 0;
    const seedLeft   = directionVectorX > 0;
    const seedRight  = directionVectorX < 0;

    if (seedTop) {
      for (let c = 0; c < _activeRoomWidthBlocks; c++) pushAirSeed(c, 0);
    }
    if (seedBottom) {
      for (let c = 0; c < _activeRoomWidthBlocks; c++) pushAirSeed(c, _activeRoomHeightBlocks - 1);
    }
    if (seedLeft) {
      for (let r = 0; r < _activeRoomHeightBlocks; r++) pushAirSeed(0, r);
    }
    if (seedRight) {
      for (let r = 0; r < _activeRoomHeightBlocks; r++) pushAirSeed(_activeRoomWidthBlocks - 1, r);
    }
  }

  // Flood-fill through empty cells. Directional bias: only step into a
  // neighbour whose offset has a non-negative dot product with the direction
  // vector (i.e. light keeps travelling generally with the direction). The
  // check allows perpendicular spread for a natural soft cone.
  while (airQueueIndex < airQueueCols.length) {
    const col = airQueueCols[airQueueIndex];
    const row = airQueueRows[airQueueIndex];
    airQueueIndex++;

    for (let ny = -1; ny <= 1; ny++) {
      for (let nx = -1; nx <= 1; nx++) {
        if (nx === 0 && ny === 0) continue;
        if (!isOmni) {
          // dot(neighbourOffset, direction) >= 0 — skip stepping "uphill"
          const dot = nx * directionVectorX + ny * directionVectorY;
          if (dot < 0) continue;
        }
        const c = col + nx;
        const r = row + ny;
        if (!_isInsideActiveRoom(c, r)) continue;
        const key = _tileKey(c, r);
        if (litAir.has(key)) continue;
        if (occupied.has(key)) continue;
        if (blockers.has(key)) continue;
        litAir.add(key);
        airQueueCols.push(c);
        airQueueRows.push(r);
      }
    }
  }

  // ── Phase 2: BFS depth into solid cells from lit-air neighbours ─────────
  const solidQueueCols: number[] = [];
  const solidQueueRows: number[] = [];
  const solidQueueDepths: number[] = [];
  let qIndex = 0;

  for (const key of occupied) {
    const commaIdx = key.indexOf(',');
    const col = parseInt(key.slice(0, commaIdx), 10);
    const row = parseInt(key.slice(commaIdx + 1), 10);
    if (!_isInsideActiveRoom(col, row)) continue;

    // Solid cell is "exposed" if any 8-neighbour is a lit-air cell.
    let touchesLitAir = false;
    for (let dy = -1; dy <= 1 && !touchesLitAir; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nc = col + dx;
        const nr = row + dy;
        if (!_isInsideActiveRoom(nc, nr)) continue;
        if (litAir.has(_tileKey(nc, nr))) {
          touchesLitAir = true;
          break;
        }
      }
    }

    if (touchesLitAir) {
      depths.set(key, 0);
      solidQueueCols.push(col);
      solidQueueRows.push(row);
      solidQueueDepths.push(0);
    }
  }

  while (qIndex < solidQueueCols.length) {
    const col = solidQueueCols[qIndex];
    const row = solidQueueRows[qIndex];
    const depth = solidQueueDepths[qIndex];
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
        solidQueueCols.push(nc);
        solidQueueRows.push(nr);
        solidQueueDepths.push(nextDepth);
      }
    }
  }

  // Solid cells never reached by the flood are authored dark pockets
  // (enclosed by walls or by a blocker field). Assign the maximum fallback
  // depth so the darkness tint saturates.
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

/**
 * Returns the per-tile ambient-light depth map for the current lighting
 * configuration, memoised per `(roomSize × direction × blockerSet)` so the
 * common "camera panning, nothing changed" path costs one Map lookup.
 *
 * When the layout cache itself is rebuilt (signature change — e.g. a
 * breakable wall's AABB was zeroed on destruction), this memo is discarded
 * along with the rest of the layout, so light spills into newly opened
 * pockets on the next frame.
 */
function _getAmbientDepths(layout: CachedWallLayout): Map<string, number> {
  const memoKey = `${_activeRoomWidthBlocks}x${_activeRoomHeightBlocks}|${_activeAmbientDirection}|${_activeAmbientBlockerSig}`;
  const cached = layout.ambientDepthsByKey.get(memoKey);
  if (cached !== undefined) return cached;

  const depths = _buildAmbientDepths(layout.occupied, _activeAmbientBlockerKeys, _activeAmbientDirection);
  layout.ambientDepthsByKey.set(memoKey, depths);
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

/** Builds the 2×2 solid-wall top-left map from raw wall data. Called once per layout build. */
function _buildSolid2x2Map(walls: WallSnapshot, blockSizePx: number): Map<string, number> {
  const topLeftMap = new Map<string, number>();
  if (blockSizePx !== 8) return topLeftMap;

  for (let wi = 0; wi < walls.count; wi++) {
    if (walls.isPlatformFlag[wi] === 1) continue;
    if (walls.isInvisibleFlag[wi] === 1) continue;

    const colStart = Math.floor(walls.xWorld[wi] / blockSizePx);
    const rowStart = Math.floor(walls.yWorld[wi] / blockSizePx);
    const colCount = Math.max(1, Math.ceil((walls.xWorld[wi] + walls.wWorld[wi]) / blockSizePx) - colStart);
    const rowCount = Math.max(1, Math.ceil((walls.yWorld[wi] + walls.hWorld[wi]) / blockSizePx) - rowStart);
    // Tile the wall into non-overlapping 2×2 sub-blocks. Any trailing
    // odd column or row falls through to the 1×1 rendering path because
    // those cells are never added to _coveredBy2x2Keys.
    for (let r = 0; r + 1 < rowCount; r += 2) {
      for (let c = 0; c + 1 < colCount; c += 2) {
        topLeftMap.set(_tileKey(colStart + c, rowStart + r), walls.themeIndex[wi]);
      }
    }
  }

  return topLeftMap;
}

// ── Per-frame reusable collections (pre-allocated to avoid GC pressure) ───────

/**
 * Reusable Set identifying tiles covered by a 2×2 full-sprite block.
 * Cleared and repopulated each frame from `wallLayout.solid2x2Map` —
 * avoids creating a new Set<string> every render call.
 */
const _coveredBy2x2Keys = new Set<string>();

/**
 * Populates `_coveredBy2x2Keys` from the layout's `solid2x2Map`.
 * Must be called before the tile-draw loop each frame.
 */
function _populateCoveredBy2x2Keys(
  solid2x2Map: Map<string, number>,
  blockSizePx: number,
  roomTheme: BlockTheme | null,
): void {
  _coveredBy2x2Keys.clear();
  for (const [topLeftKey, wallThemeIdx] of solid2x2Map) {
    const resolvedTheme: BlockTheme | null = wallThemeIdx !== WALL_THEME_DEFAULT_INDEX
      ? indexToBlockTheme(wallThemeIdx)
      : roomTheme;
    if (!_themeSupports2x2(resolvedTheme, blockSizePx)) continue;
    const commaIdx = topLeftKey.indexOf(',');
    const col = parseInt(topLeftKey.slice(0, commaIdx), 10);
    const row = parseInt(topLeftKey.slice(commaIdx + 1), 10);
    _coveredBy2x2Keys.add(_tileKey(col, row));
    _coveredBy2x2Keys.add(_tileKey(col + 1, row));
    _coveredBy2x2Keys.add(_tileKey(col, row + 1));
    _coveredBy2x2Keys.add(_tileKey(col + 1, row + 1));
  }
}

// ── Wall layer bake cache ─────────────────────────────────────────────────────

/**
 * Pre-rendered offscreen canvas holding the fully composited wall layer for the
 * current room.  Built once when sprites are ready; blitted cheaply each frame.
 * Replaced whenever `_bakedWallLayoutRef` or `_bakedWallScalePx` changes, or
 * when `_invalidateBakedWallCanvas()` is called on room/theme/lighting updates.
 */
let _bakedWallCanvas: HTMLCanvasElement | null = null;
/**
 * Reference to the `CachedWallLayout` that was used to build `_bakedWallCanvas`.
 * Identity comparison (`===`) in `renderWallSprites` detects wall-layout changes
 * without rebuilding a long signature string on every fast-path frame.
 */
let _bakedWallLayoutRef: CachedWallLayout | null = null;
/**
 * The `scalePx` value used when building `_bakedWallCanvas`.
 * Included in the validity check alongside `_bakedWallLayoutRef`.
 */
let _bakedWallScalePx = 0;
/**
 * True when the current `_bakedWallCanvas` was rendered with at least one
 * fallback tile (sprite still loading).  Triggers a re-bake next frame so that
 * the canvas is refreshed once all sprites have loaded.
 */
let _bakedWallHadFallbacks = false;
/**
 * Tracks whether the current bake pass used any fallback tiles.
 * Set to false at the start of each `_doRenderWallTilesDirect` call; set to
 * true by any code path that falls back to placeholder drawing.
 */
let _bakePassHadFallbacks = false;

/** Invalidates the baked wall canvas so it will be rebuilt on the next render. */
function _invalidateBakedWallCanvas(): void {
  _bakedWallCanvas = null;
  _bakedWallLayoutRef = null;
  _bakedWallScalePx = 0;
  _bakedWallHadFallbacks = false;
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

  const wallLayout = _buildWallLayoutCache(walls, blockSizePx);

  // Populate module-level coveredBy2x2Keys from the cached solid2x2Map —
  // avoids allocating a new Set<string> every frame.
  _populateCoveredBy2x2Keys(wallLayout.solid2x2Map, blockSizePx, _activeBlockTheme);

  // Compute ambient depths for the currently-active lighting mode, except
  // for 'DarkRoom' (handled by full-screen overlay) and 'FullyLit' (no tint
  // applied at all — see `isBlockTintEnabled` below).
  const ambientDepths = (_activeLightingEffect !== 'DarkRoom' && _activeLightingEffect !== 'FullyLit')
    ? _getAmbientDepths(wallLayout)
    : null;

  // Fast path: blit the pre-rendered canvas when the layout, scale, and
  // rendering configuration are all unchanged and no sprite fallbacks remain.
  // Uses object-reference comparison for the layout (no string allocation) since
  // `_buildWallLayoutCache` returns the same object when the signature is stable.
  // Theme/lighting/world changes are detected via `_invalidateBakedWallCanvas()`
  // which nulls `_bakedWallCanvas` before we reach this check.
  const bakeCurrentMatch =
    _bakedWallCanvas !== null &&
    _bakedWallLayoutRef === wallLayout &&
    _bakedWallScalePx === scalePx;

  if (bakeCurrentMatch && !_bakedWallHadFallbacks) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(_bakedWallCanvas!, Math.round(offsetXPx), Math.round(offsetYPx));
    ctx.restore();
    return;
  }

  // Determine or create the offscreen bake canvas.
  // When the match is current but had fallbacks we reuse the existing canvas
  // (same size) and re-render into it this frame.
  let bakeCanvas: HTMLCanvasElement;
  if (bakeCurrentMatch) {
    bakeCanvas = _bakedWallCanvas!;
  } else {
    // Layout or scale changed — allocate a fresh canvas sized to the room
    // bounds in virtual pixels (scalePx ≈ 1.0 always).
    const roomW = Math.max(1, Math.ceil(_activeRoomWidthBlocks * blockSizePx * scalePx));
    const roomH = Math.max(1, Math.ceil(_activeRoomHeightBlocks * blockSizePx * scalePx));
    bakeCanvas = document.createElement('canvas');
    bakeCanvas.width = roomW;
    bakeCanvas.height = roomH;
  }

  const bakeCtx = bakeCanvas.getContext('2d');
  if (bakeCtx === null) {
    // Context unavailable — render directly without baking.
    _doRenderWallTilesDirect(ctx, walls, wallLayout, ambientDepths, offsetXPx, offsetYPx, scalePx, blockSizePx);
    return;
  }

  // Render all tiles into the bake canvas at world origin (offset = 0, 0).
  bakeCtx.clearRect(0, 0, bakeCanvas.width, bakeCanvas.height);
  _doRenderWallTilesDirect(bakeCtx, walls, wallLayout, ambientDepths, 0, 0, scalePx, blockSizePx);

  // Commit the bake (even if fallbacks were used — they'll be corrected on the
  // next frame once the sprites finish loading).
  _bakedWallCanvas = bakeCanvas;
  _bakedWallLayoutRef = wallLayout;
  _bakedWallScalePx = scalePx;
  _bakedWallHadFallbacks = _bakePassHadFallbacks;

  // Blit the freshly-baked canvas to the target context.
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bakeCanvas, Math.round(offsetXPx), Math.round(offsetYPx));
  ctx.restore();
}

/**
 * Draws all wall tiles, platforms, ramps, and half-pillars into `ctx`.
 *
 * `offsetXPx` / `offsetYPx` are applied to every tile position, allowing the
 * function to render either directly to the virtual canvas (with camera offset)
 * or to the bake canvas at origin (offset = 0, 0).
 *
 * Sets `_bakePassHadFallbacks = true` whenever a sprite is not yet loaded and
 * a placeholder tile is drawn instead.  The caller uses this to decide whether
 * to re-bake on the next frame.
 */
function _doRenderWallTilesDirect(
  ctx:                   CanvasRenderingContext2D,
  walls:                 WallSnapshot,
  wallLayout:            CachedWallLayout,
  ambientDepths:         Map<string, number> | null,
  offsetXPx:             number,
  offsetYPx:             number,
  scalePx:               number,
  blockSizePx:           number,
): void {
  _bakePassHadFallbacks = false;

  const tileSizeScreen = blockSizePx * scalePx;

  // Determine rendering mode: room-level default theme
  const roomTheme = _activeBlockTheme;
  // In world-number mode, world 0 uses blackRock sprites (legacy behaviour)
  const isLegacyBlackRock = (roomTheme === null) && (_activeWorldNumber === 0);
  // World-number mode for worlds 1+ uses the world-specific sprite set
  const isWorldMode = (roomTheme === null) && !isLegacyBlackRock;

  // Per-tile block tinting is skipped for:
  //   - 'DarkRoom':  a full-screen darkness overlay handles it globally.
  //   - 'FullyLit':  intentionally no ambient shading at all (metroidvania-
  //                  style straightforward lighting, §7 of the spec).
  const isBlockTintEnabled =
    _activeLightingEffect !== 'DarkRoom' && _activeLightingEffect !== 'FullyLit';

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  // Draw 2×2 full sprites.
  // blackRock: procedural sprite from 2×2 base pool + 2×2 block template.
  // brownRock / dirt: single dedicated 16×16 flat sprite (legacy).
  if (_coveredBy2x2Keys.size > 0) {
    const drawSize = tileSizeScreen * 2;
    for (const [topLeftKey, wallThemeIdx] of wallLayout.solid2x2Map) {
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
          _bakePassHadFallbacks = true;
          _drawFallbackTile(ctx, tileX, tileY, drawSize);
        }
      } else {
        // Legacy flat-sprite path (brownRock, dirt).
        const sprite = _getFullSpriteFor2x2(resolvedTheme, blockSizePx);
        if (sprite !== null && isSpriteReady(sprite)) {
          ctx.drawImage(sprite, tileX, tileY, drawSize, drawSize);
        } else {
          _bakePassHadFallbacks = true;
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

    if (_coveredBy2x2Keys.has(tileKey)) {
      if (isBlockTintEnabled) {
        const airDepth = (ambientDepths?.get(tileKey) ?? 0);
        const darknessAlpha = _getDarknessAlphaFromAirDepth(airDepth);
        if (darknessAlpha > 0) {
          ctx.fillStyle = `rgba(0,0,0,${darknessAlpha})`;
          ctx.fillRect(tileX, tileY, tileSizeScreen, tileSizeScreen);
        }
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
        _bakePassHadFallbacks = true;
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
        _bakePassHadFallbacks = true;
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
        _bakePassHadFallbacks = true;
        _drawFallbackTile(ctx, tileX, tileY, tileSizeScreen);
      }
    }

    if (isBlockTintEnabled) {
      const airDepth = (ambientDepths?.get(tileKey) ?? 0);
      const darknessAlpha = _getDarknessAlphaFromAirDepth(airDepth);
      if (darknessAlpha > 0) {
        ctx.fillStyle = `rgba(0,0,0,${darknessAlpha})`;
        ctx.fillRect(tileX, tileY, tileSizeScreen, tileSizeScreen);
      }
    }

    // Draw vertex overlays only in world 1+ legacy mode (those worlds have vertex.png).
    // Theme-based modes and world-0 blackRock do not use vertex overlays.
    if (isWorldMode && spec.variant === 'corner') {
      if (!isSpriteReady(_sprites.vertex)) {
        _bakePassHadFallbacks = true;
      } else {
        _drawVertexOverlays(
          ctx, wallLayout.occupied, col, row, tileX, tileY, tileSizeScreen,
          northSolid, eastSolid, southSolid, westSolid,
        );
      }
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
        _bakePassHadFallbacks = true;
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
    if (isBlockTintEnabled) {
      const airDepth = (ambientDepths?.get(tileKey) ?? 0);
      const darknessAlpha = _getDarknessAlphaFromAirDepth(airDepth);
      if (darknessAlpha > 0) {
        ctx.fillStyle = `rgba(0,0,0,${darknessAlpha})`;
        ctx.fillRect(tileX, tileY, tileSizeScreen, tileSizeScreen);
      }
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
        _bakePassHadFallbacks = true;
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
