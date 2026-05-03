/**
 * folderBlockThemes.ts — Automatic folder-driven block theme discovery and
 * sprite loading.
 *
 * At build time, Vite's `import.meta.glob` scans every image file directly
 * under ASSETS/SPRITES/BLOCKS/<folder>/  (exactly one directory deep).
 * Each folder becomes a block theme whose variations are the images in it.
 *
 * Sprite conventions:
 *   • Source sprites are 16×16 pixels → used for 2×2 block tiles.
 *   • 8×8 nearest-neighbor downscaled versions are generated lazily and
 *     cached → used for 1×1 block tiles.
 *
 * Legacy themes ('blackRock', 'brownRock', 'dirt') are excluded from this
 * system and continue to use their dedicated rendering paths.
 *
 * Adding new themes requires no code changes:
 *   1. Create a subfolder under ASSETS/SPRITES/BLOCKS/<ThemeName>/
 *   2. Drop 16×16 PNG (or WebP/JPG) sprites into the folder.
 *   3. Rebuild — the editor and renderer pick it up automatically.
 */

import { loadImg } from '../imageCache';
import { hashTilePosition } from './proceduralBlockSprite';

// ── Build-time asset discovery ────────────────────────────────────────────────

/**
 * All image paths under ASSETS/SPRITES/BLOCKS/, resolved at build time by
 * Vite's static-analysis glob.  Keys are project-root-relative paths like
 * `/ASSETS/SPRITES/BLOCKS/grayStone/grayStone (1).png`.
 *
 * We only need the keys (file paths); the lazy-import values are never called.
 */
const _BLOCKS_GLOB = import.meta.glob(
  '/ASSETS/SPRITES/BLOCKS/**/*.{png,webp,jpg,jpeg}',
  { query: '?url', import: 'default' },
);

// ── Folder name filter ────────────────────────────────────────────────────────

/**
 * Legacy theme folders that have dedicated rendering paths and must NOT be
 * treated as folder-based themes.
 */
const _LEGACY_FOLDERS = new Set(['blackRock', 'brownRock', 'dirt']);

/**
 * System/template folders that should be ignored regardless of content.
 * 'block_templates' stores template mask images, not playable sprite art.
 */
const _SYSTEM_FOLDERS = new Set(['block_templates']);

// ── Theme data type ───────────────────────────────────────────────────────────

/** Immutable data for one discovered folder-based block theme. */
export interface FolderThemeData {
  /** Stable ID — the folder name (e.g. 'grayStone'). Used in room save files. */
  readonly id: string;
  /** Human-readable label shown in the editor (e.g. 'Gray Stone'). */
  readonly label: string;
  /**
   * Public URLs of all discovered 16×16 source sprites for this theme,
   * sorted deterministically by path for stable variation order.
   */
  readonly sprite16Urls: readonly string[];
}

// ── Folder-to-label conversion ────────────────────────────────────────────────

/**
 * Converts a camelCase / snake_case / kebab-case folder name to a human-
 * readable title.
 *
 * Examples:
 *   'grayStone'         → 'Gray Stone'
 *   'white_marble'      → 'White Marble'
 *   'dark-stone'        → 'Dark Stone'
 *   'glowingOvergrowth' → 'Glowing Overgrowth'
 */
function _folderToLabel(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')   // split camelCase: 'grayStone' → 'gray Stone'
    .replace(/[_-]+/g, ' ')        // underscores/hyphens → spaces
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/, c => c.toUpperCase()); // capitalise first letter
}

/**
 * Derives a short display ID (≤4 chars) for the editor chip label from the
 * folder name.  Uses camelCase word initials when there are ≥2 words; otherwise
 * falls back to the first 4 characters.
 *
 * Examples:
 *   'grayStone'         → 'gs'
 *   'whiteMarble'       → 'wm'
 *   'glowingOvergrowth' → 'go'
 *   'obsidian'          → 'obsi'
 */
