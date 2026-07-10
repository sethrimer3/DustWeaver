/**
 * Wall tile rendering passes — the five sub-passes of `_doRenderWallTilesDirect`.
 *
 * Extracted from blockSpriteRenderer.ts to keep each rendering concern in a
 * focused module.  All functions receive a `WallTilePassContext` that bundles
 * the common parameters so callers do not need long argument lists.
 *
 * Pass execution order (each pass returns `true` when a placeholder was drawn):
 *   1. render2x2Pass        — 2×2 full-sprite blocks
 *   2. render1x1Pass        — 1×1 auto-tiling tiles
 *   3. renderPlatformPass   — one-way platform tiles
 *   4. renderShapedWallPass — stairs and legacy ramps (template-mask shapes)
 *   5. renderHalfPillarPass — narrow half-width pillar walls
 */

import type { WallSnapshot } from '../snapshot';
import type { BlockTheme } from '../../levels/roomDef';
import { indexToBlockTheme, WALL_THEME_DEFAULT_INDEX } from '../../levels/roomDef';
import {
  getBlockSprite1x1,
  getBlockSprite2x2,
  getPlatformSprite1x1,
  getPlatformSpriteFromBaseUrl,
  getRampSprite,
  getStairsSprite,
  OPEN_AIR_SIDE_N,
  OPEN_AIR_SIDE_E,
  OPEN_AIR_SIDE_S,
  OPEN_AIR_SIDE_W,
} from './proceduralBlockSprite';
// getDarknessAlphaFromAirDepth is no longer used here; darkness alphas are
// pre-computed by blockSpriteRenderer and passed in via ambientDepths.
import {
  isSpriteReady,
  type BlockSpriteSet,
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
import { getLegacyShadedSprite } from './legacyBlockShading';
import * as FP from '../../debug/perfFreezeProfiler';
import type { CachedWallLayout } from './blockWallLayoutCache';
import { isWallOccupied } from './blockWallLayoutCache';
import type { CachedTileCoord, ShapedWallInfo, HalfPillarWallInfo } from './blockWallLayoutCache';
import { getSurfaceMaskAtTile, type SurfaceMask } from '../../sim/world/surfaceExposure';
import { decodeStairsOrientationIndex, isStairsOrientationIndex } from '../../levels/stairsGeometry';
import { renderSurfaceEdgeOverlayPass as _renderSurfaceEdgeOverlayPass } from './surfaceEdgeOverlay';
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
  drawStairsShape,
  applyStairsClipPath,
  applyRampClipPath,
} from './wallTileDrawHelpers';

// Dev-mode set of theme keys that have already triggered a missing-sprite warning.
const _warnedMissingThemes: Set<string> = import.meta.env.DEV ? new Set() : (null as unknown as Set<string>);

// ── DEV-only open-air side diagnostic overlay ─────────────────────────────────
//
// Toggle via the browser console: `window.__dwEdgeOverlay = true`.
// Draws a bright line on each exposed (open-air) side of every 1×1 wall tile,
// straight from `openAirSidesMask` — the same value fed into
// `applyOrganicEdgeShading` — with NO sprite baking/caching in the path, so it
// proves whether the room's actual open-air detection is correct independent
// of whatever the shaded-sprite cache is doing.
//   top (N)    → bright red
//   right (E)  → bright green
//   bottom (S) → bright cyan
//   left (W)   → bright magenta
declare global {
  interface Window {
    __dwEdgeOverlay?: boolean;
  }
}

function _devEdgeOverlayEnabled(): boolean {
  return typeof window !== 'undefined' && window.__dwEdgeOverlay === true;
}

// ── DEV-only per-cell render diagnostics ──────────────────────────────────────
//
// Records, for every visible wall cell drawn this frame, which pass rendered
// it (1×1 or 2×2), its computed open-air side mask, and whether it was ever
// skipped from independent per-cell shading because it was covered by a 2×2
// full-sprite group. Query from the console:
//   window.__dwWallCellDiag(col, row)   → single-cell record
//   window.__dwWallCellDiagDump()       → console.table of everything recorded this frame
export interface WallCellRenderDiag {
  col: number;
  row: number;
  pass: '1x1' | '2x2';
  openAirSidesMask: number;
  coveredBy2x2: boolean;
}

const _wallCellDiag: Map<string, WallCellRenderDiag> = import.meta.env?.DEV ? new Map() : (null as unknown as Map<string, WallCellRenderDiag>);

function _recordWallCellDiag(
  col: number,
  row: number,
  pass: '1x1' | '2x2',
  openAirSidesMask: number,
  coveredBy2x2: boolean,
): void {
  if (!import.meta.env?.DEV) return;
  _wallCellDiag.set(`${col},${row}`, { col, row, pass, openAirSidesMask, coveredBy2x2 });
}

