/**
 * SunbeamRenderer — draws pixel-art atmospheric light shafts (sunbeams) onto
 * a 2D canvas layer using 'screen' composite blending so beams add glow to
 * whatever is drawn below them.
 *
 * Usage:
 *   initFromRoom(room)  — populate beam list from a RoomDef
 *   render(ctx, ox, oy, zoom, nowMs, vpW, vpH) — draw on each frame
 *
 * Placement: call render() BEFORE rendering the dark-ambient overlay so beams
 * appear behind walls but above the background.
 *
 * Performance (BUILD 272):
 *   Linear gradients are cached per beam and invalidated only when the beam's
 *   virtual-pixel-space endpoints shift by more than GRADIENT_REUSE_THRESHOLD_PX
 *   (0.5 px).  The shimmer animation is applied via ctx.globalAlpha rather than
 *   being baked into the gradient colour stops, so the cached gradient object
 *   remains valid across frames while the room is stationary.  createLinearGradient
 *   is now called at most once per beam per room visit rather than every frame.
 */

import type { RoomDef, RoomSunbeamDef } from '../../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import { isScreenRectVisible } from '../viewportCull';

/** Endpoint drift (virtual px) at which the cached gradient is rebuilt. */
const GRADIENT_REUSE_THRESHOLD_PX = 0.5;

/** Maximum number of sunbeams supported per room (pre-allocated cache arrays). */
const MAX_SUNBEAMS = 64;

export class SunbeamRenderer {
  private beams: readonly RoomSunbeamDef[] = [];
  /** Whether sunbeams are enabled (wired to the quality config). */
  private _isEnabled = true;

  // ── Per-beam gradient cache ──────────────────────────────────────────────
  // Pre-allocated arrays: null entries mean no gradient cached for that beam slot.
  private readonly _cachedGrads: (CanvasGradient | null)[] = new Array<CanvasGradient | null>(MAX_SUNBEAMS).fill(null);
  /** Cached origin X (virtual px) for each beam's last gradient build. */
  private readonly _cacheOriginX = new Float32Array(MAX_SUNBEAMS);
  /** Cached origin Y (virtual px) for each beam's last gradient build. */
  private readonly _cacheOriginY = new Float32Array(MAX_SUNBEAMS);
  /** Cached tip X (virtual px) for each beam's last gradient build. */
  private readonly _cacheTipX    = new Float32Array(MAX_SUNBEAMS);
  /** Cached tip Y (virtual px) for each beam's last gradient build. */
  private readonly _cacheTipY    = new Float32Array(MAX_SUNBEAMS);

  initFromRoom(room: RoomDef): void {
    this.beams = room.sunbeams ?? [];
    // Invalidate all cached gradients when a new room is loaded.
    this._cachedGrads.fill(null);
  }

  /** Toggle sunbeam rendering on/off based on graphics quality tier. */
  setEnabled(enabled: boolean): void {
    this._isEnabled = enabled;
  }

  /**
   * Set a density multiplier for beam intensity (0–1).
   * At 0.5 (adaptive tier 1), beam alpha is scaled down so beams are subtler
   * without disabling them entirely.  1.0 = full intensity (default).
   * Tier 2 should call setEnabled(false) instead.
   */
  private _densityMultiplier = 1.0;
  setDensityMultiplier(m: number): void {
    this._densityMultiplier = Math.max(0, Math.min(1, m));
  }

  render(
    ctx: CanvasRenderingContext2D,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
    nowMs: number,
    vpW: number,
    vpH: number,
  ): void {
    if (!this._isEnabled || this.beams.length === 0) return;

    const prevComposite = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'screen';

    for (let i = 0; i < this.beams.length; i++) {
      this._drawBeam(ctx, this.beams[i], i, offsetXPx, offsetYPx, zoom, nowMs, vpW, vpH);
    }

    ctx.globalCompositeOperation = prevComposite;
  }

