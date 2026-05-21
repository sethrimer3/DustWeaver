/**
 * chunkRenderCache.ts — Chunked tile render cache for the wall layer.
 *
 * Splits the room wall layer into CHUNK_SIZE_BLOCKS × CHUNK_SIZE_BLOCKS tile
 * chunks, each backed by its own small offscreen HTMLCanvasElement.  Only
 * chunks whose on-screen rectangle intersects the camera viewport (plus a
 * safety margin) are drawn per frame.  Dirty chunks are rebuilt via a
 * caller-supplied `buildChunkFn` callback.
 *
 * This replaces the previous single-canvas bake approach in
 * blockSpriteRenderer.ts and eliminates the need for a room-sized canvas that
 * can be hundreds of megabytes for very large rooms.
 *
 * Coordinate conventions
 * ──────────────────────
 *   World units  — 1 unit = 1 virtual pixel at zoom 1.0.
 *   Block units  — blockSizePx world units per block (normally BLOCK_SIZE_SMALL = 8).
 *   Chunk units  — CHUNK_SIZE_BLOCKS blocks per chunk axis.
 *
 * Memory model
 * ────────────
 *   Each chunk canvas is allocated lazily on first visibility.  Canvases are
 *   retained indefinitely (not evicted) so re-visiting chunks costs only a
 *   cheap dirty-check + drawImage blit.  For extreme room sizes the caller can
 *   call dispose() to free everything and start fresh.
 *
 * Per-frame rebuild budget
 * ────────────────────────
 *   `maxChunksPerFrame` (see setMaxChunksPerFrame()) caps how many chunks can
 *   be rebuilt in a single renderVisibleChunks() call.  When the budget runs
 *   out, pending chunks are skipped for this frame; their `hadFallbacksFlag` is
 *   set so they are retried next frame.  Use a solid-colour fallback background
 *   for the skipped chunk so the tile area is not invisible while warming up.
 *   A value of 0 disables the cap (unlimited — original behaviour).
 */

import * as FP from '../../debug/perfFreezeProfiler';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Number of tile-grid blocks per chunk on each axis.
 * 32 blocks × 8 px/block = 256 virtual pixels per chunk side.
 * At the 480×270 virtual resolution this gives at most ~3×2 = 6 visible
 * chunks, keeping per-frame blit overhead negligible.
 */
export const CHUNK_SIZE_BLOCKS = 32;

/**
 * Extra chunks beyond the visible edge to keep cached.
 * 1 means one additional chunk outside each viewport edge, preventing pop-in
 * when the camera moves one tile at a time.
 */
const CHUNK_MARGIN = 1;

// ── Chunk cache statistics ─────────────────────────────────────────────────────

/** Diagnostic counters updated each frame by renderVisibleChunks(). */
export interface ChunkCacheStats {
  /** Number of chunk canvases whose screen rect overlapped the viewport. */
  visibleChunkCount: number;
  /** Total allocated chunk canvases (including off-screen ones). */
  totalChunkCount: number;
  /** Chunks currently marked dirty (will be rebuilt on next visibility). */
  dirtyChunkCount: number;
  /** Chunks actually rebuilt during this frame. */
  rebuiltThisFrame: number;
  /** Rough GPU/CPU memory estimate for all allocated canvases (4 bytes/px, RGBA). */
  memoryEstimateKB: number;
  /** Cumulative chunk canvases evicted due to the memory cap (0 when no cap set). */
  evictedTotal: number;
  /** Total milliseconds spent rebuilding chunks this frame. */
  rebuildMsThisFrame: number;
  /** Chunks that needed a rebuild but were skipped due to the per-frame budget. */
  skippedThisFrame: number;
}

// ── Per-chunk data ─────────────────────────────────────────────────────────────

