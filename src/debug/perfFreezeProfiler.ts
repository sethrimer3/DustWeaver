/**
 * perfFreezeProfiler.ts — Dev-only per-frame freeze profiler.
 *
 * Tracks synchronous work that can cause long frames:
 *   - Wall and background chunk rebuilds (chunkRenderCache)
 *   - Shaded sprite bakes (folderBlockThemes / proceduralBlockSprite)
 *   - Organic edge-shading calls (blockEdgeShading)
 *   - Wall layout signature/rebuild time (blockWallLayoutCache)
 *   - Room preload main-thread tasks (roomPreloadScheduler)
 *   - Room load phase/substep timing (gameScreen)
 *
 * All exported functions are no-ops when `import.meta.env.DEV` is false
 * so they are tree-shaken from production builds.
 *
 * Usage:
 *   // At start of RAF callback, before sim/render:
 *   freezeProfiler.beginFrame(rawElapsedMs);
 *
 *   // (Inside rendering subsystems, instrumented separately)
 *
 *   // At end of RAF callback:
 *   freezeProfiler.endFrame();
 *
 * A "long frame" warning is printed to the console whenever a frame
 * exceeds LONG_FRAME_WARN_MS (100 ms).
 * A "severe freeze" warning is printed above SEVERE_FREEZE_MS (1000 ms).
 */

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Frame duration above which a structured console warning is emitted. */
export const LONG_FRAME_WARN_MS   = 100;
/** Frame duration above which a "severe freeze" console error is emitted. */
export const SEVERE_FREEZE_MS     = 1000;

// ── Frame context ─────────────────────────────────────────────────────────────

/**
 * Describes what the game was doing during a given RAF frame.
 * Used to distinguish active-gameplay freezes from expected loading pauses.
 */
export type FrameContext =
  | 'gameplay'    // Player has control; sim + render running normally.
  | 'loading'     // Async room load in progress behind the loading overlay.
  | 'entryWarm'   // Entry viewport warm phase — bake allowed, sim/input skipped, overlay active.
  | 'editor'      // Level editor is active.
  | 'paused'      // Pause menu, skill tomb, map overlay, or player-dead screen.
  | 'unknown';    // Default — context not set for this frame yet.

// ── Per-frame data ────────────────────────────────────────────────────────────

export interface FreezeFrameData {
  /** Raw elapsed ms for this frame (RAF timestamp delta). */
  frameMs: number;
  /** Number of simulation ticks that ran this frame (filled by gameScreen). */
  simTickCount: number;
  /** Total render ms (filled via endFrame). */
  renderMs: number;

  // ── Wall chunks ─────────────────────────────────────────────────────────────
  wallChunkBuiltCount: number;
  wallChunkBuildMs: number;

  // ── Background chunks ────────────────────────────────────────────────────────
  bgChunkBuiltCount: number;
  bgChunkBuildMs: number;

  // ── Sprite baking ────────────────────────────────────────────────────────────
  spriteBakeCount: number;
  spriteBakeMs: number;
  /** Worst single sprite bake key this frame (empty when none). */
  worstSpriteBakeKey: string;
  worstSpriteBakeMs: number;

  // ── Edge shading (applyOrganicEdgeShading) ────────────────────────────────────
  edgeShadingCount: number;
  edgeShadingMs: number;

  // ── Wall layout ──────────────────────────────────────────────────────────────
  layoutSigMs: number;
  layoutRebuildMs: number;
  layoutWallCount: number;

  // ── Room preload (main-thread tasks) ────────────────────────────────────────
  preloadMainThreadMs: number;
  preloadMainThreadRoomId: string;

  // ── Load phase (async room loading behind overlay) ───────────────────────────
  loadPhaseMs: number;
  loadPhaseDetail: string;

  // ── Scene lighting ───────────────────────────────────────────────────────────
  /** Total scene lights defined in the current room this frame. */
  sceneLightTotalCount: number;
  /** Scene lights that passed viewport culling and were drawn this frame. */
  sceneLightCulledCount: number;
  /** Number of those drawn lights that cast shadows (ran visibility polygon). */
  sceneLightShadowCount: number;
  /** Total occluder segments processed across all shadow-casting lights. */
  sceneLightOccluderSegCount: number;

