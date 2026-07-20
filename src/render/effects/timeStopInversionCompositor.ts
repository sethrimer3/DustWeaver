/**
 * timeStopInversionCompositor.ts — TimeStop Field screen-space inversion.
 *
 * Pipeline (per the design spec):
 *   1. The normal world scene is already rendered onto `ctx` by the time
 *      this pass runs (called last, right before HUD/UI, inside the same
 *      room-clip block as the other post-processing passes).
 *   2. Copy that rendered scene into an offscreen canvas, then draw it back
 *      through `ctx.filter = 'invert(1)'` to get a fully inverted copy —
 *      no manual per-pixel loop, no getImageData/putImageData readback.
 *   3. Punch a hole in the inverted copy where the player's ACTIVE connected
 *      TimeStop Field region is (destination-out with the same Path2D used
 *      to draw the field visual, so mask and visual never drift apart).
 *   4. Composite the punched inverted copy back over the normal scene with
 *      alpha = the smoothly-animated `world.timeStopField.visualIntensity`.
 *
 * Because this only touches the already-rendered world-space canvas region
 * (not the whole device canvas), it automatically respects camera position/
 * zoom/shake, low internal resolution, and pixel-perfect scaling — it runs
 * BEFORE the device-canvas upscale, and never touches UI/HUD/editor layers
 * (called strictly inside the room-clip block, before HUD draws).
 */

import type { WorldState } from '../../sim/world';
import { getActiveRegionScreenPath } from '../timeStopFieldRenderer';
import type { RenderQualityConfig } from '../renderQualityConfig';

let _sceneCopyCanvas: HTMLCanvasElement | null = null;
let _sceneCopyCtx: CanvasRenderingContext2D | null = null;
let _invertedCanvas: HTMLCanvasElement | null = null;
let _invertedCtx: CanvasRenderingContext2D | null = null;

function ensureOffscreenCanvases(widthPx: number, heightPx: number): boolean {
  if (
    _sceneCopyCanvas !== null &&
    _sceneCopyCanvas.width === widthPx &&
    _sceneCopyCanvas.height === heightPx
  ) {
    return true;
  }
  try {
    _sceneCopyCanvas = document.createElement('canvas');
    _sceneCopyCanvas.width = widthPx;
    _sceneCopyCanvas.height = heightPx;
    _sceneCopyCtx = _sceneCopyCanvas.getContext('2d');

    _invertedCanvas = document.createElement('canvas');
    _invertedCanvas.width = widthPx;
    _invertedCanvas.height = heightPx;
    _invertedCtx = _invertedCanvas.getContext('2d');
  } catch {
    _sceneCopyCanvas = null;
    _invertedCanvas = null;
    return false;
  }
  return _sceneCopyCtx !== null && _invertedCtx !== null;
}

/**
 * Applies the outside-field inversion overlay. No-op when the effect isn't
 * active (visualIntensity <= 0) or disabled by the current graphics quality.
 */
export function applyTimeStopInversionCompositor(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  ox: number,
  oy: number,
  zoom: number,
  virtualWidthPx: number,
  virtualHeightPx: number,
  qc: Pick<RenderQualityConfig, 'isTimeStopInversionEnabled'>,
): void {
  if (!qc.isTimeStopInversionEnabled) return;
  const intensity = world.timeStopField.visualIntensity;
  if (intensity <= 0) return;
  if (!ensureOffscreenCanvases(virtualWidthPx, virtualHeightPx)) return;
  const sceneCtx = _sceneCopyCtx!;
  const invCtx = _invertedCtx!;

  sceneCtx.clearRect(0, 0, virtualWidthPx, virtualHeightPx);
  sceneCtx.drawImage(ctx.canvas, 0, 0, virtualWidthPx, virtualHeightPx, 0, 0, virtualWidthPx, virtualHeightPx);

  invCtx.clearRect(0, 0, virtualWidthPx, virtualHeightPx);
  invCtx.save();
  invCtx.filter = 'invert(1)';
  invCtx.drawImage(_sceneCopyCanvas!, 0, 0);
  invCtx.restore();

  const holePath = getActiveRegionScreenPath(world, ox, oy, zoom);
  if (holePath !== null) {
    invCtx.save();
    invCtx.globalCompositeOperation = 'destination-out';
    invCtx.fillStyle = '#000';
    invCtx.fill(holePath);
    invCtx.restore();
  }

  ctx.save();
  ctx.globalAlpha = intensity;
  ctx.drawImage(_invertedCanvas!, 0, 0);
  ctx.restore();
}
