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
} from './wallTileDrawHelpers';

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

  // Fast path: blit the pre-rendered canvas when the layout, scale, and
  // rendering configuration are all unchanged and no sprite fallbacks remain.
  // Uses object-reference comparison for the layout (no string allocation) since
  // `getWallLayoutCache` returns the same object when the signature is stable.
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
      if (!themeSupports2x2(resolvedTheme, blockSizePx)) continue;

      const commaIdx = topLeftKey.indexOf(',');
      const col = parseInt(topLeftKey.slice(0, commaIdx), 10);
      const row = parseInt(topLeftKey.slice(commaIdx + 1), 10);
      const tileX = Math.round(col * blockSizePx * scalePx + offsetXPx);
      const tileY = Math.round(row * blockSizePx * scalePx + offsetYPx);

      const material = themeToProceduralMaterial(resolvedTheme, _activeWorldNumber);
      if (material !== null) {
        // Procedural path: base sprite cut with 2×2 block template.
        // Compute open-air sides for the 2×2 group: a side is open when ALL
        // cells along that border have no solid neighbor on that edge.
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
        const procSprite = getBlockSprite2x2(col, row, material, blockSizePx, _activeWorldNumber, openAirSidesMask2x2);
        if (procSprite !== null) {
          ctx.drawImage(procSprite, tileX, tileY, drawSize, drawSize);
        } else {
          _bakePassHadFallbacks = true;
          drawFallbackTile(ctx, tileX, tileY, drawSize);
        }
      } else {
        // Legacy flat-sprite path (brownRock, dirt).
        const sprite = getFullSpriteFor2x2(resolvedTheme, blockSizePx);
        if (sprite !== null && isSpriteReady(sprite)) {
          ctx.drawImage(sprite, tileX, tileY, drawSize, drawSize);
        } else {
          _bakePassHadFallbacks = true;
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
      // Only apply the inversion filter on sides that are actually open to air.
      const openAirSidesMask =
        (northSolid ? 0 : OPEN_AIR_SIDE_N) |
        (eastSolid  ? 0 : OPEN_AIR_SIDE_E) |
        (southSolid ? 0 : OPEN_AIR_SIDE_S) |
        (westSolid  ? 0 : OPEN_AIR_SIDE_W);
      const procSprite = getBlockSprite1x1(col, row, material, blockSizePx, _activeWorldNumber, openAirSidesMask);
      if (procSprite !== null) {
        ctx.drawImage(procSprite, tileX, tileY, tileSizeScreen, tileSizeScreen);
      } else {
        _bakePassHadFallbacks = true;
        drawFallbackTile(ctx, tileX, tileY, tileSizeScreen);
      }
    } else if (!tileIsLegacyBlackRock && tileTheme !== null) {
      // Legacy flat-sprite / auto-tiling path (brownRock, dirt).
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
        _bakePassHadFallbacks = true;
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
        _bakePassHadFallbacks = true;
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
        _bakePassHadFallbacks = true;
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

    const tileX = Math.round(col * blockSizePx * scalePx + offsetXPx);
    const tileY = Math.round(row * blockSizePx * scalePx + offsetYPx);

    // platformEdge is stored in the tile from the cache building pass (no per-draw wall scan).
    const platformEdgeForTile = tile.platformEdge;

    // Resolve theme for this platform tile.
    const platTheme: BlockTheme | null = wallLayout.tileTheme.get(key) ?? roomTheme;
    const platMaterial = themeToProceduralMaterial(platTheme, _activeWorldNumber);

    if (platMaterial !== null) {
      // Procedural path (blackRock): base sprite cut with platform template.
      const procSprite = getPlatformSprite1x1(col, row, platMaterial, blockSizePx, platformEdgeForTile, _activeWorldNumber);
      if (procSprite !== null) {
        ctx.drawImage(procSprite, tileX, tileY, tileSizeScreen, tileSizeScreen);
      } else {
        // Fallback: thin solid-color line while sprites are loading.
        _bakePassHadFallbacks = true;
        ctx.fillStyle = '#8899aa';
        drawPlatformLine(ctx, tileX, tileY, tileSizeScreen, platformEdgeForTile, scalePx);
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
        _bakePassHadFallbacks = true;
        drawRampTriangle(ctx, wxPx, wyPx, wwPx, whPx, ori, '#1a2535', '#5080b0', scalePx);
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
