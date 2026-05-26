/**
 * renderProfiler.ts — Lightweight per-render-stage timing overlay.
 *
 * Only active when the game's debug mode is on.  When debug is off every
 * method is a near-zero no-op (single boolean guard, no performance.now()
 * call, no allocations).
 *
 * Usage (inside renderFrame):
 *
 *   profiler.beginFrame(isDebugMode);
 *
 *   profiler.stageBegin(STAGE_BACKGROUND);
 *   // ... draw background ...
 *   profiler.stageEnd(STAGE_BACKGROUND);
 *
 *   // ... more stages ...
 *
 *   profiler.endFrame();
 *
 * The overlay is rendered inside gameHudRenderer by calling:
 *   profiler.drawOverlay(ctx, virtualWidthPx, isDebugMode);
 *
 * Displayed values are exponentially-smoothed so numbers are readable rather
 * than flickering every frame.
 *
 * Frame-pacing diagnostics (BUILD 271):
 *   - recordFrameTime(ms) — call once per RAF frame with the raw elapsed ms.
 *     Updates the ring buffer and long-frame counters unconditionally so
 *     stats are populated the moment debug mode is enabled.
 *   - setAdaptiveReduction(active) — signal whether adaptive quality has
 *     automatically lowered effects to stay within the frame budget.
 *   - The overlay shows: current FPS, average FPS, 1% low FPS, current frame
 *     time, worst frame time in the ring window, and cumulative long-frame
 *     counts (>20 ms, >33 ms, >50 ms).
 */

import type { ChunkCacheStats } from '../walls/chunkRenderCache';
import type { TransitionDebugStats } from '../transitions/transitionState';
import type { LiquidDebugStats } from '../liquidBodyCache';
import type { EntryWarmState } from '../../screens/entryViewportWarm';
import type { DebugPanelVisibility } from '../../ui/debugPanelManager';
import { isPanelVisible } from '../../ui/debugPanelManager';
import * as FP from '../../debug/perfFreezeProfiler';
import { getBgImageStats } from '../backgroundRenderer';

// ── Stage identifiers ────────────────────────────────────────────────────────

export const STAGE_BACKGROUND   = 0;
export const STAGE_WALLS        = 1;
export const STAGE_ENTITIES     = 2;
export const STAGE_PARTICLES    = 3;
export const STAGE_DUST         = 4;
export const STAGE_SUNBEAMS     = 5;
export const STAGE_BLOOM        = 6;
export const STAGE_LIGHTING     = 7;
export const STAGE_HUD          = 8;
/** Background block chunk rendering (BUILD 288). */
export const STAGE_BG_BLOCKS    = 9;
/** Wall decoration sprites (BUILD 288). */
export const STAGE_DECORATIONS  = 10;
/** Dark ambient blocker overlay (BUILD 288). */
export const STAGE_DARK_BLOCKER = 11;
/** Device-canvas upscale drawImage (BUILD 288). */
export const STAGE_UPSCALE      = 12;
/** Total render frame time (measured from beginFrame to endFrame). */
export const STAGE_TOTAL        = 13;
export const STAGE_COUNT        = 14;

const STAGE_LABELS: readonly string[] = [
  'BG   ',
  'Walls',
  'Entt ',
  'Part ',
  'Dust ',
  'Beam ',
  'Bloom',
  'Light',
  'HUD  ',
  'BgBlk',
  'Decor',
  'DkBlk',
  'Scale',
  'TOTAL',
];

// ── EMA smoothing factor ─────────────────────────────────────────────────────
// Weight of the new sample vs the running average.  0.1 ≈ ~10-frame smoothing.
const EMA_ALPHA = 0.1;

// ── Pre-allocated overlay string buffer ─────────────────────────────────────
// We keep a fixed-size string label array to avoid allocating new strings on
// every draw call.  Values are formatted once per frame when debug is on.
// Pre-allocated overlay string buffer (STAGE_COUNT entries, one per stage).
const _lineBuffer: string[] = new Array(STAGE_COUNT).fill('') as string[];