  private _drawBeam(
    ctx: CanvasRenderingContext2D,
    beam: RoomSunbeamDef,
    beamIndex: number,
    offsetXPx: number,
    offsetYPx: number,
    zoom: number,
    nowMs: number,
    vpW: number,
    vpH: number,
  ): void {
    const blockSizeZoomedPx = BLOCK_SIZE_SMALL * zoom;
    const originXPx = beam.xBlock * blockSizeZoomedPx + offsetXPx;
    const originYPx = beam.yBlock * blockSizeZoomedPx + offsetYPx;

    const halfWidthPx = (beam.widthBlocks * blockSizeZoomedPx) / 2;
    const lengthPx = beam.lengthBlocks * blockSizeZoomedPx;

    const cosA = Math.cos(beam.angleRad);
    const sinA = Math.sin(beam.angleRad);

    // Perpendicular direction (90° CCW from beam direction).
    const perpXPx = -sinA;
    const perpYPx = cosA;

    // Base corners (at origin)
    const bx0 = originXPx + perpXPx * halfWidthPx;
    const by0 = originYPx + perpYPx * halfWidthPx;
    const bx1 = originXPx - perpXPx * halfWidthPx;
    const by1 = originYPx - perpYPx * halfWidthPx;

    // Tip (at length)
    const tx = originXPx + cosA * lengthPx;
    const ty = originYPx + sinA * lengthPx;

    // Viewport cull: compute the AABB of the beam triangle and skip if offscreen.
    const minX = Math.min(bx0, bx1, tx);
    const minY = Math.min(by0, by1, ty);
    const maxX = Math.max(bx0, bx1, tx);
    const maxY = Math.max(by0, by1, ty);
    if (!isScreenRectVisible(minX, minY, maxX - minX, maxY - minY, vpW, vpH)) return;

    // Beam shaft: trapezoid — wide at origin, narrows to a point at tip.
    // Subtle shimmer so the beam appears to breathe.
    const shimmer = 0.85 + 0.15 * Math.sin(nowMs * 0.0009 + beamIndex * 1.3);
    const alpha = (beam.intensityPct / 100) * shimmer * this._densityMultiplier;

    ctx.beginPath();
    ctx.moveTo(bx0, by0);
    ctx.lineTo(bx1, by1);
    ctx.lineTo(tx, ty);
    ctx.closePath();

    // ── Gradient cache (BUILD 272) ──────────────────────────────────────────
    // Reuse the cached gradient unless the beam's pixel-space endpoints have
    // drifted by more than GRADIENT_REUSE_THRESHOLD_PX (0.5 px).  The shimmer
    // animation is factored out into ctx.globalAlpha so the gradient's colour
    // stops remain constant (base ratios 0.60, 0.25, 0.00) and the cache stays
    // valid across frames while the camera is not moving.
    //
    // Guard: if beamIndex is out of the pre-allocated cache range, skip caching
    // and fall back to a fresh gradient (the fallback is still cheaper than the
    // old path which always created a new gradient, and avoids cache-slot 0
    // being corrupted by an out-of-range beam).
    if (beamIndex >= MAX_SUNBEAMS) {
      // Out-of-range: draw without caching.
      const r0 = beam.colorR;
      const g0 = beam.colorG;
      const b0 = beam.colorB;
      const fallbackGrad = ctx.createLinearGradient(originXPx, originYPx, tx, ty);
      fallbackGrad.addColorStop(0,   `rgba(${r0},${g0},${b0},0.600)`);
      fallbackGrad.addColorStop(0.4, `rgba(${r0},${g0},${b0},0.250)`);
      fallbackGrad.addColorStop(1,   `rgba(${r0},${g0},${b0},0)`);
      const prevAlphaFb = ctx.globalAlpha;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fallbackGrad;
      ctx.fill();
      ctx.globalAlpha = prevAlphaFb;
      return;
    }

    const bi = beamIndex;
    const dx0 = Math.abs(originXPx - this._cacheOriginX[bi]);
    const dy0 = Math.abs(originYPx - this._cacheOriginY[bi]);
    const dx1 = Math.abs(tx - this._cacheTipX[bi]);
    const dy1 = Math.abs(ty - this._cacheTipY[bi]);
    const needsRebuild =
      this._cachedGrads[bi] === null ||
      dx0 > GRADIENT_REUSE_THRESHOLD_PX ||
      dy0 > GRADIENT_REUSE_THRESHOLD_PX ||
      dx1 > GRADIENT_REUSE_THRESHOLD_PX ||
      dy1 > GRADIENT_REUSE_THRESHOLD_PX;

    if (needsRebuild) {
      const r = beam.colorR;
      const g = beam.colorG;
      const b = beam.colorB;
      const newGrad = ctx.createLinearGradient(originXPx, originYPx, tx, ty);
      // Colour stops use base ratios (0.60, 0.25); shimmer is applied via globalAlpha.
      newGrad.addColorStop(0,   `rgba(${r},${g},${b},0.600)`);
      newGrad.addColorStop(0.4, `rgba(${r},${g},${b},0.250)`);
      newGrad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      this._cachedGrads[bi]    = newGrad;
      this._cacheOriginX[bi] = originXPx;
      this._cacheOriginY[bi] = originYPx;
      this._cacheTipX[bi]    = tx;
      this._cacheTipY[bi]    = ty;
    }

    // Apply shimmer intensity via globalAlpha (multiplied with gradient alpha).
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this._cachedGrads[bi] as CanvasGradient;
    ctx.fill();
    ctx.globalAlpha = prevAlpha;
  }
}