  // ── Bloom ────────────────────────────────────────────────────────────────────
  /** True when the bloom composite was skipped because no glow was submitted. */
  bloomSkippedNoGlow: boolean;

  // ── Derived ─────────────────────────────────────────────────────────────────
  /** Name of the subsystem that consumed the most measured ms this frame. */
  topCause: string;
  /** What the game was doing this frame — used to identify active-gameplay freezes. */
  frameContext: FrameContext;
}

function _makeBlankFrame(): FreezeFrameData {
  return {
    frameMs:              0,
    simTickCount:         0,
    renderMs:             0,
    wallChunkBuiltCount:  0,
    wallChunkBuildMs:     0,
    bgChunkBuiltCount:    0,
    bgChunkBuildMs:       0,
    spriteBakeCount:      0,
    spriteBakeMs:         0,
    worstSpriteBakeKey:   '',
    worstSpriteBakeMs:    0,
    edgeShadingCount:     0,
    edgeShadingMs:        0,
    layoutSigMs:          0,
    layoutRebuildMs:      0,
    layoutWallCount:      0,
    preloadMainThreadMs:  0,
    preloadMainThreadRoomId: '',
    loadPhaseMs:          0,
    loadPhaseDetail:      '',
    sceneLightTotalCount:       0,
    sceneLightCulledCount:      0,
    sceneLightShadowCount:      0,
    sceneLightOccluderSegCount: 0,
    bloomSkippedNoGlow:         false,
    topCause:             '',
    frameContext:         'unknown',
  };
}

// ── Ring buffer ────────────────────────────────────────────────────────────────

const RING_SIZE = 120;

/** Pre-allocated ring of frame data objects (avoids per-frame allocation). */
const _ring: FreezeFrameData[] = [];
for (let i = 0; i < RING_SIZE; i++) _ring.push(_makeBlankFrame());

let _ringHead = 0;
/** Current mutable frame being filled; committed to ring in endFrame(). */
const _cur: FreezeFrameData = _makeBlankFrame();

/** Last frame with frameMs > LONG_FRAME_WARN_MS. */
let _lastLongFrame: FreezeFrameData | null = null;
/** Last frame with frameMs > SEVERE_FREEZE_MS. */
let _lastSevereFreeze: FreezeFrameData | null = null;

// ── Camera / player context (for structured warnings) ─────────────────────────
let _contextRoomId = '';
let _contextCamBlockRange = '';
let _contextPlayerBlock  = '';

// ── Per-frame sprite-bake budget state ────────────────────────────────────────

/**
 * Maximum shaded-canvas bakes allowed per frame.
 * After this, `isBakeBudgetExhausted()` returns true and callers return null
 * (fallback) so no more `getImageData/putImageData` calls fire this frame.
 * The chunk's `hadFallbacksFlag` ensures a retry next frame.
 *
 * Set 0 to disable the cap (unlimited baking — original behaviour).
 * This limit applies in both dev and production builds.
 */
let _spriteBakeMaxPerFrame = 8;

/** Returns the current per-frame bake budget. */
export function getSpriteBakeMaxPerFrame(): number {
  return _spriteBakeMaxPerFrame;
}

/** Call from game settings to change the budget at runtime. */
export function setSpriteBakeMaxPerFrame(n: number): void {
  _spriteBakeMaxPerFrame = n;
}

/**
 * Production-safe per-frame bake counter.
 * This is reset by _resetBakeBudget() which is called from beginFrame() in
 * both dev and production mode.
 */
let _spriteBakesThisFrame = 0;

/** Resets the per-frame bake counter. Called from beginFrame (both dev and prod). */
function _resetBakeBudget(): void {
  _spriteBakesThisFrame = 0;
}

/** Returns true when the per-frame bake budget is exhausted. */
export function isBakeBudgetExhausted(): boolean {
  return _spriteBakeMaxPerFrame > 0 && _spriteBakesThisFrame >= _spriteBakeMaxPerFrame;
}

