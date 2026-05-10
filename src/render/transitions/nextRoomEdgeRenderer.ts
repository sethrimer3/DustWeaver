/**
 * nextRoomEdgeRenderer.ts — Renders the connected room's 2-block facing edge.
 *
 * When a transition reveal is active (`TransitionPreviewContext.isActive`),
 * this renderer draws the 2-block-thick strip of wall tiles from the connected
 * room at the correct world-space position just beyond the current room's edge.
 *
 * Combined with the current room's own edge extension tiles, this gives the
 * player 4 columns/rows of tile continuity at a transition:
 *   [2 from current room] | [room boundary] | [2 from next room]
 *
 * Must be called BEFORE the room clip rect is set (before ctx.clip() in
 * gameRender.ts) so the tiles drawn outside the room rectangle are visible.
 *
 * Tiles are only rendered when `revealProgress` exceeds a small threshold, so
 * no work is done during ordinary room navigation.
 *
 * Rendering uses the same `renderSingleExtensionTile` sprite renderer as the
 * main edge extension system.  The occupancySet from `NextRoomFacingEdge`
 * provides neighbor masks for auto-tiling (partial — only 3 columns/rows of
 * connected-room data are available, so corner joins at the transition seam
 * may not be pixel-perfect).
 */

import type { TransitionPreviewContext } from './transitionPreviewContext';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import { renderSingleExtensionTile } from '../walls/blockSpriteRenderer';

/** Minimum reveal progress before next-room tiles are drawn (avoids 1-pixel flicker). */
const NEXT_ROOM_RENDER_THRESHOLD = 0.05;

/**
 * Draw the next room's 2-block facing-edge strip.
 *
 * @param ctx            Virtual canvas 2D context.
 * @param preview        Current transition preview context.
 * @param ox             Camera X offset (world → screen).
 * @param oy             Camera Y offset (world → screen).
 * @param zoom           Camera zoom factor.
 * @param vpW            Viewport width (virtual pixels).
 * @param vpH            Viewport height (virtual pixels).
 * @param lightingEffect Current room lighting effect (e.g. 'Ambient', 'DarkRoom').
 */
export function renderNextRoomFacingEdge(
  ctx: CanvasRenderingContext2D,
  preview: TransitionPreviewContext,
  ox: number,
  oy: number,
  zoom: number,
  vpW: number,
  vpH: number,
  lightingEffect: string,
): void {
  if (!preview.isActive) return;
  if (preview.revealProgress < NEXT_ROOM_RENDER_THRESHOLD) return;
  const edge = preview.nextRoomFacingEdge;
  if (edge === null) return;

  const BS = BLOCK_SIZE_SMALL;
  const tileSizePx = BS * zoom;
  // In DarkRoom the overlay already handles darkness; skip ambient tinting.
  const applyAmbientTint = lightingEffect !== 'FullyLit' && lightingEffect !== 'DarkRoom';

  const originXWorld = edge.originXWorld;
  const originYWorld = edge.originYWorld;
  const occupancy = edge.occupancySet;
  const tiles = edge.tiles;

  // Fade in the next-room tiles proportionally to reveal progress so they
  // don't pop on abruptly.  Alpha 0 at threshold, 1 at full reveal.
  const alpha = Math.min(1, (preview.revealProgress - NEXT_ROOM_RENDER_THRESHOLD) /
                           (1 - NEXT_ROOM_RENDER_THRESHOLD));

  const savedAlpha = ctx.globalAlpha;
  ctx.globalAlpha = savedAlpha * alpha;

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    if (!tile.isSolid) continue; // Empty tiles remain black — nothing to draw.

    const worldX = originXWorld + tile.colBlock * BS;
    const worldY = originYWorld + tile.rowBlock * BS;
    const screenX = worldX * zoom + ox;
    const screenY = worldY * zoom + oy;

    // Viewport cull.
    if (screenX + tileSizePx < 0 || screenX > vpW) continue;
    if (screenY + tileSizePx < 0 || screenY > vpH) continue;

    // Use a modest fixed darkness so next-room tiles appear slightly darker
    // than the lit room interior, suggesting depth/distance.  In Ambient mode
    // the ambient tint logic takes precedence when enabled.
    const darknessAlpha = applyAmbientTint ? 0.25 : 0;

    renderSingleExtensionTile(
      ctx,
      tile.colBlock,
      tile.rowBlock,
      tile.theme,
      occupancy,
      originXWorld * zoom + ox,   // origin screen X (tile coords are local to connected room)
      originYWorld * zoom + oy,   // origin screen Y
      zoom,
      BS,
      darknessAlpha,
    );
  }

  ctx.globalAlpha = savedAlpha;
}