/** Max characters shown for room IDs in the transition debug panel. */
const MAX_ROOM_ID_DISPLAY_LENGTH = 14;

// ── RenderProfiler class ────────────────────────────────────────────────────

export class RenderProfiler {
  private _isActive = false;
  private readonly _stageStartMs  = new Float64Array(STAGE_COUNT);
  private readonly _stageSumMs    = new Float64Array(STAGE_COUNT);
  private readonly _smoothedMs    = new Float64Array(STAGE_COUNT);
  private _frameStartMs = 0;

  // ── Ring buffer for raw frame-time history ─────────────────────────────────
  // Pre-allocated so recordFrameTime() never allocates.  Holds ~4 seconds of
  // history at 60 fps.  Updated unconditionally every RAF frame so the stats
  // are immediately useful when debug mode is first enabled.
  private static readonly RING_SIZE = 256;
  private readonly _frameTimes = new Float32Array(RenderProfiler.RING_SIZE);
  /** Write position in the ring buffer (wraps modulo RING_SIZE). */
  private _ringHead = 0;
  /** Number of valid entries written so far (saturates at RING_SIZE). */
  private _ringCount = 0;

  // ── Long-frame event counters ──────────────────────────────────────────────
  // Cumulative since the profiler was constructed; never reset automatically.
  /** Frames > 20 ms (~50 fps budget exceeded). */
  private _longFrames20ms = 0;
  /** Frames > 33 ms (~30 fps budget exceeded). */
  private _longFrames33ms = 0;
  /** Frames > 50 ms (~20 fps budget exceeded). */
  private _longFrames50ms = 0;

  // ── Adaptive quality status ────────────────────────────────────────────────
  /** True when adaptive quality has automatically lowered effects. */
  private _adaptiveReductionActive = false;

  // ── Scratch for 1% low computation (allocation-free) ──────────────────────
  // Stores the 3 worst frame times found during the ring-buffer scan.
  private readonly _worstScratch = new Float32Array(3);

  /** Latest chunk cache stats (foreground walls), set each frame when debug mode is active. */
  private _chunkStats: ChunkCacheStats | null = null;

  /** Latest background-block chunk stats, set each frame when debug mode is active. */
  private _bgChunkStats: ChunkCacheStats | null = null;

  /** Latest transition debug stats, set each frame when debug mode is active. */
  private _transitionStats: TransitionDebugStats | null = null;

  /** Latest liquid body debug stats. */
  private _liquidStats: LiquidDebugStats | null = null;

  /** Latest prewarm stats from the chunk warm scheduler. */
  private _prewarmStats: import('../../screens/roomRenderChunkWarmScheduler').PrewarmStats | null = null;

  /** Latest entry warm state snapshot for the prewarm debug panel. */
  private _entryWarmState: EntryWarmState | null = null;

  /**
   * Store the latest chunk-cache diagnostic counters.
   * Call this from gameRender.ts after the walls render stage when debug mode
   * is on; drawOverlay() will append the values to the profiler panel.
   */
  updateChunkStats(stats: ChunkCacheStats): void {
    this._chunkStats = stats;
  }

  /**
   * Store the latest background-block chunk-cache stats.
   * Call this from gameRender.ts after the background-blocks render stage
   * when debug mode is on.
   */
  updateBgChunkStats(stats: ChunkCacheStats): void {
    this._bgChunkStats = stats;
  }

  /**
   * Store the latest room-transition debug stats.
   * Call this once per frame from gameScreen.ts when debug mode is on.
   */
  updateTransitionStats(stats: TransitionDebugStats): void {
    this._transitionStats = stats;
  }

  /**
   * Store the latest liquid body debug stats.
   * Call this once per frame from gameRender.ts when debug mode is on.
   */
  updateLiquidStats(stats: LiquidDebugStats): void {
    this._liquidStats = stats;
  }

