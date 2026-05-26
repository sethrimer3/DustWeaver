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
import { RoomChunkCache, CHUNK_SIZE_BLOCKS, PrewarmChunkResult } from './chunkRenderCache';
import {
  getBgBlockLayout,
  getCellsForChunk,
  invalidateBgBlockLayout,
} from './backgroundBlockLayoutCache';

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
  invalidateBgBlockLayout();
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
  // Also invalidate layout cache since content has changed.
  invalidateBgBlockLayout();
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

// ── Background block prewarm store ────────────────────────────────────────────

const _prewarmBgCaches = new Map<string, RoomChunkCache>();

/** Dummy 1×1 canvas used as a throw-away blit target during bg prewarming. */
let _prewarmBgDummyCtx: CanvasRenderingContext2D | null = null;
function _getBgPrewarmDummyCtx(): CanvasRenderingContext2D {
  if (_prewarmBgDummyCtx === null) {
    const c = document.createElement('canvas');
    c.width  = 1;
    c.height = 1;
    _prewarmBgDummyCtx = c.getContext('2d') as CanvasRenderingContext2D;
  }
  return _prewarmBgDummyCtx;
}

/**
 * Builds a chunk-rendering closure for `room`'s background blocks.
 * Extracted to share logic between the live render and prewarm paths.
 *
 * The closure uses {@link getBgBlockLayout} to look up only the cells that
 * fall inside the target chunk instead of scanning all block definitions.
 */
function _makeBgBuildChunkFn(
  roomBlocks: RoomDef['backgroundBlocks'],
  roomBlockTheme: string | null,
  seed: number,
  zoom: number,
): (
  chunkCtx: CanvasRenderingContext2D,
  chunkOffX: number,
  chunkOffY: number,
  _scalePx: number,
  _bsz: number,
  colMin: number,
  rowMin: number,
  colMax: number,
  rowMax: number,
) => boolean {
  // Layout is computed lazily inside the returned function so that per-frame
  // calls to _makeBgBuildChunkFn do not pay the O(backgroundBlocks) signature
  // cost when no chunk needs to rebuild.
  let layout: ReturnType<typeof getBgBlockLayout> | null = null;

  return (chunkCtx, chunkOffX, chunkOffY, _scalePx, _bsz, colMin, rowMin, _colMax, _rowMax) => {
    if (!roomBlocks || roomBlocks.length === 0) return false;
    let hadFallbacks = false;
    chunkCtx.imageSmoothingEnabled = false;

    const cellW = CELL_SIZE_WORLD * zoom;
    const sw    = Math.ceil(cellW);

    // Derive the chunk coordinates from colMin / rowMin (one chunk assumed).
    const cx = Math.floor(colMin / CHUNK_SIZE_BLOCKS);
    const cy = Math.floor(rowMin / CHUNK_SIZE_BLOCKS);

    // Compute layout on first actual rebuild and cache it in the closure.
    if (layout === null) {
      layout = getBgBlockLayout(roomBlocks, roomBlockTheme);
    }
    const cells = getCellsForChunk(layout, cx, cy);

    for (let ci = 0; ci < cells.length; ci++) {
      const { col, row, themeId } = cells[ci];

      const sx = Math.round(col * cellW + chunkOffX);
      const sy = Math.round(row * cellW + chunkOffY);

      if (isFolderBasedTheme(themeId)) {
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
          chunkCtx.fillStyle = FALLBACK_FILL;
          chunkCtx.fillRect(sx, sy, sw, sw);
          hadFallbacks = true;
        }
      } else {
        chunkCtx.fillStyle = FALLBACK_FILL;
        chunkCtx.fillRect(sx, sy, sw, sw);
      }
    }

    return hadFallbacks;
  };
}

/**
 * Pre-builds background block chunks for a room that is not currently active.
 *
 * Safe to call multiple times — the prewarm cache persists between calls so
 * subsequent calls can expand coverage outward.
 *
 * @returns Number of new chunks actually built.
 */
export function prewarmBgChunksForRoom(
  room: RoomDef,
  zoom: number,
  offsetXPx: number,
  offsetYPx: number,
  vpWPx: number,
  vpHPx: number,
  maxChunks: number,
): PrewarmChunkResult {
  const blocks = room.backgroundBlocks;
  if (!blocks || blocks.length === 0) {
    return { rebuilt: 0, skipped: 0, totalChunks: 0, dirtyChunks: 0 };
  }

  let tempCache = _prewarmBgCaches.get(room.id);
  if (tempCache === undefined) {
    tempCache = new RoomChunkCache(true);
    _prewarmBgCaches.set(room.id, tempCache);
  }
  tempCache.setMaxChunksPerFrame(maxChunks);

  const buildFn = _makeBgBuildChunkFn(blocks, room.blockTheme ?? null, room.worldNumber ?? 0, zoom);
  const dummyCtx = _getBgPrewarmDummyCtx();

  tempCache.renderVisibleChunks(
    dummyCtx,
    room,            // layoutRef: same object used on actual render → identity preserved
    offsetXPx,
    offsetYPx,
    zoom,
    CELL_SIZE_WORLD,
    vpWPx,
    vpHPx,
    buildFn,
  );

  return {
    rebuilt:     tempCache.stats.rebuiltThisFrame,
    skipped:     tempCache.stats.skippedThisFrame,
    totalChunks: tempCache.stats.totalChunkCount,
    dirtyChunks: tempCache.stats.dirtyChunkCount,
  };
}

