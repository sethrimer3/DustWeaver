/**
 * Cracked-block shatter palette cache.
 *
 * Extracts a small, frequency-weighted colour palette from a block theme's
 * actual rendered sprite so shatter particles look like the block that broke,
 * rather than a generic brown/gray palette.  Palettes are cached by theme id
 * so a sprite is only sampled (getImageData) once per theme, ever — not once
 * per block break.
 *
 * Two sprite-rendering paths exist in this codebase:
 *   - Folder-based themes (folderBlockThemes.ts) — the currently-active path,
 *     since the atlas system (spriteAtlasConfig.ts) is force-disabled.
 *   - Legacy per-world-number sprite sheets (blockSpriteSets.ts) — kept for
 *     completeness but not sampled here; themes on this path fall back to the
 *     curated theme-appropriate palette below.
 *
 * If pixel sampling is unavailable (sprite still loading, decode failed, or
 * the theme isn't a folder-based theme), a curated fallback palette is used
 * instead so particles never disappear or fall back to a wrong colour.
 */

import { getTheme2x2Sprite } from './walls/folderBlockThemes';
import { isFolderBasedTheme } from './walls/folderBlockThemes';

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** Curated theme-appropriate fallback palettes, used when pixel sampling is unavailable. */
const FALLBACK_PALETTES: Record<string, RgbColor[]> = {
  ice:        [{ r: 190, g: 225, b: 245 }, { r: 150, g: 200, b: 230 }, { r: 220, g: 240, b: 250 }, { r: 110, g: 165, b: 200 }],
  ultraIceBlock: [{ r: 200, g: 235, b: 250 }, { r: 160, g: 210, b: 235 }, { r: 230, g: 245, b: 255 }],
  fire:       [{ r: 230, g: 90, b: 40 }, { r: 250, g: 150, b: 40 }, { r: 180, g: 50, b: 20 }, { r: 255, g: 200, b: 80 }],
  lava:       [{ r: 220, g: 70, b: 30 }, { r: 255, g: 140, b: 30 }, { r: 140, g: 30, b: 10 }],
  water:      [{ r: 70, g: 130, b: 200 }, { r: 100, g: 160, b: 220 }, { r: 40, g: 90, b: 160 }],
  poison:     [{ r: 110, g: 190, b: 60 }, { r: 150, g: 210, b: 90 }, { r: 70, g: 130, b: 40 }],
  nature:     [{ r: 90, g: 150, b: 70 }, { r: 60, g: 110, b: 50 }, { r: 140, g: 100, b: 60 }],
  shadow:     [{ r: 60, g: 40, b: 80 }, { r: 90, g: 60, b: 110 }, { r: 30, g: 20, b: 40 }],
  void:       [{ r: 50, g: 30, b: 70 }, { r: 80, g: 40, b: 100 }, { r: 20, g: 10, b: 30 }],
  lightning:  [{ r: 230, g: 220, b: 100 }, { r: 250, g: 250, b: 180 }, { r: 170, g: 160, b: 60 }],
  dirt:       [{ r: 130, g: 100, b: 70 }, { r: 100, g: 75, b: 50 }, { r: 160, g: 130, b: 95 }],
  brownRock:  [{ r: 154, g: 128, b: 112 }, { r: 176, g: 152, b: 120 }, { r: 112, g: 96, b: 80 }],
  blackRock:  [{ r: 70, g: 70, b: 75 }, { r: 45, g: 45, b: 50 }, { r: 95, g: 95, b: 100 }],
};

/** Generic earthy fallback (matches the existing crumble-debris palette) for unrecognised themes. */
const DEFAULT_FALLBACK_PALETTE: RgbColor[] = [
  { r: 154, g: 128, b: 112 }, { r: 176, g: 152, b: 120 }, { r: 112, g: 96, b: 80 },
  { r: 200, g: 176, b: 144 }, { r: 80, g: 64, b: 48 },
];