interface ChunkCanvas {
  readonly canvas: HTMLCanvasElement;
  /**
   * True when a sprite was unavailable (still loading) during the last build
   * pass.  The chunk will be rebuilt again next frame so the final image
   * converges once all sprites have finished loading.
   */
  hadFallbacksFlag: boolean;
}

// ── RoomChunkCache ─────────────────────────────────────────────────────────────

/**
 * Manages a set of per-chunk offscreen canvases for the room wall layer.
 *
 * Owned exclusively by blockSpriteRenderer.ts.  All public methods are
 * called from renderWallSprites() or the module-level invalidation helpers.
 */
export class RoomChunkCache {
  private readonly _chunks = new Map<string, ChunkCanvas>();
  private readonly _dirtyKeys = new Set<string>();

  /**
   * When true, chunk build times are recorded as background-layer metrics
   * in the freeze profiler (FP.recordBgChunkBuild).  When false (default),
   * they are recorded as wall-layer metrics (FP.recordWallChunkBuild).
   */
  private readonly _isBgLayer: boolean;

  constructor(isBgLayer = false) {
    this._isBgLayer = isBgLayer;
  }

  /**
   * Object identity of the wall layout used when chunks were last built.
   * When this changes (any wall modified) all chunks are marked dirty.
   */
  private _layoutRef: unknown = null;

  /** scalePx used when chunks were last allocated. */
  private _scalePx = 0;

  /** Mutable stats object updated every frame. */
  readonly stats: ChunkCacheStats = {
    visibleChunkCount:  0,
    totalChunkCount:    0,
    dirtyChunkCount:    0,
    rebuiltThisFrame:   0,
    memoryEstimateKB:   0,
    evictedTotal:       0,
    rebuildMsThisFrame: 0,
    skippedThisFrame:   0,
  };

  /**
   * Maximum chunk rebuilds allowed per renderVisibleChunks() call.
   * 0 = unlimited (original behaviour).
   * When the budget is reached, remaining dirty/missing chunks are skipped
   * for this frame; their `hadFallbacksFlag` ensures they are retried next
   * frame.  A value of 4 is a good default for 60 fps gameplay.
   */
  private _maxChunksPerFrame = 4;

  /**
   * Maximum estimated canvas memory before eviction begins (KB).
   * 0 = disabled (default).  A reasonable cap is 32 768 KB (32 MB).
   */
  private _maxMemoryKB = 0;

  /**
   * Monotonically increasing frame counter.  Incremented each call to
   * renderVisibleChunks so we can track when each chunk was last visible.
   */
  private _frame = 0;

  /**
   * The frame at which each chunk was last drawn (visible).
   * Used by the eviction pass to find the least-recently-visible chunks.
   */
  private readonly _lastVisibleFrame = new Map<string, number>();

  /**
   * Set the maximum total canvas memory (in KB) before stale chunks are
   * evicted.  Pass 0 to disable eviction (default).
   *
   * Eviction removes chunks that have not been visible for at least
   * ~10 seconds (600 frames at 60 fps).  Evicted chunks are rebuilt
   * correctly when they become visible again.
   */
  setMaxMemoryKB(kb: number): void {
    this._maxMemoryKB = kb;
  }

  /**
   * Set the maximum number of chunk rebuilds allowed per
   * renderVisibleChunks() call (per frame).
   *
   * 0 = unlimited (original behaviour — can cause frame freezes when many
   *     chunks become visible at once).
   * 4 = recommended default for 60 fps gameplay.
   */
  setMaxChunksPerFrame(n: number): void {
    this._maxChunksPerFrame = n;
  }

  // ── Invalidation ──────────────────────────────────────────────────────────

  /**
   * Marks every allocated chunk dirty and clears the layout reference.
   * Called on room load, theme change, or lighting change.
   */
  invalidateAll(): void {
    for (const key of this._chunks.keys()) {
      this._dirtyKeys.add(key);
    }
    this._layoutRef = null;
    this._scalePx   = 0;
  }

