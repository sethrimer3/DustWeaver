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
  getTheme1x1SpriteDarkened,
} from './folderBlockThemes';
import { recordSpriteAtlasLegacyDraw } from '../atlases/spriteAtlasLoader';
import { OPEN_AIR_ALL_SIDES } from './blockEdgeShading';
import {
  RoomChunkCache,
  CHUNK_SIZE_BLOCKS,
  PrewarmChunkResult,
  createChunkCacheOwnershipKey,
} from './chunkRenderCache';
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

if (typeof window !== 'undefined') {
  window.addEventListener('dw:sprite-atlas-mode-changed', () => {
    invalidateBackgroundBlockCache();
    clearAllRenderBundles();
  });
}

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
 * Atomically assigns the active background cache to one room/render state.
 * This runs even for rooms with no background blocks so the prior room's
 * canvases cannot survive a partial or missing adoption.
 */
export function activateBgChunkCacheOwnership(
  roomId: string,
  renderStateKey: string,
  scalePx: number,
): void {
  _bgChunkCache.activateContentOwnership(
    createChunkCacheOwnershipKey(roomId, renderStateKey, scalePx),
    true,
  );
  _bgCacheRoomRef = roomId;
}

/** Diagnostic counts of background chunks currently marked hadFallbacksFlag / builtWithGameplayFallbackFlag. */
export function getBgChunkFallbackCounts(): { hadFallbacksCount: number; gameplayFallbackCount: number } {
  return _bgChunkCache.getFallbackDiagnosticCounts();
}

/**
 * Marks every background chunk currently built with the gameplay unshaded
 * fallback as dirty, so it rebuilds with real shading the next time it
 * renders. Call this at the start of any visual-refresh phase where baking
 * is known to be allowed again (entry warm, editor entry, loading) — see
 * `RoomChunkCache.retryGameplayFallbackChunksNow()` for the full rationale.
 */
