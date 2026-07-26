/**
 * Read-only dropdown option arrays and palette definitions for the editor UI.
 *
 * Extracted from editorState.ts to keep the core state/type module focused on
 * mutable runtime data.  All symbols here are pure data constants (no side
 * effects, no runtime state).
 */

import type { BlockTheme, BlockThemeId, LightingEffect, AmbientLightDirection, CrumbleVariant } from '../levels/roomDef';
import type { LightType } from '../levels/lightingSchema';
import type { RoomSongId } from '../audio/musicManager';
import { AVAILABLE_SONGS, SONG_DISPLAY_NAMES } from '../audio/musicManager';
import { FOLDER_BLOCK_THEMES, folderThemeShortId } from '../render/walls/folderBlockThemes';
export { BACKGROUND_OPTIONS } from '../render/backgroundCatalogue';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Active brush mode for painting tools. */
export type BrushMode = 'single' | '3x3' | '5x5' | 'rect' | 'fill';

// Palette types and items live in editorPaletteItems.ts (no bundler-only deps)
// so tests can import them; re-exported here for existing callers.
export type { PaletteCategory, PaletteItem } from './editorPaletteItems';
export { PALETTE_CATEGORIES, PALETTE_CATEGORY_LABELS, PALETTE_ITEMS } from './editorPaletteItems';

export type RopeDestructibility = 'indestructible' | 'playerOnly' | 'any';

// ── Dropdown option arrays ────────────────────────────────────────────────────

/** Options shown in the "Room Song" editor dropdown, in display order. */
export const SONG_OPTIONS: readonly { id: RoomSongId; label: string }[] = [
  { id: '_continue', label: SONG_DISPLAY_NAMES._continue },
  { id: '_silence',  label: SONG_DISPLAY_NAMES._silence },
  ...AVAILABLE_SONGS.map(id => ({ id, label: SONG_DISPLAY_NAMES[id] })),
];

/** Options for the crumble-block weakness variant dropdown. */
export const CRUMBLE_VARIANT_OPTIONS: readonly { id: CrumbleVariant; label: string }[] = [
  { id: 'normal',    label: 'Normal'    },
  { id: 'fire',      label: 'Fire'      },
  { id: 'water',     label: 'Water'     },
  { id: 'void',      label: 'Void'      },
  { id: 'ice',       label: 'Ice'       },
  { id: 'lightning', label: 'Lightning' },
  { id: 'poison',    label: 'Poison'    },
  { id: 'shadow',    label: 'Shadow'    },
  { id: 'nature',    label: 'Nature'    },
];

/** Options for the scene-light kind dropdown. */
export const SCENE_LIGHT_TYPE_OPTIONS: readonly { id: LightType; label: string }[] = [
  { id: 'softGlow',   label: 'Soft Glow'   },
  { id: 'spotlight',  label: 'Spotlight'   },
  { id: 'floodlight', label: 'Floodlight'  },
  { id: 'backlight',  label: 'Backlight'   },
  { id: 'sunray',     label: 'Volumetric Sunray' },
];

/** Canonical list of ParticleKind string values available for editor dropdowns. */
export const DUST_KIND_OPTIONS: readonly string[] = [
  'Golden', 'Ice', 'Nature', 'Void', 'Light',
];

export const ROPE_DESTRUCTIBILITY_OPTIONS: ReadonlyArray<{ id: RopeDestructibility; label: string }> = [
  { id: 'indestructible', label: 'Indestructible' },
  { id: 'playerOnly',     label: 'Player Only' },
  { id: 'any',            label: 'Any' },
];

export const ROPE_THICKNESS_OPTIONS: ReadonlyArray<{ id: 0 | 1 | 2; label: string }> = [
  { id: 0, label: '8 px (thin)' },
  { id: 1, label: '16 px (medium)' },
  { id: 2, label: '24 px (thick)' },
];

