/**
 * edgeExtensionRenderer.ts — Renders visual tiles beyond the room boundary.
 *
 * Must be called BEFORE the room clip rect is set (before ctx.clip() in
 * gameRender.ts) so tiles drawn outside the room rectangle are visible.
 *
 * Solid extension tiles are drawn as filled rectangles using fallback colours
 * that approximate each block theme.  Full sprite-based tile continuation
 * (matching the auto-tiling sprites used inside the room) is deferred to a
 * future pass — see nextSteps.md for implementation guidance.
 *
 * Empty extension tiles are left black (the virtual canvas is pre-filled
 * with black at the start of every frame).  In FullyLit rooms the bg colour
 * will be extended instead — see the `lightingEffect` parameter.
 */

import type { EdgeExtensionCache } from './edgeExtensionCache';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';

// ── Theme fallback colours ────────────────────────────────────────────────────

/**
 * Approximate fill colour for a solid edge extension tile.
 *
 * These values are darker than the actual sprite pixels so tiles beyond the
 * room boundary feel like they're in shadow — consistent with the ambient
 * lighting model that darkens tiles farther from open air.
 *
 * Full sprite rendering is tracked in nextSteps.md.
 */
function _themeSolidColor(theme: string | null): string {
  if (theme !== null) {
    switch (theme) {
      case 'blackRock': return '#0c0c0c';
      case 'brownRock': return '#120903';
      case 'dirt':      return '#161007';
      default:          return '#0f0f0f';   // unknown folder-based theme
    }
  }
  // World-number sprites use '#111' as a reasonable neutral dark
  return '#111111';
}

// ── Public render function ────────────────────────────────────────────────────

/**
 * Draw the edge extension tiles for `cache`.
 *
 * @param ctx            Virtual canvas 2D context.
 * @param cache          Edge extension cache built at room-load time.
 * @param ox             Camera X offset (world-to-screen).
 * @param oy             Camera Y offset (world-to-screen).
 * @param zoom           Camera zoom factor.
 * @param vpW            Viewport width (virtual pixels).
 * @param vpH            Viewport height (virtual pixels).
 * @param bgColor        Room background fill colour (used for FullyLit empty tiles).
 * @param lightingEffect Current room lighting effect.
 */
export function renderEdgeExtension(
  ctx: CanvasRenderingContext2D,
  cache: EdgeExtensionCache,
  ox: number,
  oy: number,
  zoom: number,
  vpW: number,
  vpH: number,
  bgColor: string,
  lightingEffect: string,
): void {
  const tilePx = BLOCK_SIZE_SMALL * zoom;
  const isFullyLit = lightingEffect === 'FullyLit';
  const tiles = cache.tiles;

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];

    const screenX = tile.colBlock * tilePx + ox;
    const screenY = tile.rowBlock * tilePx + oy;

    // Viewport cull — skip tiles entirely outside the virtual canvas
    if (screenX + tilePx < 0 || screenX > vpW) continue;
    if (screenY + tilePx < 0 || screenY > vpH) continue;

    if (tile.isSolid) {
      ctx.fillStyle = _themeSolidColor(tile.theme);
    } else {
      // Empty extension slot.
      // FullyLit: show the room background colour so there's no hard cutoff.
      // Other modes: black is already drawn by the canvas pre-fill — skip.
      if (!isFullyLit) continue;
      ctx.fillStyle = bgColor;
    }

    ctx.fillRect(
      Math.round(screenX),
      Math.round(screenY),
      Math.ceil(tilePx),
      Math.ceil(tilePx),
    );
  }
}
