/**
 * Public i18n entry point.
 *
 * Import from `../i18n` (or `./i18n`) rather than reaching into submodules, so
 * the surface stays small and RTL / additional locales can be added without
 * touching call sites.
 */

export type {
  CatalogEntry,
  InterpolationValue,
  LocaleChangeListener,
  LocaleDescriptor,
  LocaleId,
  PluralCategory,
  PluralForms,
  TextDirection,
  TranslationParams,
} from './types';
export type { TranslationKey } from './catalogs/en';
export { EN_CATALOG, ALL_TRANSLATION_KEYS } from './catalogs/en';
export { ES_CATALOG, ES_INTENTIONALLY_UNTRANSLATED } from './catalogs/es';
export {
  FALLBACK_LOCALE,
  LOCALE_DESCRIPTORS,
  detectPlatformLocale,
  getCatalog,
  getLocaleDescriptor,
  normalizeLocaleId,
} from './locales';
export {
  LOCALE_STORAGE_KEY,
  LEGACY_LOCALE_STORAGE_KEY,
  clearStoredLocale,
  loadStoredLocale,
  saveStoredLocale,
} from './preference';
export { interpolate } from './interpolate';
export { selectPluralCategory, selectPluralForm } from './plural';
export {
  getAvailableLocales,
  getLocale,
  getTextDirection,
  getUiFontFamily,
  humanizeMissingKey,
  initI18n,
  resetI18nForTests,
  setLocale,
  subscribeToLocaleChange,
  t,
  tDynamic,
  tPlural,
} from './runtime';
export {
  createLocaleBindings,
  applyLocalePresentation,
  type LocaleBindingScope,
} from './domText';
export {
  localizedCanvasFont,
  resolveTextAnchor,
  tCanvas,
  truncateToWidth,
  wrapToWidth,
  type TextMeasureContext,
} from './canvasText';
