/**
 * Language tab for the main-menu settings panel.
 *
 * Owns the language selector itself. It is deliberately dependency-injected
 * (`LanguageTabPorts`) so this module stays free of the settings panel's private
 * styling helpers while still matching its look exactly, and so it can be
 * exercised without a real DOM in tests.
 *
 * Behaviour:
 *  - Selecting a language applies it immediately (every mounted screen updates
 *    through the i18n subscription) and persists it for the next launch.
 *  - Native language names are shown in their own language and are never
 *    translated.
 *  - A small coverage line tells the player that untranslated lines fall back to
 *    English, so partial locales are honest rather than mysterious.
 */

import type { LocaleDescriptor, LocaleId } from '../i18n';
import { ALL_TRANSLATION_KEYS, EN_CATALOG, getCatalog, t } from '../i18n';

/** Injected pieces owned by the settings panel. */
export interface LanguageTabPorts {
  getLocale: () => LocaleId;
  setLocale: (next: string) => LocaleId;
  locales: readonly LocaleDescriptor[];
  makeLabel: (text: string) => HTMLDivElement;
  makeStyledDropdown: (
    options: { value: string; label: string }[],
    currentValue: string,
    onChange: (value: string) => void,
  ) => HTMLDivElement;
}

/**
 * Counts how many keys the given locale actually translates. English is
 * complete by construction; other locales report real coverage so the player
 * knows some text may still appear in English.
 */
export function countTranslatedKeys(locale: LocaleId): number {
  if (locale === 'en') return ALL_TRANSLATION_KEYS.length;
  const catalog = getCatalog(locale);
  let count = 0;
  for (const key of ALL_TRANSLATION_KEYS) {
    if (catalog[key] !== undefined) count++;
  }
  return count;
}

/** Builds the language tab into `tabContent` (which the caller has cleared). */
export function buildLanguageTab(tabContent: HTMLElement, ports: LanguageTabPorts): void {
  tabContent.innerHTML = '';

  const heading = ports.makeLabel(t('language.heading'));
  heading.style.marginTop = '4px';
  tabContent.appendChild(heading);

  const options: { value: string; label: string }[] = [];
  for (const descriptor of ports.locales) {
    // Native names stay in their own language — deliberately not translated.
    options.push({ value: descriptor.id, label: descriptor.nativeName });
  }

  const dropdown = ports.makeStyledDropdown(options, ports.getLocale(), (value) => {
    ports.setLocale(value);
    // The settings panel is rebuilt by the locale subscription in mainMenu.ts,
    // so no manual refresh is needed here.
  });
  const select = dropdown.querySelector('select');
  if (select !== null) select.setAttribute('aria-label', t('language.selectAria'));
  tabContent.appendChild(dropdown);

  const description = document.createElement('div');
  description.textContent = t('language.description');
  description.style.cssText = `
    margin-top: 10px;
    color: rgba(212,168,75,0.55);
    font-size: 0.75rem;
    line-height: 1.45;
    letter-spacing: 0.03em;
  `;
  tabContent.appendChild(description);

  const coverage = document.createElement('div');
  coverage.textContent = t('language.coverage', {
    translated: countTranslatedKeys(ports.getLocale()),
    total: Object.keys(EN_CATALOG).length,
  });
  coverage.style.cssText = `
    margin-top: 8px;
    color: rgba(212,168,75,0.4);
    font-size: 0.7rem;
    letter-spacing: 0.03em;
  `;
  tabContent.appendChild(coverage);
}
