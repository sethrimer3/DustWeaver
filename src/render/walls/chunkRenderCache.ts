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
import { EDGE_SHADING_VERSION } from './blockEdgeShading';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Number of tile-grid blocks per chunk on each axis.
 * 32 blocks × 8 px/block = 256 virtual pixels per chunk side.
 * At the 480×270 virtual resolution this gives at most ~3×2 = 6 visible
 * chunks, keeping per-frame blit overhead negligible.
 */
export const CHUNK_SIZE_BLOCKS = 32;

/**
 * Builds the opaque ownership key used by active and prewarmed chunk caches.
 * Room identity prevents cross-room reuse, the render-state key covers theme
 * and lighting, and scale prevents a canvas baked at one zoom from being
 * presented at another.
 */
export function createChunkCacheOwnershipKey(
  roomId: string,
  renderStateKey: string,
  scalePx: number,
): string {
  return JSON.stringify([roomId, renderStateKey, scalePx]);
}

/**
 * Extra chunks beyond the visible edge to keep cached.
 * 1 means one additional chunk outside each viewport edge, preventing pop-in
 * when the camera moves one tile at a time.
 */
const CHUNK_MARGIN = 1;

// ── Shared chunk-range scratch ────────────────────────────────────────────────

/**
 * Reusable output object for `_fillChunkRange`.  Using a module-level scratch
 * avoids a small heap allocation on every `renderVisibleChunks` call.
 * Safe because JavaScript is single-threaded and no call re-enters.
 */
const _rangeOut = { cxMin: 0, cyMin: 0, cxMax: 0, cyMax: 0 };

/**
 * `true` once a DEV warning has been logged for a degenerate chunk-range
 * input this session.  Logged once (not per-frame) to avoid log spam while
 * still surfacing the condition — see task item 6 (defensive diagnostics).
 */
let _loggedDegenerateRangeWarning = false;

/**
 * Safe DEV-mode check: `import.meta.env` is a Vite-only global and is
 * `undefined` under the plain node/tsx test runner used for unit tests, so a
 * bare `import.meta.env.DEV` read throws there. Existing call sites in this
 * file only run in code paths tests don't reach; this helper covers the ones
 * added here that ARE reachable from unit tests (`isViewportCovered` etc).
 */
function _isDevMode(): boolean {
  return typeof import.meta.env !== 'undefined' && import.meta.env.DEV === true;
}

/**
 * Compute the chunk grid range that covers the viewport (± `margin` chunks).
 *
 * This is the single source of truth for chunk-range arithmetic shared by
 * `renderVisibleChunks` and `isViewportCovered` so the two can never drift.
 *
 * @param offsetXPx  Camera X offset in virtual pixels (world origin → screen).
 * @param offsetYPx  Camera Y offset in virtual pixels.
 * @param vpWPx      Viewport width in virtual pixels.
 * @param vpHPx      Viewport height in virtual pixels.
 * @param scalePx    World-to-virtual-pixel scale factor (zoom).
 * @param blockSizePx Block size in world units.
 * @param margin     Extra chunk margin beyond the visible edges (normally `CHUNK_MARGIN`).
 * @param out        Object that receives `{cxMin, cyMin, cxMax, cyMax}`.
 */
