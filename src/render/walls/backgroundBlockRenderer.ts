/**
 * backgroundBlockRenderer.ts — Renders visual-only background blocks.
 *
 * Background blocks have no collision; they sit behind foreground walls and
 * gameplay elements as decorative texture fills.  Light-blocking variants
 * also participate in the ambient lighting system (handled by gameScreen.ts).
 *
 * Rendering strategy per block cell:
 *   1. If the block's theme (or the room's default theme) is folder-based,
 *      attempt to obtain a shaded 1×1 sprite via getTheme1x1SpriteShaded.
 *   2. If the sprite is ready, draw it at 50 % alpha so background blocks
 *      read as distinct from foreground solid walls.
 *   3. If the sprite is not yet loaded (returns null), fall back to a
 *      semi-transparent solid fill matching the block's theme tint.
 *
 * Performance (BUILD 288):
 *   Background blocks are split into CHUNK_SIZE_BLOCKS × CHUNK_SIZE_BLOCKS
 *   tile chunks backed by offscreen canvases (via RoomChunkCache).  Only
 *   camera-visible chunks are blitted per frame.  Dirty chunks are rebuilt
 *   on demand when the room or editor makes changes.
 *
 * All rendering targets the 480×270 virtual canvas (world-space coordinates).
 */

import type { RoomDef } from '../../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import {
  isFolderBasedTheme,
  getTheme1x1SpriteShaded,
} from './folderBlockThemes';
import { OPEN_AIR_ALL_SIDES } from './blockEdgeShading';
import { RoomChunkCache } from './chunkRenderCache';

/** World-space size of a single background block cell (matches 1×1 sprite). */
const CELL_SIZE_WORLD = BLOCK_SIZE_SMALL;

/** Fallback fill color for background blocks when no sprite is available. */
const FALLBACK_FILL = 'rgba(80, 80, 80, 0.35)';

// ── Module-level chunk cache ──────────────────────────────────────────────────

/** Chunk cache for background block canvases. */
const _bgChunkCache = new RoomChunkCache(true); // isBgLayer=true → FP.recordBgChunkBuild

/** The room ID used to detect room changes. */
let _bgCacheRoomRef: string | null = null;

/**
 * Invalidates all background-block chunk canvases.
 *
 * Call this whenever:
 *   - The player enters a new room.
 *   - The editor adds, removes, or edits a background block definition.
 *
 * The cache rebuilds any dirty chunk the next time it is camera-visible.
 * For targeted editor invalidation see {@link invalidateBackgroundBlockChunkRect}.
 */
export function invalidateBackgroundBlockCache(): void {
  _bgChunkCache.invalidateAll();
  _bgCacheRoomRef = null;
}

/**
 * Marks only the chunks that overlap the given tile-grid rectangle dirty.
 * Use from the editor when a small number of background block cells change.
 */
export function invalidateBackgroundBlockChunkRect(
  colMin: number,
  rowMin: number,
  colMax: number,
  rowMax: number,
): void {
  _bgChunkCache.invalidateBlockRect(colMin, rowMin, colMax, rowMax);
}

/**
 * Returns the latest chunk-cache diagnostic stats for the background block
 * renderer.  Use from the debug overlay in renderProfiler.
 */
export function getBgChunkCacheStats() {
  return _bgChunkCache.stats;
}

/**
 * Set the maximum memory budget for the background block chunk render cache.
 * Call this when graphics quality changes.
 *
 * Suggested values:
 *   Low:    2048 KB
 *   Medium: 4096 KB
 *   High:   8192 KB
 */
export function setBgChunkCacheMemoryKB(kb: number): void {
  _bgChunkCache.setMaxMemoryKB(kb);
}

// ── Public render function ────────────────────────────────────────────────────

