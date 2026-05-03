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
 */

// ── Stage identifiers ────────────────────────────────────────────────────────

export const STAGE_BACKGROUND  = 0;
export const STAGE_WALLS       = 1;
export const STAGE_ENTITIES    = 2;
export const STAGE_PARTICLES   = 3;
export const STAGE_DUST        = 4;
export const STAGE_SUNBEAMS    = 5;
export const STAGE_BLOOM       = 6;
export const STAGE_LIGHTING    = 7;
export const STAGE_HUD         = 8;
/** Total render frame time (measured from beginFrame to endFrame). */
export const STAGE_TOTAL       = 9;
export const STAGE_COUNT       = 10;

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
  'TOTAL',
];

// ── EMA smoothing factor ─────────────────────────────────────────────────────
// Weight of the new sample vs the running average.  0.1 ≈ ~10-frame smoothing.
const EMA_ALPHA = 0.1;

// ── Pre-allocated overlay string buffer ─────────────────────────────────────
// We keep a fixed-size string label array to avoid allocating new strings on
// every draw call.  Values are formatted once per frame when debug is on.
const _lineBuffer: string[] = new Array(STAGE_COUNT).fill('') as string[];

// ── RenderProfiler class ────────────────────────────────────────────────────

export class RenderProfiler {
  private _isActive = false;
  private readonly _stageStartMs  = new Float64Array(STAGE_COUNT);
  private readonly _stageSumMs    = new Float64Array(STAGE_COUNT);
  private readonly _smoothedMs    = new Float64Array(STAGE_COUNT);
  private _frameStartMs = 0;

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
   */
  drawOverlay(
    ctx: CanvasRenderingContext2D,
    virtualWidthPx: number,
    isDebugMode: boolean,
  ): void {
    if (!isDebugMode) return;

    const lineHeightPx = 9;
    const fontSizePx   = 7;
    const panelWidth   = 112;
    const panelHeight  = STAGE_COUNT * lineHeightPx + 8;
    const padXPx       = virtualWidthPx - panelWidth - 4;
    const padYPx       = 8;

    // Build label strings (reuses _lineBuffer — no per-call allocation)
    for (let i = 0; i < STAGE_COUNT; i++) {
      _lineBuffer[i] = `${STAGE_LABELS[i]} ${this._smoothedMs[i].toFixed(2)}ms`;
    }

    ctx.save();
    ctx.font = `${fontSizePx}px monospace`;

    // Background panel
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(padXPx - 4, padYPx - 4, panelWidth + 8, panelHeight);

    // Render stage lines in cyan; total line in yellow
    for (let i = 0; i < STAGE_COUNT; i++) {
      ctx.fillStyle = i === STAGE_TOTAL ? '#ffd23c' : '#00e5ff';
      ctx.fillText(_lineBuffer[i], padXPx, padYPx + fontSizePx + i * lineHeightPx);
    }

    ctx.restore();
  }
}