const LEGACY_BLOCK_THEME_META: Readonly<Record<string, { shortId: BlockThemeId; label: string }>> = {
  blackRock: { shortId: 'bk', label: 'Blackstone' },
  brownRock: { shortId: 'br', label: 'Brownstone' },
  dirt:      { shortId: 'dt', label: 'Dirt' },
};
const LEGACY_BLOCK_THEME_ORDER: Readonly<Record<string, number>> = {
  blackRock: 0,
  brownRock: 1,
  dirt:      2,
};

function makeBlockThemeOption(theme: { id: string; label: string }): { id: BlockTheme; shortId: BlockThemeId; label: string } {
  const legacyMeta = LEGACY_BLOCK_THEME_META[theme.id];
  if (legacyMeta !== undefined) {
    return { id: theme.id, shortId: legacyMeta.shortId, label: legacyMeta.label };
  }
  return { id: theme.id, shortId: folderThemeShortId(theme.id), label: theme.label };
}

// Special-block wall themes (Ice Block, Ultra Ice Block) are discovered
// alongside the regular material themes so the wall renderer can look them
// up by id, but they already have dedicated palette cards under the
// "Special Blocks" category (see PALETTE_ITEMS in editorPaletteItems.ts) —
// they must not also appear as swatches in the plain Block Theme picker.
const _SPECIAL_BLOCK_THEME_IDS = new Set(['iceBlock', 'ultraIceBlock']);

/** Available block themes for placement and wall inspection. */
export const BLOCK_THEMES: readonly { id: BlockTheme; shortId: BlockThemeId; label: string }[] = [...FOLDER_BLOCK_THEMES]
  .filter(theme => !_SPECIAL_BLOCK_THEME_IDS.has(theme.id))
  .sort((a, b) => {
    const orderA = LEGACY_BLOCK_THEME_ORDER[a.id] ?? 1000;
    const orderB = LEGACY_BLOCK_THEME_ORDER[b.id] ?? 1000;
    return orderA !== orderB ? orderA - orderB : a.id.localeCompare(b.id);
  })
  .map(makeBlockThemeOption);

/**
 * Available lighting models for the editor dropdown.
 *
 * The legacy `'DEFAULT'` and `'Above'` values are preserved for backward
 * compatibility with existing room files (the runtime solver maps them into
 * the unified ambient model — `'DEFAULT'` → omni, `'Above'` → down). New
 * rooms should pick `'Ambient'`, `'DarkRoom'`, or `'FullyLit'`.
 */
export const LIGHTING_OPTIONS: readonly { id: LightingEffect; label: string }[] = [
  { id: 'Ambient',  label: 'Ambient' },
  { id: 'DarkRoom', label: 'Dark Room' },
  { id: 'FullyLit', label: 'Fully Lit' },
  { id: 'DEFAULT',  label: 'Legacy: Default (omni)' },
  { id: 'Above',    label: 'Legacy: Above (down)' },
];

/**
 * Available ambient/skylight directions. `'down-right'` is the recommended
 * authored default for a natural diagonal spill (§8 of the spec).
 */
export const AMBIENT_LIGHT_DIRECTION_OPTIONS: readonly { id: AmbientLightDirection; label: string }[] = [
  { id: 'omni',       label: 'Omni (all sides)' },
  { id: 'down',       label: 'Down ↓' },
  { id: 'down-right', label: 'Down-Right ↘' },
  { id: 'down-left',  label: 'Down-Left ↙' },
  { id: 'up',         label: 'Up ↑' },
  { id: 'up-right',   label: 'Up-Right ↗' },
  { id: 'up-left',    label: 'Up-Left ↖' },
  { id: 'left',       label: 'Left ←' },
  { id: 'right',      label: 'Right →' },
];

/** Available fade color options for room transitions. */
export const FADE_COLOR_OPTIONS: readonly { label: string; value: string }[] = [
  { label: 'Black', value: '#000000' },
  { label: 'Warm Sunlight White', value: '#FFF4D6' },
];
