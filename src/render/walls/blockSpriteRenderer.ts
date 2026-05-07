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
  getBlockSprite2x2,
  getPlatformSprite1x1,
  getPlatformSpriteFromBaseUrl,
  getRampSprite,
  OPEN_AIR_SIDE_N,
  OPEN_AIR_SIDE_E,
  OPEN_AIR_SIDE_S,
  OPEN_AIR_SIDE_W,
} from './proceduralBlockSprite';
import {
  buildAmbientDepths,
  getDarknessAlphaFromAirDepth,
} from './ambientLightDepths';
import {
  isSpriteReady,
  BlockSpriteSet,
  getBlockSpriteSet,
  getFullSpriteFor2x2,
  themeSupports2x2,
  getSpriteForLegacyTheme,
  themeToProceduralMaterial,
} from './blockSpriteSets';
import {
  isFolderBasedTheme,
  getTheme1x1Sprite,
  getTheme2x2Sprite,
  getTheme1x1SpriteShaded,
  getTheme2x2SpriteShaded,
  getFolderThemeBaseUrl,
} from './folderBlockThemes';
import {
  CachedWallLayout,
  wallTileKey,
  isWallOccupied,
  getWallLayoutCache,
} from './blockWallLayoutCache';
import {
  TILE_MASK_N,
  TILE_MASK_E,
  TILE_MASK_S,
  TILE_MASK_W,
  TILE_TABLE,
  drawFallbackTile,
  drawVertexOverlays,
  drawPlatformLine,
  drawRampTriangle,
  applyRampClipPath,
} from './wallTileDrawHelpers';

/** Active sprite set for world-number mode. */
let _sprites: BlockSpriteSet = getBlockSpriteSet(0);
let _activeWorldNumber = 0;

/**
 * Active block theme.  When non-null, theme-based rendering overrides the
 * world-number-based sprite selection.
 */
let _activeBlockTheme: BlockTheme | null = null;

/** Dev-mode set of theme keys that have already triggered a missing-sprite warning. */
const _warnedMissingThemes: Set<string> = import.meta.env.DEV ? new Set() : (null as unknown as Set<string>);
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
let _vpW = 480;
let _vpH = 270;

/**
 * Update the viewport size used for chunk visibility culling.
 * Must be called from renderFrame() before renderWalls() each frame.
 */