  /**
   * Marks all chunks that overlap the given tile-grid rectangle dirty.
   * Use this for targeted invalidation when only a small region of the room
   * changes (e.g. a single tile placed in the editor).
   *
   * @param colMin  Left tile column (inclusive, block units).
   * @param rowMin  Top tile row (inclusive, block units).
   * @param colMax  Right tile column (inclusive, block units).
   * @param rowMax  Bottom tile row (inclusive, block units).
   */
  invalidateBlockRect(
    colMin: number,
    rowMin: number,
    colMax: number,
    rowMax: number,
  ): void {
    const cxMin = Math.floor(colMin / CHUNK_SIZE_BLOCKS);
    const cxMax = Math.floor(colMax / CHUNK_SIZE_BLOCKS);
    const cyMin = Math.floor(rowMin / CHUNK_SIZE_BLOCKS);
    const cyMax = Math.floor(rowMax / CHUNK_SIZE_BLOCKS);
    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        this._dirtyKeys.add(`${cx},${cy}`);
      }
    }
  }

  /** Releases all cached canvases and resets all state. */
  dispose(): void {
    this._chunks.clear();
    this._dirtyKeys.clear();
    this._layoutRef = null;
    this._scalePx   = 0;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /**
   * Renders all camera-visible chunks to `ctx`.
   *
   * For each visible chunk:
   *   • If the chunk is clean and had no fallbacks, it is blitted cheaply.
   *   • If the chunk is dirty or had sprite fallbacks, `buildChunkFn` is
   *     called to redraw its canvas before blitting.
   *
   * @param ctx         Virtual-canvas 2D context to blit chunks into.
   * @param layoutRef   Object whose identity represents the current wall
   *                    layout.  Use the CachedWallLayout object returned by
   *                    getWallLayoutCache().  A reference change marks all
   *                    chunks dirty automatically.
   * @param offsetXPx   Camera X offset in virtual pixels (world origin → screen).
   * @param offsetYPx   Camera Y offset in virtual pixels.
   * @param scalePx     World-to-virtual-pixel scale factor (zoom; normally 1.0).
   * @param blockSizePx Block size in world units (BLOCK_SIZE_SMALL = 8).
   * @param vpWPx         Viewport width in virtual pixels (e.g. 480).
   * @param vpHPx         Viewport height in virtual pixels (e.g. 270).
   * @param buildChunkFn
   *   Callback that renders the static tile content for one chunk into the
   *   provided canvas context.  Arguments:
   *     chunkCtx       — 2D context of the chunk's offscreen canvas.
   *     chunkOffsetXPx — X offset so tile at colMin lands at canvas x=0.
   *     chunkOffsetYPx — Y offset so tile at rowMin lands at canvas y=0.
   *     scalePx        — Same as the outer scalePx.
   *     blockSizePx    — Same as the outer blockSizePx.
   *     colMin         — First tile column (inclusive) covered by this chunk.
   *     rowMin         — First tile row (inclusive) covered by this chunk.
   *     colMax         — Last tile column (inclusive) covered by this chunk.
   *     rowMax         — Last tile row (inclusive) covered by this chunk.
   *   Returns true when any sprite was missing so the chunk should be rebuilt
   *   again next frame.
   */
  renderVisibleChunks(
    ctx: CanvasRenderingContext2D,
    layoutRef: unknown,
    offsetXPx: number,
    offsetYPx: number,
    scalePx: number,
    blockSizePx: number,
    vpWPx: number,
    vpHPx: number,
    buildChunkFn: (
      chunkCtx: CanvasRenderingContext2D,
      chunkOffsetXPx: number,
      chunkOffsetYPx: number,
      scalePx: number,
      blockSizePx: number,
      colMin: number,
      rowMin: number,
      colMax: number,
      rowMax: number,
    ) => boolean,
  ): void {
    // ── Layout / scale change detection ─────────────────────────────────────
    if (layoutRef !== this._layoutRef || scalePx !== this._scalePx) {
      this.invalidateAll();
      this._layoutRef = layoutRef;
      this._scalePx   = scalePx;
    }

    // ── Compute visible chunk range ──────────────────────────────────────────
    // Virtual pixels per chunk side (may be fractional when scalePx ≠ 1).
    const chunkSizePx = CHUNK_SIZE_BLOCKS * blockSizePx * scalePx;

    // Block index of the left/top/right/bottom viewport edges.
    // screen pixel 0 → world unit (−offsetXPx / scalePx)
    // block index    = floor(world / blockSizePx)
    const blockLeft  = Math.floor(-offsetXPx / (blockSizePx * scalePx));
    const blockTop   = Math.floor(-offsetYPx / (blockSizePx * scalePx));
    const blockRight = Math.ceil((vpWPx - offsetXPx) / (blockSizePx * scalePx));
    const blockBot   = Math.ceil((vpHPx - offsetYPx) / (blockSizePx * scalePx));

    // Chunk grid indices covering the visible area plus the safety margin.
    const cxMin = Math.max(0, Math.floor(blockLeft  / CHUNK_SIZE_BLOCKS) - CHUNK_MARGIN);
    const cyMin = Math.max(0, Math.floor(blockTop   / CHUNK_SIZE_BLOCKS) - CHUNK_MARGIN);
    const cxMax =              Math.floor(blockRight / CHUNK_SIZE_BLOCKS) + CHUNK_MARGIN;
    const cyMax =              Math.floor(blockBot   / CHUNK_SIZE_BLOCKS) + CHUNK_MARGIN;

    let visibleCount  = 0;
    let rebuiltCount  = 0;
    let skippedCount  = 0;
    let rebuildTotalMs = 0;

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const key   = `${cx},${cy}`;
        let   chunk = this._chunks.get(key);

        const isDirty    = this._dirtyKeys.has(key);
        const needsBuild = chunk === undefined || isDirty || chunk.hadFallbacksFlag;

        if (needsBuild) {
          // ── Per-frame rebuild budget check ──────────────────────────────
          if (this._maxChunksPerFrame > 0 && rebuiltCount >= this._maxChunksPerFrame) {
            // Budget exhausted — skip this chunk for this frame.
            // Ensure it will be retried next frame.
            if (chunk !== undefined) {
              chunk.hadFallbacksFlag = true;
            }
            skippedCount++;
            const screenX = Math.round(cx * chunkSizePx + offsetXPx);
            const screenY = Math.round(cy * chunkSizePx + offsetYPx);
            if (chunk !== undefined) {
              // Blit existing (possibly stale) canvas.
              ctx.drawImage(chunk.canvas, screenX, screenY);
              visibleCount++;
              this._lastVisibleFrame.set(key, this._frame);
            } else {
              // No canvas yet — draw a cheap dark fallback so the area is not
              // an invisible hole while the chunk warms up.  Do not allocate a
              // canvas here; the real build happens on the next frame.
              const side = Math.max(1, Math.ceil(chunkSizePx));
              ctx.fillStyle = 'rgba(20,20,24,0.85)';
              ctx.fillRect(screenX, screenY, side, side);
            }
            continue;
          }

          // ── Allocate canvas on first access ─────────────────────────────
          if (chunk === undefined) {
            const side = Math.max(1, Math.ceil(chunkSizePx));
            const c    = document.createElement('canvas');
            c.width    = side;
            c.height   = side;
            chunk      = { canvas: c, hadFallbacksFlag: true };
            this._chunks.set(key, chunk);
          }

          // ── Build chunk ─────────────────────────────────────────────────
          const chunkCtx = chunk.canvas.getContext('2d');
          if (chunkCtx !== null) {
            chunkCtx.clearRect(0, 0, chunk.canvas.width, chunk.canvas.height);

            const colMin = cx * CHUNK_SIZE_BLOCKS;
            const rowMin = cy * CHUNK_SIZE_BLOCKS;
            const colMax = colMin + CHUNK_SIZE_BLOCKS - 1;
            const rowMax = rowMin + CHUNK_SIZE_BLOCKS - 1;

            // Translate so the tile at (colMin, rowMin) maps to canvas (0, 0).
            const chunkOffX = -(colMin * blockSizePx * scalePx);
            const chunkOffY = -(rowMin * blockSizePx * scalePx);

            const _ct0 = import.meta.env.DEV ? performance.now() : 0;
            chunk.hadFallbacksFlag = buildChunkFn(
              chunkCtx,
              chunkOffX,
              chunkOffY,
              scalePx,
              blockSizePx,
              colMin,
              rowMin,
              colMax,
              rowMax,
            );
            if (import.meta.env.DEV) {
              const chunkMs = performance.now() - _ct0;
              rebuildTotalMs += chunkMs;
              if (this._isBgLayer) {
                FP.recordBgChunkBuild(key, chunkMs);
              } else {
                FP.recordWallChunkBuild(key, chunkMs);
              }
            }

            this._dirtyKeys.delete(key);
            rebuiltCount++;
          }
        }

        // ── Blit chunk to virtual canvas ────────────────────────────────────
        if (chunk !== undefined) {
          const screenX = Math.round(cx * chunkSizePx + offsetXPx);
          const screenY = Math.round(cy * chunkSizePx + offsetYPx);
          ctx.drawImage(chunk.canvas, screenX, screenY);
          visibleCount++;
          this._lastVisibleFrame.set(key, this._frame);
        }
      }
    }

    ctx.restore();

    // ── Update diagnostics ──────────────────────────────────────────────────
    this.stats.visibleChunkCount  = visibleCount;
    this.stats.totalChunkCount    = this._chunks.size;
    this.stats.dirtyChunkCount    = this._dirtyKeys.size;
    this.stats.rebuiltThisFrame   = rebuiltCount;
    this.stats.rebuildMsThisFrame = rebuildTotalMs;
    this.stats.skippedThisFrame   = skippedCount;
    this.stats.memoryEstimateKB  = Math.round(
      this._chunks.size
        * Math.ceil(chunkSizePx)
        * Math.ceil(chunkSizePx)
        * 4      // 4 bytes per RGBA pixel
        / 1024,
    );

    // Advance frame counter; run eviction when memory cap is set and exceeded.
    this._frame++;
    if (this._maxMemoryKB > 0 && this.stats.memoryEstimateKB > this._maxMemoryKB) {
      this._evictStaleChunks();
    }
  }

  // ── Eviction ──────────────────────────────────────────────────────────────

  /**
   * Evicts chunks that have not been visible for more than ~10 seconds
   * (600 frames at 60 fps).  Runs only when the memory cap is set and
   * exceeded.  Evicted chunks are rebuilt lazily when they become visible.
   */
  private _evictStaleChunks(): void {
    const staleThreshold = this._frame - 600;
    const toEvict: string[] = [];

    for (const [key] of this._chunks) {
      const lastSeen = this._lastVisibleFrame.get(key) ?? 0;
      if (lastSeen < staleThreshold) {
        toEvict.push(key);
      }
    }

    for (const key of toEvict) {
      this._chunks.delete(key);
      this._dirtyKeys.delete(key);
      this._lastVisibleFrame.delete(key);
    }

    this.stats.evictedTotal += toEvict.length;
    this.stats.totalChunkCount = this._chunks.size;
    this.stats.memoryEstimateKB = Math.round(
      this._chunks.size
        * Math.ceil(this._scalePx === 0 ? 1 : CHUNK_SIZE_BLOCKS * 8 * this._scalePx)
        * Math.ceil(this._scalePx === 0 ? 1 : CHUNK_SIZE_BLOCKS * 8 * this._scalePx)
        * 4 / 1024,
    );
  }
}
