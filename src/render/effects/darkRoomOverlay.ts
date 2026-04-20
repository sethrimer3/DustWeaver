/**
 * Dark room overlay system.
 *
 * Manages an offscreen canvas the same size as the virtual canvas.  Each
 * frame the canvas is filled with near-opaque black and then radial
 * "light hole" gradients are punched into it using destination-out
 * compositing at every registered light source.  The resulting darkness
 * mask is then composited over the main virtual canvas via source-over,
 * so only the areas within a light radius remain visible.
 *
 * The bloom system is separate and composited on top at device resolution,
 * giving the glow sources extra atmospheric radiance.
 */

/** A single point light source in virtual-pixel coordinates. */
export interface LightSourcePx {
  /** Horizontal centre of the light, in virtual canvas pixels. */
  xPx: number;
  /** Vertical centre of the light, in virtual canvas pixels. */
  yPx: number;
  /**
   * Outer radius of the illuminated circle (virtual pixels).
   * Darkness fades from transparent at the centre to fully opaque at this radius.
   */
  radiusPx: number;
  /**
   * Inner radius fraction in [0, 1].  The circle interior up to
   * (innerFraction * radiusPx) is fully transparent (maximum light).
   * Defaults to 0.25 when omitted.
   */
  innerFraction?: number;
}

/** How opaque the darkness layer is.  1 = pitch black, < 1 = some ambient. */
const DARKNESS_ALPHA = 0.96;

export class DarkRoomOverlay {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _ctx: CanvasRenderingContext2D;
  private _widthPx = 1;
  private _heightPx = 1;

  constructor() {
    this._canvas = document.createElement('canvas');
    const ctx = this._canvas.getContext('2d');
    if (ctx === null) throw new Error('DarkRoomOverlay: failed to get 2D context');
    this._ctx = ctx;
    this.resize(1, 1);
  }

  resize(widthPx: number, heightPx: number): void {
    this._widthPx  = Math.max(1, widthPx);
    this._heightPx = Math.max(1, heightPx);
    this._canvas.width  = this._widthPx;
    this._canvas.height = this._heightPx;
  }

  /**
   * Builds the darkness mask and composites it over `targetCtx`.
   *
   * Must be called while the target context's clip region is still active
   * (i.e. inside the room-clipped `ctx.save()` block in `renderFrame`).
   * The clip automatically constrains the darkness to the room rectangle.
   *
   * @param targetCtx  The virtual canvas 2D context.
   * @param lights     Light sources to illuminate (punch holes in darkness).
   */
  render(
    targetCtx: CanvasRenderingContext2D,
    lights: readonly LightSourcePx[],
  ): void {
    const w = this._widthPx;
    const h = this._heightPx;
    const ctx = this._ctx;

    // ── Step 1: fill darkness canvas with near-opaque black ─────────────────
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = DARKNESS_ALPHA;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1.0;

    // ── Step 2: punch light holes using destination-out ──────────────────────
    ctx.globalCompositeOperation = 'destination-out';
    for (let li = 0; li < lights.length; li++) {
      const light = lights[li];
      const innerR = light.radiusPx * (light.innerFraction ?? 0.25);
      const grad = ctx.createRadialGradient(
        light.xPx, light.yPx, Math.max(0, innerR),
        light.xPx, light.yPx, light.radiusPx,
      );
      grad.addColorStop(0,   'rgba(0,0,0,1)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.75)');
      grad.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(light.xPx, light.yPx, light.radiusPx, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // ── Step 3: composite darkness over the virtual canvas ───────────────────
    // Do NOT reset the transform or the active clip will stop functioning.
    // The active room-clip in targetCtx constrains the drawImage automatically.
    targetCtx.save();
    targetCtx.globalCompositeOperation = 'source-over';
    targetCtx.globalAlpha = 1.0;
    targetCtx.imageSmoothingEnabled = false;
    targetCtx.drawImage(this._canvas, 0, 0);
    targetCtx.restore();
  }
}