  /**
   * Store the latest prewarm stats from roomRenderChunkWarmScheduler.
   * Call this once per frame from gameScreen.ts when debug mode is on.
   */
  updatePrewarmStats(stats: import('../../screens/roomRenderChunkWarmScheduler').PrewarmStats): void {
    this._prewarmStats = stats;
  }

  /**
   * Store a snapshot of the current entry warm state for the debug overlay.
   * Call this once per frame from gameScreen.ts when debug mode is on.
   */
  updateEntryWarmState(state: EntryWarmState): void {
    this._entryWarmState = state;
  }

  // ── Frame-pacing API ──────────────────────────────────────────────────────

  /**
   * Record the raw elapsed time for this RAF frame.
   *
   * Call this ONCE per `requestAnimationFrame` callback, before `beginFrame`,
   * using the raw `elapsedMs` value (timestamp delta, not profiler-measured
   * render time).  The ring buffer is always updated so stats are ready the
   * moment debug mode is enabled.
   *
   * Long-frame event counters are only incremented when debug mode is active
   * (i.e. after `beginFrame(true)` has been called at least once this frame).
   */
  recordFrameTime(frameMs: number): void {
    // Always update the ring buffer — unconditional so stats are immediately
    // available when debug mode is first toggled on.
    this._frameTimes[this._ringHead] = frameMs;
    this._ringHead = (this._ringHead + 1) % RenderProfiler.RING_SIZE;
    if (this._ringCount < RenderProfiler.RING_SIZE) this._ringCount++;

    // Accumulate long-frame counts only while actively monitoring.
    if (!this._isActive) return;
    if (frameMs > 50) {
      this._longFrames50ms++;
      this._longFrames33ms++;
      this._longFrames20ms++;
    } else if (frameMs > 33) {
      this._longFrames33ms++;
      this._longFrames20ms++;
    } else if (frameMs > 20) {
      this._longFrames20ms++;
    }
  }

  /**
   * Signal whether the adaptive quality system has currently reduced effects
   * to maintain frame-rate.  The debug overlay shows a warning when true.
   */
  setAdaptiveReduction(active: boolean): void {
    this._adaptiveReductionActive = active;
  }

  /** Current adaptive reduction tier shown in the overlay (0/1/2). */
  private _adaptiveReductionTier: 0 | 1 | 2 = 0;

  /**
   * Signal the current adaptive reduction tier so the overlay can show the
   * correct badge level (T1 = halve caps, T2 = also disable sunbeam/bloom).
   */
  setAdaptiveReductionTier(tier: 0 | 1 | 2): void {
    this._adaptiveReductionTier = tier;
  }

  /**
   * Returns the exponentially-smoothed average frame time (milliseconds).
   *
   * Used by the adaptive quality system in gameScreen.ts to decide whether
   * to lower quality caps.  Returns 0 before any frames have been recorded.
   * Safe to call every RAF frame — reads from a pre-smoothed scalar.
   */
  getAvgFrameMs(): number {
    return this._smoothedMs[STAGE_TOTAL];
  }

  /**
   * Returns the most-recently recorded raw frame time (ms).
   * Used by the chunk prewarm scheduler to detect high-load frames and
   * reduce or pause prewarming.  Returns 0 before any frame has been recorded.
   */
  getLastFrameMs(): number {
    if (this._ringCount === 0) return 0;
    const idx = (this._ringHead - 1 + RenderProfiler.RING_SIZE) % RenderProfiler.RING_SIZE;
    return this._frameTimes[idx];
  }

