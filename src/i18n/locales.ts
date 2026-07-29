/**
 * Locale registry: descriptors, catalogs, and platform-locale detection.
 *
 * Adding a locale = add a catalog module, a descriptor entry, and a plural rule.
 * No call site changes required.
 */

import type { CatalogEntry, LocaleDescriptor, LocaleId } from './types';
import { EN_CATALOG, type TranslationKey } from './catalogs/en';
import { ES_CATALOG } from './catalogs/es';

/** The locale used when nothing else can be resolved. Always complete. */
export const FALLBACK_LOCALE: LocaleId = 'en';

/**
 * Font fallback stacks. The pixel/display font (`Cinzel`) lacks many accented and
 * non-Latin glyphs, so every locale appends a broad system stack after it. Kept
 * per-locale so a future CJK/RTL locale can prepend a script-specific face
 * without touching any UI module.
 */
const LATIN_FALLBACK =
  "'Cinzel', 'Noto Sans', 'Segoe UI', 'DejaVu Sans', system-ui, serif";

export const LOCALE_DESCRIPTORS: readonly LocaleDescriptor[] = [
  {
    id: 'en',
    nativeName: 'English',
    englishName: 'English',
    direction: 'ltr',
    matchTags: ['en'],
    fontFallback: LATIN_FALLBACK,
  },
  {
    id: 'es',
    nativeName: 'Español',
    englishName: 'Spanish',
    direction: 'ltr',
    matchTags: ['es', 'ca', 'gl'],
    fontFallback: LATIN_FALLBACK,
  },
];

/** Per-locale catalogs. English is complete; others may be partial. */
const CATALOGS: Readonly<Record<LocaleId, Partial<Record<TranslationKey, CatalogEntry>>>> = {
  en: EN_CATALOG,
  es: ES_CATALOG,
};

export function getCatalog(locale: LocaleId): Partial<Record<TranslationKey, CatalogEntry>> {
  return CATALOGS[locale] ?? EN_CATALOG;
}

export function getLocaleDescriptor(locale: LocaleId): LocaleDescriptor {
  for (const d of LOCALE_DESCRIPTORS) {
    if (d.id === locale) return d;
  }
  // Unreachable for valid ids; keeps the function total.
  return LOCALE_DESCRIPTORS[0];
}

/**
 * Narrows an arbitrary string to a supported `LocaleId`, or `null`.
 * Accepts BCP-47 tags (`es-419`, `en_GB`) by matching the primary subtag.
 */
export function normalizeLocaleId(raw: string | null | undefined): LocaleId | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim().toLowerCase().replace(/_/g, '-');
  if (trimmed.length === 0) return null;
  const primary = trimmed.split('-')[0];
  for (const d of LOCALE_DESCRIPTORS) {
    if (d.id === trimmed) return d.id;
    for (const tag of d.matchTags) {
      if (tag === primary) return d.id;
    }
  }
  return null;
}

/**
 * First-launch detection from the platform. Reads `navigator.languages` then
 * `navigator.language`. Returns `FALLBACK_LOCALE` when nothing matches or when
 * no navigator exists (Node / Electron main-process contexts).
 *
 * `platformLocales` is injectable purely so tests do not need a fake navigator.
 */
export function detectPlatformLocale(platformLocales?: readonly string[]): LocaleId {
  let candidates: readonly string[] = platformLocales ?? [];
  if (platformLocales === undefined) {
    const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } })
      .navigator;
    if (nav !== undefined) {
      if (Array.isArray(nav.languages) && nav.languages.length > 0) {
        candidates = nav.languages;
      } else if (typeof nav.language === 'string') {
        candidates = [nav.language];
      }
    }
  }
  for (const candidate of candidates) {
    const match = normalizeLocaleId(candidate);
    if (match !== null) return match;
  }
  return FALLBACK_LOCALE;
}
