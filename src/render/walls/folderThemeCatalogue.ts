/**
 * folderThemeCatalogue.ts — Build-time discovery of folder-based block themes.
 *
 * At build time, Vite's `import.meta.glob` scans every image file directly
 * under ASSETS/SPRITES/BLOCKS/<folder>/  (exactly one directory deep).
 * Each folder becomes a block theme whose variations are the images in it.
 *
 * This module is pure data — it has no rendering dependencies.
 * Sprite loading and the 8×8 downscale cache live in folderBlockThemes.ts.
 */

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

const _SPECIAL_BLOCKS_GLOB = import.meta.glob(
  '/ASSETS/SPRITES/specialBLOCKS/**/*.{png,webp,jpg,jpeg}',
  { query: '?url', import: 'default' },
);

/** Subset of specialBLOCKS folders that are also valid wall themes. */
// Only folders representing static wall textures are valid wall themes.
// Folders like 'kineticBlock' and 'fallingBlockOverlay' are dynamic overlays
// drawn by the hazard renderer, not by the wall texture system.
const _SPECIAL_WALL_THEMES = new Set(['iceBlock', 'ultraIceBlock']);

// ── Folder name filter ────────────────────────────────────────────────────────

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
const _SPECIAL_DEPTH1_RE = /^\/ASSETS\/SPRITES\/specialBLOCKS\/([^/]+)\/[^/]+$/;

function _buildFolderThemes(): FolderThemeData[] {
  const byFolder = new Map<string, string[]>();

  for (const fullPath of Object.keys(_BLOCKS_GLOB)) {
    const m = _DEPTH1_RE.exec(fullPath);
    if (m === null) continue; // skip deeply nested paths

    const folder = m[1];

    // Skip system folders
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

  // Also discover special block themes (e.g. iceBlock) from specialBLOCKS/
  for (const fullPath of Object.keys(_SPECIAL_BLOCKS_GLOB)) {
    const m = _SPECIAL_DEPTH1_RE.exec(fullPath);
    if (m === null) continue;

    const folder = m[1];
    if (!_SPECIAL_WALL_THEMES.has(folder)) continue;
    const filename = fullPath.slice(fullPath.lastIndexOf('/') + 1);
    if (!filename.startsWith(folder)) continue;

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

/** Returns true when `theme` is a discovered folder-based theme. */
export function isFolderBasedTheme(theme: string | null): boolean {
  return theme !== null && _FOLDER_THEME_IDS.has(theme);
}

// ── Short-ID accessor (used by the editor) ────────────────────────────────────

/** Returns the short display ID for a folder-based theme (e.g. 'gs' for 'grayStone'). */
export function folderThemeShortId(folderId: string): string {
  return _folderToShortId(folderId);
}
