/**
 * nextRoomEdgeRenderer.ts — Staging renderer for the connected room's 2-block
 * facing edge.
 *
 * This is the **StagingRoomRenderer** equivalent: it is the opt-in renderer
 * path that only activates during a transition preview or crossing.  Normal
 * room navigation (revealProgress < threshold) incurs zero draw calls.
 *
 * When a transition reveal is active (`TransitionPreviewContext.isActive`),
 * this renderer draws the 2-block-thick strip of wall tiles from the connected
 * room at the correct world-space position just beyond the current room's edge.
 *
 * As of BUILD 276 the tile positions are correctly aligned for offset door
 * openings — the `originXWorld`/`originYWorld` in `NextRoomFacingEdge` now
 * accounts for the difference between the two transitions' yBlock/xBlock
 * positions.  The occupancySet also includes seam-face entries from the
 * current room's edge data so auto-tiling at the boundary is more accurate.
 *
 * Combined with the current room's own edge extension tiles, this gives the
 * player 4 columns/rows of tile continuity at a transition:
 *   [2 from current room] | [room boundary] | [2 from next room]
 *
 * Must be called BEFORE the room clip rect is set (before ctx.clip() in
 * gameRender.ts) so the tiles drawn outside the room rectangle are visible.
 *
 * Future: when `TransitionPreviewContext.stagingSnapshot.nextRoomWorldSnapshot`
 * is populated, this renderer can be extended to draw the full connected room
 * (enemies, particles, all walls) in addition to the facing-edge strip.
 */

import type { TransitionPreviewContext } from './transitionPreviewContext';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import { renderSingleExtensionTile } from '../walls/blockSpriteRenderer';
import { getDarknessAlphaFromAirDepth } from '../walls/ambientLightDepths';

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
 * @param viewportWidthPx   Viewport width (virtual pixels).
 * @param viewportHeightPx  Viewport height (virtual pixels).
 * @param lightingEffect Current room lighting effect (e.g. 'Ambient', 'DarkRoom').
 */
export function renderNextRoomFacingEdge(
  ctx: CanvasRenderingContext2D,
  preview: TransitionPreviewContext,
  ox: number,
  oy: number,
  zoom: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
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
    if (screenX + tileSizePx < 0 || screenX > viewportWidthPx) continue;
    if (screenY + tileSizePx < 0 || screenY > viewportHeightPx) continue;

    // Per-tile ambient depth from the connected room's BFS so facing-edge tiles
    // shade consistently with the current-room extension tiles.
    const darknessAlpha = applyAmbientTint ? getDarknessAlphaFromAirDepth(tile.ambientDepth) : 0;

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
