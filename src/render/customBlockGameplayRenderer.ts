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
 * Minimal shape of the sim WorldState needed to detect a broken fragile
 * custom block. Declared structurally (not imported from '../sim/world') to
 * avoid a render → sim dependency cycle; any object with these fields works.
 */
export interface BreakableWorldLookup {
  breakableBlockCount: number;
  breakableBlockXWorld: ArrayLike<number>;
  breakableBlockYWorld: ArrayLike<number>;
  isBreakableBlockActiveFlag: ArrayLike<number>;
}

/**
 * Returns false if a 1×1 fragile custom block placement has already been
 * broken (its matching breakable-block entry is inactive). Matches purely
 * by world position — the same position gameRoomHazards.ts used to register
 * the breakable entry — so no extra per-placement bookkeeping is needed.
 */
function isFragilePlacementBroken(
  world: BreakableWorldLookup,
  xBlock: number,
  yBlock: number,
  tileSize: number,
): boolean {
  const cx = (xBlock + 0.5) * tileSize;
  const cy = (yBlock + 0.5) * tileSize;
  for (let i = 0; i < world.breakableBlockCount; i++) {
    if (Math.abs(world.breakableBlockXWorld[i] - cx) < 0.5 &&
        Math.abs(world.breakableBlockYWorld[i] - cy) < 0.5) {
      return world.isBreakableBlockActiveFlag[i] === 0;
    }
  }
  return false; // No matching breakable entry — not a broken fragile block.
}

/**
 * Draws all custom block sprites for the given room.
 *
 * @param ctx       - The 2D rendering context.
 * @param room      - The current RoomDef (may include customBlockPlacements).
 * @param offsetXPx - Camera X offset in pixels (world-to-screen).
 * @param offsetYPx - Camera Y offset in pixels.
 * @param zoom      - Pixels per world unit.
 * @param world     - Optional sim world state, used only to hide broken fragile blocks.
 */
export function renderCustomBlockSprites(
  ctx: CanvasRenderingContext2D,
  room: RoomDef,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  world?: BreakableWorldLookup,
): void {
  const placements = room.customBlockPlacements;
  if (placements === undefined || placements.length === 0) return;

  const tileSize = BLOCK_SIZE_SMALL * zoom;
  const worldTileSize = BLOCK_SIZE_SMALL; // breakable-block world coords use unzoomed block size

  for (const [xBlock, yBlock, namespacedId] of placements) {
    const rawId = rawIdFromNamespaced(namespacedId);
    if (rawId === null) continue;

    // If the block is registered the cached sprite already has the correct
    // tileWidth/tileHeight.  If it is missing, getOrFallbackSprite returns a
    // 1×1 magenta/black checkerboard; passing 1, 1 is the safe default.
    const sprite = getOrFallbackSprite(rawId, 1, 1);

    if (world !== undefined && sprite.properties.breakability === 'fragile' &&
        isFragilePlacementBroken(world, xBlock, yBlock, worldTileSize)) {
      continue; // Broken fragile block — placement is fully removed, no fragments drawn.
    }

    const destX = Math.round(xBlock * tileSize + offsetXPx);
    const destY = Math.round(yBlock * tileSize + offsetYPx);
    const destW = Math.round(sprite.tileWidth * tileSize);
    const destH = Math.round(sprite.tileHeight * tileSize);
    drawCustomBlockSprite(ctx, sprite, destX, destY, destW, destH);
  }
}