  /**
   * Compute the approximate 1% low FPS from the ring buffer.
   * Finds the worst 3 frame times (allocation-free via _worstScratch) and
   * averages them, then converts to FPS.  Returns 0 when the buffer is empty.
   *
   * "1% low" here means: average the worst 1% of frames in the populated ring
   * buffer (i.e., Math.ceil(count × 0.01) frames, capped at 3 by the scratch
   * buffer size), then express the result as FPS.
   */
  private _getOnePercentLow(): number {
    const count = this._ringCount;
    if (count === 0) return 0;

    const s = this._worstScratch;
    s[0] = 0; s[1] = 0; s[2] = 0;
    for (let i = 0; i < count; i++) {
      const t = this._frameTimes[i];
      if (t > s[0])      { s[2] = s[1]; s[1] = s[0]; s[0] = t; }
      else if (t > s[1]) { s[2] = s[1]; s[1] = t; }
      else if (t > s[2]) { s[2] = t; }
    }
    // 1% of populated count (max 3 because scratch has 3 slots).
    const nWorst = Math.min(3, Math.max(1, Math.ceil(count * 0.01)));
    let sum = 0;
    for (let i = 0; i < nWorst; i++) sum += s[i];
    const avgWorstMs = sum / nWorst;
    return avgWorstMs > 0 ? 1000 / avgWorstMs : 0;
  }

  /** Worst (highest) frame time in the current ring buffer window (ms). */
  private _getWorstFrameMs(): number {
    let worst = 0;
    const count = this._ringCount;
    for (let i = 0; i < count; i++) {
      if (this._frameTimes[i] > worst) worst = this._frameTimes[i];
    }
    return worst;
  }

  /**
   * Call at the very start of renderFrame.
   * When `isDebugMode` is false this is effectively a no-op.
   */
  beginFrame(isDebugMode: boolean): void {
    this._isActive = isDebugMode;
    if (!isDebugMode) return;
    this._frameStartMs = performance.now();
    this._stageSumMs.fill(0);
  }

  /** Call just before a render stage begins. */
  stageBegin(stageId: number): void {
    if (!this._isActive) return;
    this._stageStartMs[stageId] = performance.now();
  }

  /** Call immediately after a render stage ends. */
  stageEnd(stageId: number): void {
    if (!this._isActive) return;
    this._stageSumMs[stageId] += performance.now() - this._stageStartMs[stageId];
  }

  /**
   * Call at the very end of renderFrame (after all stages including HUD).
   * Updates the smoothed totals used by drawOverlay().
   */
  endFrame(): void {
    if (!this._isActive) return;
    const totalMs = performance.now() - this._frameStartMs;
    for (let i = 0; i < STAGE_COUNT - 1; i++) {
      this._smoothedMs[i] = this._smoothedMs[i] * (1 - EMA_ALPHA) + this._stageSumMs[i] * EMA_ALPHA;
    }
    this._smoothedMs[STAGE_TOTAL] = this._smoothedMs[STAGE_TOTAL] * (1 - EMA_ALPHA) + totalMs * EMA_ALPHA;
  }