function _fillChunkRange(
  offsetXPx:   number,
  offsetYPx:   number,
  vpWPx:       number,
  vpHPx:       number,
  scalePx:     number,
  blockSizePx: number,
  margin:      number,
  out: { cxMin: number; cyMin: number; cxMax: number; cyMax: number },
): void {
  const cellPx = blockSizePx * scalePx;
  const inputsFinite =
    Number.isFinite(offsetXPx) && Number.isFinite(offsetYPx) &&
    Number.isFinite(vpWPx) && Number.isFinite(vpHPx) &&
    Number.isFinite(cellPx) && cellPx > 0;

  if (!inputsFinite) {
    // Non-finite or zero/negative cell size (NaN/Infinity camera state, or a
    // caller passing blockSizePx/scalePx <= 0) would otherwise propagate
    // NaN/Infinity chunk indices into a `for` loop that never terminates or
    // allocates unbounded canvases.  Fail safe to an empty range instead.
    if (_isDevMode() && !_loggedDegenerateRangeWarning) {
      _loggedDegenerateRangeWarning = true;
      console.warn(
        '[chunkRenderCache] degenerate chunk-range inputs — rendering nothing this frame.',
        { offsetXPx, offsetYPx, vpWPx, vpHPx, scalePx, blockSizePx },
      );
    }
    out.cxMin = 0;
    out.cyMin = 0;
    out.cxMax = -1;
    out.cyMax = -1;
    return;
  }

  // Block index of the left/top/right/bottom viewport edges.
  // screen pixel 0 → world unit (−offsetXPx / scalePx)
  // block index   = floor(world / blockSizePx)
  const blockLeft  = Math.floor(-offsetXPx / cellPx);
  const blockTop   = Math.floor(-offsetYPx / cellPx);
  const blockRight = Math.ceil((vpWPx - offsetXPx) / cellPx);
  const blockBot   = Math.ceil((vpHPx - offsetYPx)  / cellPx);
  // Chunk grid indices — min is clamped to 0; max is left unclamped so it
  // extends to the room edge naturally (no dependency on room width/height —
  // a very tall or very wide room simply produces a larger cyMax/cxMax here).
  out.cxMin = Math.max(0, Math.floor(blockLeft  / CHUNK_SIZE_BLOCKS) - margin);
  out.cyMin = Math.max(0, Math.floor(blockTop   / CHUNK_SIZE_BLOCKS) - margin);
  out.cxMax =              Math.floor(blockRight / CHUNK_SIZE_BLOCKS) + margin;
  out.cyMax =              Math.floor(blockBot   / CHUNK_SIZE_BLOCKS) + margin;

  if (_isDevMode() && (out.cxMax < out.cxMin || out.cyMax < out.cyMin) && !_loggedDegenerateRangeWarning) {
    _loggedDegenerateRangeWarning = true;
    console.warn(
      '[chunkRenderCache] chunk range culled to empty while camera appears to be in a valid viewport.',
      { offsetXPx, offsetYPx, vpWPx, vpHPx, scalePx, blockSizePx, out: { ...out } },
    );
  }
}

// ── Prewarm result ────────────────────────────────────────────────────────────

/**
 * Result returned by `prewarmWallChunksForRoom` and `prewarmBgChunksForRoom`.
 *
 * Callers should use `rebuilt === 0 && skipped === 0` to determine that no
 * more work remains in the entry viewport.  Using both fields rather than
 * `rebuilt === 0` alone is correct: when the per-frame chunk budget
 * (`maxChunksPerFrame`) is exhausted, `skipped > 0` with `rebuilt === 0` is
 * possible — the viewport is NOT yet fully covered in that case.
 *
 * `totalChunks === 0` distinguishes "no background blocks at all" from "all
 * viewport chunks already warm".
 */
export interface PrewarmChunkResult {
  /** Chunks actually rebuilt in this call. */
  rebuilt: number;
  /** Chunks that needed rebuild but were skipped due to the per-frame budget. */
  skipped: number;
  /** Total allocated chunk canvases in this room's prewarm cache. */
  totalChunks: number;
  /** Chunks currently marked dirty (need rebuild on next call). */
  dirtyChunks: number;
}

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
  /** Generation of cache content this canvas was built or injected for. */
  readonly contentGeneration: number;
  /**
   * True when a sprite was unavailable (still loading) during the last build
   * pass.  The chunk will be rebuilt again next frame so the final image
   * converges once all sprites have finished loading.
   */
  hadFallbacksFlag: boolean;
  /**
   * True when the last build pass ran while `FP.isBakeForbiddenInGameplay()`
   * was true, meaning every sprite in this chunk used the cheap unshaded
   * fallback instead of the real edge-shaded bake.  Unlike `hadFallbacksFlag`
   * this does NOT feed into `needsBuild` (that would thrash-rebuild every
   * frame while still in gameplay) — it is only consulted once, when baking
   * next becomes allowed (see `_retryGameplayFallbackChunks`), so the chunk
   * gets exactly one retry to pick up real shading.
   */
  builtWithGameplayFallbackFlag: boolean;
}

// ── RoomChunkCache ─────────────────────────────────────────────────────────────

