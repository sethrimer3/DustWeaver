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
 * Shadow occluders (produced by shadowCaster.ts) are drawn *after* the
 * light holes with source-over compositing, re-darkening part of each
 * punched circle so the player visibly blocks the light cone.
 *
 * The bloom system is separate and composited on top at device resolution,
 * giving the glow sources extra atmospheric radiance.
 *
 * Performance (BUILD 271):
 *   Light holes are drawn using pre-rendered 128×128 "hole canvases" instead
 *   of creating a new radial gradient per light per frame.  Gradients are
 *   pre-built for 8 quantized innerFraction values (0.05 … 0.40 in steps of
 *   0.05) and reused via drawImage scaling.  This eliminates all per-light
 *   gradient allocations in the hot render path.
 */

import type { ShadowCasterOccluderPx } from './shadowCaster';
export type { ShadowCasterOccluderPx } from './shadowCaster';

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

// ── Pre-rendered light-hole canvas cache ─────────────────────────────────────
// Instead of calling createRadialGradient() for every light every frame we
// pre-render 8 small canvases (one per quantized innerFraction value) in the
// constructor and reuse them via drawImage().  Each canvas is 128×128 so that
// drawImage with bilinear scaling looks smooth at any light radius.
//
// Each canvas contains:
//   - Black pixels with alpha varying from 1.0 at the gradient centre
//     (innerFraction * 64 px from (64,64)) down to 0.0 at the outer radius
//     (64 px), with an intermediate stop at 0.75 alpha at the midpoint.
//   - Corners are fully transparent because the gradient fades to 0 at r=64.
//
// With destination-out compositing, high-alpha pixels erase the destination
// (punch holes in the darkness), and zero-alpha pixels leave it unchanged.
// The result is visually identical to the per-frame gradient approach.

/** Texture size for pre-rendered light-hole canvases (pixels). */
const HOLE_CANVAS_SIZE = 128;
/** Half of HOLE_CANVAS_SIZE for computing the gradient centre. */
const HOLE_CANVAS_HALF = HOLE_CANVAS_SIZE / 2;

/** Quantized innerFraction values for which a hole canvas is pre-built. */
const INNER_FRACTIONS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40] as const;

/** Build a 128×128 light-hole canvas for a given innerFraction. */
function _buildLightHoleCanvas(innerFraction: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width  = HOLE_CANVAS_SIZE;
  canvas.height = HOLE_CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return canvas; // fallback: empty canvas (no punch)
  const innerR = HOLE_CANVAS_HALF * innerFraction;
  const grad = ctx.createRadialGradient(
    HOLE_CANVAS_HALF, HOLE_CANVAS_HALF, Math.max(0, innerR),
    HOLE_CANVAS_HALF, HOLE_CANVAS_HALF, HOLE_CANVAS_HALF,
  );
  grad.addColorStop(0,   'rgba(0,0,0,1)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.75)');
  grad.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  // Fill the full square — corners are alpha=0 so they do not affect compositing.
  ctx.fillRect(0, 0, HOLE_CANVAS_SIZE, HOLE_CANVAS_SIZE);
  return canvas;
}

export class DarkRoomOverlay {
  private readonly _canvas: HTMLCanvasElement;
  private readonly _ctx: CanvasRenderingContext2D;
  private _widthPx = 1;
  private _heightPx = 1;

  /**
   * Pre-rendered light-hole canvases keyed by (innerFraction * 100) rounded.
   * Built once in the constructor; reused every frame.
   */
  private readonly _holeCanvases = new Map<number, HTMLCanvasElement>();

