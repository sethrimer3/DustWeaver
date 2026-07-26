/**
 * Rendering and coordinate-conversion helpers for the game screen.
 *
 * Extracted from gameRoom.ts to separate data-loading responsibilities
 * (room walls, hazards, ropes) from rendering utilities and coordinate math.
 *
 * Callers that previously imported these from './gameRoom' continue to work
 * because gameRoom.ts re-exports them from this module.
 */

import { RoomDef, BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { EditorRenderMask } from '../editor/editorRenderMask';
import { isLayerVisibleInMask } from '../editor/editorRenderMask';

/** Background fill colour for each world number. */
export function worldBgColor(worldNumber: number): string {
  switch (worldNumber) {
    case 0:  return '#0d1a0f'; // pale dark green
    case 1:  return '#051408'; // deep dark green
    case 2:  return '#080c1a'; // dark blue
    case 3:  return '#1a0500'; // deep dark red-orange (fire/lava world)
    default: return '#0a0a12';
  }
}


/**
 * Normalizes a persisted/authored transition gradient opacity to a finite
 * value in 0..1, falling back to fully opaque (1) for legacy rooms with no
 * opacity field or malformed input.
 */
export function clampGradientOpacity(value: number | undefined): number {
  if (typeof value !== 'number' || !isFinite(value)) return 1;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Draws a gradient darkness overlay at room transition zone trigger edges.
 * The gradient fades from transparent to the transition's fadeColor at the trigger edge.
 * Uses xBlock/yBlock for zone placement; falls back to positionBlock/depthBlock for
 * old runtime data that hasn't been migrated yet.
 */
export function drawTunnelDarkness(
  ctx: CanvasRenderingContext2D,
  // Narrowed to the fields actually read, so the editor backdrop can pass its
  // lightweight room view (see editor/editorBackdropRoom.ts). A full RoomDef
  // structurally satisfies this.
  room: Pick<RoomDef, 'widthBlocks' | 'transitions'>,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  mask?: EditorRenderMask | null,
): void {
  if (!isLayerVisibleInMask(mask, 'lighting')) return;

  const roomWidthWorld  = room.widthBlocks  * BLOCK_SIZE_MEDIUM;
  const DEFAULT_FADE_BLOCKS = 3;

  ctx.save();

  for (let ti = 0; ti < room.transitions.length; ti++) {
    const t = room.transitions[ti];

    // Use per-transition gradient width when set; default to 3 blocks.
    // A value of 0 means no gradient should be drawn for this transition.
    const fadeBlocks = t.gradientWidthBlocks ?? DEFAULT_FADE_BLOCKS;
    if (fadeBlocks <= 0) continue;
    const fadeDepthWorld = fadeBlocks * BLOCK_SIZE_MEDIUM;

    // Migrate legacy positionBlock/depthBlock to xBlock/yBlock if needed.
    const isHoriz = t.direction === 'left' || t.direction === 'right';
    const xB = t.xBlock !== undefined ? t.xBlock
      : (isHoriz ? (t.depthBlock ?? 0) : t.positionBlock);
    const yB = t.yBlock !== undefined ? t.yBlock
      : (isHoriz ? t.positionBlock : (t.depthBlock ?? 0));

    // Opening bounds (the width-axis of the zone)
    const openTopWorld    = yB * BLOCK_SIZE_MEDIUM;
    const openBottomWorld = (yB + (isHoriz ? t.openingSizeBlocks : fadeBlocks)) * BLOCK_SIZE_MEDIUM;
    const openLeftWorld   = xB * BLOCK_SIZE_MEDIUM;
    const openRightWorld  = (xB + (!isHoriz ? t.openingSizeBlocks : fadeBlocks)) * BLOCK_SIZE_MEDIUM;

    // Determine fade colors based on transition fadeColor and gradientOpacity.
    // Legacy rooms with no opacity field render at full opacity (1) as before.
    let fadeOpaqueColor: string;
    let fadeTransparentColor: string;
    const fc = t.fadeColor;
    const opacity = clampGradientOpacity(t.gradientOpacity);
    if (fc && fc.length === 7 && fc[0] === '#') {
      // Parse hex color to rgba (validated 7-char hex format)
      const r = parseInt(fc.slice(1, 3), 16);
      const g = parseInt(fc.slice(3, 5), 16);
      const b = parseInt(fc.slice(5, 7), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        fadeOpaqueColor = `rgba(${r},${g},${b},${opacity})`;
        fadeTransparentColor = `rgba(${r},${g},${b},0)`;
      } else {
        fadeOpaqueColor = `rgba(0,0,0,${opacity})`;
        fadeTransparentColor = 'rgba(0,0,0,0)';
      }
    } else {
      fadeOpaqueColor = `rgba(0,0,0,${opacity})`;
      fadeTransparentColor = 'rgba(0,0,0,0)';
    }

    const y0Screen = openTopWorld    * zoom + offsetYPx;
    const y1Screen = openBottomWorld * zoom + offsetYPx;
    const x0Screen = openLeftWorld   * zoom + offsetXPx;
    const x1Screen = openRightWorld  * zoom + offsetXPx;

    if (t.direction === 'left') {
      const zoneLeft   = xB * BLOCK_SIZE_MEDIUM;
      const zoneRight  = zoneLeft + fadeDepthWorld;
      const zlScreen   = zoneLeft  * zoom + offsetXPx;
      const zrScreen   = zoneRight * zoom + offsetXPx;
      const grad = ctx.createLinearGradient(zlScreen, 0, zrScreen, 0);
      grad.addColorStop(0, fadeOpaqueColor);
      grad.addColorStop(1, fadeTransparentColor);
      ctx.fillStyle = grad;
      ctx.fillRect(zlScreen, y0Screen, zrScreen - zlScreen, y1Screen - y0Screen);

    } else if (t.direction === 'right') {
      const zoneLeft   = xB * BLOCK_SIZE_MEDIUM;
      const zoneRight  = zoneLeft + fadeDepthWorld;
      const zlScreen   = zoneLeft  * zoom + offsetXPx;
      const zrScreen   = zoneRight * zoom + offsetXPx;
      const grad = ctx.createLinearGradient(zlScreen, 0, zrScreen, 0);
      grad.addColorStop(0, fadeTransparentColor);
      grad.addColorStop(1, fadeOpaqueColor);
      ctx.fillStyle = grad;
      // Extend fill rightward to the room boundary for edge-touching zones
      const fillRight = (zoneRight >= roomWidthWorld) ? roomWidthWorld * zoom + offsetXPx : zrScreen;
      ctx.fillRect(zlScreen, y0Screen, fillRight - zlScreen, y1Screen - y0Screen);

    } else if (t.direction === 'up') {
      const zoneTop    = yB * BLOCK_SIZE_MEDIUM;
      const zoneBottom = zoneTop + fadeDepthWorld;
      const ztScreen   = zoneTop    * zoom + offsetYPx;
      const zbScreen   = zoneBottom * zoom + offsetYPx;
      const grad = ctx.createLinearGradient(0, ztScreen, 0, zbScreen);
      grad.addColorStop(0, fadeOpaqueColor);
      grad.addColorStop(1, fadeTransparentColor);
      ctx.fillStyle = grad;
      ctx.fillRect(x0Screen, ztScreen, x1Screen - x0Screen, zbScreen - ztScreen);

    } else if (t.direction === 'down') {
      const zoneTop    = yB * BLOCK_SIZE_MEDIUM;
      const zoneBottom = zoneTop + fadeDepthWorld;
      const ztScreen   = zoneTop    * zoom + offsetYPx;
      const zbScreen   = zoneBottom * zoom + offsetYPx;
      const grad = ctx.createLinearGradient(0, ztScreen, 0, zbScreen);
      grad.addColorStop(0, fadeTransparentColor);
      grad.addColorStop(1, fadeOpaqueColor);
      ctx.fillStyle = grad;
      ctx.fillRect(x0Screen, ztScreen, x1Screen - x0Screen, zbScreen - ztScreen);
    }
  }

  ctx.restore();
}

/**
 * Converts a device-space aim position (mouse/touch in device pixels)
 * back to world coordinates given the current camera transform.
 * First maps device coords to virtual canvas space, then applies camera inverse.
 */
export function screenToWorld(
  deviceXPx: number,
  deviceYPx: number,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  deviceWidthPx: number,
  deviceHeightPx: number,
  virtualWidthPx: number,
  virtualHeightPx: number,
): { xWorld: number; yWorld: number } {
  // Map device pixels to virtual canvas pixels
  const virtualXPx = (deviceXPx / deviceWidthPx)  * virtualWidthPx;
  const virtualYPx = (deviceYPx / deviceHeightPx) * virtualHeightPx;
  return {
    xWorld: (virtualXPx - offsetXPx) / zoom,
    yWorld: (virtualYPx - offsetYPx) / zoom,
  };
}