export function retryBgGameplayFallbackChunksNow(): void {
  _bgChunkCache.retryGameplayFallbackChunksNow();
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
// Bg prewarm data is stored as part of the shared RoomRenderSnapshot in
// roomRenderCacheStore.ts, co-located with wall prewarm data for the same room.
// This allows staged adoption and automatic invalidation when renderStateKey changes.

import { RoomChunkCache as _RCC } from './chunkRenderCache'; // local alias to avoid shadowing
import {
  clearAllRenderBundles,
  getCacheBundle,
  getOrCreateBundle,
  hasBgPrewarmData,
  listBgPrewarmRoomIds,
  getBgPrewarmDummyCtx,
  type PrewarmAdoptResult,
} from './roomRenderCacheStore';
import { computeRoomRenderStateKey } from './roomRenderState';

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
        const folderThemeId = themeId as string;
        // Background blocks always render the darkened-sprite path (rather than
        // the sprite-atlas fast path used for foreground walls) so the 40%
        // darkening is applied deterministically to the exact source art with
        // the source alpha channel preserved.
        const sprite = getTheme1x1SpriteDarkened(
          folderThemeId,
          col,
          row,
          seed,
          OPEN_AIR_ALL_SIDES,
          CELL_SIZE_WORLD,
        );
        if (sprite !== null) {
          recordSpriteAtlasLegacyDraw();
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

  // Reuse the RoomRenderSnapshot that was created by the wall prewarm for the
  // same room, if one exists.  If not (corner case: bg called without a prior
  // wall prewarm), create a new snapshot with a minimal key derived from the
  // same computeRenderStateKey format so keys are consistent.
  let snap = getCacheBundle(room.id);
  if (snap === undefined) {
    // No lighting/ambient context available here; use neutral defaults.  In
    // practice this path is not taken since wall prewarm always runs first.
    const fallbackKey = computeRoomRenderStateKey(room, new Set<string>());
    snap = getOrCreateBundle(room.id, fallbackKey, -1, 1);
  }
  if (snap.bgCache === null) {
    snap.bgCache = new _RCC(true);
  }
  const tempCache = snap.bgCache;
  tempCache.activateContentOwnership(
    createChunkCacheOwnershipKey(room.id, snap.renderStateKey, zoom),
  );
  tempCache.setMaxChunksPerFrame(maxChunks);

  const buildFn = _makeBgBuildChunkFn(blocks, room.blockTheme ?? null, room.worldNumber ?? 0, zoom);
  const dummyCtx = getBgPrewarmDummyCtx();

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
 * Non-destructively draws a NON-ACTIVE room's background block chunks into
 * `ctx` at a screen offset, clipped to `clip*`. Used by the "Render Adjacent
 * Rooms" view. Renders visible chunks from the room's own per-room prewarm
 * `bgCache` into the real ctx without touching the active `_bgChunkCache`
 * singleton or `_bgCacheRoomRef`.
 */
export function drawRoomBgChunksAt(
  ctx: CanvasRenderingContext2D,
  room: RoomDef,
  zoom: number,
  offsetXPx: number,
  offsetYPx: number,
  clipXPx: number,
  clipYPx: number,
  clipWPx: number,
  clipHPx: number,
  vpWPx: number,
  vpHPx: number,
  maxChunks: number,
): PrewarmChunkResult {
  const empty: PrewarmChunkResult = { rebuilt: 0, skipped: 0, totalChunks: 0, dirtyChunks: 0 };
  const blocks = room.backgroundBlocks;
  if (!blocks || blocks.length === 0) return empty;

  let snap = getCacheBundle(room.id);
  if (snap === undefined) {
    const fallbackKey = computeRoomRenderStateKey(room, new Set<string>());
    snap = getOrCreateBundle(room.id, fallbackKey, -1, 1);
  }
  if (snap.bgCache === null) snap.bgCache = new _RCC(true);
  const tempCache = snap.bgCache;
  tempCache.activateContentOwnership(
    createChunkCacheOwnershipKey(room.id, snap.renderStateKey, zoom),
  );
  tempCache.setMaxChunksPerFrame(maxChunks);

  const buildFn = _makeBgBuildChunkFn(blocks, room.blockTheme ?? null, room.worldNumber ?? 0, zoom);

  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(clipXPx, clipYPx, clipWPx, clipHPx);
    ctx.clip();
    tempCache.renderVisibleChunks(
      ctx,
      room,
      offsetXPx,
      offsetYPx,
      zoom,
      CELL_SIZE_WORLD,
      vpWPx,
      vpHPx,
      buildFn,
    );
  } finally {
    ctx.restore();
  }

  return {
    rebuilt:     tempCache.stats.rebuiltThisFrame,
    skipped:     tempCache.stats.skippedThisFrame,
    totalChunks: tempCache.stats.totalChunkCount,
    dirtyChunks: tempCache.stats.dirtyChunkCount,
  };
}

/**
 * Adopts pre-warmed background block chunks when the player enters a room.
 * Injects pre-built canvases into the active `_bgChunkCache` and sets the
 * room reference so the first `renderBackgroundBlocks` call skips the
 * invalidation check.
 *
 * Must be called after any explicit cache invalidation (e.g. room change) but
 * BEFORE the first render frame for the new room.
 *
 * For rooms with no background blocks, returns `{ status: 'missing' }` since
 * there is never any bg prewarm data to adopt (and the caller should treat
 * such rooms as already bg-ready).
 *
 * @param room                   Room definition for the room being entered.
 * @param zoom                   Camera zoom scale for the first render frame.
 * @param currentRenderStateKey  Snapshot key must match or adoption is refused.
 * @returns Structured `PrewarmAdoptResult` describing the outcome.
 */
export function adoptPrewarmedBgChunks(room: RoomDef, zoom: number, currentRenderStateKey: string): PrewarmAdoptResult {
  const snap = getCacheBundle(room.id);
  if (snap === undefined || snap.bgCache === null) return { status: 'missing' };

  // Adoption-time stale-key guard: refuse chunks built for a different render state.
  if (snap.renderStateKey !== currentRenderStateKey) {
    if (import.meta.env.DEV) {
      console.warn(
        `[adoptPrewarmedBgChunks] stale renderStateKey for ${room.id} — discarding prewarm data.` +
        `\n  snapshot: ${snap.renderStateKey}\n  current:  ${currentRenderStateKey}`,
      );
    }
    if (snap) snap.bgCache = null;
    return { status: 'staleRenderState', snapshotKey: snap.renderStateKey, currentKey: currentRenderStateKey };
  }

  const chunks = snap.bgCache.extractCleanChunks();
  if (chunks.size > 0) {
    _bgChunkCache.injectWarmedChunks(
      chunks,
      room,
      zoom,
      createChunkCacheOwnershipKey(room.id, currentRenderStateKey, zoom),
    );
    // Mark room ref so renderBackgroundBlocks skips its invalidation check.
    _bgCacheRoomRef = room.id;
  }

  // Clear bg data from the snapshot (removes snapshot if all fields are now null).
  if (snap) snap.bgCache = null;
  return chunks.size > 0 ? { status: 'adopted', bundle: snap } : { status: 'empty' };
}

/** Discards pre-warmed background block chunks for `roomId` without adopting them. */
export function evictPrewarmedBgChunks(roomId: string): void {
  const snap = getCacheBundle(roomId);
  if (snap) snap.bgCache = null;
}

/** Returns `true` when pre-warmed background block data exists for `roomId`. */
export function hasPrewarmedBgChunks(roomId: string): boolean {
  return hasBgPrewarmData(roomId);
}

/** Returns the list of room IDs that currently have pre-warmed background block chunks. */
export function listPrewarmedBgRoomIds(): string[] {
  return listBgPrewarmRoomIds();
}

/**
 * Returns per-room prewarm bg stats for `roomId`, or `null` when not held.
 * Used by the eviction pass to compute per-room memory.
 */
export function getPrewarmBgRoomStats(roomId: string): { chunks: number; memoryKB: number } | null {
  const cache = getCacheBundle(roomId)?.bgCache;
  if (!cache) return null;
  return { chunks: cache.stats.totalChunkCount, memoryKB: cache.stats.memoryEstimateKB };
}

/**
 * Returns aggregate stats across all currently-held background prewarm caches.
 * Used by the debug overlay.
 */
export function getPrewarmBgStats(): { roomCount: number; totalChunks: number; memoryEstimateKB: number } {
  let roomCount = 0;
  let totalChunks = 0;
  let memoryEstimateKB = 0;
  for (const id of listBgPrewarmRoomIds()) {
    const stats = getPrewarmBgRoomStats(id);
    if (stats) {
      roomCount++;
      totalChunks += stats.chunks;
      memoryEstimateKB += stats.memoryKB;
    }
  }
  return { roomCount, totalChunks, memoryEstimateKB };
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
    _bgChunkCache.activateContentOwnership(
      createChunkCacheOwnershipKey(room.id, 'runtime-room-mismatch', zoom),
    );
    _bgCacheRoomRef = room.id;
  }

  const seed = room.worldNumber ?? 0;
  const buildFn = _makeBgBuildChunkFn(blocks, room.blockTheme ?? null, seed, zoom);

  ctx.save();
  // Background blocks are rendered at full opacity (globalAlpha = 1). The
  // "background" visual read comes from the sprite itself being pre-darkened
  // to 60% of its source RGB brightness (see getTheme1x1SpriteDarkened) —
  // never from faking darkness via transparency/blending, which would also
  // incorrectly wash out the source sprite's own alpha channel.
  ctx.globalAlpha = 1;

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
