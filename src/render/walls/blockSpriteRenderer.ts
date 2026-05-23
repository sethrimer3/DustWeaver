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
import { CHUNK_SIZE_BLOCKS } from './chunkRenderCache';
export type { ChunkCacheStats } from './chunkRenderCache';
import type { BlockTheme, LightingEffect, AmbientLightDirection } from '../../levels/roomDef';
import { indexToBlockTheme, WALL_THEME_DEFAULT_INDEX } from '../../levels/roomDef';
import {
  buildAmbientDarknessAlphas,
  DEFAULT_DIRECTIONAL_BIAS,
  DEFAULT_SIDE_EXPOSURE_STRENGTH,
  DEFAULT_MINIMUM_WALL_LIGHT,
  DEFAULT_FALLOFF_POWER,
} from './ambientLightDepths';
import {
  BlockSpriteSet,
  getBlockSpriteSet,
  themeSupports2x2,
  themeToProceduralMaterial,
} from './blockSpriteSets';
import {
  CachedWallLayout,
  wallTileKey,
  getWallLayoutCache,
} from './blockWallLayoutCache';
import { renderSingleExtensionTileWithState } from './extensionTileRenderer';
import {
  type WallTilePassContext,
  render2x2Pass,
  render1x1Pass,
  renderPlatformPass,
  renderRampPass,
  renderHalfPillarPass,
} from './wallTilePassRenderers';

// Re-export dark-blocker helpers so existing call-sites keep their import path.
export { setActiveDarkAmbientBlockers, renderDarkAmbientBlockerOverlay } from './darkBlockerOverlay';

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

// ── Directional-lighting blend parameters ────────────────────────────────────
let _activeDirectionalBias       = DEFAULT_DIRECTIONAL_BIAS;
let _activeSideExposureStrength  = DEFAULT_SIDE_EXPOSURE_STRENGTH;
let _activeMinimumWallLight      = DEFAULT_MINIMUM_WALL_LIGHT;
let _activeFalloffPower          = DEFAULT_FALLOFF_POWER;

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
 * @param directionalBias       0 = broad ambient, 1 = strict spotlight.
 * @param sideExposureStrength  Contribution of non-sky-connected air neighbours.
 * @param minimumWallLight      Brightness floor for air-adjacent tiles (0–1).
 * @param falloffPower          Exponent on the raw exposure value.
 */
export function setActiveBlockLighting(
  effect: LightingEffect,
  roomWidthBlocks: number,
  roomHeightBlocks: number,
  direction?: AmbientLightDirection,
  ambientBlockers?: ReadonlySet<string>,
  directionalBias?: number,
  sideExposureStrength?: number,
  minimumWallLight?: number,
  falloffPower?: number,
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

  _activeDirectionalBias      = directionalBias      ?? DEFAULT_DIRECTIONAL_BIAS;
  _activeSideExposureStrength = sideExposureStrength  ?? DEFAULT_SIDE_EXPOSURE_STRENGTH;
  _activeMinimumWallLight     = minimumWallLight      ?? DEFAULT_MINIMUM_WALL_LIGHT;
  _activeFalloffPower         = falloffPower          ?? DEFAULT_FALLOFF_POWER;

  _invalidateBakedWallCanvas();
}

// ── Per-frame reusable collections (pre-allocated to avoid GC pressure) ───────

/**
 * Returns the per-tile darkness-alpha map for the current lighting
 * configuration, memoised per `(roomSize × direction × blockerSet × params)` so
 * the common "camera panning, nothing changed" path costs one Map lookup.
 *
 * When the layout cache itself is rebuilt (signature change — e.g. a
 * breakable wall's AABB was zeroed on destruction), this memo is discarded
 * along with the rest of the layout, so light spills into newly opened
 * pockets on the next frame.
 */
function _getAmbientDepths(layout: CachedWallLayout): Map<string, number> {
  const memoKey = `${_activeRoomWidthBlocks}x${_activeRoomHeightBlocks}|${_activeAmbientDirection}|${_activeAmbientBlockerSig}|${_activeDirectionalBias}|${_activeSideExposureStrength}|${_activeMinimumWallLight}|${_activeFalloffPower}`;
  const cached = layout.ambientDepthsByKey.get(memoKey);
  if (cached !== undefined) return cached;

  const depths = buildAmbientDarknessAlphas(
    layout.occupied,
    _activeAmbientBlockerKeys,
    _activeAmbientDirection,
    _activeRoomWidthBlocks,
    _activeRoomHeightBlocks,
    _activeDirectionalBias,
    _activeSideExposureStrength,
    _activeMinimumWallLight,
    _activeFalloffPower,
  );
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
 * Set the maximum memory budget for the wall chunk render cache.
 * Call this when graphics quality changes to cap GPU/CPU canvas memory usage.
 *
 * Suggested values:
 *   Low:    4096 KB
 *   Medium: 8192 KB
 *   High:  16384 KB
 */
export function setWallChunkCacheMemoryKB(kb: number): void {
  _chunkCache.setMaxMemoryKB(kb);
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

  // Derive the chunk key when called from the chunk cache (filterColMax is finite).
  // This allows the five render passes to use pre-bucketed per-chunk tile lists
  // instead of scanning the full room arrays (O(chunk-items) vs O(all-tiles)).
  const chunkKey: string | null = filterColMaxBlocks < 0x7FFFFFFF
    ? `${(filterColMinBlocks / CHUNK_SIZE_BLOCKS) | 0},${(filterRowMinBlocks / CHUNK_SIZE_BLOCKS) | 0}`
    : null;

  const pctx: WallTilePassContext = {
    walls, wallLayout, ambientDepths,
    offsetXPx, offsetYPx, scalePx, blockSizePx,
    filterColMinBlocks, filterColMaxBlocks, filterRowMinBlocks, filterRowMaxBlocks,
    tileSizeScreen, roomTheme, isWorldMode, isBlockTintEnabled,
    activeWorldNumber: _activeWorldNumber,
    sprites: _sprites,
    coveredBy2x2Keys: _coveredBy2x2Keys,
    chunkKey,
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
  renderSingleExtensionTileWithState(
    ctx,
    _activeBlockTheme,
    _activeWorldNumber,
    _sprites,
    col,
    row,
    theme,
    occupancy,
    ox,
    oy,
    scale,
    blockSizePx,
    darknessAlpha,
  );
}