/**
 * Renders all background blocks in `room` onto `ctx` using a chunk cache.
 *
 * Must be called BEFORE sunbeams and foreground wall passes so background
 * blocks sit behind all gameplay geometry.
 *
 * @param ctx           2D canvas context targeting the virtual (480×270) canvas.
 * @param room          Runtime room definition produced by editorRoomBuilder.
 * @param ox            Camera X offset in virtual pixels.
 * @param oy            Camera Y offset in virtual pixels.
 * @param zoom          Camera zoom (typically 1.0).
 * @param vpWPx         Viewport width in virtual pixels (default 480).
 * @param vpHPx         Viewport height in virtual pixels (default 270).
 */
export function renderBackgroundBlocks(
  ctx: CanvasRenderingContext2D,
  room: RoomDef,
  ox: number,
  oy: number,
  zoom: number,
  vpWPx = 480,
  vpHPx = 270,
): void {
  const blocks = room.backgroundBlocks;
  if (!blocks || blocks.length === 0) return;

  // Detect room changes and invalidate the cache when the room ID switches.
  if (_bgCacheRoomRef !== room.id) {
    _bgChunkCache.invalidateAll();
    _bgCacheRoomRef = room.id;
  }

  const seed = room.worldNumber ?? 0;

  // Capture room reference locally for the closure.
  const roomBlocks = blocks;
  const roomBlockTheme = room.blockTheme ?? null;

  ctx.save();
  // Background blocks are rendered at 50 % opacity.  The chunk canvases are
  // drawn at full alpha internally; globalAlpha = 0.5 is applied when
  // ctx.drawImage(chunkCanvas) is called during blitting.
  ctx.globalAlpha = 0.5;

  _bgChunkCache.renderVisibleChunks(
    ctx,
    room,               // layoutRef: identity change → all chunks dirty
    ox,
    oy,
    zoom,
    CELL_SIZE_WORLD,    // blockSizePx
    vpWPx,
    vpHPx,
    (chunkCtx, chunkOffX, chunkOffY, _scalePx, _bsz, colMin, rowMin, colMax, rowMax) => {
      let hadFallbacks = false;
      chunkCtx.imageSmoothingEnabled = false;

      const cellW = CELL_SIZE_WORLD * zoom;
      const sw    = Math.ceil(cellW);

      for (let bi = 0; bi < roomBlocks.length; bi++) {
        const b = roomBlocks[bi];
        // Quick AABB cull: skip entire block definition if it doesn't overlap
        // this chunk's tile range.
        if (b.xBlock + b.wBlock - 1 < colMin || b.xBlock > colMax) continue;
        if (b.yBlock + b.hBlock - 1 < rowMin || b.yBlock > rowMax) continue;

        const themeId       = b.blockTheme ?? roomBlockTheme;
        const useFolderSprite = isFolderBasedTheme(themeId);

        for (let dy = 0; dy < b.hBlock; dy++) {
          const row = b.yBlock + dy;
          if (row < rowMin || row > rowMax) continue;
          for (let dx = 0; dx < b.wBlock; dx++) {
            const col = b.xBlock + dx;
            if (col < colMin || col > colMax) continue;

            const sx = Math.round(col * cellW + chunkOffX);
            const sy = Math.round(row * cellW + chunkOffY);

            if (useFolderSprite) {
              const sprite = getTheme1x1SpriteShaded(
                themeId,
                col,
                row,
                seed,
                OPEN_AIR_ALL_SIDES,
                CELL_SIZE_WORLD,
              );
              if (sprite !== null) {
                chunkCtx.drawImage(sprite, sx, sy, sw, sw);
              } else {
                // Sprite still loading — draw fallback and request a rebuild
                // next frame so the final sprite appears as soon as it loads.
                chunkCtx.fillStyle = FALLBACK_FILL;
                chunkCtx.fillRect(sx, sy, sw, sw);
                hadFallbacks = true;
              }
            } else {
              chunkCtx.fillStyle = FALLBACK_FILL;
              chunkCtx.fillRect(sx, sy, sw, sw);
            }
          }
        }
      }

      return hadFallbacks;
    },
  );

  ctx.restore();
}
