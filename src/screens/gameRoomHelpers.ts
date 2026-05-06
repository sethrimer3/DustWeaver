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
 * Draws a gradient darkness overlay at room transition tunnel edges.
 * The gradient goes from transparent to 100% black at the very edge.
 */
export function drawTunnelDarkness(
  ctx: CanvasRenderingContext2D,
  room: RoomDef,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const roomWidthWorld  = room.widthBlocks  * BLOCK_SIZE_MEDIUM;
  const roomHeightWorld = room.heightBlocks * BLOCK_SIZE_MEDIUM;
  const DEFAULT_FADE_BLOCKS = 6;

  ctx.save();

  for (let ti = 0; ti < room.transitions.length; ti++) {
    const t = room.transitions[ti];

    // Use per-transition gradient width when set; default to 6 blocks.
    // A value of 0 means no gradient should be drawn for this transition.
    const fadeBlocks = t.gradientWidthBlocks ?? DEFAULT_FADE_BLOCKS;
    if (fadeBlocks <= 0) continue;
    const fadeDepthWorld = fadeBlocks * BLOCK_SIZE_MEDIUM;

    const openTopWorld    = t.positionBlock * BLOCK_SIZE_MEDIUM;
    const openBottomWorld = (t.positionBlock + t.openingSizeBlocks) * BLOCK_SIZE_MEDIUM;

    // Determine fade colors based on transition fadeColor
    let fadeOpaqueColor: string;
    let fadeTransparentColor: string;
    const fc = t.fadeColor;
    if (fc && fc.length === 7 && fc[0] === '#' && fc !== '#000000') {
      // Parse hex color to rgba (validated 7-char hex format)
      const r = parseInt(fc.slice(1, 3), 16);
      const g = parseInt(fc.slice(3, 5), 16);
      const b = parseInt(fc.slice(5, 7), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        fadeOpaqueColor = `rgba(${r},${g},${b},1)`;
        fadeTransparentColor = `rgba(${r},${g},${b},0)`;
      } else {
        fadeOpaqueColor = 'rgba(0,0,0,1)';
        fadeTransparentColor = 'rgba(0,0,0,0)';
      }
    } else {
      fadeOpaqueColor = 'rgba(0,0,0,1)';
      fadeTransparentColor = 'rgba(0,0,0,0)';
    }

    const y0Screen = openTopWorld    * zoom + offsetYPx;
    const y1Screen = openBottomWorld * zoom + offsetYPx;
    const x1Screen = roomWidthWorld  * zoom + offsetXPx;

    if (t.direction === 'left') {
      // Zone starts at depthBlock (or room left edge) and extends inward 6 blocks
      const zoneLeft  = (t.depthBlock !== undefined ? t.depthBlock * BLOCK_SIZE_MEDIUM : 0);
      const zoneRight = zoneLeft + fadeDepthWorld;
      const zlScreen  = zoneLeft  * zoom + offsetXPx;
      const zrScreen  = zoneRight * zoom + offsetXPx;

      const grad = ctx.createLinearGradient(zlScreen, 0, zrScreen, 0);
      grad.addColorStop(0, fadeOpaqueColor);
      grad.addColorStop(1, fadeTransparentColor);
      ctx.fillStyle = grad;
      // For edge transitions extend fill leftward past the room boundary to cover the tunnel corridor.
      const fillLeft = t.depthBlock !== undefined ? zlScreen : 0;
      ctx.fillRect(fillLeft, y0Screen, zrScreen - fillLeft, y1Screen - y0Screen);

    } else if (t.direction === 'right') {
      // Zone starts 6 blocks from right (or at depthBlock) and exits right
      const zoneLeft  = t.depthBlock !== undefined
        ? t.depthBlock * BLOCK_SIZE_MEDIUM
        : roomWidthWorld - fadeDepthWorld;
      const zoneRight = zoneLeft + fadeDepthWorld;
      const zlScreen  = zoneLeft  * zoom + offsetXPx;
      const zrScreen  = zoneRight * zoom + offsetXPx;

      const grad = ctx.createLinearGradient(zlScreen, 0, zrScreen, 0);
      grad.addColorStop(0, fadeTransparentColor);
      grad.addColorStop(1, fadeOpaqueColor);
      ctx.fillStyle = grad;
      // For edge transitions extend fill rightward past the room boundary to cover the tunnel corridor.
      const fillRight = t.depthBlock !== undefined ? zrScreen : x1Screen;
      ctx.fillRect(zlScreen, y0Screen, fillRight - zlScreen, y1Screen - y0Screen);

    } else if (t.direction === 'up') {
      const openLeftWorld  = t.positionBlock * BLOCK_SIZE_MEDIUM;
      const openRightWorld = (t.positionBlock + t.openingSizeBlocks) * BLOCK_SIZE_MEDIUM;
      const x0s = openLeftWorld  * zoom + offsetXPx;
      const x1s = openRightWorld * zoom + offsetXPx;

      const zoneTop    = (t.depthBlock !== undefined ? t.depthBlock * BLOCK_SIZE_MEDIUM : 0);
      const zoneBottom = zoneTop + fadeDepthWorld;
      const ztScreen   = zoneTop    * zoom + offsetYPx;
      const zbScreen   = zoneBottom * zoom + offsetYPx;

      const grad = ctx.createLinearGradient(0, ztScreen, 0, zbScreen);
      grad.addColorStop(0, fadeOpaqueColor);
      grad.addColorStop(1, fadeTransparentColor);
      ctx.fillStyle = grad;
      // For edge transitions extend fill upward past the room boundary.
      const fillTop = t.depthBlock !== undefined ? ztScreen : 0;
      ctx.fillRect(x0s, fillTop, x1s - x0s, zbScreen - fillTop);

    } else if (t.direction === 'down') {
      const openLeftWorld  = t.positionBlock * BLOCK_SIZE_MEDIUM;
      const openRightWorld = (t.positionBlock + t.openingSizeBlocks) * BLOCK_SIZE_MEDIUM;
      const x0s = openLeftWorld  * zoom + offsetXPx;
      const x1s = openRightWorld * zoom + offsetXPx;

      const zoneTop    = t.depthBlock !== undefined
        ? t.depthBlock * BLOCK_SIZE_MEDIUM
        : roomHeightWorld - fadeDepthWorld;
      const zoneBottom = zoneTop + fadeDepthWorld;
      const ztScreen   = zoneTop    * zoom + offsetYPx;
      const zbScreen   = zoneBottom * zoom + offsetYPx;

      const grad = ctx.createLinearGradient(0, ztScreen, 0, zbScreen);
      grad.addColorStop(0, fadeTransparentColor);
      grad.addColorStop(1, fadeOpaqueColor);
      ctx.fillStyle = grad;
      // For edge transitions extend fill downward past the room boundary.
      const fillBottom = t.depthBlock !== undefined ? zbScreen : roomHeightWorld * zoom + offsetYPx;
      ctx.fillRect(x0s, ztScreen, x1s - x0s, fillBottom - ztScreen);
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