  /**
   * Draw the profiler overlay into the given canvas context.
   * Must be called while in a region where screen-space HUD drawing is safe
   * (i.e. after the room clip is closed).
   * When `isDebugMode` is false, returns immediately without drawing anything.
   * When `panelVisibility` is provided each section is shown only when its
   * flag is true; pass undefined to show all (legacy / backward-compat).
   */
  drawOverlay(
    ctx: CanvasRenderingContext2D,
    virtualWidthPx: number,
    isDebugMode: boolean,
    panelVisibility?: DebugPanelVisibility,
  ): void {
    if (!isDebugMode) return;

    const showPerf   = isPanelVisible('performance', panelVisibility);
    const showChunks = isPanelVisible('chunks',      panelVisibility);
    const showRoom   = isPanelVisible('room',        panelVisibility);
    const showWater  = isPanelVisible('water',       panelVisibility);
    const showFreeze = isPanelVisible('freeze',      panelVisibility);
    const showPrewarm = isPanelVisible('prewarm',    panelVisibility);

    // Nothing to render — bail early to avoid drawing an empty frame.
    if (!showPerf && !showChunks && !showRoom && !showWater && !showFreeze && !showPrewarm) return;

    const lineHeightPx = 9;
    const fontSizePx   = 7;
    const panelWidth   = 128;
    const padXPx       = virtualWidthPx - panelWidth - 4;
    let   nextPanelY   = 8;

    // ── FPS / frame-time panel + per-stage timing (performance) ──────────────
    if (showPerf) {
      ctx.save();
      ctx.font = `${fontSizePx}px monospace`;

      const ringCount = this._ringCount;
      const lastFrameMs = ringCount > 0
        ? this._frameTimes[(this._ringHead - 1 + RenderProfiler.RING_SIZE) % RenderProfiler.RING_SIZE]
        : 0;
      const avgFrameMs   = this._smoothedMs[STAGE_TOTAL];
      const avgFps       = avgFrameMs > 0  ? 1000 / avgFrameMs  : 0;
      const currentFps   = lastFrameMs > 0 ? 1000 / lastFrameMs : 0;
      const onePercentLow = this._getOnePercentLow();
      const worstFrameMs  = this._getWorstFrameMs();

      const fpsLines: readonly string[] = [
        `FPS cur:${currentFps.toFixed(0)} avg:${avgFps.toFixed(0)} 1%:${onePercentLow.toFixed(0)}`,
        `Frame now:${lastFrameMs.toFixed(1)}ms wrst:${worstFrameMs.toFixed(1)}ms`,
        `>20ms:${this._longFrames20ms} >33:${this._longFrames33ms} >50:${this._longFrames50ms}`,
      ];
      const fpsPanelH = fpsLines.length * lineHeightPx + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.60)';
      ctx.fillRect(padXPx - 4, nextPanelY - 4, panelWidth + 8, fpsPanelH);
      for (let i = 0; i < fpsLines.length; i++) {
        let lineColor: string;
        if (i === 0) {
          lineColor = '#ffff60';
        } else if (i === 2 && this._longFrames50ms > 0) {
          lineColor = '#ff6060'; // warn red when there are >50 ms frames
        } else {
          lineColor = '#e0e080';
        }
        ctx.fillStyle = lineColor;
        ctx.fillText(fpsLines[i], padXPx, nextPanelY + fontSizePx + i * lineHeightPx);
      }
      if (this._adaptiveReductionActive) {
        const tierLabel = this._adaptiveReductionTier >= 2 ? '!! ADAPTIVE T2 (deep)' : '!  ADAPTIVE T1';
        ctx.fillStyle = this._adaptiveReductionTier >= 2 ? '#ff2020' : '#ff6020';
        ctx.fillText(tierLabel, padXPx, nextPanelY + fpsPanelH - 2);
      }
      nextPanelY += fpsPanelH + 4;

      // ── Per-stage timing panel ──────────────────────────────────────────────
      const panelHeight  = STAGE_COUNT * lineHeightPx + 8;

      // Build label strings (reuses _lineBuffer — no per-call allocation)
      for (let i = 0; i < STAGE_COUNT; i++) {
        _lineBuffer[i] = `${STAGE_LABELS[i]} ${this._smoothedMs[i].toFixed(2)}ms`;
      }

      // Background panel
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(padXPx - 4, nextPanelY - 4, panelWidth + 8, panelHeight);

      // Render stage lines in cyan; total line in yellow
      for (let i = 0; i < STAGE_COUNT; i++) {
        ctx.fillStyle = i === STAGE_TOTAL ? '#ffd23c' : '#00e5ff';
        ctx.fillText(_lineBuffer[i], padXPx, nextPanelY + fontSizePx + i * lineHeightPx);
      }

      nextPanelY += panelHeight + 4;
      ctx.restore();
    }

