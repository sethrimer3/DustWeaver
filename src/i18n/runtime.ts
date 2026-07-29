/**
 * i18n runtime: active locale, typed lookup, and change subscription.
 *
 * Guarantees:
 *  - `t(key)` always returns a human-readable string. A key missing from the
 *    active locale falls back to English PER KEY; a key missing from English too
 *    (only reachable from untyped/dynamic callers) returns the last dotted
 *    segment in a readable form rather than leaking `some.raw.key` to players.
 *  - `setLocale` with an unknown/invalid value falls back to English instead of
 *    throwing, and still notifies subscribers.
 *  - Nothing here touches save data, campaign data, or simulation state.
 */

import type {
  CatalogEntry,
  LocaleChangeListener,
  LocaleDescriptor,
  LocaleId,
  TextDirection,
  TranslationParams,
} from './types';
import type { TranslationKey } from './catalogs/en';
import { EN_CATALOG } from './catalogs/en';
import {
  FALLBACK_LOCALE,
  LOCALE_DESCRIPTORS,
  detectPlatformLocale,
  getCatalog,
  getLocaleDescriptor,
  normalizeLocaleId,
} from './locales';
import { interpolate } from './interpolate';
import { selectPluralForm } from './plural';
import { loadStoredLocale, saveStoredLocale } from './preference';

let activeLocale: LocaleId = FALLBACK_LOCALE;
let hasInitialised = false;
const listeners = new Set<LocaleChangeListener>();

/**
 * Resolves the startup locale: stored preference → platform detection →
 * English. Safe to call more than once; only the first call resolves.
 *
 * `platformLocales` is injectable for tests.
 */
export function initI18n(platformLocales?: readonly string[]): LocaleId {
  if (hasInitialised) return activeLocale;
  hasInitialised = true;
  const stored = loadStoredLocale();
  activeLocale = stored ?? detectPlatformLocale(platformLocales);
  return activeLocale;
}

/** Test-only: forget initialisation so a fresh startup can be simulated. */
export function resetI18nForTests(): void {
  hasInitialised = false;
  activeLocale = FALLBACK_LOCALE;
  listeners.clear();
}

export function getLocale(): LocaleId {
  if (!hasInitialised) initI18n();
  return activeLocale;
}

/**
 * Switches the active locale and notifies every subscriber synchronously so
 * mounted DOM and canvas UI can re-render immediately (no restart required).
 *
 * An unknown or malformed value resolves to English rather than throwing.
 * Returns the locale that actually became active.
 */
export function setLocale(next: string, options?: { persist?: boolean }): LocaleId {
  if (!hasInitialised) initI18n();
  const resolved = normalizeLocaleId(next) ?? FALLBACK_LOCALE;
  const persist = options?.persist ?? true;
  if (persist) saveStoredLocale(resolved);
  if (resolved === activeLocale) return resolved;
  activeLocale = resolved;
  for (const listener of Array.from(listeners)) {
    listener(resolved);
  }
  return resolved;
}

/**
 * Subscribes to locale changes. Returns an unsubscribe function — callers that
 * mount UI must call it on teardown so listeners do not leak between screens.
 */
export function subscribeToLocaleChange(listener: LocaleChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAvailableLocales(): readonly LocaleDescriptor[] {
  return LOCALE_DESCRIPTORS;
}

/** Layout direction for the active locale. RTL-ready; all shipped locales are LTR. */
export function getTextDirection(): TextDirection {
  return getLocaleDescriptor(getLocale()).direction;
}

/**
 * CSS `font-family` value for player-facing text in the active locale.
 * UI modules should use this instead of hard-coding `'Cinzel', serif` so that
 * accented / non-Latin glyphs fall back to a font that actually has them.
 */
export function getUiFontFamily(): string {
  return getLocaleDescriptor(getLocale()).fontFallback;
}

/**
 * Last-resort display text for a key with no entry in any catalog.
 * Converts `settings.audio.musicVolume` → `Music Volume` so players never see a
 * raw dotted key, and never see an empty string.
 */
export function humanizeMissingKey(key: string): string {
  const segments = key.split('.');
  const last = segments[segments.length - 1] ?? key;
  const spaced = last
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  if (spaced.length === 0) return '';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function resolveEntry(locale: LocaleId, key: TranslationKey): CatalogEntry | undefined {
  const entry = getCatalog(locale)[key];
  if (entry !== undefined) return entry;
  // Per-key fallback to the authoritative English catalog.
  return EN_CATALOG[key] as CatalogEntry | undefined;
}

/**
 * Translates `key` in the active locale.
 *
 * Plural entries are selected using `params.count` and the active locale's
 * plural rule; `{count}` is also available as an interpolation placeholder.
 */
export function t(key: TranslationKey, params?: TranslationParams): string {
  const locale = getLocale();
  const entry = resolveEntry(locale, key);
  if (entry === undefined) return humanizeMissingKey(key);
  let template: string;
  if (typeof entry === 'string') {
    template = entry;
  } else {
    const rawCount = params?.count;
    const count = typeof rawCount === 'number' ? rawCount : Number(rawCount ?? 0);
    template = selectPluralForm(entry, locale, count);
  }
  return interpolate(template, params);
}

/**
 * Explicit plural helper for readability at call sites that always pluralise.
 * Equivalent to `t(key, { ...params, count })`.
 */
export function tPlural(
  key: TranslationKey,
  count: number,
  params?: TranslationParams,
): string {
  return t(key, { ...params, count });
}

/**
 * Translates a key that is only known at runtime (for example a settings row id
 * built from data). Returns `null` when the string is not a known key, letting
 * the caller decide — this is the ONLY dynamic-lookup entry point, and it is
 * still fully typed.
 */
export function tDynamic(key: string, params?: TranslationParams): string | null {
  if (!Object.prototype.hasOwnProperty.call(EN_CATALOG, key)) return null;
  return t(key as TranslationKey, params);
}