// ── Shaded-sprite bake breakdown (legacy vs folder vs unshaded fallback) ──────
//
// `recordSpriteBake` above tracks aggregate bake count/time but does not
// distinguish which code path produced the bake.  These lifetime counters let
// `window.__dwEdgeShadingStats()` (see blockEdgeShading.ts) report exactly how
// many legacy/world-number sprites vs folder-theme sprites were shaded this
// session, and how many tiles fell back to an unshaded canvas because gameplay
// baking was forbidden or the per-frame budget was exhausted — the numbers
// needed to confirm the legacy blackRock/world-0 path (previously bypassing
// applyOrganicEdgeShading entirely) is actually being baked now.
let _legacyShadedBakeLifetime = 0;
let _folderShadedBakeLifetime = 0;
let _unshadedFallbackLifetime = 0;

/** Record a legacy/world-number sprite shaded bake (production-safe). */
export function recordLegacyShadedBake(): void {
  _legacyShadedBakeLifetime++;
}

/** Record a folder-based theme sprite shaded bake (production-safe). */
export function recordFolderShadedBake(): void {
  _folderShadedBakeLifetime++;
}

/** Record a cheap unshaded fallback canvas used in place of a real bake (production-safe). */
export function recordUnshadedFallback(): void {
  _unshadedFallbackLifetime++;
}

/** Lifetime shaded/fallback bake counters — read by window.__dwEdgeShadingStats(). */
export function getShadedBakeLifetimeCounts(): {
  legacyShadedBakes: number;
  folderShadedBakes: number;
  unshadedFallbacks: number;
} {
  return {
    legacyShadedBakes: _legacyShadedBakeLifetime,
    folderShadedBakes: _folderShadedBakeLifetime,
    unshadedFallbacks: _unshadedFallbackLifetime,
  };
}

// ── Gameplay bake-forbidden flag ──────────────────────────────────────────────

/**
 * Production-safe flag: when true, expensive derived-sprite baking
 * (applyOrganicEdgeShading) is forbidden for the current frame.
 *
 * Set to `true` at the start of every active-gameplay frame and `false` during
 * loading, paused, or editor frames.  Callers that respect this flag should
 * return a cheap stable fallback (e.g. the unshaded base sprite) rather than
 * performing a new bake or returning null (which would cause the chunk to
 * rebuild every frame).
 */
let _bakeForbiddenInGameplay = false;

/**
 * Incremented every time the bake-forbidden flag transitions from `true` to
 * `false` (i.e. baking becomes allowed again — loading screen, pause, editor).
 * `RoomChunkCache` compares this against a locally-stored value to detect the
 * transition and retry any chunk that was built using unshaded gameplay
 * fallback sprites, so edge shading eventually converges instead of being
 * stuck on the fallback forever.
 */
let _bakeUnlockGeneration = 0;

/**
 * Sets the gameplay-bake-forbidden flag.
 * Pass `true` before each active-gameplay render frame.
 * Pass `false` during loading, paused, or editor frames.
 * Production-safe — no DEV guard.
 */
export function setBakeForbiddenInGameplay(v: boolean): void {
  if (v === false && _bakeForbiddenInGameplay === true) {
    _bakeUnlockGeneration++;
  }
  _bakeForbiddenInGameplay = v;
}

/**
 * Returns true during active-gameplay frames when new expensive derived-sprite
 * bakes should be skipped in favour of a cheap stable fallback.
 * Production-safe — no DEV guard.
 */
export function isBakeForbiddenInGameplay(): boolean {
  return _bakeForbiddenInGameplay;
}

/**
 * Returns the current bake-unlock generation counter.  Callers that cache
 * chunks built with the gameplay fallback should store the value they last
 * observed and, when it changes, retry those chunks — see `RoomChunkCache`.
 * Production-safe — no DEV guard.
 */
