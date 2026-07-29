/**
 * i18n core types.
 *
 * Design notes:
 *  - Catalog entries are either a plain string or a small plural-form record.
 *    Human translators edit plain TS records; nothing here is code-generated.
 *  - `TranslationKey` is derived from the English catalog (see `catalogs/en.ts`),
 *    so every call site is compile-time checked and no untyped string keys or
 *    `any` are used anywhere in this subsystem.
 *  - Text direction is part of the locale descriptor from day one so RTL can be
 *    added later without changing any `t(...)` call site.
 */

/** Plural categories this project supports. Deterministic, in-house — no Intl. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/**
 * A plural catalog entry. `other` is mandatory and acts as the last-resort form
 * so a missing category can never produce an empty string.
 */
export interface PluralForms {
  readonly zero?: string;
  readonly one?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
  readonly other: string;
}

/** A single catalog value: simple string, or a plural-form record. */
export type CatalogEntry = string | PluralForms;

/** Values allowed as interpolation parameters. */
export type InterpolationValue = string | number;

/** Interpolation parameters passed to `t(...)`. `count` also drives plurals. */
export type TranslationParams = Readonly<Record<string, InterpolationValue>>;

/** Supported locale identifiers. Extend by adding a catalog + descriptor. */
export type LocaleId = 'en' | 'es';

/** Layout direction. `rtl` is reserved: no shipped locale uses it yet. */
export type TextDirection = 'ltr' | 'rtl';

/** Human-facing metadata for a locale, used by the language selector. */
export interface LocaleDescriptor {
  readonly id: LocaleId;
  /** Name written in the locale's own language (never translated). */
  readonly nativeName: string;
  /** English name, used for debug/logging only. */
  readonly englishName: string;
  readonly direction: TextDirection;
  /**
   * BCP-47 tags that should select this locale during first-launch platform
   * detection. Matched case-insensitively on the primary subtag.
   */
  readonly matchTags: readonly string[];
  /**
   * CSS font-family stack fragment appended after the pixel/display font so
   * accented and non-Latin glyphs fall back to a font that has them.
   */
  readonly fontFallback: string;
}

/** Callback fired after the active locale changes. */
export type LocaleChangeListener = (locale: LocaleId) => void;
