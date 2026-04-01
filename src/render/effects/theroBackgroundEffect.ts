/**
 * TheroBackgroundEffect
 *
 * Shared interface for all ported Thero chapter background effects.
 * Each effect is a self-contained render-layer animation: it does not
 * interact with the simulation and may freely use Math.random() and
 * performance.now() since it is purely visual render-layer code.
 */

export interface TheroBackgroundEffect {
  /**
   * Advance the effect simulation by one frame.
   *
   * @param nowMs     Current timestamp in milliseconds (e.g. performance.now()).
   * @param widthPx   Virtual canvas width in pixels (480).
   * @param heightPx  Virtual canvas height in pixels (270).
   */
  update(nowMs: number, widthPx: number, heightPx: number): void;

  /**
   * Render the effect onto the provided 2D canvas context.
   * The context is already in virtual-pixel space (480×270).
   *
   * @param ctx  The 2D canvas rendering context.
   */
  draw(ctx: CanvasRenderingContext2D): void;

  /**
   * Reset all internal state so the effect re-initialises cleanly on the
   * next call to update().  Called when the player leaves the showcase room.
   */
  reset(): void;
}
