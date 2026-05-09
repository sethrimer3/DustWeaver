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
 * Static wall content is split into 32×32-block chunks backed by small
 * offscreen canvases.  Only camera-visible chunks are blitted per frame;
 * dirty chunks (e.g. after a tile edit) are rebuilt on demand.  This avoids
 * single room-sized canvases that exceed browser memory limits for large rooms.
 */

import { WallSnapshot } from '../snapshot';
import { RoomChunkCache } from './chunkRenderCache';
export type { ChunkCacheStats } from './chunkRenderCache';
import type { BlockTheme, LightingEffect, AmbientLightDirection } from '../../levels/roomDef';
import { indexToBlockTheme, WALL_THEME_DEFAULT_INDEX } from '../../levels/roomDef';
import {
  getBlockSprite1x1,
  OPEN_AIR_SIDE_N,
  OPEN_AIR_SIDE_E,
  OPEN_AIR_SIDE_S,
  OPEN_AIR_SIDE_W,
} from './proceduralBlockSprite';
import {
  buildAmbientDepths,
} from './ambientLightDepths';
import {
  isSpriteReady,
  BlockSpriteSet,
  getBlockSpriteSet,
  themeSupports2x2,
  getSpriteForLegacyTheme,
  themeToProceduralMaterial,
} from './blockSpriteSets';
import {
  isFolderBasedTheme,
  getTheme1x1SpriteShaded,
} from './folderBlockThemes';
import {
  CachedWallLayout,
  wallTileKey,
  getWallLayoutCache,
} from './blockWallLayoutCache';
import {
  drawFallbackTile,
  TILE_MASK_N,
  TILE_MASK_E,
  TILE_MASK_S,
  TILE_MASK_W,
  TILE_TABLE,
} from './wallTileDrawHelpers';
import {
  type WallTilePassContext,
  render2x2Pass,
  render1x1Pass,
  renderPlatformPass,
  renderRampPass,
  renderHalfPillarPass,
} from './wallTilePassRenderers';

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
 * Returns the procedural material name currently active for block rendering,
 * based on the active block theme and world number set via
 * {@link setActiveBlockSpriteTheme} / {@link setActiveBlockSpriteWorld}.
 *
 * Returns null when no procedural material applies (e.g. folder-based themes,
 * legacy brownRock, dirt, or non-zero world numbers without an explicit theme).
 *
 * Used by falling block renderers that need to match the room's block visuals.
 */
export function getActiveProceduralMaterial(): string | null {
  return themeToProceduralMaterial(_activeBlockTheme, _activeWorldNumber);
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

// ── Per-frame reusable collections (pre-allocated to avoid GC pressure) ───────

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

  const depths = buildAmbientDepths(layout.occupied, _activeAmbientBlockerKeys, _activeAmbientDirection, _activeRoomWidthBlocks, _activeRoomHeightBlocks);
  layout.ambientDepthsByKey.set(memoKey, depths);
  return depths;
}

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
    if (!themeSupports2x2(resolvedTheme, blockSizePx)) continue;
    const commaIdx = topLeftKey.indexOf(',');
    const col = parseInt(topLeftKey.slice(0, commaIdx), 10);
    const row = parseInt(topLeftKey.slice(commaIdx + 1), 10);
    _coveredBy2x2Keys.add(wallTileKey(col, row));
    _coveredBy2x2Keys.add(wallTileKey(col + 1, row));
    _coveredBy2x2Keys.add(wallTileKey(col, row + 1));
    _coveredBy2x2Keys.add(wallTileKey(col + 1, row + 1));
  }
}

// ── Chunk-based wall cache ────────────────────────────────────────────────────

/**
 * Chunk-based wall render cache.  Replaces the former single-canvas bake with
 * many small per-chunk canvases so:
 *   • Only camera-visible chunks are blitted each frame.
 *   • Only dirty chunks are rebuilt (e.g. one tile changed → one chunk rebuilt).
 *   • Very large rooms never require a room-sized canvas.
 *
 * Owned by this module; invalidated via _invalidateBakedWallCanvas() whenever
 * theme, lighting, or wall layout changes (same call-sites as before).
 */