  constructor() {
    this._canvas = document.createElement('canvas');
    const ctx = this._canvas.getContext('2d');
    if (ctx === null) throw new Error('DarkRoomOverlay: failed to get 2D context');
    this._ctx = ctx;
    this.resize(1, 1);

    // Pre-render hole canvases for each quantized innerFraction.
    for (const frac of INNER_FRACTIONS) {
      const key = Math.round(frac * 100);
      this._holeCanvases.set(key, _buildLightHoleCanvas(frac));
    }
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
   * @param shadows    Shadow occluder polygons drawn after the light holes,
   *                   re-darkening parts of the illuminated area behind the
   *                   player.  Defaults to an empty array (no shadows).
   */
  render(
    targetCtx: CanvasRenderingContext2D,
    lights: readonly LightSourcePx[],
    shadows: readonly ShadowCasterOccluderPx[] = [],
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
    // Each light is rendered by drawing a pre-built hole canvas scaled to the
    // light's radius.  This replaces per-frame createRadialGradient() calls
    // with cheaper drawImage() calls (BUILD 271 performance fix).
    ctx.globalCompositeOperation = 'destination-out';
    // Bilinear smoothing is important here so the scaled gradient remains soft.
    ctx.imageSmoothingEnabled = true;
    for (let li = 0; li < lights.length; li++) {
      const light   = lights[li];
      const frac    = light.innerFraction ?? 0.25;
      // Map frac → nearest pre-built key (integers 5, 10, 15, 20, 25, 30, 35, 40).
      const mapKey  = Math.max(5, Math.min(40, Math.round(frac / 0.05) * 5));
      const holeCanvas = this._holeCanvases.get(mapKey);
      if (holeCanvas === undefined) {
        // Fallback: create gradient on the fly (should not happen in practice).
        const innerR = light.radiusPx * frac;
        const grad   = ctx.createRadialGradient(
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
      } else {
        // Fast path: drawImage scales the pre-rendered soft-gradient canvas.
        // The hole canvas has alpha=0 in the outer corners, so drawing a full
        // square is safe — transparent pixels have no effect in destination-out.
        const d = 2 * light.radiusPx;
        ctx.drawImage(holeCanvas, light.xPx - light.radiusPx, light.yPx - light.radiusPx, d, d);
      }
    }

    // ── Step 2.5: draw shadow occluder polygons ──────────────────────────────
    // After the light holes are punched we re-darken the illuminated region
    // behind the player using source-over.  Each occluder is a tapered quad
    // drawn twice: once as a soft wide penumbra at low alpha, once as the
    // crisp core at full alpha.
    if (shadows.length > 0) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000000';

      for (let si = 0; si < shadows.length; si++) {
        const s = shadows[si];
        const coreAlpha = s.alpha ?? 0.88;

        // Half-width vectors from the midpoint toward A (base and tip sides).
        // Used to expand the penumbra outward by PENUMBRA_EXPAND.
        const baseHalfX = (s.baseAx - s.baseBx) * 0.5;
        const baseHalfY = (s.baseAy - s.baseBy) * 0.5;
        const tipHalfX  = (s.tipAx  - s.tipBx)  * 0.5;
        const tipHalfY  = (s.tipAy  - s.tipBy)  * 0.5;

        const PENUMBRA_EXPAND = 0.30; // 30 % wider than the core shadow

        // Soft penumbra (wider polygon at reduced alpha).
        ctx.globalAlpha = coreAlpha * 0.38;
        ctx.beginPath();
        ctx.moveTo(
          s.baseAx + baseHalfX * PENUMBRA_EXPAND,
          s.baseAy + baseHalfY * PENUMBRA_EXPAND,
        );
        ctx.lineTo(
          s.baseBx - baseHalfX * PENUMBRA_EXPAND,
          s.baseBy - baseHalfY * PENUMBRA_EXPAND,
        );
        ctx.lineTo(
          s.tipBx - tipHalfX * PENUMBRA_EXPAND,
          s.tipBy - tipHalfY * PENUMBRA_EXPAND,
        );
        ctx.lineTo(
          s.tipAx + tipHalfX * PENUMBRA_EXPAND,
          s.tipAy + tipHalfY * PENUMBRA_EXPAND,
        );
        ctx.closePath();
        ctx.fill();

        // Core shadow (crisp trapezoid at full alpha).
        ctx.globalAlpha = coreAlpha;
        ctx.beginPath();
        ctx.moveTo(s.baseAx, s.baseAy);
        ctx.lineTo(s.baseBx, s.baseBy);
        ctx.lineTo(s.tipBx,  s.tipBy);
        ctx.lineTo(s.tipAx,  s.tipAy);
        ctx.closePath();
        ctx.fill();
      }

      ctx.globalAlpha = 1.0;
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
