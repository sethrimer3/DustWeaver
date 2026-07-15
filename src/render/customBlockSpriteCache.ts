/**
 * customBlockSpriteCache.ts — Campaign-local runtime sprite cache for custom blocks.
 *
 * Builds one OffscreenCanvas (or HTMLCanvasElement) per custom block definition
 * and caches it by block ID. All instances of the same block share the same
 * cached canvas; only one canvas is rebuilt when a block is edited.
 *
 * Does not parse JSON or reconstruct pixel data every frame.
 */

import type { CustomBlockDef } from '../levels/customBlocks';
import {
  makeMissingTextureData,
  CUSTOM_BLOCK_PIXELS_PER_TILE,
} from '../levels/customBlocks';
import type { CustomBlockProperties } from '../levels/customBlockProperties';
import { DEFAULT_CUSTOM_BLOCK_PROPERTIES } from '../levels/customBlockProperties';

/**
 * A cached sprite ready to draw, plus the validated property profile for
 * this block. Caching both together means all instances of the same block
 * share one resolved property bundle — no JSON re-parsing or re-validation
 * happens during rendering or collision loops. Rebuilt only when the block
 * is (re)registered (see `registerCustomBlockSprite` / `invalidateCustomBlockSprite`).
 */
export interface CustomBlockSprite {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  pixelWidth: number;
  pixelHeight: number;
  tileWidth: 1 | 2;
  tileHeight: 1 | 2;
  properties: CustomBlockProperties;
}

/** Module-level sprite cache keyed by raw block ID (not namespaced). */
const _cache = new Map<string, CustomBlockSprite>();

/** Creates an OffscreenCanvas or HTMLCanvasElement for the given pixel data. */
function buildCanvas(
  pixelWidth: number,
  pixelHeight: number,
  pixelData: Uint8ClampedArray,
): HTMLCanvasElement | OffscreenCanvas {
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(pixelWidth, pixelHeight);
    ctx = (canvas as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D | null;
  } else {
    canvas = document.createElement('canvas');
    (canvas as HTMLCanvasElement).width = pixelWidth;
    (canvas as HTMLCanvasElement).height = pixelHeight;
    ctx = (canvas as HTMLCanvasElement).getContext('2d');
  }

  if (ctx === null) return canvas;

  const imageData = new ImageData(new Uint8ClampedArray(pixelData.buffer as ArrayBuffer), pixelWidth, pixelHeight);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/**
 * Registers or updates the cached sprite for a custom block definition.
 * Call this when loading a campaign or after saving edits to a block.
 */
export function registerCustomBlockSprite(def: CustomBlockDef): CustomBlockSprite {
  const canvas = buildCanvas(def.pixelWidth, def.pixelHeight, def.pixelData);
  const sprite: CustomBlockSprite = {
    canvas,
    pixelWidth: def.pixelWidth,
    pixelHeight: def.pixelHeight,
    tileWidth: def.tileWidth,
    tileHeight: def.tileHeight,
    properties: def.properties ?? DEFAULT_CUSTOM_BLOCK_PROPERTIES,
  };
  _cache.set(def.id, sprite);
  return sprite;
}

/** Returns the cached sprite for a raw block ID, or null if not registered. */
export function getCustomBlockSprite(rawId: string): CustomBlockSprite | null {
  return _cache.get(rawId) ?? null;
}

/**
 * Returns the cached, validated property profile for a raw block ID, or the
 * engine defaults (solid / default friction / indestructible) if the block
 * is not registered — never null, never a crash.
 */
export function getCustomBlockProperties(rawId: string): CustomBlockProperties {
  return _cache.get(rawId)?.properties ?? DEFAULT_CUSTOM_BLOCK_PROPERTIES;
}

/**
 * Invalidates and rebuilds the sprite for a single block ID.
 * Used after saving edits that changed the block's pixels.
 */
export function invalidateCustomBlockSprite(def: CustomBlockDef): CustomBlockSprite {
  _cache.delete(def.id);
  return registerCustomBlockSprite(def);
}

/**
 * Updates only the cached property bundle for a raw block ID, leaving the
 * existing canvas untouched. Used when a save changed ONLY `properties`
 * (e.g. materialResponse) so a properties-only edit does not pay the cost of
 * rebuilding the OffscreenCanvas/HTMLCanvasElement and re-uploading pixel
 * data.
 *
 * Returns false (and updates nothing) if the block is not currently cached —
 * callers should fall back to `registerCustomBlockSprite` in that case so the
 * block still ends up registered.
 */
export function updateCustomBlockProperties(rawId: string, properties: CustomBlockProperties): boolean {
  const cached = _cache.get(rawId);
  if (cached === undefined) return false;
  _cache.set(rawId, { ...cached, properties });
  return true;
}

/** Clears all cached sprites (call when unloading a campaign). */
export function clearCustomBlockSpriteCache(): void {
  _cache.clear();
}

/** Returns all currently cached block IDs. */
export function cachedCustomBlockIds(): string[] {
  return Array.from(_cache.keys());
}

/**
 * Returns a sprite for a block, falling back to a conspicuous missing-texture
 * if the block is not registered. Logs a diagnostic.
 */
export function getOrFallbackSprite(
  rawId: string,
  tileWidth: 1 | 2 = 1,
  tileHeight: 1 | 2 = 1,
): CustomBlockSprite {
  const cached = _cache.get(rawId);
  if (cached !== undefined) return cached;

  const pw = tileWidth * CUSTOM_BLOCK_PIXELS_PER_TILE;
  const ph = tileHeight * CUSTOM_BLOCK_PIXELS_PER_TILE;
  const missingData = makeMissingTextureData(pw, ph);
  const canvas = buildCanvas(pw, ph, missingData);
  const fallback: CustomBlockSprite = {
    canvas,
    pixelWidth: pw,
    pixelHeight: ph,
    tileWidth,
    tileHeight,
    properties: DEFAULT_CUSTOM_BLOCK_PROPERTIES,
  };
  // Cache the fallback so we don't rebuild it every frame.
  _cache.set(rawId, fallback);
  return fallback;
}

/**
 * Draws a custom block sprite at the given pixel-space location.
 * Uses pixel-perfect scaling with image smoothing disabled.
 */
export function drawCustomBlockSprite(
  ctx: CanvasRenderingContext2D,
  sprite: CustomBlockSprite,
  destXPx: number,
  destYPx: number,
  destWPx: number,
  destHPx: number,
): void {
  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sprite.canvas as CanvasImageSource,
    destXPx,
    destYPx,
    destWPx,
    destHPx,
  );
  ctx.imageSmoothingEnabled = prevSmoothing;
}