function _folderToShortId(name: string): string {
  // Extract individual words from camelCase / snake_case / kebab-case
  const words = name.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').trim().split(/\s+/);
  if (words.length >= 2) {
    return words.slice(0, 2).map(w => w[0] ?? '').join('').toLowerCase();
  }
  return name.slice(0, 4).toLowerCase();
}

// ── Discovery logic ───────────────────────────────────────────────────────────

/**
 * Regex that matches only images located EXACTLY one directory deep under
 * BLOCKS, e.g. `/ASSETS/SPRITES/BLOCKS/grayStone/grayStone (1).png`.
 * Deeply nested paths (1 - OLD, block_templates/2x2 block/, etc.) are skipped.
 */
const _DEPTH1_RE = /^\/ASSETS\/SPRITES\/BLOCKS\/([^/]+)\/[^/]+$/;

function _buildFolderThemes(): FolderThemeData[] {
  const byFolder = new Map<string, string[]>();

  for (const fullPath of Object.keys(_BLOCKS_GLOB)) {
    const m = _DEPTH1_RE.exec(fullPath);
    if (m === null) continue; // skip deeply nested paths

    const folder = m[1];

    // Skip legacy and system folders
    if (_LEGACY_FOLDERS.has(folder)) continue;
    if (_SYSTEM_FOLDERS.has(folder)) continue;

    // Skip folders that start with a digit (e.g. "1 - OLD")
    if (/^\d/.test(folder)) continue;

    // Strip '/ASSETS/' prefix to get the public (runtime) URL
    const publicUrl = fullPath.slice('/ASSETS/'.length);

    const existing = byFolder.get(folder);
    if (existing !== undefined) {
      existing.push(publicUrl);
    } else {
      byFolder.set(folder, [publicUrl]);
    }
  }

  const result: FolderThemeData[] = [];
  // Sort themes by folder name for deterministic ordering
  for (const [id, urls] of [...byFolder.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (urls.length === 0) {
      if (import.meta.env.DEV) {
        console.warn(`[folderBlockThemes] Theme folder '${id}' has no valid images — skipped.`);
      }
      continue;
    }
    urls.sort(); // deterministic variation order
    result.push({ id, label: _folderToLabel(id), sprite16Urls: urls });
  }

  if (import.meta.env.DEV) {
    console.log(
      `[folderBlockThemes] Discovered ${result.length} folder-based block theme(s):`,
      result.map(t => `${t.id} (${t.sprite16Urls.length} variation(s))`).join(', ') || '(none)',
    );
  }

  return result;
}

// ── Module-level theme catalogue ──────────────────────────────────────────────

/**
 * All discovered folder-based block themes, sorted alphabetically by folder name.
 * Populated once at module load time; never mutated.
 */
export const FOLDER_BLOCK_THEMES: readonly FolderThemeData[] = _buildFolderThemes();

// ── Fast lookup set ───────────────────────────────────────────────────────────

const _FOLDER_THEME_IDS = new Set<string>(FOLDER_BLOCK_THEMES.map(t => t.id));

/** Returns true when `theme` is a discovered folder-based theme (not a legacy theme). */
export function isFolderBasedTheme(theme: string | null): boolean {
  return theme !== null && _FOLDER_THEME_IDS.has(theme);
}

// ── Short-ID accessor (used by the editor) ────────────────────────────────────

/** Returns the short display ID for a folder-based theme (e.g. 'gs' for 'grayStone'). */
export function folderThemeShortId(folderId: string): string {
  return _folderToShortId(folderId);
}

// ── Sprite loading and 8×8 downscale cache ────────────────────────────────────

/** Pre-allocated 8×8 downscale cache. Keyed by the 16×16 source URL. */
const _cache8x8 = new Map<string, HTMLCanvasElement | null>();
/** URLs for which image loading has been requested but the image isn't ready yet. */
const _pendingUrls = new Set<string>();

/**
 * Generates an 8×8 nearest-neighbor downscaled canvas from a loaded 16×16
 * source image.  Returns null if the image has not finished loading yet.
 */
function _downscaleTo8x8(src: HTMLImageElement): HTMLCanvasElement | null {
  if (!src.complete || src.naturalWidth === 0) return null;
  const c = document.createElement('canvas');
  c.width  = 8;
  c.height = 8;
  const ctx = c.getContext('2d');
  if (ctx === null) return null;
  ctx.imageSmoothingEnabled = false; // nearest-neighbor — preserve pixel-art crispness
  ctx.drawImage(src, 0, 0, 8, 8);
  return c;
}

/**
 * Returns the cached 8×8 downscaled canvas for `url`, generating it if the
 * source image has loaded.
 *
 * On the first call for a URL, this function attaches a one-time `load`
 * listener so subsequent frames avoid repeated `loadImg` + readiness checks.
 * Returns null while the source is still loading (the renderer will draw a
 * fallback tile; once the listener fires the canvas is cached and the next
 * frame will draw the sprite).
 */
function _getOrCreate8x8(url: string): HTMLCanvasElement | null {
  const cached = _cache8x8.get(url);
  if (cached !== undefined) return cached; // null = creation failed; canvas = ready

  if (_pendingUrls.has(url)) return null; // already waiting for this image to load

  const img = loadImg(url);
  if (img.complete && img.naturalWidth > 0) {
    // Image was already loaded (e.g., browser cache hit) — create immediately.
    const canvas = _downscaleTo8x8(img);
    _cache8x8.set(url, canvas);
    return canvas;
  }

  // Image not yet ready: register a one-time listener to create the canvas
  // when it arrives. This avoids re-checking every frame.
  _pendingUrls.add(url);
  img.addEventListener('load', () => {
    _pendingUrls.delete(url);
    const canvas = _downscaleTo8x8(img);
    _cache8x8.set(url, canvas);
  }, { once: true });

  return null;
}

// ── Private theme lookup ──────────────────────────────────────────────────────

function _getEntry(themeId: string): FolderThemeData | null {
  // Linear search is acceptable — there are at most ~20 folder themes.
  for (let i = 0; i < FOLDER_BLOCK_THEMES.length; i++) {
    if (FOLDER_BLOCK_THEMES[i].id === themeId) return FOLDER_BLOCK_THEMES[i];
  }
  return null;
}

// ── Public sprite accessors ───────────────────────────────────────────────────

/**
 * Returns the 16×16 source image for use with 2×2 block tiles.
 *
 * Variation is chosen deterministically from the tile's grid position and the
 * current world seed — the same tile always shows the same variation.
 *
 * Returns null when `themeId` is null, not a folder-based theme, or when the
 * image has not finished loading (the renderer will draw a fallback and retry).
 */
export function getTheme2x2Sprite(
  themeId: string | null,
  col:     number,
  row:     number,
  seed:    number,
): HTMLImageElement | null {
  if (themeId === null) return null;
  const entry = _getEntry(themeId);
  if (entry === null || entry.sprite16Urls.length === 0) return null;

  const hash   = hashTilePosition(col, row, seed);
  const varIdx = hash % entry.sprite16Urls.length;
  const img    = loadImg(entry.sprite16Urls[varIdx]);

  return (img.complete && img.naturalWidth > 0) ? img : null;
}

/**
 * Returns the pre-generated 8×8 nearest-neighbor downscaled canvas for use
 * with 1×1 block tiles.
 *
 * The downscaled canvas is created and cached lazily on the first call after
 * the source image has loaded.  Returns null when `themeId` is null, not a
 * folder-based theme, or while the source image is still loading.
 */
export function getTheme1x1Sprite(
  themeId: string | null,
  col:     number,
  row:     number,
  seed:    number,
): HTMLCanvasElement | null {
  if (themeId === null) return null;
  const entry = _getEntry(themeId);
  if (entry === null || entry.sprite16Urls.length === 0) return null;

  const hash   = hashTilePosition(col, row, seed);
  const varIdx = hash % entry.sprite16Urls.length;
  return _getOrCreate8x8(entry.sprite16Urls[varIdx]);
}
