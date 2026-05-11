/**
 * backgroundBlockRenderer.ts — Renders visual-only background blocks.
 *
 * Background blocks have no collision; they sit behind foreground walls and
 * gameplay elements as decorative texture fills.  Light-blocking variants
 * also participate in the ambient lighting system (handled by gameScreen.ts).
 *
 * Rendering strategy per block cell:
 *   1. If the block's theme (or the room's default theme) is folder-based,
 *      attempt to obtain a shaded 1×1 sprite via getTheme1x1SpriteShaded.
 *   2. If the sprite is ready, draw it at 50 % alpha so background blocks
 *      read as distinct from foreground solid walls.
 *   3. If the sprite is not yet loaded (returns null), fall back to a
 *      semi-transparent solid fill matching the block's theme tint.
 *
 * All rendering targets the 480×270 virtual canvas (world-space coordinates).
 */

import type { RoomDef } from '../../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import {
  isFolderBasedTheme,
  getTheme1x1SpriteShaded,
} from './folderBlockThemes';
import { OPEN_AIR_ALL_SIDES } from './blockEdgeShading';

/** World-space size of a single background block cell (matches 1×1 sprite). */
const CELL_SIZE_WORLD = BLOCK_SIZE_SMALL;

/** Fallback fill color for background blocks when no sprite is available. */
const FALLBACK_FILL = 'rgba(80, 80, 80, 0.35)';

/**
 * Renders all background blocks in `room` onto `ctx`.
 *
 * Must be called BEFORE sunbeams and foreground wall passes so background
 * blocks sit behind all gameplay geometry.
 *
 * @param ctx     2D canvas context targeting the virtual (480×270) canvas.
 * @param room    Runtime room definition produced by editorRoomBuilder.
 * @param ox      Camera X offset in virtual pixels.
 * @param oy      Camera Y offset in virtual pixels.
 * @param zoom    Camera zoom (typically 1.0).
 */
export function renderBackgroundBlocks(
  ctx: CanvasRenderingContext2D,
  room: RoomDef,
  ox: number,
  oy: number,
  zoom: number,
): void {
  const blocks = room.backgroundBlocks;
  if (!blocks || blocks.length === 0) return;

  const seed  = room.worldNumber ?? 0;
  const cellW = CELL_SIZE_WORLD * zoom;

  ctx.save();
  ctx.globalAlpha = 0.5;

  for (let bi = 0; bi < blocks.length; bi++) {
    const b      = blocks[bi];
    const themeId = b.blockTheme ?? room.blockTheme ?? null;
    const useFolderSprite = isFolderBasedTheme(themeId);

    for (let dy = 0; dy < b.hBlock; dy++) {
      for (let dx = 0; dx < b.wBlock; dx++) {
        const col = b.xBlock + dx;
        const row = b.yBlock + dy;
        const sx  = Math.round(col * cellW + ox);
        const sy  = Math.round(row * cellW + oy);
        const sw  = Math.ceil(cellW);

        if (useFolderSprite) {
          const sprite = getTheme1x1SpriteShaded(
            themeId,
            col,
            row,
            seed,
            OPEN_AIR_ALL_SIDES,
            CELL_SIZE_WORLD,
          );
          if (sprite !== null) {
            ctx.drawImage(sprite, sx, sy, sw, sw);
          } else {
            ctx.fillStyle = FALLBACK_FILL;
            ctx.fillRect(sx, sy, sw, sw);
          }
        } else {
          ctx.fillStyle = FALLBACK_FILL;
          ctx.fillRect(sx, sy, sw, sw);
        }
      }
    }
  }

  ctx.restore();
}
