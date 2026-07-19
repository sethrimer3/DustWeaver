/**
 * Save slot persistence using localStorage.
 *
 * Each slot stores player progress, total play time, and last-played timestamp.
 * Three save slots are available (indices 0–2).
 */

import { PlayerProgress, createDefaultProgress, sanitizePlayerDustProgress } from './playerProgress';
import { migrateLegacyWeaveUnlocks } from './weaveMigration';

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
  /**
   * Speedrun timer: elapsed active gameplay time in milliseconds for this run.
   * Does not include time spent in menus, inventory, map, or waiting after load/respawn.
   */
  runTimerMs: number;
  /**
   * Timer value at the last save-point interaction.
   * Restored when the player dies and respawns at that save point.
   */
  checkpointRunTimerMs: number;
  /**
   * When true, this save was created with Assist Mode enabled.
   * Assist Mode grants unlimited air grapples (no ground-touch required to recharge).
   * This flag cannot be disabled once set.
   */
  assistMode: boolean;
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
    if (!Array.isArray(parsed.progress.collectedDustSwarmKeys)) parsed.progress.collectedDustSwarmKeys = [];
    if (!Array.isArray(parsed.progress.collectedDustContainerKeys)) parsed.progress.collectedDustContainerKeys = [];
    if (!Array.isArray(parsed.progress.permanentlyOpenGateKeys)) parsed.progress.permanentlyOpenGateKeys = [];
    sanitizePlayerDustProgress(parsed.progress);
    // Migrate legacy shield_sword secondary-weave saves to grant the new
    // independent Sword + Shield unlocks (idempotent; never removes an
    // ability the save already has — see weaveMigration.ts).
    migrateLegacyWeaveUnlocks(parsed.progress);
    // Migrate timer fields (added for speedrun timer feature).
    if (typeof parsed.runTimerMs !== 'number' || !isFinite(parsed.runTimerMs) || parsed.runTimerMs < 0) {
      parsed.runTimerMs = 0;
    }
    if (typeof parsed.checkpointRunTimerMs !== 'number' || !isFinite(parsed.checkpointRunTimerMs) || parsed.checkpointRunTimerMs < 0) {
      parsed.checkpointRunTimerMs = 0;
    }
    // Migrate assist mode flag (added for assist mode feature; old saves default off).
    if (typeof parsed.assistMode !== 'boolean') {
      parsed.assistMode = false;
    }
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
export function createNewSaveSlot(assistMode = false): SaveSlotData {
  return {
    progress: createDefaultProgress(),
    playTimeMs: 0,
    lastPlayedIso: new Date().toISOString(),
    runTimerMs: 0,
    checkpointRunTimerMs: 0,
    assistMode,
  };
}

/**
 * Formats milliseconds into a speedrun timer string.
 * Under an hour: `MM:SS.mmm`  (e.g. "12:34.500")
 * Over an hour:  `H:MM:SS.mmm` (e.g. "1:02:03.456")
 */
export function formatRunTimer(ms: number): string {
  const safeMs = Math.max(0, isFinite(ms) ? ms : 0);
  const totalMs    = Math.floor(safeMs);
  const millis     = totalMs % 1000;
  const totalSecs  = Math.floor(totalMs / 1000);
  const secs       = totalSecs % 60;
  const totalMins  = Math.floor(totalSecs / 60);
  const mins       = totalMins % 60;
  const hours      = Math.floor(totalMins / 60);

  const mm  = String(mins).padStart(2, '0');
  const ss  = String(secs).padStart(2, '0');
  const mmm = String(millis).padStart(3, '0');

  if (hours > 0) {
    return `${hours}:${mm}:${ss}.${mmm}`;
  }
  return `${mm}:${ss}.${mmm}`;
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