const _chunkCache = new RoomChunkCache();

/**
 * Viewport dimensions used for visible-chunk range computation.
 * Set once per frame by setRenderViewportSize() called from gameRender.ts
 * before the walls pass.  Defaults cover the standard 480×270 virtual canvas
 * so any call-site that omits the explicit setter still works correctly.
 */
let _vpWPx = 480;
let _vpHPx = 270;

/**
 * Update the viewport size used for chunk visibility culling.
 * Must be called from renderFrame() before renderWalls() each frame.
 */
export function setRenderViewportSize(vpW: number, vpH: number): void {
  _vpWPx = vpW;
  _vpHPx = vpH;
}

/** Returns the current chunk-cache diagnostic counters for the debug overlay. */
export function getChunkCacheStats(): import('./chunkRenderCache').ChunkCacheStats {
  return _chunkCache.stats;
}

/**
 * Marks every chunk overlapping the given tile rectangle dirty so only those
 * chunks are rebuilt the next time they are visible.
 * Useful for targeted invalidation when the editor changes a small tile region.
 */
export function invalidateChunkRect(
  colMin: number,
  rowMin: number,
  colMax: number,
  rowMax: number,
): void {
  _chunkCache.invalidateBlockRect(colMin, rowMin, colMax, rowMax);
}

/** Invalidates the chunk cache so all chunks are rebuilt on the next render. */
function _invalidateBakedWallCanvas(): void {
  _chunkCache.invalidateAll();
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

  const wallLayout = getWallLayoutCache(walls, blockSizePx);

  // Populate module-level coveredBy2x2Keys from the cached solid2x2Map —
  // avoids allocating a new Set<string> every frame.
  _populateCoveredBy2x2Keys(wallLayout.solid2x2Map, blockSizePx, _activeBlockTheme);

  // Compute ambient depths for the currently-active lighting mode, except
  // for 'DarkRoom' (handled by full-screen overlay) and 'FullyLit' (no tint
  // applied at all — see `isBlockTintEnabled` below).
  const ambientDepths = (_activeLightingEffect !== 'DarkRoom' && _activeLightingEffect !== 'FullyLit')
    ? _getAmbientDepths(wallLayout)
    : null;

  // Render visible chunks via the chunk cache.
  // Each dirty chunk is built by calling _doRenderWallTilesDirect with that
  // chunk's tile-range filter and per-chunk canvas offset.  Clean chunks are
  // blitted cheaply with a single drawImage call.
  _chunkCache.renderVisibleChunks(
    ctx,
    wallLayout,   // identity used for layout-change detection
    offsetXPx,
    offsetYPx,
    scalePx,
    blockSizePx,
    _vpWPx,
    _vpHPx,
    (chunkCtx, chunkOffX, chunkOffY, s, bsz, colMin, rowMin, colMax, rowMax) =>
      _doRenderWallTilesDirect(
        chunkCtx,
        walls,
        wallLayout,
        ambientDepths,
        chunkOffX,
        chunkOffY,
        s,
        bsz,
        colMin,
        colMax,
        rowMin,
        rowMax,
      ),
  );
}