/**
 * Manages a set of per-chunk offscreen canvases for a room render layer.
 *
 * Owned exclusively by blockSpriteRenderer.ts.  All public methods are
 * called from renderWallSprites() or the module-level invalidation helpers.
 */
export class RoomChunkCache {
  private readonly _chunks = new Map<string, ChunkCanvas>();
  private readonly _dirtyKeys = new Set<string>();

  /** Opaque room/render-state/scale identity currently owned by this cache. */
  private _contentOwnershipKey: string | null = null;

  /** Incremented whenever incompatible content ownership replaces the cache. */
  private _contentGeneration = 0;

  /** One-shot DEV diagnostic guard for an otherwise-impossible stale entry. */
  private _loggedForeignGenerationWarning = false;

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

  /**
   * `EDGE_SHADING_VERSION` observed when chunks were last built.  A version
   * bump (shading constants/algorithm tuning) must invalidate every baked
   * chunk canvas even though the wall layout and scale are unchanged —
   * otherwise previously-baked (unshaded or differently-shaded) chunks would
   * stay visually stuck until some unrelated layout change happened to
   * trigger a full rebuild.
   */
  private _shadingVersion = EDGE_SHADING_VERSION;

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
   * Last block size (in pixels) passed to renderVisibleChunks().
   * Stored so _evictStaleChunks() can compute an accurate memory estimate
   * without hard-coding the default block size.
   */
  private _lastBlockSizePx = 8;

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
   * Last-observed value of `FP.getBakeUnlockGeneration()`.  Initialized from
   * the current value so a cache created mid-gameplay doesn't immediately
   * think an unlock just happened.
   */
  private _lastBakeUnlockGeneration = FP.getBakeUnlockGeneration();

  /**
   * Called once per `renderVisibleChunks` to detect the bake-forbidden flag
   * clearing since the last call.  When it has, every chunk that was built
   * using the gameplay unshaded fallback is marked dirty so it gets one
   * retry at the real (shaded) bake, subject to the usual per-frame budget.
   *
   * This is a *passive* retry: it only fires the next time this cache's own
   * `renderVisibleChunks` happens to run after the unlock. For chunks that
   * sit outside whatever is currently being rendered (e.g. this room isn't
   * the active one, or entry warm hasn't started rendering yet), the passive
   * path can sit for a while before it gets a chance to fire. Callers that
   * need fallback chunks to start converging immediately — e.g. entry warm,
   * which knows baking has just become allowed for this room — should call
   * `retryGameplayFallbackChunksNow()` explicitly instead of waiting for this.
   */
  private _retryGameplayFallbackChunks(): void {
    const gen = FP.getBakeUnlockGeneration();
    if (gen === this._lastBakeUnlockGeneration) return;
    this._lastBakeUnlockGeneration = gen;
    this.retryGameplayFallbackChunksNow();
  }

  /**
   * Marks every currently-allocated chunk that was built using the gameplay
   * unshaded fallback as dirty, forcing a real shaded rebuild the next time
   * it is rendered — without waiting for the passive bake-unlock-generation
   * check in `_retryGameplayFallbackChunks` to happen to fire on this cache's
   * own next `renderVisibleChunks` call.
   *
   * Call this explicitly whenever a visual-refresh phase begins where baking
   * is known to be allowed again (entry warm start, editor entry, loading),
   * so stale gameplay-fallback chunks — which may be missing real edge
   * shading/lighting entirely — start converging to their real shaded
   * appearance as soon as possible instead of staying visually broken until
   * some unrelated render call happens to trigger the passive retry.
   */
  retryGameplayFallbackChunksNow(): void {
    for (const [key, chunk] of this._chunks) {
      if (chunk.builtWithGameplayFallbackFlag) {
        this._dirtyKeys.add(key);
        chunk.builtWithGameplayFallbackFlag = false;
      }
    }
  }

  /**
   * Diagnostic counts of chunks currently marked with `hadFallbacksFlag` /
   * `builtWithGameplayFallbackFlag`. Intended for one-shot DEV logging (e.g.
   * entry-warm completion diagnostics) — not cheap enough to call every
   * frame on large rooms, but fine for occasional use.
   */
  getFallbackDiagnosticCounts(): { hadFallbacksCount: number; gameplayFallbackCount: number } {
    let hadFallbacksCount = 0;
    let gameplayFallbackCount = 0;
    for (const chunk of this._chunks.values()) {
      if (chunk.hadFallbacksFlag) hadFallbacksCount++;
      if (chunk.builtWithGameplayFallbackFlag) gameplayFallbackCount++;
    }
    return { hadFallbacksCount, gameplayFallbackCount };
  }

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

