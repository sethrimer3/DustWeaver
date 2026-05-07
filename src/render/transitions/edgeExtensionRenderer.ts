/**
 * edgeExtensionRenderer.ts — Renders visual tiles beyond the room boundary.
 *
 * Must be called BEFORE the room clip rect is set (before ctx.clip() in
 * gameRender.ts) so tiles drawn outside the room rectangle are visible.
 *
 * Solid extension tiles are drawn using the same auto-tiling sprites as the
 * main wall renderer via {@link renderSingleExtensionTile} from
 * blockSpriteRenderer.ts.  Ambient depth tinting is applied progressively
 * based on the tile's distance from the room edge, matching the lighting depth
 * model used inside the room.
 *
 * Empty extension tiles are left black (the virtual canvas is pre-filled
 * with black at the start of every frame).  In FullyLit rooms the bg colour
 * is used instead.
 */

import type { EdgeExtensionCache } from './edgeExtensionCache';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import { renderSingleExtensionTile } from '../walls/blockSpriteRenderer';
import { getDarknessAlphaFromAirDepth } from '../walls/ambientLightDepths';

// ── Extension-step → ambient depth mapping ───────────────────────────────────

/**
 * Maps an extension step (1 = adjacent to room edge) to the equivalent
 * ambient-light air depth used by `getDarknessAlphaFromAirDepth`.
 *
 * Extension tiles are outside the room and have no air exposure from the
 * room interior, so their depth is treated as if they were deep underground.
 * Step 1 tiles start at depth 2 (30 % darkness) and each further step adds
 * one more depth unit so the wall progressively darkens away from the room.
 * This matches the exponential formula in ambientLightDepths.ts.
 */
function _extensionDepth(step: number): number {
  // depth 2 at step 1 → 30 % darkness; depth 3 at step 2 → 70 %; depth 4+ → 100 %
  return step + 1;
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
  const tileSizePx = BLOCK_SIZE_SMALL * zoom;
  const isFullyLit = lightingEffect === 'FullyLit';
  // DarkRoom extension tiles should not have the ambient tint applied because
  // the DarkRoom overlay already darkens everything uniformly; adding a tint
  // on top would make extension tiles pitch-black and lose the sprite detail.
  const applyAmbientTint = lightingEffect !== 'FullyLit' && lightingEffect !== 'DarkRoom';
  const tiles = cache.tiles;
  const occupancy = cache.occupancySet;

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];

    const screenX = tile.colBlock * tileSizePx + ox;
    const screenY = tile.rowBlock * tileSizePx + oy;

    // Viewport cull — skip tiles entirely outside the virtual canvas
    if (screenX + tileSizePx < 0 || screenX > vpW) continue;
    if (screenY + tileSizePx < 0 || screenY > vpH) continue;

    if (tile.isSolid) {
      // Compute ambient darkness alpha for this extension step.
      const darknessAlpha = applyAmbientTint
        ? getDarknessAlphaFromAirDepth(_extensionDepth(tile.extensionStep))
        : 0;

      renderSingleExtensionTile(
        ctx,
        tile.colBlock,
        tile.rowBlock,
        tile.theme,
        occupancy,
        ox,
        oy,
        zoom,
        BLOCK_SIZE_SMALL,
        darknessAlpha,
      );
    } else {
      // Empty extension slot.
      // FullyLit: show the room background colour so there's no hard cutoff.
      // Other modes: black is already drawn by the canvas pre-fill — skip.
      if (!isFullyLit) continue;
      ctx.fillStyle = bgColor;
      ctx.fillRect(
        Math.round(screenX),
        Math.round(screenY),
        Math.ceil(tileSizePx),
        Math.ceil(tileSizePx),
      );
    }
  }
}
