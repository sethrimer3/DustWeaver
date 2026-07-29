/**
 * Language-preference persistence.
 *
 * IMPORTANT: this preference lives entirely in localStorage under its own key
 * and is NEVER written into save slots, campaign files, room JSON, or any
 * gameplay/simulation state. Changing language must not affect save schemas or
 * deterministic simulation output.
 */

import type { LocaleId } from './types';
import { normalizeLocaleId } from './locales';

/** Current storage key. Follows the repo's `dustweaver-*` convention. */
export const LOCALE_STORAGE_KEY = 'dustweaver-locale';

/**
 * Legacy key from an earlier ad-hoc preference format. Values may be a raw
 * BCP-47 string (`"es-ES"`) or a JSON blob (`{"language":"es"}`). Read once and
 * migrated forward, then removed.
 */
export const LEGACY_LOCALE_STORAGE_KEY = 'dustweaver-language';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getStorage(): StorageLike | null {
  const store = (globalThis as { localStorage?: StorageLike }).localStorage;
  return store ?? null;
}

/** Extracts a locale id from a legacy value in either supported shape. */
function parseLegacyValue(raw: string): LocaleId | null {
  const direct = normalizeLocaleId(raw);
  if (direct !== null) return direct;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      for (const field of ['language', 'locale', 'lang']) {
        const value = record[field];
        if (typeof value === 'string') {
          const match = normalizeLocaleId(value);
          if (match !== null) return match;
        }
      }
    }
  } catch {
    // Not JSON — nothing further to try.
  }
  return null;
}

/**
 * Reads the stored preference, migrating any legacy value forward.
 * Returns `null` when no valid preference exists (first launch, or a stored
 * value naming a locale this build no longer ships).
 */
export function loadStoredLocale(): LocaleId | null {
  const store = getStorage();
  if (store === null) return null;

  let current: string | null = null;
  try {
    current = store.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
  const normalized = normalizeLocaleId(current);
  if (normalized !== null) return normalized;

  // Migration path: pull the legacy key forward exactly once.
  let legacy: string | null = null;
  try {
    legacy = store.getItem(LEGACY_LOCALE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (legacy === null) return null;
  const migrated = parseLegacyValue(legacy);
  try {
    store.removeItem(LEGACY_LOCALE_STORAGE_KEY);
    if (migrated !== null) store.setItem(LOCALE_STORAGE_KEY, migrated);
  } catch {
    // Storage full or disabled — the in-memory value still applies this session.
  }
  return migrated;
}

/** Persists the chosen locale. Silently ignores storage failures. */
export function saveStoredLocale(locale: LocaleId): void {
  const store = getStorage();
  if (store === null) return;
  try {
    store.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Quota/permission problems must never break the language switch.
  }
}

/** Clears the stored preference (used by tests and "reset to system default"). */
export function clearStoredLocale(): void {
  const store = getStorage();
  if (store === null) return;
  try {
    store.removeItem(LOCALE_STORAGE_KEY);
    store.removeItem(LEGACY_LOCALE_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
