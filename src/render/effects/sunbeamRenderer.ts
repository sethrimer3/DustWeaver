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
 */

import type { RoomDef, RoomSunbeamDef } from '../../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import { isScreenRectVisible } from '../viewportCull';

export class SunbeamRenderer {
  private beams: readonly RoomSunbeamDef[] = [];
  /** Whether sunbeams are enabled (wired to the quality config). */
  private _isEnabled = true;

  initFromRoom(room: RoomDef): void {
    this.beams = room.sunbeams ?? [];
  }

  /** Toggle sunbeam rendering on/off based on graphics quality tier. */
  setEnabled(enabled: boolean): void {
    this._isEnabled = enabled;
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
    const alpha = (beam.intensityPct / 100) * shimmer;

    ctx.beginPath();
    ctx.moveTo(bx0, by0);
    ctx.lineTo(bx1, by1);
    ctx.lineTo(tx, ty);
    ctx.closePath();

    // Gradient from opaque at base to transparent at tip.
    const grad = ctx.createLinearGradient(originXPx, originYPx, tx, ty);
    const r = beam.colorR;
    const g = beam.colorG;
    const b = beam.colorB;
    grad.addColorStop(0,   `rgba(${r},${g},${b},${(alpha * 0.6).toFixed(3)})`);
    grad.addColorStop(0.4, `rgba(${r},${g},${b},${(alpha * 0.25).toFixed(3)})`);
    grad.addColorStop(1,   `rgba(${r},${g},${b},0)`);

    ctx.fillStyle = grad;
    ctx.fill();
  }
}