/**
 * Adopts pre-warmed background block chunks for a room the player is about to enter.
 *
 * Injects pre-built canvases into the active `_bgChunkCache` and sets the
 * room reference so the first `renderBackgroundBlocks` call skips the
 * invalidation check.
 *
 * Must be called after any explicit cache invalidation (e.g. room change) but
 * BEFORE the first render frame for the new room.
 *
 * @returns `true` when pre-warmed data was found and adopted; `false` otherwise.
 */
export function adoptPrewarmedBgChunks(room: RoomDef, zoom: number): boolean {
  const tempCache = _prewarmBgCaches.get(room.id);
  if (tempCache === undefined) return false;

  const chunks = tempCache.extractCleanChunks();
  if (chunks.size > 0) {
    _bgChunkCache.injectWarmedChunks(chunks, room, zoom);
    // Mark room ref so renderBackgroundBlocks skips its invalidation check.
    _bgCacheRoomRef = room.id;
  }

  _prewarmBgCaches.delete(room.id);
  return chunks.size > 0;
}

/** Discards pre-warmed background block chunks for `roomId` without adopting them. */
export function evictPrewarmedBgChunks(roomId: string): void {
  _prewarmBgCaches.delete(roomId);
}

/** Returns `true` when pre-warmed background block data exists for `roomId`. */
export function hasPrewarmedBgChunks(roomId: string): boolean {
  return _prewarmBgCaches.has(roomId);
}

/** Returns the list of room IDs that currently have pre-warmed background block chunks. */
export function listPrewarmedBgRoomIds(): string[] {
  return Array.from(_prewarmBgCaches.keys());
}

/**
 * Returns per-room prewarm bg stats for `roomId`, or `null` when not held.
 * Used by the eviction pass to compute per-room memory.
 */
export function getPrewarmBgRoomStats(roomId: string): { chunks: number; memoryKB: number } | null {
  const cache = _prewarmBgCaches.get(roomId);
  if (cache === undefined) return null;
  return { chunks: cache.stats.totalChunkCount, memoryKB: cache.stats.memoryEstimateKB };
}

/**
 * Returns aggregate stats across all currently-held background prewarm caches.
 * Used by the debug overlay.
 */
export function getPrewarmBgStats(): { roomCount: number; totalChunks: number; memoryEstimateKB: number } {
  let totalChunks = 0;
  let memoryEstimateKB = 0;
  for (const cache of _prewarmBgCaches.values()) {
    totalChunks      += cache.stats.totalChunkCount;
    memoryEstimateKB += cache.stats.memoryEstimateKB;
  }
  return { roomCount: _prewarmBgCaches.size, totalChunks, memoryEstimateKB };
}

/**
 * Cheap read-only viewport coverage probe for the **active** background chunk
 * cache, including the `CHUNK_MARGIN` safety ring.
 *
 * Returns `true` immediately when the room has no background blocks (nothing
 * to warm).  Returns `false` if the zoom has changed or if any visible-plus-margin
 * chunk is missing, dirty, or has pending fallback sprites.  Does **not** build
 * any canvases.
 */
export function isBgActiveViewportCovered(
  room: RoomDef,
  offsetXPx: number,
  offsetYPx: number,
  vpWPx: number,
  vpHPx: number,
  scalePx: number,
): boolean {
  const blocks = room.backgroundBlocks;
  if (!blocks || blocks.length === 0) return true;
  return _bgChunkCache.isViewportCovered(
    offsetXPx,
    offsetYPx,
    vpWPx,
    vpHPx,
    scalePx,
    CELL_SIZE_WORLD,
  );
}

/**
 * Like `isBgActiveViewportCovered` but checks only the **core** visible range
 * (no margin).  Intended for DEV diagnostics only — always use
 * `isBgActiveViewportCovered` for production readiness decisions.
 */
export function isBgCoreViewportCovered(
  room: RoomDef,
  offsetXPx: number,
  offsetYPx: number,
  vpWPx: number,
  vpHPx: number,
  scalePx: number,
): boolean {
  const blocks = room.backgroundBlocks;
  if (!blocks || blocks.length === 0) return true;
  return _bgChunkCache.isViewportCoreCovered(
    offsetXPx,
    offsetYPx,
    vpWPx,
    vpHPx,
    scalePx,
    CELL_SIZE_WORLD,
  );
}



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
  const buildFn = _makeBgBuildChunkFn(blocks, room.blockTheme ?? null, seed, zoom);

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
    buildFn,
  );

  ctx.restore();
}