export function setRenderViewportSize(vpW: number, vpH: number): void {
  _vpW = vpW;
  _vpH = vpH;
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
    _vpW,
    _vpH,
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
  filterColMin          = 0,
  filterColMax          = 0x7FFFFFFF,
  filterRowMin          = 0,
  filterRowMax          = 0x7FFFFFFF,
): boolean {
  let _hadFallbacks = false;

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
      if (!themeSupports2x2(resolvedTheme, blockSizePx)) continue;

      const commaIdx = topLeftKey.indexOf(',');
      const col = parseInt(topLeftKey.slice(0, commaIdx), 10);
      const row = parseInt(topLeftKey.slice(commaIdx + 1), 10);

      // A 2×2 block spans [col, col+1] × [row, row+1].  Include in every
      // chunk that overlaps its footprint so canvas auto-clipping splits it
      // cleanly at chunk boundaries.
      if (col + 1 < filterColMin || col > filterColMax) continue;
      if (row + 1 < filterRowMin || row > filterRowMax) continue;

      const tileX = Math.round(col * blockSizePx * scalePx + offsetXPx);
      const tileY = Math.round(row * blockSizePx * scalePx + offsetYPx);

      const material = themeToProceduralMaterial(resolvedTheme, _activeWorldNumber);

      // Compute open-air sides for the 2×2 group: a side is open when ALL
      // cells along that border have no solid neighbour on that edge.
      // Used by both the procedural and folder-based paths.
      const northOpenA = !isWallOccupied(wallLayout.occupied, col,     row - 1);
      const northOpenB = !isWallOccupied(wallLayout.occupied, col + 1, row - 1);
      const southOpenA = !isWallOccupied(wallLayout.occupied, col,     row + 2);
      const southOpenB = !isWallOccupied(wallLayout.occupied, col + 1, row + 2);
      const eastOpenA  = !isWallOccupied(wallLayout.occupied, col + 2, row    );
      const eastOpenB  = !isWallOccupied(wallLayout.occupied, col + 2, row + 1);
      const westOpenA  = !isWallOccupied(wallLayout.occupied, col - 1, row    );
      const westOpenB  = !isWallOccupied(wallLayout.occupied, col - 1, row + 1);
      const openAirSidesMask2x2 =
        ((northOpenA && northOpenB) ? OPEN_AIR_SIDE_N : 0) |
        ((eastOpenA  && eastOpenB)  ? OPEN_AIR_SIDE_E : 0) |
        ((southOpenA && southOpenB) ? OPEN_AIR_SIDE_S : 0) |
        ((westOpenA  && westOpenB)  ? OPEN_AIR_SIDE_W : 0);

      if (material !== null) {
        // Procedural path: base sprite cut with 2×2 block template.
        const procSprite = getBlockSprite2x2(col, row, material, blockSizePx, _activeWorldNumber, openAirSidesMask2x2);
        if (procSprite !== null) {
          ctx.drawImage(procSprite, tileX, tileY, drawSize, drawSize);
        } else {
          _hadFallbacks = true;
          drawFallbackTile(ctx, tileX, tileY, drawSize);
        }
      } else {
        // Legacy flat-sprite path (brownRock, dirt) and folder-based themes.
        const sprite = getFullSpriteFor2x2(resolvedTheme, blockSizePx);
        if (sprite !== null && isSpriteReady(sprite)) {
          ctx.drawImage(sprite, tileX, tileY, drawSize, drawSize);
        } else if (isFolderBasedTheme(resolvedTheme)) {
          // Folder-based theme: use edge-shaded 16×16 canvas for the 2×2 group.
          const folderSprite = getTheme2x2SpriteShaded(resolvedTheme, col, row, _activeWorldNumber, openAirSidesMask2x2, blockSizePx);
          if (folderSprite !== null) {
            ctx.drawImage(folderSprite, tileX, tileY, drawSize, drawSize);
          } else {
            _hadFallbacks = true;
            drawFallbackTile(ctx, tileX, tileY, drawSize);
          }
        } else {
          _hadFallbacks = true;
          drawFallbackTile(ctx, tileX, tileY, drawSize);
        }
      }
    }
  }

  for (let ti = 0; ti < wallLayout.occupiedTiles.length; ti++) {
    const tile = wallLayout.occupiedTiles[ti];
    const key = tile.key;
    const col = tile.col;
    const row = tile.row;

    // Skip tiles entirely outside this chunk's tile range.
    if (col < filterColMin || col > filterColMax) continue;
    if (row < filterRowMin || row > filterRowMax) continue;

    const northSolid = isWallOccupied(wallLayout.occupied, col,     row - 1);
    const eastSolid  = isWallOccupied(wallLayout.occupied, col + 1, row    );
    const southSolid = isWallOccupied(wallLayout.occupied, col,     row + 1);
    const westSolid  = isWallOccupied(wallLayout.occupied, col - 1, row    );

    const mask =
      (northSolid ? TILE_MASK_N : 0) |
      (eastSolid  ? TILE_MASK_E : 0) |
      (southSolid ? TILE_MASK_S : 0) |
      (westSolid  ? TILE_MASK_W : 0);

    const spec = TILE_TABLE[mask];

    // Convert world-space tile position to screen space for smooth scrolling
    const tileX  = Math.round(col * blockSizePx * scalePx + offsetXPx);
    const tileY  = Math.round(row * blockSizePx * scalePx + offsetYPx);
    const tileKey = key;

    if (_coveredBy2x2Keys.has(tileKey)) {
      if (isBlockTintEnabled) {
        const airDepth = (ambientDepths?.get(tileKey) ?? 0);
        const darknessAlpha = getDarknessAlphaFromAirDepth(airDepth);
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

    const material = themeToProceduralMaterial(tileTheme, _activeWorldNumber);

    if (material !== null) {
      // Procedural path (blackRock): base sprite cut with 1×1 block template.
      // Edge shading is only applied on sides that are actually open to air
      // so adjacent same-material blocks share a seamless join.
      const openAirSidesMask =
        (northSolid ? 0 : OPEN_AIR_SIDE_N) |
        (eastSolid  ? 0 : OPEN_AIR_SIDE_E) |
        (southSolid ? 0 : OPEN_AIR_SIDE_S) |
        (westSolid  ? 0 : OPEN_AIR_SIDE_W);
      const procSprite = getBlockSprite1x1(col, row, material, blockSizePx, _activeWorldNumber, openAirSidesMask);
      if (procSprite !== null) {
        ctx.drawImage(procSprite, tileX, tileY, tileSizeScreen, tileSizeScreen);
      } else {
        _hadFallbacks = true;
        drawFallbackTile(ctx, tileX, tileY, tileSizeScreen);
      }
    } else if (isFolderBasedTheme(tileTheme)) {
      // Folder-based theme: use edge-shaded 8×8 canvas for 1×1 tiles.
      // Shading uses the same openAirSidesMask as the procedural path so
      // solid-neighbour sides do not get a dark seam.
      const openAirSidesMask =
        (northSolid ? 0 : OPEN_AIR_SIDE_N) |
        (eastSolid  ? 0 : OPEN_AIR_SIDE_E) |
        (southSolid ? 0 : OPEN_AIR_SIDE_S) |
        (westSolid  ? 0 : OPEN_AIR_SIDE_W);
      const folderSprite = getTheme1x1SpriteShaded(tileTheme, col, row, _activeWorldNumber, openAirSidesMask, blockSizePx);
      if (folderSprite !== null) {
        ctx.drawImage(folderSprite, tileX, tileY, tileSizeScreen, tileSizeScreen);
      } else {
        _hadFallbacks = true;
        drawFallbackTile(ctx, tileX, tileY, tileSizeScreen);
      }
    } else if (!tileIsLegacyBlackRock && tileTheme !== null) {
      // Legacy flat-sprite / auto-tiling path (brownRock, dirt).
      if (import.meta.env.DEV && !isFolderBasedTheme(tileTheme)) {
        const warnKey = `1x1:${tileTheme}`;
        if (!_warnedMissingThemes.has(warnKey)) {
          _warnedMissingThemes.add(warnKey);
          console.warn(
            `[blockSpriteRenderer] No procedural or folder-based sprite for theme '${tileTheme}' ` +
            `(shape: 1×1 block, world: ${_activeWorldNumber}). ` +
            'Add a sprite folder under ASSETS/SPRITES/BLOCKS/<themeId>/ or check the theme ID spelling.',
          );
        }
      }
      const img = getSpriteForLegacyTheme(tileTheme, spec.variant, blockSizePx);
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
        _hadFallbacks = true;
        drawFallbackTile(ctx, tileX, tileY, tileSizeScreen);
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
        _hadFallbacks = true;
        drawFallbackTile(ctx, tileX, tileY, tileSizeScreen);
      }
    }

    if (isBlockTintEnabled) {
      const airDepth = (ambientDepths?.get(tileKey) ?? 0);
      const darknessAlpha = getDarknessAlphaFromAirDepth(airDepth);
      if (darknessAlpha > 0) {
        ctx.fillStyle = `rgba(0,0,0,${darknessAlpha})`;
        ctx.fillRect(tileX, tileY, tileSizeScreen, tileSizeScreen);
      }
    }

    // Draw vertex overlays only in world 1+ legacy mode (those worlds have vertex.png).
    // Theme-based modes and world-0 blackRock do not use vertex overlays.
    if (isWorldMode && spec.variant === 'corner') {
      if (!isSpriteReady(_sprites.vertex)) {
        _hadFallbacks = true;
      } else {
        drawVertexOverlays(
          ctx, _sprites.vertex, wallLayout.occupied, col, row, tileX, tileY, tileSizeScreen,
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

    // Skip platform tiles outside this chunk's range.
    if (col < filterColMin || col > filterColMax) continue;
    if (row < filterRowMin || row > filterRowMax) continue;

    const tileX = Math.round(col * blockSizePx * scalePx + offsetXPx);
    const tileY = Math.round(row * blockSizePx * scalePx + offsetYPx);

    // platformEdge is stored in the tile from the cache building pass (no per-draw wall scan).
    const platformEdgeForTile = tile.platformEdge;

    // Resolve theme for this platform tile.
    const platTheme: BlockTheme | null = wallLayout.tileTheme.get(key) ?? roomTheme;
    const platMaterial = themeToProceduralMaterial(platTheme, _activeWorldNumber);

    // Track whether we drew a proper sprite so we know when to show the fallback line.
    let platformDrawn = false;

    if (platMaterial !== null) {
      // Procedural path (blackRock): base sprite cut with 1×1 platform template.
      const procSprite = getPlatformSprite1x1(col, row, platMaterial, blockSizePx, platformEdgeForTile, _activeWorldNumber);
      if (procSprite !== null) {
        ctx.drawImage(procSprite, tileX, tileY, tileSizeScreen, tileSizeScreen);
        platformDrawn = true;
      } else {
        // Sprites still loading — schedule a re-bake.
        _hadFallbacks = true;
      }
    } else if (isFolderBasedTheme(platTheme)) {
      // Folder-based theme: apply the platform template cookie-cutter to the folder sprite.
      // A direct base URL is used instead of the probe-pool system.
      // isFolderBasedTheme guarantees platTheme is a non-null string here.
      const folderThemeId = platTheme as string;
      const baseUrl = getFolderThemeBaseUrl(folderThemeId, col, row, _activeWorldNumber);
      if (baseUrl !== null) {
        const folderSprite = getPlatformSpriteFromBaseUrl(baseUrl, col, row, blockSizePx, platformEdgeForTile, _activeWorldNumber);
        if (folderSprite !== null) {
          ctx.drawImage(folderSprite, tileX, tileY, tileSizeScreen, tileSizeScreen);
          platformDrawn = true;
        } else {
          // Sprites still loading — schedule a re-bake.
          _hadFallbacks = true;
        }
      }
    }

    if (!platformDrawn) {
      // Fallback: thin solid-color line for legacy themes (brownRock, dirt, non-zero worlds)
      // or while base/template sprites are still loading.
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
      drawPlatformLine(ctx, tileX, tileY, tileSizeScreen, platformEdgeForTile, scalePx);
    }

    const tileKey = key;
    if (isBlockTintEnabled) {
      const airDepth = (ambientDepths?.get(tileKey) ?? 0);
      const darknessAlpha = getDarknessAlphaFromAirDepth(airDepth);
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

    // Skip ramps whose entire tile footprint is outside this chunk.
    // A ramp may span multiple blocks (1×1, 1×2, 2×1, 2×2); include it in
    // every chunk it overlaps and rely on canvas auto-clipping for the rest.
    const rampColFirst = Math.floor(walls.xWorld[wi] / blockSizePx);
    const rampRowFirst = Math.floor(walls.yWorld[wi] / blockSizePx);
    const rampColLast  = Math.ceil((walls.xWorld[wi] + walls.wWorld[wi]) / blockSizePx) - 1;
    const rampRowLast  = Math.ceil((walls.yWorld[wi] + walls.hWorld[wi]) / blockSizePx) - 1;
    if (rampColLast < filterColMin || rampColFirst > filterColMax) continue;
    if (rampRowLast < filterRowMin || rampRowFirst > filterRowMax) continue;

    // Resolve theme for this ramp wall.
    const rampTheme: BlockTheme | null = walls.themeIndex[wi] !== WALL_THEME_DEFAULT_INDEX
      ? indexToBlockTheme(walls.themeIndex[wi])
      : roomTheme;
    const rampMaterial = themeToProceduralMaterial(rampTheme, _activeWorldNumber);

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
        _hadFallbacks = true;
        drawRampTriangle(ctx, wxPx, wyPx, wwPx, whPx, ori, '#1a2535', '#5080b0', scalePx);
      }
    } else if (isFolderBasedTheme(rampTheme)) {
      // Folder-based theme: clip canvas to triangle shape, then draw the flat sprite inside.
      const rCol = Math.floor(walls.xWorld[wi] / blockSizePx);
      const rRow = Math.floor(walls.yWorld[wi] / blockSizePx);
      const use2x2 = Math.round(walls.wWorld[wi] / blockSizePx) >= 2 ||
                     Math.round(walls.hWorld[wi] / blockSizePx) >= 2;
      const folderRampSprite = use2x2
        ? getTheme2x2Sprite(rampTheme, rCol, rRow, _activeWorldNumber)
        : getTheme1x1Sprite(rampTheme, rCol, rRow, _activeWorldNumber);
      if (folderRampSprite !== null) {
        const rX = Math.round(wxPx);
        const rY = Math.round(wyPx);
        const rW = Math.round(wwPx);
        const rH = Math.round(whPx);
        ctx.save();
        applyRampClipPath(ctx, rX, rY, rW, rH, ori);
        ctx.clip();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(folderRampSprite, rX, rY, rW, rH);
        ctx.restore();
      } else {
        _hadFallbacks = true;
        drawRampTriangle(ctx, wxPx, wyPx, wwPx, whPx, ori, '#555555', '#777777', scalePx);
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
      drawRampTriangle(ctx, wxPx, wyPx, wwPx, whPx, ori, fillColor, edgeColor, scalePx);
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

    // Skip pillars outside this chunk.
    const pillarColFirst = Math.floor(walls.xWorld[wi] / blockSizePx);
    const pillarRowFirst = Math.floor(walls.yWorld[wi] / blockSizePx);
    const pillarColLast  = Math.ceil((walls.xWorld[wi] + walls.wWorld[wi]) / blockSizePx) - 1;
    const pillarRowLast  = Math.ceil((walls.yWorld[wi] + walls.hWorld[wi]) / blockSizePx) - 1;
    if (pillarColLast < filterColMin || pillarColFirst > filterColMax) continue;
    if (pillarRowLast < filterRowMin || pillarRowFirst > filterRowMax) continue;

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
  return _hadFallbacks;
}
