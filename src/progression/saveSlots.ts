/**
 * Save slot persistence using localStorage.
 *
 * Each slot stores player progress, total play time, and last-played timestamp.
 * Three save slots are available (indices 0–2).
 */

import { PlayerProgress, createDefaultProgress } from './playerProgress';

/** Total number of save slots. */
export const SAVE_SLOT_COUNT = 3;

/** localStorage key prefix. */
const STORAGE_KEY_PREFIX = 'dustweaver_save_';

/** Serialisable save-slot data. */
export interface SaveSlotData {
  /** Player progress snapshot. */
  progress: PlayerProgress;
  /** Total accumulated play time in milliseconds. */
  playTimeMs: number;
  /** ISO-8601 timestamp of the last time this slot was played. */
  lastPlayedIso: string;
}

/** Returns the localStorage key for a given slot index. */
function slotKey(slotIndex: number): string {
  return STORAGE_KEY_PREFIX + slotIndex;
}

/** Loads a save slot from localStorage. Returns null if the slot is empty. */
export function loadSaveSlot(slotIndex: number): SaveSlotData | null {
  try {
    const raw = localStorage.getItem(slotKey(slotIndex));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as SaveSlotData;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof parsed.playTimeMs !== 'number' ||
      typeof parsed.lastPlayedIso !== 'string'
    ) {
      return null;
    }
    // Migrate: fill in any fields added after the save was created.
    // PlayerProgress is a flat structure (primitives and arrays only), so a
    // shallow spread is sufficient — existing fields from the save are
    // preserved while missing fields receive safe defaults.
    const defaults = createDefaultProgress();
    parsed.progress = { ...defaults, ...parsed.progress };
    // Explicit fallbacks for array/optional fields added after initial release.
    if (parsed.progress.dustContainerPieces === undefined) parsed.progress.dustContainerPieces = 0;
    if (!Array.isArray(parsed.progress.disabledPassiveWeaves)) parsed.progress.disabledPassiveWeaves = [];
    return parsed;
  } catch {
    return null;
  }
}

/** Persists a save slot to localStorage. */
export function saveSaveSlot(slotIndex: number, data: SaveSlotData): void {
  try {
    localStorage.setItem(slotKey(slotIndex), JSON.stringify(data));
  } catch {
    // Storage full or disabled — silently ignore.
  }
}

/** Deletes a save slot from localStorage. */
export function deleteSaveSlot(slotIndex: number): void {
  try {
    localStorage.removeItem(slotKey(slotIndex));
  } catch {
    // Storage disabled — silently ignore.
  }
}

/** Creates a brand-new save slot with default progress and zero play time. */
export function createNewSaveSlot(): SaveSlotData {
  return {
    progress: createDefaultProgress(),
    playTimeMs: 0,
    lastPlayedIso: new Date().toISOString(),
  };
}

/**
 * Formats milliseconds into a human-readable play-time string.
 * e.g. "2h 15m", "45m", "< 1m"
 */
export function formatPlayTimeMs(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return '< 1m';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

/**
 * Formats an ISO-8601 date string into a readable "last played" label.
 * e.g. "Mar 27, 2026"
 */
export function formatLastPlayed(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Unknown';
  }
}