export function getBakeUnlockGeneration(): number {
  return _bakeUnlockGeneration;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call once per RAF callback with the raw elapsed ms.
 * Resets all per-frame counters.
 * The bake-budget counter is also reset here so it works in production.
 */
export function beginFrame(frameMs: number): void {
  // Always reset the bake-budget counter (works in both dev and prod).
  _resetBakeBudget();
  if (!import.meta.env.DEV) return;
  // Reset current frame
  const c = _cur;
  c.frameMs              = frameMs;
  c.simTickCount         = 0;
  c.renderMs             = 0;
  c.wallChunkBuiltCount  = 0;
  c.wallChunkBuildMs     = 0;
  c.bgChunkBuiltCount    = 0;
  c.bgChunkBuildMs       = 0;
  c.spriteBakeCount      = 0;
  c.spriteBakeMs         = 0;
  c.worstSpriteBakeKey   = '';
  c.worstSpriteBakeMs    = 0;
  c.edgeShadingCount     = 0;
  c.edgeShadingMs        = 0;
  c.layoutSigMs          = 0;
  c.layoutRebuildMs      = 0;
  c.layoutWallCount      = 0;
  c.preloadMainThreadMs  = 0;
  c.preloadMainThreadRoomId = '';
  c.loadPhaseMs          = 0;
  c.loadPhaseDetail      = '';
  c.sceneLightTotalCount       = 0;
  c.sceneLightCulledCount      = 0;
  c.sceneLightShadowCount      = 0;
  c.sceneLightOccluderSegCount = 0;
  c.bloomSkippedNoGlow         = false;
  c.topCause             = '';
  c.frameContext         = 'unknown';
}

/** Record sim tick count for this frame (call from sim loop). */
export function recordSimTicks(count: number): void {
  if (!import.meta.env.DEV) return;
  _cur.simTickCount = count;
}

/** Record total render time. Call from endFrame in renderProfiler. */
export function recordRenderMs(ms: number): void {
  if (!import.meta.env.DEV) return;
  _cur.renderMs = ms;
}

/** Record a wall-layer chunk rebuild. */
export function recordWallChunkBuild(_key: string, buildMs: number): void {
  if (!import.meta.env.DEV) return;
  _cur.wallChunkBuiltCount++;
  _cur.wallChunkBuildMs += buildMs;
}

/** Record a background-block chunk rebuild. */
export function recordBgChunkBuild(_key: string, buildMs: number): void {
  if (!import.meta.env.DEV) return;
  _cur.bgChunkBuiltCount++;
  _cur.bgChunkBuildMs += buildMs;
}

/**
 * Record a shaded-sprite canvas bake.
 * Also increments the production-safe bake counter (used by isBakeBudgetExhausted).
 */
export function recordSpriteBake(key: string, bakeMs: number): void {
  // Always increment the production-safe counter.
  _spriteBakesThisFrame++;
  if (!import.meta.env.DEV) return;
  _cur.spriteBakeCount++;
  _cur.spriteBakeMs += bakeMs;
  if (bakeMs > _cur.worstSpriteBakeMs) {
    _cur.worstSpriteBakeMs  = bakeMs;
    _cur.worstSpriteBakeKey = key;
  }
}

/** Record a single `applyOrganicEdgeShading` call. */
export function recordEdgeShading(ms: number): void {
  if (!import.meta.env.DEV) return;
  _cur.edgeShadingCount++;
  _cur.edgeShadingMs += ms;
}

/** Record wall layout signature build and optional full rebuild. */
export function recordLayoutWork(sigMs: number, rebuildMs: number, wallCount: number): void {
  if (!import.meta.env.DEV) return;
  _cur.layoutSigMs      += sigMs;
  _cur.layoutRebuildMs  += rebuildMs;
  _cur.layoutWallCount   = wallCount;
}

/** Record a main-thread room preload task. */
export function recordPreloadTask(roomId: string, ms: number): void {
  if (!import.meta.env.DEV) return;
  _cur.preloadMainThreadMs += ms;
  if (ms > 0) _cur.preloadMainThreadRoomId = roomId;
}

/** Record a load-phase sub-step. */
export function recordLoadPhaseStep(detail: string, ms: number): void {
  if (!import.meta.env.DEV) return;
  _cur.loadPhaseMs    += ms;
  if (ms > 0) _cur.loadPhaseDetail = detail;
  // Forward to the active transition profiler (if any) so per-transition
  // summaries include phase-level timings without duplicating instrumentation.
  // Dynamic import would be cleaner but introduces a circular static import
  // path; instead we late-bind through the registered hook.
  if (_transitionPhaseHook !== null && ms > 0) _transitionPhaseHook(detail, ms);
}

/**
 * Hook signature for forwarding `recordLoadPhaseStep` calls to a transition
 * profiler.  Allows `transitionProfiler.ts` to subscribe without creating a
 * static import cycle.
 */
export type LoadPhaseHook = (detail: string, ms: number) => void;
let _transitionPhaseHook: LoadPhaseHook | null = null;

/** Register (or clear, by passing null) the transition profiler forwarder. */
export function setLoadPhaseHook(hook: LoadPhaseHook | null): void {
  _transitionPhaseHook = hook;
}

/**
 * Record scene-lighting stats for this frame.
 * Called from lightingSystem.ts once per renderLightingPass() invocation.
 *
 * @param totalLights    Total lights defined in the room.
 * @param culledLights   Lights that passed viewport culling.
 * @param shadowLights   Shadow-casting lights that ran visibility polygon.
 * @param occluderSegs   Total occluder segments processed across all shadow lights.
 */
export function recordSceneLightStats(
  totalLights: number,
  culledLights: number,
  shadowLights: number,
  occluderSegs: number,
): void {
  if (!import.meta.env.DEV) return;
  _cur.sceneLightTotalCount       = totalLights;
  _cur.sceneLightCulledCount      = culledLights;
  _cur.sceneLightShadowCount      = shadowLights;
  _cur.sceneLightOccluderSegCount = occluderSegs;
}

/** Record that the bloom composite was skipped because no glow was submitted. */
export function recordBloomSkippedNoGlow(): void {
  if (!import.meta.env.DEV) return;
  _cur.bloomSkippedNoGlow = true;
}

/**
 * Record chunks built during an idle prewarm slice.
 * Called from roomRenderChunkWarmScheduler.ts; no-ops in production.
 */
export function recordPrewarmSlice(_chunksBuilt: number): void {
  // Currently a lightweight no-op that keeps the call in place for future
  // per-frame aggregation if desired.  The scheduler tracks its own stats.
}

/** Set the current room/camera context for structured freeze warnings. */
export function setFrameContext(
  roomId: string,
  camBlockRange: string,
  playerBlock: string,
): void {
  if (!import.meta.env.DEV) return;
  _contextRoomId        = roomId;
  _contextCamBlockRange = camBlockRange;
  _contextPlayerBlock   = playerBlock;
}

/**
 * Record what the game is doing for this frame.
 * Call once per RAF frame from gameScreen, at the point where the frame path
 * is known (gameplay, loading, editor, paused).  Used to flag active-gameplay
 * freezes in console warnings and the debug overlay.
 */
export function setFrameGameContext(ctx: FrameContext): void {
  if (!import.meta.env.DEV) return;
  _cur.frameContext = ctx;
}

/**
 * Call at the end of the RAF callback.
 * Commits the current frame to the ring buffer and emits console warnings
 * for long frames.
 */
export function endFrame(): void {
  if (!import.meta.env.DEV) return;
  const c = _cur;

  // Determine top cause
  const causes: Array<[string, number]> = [
    ['wallChunks',     c.wallChunkBuildMs],
    ['bgChunks',       c.bgChunkBuildMs],
    ['spriteBake',     c.spriteBakeMs],
    ['edgeShading',    c.edgeShadingMs],
    ['layoutSig',      c.layoutSigMs],
    ['layoutRebuild',  c.layoutRebuildMs],
    ['preload',        c.preloadMainThreadMs],
    ['loadPhase',      c.loadPhaseMs],
  ];
  let topCause = '';
  let topMs = 0;
  for (const [name, ms] of causes) {
    if (ms > topMs) { topMs = ms; topCause = name; }
  }
  c.topCause = topCause;

  // Commit to ring
  const slot = _ring[_ringHead];
  // Copy c → slot (avoid object churn)
  Object.assign(slot, c);
  _ringHead = (_ringHead + 1) % RING_SIZE;

  // Emit structured warnings
  if (c.frameMs >= LONG_FRAME_WARN_MS) {
    const severity = c.frameMs >= SEVERE_FREEZE_MS ? 'SEVERE FREEZE' : 'LONG FRAME';
    // Mark active-gameplay freezes prominently — these are the ones that matter most.
    const ctxTag = c.frameContext === 'gameplay' ? ' ⚠ GAMEPLAY' : ` (${c.frameContext})`;
    console.warn(
      `[freeze] ${severity}${ctxTag} ${c.frameMs.toFixed(1)}ms\n` +
      `  topCause=${c.topCause}\n` +
      `  wallChunks=${c.wallChunkBuiltCount} (${c.wallChunkBuildMs.toFixed(1)}ms)\n` +
      `  bgChunks=${c.bgChunkBuiltCount} (${c.bgChunkBuildMs.toFixed(1)}ms)\n` +
      `  spriteBakeCount=${c.spriteBakeCount} spriteBakeMs=${c.spriteBakeMs.toFixed(1)}ms\n` +
      `  edgeShadingCount=${c.edgeShadingCount} edgeShadingMs=${c.edgeShadingMs.toFixed(1)}ms\n` +
      `  layoutSigMs=${c.layoutSigMs.toFixed(1)}ms layoutRebuildMs=${c.layoutRebuildMs.toFixed(1)}ms\n` +
      `  preloadMs=${c.preloadMainThreadMs.toFixed(1)}ms (${c.preloadMainThreadRoomId})\n` +
      `  loadPhase=${c.loadPhaseMs.toFixed(1)}ms (${c.loadPhaseDetail})\n` +
      `  sceneLights total=${c.sceneLightTotalCount} culled=${c.sceneLightCulledCount} shadow=${c.sceneLightShadowCount} occSegs=${c.sceneLightOccluderSegCount}\n` +
      `  bloomSkippedNoGlow=${c.bloomSkippedNoGlow}\n` +
      `  frameContext=${c.frameContext}\n` +
      `  roomId=${_contextRoomId}\n` +
      `  cameraBlockRange=${_contextCamBlockRange}\n` +
      `  playerBlock=${_contextPlayerBlock}`,
    );
    _lastLongFrame = slot;
    if (c.frameMs >= SEVERE_FREEZE_MS) {
      _lastSevereFreeze = slot;
    }
  }
}

// ── Read-only accessors for debug overlay ─────────────────────────────────────

/** Returns a snapshot of the most recent `count` frames (oldest-first). */
export function getRecentFrames(count: number): readonly FreezeFrameData[] {
  if (!import.meta.env.DEV) return [];
  const n = Math.min(count, RING_SIZE);
  const out: FreezeFrameData[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const idx = (_ringHead - 1 - i + RING_SIZE) % RING_SIZE;
    out.push(_ring[idx]);
  }
  return out;
}

/** Returns a copy of the most recent completed frame's data (or null before first endFrame). */
export function getLastFrame(): FreezeFrameData | null {
  if (!import.meta.env.DEV) return null;
  const idx = (_ringHead - 1 + RING_SIZE) % RING_SIZE;
  const f = _ring[idx];
  return f.frameMs === 0 ? null : f;
}

/** Returns the last frame that exceeded LONG_FRAME_WARN_MS (100 ms). */
export function getLastLongFrame(): FreezeFrameData | null {
  if (!import.meta.env.DEV) return null;
  return _lastLongFrame;
}

/** Returns the last frame that exceeded SEVERE_FREEZE_MS (1000 ms). */
export function getLastSevereFreeze(): FreezeFrameData | null {
  if (!import.meta.env.DEV) return null;
  return _lastSevereFreeze;
}
