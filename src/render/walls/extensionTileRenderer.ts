import type { BlockTheme } from '../../levels/roomDef';
import type { BlockSpriteSet } from './blockSpriteSets';
import { isSpriteReady, getSpriteForLegacyTheme, themeToProceduralMaterial } from './blockSpriteSets';
import {
  getBlockSprite1x1,
  OPEN_AIR_SIDE_N,
  OPEN_AIR_SIDE_E,
  OPEN_AIR_SIDE_S,
  OPEN_AIR_SIDE_W,
} from './proceduralBlockSprite';
import { isFolderBasedTheme, getTheme1x1SpriteShaded } from './folderBlockThemes';
import {
  drawFallbackTile,
  TILE_MASK_N,
  TILE_MASK_E,
  TILE_MASK_S,
  TILE_MASK_W,
  TILE_TABLE,
} from './wallTileDrawHelpers';

/**
 * Renders a single extension tile using the same sprite selection logic as
 * the main wall tile renderer, but without requiring a full WallSnapshot or
 * CachedWallLayout.
 */
export function renderSingleExtensionTileWithState(
  ctx: CanvasRenderingContext2D,
  activeBlockTheme: BlockTheme | null,
  activeWorldNumber: number,
  sprites: BlockSpriteSet,
  col: number,
  row: number,
  theme: string | null,
  occupancy: ReadonlySet<string>,
  ox: number,
  oy: number,
  scale: number,
  blockSizePx: number,
  darknessAlpha: number,
): void {
  const tileSizePx = blockSizePx * scale;
  const tileX = Math.round(col * blockSizePx * scale + ox);
  const tileY = Math.round(row * blockSizePx * scale + oy);

  // Resolve effective tile theme: use override, then room default.
  const tileTheme: BlockTheme | null = (theme as BlockTheme | null) ?? activeBlockTheme;

  // Compute 4-neighbour occupancy mask from the supplied set.
  const northSolid = occupancy.has(`${col},${row - 1}`);
  const eastSolid  = occupancy.has(`${col + 1},${row}`);
  const southSolid = occupancy.has(`${col},${row + 1}`);
  const westSolid  = occupancy.has(`${col - 1},${row}`);

  const mask =
    (northSolid ? TILE_MASK_N : 0) |
    (eastSolid  ? TILE_MASK_E : 0) |
    (southSolid ? TILE_MASK_S : 0) |
    (westSolid  ? TILE_MASK_W : 0);
  const spec = TILE_TABLE[mask];

  // Open-air-sides mask for edge-shading (opposite of solid-neighbours).
  const openAirSidesMask =
    (northSolid ? 0 : OPEN_AIR_SIDE_N) |
    (eastSolid  ? 0 : OPEN_AIR_SIDE_E) |
    (southSolid ? 0 : OPEN_AIR_SIDE_S) |
    (westSolid  ? 0 : OPEN_AIR_SIDE_W);

  ctx.save();
  ctx.imageSmoothingEnabled = false;

  const material = themeToProceduralMaterial(tileTheme, activeWorldNumber);

  if (material !== null) {
    // Procedural path (e.g. blackRock): base sprite cut with 1×1 block template.
    const procSprite = getBlockSprite1x1(col, row, material, blockSizePx, activeWorldNumber, openAirSidesMask);
    if (procSprite !== null) {
      ctx.drawImage(procSprite, tileX, tileY, tileSizePx, tileSizePx);
    } else {
      drawFallbackTile(ctx, tileX, tileY, tileSizePx);
    }
  } else if (isFolderBasedTheme(tileTheme)) {
    // Folder-based theme: use edge-shaded 8×8 canvas for 1×1 tiles.
    const folderSprite = getTheme1x1SpriteShaded(tileTheme, col, row, activeWorldNumber, openAirSidesMask, blockSizePx);
    if (folderSprite !== null) {
      ctx.drawImage(folderSprite, tileX, tileY, tileSizePx, tileSizePx);
    } else {
      drawFallbackTile(ctx, tileX, tileY, tileSizePx);
    }
  } else if (tileTheme !== null) {
    // Legacy flat-sprite path (brownRock, dirt).
    const img = getSpriteForLegacyTheme(tileTheme, spec.variant, blockSizePx);
    if (isSpriteReady(img)) {
      if (tileTheme === 'brownRock' || spec.rotationRad === 0) {
        ctx.drawImage(img, tileX, tileY, tileSizePx, tileSizePx);
      } else {
        const halfSz = Math.round(tileSizePx * 0.5);
        const cx = Math.round(tileX + tileSizePx * 0.5);
        const cy = Math.round(tileY + tileSizePx * 0.5);
        ctx.translate(cx, cy);
        ctx.rotate(spec.rotationRad);
        ctx.drawImage(img, -halfSz, -halfSz, tileSizePx, tileSizePx);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    } else {
      drawFallbackTile(ctx, tileX, tileY, tileSizePx);
    }
  } else {
    // World-number legacy path (world 0 = blackRock via legacy set, world 1+ = world sprites).
    const img = sprites[spec.variant];
    if (isSpriteReady(img)) {
      if (spec.rotationRad === 0) {
        ctx.drawImage(img, tileX, tileY, tileSizePx, tileSizePx);
      } else {
        const halfSz = Math.round(tileSizePx * 0.5);
        const cx = Math.round(tileX + tileSizePx * 0.5);
        const cy = Math.round(tileY + tileSizePx * 0.5);
        ctx.translate(cx, cy);
        ctx.rotate(spec.rotationRad);
        ctx.drawImage(img, -halfSz, -halfSz, tileSizePx, tileSizePx);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
    } else {
      drawFallbackTile(ctx, tileX, tileY, tileSizePx);
    }
  }

  // Apply darkness tint overlay.
  if (darknessAlpha > 0) {
    ctx.fillStyle = `rgba(0,0,0,${darknessAlpha})`;
    ctx.fillRect(tileX, tileY, tileSizePx, tileSizePx);
  }

  ctx.restore();
}