/**
 * Draws wall tiles, platforms, ramps, and half-pillars into `ctx`.
 *
 * `offsetXPx` / `offsetYPx` are applied to every tile position.  When called
 * from the chunk cache the offsets are set so that tiles at (colMin, rowMin)
 * land at canvas origin (0, 0).
 *
 * The optional `filterCol/RowMin/Max` parameters limit rendering to the tile
 * range covered by one chunk.  Elements whose entire AABB falls outside the
 * range are skipped (O(tiles_in_chunk) cost after filtering).  Elements that
 * straddle a chunk boundary are included in every chunk they overlap; the
 * chunk canvas auto-clips any overhang, so no artefact results.
 *
 * Returns `true` when any sprite was still loading and a placeholder was
 * drawn; the chunk cache uses this to schedule a rebuild on the next frame.
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
  filterColMinBlocks          = 0,
  filterColMaxBlocks          = 0x7FFFFFFF,
  filterRowMinBlocks          = 0,
  filterRowMaxBlocks          = 0x7FFFFFFF,
): boolean {
  const tileSizeScreen = blockSizePx * scalePx;
  const roomTheme = _activeBlockTheme;
  const isLegacyBlackRock = (roomTheme === null) && (_activeWorldNumber === 0);
  const isWorldMode = (roomTheme === null) && !isLegacyBlackRock;
  const isBlockTintEnabled =
    _activeLightingEffect !== 'DarkRoom' && _activeLightingEffect !== 'FullyLit';

  const pctx: WallTilePassContext = {
    walls, wallLayout, ambientDepths,
    offsetXPx, offsetYPx, scalePx, blockSizePx,
    filterColMinBlocks, filterColMaxBlocks, filterRowMinBlocks, filterRowMaxBlocks,
    tileSizeScreen, roomTheme, isWorldMode, isBlockTintEnabled,
    activeWorldNumber: _activeWorldNumber,
    sprites: _sprites,
    coveredBy2x2Keys: _coveredBy2x2Keys,
  };

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  let hadFallbacks = false;
  hadFallbacks = render2x2Pass(ctx, pctx)      || hadFallbacks;
  hadFallbacks = render1x1Pass(ctx, pctx)      || hadFallbacks;
  hadFallbacks = renderPlatformPass(ctx, pctx) || hadFallbacks;
  hadFallbacks = renderRampPass(ctx, pctx)     || hadFallbacks;
  hadFallbacks = renderHalfPillarPass(ctx, pctx) || hadFallbacks;

  ctx.restore();
  return hadFallbacks;
}

// ── Extension tile sprite renderer ────────────────────────────────────────────

/**
 * Renders a single extension tile using the same sprite selection logic as
 * the main wall tile renderer, but without requiring a full WallSnapshot or
 * CachedWallLayout.
 *
 * The caller supplies:
 *  - `occupancy`     — a set of "col,row" keys for all tiles that should be
 *                      treated as solid for neighbour-mask computation.  Must
 *                      include the solid extension tiles AND the adjacent room
 *                      edge cells (provided via {@link EdgeExtensionCache.occupancySet}).
 *  - `theme`         — per-tile theme override; null means "use room default"
 *                      (resolved via the module-level `_activeBlockTheme`).
 *  - `darknessAlpha` — 0–1 overlay applied after the sprite draw.  Pass 0 to
 *                      skip the tint.
 *
 * Called by {@link renderEdgeExtension} for every solid extension tile.
 *
 * @param ctx           Virtual canvas 2D context.
 * @param col           Tile column (may be outside room bounds).
 * @param row           Tile row (may be outside room bounds).
 * @param theme         Per-tile theme override (null = room default).
 * @param occupancy     Solid-tile occupancy set for neighbour lookups.
 * @param ox            Camera X offset (world-to-screen, virtual pixels).
 * @param oy            Camera Y offset (world-to-screen, virtual pixels).
 * @param scale         Zoom factor (world units → virtual pixels).
 * @param blockSizePx   Block size in world units (e.g. BLOCK_SIZE_SMALL = 8).
 * @param darknessAlpha Darkness overlay alpha (0 = none, 1 = fully black).
 */
