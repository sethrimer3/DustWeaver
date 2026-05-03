/**
 * Block sprite sets — loads and caches the world-themed sprite images used by
 * the auto-tiling wall renderer, and provides sprite-selection helpers that
 * pick the right image for a given tile variant and block theme.
 *
 * Split from blockSpriteRenderer.ts to keep that module focused on tile layout
 * logic, bake caching, and draw calls.
 *
 * Uses the shared image cache (render/imageCache.ts) so sprite URLs are
 * loaded exactly once across all render modules.
 */

import type { BlockTheme } from '../../levels/roomDef';
import { loadImg, isSpriteReady } from '../imageCache';
import { isFolderBasedTheme } from './folderBlockThemes';

export { isSpriteReady };

// ── Tile variant type ────────────────────────────────────────────────────────

/** Auto-tiling sprite variant identifiers. */
export type TileVariant = 'block' | 'single' | 'edge' | 'corner' | 'end';

// ── Sprite set interface ─────────────────────────────────────────────────────

/** Sprite set for a single world theme. */
export interface BlockSpriteSet {
  block:  HTMLImageElement;
  single: HTMLImageElement;
  edge:   HTMLImageElement;
  corner: HTMLImageElement;
  end:    HTMLImageElement;
  vertex: HTMLImageElement;
}

// ── Block-theme sprite pre-loads ────────────────────────────────────────────

// Brown Rock sprites (single flat sprite, no auto-tiling variants)
const _brownRockSprite8  = loadImg('SPRITES/BLOCKS/brownRock/brownRock_8x8.png');
const _brownRockSprite16 = loadImg('SPRITES/BLOCKS/brownRock/brownRock_16x16.png');
const _brownRockSprite32 = loadImg('SPRITES/BLOCKS/brownRock/brownRock_32x32.png');

// Dirt sprites (edge/corner auto-tiling at 8x8)
const _dirtBlockSprite  = loadImg('SPRITES/BLOCKS/dirt/dirt_8x8.png');
const _dirtEdgeSprite   = loadImg('SPRITES/BLOCKS/dirt/dirt_8x8_edge.png');
const _dirtCornerSprite = loadImg('SPRITES/BLOCKS/dirt/dirt_8x8_corner.png');
const _dirtSprite16     = loadImg('SPRITES/BLOCKS/dirt/dirt_16x16.png');

/** Cache of loaded sprite sets keyed by worldNumber (for legacy world-number mode). */
const _spriteSets = new Map<number, BlockSpriteSet>();

/**
 * Returns the sprite set for a given world number, loading on first access.
 *
 * W-0, W-1, W-2 use simple filenames (block.png, corner.png, …).
 * W-3 through W-9 use prefixed filenames (world_N_block.png, …).
 */
export function getBlockSpriteSet(worldNumber: number): BlockSpriteSet {
  const cached = _spriteSets.get(worldNumber);
  if (cached !== undefined) return cached;

  const dir = `SPRITES/WORLDS/W-${worldNumber}/blocks`;
  let sprites: BlockSpriteSet;
  if (worldNumber === 0) {
    sprites = {
      block:  _brownRockSprite8,
      single: _brownRockSprite8,
      edge:   _brownRockSprite8,
      corner: _brownRockSprite8,
      end:    _brownRockSprite8,
      vertex: _brownRockSprite8,
    };
  } else if (worldNumber <= 2) {
    sprites = {
      block:  loadImg(`${dir}/block.png`),
      single: loadImg(`${dir}/single.png`),
      edge:   loadImg(`${dir}/edge.png`),
      corner: loadImg(`${dir}/corner.png`),
      end:    loadImg(`${dir}/end.png`),
      vertex: loadImg(`${dir}/vertex.png`),
    };
  } else {
    const prefix = `world_${worldNumber}_block`;
    sprites = {
      block:  loadImg(`${dir}/${prefix}.png`),
      single: loadImg(`${dir}/${prefix}_single.png`),
      edge:   loadImg(`${dir}/${prefix}_edge.png`),
      corner: loadImg(`${dir}/${prefix}_corner.png`),
      end:    loadImg(`${dir}/${prefix}_end.png`),
      vertex: loadImg(`${dir}/${prefix}_vertex.png`),
    };
  }
  _spriteSets.set(worldNumber, sprites);
  return sprites;
}

// ── Sprite selection helpers ─────────────────────────────────────────────────

export function getBrownRockSpriteForBlockSize(blockSizePx: number): HTMLImageElement {
  if (blockSizePx >= 32) return _brownRockSprite32;
  if (blockSizePx >= 16) return _brownRockSprite16;
  return _brownRockSprite8;
}

export function getDirtSprite(variant: TileVariant): HTMLImageElement {
  switch (variant) {
    case 'edge':   return _dirtEdgeSprite;
    case 'corner': return _dirtCornerSprite;
    default:       return _dirtBlockSprite;
  }
}

/**
 * Returns the 2×2 full sprite for themes that use a single dedicated 16×16
 * texture (brownRock, dirt).
 */
export function getFullSpriteFor2x2(theme: BlockTheme | null, blockSizePx: number): HTMLImageElement | null {
  if (blockSizePx !== 8) return null;
  if (theme === 'brownRock') return _brownRockSprite16;
  if (theme === 'dirt') return _dirtSprite16;
  return null;
}

/** Returns true if the active theme supports 2×2 full-sprite rendering. */
export function themeSupports2x2(theme: BlockTheme | null, blockSizePx: number): boolean {
  if (blockSizePx !== 8) return false;
  return theme === 'brownRock' || theme === 'dirt' || theme === 'blackRock' || isFolderBasedTheme(theme);
}

/**
 * Returns the sprite image for a non-blackRock block cell (brownRock, dirt)
 * based on the auto-tile variant.
 */
export function getSpriteForLegacyTheme(
  theme: BlockTheme,
  variant: TileVariant,
  blockSizePx: number,
): HTMLImageElement {
  switch (theme) {
    case 'brownRock':
      return getBrownRockSpriteForBlockSize(blockSizePx);
    case 'dirt':
      return getDirtSprite(variant);
    default:
      return getBrownRockSpriteForBlockSize(blockSizePx);
  }
}

/**
 * Maps a BlockTheme to the material name string used by the procedural sprite
 * system.  Returns null when the theme is not supported by that system.
 */
export function themeToProceduralMaterial(theme: BlockTheme | null, legacyWorldNumber: number): string | null {
  if (theme === 'blackRock') return 'blackRock';
  if (theme === null && legacyWorldNumber === 0) return 'blackRock';
  return null;
}