    // ── Chunk cache stats panel ───────────────────────────────────────────────
    if (showChunks && this._chunkStats !== null) {
      const cs = this._chunkStats;
      const chunkLines = [
        `FG Chunks V=${cs.visibleChunkCount} T=${cs.totalChunkCount}`,
        `Dirty=${cs.dirtyChunkCount} Built=${cs.rebuiltThisFrame} Skip=${cs.skippedThisFrame}`,
        `RbldMs=${cs.rebuildMsThisFrame.toFixed(1)} Mem~${cs.memoryEstimateKB}KB`,
      ];
      const chunkPanelH = chunkLines.length * lineHeightPx + 8;
      ctx.save();
      ctx.font = `${fontSizePx}px monospace`;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(padXPx - 4, nextPanelY, panelWidth + 8, chunkPanelH);
      ctx.fillStyle = '#90ee90';
      for (let i = 0; i < chunkLines.length; i++) {
        ctx.fillText(chunkLines[i], padXPx, nextPanelY + fontSizePx + 4 + i * lineHeightPx);
      }
      ctx.restore();
      nextPanelY += chunkPanelH + 4;
    }

    // ── Background-block chunk cache stats panel ──────────────────────────────
    if (showChunks && this._bgChunkStats !== null) {
      const bc = this._bgChunkStats;
      const bgImgStats = getBgImageStats();
      const bgLines = [
        `BG Chunks V=${bc.visibleChunkCount} T=${bc.totalChunkCount}`,
        `Dirty=${bc.dirtyChunkCount} Built=${bc.rebuiltThisFrame} Skip=${bc.skippedThisFrame}`,
        `RbldMs=${bc.rebuildMsThisFrame.toFixed(1)} Mem~${bc.memoryEstimateKB}KB`,
        `BgImg rdy=${bgImgStats.drawReady} !rdy=${bgImgStats.drawNotReady} fb=${bgImgStats.fallbacksThisFrame}`,
      ];
      const bgPanelH = bgLines.length * lineHeightPx + 8;
      ctx.save();
      ctx.font = `${fontSizePx}px monospace`;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(padXPx - 4, nextPanelY, panelWidth + 8, bgPanelH);
      ctx.fillStyle = '#a0d4a0';
      for (let i = 0; i < bgLines.length; i++) {
        ctx.fillText(bgLines[i], padXPx, nextPanelY + fontSizePx + 4 + i * lineHeightPx);
      }
      ctx.restore();
      nextPanelY += bgPanelH + 4;
    }

    // ── Transition debug panel ────────────────────────────────────────────────
    if (showRoom && this._transitionStats !== null) {
      const ts = this._transitionStats;
      const transLines = [
        `Room: ${ts.currentRoomId.slice(0, MAX_ROOM_ID_DISPLAY_LENGTH)}`,
        `Dest: ${ts.destinationRoomId.slice(0, MAX_ROOM_ID_DISPLAY_LENGTH) || '—'}`,
        `Spd@X: ${ts.lastPlayerSpeedWorld.toFixed(0)}wu/s`,
        `Cooldown: ${ts.transitionCooldownMs.toFixed(0)}ms`,
      ];
      const transPanelH = transLines.length * lineHeightPx + 8;
      ctx.save();
      ctx.font = `${fontSizePx}px monospace`;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(padXPx - 4, nextPanelY, panelWidth + 8, transPanelH);
      ctx.fillStyle = '#ffa040';
      for (let i = 0; i < transLines.length; i++) {
        ctx.fillText(transLines[i], padXPx, nextPanelY + fontSizePx + 4 + i * lineHeightPx);
      }
      ctx.restore();
      nextPanelY += transPanelH + 4;
    }