  /** Current opaque content owner, exposed for diagnostics and tests. */
  get contentOwnershipKey(): string | null {
    return this._contentOwnershipKey;
  }

  /** Current content generation, exposed for diagnostics and tests. */
  get contentGeneration(): number {
    return this._contentGeneration;
  }

  /**
   * Makes this cache exclusively own one room/render-state/scale identity.
   * Switching identities atomically drops every prior canvas before any
   * partial prewarm data can be injected, so untouched chunk keys can never
   * retain artwork from the previous room. Real room activations pass
   * `forceNewGeneration` so editor/playtest reloads of the same room identity
   * also start from an empty active cache.
   */
  activateContentOwnership(ownershipKey: string, forceNewGeneration = false): boolean {
    if (!forceNewGeneration && ownershipKey === this._contentOwnershipKey) return false;
    this._contentOwnershipKey = ownershipKey;
    this._contentGeneration++;
    this._resetCachedContent();
    return true;
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

  /**
   * Injects pre-warmed chunk canvases into this cache.
   *
   * Sets the stored `layoutRef` and `scalePx` to match the pre-warmed state
   * so that the first `renderVisibleChunks` call does NOT trigger
   * `invalidateAll`.  Any injected chunk is immediately clean (not dirty).
   *
   * Called by the prewarm adoption helpers in blockSpriteRenderer.ts and
   * backgroundBlockRenderer.ts when the player enters a pre-warmed room.
   *
   * @param chunks    Map of chunk-key → pre-built HTMLCanvasElement.
   * @param layoutRef The same CachedWallLayout / RoomDef object that will be
   *                  passed as `layoutRef` on the first renderVisibleChunks call.
   * @param scalePx   Camera zoom scale used when building the chunks.
   * @param ownershipKey Opaque room/render-state/scale identity for the data.
   */
  injectWarmedChunks(
    chunks: Map<string, HTMLCanvasElement>,
    layoutRef: unknown,
    scalePx: number,
    ownershipKey: string,
  ): void {
    this.activateContentOwnership(ownershipKey);
    this._layoutRef = layoutRef;
    this._scalePx   = scalePx;
    for (const [key, canvas] of chunks) {
      this._chunks.set(key, {
        canvas,
        contentGeneration: this._contentGeneration,
        hadFallbacksFlag: false,
        builtWithGameplayFallbackFlag: false,
      });
      this._dirtyKeys.delete(key);
    }
  }

  /**
   * Extracts all non-dirty chunk canvases as a `Map<key, HTMLCanvasElement>`.
   *
   * Called by `adoptPrewarmedWallChunks` / `adoptPrewarmedBgChunks` to move
   * pre-built canvases from a temporary prewarm cache into the active cache.
   */
  extractCleanChunks(): Map<string, HTMLCanvasElement> {
    const result = new Map<string, HTMLCanvasElement>();
    if (this._contentOwnershipKey === null) return result;
    for (const [key, entry] of this._chunks) {
      // A chunk built while gameplay baking was forbidden may be missing real
      // edge shading / lighting (it drew cheap unshaded sprites instead) —
      // it is visually "not ready" even though it isn't literally dirty or
      // hadFallbacksFlag. Never adopt/prewarm-promote such a chunk into
      // another room-entry path as if it were a finished, shaded bake.
      if (
        entry.contentGeneration === this._contentGeneration &&
        !entry.hadFallbacksFlag &&
        !entry.builtWithGameplayFallbackFlag &&
        !this._dirtyKeys.has(key)
      ) {
        result.set(key, entry.canvas);
      }
    }
    return result;
  }

  /**
   * Returns the block size (in pixels) last used by `renderVisibleChunks` or
   * injected via `injectWarmedChunks`.  Used by readiness probes that need to
   * verify the cached scale matches the current camera zoom.
   */
  get lastBlockSizePx(): number {
    return this._lastBlockSizePx;
  }

  /**
   * Cheap read-only check: returns `true` when every chunk grid cell in the
   * given viewport — **including the `CHUNK_MARGIN` safety ring** used by
   * `renderVisibleChunks` — is already present, clean, and had no fallbacks.
   *
   * This is a pure read — it does **not** build any canvases.  Returns `false`
   * if the zoom has changed since chunks were last built (scale mismatch) or if
   * any visible-plus-margin chunk is missing, dirty, or marked `hadFallbacksFlag`.
   *
   * Uses the same chunk-range formula as `renderVisibleChunks` (via
   * `_fillChunkRange`) so the two cannot drift.
   *
   * Intended to be called from `canSkipEntryWarm` in the instant-transition
   * path to avoid showing the textless overlay when nothing needs building.
   */
  isViewportCovered(
    offsetXPx: number,
    offsetYPx: number,
    vpWPx: number,
    vpHPx: number,
    scalePx: number,
    blockSizePx: number,
  ): boolean {
    return this._checkRange(offsetXPx, offsetYPx, vpWPx, vpHPx, scalePx, blockSizePx, CHUNK_MARGIN);
  }

  /**
   * Like `isViewportCovered` but checks only the **core** visible range
   * (margin = 0).  Used in DEV to distinguish "missing safety-margin chunks"
   * from "missing core viewport chunks" in `canSkipEntryWarm` diagnostics.
   *
   * Not intended for production readiness decisions — always use
   * `isViewportCovered` (with margin) for that.
   */
  isViewportCoreCovered(
    offsetXPx: number,
    offsetYPx: number,
    vpWPx: number,
    vpHPx: number,
    scalePx: number,
    blockSizePx: number,
  ): boolean {
    return this._checkRange(offsetXPx, offsetYPx, vpWPx, vpHPx, scalePx, blockSizePx, 0);
  }

  /** Shared implementation for isViewportCovered / isViewportCoreCovered. */
  private _checkRange(
    offsetXPx: number,
    offsetYPx: number,
    vpWPx: number,
    vpHPx: number,
    scalePx: number,
    blockSizePx: number,
    margin: number,
  ): boolean {
    // Scale mismatch means all existing chunks are stale — not covered.
    if (this._contentOwnershipKey === null) return false;
    if (this._scalePx === 0 || this._scalePx !== scalePx) return false;

    const chunkSizePx = CHUNK_SIZE_BLOCKS * blockSizePx * scalePx;
    // `chunkSizePx <= 0` is false for NaN (all NaN comparisons are false), so
    // a NaN blockSizePx/scalePx would otherwise fall through to the loop
    // below and, since _fillChunkRange fails safe to an empty range, be
    // vacuously reported as "covered" (the loop body just never runs).
    if (!(chunkSizePx > 0)) return false;

    _fillChunkRange(offsetXPx, offsetYPx, vpWPx, vpHPx, scalePx, blockSizePx, margin, _rangeOut);
    const { cxMin, cyMin, cxMax, cyMax } = _rangeOut;
    // An empty range (degenerate inputs) must never read as "covered".
    if (cxMax < cxMin || cyMax < cyMin) return false;

    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const key = `${cx},${cy}`;
        const entry = this._chunks.get(key);
        // A chunk built with the gameplay unshaded fallback is not visually
        // ready — it may be missing real edge shading / lighting entirely.
        // Reject it here the same as a missing/dirty/hadFallbacksFlag chunk so
        // room-entry readiness checks never treat it as "covered". Without
        // this, a room can enter gameplay showing broken lighting on chunks
        // that were only ever built via the cheap fallback path, and it stays
        // that way until something (e.g. the editor) clears the bake-forbidden
        // state and triggers a retry.
        if (
          !entry ||
          entry.contentGeneration !== this._contentGeneration ||
          entry.hadFallbacksFlag ||
          entry.builtWithGameplayFallbackFlag ||
          this._dirtyKeys.has(key)
        ) {
          return false;
        }
      }
    }
    return true;
  }

  dispose(): void {
    this._contentOwnershipKey = null;
    this._contentGeneration = 0;
    this._resetCachedContent();
  }

  /** Clears content-derived state while preserving configured budgets. */
  private _resetCachedContent(): void {
    this._chunks.clear();
    this._dirtyKeys.clear();
    this._lastVisibleFrame.clear();
    this._layoutRef = null;
    this._scalePx   = 0;
    this._shadingVersion = EDGE_SHADING_VERSION;
    this._lastBlockSizePx = 8;
    this._frame = 0;
    this._lastBakeUnlockGeneration = FP.getBakeUnlockGeneration();
    this._loggedForeignGenerationWarning = false;
    this.stats.visibleChunkCount = 0;
    this.stats.totalChunkCount = 0;
    this.stats.dirtyChunkCount = 0;
    this.stats.rebuiltThisFrame = 0;
    this.stats.memoryEstimateKB = 0;
    this.stats.evictedTotal = 0;
    this.stats.rebuildMsThisFrame = 0;
    this.stats.skippedThisFrame = 0;
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
    // Store the block size so _evictStaleChunks() can use the actual value.
    this._lastBlockSizePx = blockSizePx;
    // Retry any chunk stuck on the gameplay unshaded fallback now that baking
    // may have become allowed again since the last call.
    this._retryGameplayFallbackChunks();
    // ── Layout / scale / shading-version change detection ───────────────────
    // Scale changes make retained bitmap dimensions categorically invalid.
    // Drop those canvases instead of retaining them as dirty fallbacks.
    if (this._scalePx !== 0 && scalePx !== this._scalePx) {
      this._contentGeneration++;
      this._resetCachedContent();
    }
    if (layoutRef !== this._layoutRef || this._shadingVersion !== EDGE_SHADING_VERSION) {
      this.invalidateAll();
      this._layoutRef = layoutRef;
      this._shadingVersion = EDGE_SHADING_VERSION;
    }
    this._scalePx = scalePx;

    // ── Compute visible chunk range ──────────────────────────────────────────
    // Uses _fillChunkRange so the range matches isViewportCovered exactly.
    _fillChunkRange(offsetXPx, offsetYPx, vpWPx, vpHPx, scalePx, blockSizePx, CHUNK_MARGIN, _rangeOut);
    const cxMin = _rangeOut.cxMin;
    const cyMin = _rangeOut.cyMin;
    const cxMax = _rangeOut.cxMax;
    const cyMax = _rangeOut.cyMax;

    // Virtual pixels per chunk side — used for screen-coordinate math below.
    const chunkSizePx = CHUNK_SIZE_BLOCKS * blockSizePx * scalePx;

    let visibleCount  = 0;
    let rebuiltCount  = 0;
    let skippedCount  = 0;
    let rebuildTotalMs = 0;

    // Missing, foreign-generation, and explicitly dirty chunks are required
    // for correct current-room coverage. Prioritize them over cosmetic
    // fallback retries so a repeatedly unavailable sprite near the start of
    // the scan cannot permanently starve a newly visible chunk near the end.
    let hasPrimaryBuilds = false;
    for (let cy = cyMin; cy <= cyMax && !hasPrimaryBuilds; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const key = `${cx},${cy}`;
        const chunk = this._chunks.get(key);
        if (
          chunk === undefined ||
          chunk.contentGeneration !== this._contentGeneration ||
          this._dirtyKeys.has(key)
        ) {
          hasPrimaryBuilds = true;
          break;
        }
      }
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    for (let cy = cyMin; cy <= cyMax; cy++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        const key   = `${cx},${cy}`;
        let   chunk = this._chunks.get(key);

        const isDirty = this._dirtyKeys.has(key);
        const hasForeignGeneration = chunk !== undefined && chunk.contentGeneration !== this._contentGeneration;
        const needsBuild =
          chunk === undefined ||
          hasForeignGeneration ||
          isDirty ||
          (chunk.hadFallbacksFlag && !hasPrimaryBuilds);
        if (hasForeignGeneration) {
          if (_isDevMode() && !this._loggedForeignGenerationWarning) {
            this._loggedForeignGenerationWarning = true;
            console.warn('[chunkRenderCache] rejected foreign-generation canvas.', {
              ownershipKey: this._contentOwnershipKey,
              chunkKey: key,
              chunkGeneration: chunk?.contentGeneration,
              activeGeneration: this._contentGeneration,
              dirty: isDirty,
              rebuildBudgetExhausted:
                this._maxChunksPerFrame > 0 && rebuiltCount >= this._maxChunksPerFrame,
            });
          }
          this._chunks.delete(key);
          this._dirtyKeys.delete(key);
          this._lastVisibleFrame.delete(key);
          chunk = undefined;
        }

        if (needsBuild) {
          // ── Per-frame rebuild budget check ──────────────────────────────
          if (this._maxChunksPerFrame > 0 && rebuiltCount >= this._maxChunksPerFrame) {
            // Budget exhausted — skip this chunk for this frame.
            // Ensure it will be retried next frame.
            if (chunk !== undefined && !hasForeignGeneration) {
              chunk.hadFallbacksFlag = true;
            }
            skippedCount++;
            const screenX = Math.round(cx * chunkSizePx + offsetXPx);
            const screenY = Math.round(cy * chunkSizePx + offsetYPx);
            if (chunk !== undefined && chunk.contentGeneration === this._contentGeneration) {
              // A same-generation canvas is owned by this exact room/render
              // state. Keep its last valid pixels visible while a bounded retry
              // is pending instead of replacing an entire chunk with a hard
              // rectangular placeholder. Foreign generations were rejected
              // above, so this cannot resurrect artwork from another room.
              ctx.drawImage(chunk.canvas, screenX, screenY);
              visibleCount++;
              this._lastVisibleFrame.set(key, this._frame);
            } else {
              // A genuinely missing chunk has no safe prior pixels to present.
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
            chunk      = {
              canvas: c,
              contentGeneration: this._contentGeneration,
              hadFallbacksFlag: true,
              builtWithGameplayFallbackFlag: false,
            };
            this._chunks.set(key, chunk);
          }

          // ── Build chunk ─────────────────────────────────────────────────
          const chunkCtx = chunk.canvas.getContext('2d');
          if (chunkCtx !== null) {
            chunkCtx.setTransform(1, 0, 0, 1, 0, 0);
            chunkCtx.globalAlpha = 1;
            chunkCtx.globalCompositeOperation = 'source-over';
            chunkCtx.imageSmoothingEnabled = false;
            chunkCtx.clearRect(0, 0, chunk.canvas.width, chunk.canvas.height);

            const colMin = cx * CHUNK_SIZE_BLOCKS;
            const rowMin = cy * CHUNK_SIZE_BLOCKS;
            const colMax = colMin + CHUNK_SIZE_BLOCKS - 1;
            const rowMax = rowMin + CHUNK_SIZE_BLOCKS - 1;

            // Translate so the tile at (colMin, rowMin) maps to canvas (0, 0).
            const chunkOffX = -(colMin * blockSizePx * scalePx);
            const chunkOffY = -(rowMin * blockSizePx * scalePx);

            // Captured before buildChunkFn runs — records whether this build
            // used the cheap unshaded gameplay fallback so it can be retried
            // once baking becomes allowed again (see _retryGameplayFallbackChunks).
            const wasBakeForbidden = FP.isBakeForbiddenInGameplay();

            const devMode = _isDevMode();
            const _ct0 = devMode ? performance.now() : 0;
            const hadFallbacks = buildChunkFn(
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
            chunk.builtWithGameplayFallbackFlag = wasBakeForbidden;
            // The gameplay renderer intentionally uses a cheap fallback while
            // baking is forbidden. Keep that chunk stable until the bake-unlock
            // generation schedules its one real retry; treating the intentional
            // fallback as an ordinary build failure would rebuild it forever and
            // exhaust the per-frame budget, exposing the rectangular placeholder.
            chunk.hadFallbacksFlag = wasBakeForbidden ? false : hadFallbacks;
            if (devMode) {
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
        if (chunk !== undefined && chunk.contentGeneration === this._contentGeneration) {
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
    const chunkSidePixels = Math.ceil(this._scalePx === 0 ? 1 : CHUNK_SIZE_BLOCKS * this._lastBlockSizePx * this._scalePx);
    this.stats.memoryEstimateKB = Math.round(
      this._chunks.size * chunkSidePixels * chunkSidePixels * 4 / 1024,
    );
  }
}
