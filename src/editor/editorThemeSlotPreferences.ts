/**
 * editorThemeSlotPreferences.ts — Persists the editor's 4 block-theme "slots"
 * (and which one is active) as a local editor UI preference.
 *
 * This is intentionally NOT part of campaign/room data — it's a per-browser
 * convenience so the editor opens with the themes an author was last using.
 * Follows the same localStorage pattern as mapSketchPreference.ts.
 */

import type { BlockTheme } from '../levels/roomDef';
import { BLOCK_THEMES } from './editorDropdownData';

const STORAGE_KEY = 'dw_editor_block_theme_slots_v1';

export const BLOCK_THEME_SLOT_COUNT = 4;

/** A safe, always-valid fallback theme (first entry in the theme catalogue). */
function firstValidTheme(): BlockTheme {
  return (BLOCK_THEMES[0]?.id ?? 'blackRock') as BlockTheme;
}

function isValidTheme(id: unknown): id is BlockTheme {
  return typeof id === 'string' && BLOCK_THEMES.some(t => t.id === id);
}

interface StoredThemeSlots {
  slots: BlockTheme[];
  activeIndex: number;
}

/**
 * Builds 4 always-valid slot themes, backfilling with the first catalogue
 * theme (and de-duplicating where reasonable) when fewer than 4 distinct
 * themes are available/known.
 */
function sanitizeSlots(rawSlots: unknown): BlockTheme[] {
  const fallback = firstValidTheme();
  const out: BlockTheme[] = [];
  if (Array.isArray(rawSlots)) {
    for (const v of rawSlots) {
      if (out.length >= BLOCK_THEME_SLOT_COUNT) break;
      out.push(isValidTheme(v) ? v : fallback);
    }
  }
  while (out.length < BLOCK_THEME_SLOT_COUNT) out.push(fallback);
  return out;
}

/**
 * Loads the persisted theme slots + active slot index, initializing sensibly
 * (from the first few catalogue themes) when nothing is stored yet, and
 * falling back safely if a saved theme id no longer exists in the catalogue.
 */
export function loadBlockThemeSlots(): { slots: BlockTheme[]; activeIndex: number } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as Partial<StoredThemeSlots>;
      const slots = sanitizeSlots(parsed.slots);
      const activeIndex = typeof parsed.activeIndex === 'number' &&
        parsed.activeIndex >= 0 && parsed.activeIndex < BLOCK_THEME_SLOT_COUNT
        ? parsed.activeIndex
        : 0;
      return { slots, activeIndex };
    }
  } catch {
    // Ignore parse/storage errors — fall through to defaults.
  }
  // No stored preference yet — seed from the first N distinct catalogue themes.
  const seeded: BlockTheme[] = [];
  for (const t of BLOCK_THEMES) {
    if (seeded.length >= BLOCK_THEME_SLOT_COUNT) break;
    if (!seeded.includes(t.id as BlockTheme)) seeded.push(t.id as BlockTheme);
  }
  while (seeded.length < BLOCK_THEME_SLOT_COUNT) seeded.push(firstValidTheme());
  return { slots: seeded, activeIndex: 0 };
}

export function saveBlockThemeSlots(slots: BlockTheme[], activeIndex: number): void {
  try {
    const payload: StoredThemeSlots = { slots: sanitizeSlots(slots), activeIndex };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota / security errors.
  }
}