export function renderSingleExtensionTile(
  ctx:          CanvasRenderingContext2D,
  col:          number,
  row:          number,
  theme:        string | null,
  occupancy:    ReadonlySet<string>,
  ox:           number,
  oy:           number,
  scale:        number,
  blockSizePx:  number,
  darknessAlpha: number,
): void {
  const tileSizePx = blockSizePx * scale;
  const tileX = Math.round(col * blockSizePx * scale + ox);
  const tileY = Math.round(row * blockSizePx * scale + oy);

  // Resolve effective tile theme: use override, then room default.
  const tileTheme: import('../../levels/roomDef').BlockTheme | null =
    (theme as import('../../levels/roomDef').BlockTheme | null) ?? _activeBlockTheme;

  // Compute 4-neighbour occupancy mask from the supplied set.
  const northSolid = occupancy.has(`${col},${row - 1}`);
  const eastSolid  = occupancy.has(`${col + 1},${row}`);
  const southSolid = occupancy.has(`${col},${row + 1}`);
  const westSolid  = occupancy.has(`${col - 1},${row}`);

  const mask =
    (northSolid ? TILE_MASK_N : 0) |
    (eastSolid  ? TILE_MASK_E : 0) |
    (southSolid ? TILE_MASK_S : 0) |
    (westSolid  ? TILE_MASK_W : 0);
  const spec = TILE_TABLE[mask];

  // Open-air-sides mask for edge-shading (opposite of solid-neighbours).
  const openAirSidesMask =
    (northSolid ? 0 : OPEN_AIR_SIDE_N) |
    (eastSolid  ? 0 : OPEN_AIR_SIDE_E) |
    (southSolid ? 0 : OPEN_AIR_SIDE_S) |
    (westSolid  ? 0 : OPEN_AIR_SIDE_W);

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  const material = themeToProceduralMaterial(tileTheme, _activeWorldNumber);

  if (material !== null) {
    // Procedural path (e.g. blackRock): base sprite cut with 1×1 block template.
    const procSprite = getBlockSprite1x1(col, row, material, blockSizePx, _activeWorldNumber, openAirSidesMask);
    if (procSprite !== null) {
      ctx.drawImage(procSprite, tileX, tileY, tileSizePx, tileSizePx);
    } else {
      drawFallbackTile(ctx, tileX, tileY, tileSizePx);
    }
  } else if (isFolderBasedTheme(tileTheme)) {
    // Folder-based theme: use edge-shaded 8×8 canvas for 1×1 tiles.
    const folderSprite = getTheme1x1SpriteShaded(tileTheme, col, row, _activeWorldNumber, openAirSidesMask, blockSizePx);
    if (folderSprite !== null) {
      ctx.drawImage(folderSprite, tileX, tileY, tileSizePx, tileSizePx);
    } else {
      drawFallbackTile(ctx, tileX, tileY, tileSizePx);
    }
  } else if (tileTheme !== null) {
    // Legacy flat-sprite path (brownRock, dirt).
    const img = getSpriteForLegacyTheme(tileTheme, spec.variant, blockSizePx);
    if (isSpriteReady(img)) {
      if (tileTheme === 'brownRock' || spec.rotationRad === 0) {
        ctx.drawImage(img, tileX, tileY, tileSizePx, tileSizePx);
      } else {
        const halfSz = Math.round(tileSizePx * 0.5);
        const cx = Math.round(tileX + tileSizePx * 0.5);
        const cy = Math.round(tileY + tileSizePx * 0.5);
        ctx.translate(cx, cy);
        ctx.rotate(spec.rotationRad);
        ctx.drawImage(img, -halfSz, -halfSz, tileSizePx, tileSizePx);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    } else {
      drawFallbackTile(ctx, tileX, tileY, tileSizePx);
    }
  } else {
    // World-number legacy path (world 0 = blackRock via legacy set, world 1+ = world sprites).
    const img = _sprites[spec.variant];
    if (isSpriteReady(img)) {
      if (spec.rotationRad === 0) {
        ctx.drawImage(img, tileX, tileY, tileSizePx, tileSizePx);
      } else {
        const halfSz = Math.round(tileSizePx * 0.5);
        const cx = Math.round(tileX + tileSizePx * 0.5);
        const cy = Math.round(tileY + tileSizePx * 0.5);
        ctx.translate(cx, cy);
        ctx.rotate(spec.rotationRad);
        ctx.drawImage(img, -halfSz, -halfSz, tileSizePx, tileSizePx);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    } else {
      drawFallbackTile(ctx, tileX, tileY, tileSizePx);
    }
  }

  // Apply darkness tint overlay.
  if (darknessAlpha > 0) {
    ctx.fillStyle = `rgba(0,0,0,${darknessAlpha})`;
    ctx.fillRect(tileX, tileY, tileSizePx, tileSizePx);
  }

  ctx.restore();
}
