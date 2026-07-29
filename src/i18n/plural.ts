/**
 * Deterministic, in-house plural-category selection.
 *
 * Intl.PluralRules is deliberately NOT used: it varies by platform/ICU version
 * and would make catalog behaviour non-deterministic across desktop/browser
 * builds. The rules here are small, explicit, and unit-tested.
 *
 * To add a locale, add a rule function to `PLURAL_RULES`. Locales that share
 * English's rule can simply reuse `oneOtherRule`.
 */

import type { LocaleId, PluralCategory, PluralForms } from './types';

/** `1 → one`, everything else (including 0 and negatives) → `other`. */
function oneOtherRule(count: number): PluralCategory {
  return Math.abs(count) === 1 ? 'one' : 'other';
}

/**
 * Rule table. English and Spanish both use the simple one/other split (CLDR
 * agrees for both), but they are listed separately so diverging later is a
 * one-line change rather than a refactor.
 */
const PLURAL_RULES: Readonly<Record<LocaleId, (count: number) => PluralCategory>> = {
  en: oneOtherRule,
  es: oneOtherRule,
};

/** Returns the plural category for `count` in `locale`. */
export function selectPluralCategory(locale: LocaleId, count: number): PluralCategory {
  const rule = PLURAL_RULES[locale];
  if (rule === undefined) return oneOtherRule(count);
  if (!Number.isFinite(count)) return 'other';
  return rule(count);
}

/**
 * Picks the concrete string from a plural entry.
 *
 * Fallback chain: exact category → `other`. `other` is required by the type, so
 * this always returns a real string and can never leak a raw key.
 */
export function selectPluralForm(
  forms: PluralForms,
  locale: LocaleId,
  count: number,
): string {
  const category = selectPluralCategory(locale, count);
  const exact = forms[category];
  if (exact !== undefined) return exact;
  return forms.other;
}
