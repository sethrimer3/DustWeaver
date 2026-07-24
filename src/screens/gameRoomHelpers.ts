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
 * Draws a gradient darkness overlay at room transition zone trigger edges.
 * The gradient fades from transparent to the transition's fadeColor at the trigger edge.
 * Uses xBlock/yBlock for zone placement; falls back to positionBlock/depthBlock for
 * old runtime data that hasn't been migrated yet.
 */
export function drawTunnelDarkness(
  ctx: CanvasRenderingContext2D,
  room: RoomDef,
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
 * Draws the authored room-transition gradient into the passage area beyond the
 * room boundary (the edge-extension zone).
 *
 * Must be called BEFORE the room clip rect is applied so the gradient renders
 * outside the room rectangle.  For each transition with `gradientWidthBlocks > 0`
 * the gradient extends from the room boundary outward through the passage opening,
 * replacing the pure-black void that would otherwise appear there.
 *
 * The gradient runs from transparent at the room edge to opaque (the transition's
 * fadeColor or black) at the outer limit.  This mirrors the inward tunnel-darkness
 * gradient that `drawTunnelDarkness` paints inside the room.
 *
 * If `gradientWidthBlocks` is 0 or omitted (defaulting to the legacy value), no
 * outward gradient is drawn and the passage remains black.
 */
export function renderTransitionPassageGradients(
  ctx: CanvasRenderingContext2D,
  room: RoomDef,
  ox: number,
  oy: number,
  zoom: number,
): void {
  const BS = BLOCK_SIZE_MEDIUM; // currently aliased to BLOCK_SIZE_SMALL in roomDef.ts
  const roomWidthWorld  = room.widthBlocks  * BS;
  const roomHeightWorld = room.heightBlocks * BS;

  ctx.save();

  for (let ti = 0; ti < room.transitions.length; ti++) {
    const t = room.transitions[ti];

    // Legacy rooms may omit gradientWidthBlocks (undefined → rendered as 3 inside
    // the room by drawTunnelDarkness).  For the outward passage gradient, treat
    // undefined the same as the legacy default so the passage visually matches.
    const DEFAULT_FADE_BLOCKS = 3;
    const gradientWidthBlocks = t.gradientWidthBlocks ?? DEFAULT_FADE_BLOCKS;
    if (gradientWidthBlocks <= 0) continue;
    const gradientDepthWorld = gradientWidthBlocks * BS;

    const isHoriz = t.direction === 'left' || t.direction === 'right';

    // Opening span (perpendicular axis, in world units)
    const openStartPerp = (isHoriz ? t.yBlock : t.xBlock) * BS;
    const openEndPerp   = openStartPerp + t.openingSizeBlocks * BS;

    // Resolve gradient colour from the transition's fadeColor.
    let opaqueColor: string;
    let transparentColor: string;
    const fc = t.fadeColor;
    if (fc && fc.length === 7 && fc[0] === '#' && fc !== '#000000') {
      const r = parseInt(fc.slice(1, 3), 16);
      const g = parseInt(fc.slice(3, 5), 16);
      const b = parseInt(fc.slice(5, 7), 16);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        opaqueColor     = `rgba(${r},${g},${b},1)`;
        transparentColor = `rgba(${r},${g},${b},0)`;
      } else {
        opaqueColor = 'rgba(0,0,0,1)'; transparentColor = 'rgba(0,0,0,0)';
      }
    } else {
      opaqueColor = 'rgba(0,0,0,1)'; transparentColor = 'rgba(0,0,0,0)';
    }

    if (t.direction === 'left') {
      // Passage extends leftward from x=0 into negative world-x.
      const x0Px = 0 * zoom + ox;                       // room left boundary (transparent end)
      const x1Px = -gradientDepthWorld * zoom + ox;     // outer passage limit (opaque end)
      const y0Px = openStartPerp * zoom + oy;
      const y1Px = openEndPerp   * zoom + oy;
      const grad = ctx.createLinearGradient(x0Px, 0, x1Px, 0);
      grad.addColorStop(0, transparentColor);
      grad.addColorStop(1, opaqueColor);
      ctx.fillStyle = grad;
      ctx.fillRect(x1Px, y0Px, x0Px - x1Px, y1Px - y0Px);

    } else if (t.direction === 'right') {
      // Passage extends rightward from x=roomWidth into positive world-x.
      const x0Px = roomWidthWorld * zoom + ox;                              // room right boundary (transparent)
      const x1Px = (roomWidthWorld + gradientDepthWorld) * zoom + ox;      // outer limit (opaque)
      const y0Px = openStartPerp * zoom + oy;
      const y1Px = openEndPerp   * zoom + oy;
      const grad = ctx.createLinearGradient(x0Px, 0, x1Px, 0);
      grad.addColorStop(0, transparentColor);
      grad.addColorStop(1, opaqueColor);
      ctx.fillStyle = grad;
      ctx.fillRect(x0Px, y0Px, x1Px - x0Px, y1Px - y0Px);

    } else if (t.direction === 'up') {
      // Passage extends upward from y=0 into negative world-y.
      const y0Px = 0 * zoom + oy;
      const y1Px = -gradientDepthWorld * zoom + oy;
      const x0Px = openStartPerp * zoom + ox;
      const x1Px = openEndPerp   * zoom + ox;
      const grad = ctx.createLinearGradient(0, y0Px, 0, y1Px);
      grad.addColorStop(0, transparentColor);
      grad.addColorStop(1, opaqueColor);
      ctx.fillStyle = grad;
      ctx.fillRect(x0Px, y1Px, x1Px - x0Px, y0Px - y1Px);

    } else if (t.direction === 'down') {
      // Passage extends downward from y=roomHeight into positive world-y.
      const y0Px = roomHeightWorld * zoom + oy;
      const y1Px = (roomHeightWorld + gradientDepthWorld) * zoom + oy;
      const x0Px = openStartPerp * zoom + ox;
      const x1Px = openEndPerp   * zoom + ox;
      const grad = ctx.createLinearGradient(0, y0Px, 0, y1Px);
      grad.addColorStop(0, transparentColor);
      grad.addColorStop(1, opaqueColor);
      ctx.fillStyle = grad;
      ctx.fillRect(x0Px, y0Px, x1Px - x0Px, y1Px - y0Px);
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
