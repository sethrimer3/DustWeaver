/**
 * Block theme types, constants, and utility functions.
 *
 * Extracted from roomDef.ts so block-theme logic can be imported independently
 * without pulling in the full room definition tree.
 *
 * Re-exported by roomDef.ts for backward compatibility — callers that already
 * import from '../levels/roomDef' continue to work unchanged.
 */

// ── Block theme and background types ─────────────────────────────────────────

/**
 * Visual theme for block sprites in a room.
 * Controls which sprite set is used by the block renderer.
 *
 * Legacy values: 'blackRock', 'brownRock', 'dirt'.
 * Folder-based themes: any folder name under ASSETS/SPRITES/BLOCKS/ (e.g. 'grayStone').
 */
export type BlockTheme = string;

/**
 * Short stable theme IDs used by compact room JSON.
 *
 * Legacy themes use 2-letter codes: 'bk' (blackRock), 'br' (brownRock), 'dt' (dirt).
 * Folder-based themes use their folder name directly as the ID (e.g. 'grayStone').
 */
export type BlockThemeId = string;

/** Footstep and impact material hardness used by player sound effects. */
export type BlockSoundHardness = 'soft' | 'normal' | 'hard';

export const BLOCK_SOUND_HARDNESS_SOFT = 0;
export const BLOCK_SOUND_HARDNESS_NORMAL = 1;
export const BLOCK_SOUND_HARDNESS_HARD = 2;

function normalizedThemeToken(theme: string): string {
  return theme.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function blockThemeToSoundHardness(theme: string | undefined): BlockSoundHardness {
  if (theme === undefined) return 'hard';
  const t = normalizedThemeToken(theme);
  if (
    t.includes('dirt') ||
    t.includes('sand') ||
    t.includes('overgrowth') ||
    t.includes('grass') ||
    t.includes('mud') ||
    t.includes('soil')
  ) return 'soft';
  if (
    t.includes('wood') ||
    t.includes('moss') ||
    t.includes('sandstone') ||
    t.includes('limestone') ||
    t.includes('chalk') ||
    t.includes('clay')
  ) return 'normal';
  return 'hard';
}

export function blockSoundHardnessToIndex(hardness: BlockSoundHardness): number {
  switch (hardness) {
    case 'soft': return BLOCK_SOUND_HARDNESS_SOFT;
    case 'normal': return BLOCK_SOUND_HARDNESS_NORMAL;
    case 'hard': return BLOCK_SOUND_HARDNESS_HARD;
  }
}

export function blockSoundHardnessIndexToName(index: number): BlockSoundHardness {
  switch (index) {
    case BLOCK_SOUND_HARDNESS_SOFT: return 'soft';
    case BLOCK_SOUND_HARDNESS_NORMAL: return 'normal';
    default: return 'hard';
  }
}

/** Maps a BlockTheme string to its compact JSON ID. */
export function blockThemeToId(theme: string): string {
  switch (theme) {
    case 'blackRock': return 'bk';
    case 'brownRock': return 'br';
    case 'dirt':      return 'dt';
    default:          return theme; // folder-based themes: folder name IS the stable ID
  }
}

/** Maps a compact JSON theme ID back to a BlockTheme string. */
export function blockThemeIdToTheme(themeId: string): string {
  switch (themeId) {
    case 'br': return 'brownRock';
    case 'dt': return 'dirt';
    case 'bk': return 'blackRock';
    default:   return themeId; // folder-based/unknown IDs pass through as-is
  }
}

/** Parses either the legacy long theme name or compact JSON theme ID. */
export function blockThemeRefToTheme(themeRef: string | undefined): string | undefined {
  if (themeRef === undefined) return undefined;
  switch (themeRef) {
    case 'blackRock':
    case 'brownRock':
    case 'dirt':
      return themeRef;
    case 'bk': return 'blackRock';
    case 'br': return 'brownRock';
    case 'dt': return 'dirt';
    default:
      // For folder-based themes and any other non-empty string, pass through as-is.
      // This ensures rooms saved with folder-name IDs (e.g. 'grayStone') reload correctly.
      return themeRef;
  }
}

/**
 * Normalizes a block theme string to its canonical camelCase ID.
 *
 * Handles common variant spellings that may appear in external data or user
 * input (case mismatches, spaces, underscores).  Returns the input unchanged
 * if no known normalization applies — folder-based IDs are already canonical.
 *
 * Use this at all external-data ingress points (JSON import, URL params) to
 * ensure every downstream path receives the canonical ID.
 */
export function normalizeBlockThemeId(themeId: string): string {
  if (!themeId) return themeId;
  // Normalise legacy themes that have common alternate spellings.
  switch (themeId.toLowerCase().replace(/[^a-z0-9]/g, '')) {
    case 'blackrock':  return 'blackRock';
    case 'brownrock':  return 'brownRock';
    case 'dirt':       return 'dirt';
    // Compact IDs pass through normalizeBlockThemeId → blockThemeRefToTheme for full resolution.
    case 'bk':         return 'blackRock';
    case 'br':         return 'brownRock';
    case 'dt':         return 'dirt';
    default:           return themeId;
  }
}

// ── Dynamic theme index registry ──────────────────────────────────────────────
//
// Wall snapshots store themes as Uint8Array indices (0–254) for compact storage.
// Indices 0-2 are reserved for the three legacy themes; new folder-based themes
// are registered lazily starting at index 3. The registry is consistent within
// a single session; it is NOT persisted (rooms are saved by theme name, not index).
//
const _themeToIndex = new Map<string, number>([
  ['blackRock', 0],
  ['brownRock', 1],
  ['dirt', 2],
]);
const _indexToThemeArr: string[] = ['blackRock', 'brownRock', 'dirt'];
let _nextThemeIndex = 3;

/** Maps a BlockTheme string to a compact numeric index for typed arrays. */
export function blockThemeToIndex(theme: string): number {
  const existing = _themeToIndex.get(theme);
  if (existing !== undefined) return existing;
  const idx = _nextThemeIndex++;
  _themeToIndex.set(theme, idx);
  _indexToThemeArr[idx] = theme;
  return idx;
}

/** Maps a numeric theme index back to a BlockTheme string. */
export function indexToBlockTheme(index: number): string {
  return _indexToThemeArr[index] ?? 'blackRock';
}

/** Sentinel value: wall uses room-level default theme. */
export const WALL_THEME_DEFAULT_INDEX = 255;
