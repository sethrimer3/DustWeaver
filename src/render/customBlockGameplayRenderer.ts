/**
 * customBlockGameplayRenderer.ts — Renders custom block sprites in gameplay.
 *
 * Called after the standard wall renderer so custom sprites paint over the
 * underlying blackRock tile geometry.  Transparency is preserved exactly;
 * no background is drawn beneath transparent pixels.
 *
 * Uses the same cached OffscreenCanvas/HTMLCanvasElement sprites that the
 * editor overlay uses — zero per-frame JSON parsing or pixel reconstruction.
 */

import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import type { RoomDef } from '../levels/roomDef';
import { rawIdFromNamespaced } from '../levels/customBlocks';
import { getOrFallbackSprite, drawCustomBlockSprite } from './customBlockSpriteCache';

/**
 * Draws all custom block sprites for the given room.
 *
 * @param ctx       - The 2D rendering context.
 * @param room      - The current RoomDef (may include customBlockPlacements).
 * @param offsetXPx - Camera X offset in pixels (world-to-screen).
 * @param offsetYPx - Camera Y offset in pixels.
 * @param zoom      - Pixels per world unit.
 */
export function renderCustomBlockSprites(
  ctx: CanvasRenderingContext2D,
  room: RoomDef,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const placements = room.customBlockPlacements;
  if (placements === undefined || placements.length === 0) return;

  const tileSize = BLOCK_SIZE_SMALL * zoom;

  for (const [xBlock, yBlock, namespacedId] of placements) {
    const rawId = rawIdFromNamespaced(namespacedId);
    if (rawId === null) continue;

    // If the block is registered the cached sprite already has the correct
    // tileWidth/tileHeight.  If it is missing, getOrFallbackSprite returns a
    // 1×1 magenta/black checkerboard; passing 1, 1 is the safe default.
    const sprite = getOrFallbackSprite(rawId, 1, 1);
    const destX = Math.round(xBlock * tileSize + offsetXPx);
    const destY = Math.round(yBlock * tileSize + offsetYPx);
    const destW = Math.round(sprite.tileWidth * tileSize);
    const destH = Math.round(sprite.tileHeight * tileSize);
    drawCustomBlockSprite(ctx, sprite, destX, destY, destW, destH);
  }
}
