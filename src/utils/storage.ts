/**
 * localStorage persistence helpers.
 *
 * Thin wrappers that eliminate the repetitive
 * `getItem → parseFloat → isNaN guard → clamp → default` pattern.
 */

import { clamp } from './math';

/**
 * Reads a float from localStorage, clamping it to [min, max].
 * Returns `defaultValue` if the key is absent or the stored value is NaN.
 * Omit `min`/`max` (or pass ±Infinity) to skip clamping.
 */
export function getStoredFloat(
  key: string,
  defaultValue: number,
  min = -Infinity,
  max = Infinity,
): number {
  const raw = localStorage.getItem(key);
  if (raw !== null) {
    const parsed = parseFloat(raw);
    return !isNaN(parsed) ? clamp(parsed, min, max) : defaultValue;
  }
  return defaultValue;
}

/**
 * Writes a float to localStorage, clamping it to [min, max] first.
 * Omit `min`/`max` (or pass ±Infinity) to skip clamping.
 */
export function setStoredFloat(
  key: string,
  value: number,
  min = -Infinity,
  max = Infinity,
): void {
  localStorage.setItem(key, String(clamp(value, min, max)));
}

/** Reads a raw string from localStorage, returning `defaultValue` if absent. */
export function getStoredString(key: string, defaultValue: string): string {
  const raw = localStorage.getItem(key);
  return raw !== null ? raw : defaultValue;
}

/** Writes a raw string to localStorage. */
export function setStoredString(key: string, value: string): void {
  localStorage.setItem(key, value);
}

/**
 * Reads and JSON-parses a value from localStorage.
 * Returns `defaultValue` if the key is absent or parsing fails.
 */
export function getStoredJson<T>(key: string, defaultValue: T): T {
  const raw = localStorage.getItem(key);
  if (raw !== null) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  }
  return defaultValue;
}

/**
 * JSON-serialises `value` and writes it to localStorage.
 * Silently ignores quota/permission errors.
 */
export function setStoredJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or disabled — silently ignore.
  }
}