    // ── Liquid body debug panel ───────────────────────────────────────────────
    if (showWater && this._liquidStats !== null) {
      const ls = this._liquidStats;
      const liquidLines  = [
        `Liq tiles: ${ls.liquidTileCount}`,
        `Bodies:    ${ls.liquidBodyCount}`,
        `MrgRects:  ${ls.mergedRectCount}`,
        `Bubbles:   ${ls.activeBubbleCount}`,
        `Rebuilds:  ${ls.cacheRebuildCount}`,
      ];
      const liquidPanelH = liquidLines.length * lineHeightPx + 8;
      ctx.save();
      ctx.font = `${fontSizePx}px monospace`;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(padXPx - 4, nextPanelY, panelWidth + 8, liquidPanelH);
      ctx.fillStyle = '#40d0ff';
      for (let i = 0; i < liquidLines.length; i++) {
        ctx.fillText(liquidLines[i], padXPx, nextPanelY + fontSizePx + 4 + i * lineHeightPx);
      }
      ctx.restore();
      nextPanelY += liquidPanelH + 4;
    }

    // ── Freeze Profiler panel ─────────────────────────────────────────────────
    if (showFreeze) {
      const cur  = FP.getLastFrame();
      const long = FP.getLastLongFrame();
      const sev  = FP.getLastSevereFreeze();
      const freezeLines: string[] = [
        '── Freeze Profiler ──',
        cur !== null
          ? `frame ${cur.frameMs.toFixed(1)}ms  top:${cur.topCause || '—'}`
          : 'frame —',
        cur !== null
          ? `ctx:${cur.frameContext}`
          : 'ctx —',
        cur !== null
          ? `wChk ${cur.wallChunkBuiltCount}×${cur.wallChunkBuildMs.toFixed(1)}ms`
          : 'wChk —',
        cur !== null
          ? `bChk ${cur.bgChunkBuiltCount}×${cur.bgChunkBuildMs.toFixed(1)}ms`
          : 'bChk —',
        cur !== null
          ? `bake ${cur.spriteBakeCount}×${cur.spriteBakeMs.toFixed(1)}ms`
          : 'bake —',
        cur !== null
          ? `edge ${cur.edgeShadingCount}×${cur.edgeShadingMs.toFixed(1)}ms`
          : 'edge —',
        cur !== null
          ? `lay sig${cur.layoutSigMs.toFixed(1)}ms rbl${cur.layoutRebuildMs.toFixed(1)}ms`
          : 'layout —',
        cur !== null && cur.preloadMainThreadMs > 0
          ? `prel ${cur.preloadMainThreadMs.toFixed(1)}ms (${cur.preloadMainThreadRoomId.slice(0, 12)})`
          : 'prel —',
        cur !== null && cur.sceneLightTotalCount > 0
          ? `lit tot=${cur.sceneLightTotalCount} vis=${cur.sceneLightCulledCount} shd=${cur.sceneLightShadowCount} segs=${cur.sceneLightOccluderSegCount}`
          : 'lit —',
        cur !== null && cur.bloomSkippedNoGlow
          ? 'bloom skip(no glow)'
          : 'bloom —',
        long !== null
          ? `last>100: ${long.frameMs.toFixed(0)}ms ${long.topCause}`
          : 'last>100: —',
        sev !== null
          ? `last>1s: ${sev.frameMs.toFixed(0)}ms ${sev.topCause}`
          : 'last>1s: —',
      ];
      const freezePanelH = freezeLines.length * lineHeightPx + 8;
      ctx.save();
      ctx.font = `${fontSizePx}px monospace`;
      ctx.fillStyle = 'rgba(0,0,0,0.70)';
      ctx.fillRect(padXPx - 4, nextPanelY, panelWidth + 8, freezePanelH);
      for (let i = 0; i < freezeLines.length; i++) {
        const isWarn = cur !== null && i === 1 && cur.frameMs > FP.LONG_FRAME_WARN_MS;
        // Highlight active-gameplay freezes in a distinct colour.
        const isGameplayCtx = cur !== null && i === 2 && cur.frameContext === 'gameplay' && cur.frameMs > FP.LONG_FRAME_WARN_MS;
        ctx.fillStyle = isWarn ? '#ff6060' : isGameplayCtx ? '#ffaa00' : i === 0 ? '#ffcc00' : '#d0d0ff';
        ctx.fillText(freezeLines[i], padXPx, nextPanelY + fontSizePx + 4 + i * lineHeightPx);
      }
      ctx.restore();
    }