/** Clears the per-frame diagnostic map. Call once per frame before the wall passes run. */
export function clearWallCellDiag(): void {
  if (import.meta.env?.DEV) _wallCellDiag.clear();
}

declare global {
  interface Window {
    __dwWallCellDiag?: (col: number, row: number) => WallCellRenderDiag | undefined;
    __dwWallCellDiagDump?: () => WallCellRenderDiag[];
  }
}

if (import.meta.env?.DEV && typeof window !== 'undefined') {
  window.__dwWallCellDiag = (col: number, row: number) => _wallCellDiag.get(`${col},${row}`);
  window.__dwWallCellDiagDump = () => {
    const out = Array.from(_wallCellDiag.values());
    console.table(out);
    return out;
  };
}

function _drawEdgeOverlay(
  ctx: CanvasRenderingContext2D,
  tileX: number,
  tileY: number,
  sizePx: number,
  openAirSidesMask: number,
): void {
  ctx.save();
  ctx.lineWidth = 1;
  if (openAirSidesMask & OPEN_AIR_SIDE_N) {
    ctx.strokeStyle = '#ff0000';
    ctx.beginPath();
    ctx.moveTo(tileX, tileY + 0.5);
    ctx.lineTo(tileX + sizePx, tileY + 0.5);
    ctx.stroke();
  }
  if (openAirSidesMask & OPEN_AIR_SIDE_E) {
    ctx.strokeStyle = '#00ff00';
    ctx.beginPath();
    ctx.moveTo(tileX + sizePx - 0.5, tileY);
    ctx.lineTo(tileX + sizePx - 0.5, tileY + sizePx);
    ctx.stroke();
  }
  if (openAirSidesMask & OPEN_AIR_SIDE_S) {
    ctx.strokeStyle = '#00ffff';
    ctx.beginPath();
    ctx.moveTo(tileX, tileY + sizePx - 0.5);
    ctx.lineTo(tileX + sizePx, tileY + sizePx - 0.5);
    ctx.stroke();
  }
  if (openAirSidesMask & OPEN_AIR_SIDE_W) {
    ctx.strokeStyle = '#ff00ff';
    ctx.beginPath();
    ctx.moveTo(tileX + 0.5, tileY);
    ctx.lineTo(tileX + 0.5, tileY + sizePx);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Converts an authoritative per-tile `SurfaceMask` (from the shared
 * `surfaceExposure` module) into the legacy N/E/S/W `OPEN_AIR_SIDE_*` bit
 * mask this renderer's sprite-shading functions expect. This is the only
 * place tile-side exposure is computed for rendering purposes — both the
 * 1×1 and 2×2 passes below read it from `wallLayout.surfaceExposureMap`
 * rather than re-deriving exposure from neighbour occupancy themselves.
 */
function surfaceMaskToOpenAirBits(mask: SurfaceMask): number {
  return (mask.top    ? OPEN_AIR_SIDE_N : 0) |
         (mask.right  ? OPEN_AIR_SIDE_E : 0) |
         (mask.bottom ? OPEN_AIR_SIDE_S : 0) |
         (mask.left   ? OPEN_AIR_SIDE_W : 0);
}

// Pre-allocated empty arrays used as fallbacks when a chunk has no items of a type.
const _EMPTY_TILES: CachedTileCoord[]     = [];
const _EMPTY_SHAPED: ShapedWallInfo[]        = [];
const _EMPTY_PILLARS: HalfPillarWallInfo[] = [];
const _EMPTY_2X2: ReadonlyArray<readonly [string, number]> = [];

// ── Shared context ────────────────────────────────────────────────────────────

/**
 * Resolved rendering parameters for one `_doRenderWallTilesDirect` call.
 * Built once from the module-level state and call-site args; passed to each
 * of the five rendering pass functions.
 */
export interface WallTilePassContext {
  walls: WallSnapshot;
  wallLayout: CachedWallLayout;
  /**
   * Pre-computed per-tile darkness alpha map (0 = fully lit, 1 = pitch black).
   * Built by `blockSpriteRenderer._getAmbientDepths` via `buildAmbientDarknessAlphas`.
   * Null when tinting is globally disabled (e.g. FullyLit / DarkRoom modes).
   */
  ambientDepths: Map<string, number> | null;
  offsetXPx: number;
  offsetYPx: number;
  scalePx: number;
  blockSizePx: number;
  filterColMinBlocks: number;
  filterColMaxBlocks: number;
  filterRowMinBlocks: number;
  filterRowMaxBlocks: number;
  /** Pre-computed: `blockSizePx * scalePx`. */
  tileSizeScreen: number;
  /** Room-level block theme (null = world-number mode). */
  roomTheme: BlockTheme | null;
  /** True when world-number ≥ 1 and no explicit theme is active. */
  isWorldMode: boolean;
  /** False in DarkRoom / FullyLit modes (global overlay handles shading). */
  isBlockTintEnabled: boolean;
  activeWorldNumber: number;
  sprites: BlockSpriteSet;
  /** Keys covered by a 2×2 sprite (pre-populated by `_populateCoveredBy2x2Keys`). */
  coveredBy2x2Keys: ReadonlySet<string>;
  /**
   * Pre-bucketed chunk key for O(items-in-chunk) pass iteration.
   * Set to "${cx},${cy}" when rendering via the chunk cache.
   * null = scan the full arrays (fallback / non-chunk path).
   */
  chunkKey: string | null;
}

// ── Pass 1: 2×2 full-sprite blocks ───────────────────────────────────────────

/**
 * Draws every 2×2 full-sprite block in the layout.
 * Returns `true` if any placeholder tile was drawn (sprites still loading).
 */
export function render2x2Pass(
  ctx: CanvasRenderingContext2D,
  pctx: WallTilePassContext,
): boolean {
  let hadFallbacks = false;
  if (pctx.coveredBy2x2Keys.size === 0) return false;

  const { wallLayout, offsetXPx, offsetYPx, scalePx, blockSizePx, roomTheme,
          activeWorldNumber, filterColMinBlocks, filterColMaxBlocks,
          filterRowMinBlocks, filterRowMaxBlocks, chunkKey } = pctx;

  const drawSize = pctx.tileSizeScreen * 2;

  // Use pre-bucketed entries when rendering a specific chunk, otherwise scan
  // the full map.  The filter-bound checks below are still present as a safety
  // guard but never trigger for bucketed items (they are already pre-filtered).
  const entries: Iterable<readonly [string, number]> = chunkKey !== null
    ? (wallLayout.solid2x2ByChunkKey.get(chunkKey) ?? _EMPTY_2X2)
    : wallLayout.solid2x2Map;

  for (const [topLeftKey, wallThemeIdx] of entries) {
    const resolvedTheme: BlockTheme | null = wallThemeIdx !== WALL_THEME_DEFAULT_INDEX
      ? indexToBlockTheme(wallThemeIdx)
      : roomTheme;
    if (!themeSupports2x2(resolvedTheme, blockSizePx)) continue;

    const commaIdx = topLeftKey.indexOf(',');
    const col = parseInt(topLeftKey.slice(0, commaIdx), 10);
    const row = parseInt(topLeftKey.slice(commaIdx + 1), 10);

    // A 2×2 block spans [col, col+1] × [row, row+1].
    if (col + 1 < filterColMinBlocks || col > filterColMaxBlocks) continue;
    if (row + 1 < filterRowMinBlocks || row > filterRowMaxBlocks) continue;

    const tileX = Math.round(col * blockSizePx * scalePx + offsetXPx);
    const tileY = Math.round(row * blockSizePx * scalePx + offsetYPx);

    const material = themeToProceduralMaterial(resolvedTheme, activeWorldNumber);

    // Compute open-air sides for the 2×2 group from the authoritative
    // per-tile exposure map (same source `render1x1Pass` reads below) —
    // a side is open only when BOTH constituent cells expose that side,
    // which also makes this correctly room-bounds aware at the room edge.
    const { surfaceExposureMap } = wallLayout;
    const topLeftMask     = getSurfaceMaskAtTile(surfaceExposureMap, col,     row    );
    const topRightMask    = getSurfaceMaskAtTile(surfaceExposureMap, col + 1, row    );
    const bottomLeftMask  = getSurfaceMaskAtTile(surfaceExposureMap, col,     row + 1);
    const bottomRightMask = getSurfaceMaskAtTile(surfaceExposureMap, col + 1, row + 1);
    const openAirSidesMask2x2 =
      ((topLeftMask.top    && topRightMask.top)    ? OPEN_AIR_SIDE_N : 0) |
      ((topRightMask.right && bottomRightMask.right) ? OPEN_AIR_SIDE_E : 0) |
      ((bottomLeftMask.bottom && bottomRightMask.bottom) ? OPEN_AIR_SIDE_S : 0) |
      ((topLeftMask.left   && bottomLeftMask.left) ? OPEN_AIR_SIDE_W : 0);

    if (import.meta.env?.DEV) {
      _recordWallCellDiag(col,     row,     '2x2', openAirSidesMask2x2, true);
      _recordWallCellDiag(col + 1, row,     '2x2', openAirSidesMask2x2, true);
      _recordWallCellDiag(col,     row + 1, '2x2', openAirSidesMask2x2, true);
      _recordWallCellDiag(col + 1, row + 1, '2x2', openAirSidesMask2x2, true);
    }

    if (material !== null) {
      const procSprite = getBlockSprite2x2(col, row, material, blockSizePx, activeWorldNumber, openAirSidesMask2x2);
      if (procSprite !== null) {
        ctx.drawImage(procSprite, tileX, tileY, drawSize, drawSize);
        if (FP.consumeBudgetExhaustedFallbackFlag()) hadFallbacks = true;
      } else {
        hadFallbacks = true;
        drawFallbackTile(ctx, tileX, tileY, drawSize);
      }
    } else {
      const sprite = getFullSpriteFor2x2(resolvedTheme, blockSizePx);
      if (sprite !== null && isSpriteReady(sprite)) {
        ctx.drawImage(sprite, tileX, tileY, drawSize, drawSize);
      } else if (isFolderBasedTheme(resolvedTheme)) {
        const folderSprite = getTheme2x2SpriteShaded(resolvedTheme, col, row, activeWorldNumber, openAirSidesMask2x2, blockSizePx);
        if (folderSprite !== null) {
          ctx.drawImage(folderSprite, tileX, tileY, drawSize, drawSize);
          if (FP.consumeBudgetExhaustedFallbackFlag()) hadFallbacks = true;
        } else {
          hadFallbacks = true;
          drawFallbackTile(ctx, tileX, tileY, drawSize);
        }
      } else {
        hadFallbacks = true;
        drawFallbackTile(ctx, tileX, tileY, drawSize);
      }
    }
  }
  return hadFallbacks;
}

// ── Pass 2: 1×1 auto-tiling tiles ────────────────────────────────────────────

/**
 * Draws every 1×1 auto-tiling solid tile that is not covered by a 2×2 block.
 * Returns `true` if any placeholder tile was drawn.
 */
export function render1x1Pass(
  ctx: CanvasRenderingContext2D,
  pctx: WallTilePassContext,
): boolean {
  let hadFallbacks = false;

  const { wallLayout, ambientDepths, offsetXPx, offsetYPx, scalePx, blockSizePx,
          roomTheme, isWorldMode, isBlockTintEnabled, activeWorldNumber,
          sprites, coveredBy2x2Keys, tileSizeScreen,
          filterColMinBlocks, filterColMaxBlocks, filterRowMinBlocks, filterRowMaxBlocks,
          chunkKey } = pctx;

  // Use pre-bucketed tiles for the chunk path (O(tiles-in-chunk)); fall back to
  // the full array for non-chunk calls.
  const tiles: CachedTileCoord[] = chunkKey !== null
    ? (wallLayout.occupiedByChunkKey.get(chunkKey) ?? _EMPTY_TILES)
    : wallLayout.occupiedTiles;

  for (let ti = 0; ti < tiles.length; ti++) {
    const tile = tiles[ti];
    const key = tile.key;
    const col = tile.col;
    const row = tile.row;

    if (col < filterColMinBlocks || col > filterColMaxBlocks) continue;
    if (row < filterRowMinBlocks || row > filterRowMaxBlocks) continue;

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

    const tileX  = Math.round(col * blockSizePx * scalePx + offsetXPx);
    const tileY  = Math.round(row * blockSizePx * scalePx + offsetYPx);
    const tileKey = key;

    if (coveredBy2x2Keys.has(tileKey)) {
      if (isBlockTintEnabled) {
        const darknessAlpha = (ambientDepths?.get(tileKey) ?? 0);
        if (darknessAlpha > 0) {
          ctx.fillStyle = `rgba(0,0,0,${darknessAlpha})`;
          ctx.fillRect(tileX, tileY, tileSizeScreen, tileSizeScreen);
        }
      }
      continue;
    }

    const tileTheme: BlockTheme | null = wallLayout.tileTheme.get(tileKey) ?? roomTheme;
    const tileIsLegacyBlackRock = (tileTheme === null) && (activeWorldNumber === 0);

    const material = themeToProceduralMaterial(tileTheme, activeWorldNumber);

    // Authoritative exposure for shading/edge-effect purposes (room-bounds
    // aware) — distinct from the northSolid/eastSolid/... neighbour-solidity
    // booleans above, which still drive the TILE_TABLE auto-tiling sprite
    // pick and are unaffected by this.
    const openAirSidesMask = surfaceMaskToOpenAirBits(getSurfaceMaskAtTile(wallLayout.surfaceExposureMap, col, row));

    if (import.meta.env?.DEV) {
      _recordWallCellDiag(col, row, '1x1', openAirSidesMask, false);
    }

    if (material !== null) {
      const procSprite = getBlockSprite1x1(col, row, material, blockSizePx, activeWorldNumber, openAirSidesMask);
      if (procSprite !== null) {
        ctx.drawImage(procSprite, tileX, tileY, tileSizeScreen, tileSizeScreen);
        if (FP.consumeBudgetExhaustedFallbackFlag()) hadFallbacks = true;
      } else {
        hadFallbacks = true;
        drawFallbackTile(ctx, tileX, tileY, tileSizeScreen);
      }
    } else if (isFolderBasedTheme(tileTheme)) {
      const folderSprite = getTheme1x1SpriteShaded(tileTheme, col, row, activeWorldNumber, openAirSidesMask, blockSizePx);
      if (folderSprite !== null) {
        ctx.drawImage(folderSprite, tileX, tileY, tileSizeScreen, tileSizeScreen);
        if (FP.consumeBudgetExhaustedFallbackFlag()) hadFallbacks = true;
      } else {
        hadFallbacks = true;
        drawFallbackTile(ctx, tileX, tileY, tileSizeScreen);
      }
    } else if (!tileIsLegacyBlackRock && tileTheme !== null) {
      if (import.meta.env.DEV && !isFolderBasedTheme(tileTheme)) {
        const warnKey = `1x1:${tileTheme}`;
        if (!_warnedMissingThemes.has(warnKey)) {
          _warnedMissingThemes.add(warnKey);
          console.warn(
            `[blockSpriteRenderer] No procedural or folder-based sprite for theme '${tileTheme}' ` +
            `(shape: 1×1 block, world: ${activeWorldNumber}). ` +
            'Add a sprite folder under ASSETS/SPRITES/BLOCKS/<themeId>/ or check the theme ID spelling.',
          );
        }
      }
      const img = getSpriteForLegacyTheme(tileTheme, spec.variant, blockSizePx);
      if (isSpriteReady(img)) {
        const shaded = getLegacyShadedSprite(img, img.naturalWidth, img.naturalHeight, openAirSidesMask, col, row, activeWorldNumber, blockSizePx);
        if (FP.consumeBudgetExhaustedFallbackFlag()) hadFallbacks = true;
        if (tileTheme === 'brownRock' || spec.rotationRad === 0) {
          ctx.drawImage(shaded, tileX, tileY, tileSizeScreen, tileSizeScreen);
        } else {
          const halfSz = Math.round(tileSizeScreen * 0.5);
          const cx     = Math.round(tileX + tileSizeScreen * 0.5);
          const cy     = Math.round(tileY + tileSizeScreen * 0.5);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(spec.rotationRad);
          ctx.drawImage(shaded, -halfSz, -halfSz, tileSizeScreen, tileSizeScreen);
          ctx.restore();
        }
      } else {
        hadFallbacks = true;
        drawFallbackTile(ctx, tileX, tileY, tileSizeScreen);
      }
    } else {
      const img = sprites[spec.variant];
      if (isSpriteReady(img)) {
        const shaded = getLegacyShadedSprite(img, img.naturalWidth, img.naturalHeight, openAirSidesMask, col, row, activeWorldNumber, blockSizePx);
        if (FP.consumeBudgetExhaustedFallbackFlag()) hadFallbacks = true;
        if (spec.rotationRad === 0) {
          ctx.drawImage(shaded, tileX, tileY, tileSizeScreen, tileSizeScreen);
        } else {
          const halfSz = Math.round(tileSizeScreen * 0.5);
          const cx     = Math.round(tileX + tileSizeScreen * 0.5);
          const cy     = Math.round(tileY + tileSizeScreen * 0.5);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(spec.rotationRad);
          ctx.drawImage(shaded, -halfSz, -halfSz, tileSizeScreen, tileSizeScreen);
          ctx.restore();
        }
      } else {
        hadFallbacks = true;
        drawFallbackTile(ctx, tileX, tileY, tileSizeScreen);
      }
    }

    if (import.meta.env.DEV && _devEdgeOverlayEnabled()) {
      _drawEdgeOverlay(ctx, tileX, tileY, tileSizeScreen, openAirSidesMask);
    }

    if (isBlockTintEnabled) {
      const darknessAlpha = (ambientDepths?.get(tileKey) ?? 0);
      if (darknessAlpha > 0) {
        ctx.fillStyle = `rgba(0,0,0,${darknessAlpha})`;
        ctx.fillRect(tileX, tileY, tileSizeScreen, tileSizeScreen);
      }
    }

    // Vertex overlays only in world 1+ legacy mode.
    if (isWorldMode && spec.variant === 'corner') {
      if (!isSpriteReady(sprites.vertex)) {
        hadFallbacks = true;
      } else {
        drawVertexOverlays(
          ctx, sprites.vertex, wallLayout.occupied, col, row, tileX, tileY, tileSizeScreen,
          northSolid, eastSolid, southSolid, westSolid,
        );
      }
    }
  }
  return hadFallbacks;
}

// ── Guaranteed surface-edge overlay pass ──────────────────────────────────────
//
// Draws the exposed-edge visual straight from `wallLayout.surfaceExposureMap`
// — the authoritative tile-level open-air map — instead of relying on shading
// baked into sprite canvases. See surfaceEdgeOverlay.ts for the full rationale
// and implementation; this is a thin adapter that maps the shared
// `WallTilePassContext` onto that module's dependency-light param shape (kept
// separate so surfaceEdgeOverlay.ts stays unit-testable without pulling in the
// Vite-only folder-theme sprite loading machinery this file depends on).
export function renderSurfaceEdgeOverlayPass(
  ctx: CanvasRenderingContext2D,
  pctx: WallTilePassContext,
): void {
  _renderSurfaceEdgeOverlayPass(ctx, {
    surfaceExposureMap: pctx.wallLayout.surfaceExposureMap,
    ambientDepths: pctx.ambientDepths,
    isBlockTintEnabled: pctx.isBlockTintEnabled,
    offsetXPx: pctx.offsetXPx,
    offsetYPx: pctx.offsetYPx,
    scalePx: pctx.scalePx,
    blockSizePx: pctx.blockSizePx,
    filterColMinBlocks: pctx.filterColMinBlocks,
    filterColMaxBlocks: pctx.filterColMaxBlocks,
    filterRowMinBlocks: pctx.filterRowMinBlocks,
    filterRowMaxBlocks: pctx.filterRowMaxBlocks,
  });
}

// ── Pass 3: Platform tiles ────────────────────────────────────────────────────

/**
 * Draws all one-way platform tiles.
 * Returns `true` if any placeholder tile was drawn.
 */
export function renderPlatformPass(
  ctx: CanvasRenderingContext2D,
  pctx: WallTilePassContext,
): boolean {
  let hadFallbacks = false;

  const { wallLayout, ambientDepths, offsetXPx, offsetYPx, scalePx, blockSizePx,
          roomTheme, isBlockTintEnabled, activeWorldNumber, tileSizeScreen,
          filterColMinBlocks, filterColMaxBlocks, filterRowMinBlocks, filterRowMaxBlocks,
          chunkKey } = pctx;

  // Pre-bucketed path: only iterate platform tiles in this chunk.
  const tiles: CachedTileCoord[] = chunkKey !== null
    ? (wallLayout.platformByChunkKey.get(chunkKey) ?? _EMPTY_TILES)
    : wallLayout.platformTiles;

  for (let ti = 0; ti < tiles.length; ti++) {
    const tile = tiles[ti];
    const key = tile.key;
    const col = tile.col;
    const row = tile.row;

    if (col < filterColMinBlocks || col > filterColMaxBlocks) continue;
    if (row < filterRowMinBlocks || row > filterRowMaxBlocks) continue;

    const tileX = Math.round(col * blockSizePx * scalePx + offsetXPx);
    const tileY = Math.round(row * blockSizePx * scalePx + offsetYPx);

    const platformEdgeForTile = tile.platformEdge;
    const platTheme: BlockTheme | null = wallLayout.tileTheme.get(key) ?? roomTheme;
    const platMaterial = themeToProceduralMaterial(platTheme, activeWorldNumber);

    let platformDrawn = false;

    if (platMaterial !== null) {
      const procSprite = getPlatformSprite1x1(col, row, platMaterial, blockSizePx, platformEdgeForTile, activeWorldNumber);
      if (procSprite !== null) {
        ctx.drawImage(procSprite, tileX, tileY, tileSizeScreen, tileSizeScreen);
        platformDrawn = true;
      } else {
        hadFallbacks = true;
      }
    } else if (isFolderBasedTheme(platTheme)) {
      const folderThemeId = platTheme as string;
      const baseUrl = getFolderThemeBaseUrl(folderThemeId, col, row, activeWorldNumber);
      if (baseUrl !== null) {
        const folderSprite = getPlatformSpriteFromBaseUrl(baseUrl, col, row, blockSizePx, platformEdgeForTile, activeWorldNumber);
        if (folderSprite !== null) {
          ctx.drawImage(folderSprite, tileX, tileY, tileSizeScreen, tileSizeScreen);
          platformDrawn = true;
        } else {
          hadFallbacks = true;
        }
      }
    }

    if (!platformDrawn) {
      const isLegacyBlackRockPlatform = (platTheme === null) && (activeWorldNumber === 0);
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
      const darknessAlpha = (ambientDepths?.get(tileKey) ?? 0);
      if (darknessAlpha > 0) {
        ctx.fillStyle = `rgba(0,0,0,${darknessAlpha})`;
        ctx.fillRect(tileX, tileY, tileSizeScreen, tileSizeScreen);
      }
    }
  }
  return hadFallbacks;
}

// ── Pass 4: Shaped walls (stairs, legacy ramps) ───────────────────────────────

/**
 * Draws every wall whose solid area is not its full bounding rectangle: stairs,
 * and the legacy ramps retained for pre-existing rooms.
 *
 * Both shapes are cut from the same base texture by their template mask, so
 * transparent template pixels never draw. The stair sprite's alpha channel also
 * drives the organic edge shading, which is why each step edge is highlighted
 * rather than only the stair's outer bounding box.
 *
 * Returns `true` if any placeholder tile was drawn.
 */
export function renderShapedWallPass(
  ctx: CanvasRenderingContext2D,
  pctx: WallTilePassContext,
): boolean {
  let hadFallbacks = false;

  const { walls, wallLayout, offsetXPx, offsetYPx, scalePx, blockSizePx,
          roomTheme, activeWorldNumber,
          filterColMinBlocks, filterColMaxBlocks, filterRowMinBlocks, filterRowMaxBlocks,
          chunkKey } = pctx;

  // Pre-bucketed path: only iterate shaped walls that overlap this chunk.
  const shapedList: ShapedWallInfo[] = chunkKey !== null
    ? (wallLayout.shapedByChunkKey.get(chunkKey) ?? _EMPTY_SHAPED)
    : wallLayout.shapedWalls;

  for (let ri = 0; ri < shapedList.length; ri++) {
    const wi = shapedList[ri].wallIndex;
    const oriIndex = walls.rampOrientationIndex[wi];
    const isStairs = isStairsOrientationIndex(oriIndex);
    // Stairs and ramps share the flip convention, so both reduce to 0-3 here.
    const ori = isStairs ? decodeStairsOrientationIndex(oriIndex) : oriIndex;

    const wxPx = walls.xWorld[wi] * scalePx + offsetXPx;
    const wyPx = walls.yWorld[wi] * scalePx + offsetYPx;
    const wwPx = walls.wWorld[wi] * scalePx;
    const whPx = walls.hWorld[wi] * scalePx;
    const widthWorldPx  = walls.wWorld[wi];
    const heightWorldPx = walls.hWorld[wi];

    const colFirst = Math.floor(walls.xWorld[wi] / blockSizePx);
    const rowFirst = Math.floor(walls.yWorld[wi] / blockSizePx);
    const colLast  = Math.ceil((walls.xWorld[wi] + walls.wWorld[wi]) / blockSizePx) - 1;
    const rowLast  = Math.ceil((walls.yWorld[wi] + walls.hWorld[wi]) / blockSizePx) - 1;
    if (colLast < filterColMinBlocks || colFirst > filterColMaxBlocks) continue;
    if (rowLast < filterRowMinBlocks || rowFirst > filterRowMaxBlocks) continue;

    const theme: BlockTheme | null = walls.themeIndex[wi] !== WALL_THEME_DEFAULT_INDEX
      ? indexToBlockTheme(walls.themeIndex[wi])
      : roomTheme;
    const material = themeToProceduralMaterial(theme, activeWorldNumber);

    const drawFallbackShape = (fillColor: string, edgeColor: string): void => {
      if (isStairs) {
        drawStairsShape(ctx, wxPx, wyPx, wwPx, whPx, ori, widthWorldPx, heightWorldPx, fillColor);
      } else {
        drawRampTriangle(ctx, wxPx, wyPx, wwPx, whPx, ori, fillColor, edgeColor, scalePx);
      }
    };

    if (material !== null) {
      const col = colFirst;
      const row = rowFirst;
      const widthBlocks  = Math.max(1, Math.round(walls.wWorld[wi] / blockSizePx));
      const heightBlocks = Math.max(1, Math.round(walls.hWorld[wi] / blockSizePx));
      const procSprite = isStairs
        ? getStairsSprite(col, row, widthBlocks, heightBlocks, ori, material, blockSizePx, activeWorldNumber)
        : getRampSprite(col, row, widthBlocks, heightBlocks, ori, material, blockSizePx, activeWorldNumber);
      if (procSprite !== null) {
        ctx.drawImage(procSprite, Math.round(wxPx), Math.round(wyPx), Math.round(wwPx), Math.round(whPx));
      } else {
        hadFallbacks = true;
        drawFallbackShape('#1a2535', '#5080b0');
      }
    } else if (isFolderBasedTheme(theme)) {
      const use2x2 = Math.round(walls.wWorld[wi] / blockSizePx) >= 2 ||
                     Math.round(walls.hWorld[wi] / blockSizePx) >= 2;
      const folderSprite = use2x2
        ? getTheme2x2Sprite(theme, colFirst, rowFirst, activeWorldNumber)
        : getTheme1x1Sprite(theme, colFirst, rowFirst, activeWorldNumber);
      if (folderSprite !== null) {
        const rX = Math.round(wxPx);
        const rY = Math.round(wyPx);
        const rW = Math.round(wwPx);
        const rH = Math.round(whPx);
        ctx.save();
        if (isStairs) {
          applyStairsClipPath(ctx, rX, rY, rW, rH, ori, widthWorldPx, heightWorldPx);
        } else {
          applyRampClipPath(ctx, rX, rY, rW, rH, ori);
        }
        ctx.clip();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(folderSprite, rX, rY, rW, rH);
        ctx.restore();
      } else {
        hadFallbacks = true;
        drawFallbackShape('#555555', '#777777');
      }
    } else {
      const isLegacyBR = (theme === null) && (activeWorldNumber === 0);
      let fillColor: string;
      if (theme === 'dirt') {
        fillColor = '#5a3e1b';
      } else if (theme === 'brownRock' || (theme === null && !isLegacyBR)) {
        fillColor = '#4a3828';
      } else {
        fillColor = '#1a2535';
      }
      let edgeColor: string;
      if (theme === 'dirt') {
        edgeColor = '#8b6914';
      } else if (theme === 'brownRock' || (theme === null && !isLegacyBR)) {
        edgeColor = '#7a5840';
      } else {
        edgeColor = '#5080b0';
      }
      drawFallbackShape(fillColor, edgeColor);
    }
  }
  return hadFallbacks;
}

// ── Pass 5: Half-pillar walls ─────────────────────────────────────────────────

/**
 * Draws all half-width pillar walls as centered narrow rectangles.
 * Returns `true` if any placeholder tile was drawn (always false — pillars use
 * immediate solid-color drawing with no sprite loading).
 */
export function renderHalfPillarPass(
  ctx: CanvasRenderingContext2D,
  pctx: WallTilePassContext,
): boolean {
  const { walls, wallLayout, offsetXPx, offsetYPx, scalePx, blockSizePx,
          roomTheme, activeWorldNumber,
          filterColMinBlocks, filterColMaxBlocks, filterRowMinBlocks, filterRowMaxBlocks,
          chunkKey } = pctx;

  // Pre-bucketed path: only iterate pillars that overlap this chunk.
  const pillarList: HalfPillarWallInfo[] = chunkKey !== null
    ? (wallLayout.halfPillarByChunkKey.get(chunkKey) ?? _EMPTY_PILLARS)
    : wallLayout.halfPillarWalls;

  for (let pi = 0; pi < pillarList.length; pi++) {
    const wi = pillarList[pi].wallIndex;
    const wxPx = walls.xWorld[wi] * scalePx + offsetXPx;
    const wyPx = walls.yWorld[wi] * scalePx + offsetYPx;
    const wwPx = walls.wWorld[wi] * scalePx;
    const whPx = walls.hWorld[wi] * scalePx;

    const pillarColFirst = Math.floor(walls.xWorld[wi] / blockSizePx);
    const pillarRowFirst = Math.floor(walls.yWorld[wi] / blockSizePx);
    const pillarColLast  = Math.ceil((walls.xWorld[wi] + walls.wWorld[wi]) / blockSizePx) - 1;
    const pillarRowLast  = Math.ceil((walls.yWorld[wi] + walls.hWorld[wi]) / blockSizePx) - 1;
    if (pillarColLast < filterColMinBlocks || pillarColFirst > filterColMaxBlocks) continue;
    if (pillarRowLast < filterRowMinBlocks || pillarRowFirst > filterRowMaxBlocks) continue;

    const pillarTheme: BlockTheme | null = walls.themeIndex[wi] !== WALL_THEME_DEFAULT_INDEX
      ? indexToBlockTheme(walls.themeIndex[wi])
      : roomTheme;
    const isLegacyBR2 = (pillarTheme === null) && (activeWorldNumber === 0);
    let pillarFill: string;
    let pillarEdge: string;
    if (pillarTheme === 'dirt') {
      pillarFill = '#5a3e1b'; pillarEdge = '#8b6914';
    } else if (pillarTheme === 'brownRock' || (pillarTheme === null && !isLegacyBR2)) {
      pillarFill = '#4a3828'; pillarEdge = '#7a5840';
    } else {
      pillarFill = '#1a2535'; pillarEdge = '#5080b0';
    }

    const pillarWidthPx = wwPx;
    ctx.fillStyle = pillarFill;
    ctx.fillRect(Math.round(wxPx), Math.round(wyPx), Math.round(pillarWidthPx), Math.round(whPx));
    ctx.strokeStyle = pillarEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(wxPx) + 0.5, Math.round(wyPx) + 0.5,
      Math.round(pillarWidthPx) - 1, Math.round(whPx) - 1);
  }
  return false;
}