function getFallbackPalette(themeId: string): RgbColor[] {
  return FALLBACK_PALETTES[themeId] ?? DEFAULT_FALLBACK_PALETTE;
}

/** Max number of weighted colour samples retained per cached palette. */
const MAX_PALETTE_SAMPLES = 48;
/** Sample sprites down to this size before reading pixels (keeps sampling cheap). */
const SAMPLE_SIZE_PX = 8;
/** Pixels with alpha below this (0-255) are considered not meaningfully visible. */
const MIN_VISIBLE_ALPHA = 40;

const _paletteCache = new Map<string, RgbColor[]>();
let _sampleCanvas: HTMLCanvasElement | null = null;
let _sampleCtx: CanvasRenderingContext2D | null = null;

function quantize(v: number): number {
  // Bucket to steps of 24 to merge near-duplicate anti-aliased pixels while
  // preserving visually distinct sprite colours.
  return Math.round(v / 24) * 24;
}

/**
 * Attempts to sample a frequency-weighted palette from the theme's actual
 * rendered sprite. Returns null if sampling isn't currently possible (sprite
 * not yet loaded/decoded, or theme has no folder-based sprite source).
 */
function sampleSpritePalette(themeId: string): RgbColor[] | null {
  if (!isFolderBasedTheme(themeId)) return null;
  const img = getTheme2x2Sprite(themeId, 0, 0, 0);
  if (img === null || !img.complete || img.naturalWidth === 0) return null;

  if (_sampleCanvas === null) {
    _sampleCanvas = document.createElement('canvas');
    _sampleCanvas.width = SAMPLE_SIZE_PX;
    _sampleCanvas.height = SAMPLE_SIZE_PX;
    _sampleCtx = _sampleCanvas.getContext('2d', { willReadFrequently: true });
  }
  const ctx = _sampleCtx;
  if (ctx === null) return null;

  let imageData: ImageData;
  try {
    ctx.clearRect(0, 0, SAMPLE_SIZE_PX, SAMPLE_SIZE_PX);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, SAMPLE_SIZE_PX, SAMPLE_SIZE_PX);
    imageData = ctx.getImageData(0, 0, SAMPLE_SIZE_PX, SAMPLE_SIZE_PX);
  } catch {
    // Sampling can throw (e.g. tainted canvas from a cross-origin sprite).
    // Treat that as "temporarily unavailable" and fall back gracefully.
    return null;
  }

  // Frequency-weighted sample list: each visible pixel contributes one entry
  // (quantized), so common sprite colours naturally end up over-represented
  // when a colour is later picked with Math.random()/deterministic RNG over
  // this array's indices.
  const samples: RgbColor[] = [];
  const data = imageData.data;
  for (let i = 0; i < data.length && samples.length < MAX_PALETTE_SAMPLES; i += 4) {
    const a = data[i + 3];
    if (a < MIN_VISIBLE_ALPHA) continue;
    samples.push({ r: quantize(data[i]), g: quantize(data[i + 1]), b: quantize(data[i + 2]) });
  }

  return samples.length > 0 ? samples : null;
}

/**
 * Returns a frequency-weighted colour palette for the given block theme,
 * suitable for indexing with a uniform random index (common sprite colours
 * naturally appear more often in the returned array). Cached by theme id —
 * the sprite is sampled at most once per theme for the lifetime of the page.
 */
export function getCrackedBlockShatterPalette(themeId: string): RgbColor[] {
  const cached = _paletteCache.get(themeId);
  if (cached !== undefined) return cached;

  const sampled = sampleSpritePalette(themeId);
  const palette = sampled ?? getFallbackPalette(themeId);

  // Only cache successfully-sampled palettes; a fallback due to "not yet
  // loaded" should be retried on a later break rather than cached forever.
  if (sampled !== null) _paletteCache.set(themeId, palette);
  return palette;
}

/** Test-only: clears the palette cache. */
export function _clearCrackedBlockPaletteCacheForTests(): void {
  _paletteCache.clear();
}