    // ── Prewarm stats panel ───────────────────────────────────────────────────
    if (showPrewarm && this._prewarmStats !== null) {
      const pw = this._prewarmStats;
      const prewarmLines = [
        '── Chunk Prewarm ──',
        `Queue: ${pw.queueLength}  Radius: ${pw.currentRadius}`,
        `Wall rooms: ${pw.wallRoomCount}  chunks: ${pw.totalWallChunks}`,
        `Wall mem: ~${pw.wallMemoryEstimateKB}KB`,
        `BG rooms: ${pw.bgRoomCount}  chunks: ${pw.totalBgChunks}`,
        `BG mem: ~${pw.bgMemoryEstimateKB}KB`,
        `Total mem: ~${pw.totalPrewarmMemoryKB}KB  budget: ${pw.memoryBudgetKB}KB`,
        `Last slice: ${pw.chunksLastSlice}ch skip:${pw.chunksSkippedLastSlice} ${pw.msLastSlice.toFixed(1)}ms`,
        `W hits: ${pw.wallCacheHits}  miss: ${pw.wallCacheMisses}`,
        `BG hits: ${pw.bgCacheHits}  miss: ${pw.bgCacheMisses}`,
        `Defer!rdy: ${pw.deferredNotReady}  !spr: ${pw.deferredSpritesNotReady}`,
        `Evict pass: ${pw.evictedThisPass}  total: ${pw.totalEvictions}`,
        `Last xtn: ${pw.lastTransitionOutcome}`,
        pw.pausedForFrameTime ? '⚠ PAUSED (frame time)' : '● warming',
      ];
      const prewarmPanelH = prewarmLines.length * lineHeightPx + 8;
      ctx.save();
      ctx.font = `${fontSizePx}px monospace`;
      ctx.fillStyle = 'rgba(0,0,0,0.70)';
      ctx.fillRect(padXPx - 4, nextPanelY, panelWidth + 8, prewarmPanelH);
      for (let i = 0; i < prewarmLines.length; i++) {
        const isHeader  = i === 0;
        const isPaused  = i === prewarmLines.length - 1 && pw.pausedForFrameTime;
        ctx.fillStyle = isHeader ? '#ffdd44' : isPaused ? '#ff6060' : '#a8d8ff';
        ctx.fillText(prewarmLines[i], padXPx, nextPanelY + fontSizePx + 4 + i * lineHeightPx);
      }
      ctx.restore();
      nextPanelY += prewarmPanelH + 4;
    }

    // ── Entry warm stats panel ────────────────────────────────────────────────
    if (showPrewarm && this._entryWarmState !== null) {
      const ew = this._entryWarmState;
      const isWarming = ew.phase === 'warming';
      const ewLines = [
        '── Entry Warm ──',
        `Phase: ${ew.phase}${ew.usedFallbackRelease ? ' (timeout)' : ''}`,
        `Frames: ${ew.framesWarmed}  Chunks: ${ew.chunksWarmed}`,
        `Ms: ${ew.msSpent.toFixed(1)}  Room: ${ew.roomId}`,
      ];
      const ewPanelH = ewLines.length * lineHeightPx + 8;
      ctx.save();
      ctx.font = `${fontSizePx}px monospace`;
      ctx.fillStyle = 'rgba(0,0,0,0.70)';
      ctx.fillRect(padXPx - 4, nextPanelY, panelWidth + 8, ewPanelH);
      for (let i = 0; i < ewLines.length; i++) {
        const isHeader = i === 0;
        ctx.fillStyle = isHeader ? '#ffdd44' : isWarming ? '#ffcc44' : ew.phase === 'timedOut' ? '#ff9944' : '#a8ffa8';
        ctx.fillText(ewLines[i], padXPx, nextPanelY + fontSizePx + 4 + i * lineHeightPx);
      }
      ctx.restore();
    }
  }
}
