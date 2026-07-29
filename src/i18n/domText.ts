/**
 * DOM binding helpers.
 *
 * `bindText` writes a translated string into an element AND re-writes it when
 * the locale changes, so mounted menus update immediately without a restart and
 * without every screen hand-rolling a subscription.
 *
 * Screens that rebuild themselves wholesale can instead use
 * `createLocaleRebinder`, which re-runs a build function on locale change.
 */

import type { TranslationParams } from './types';
import type { TranslationKey } from './catalogs/en';
import { getTextDirection, getUiFontFamily, subscribeToLocaleChange, t } from './runtime';

/** Disposes every binding created through the returned scope. */
export interface LocaleBindingScope {
  /** Sets `el.textContent` to `t(key, params)` and keeps it up to date. */
  bindText(el: HTMLElement, key: TranslationKey, params?: TranslationParams): void;
  /** Sets an attribute (e.g. `title`, `aria-label`) to a translated value. */
  bindAttribute(
    el: HTMLElement,
    attribute: string,
    key: TranslationKey,
    params?: TranslationParams,
  ): void;
  /** Registers an arbitrary re-render callback; runs once immediately. */
  onLocaleChange(apply: () => void): void;
  /** Removes every binding and the underlying subscription. */
  dispose(): void;
}

/**
 * Creates a binding scope. Call `dispose()` in the screen's teardown path —
 * every existing screen already returns a cleanup function, so this slots in
 * without changing navigation or keyboard/controller behaviour.
 */
export function createLocaleBindings(): LocaleBindingScope {
  const appliers: (() => void)[] = [];
  let unsubscribe: (() => void) | null = null;

  function ensureSubscribed(): void {
    if (unsubscribe !== null) return;
    unsubscribe = subscribeToLocaleChange(() => {
      for (const apply of appliers) apply();
    });
  }

  function register(apply: () => void): void {
    appliers.push(apply);
    ensureSubscribed();
    apply();
  }

  return {
    bindText(el, key, params) {
      register(() => {
        el.textContent = t(key, params);
      });
    },
    bindAttribute(el, attribute, key, params) {
      register(() => {
        el.setAttribute(attribute, t(key, params));
      });
    },
    onLocaleChange(apply) {
      register(apply);
    },
    dispose() {
      appliers.length = 0;
      if (unsubscribe !== null) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  };
}

/**
 * Applies locale-dependent presentation to a container: text direction and the
 * font stack that supplies accented / non-Latin glyphs. Safe to call repeatedly.
 */
export function applyLocalePresentation(el: HTMLElement): void {
  el.setAttribute('dir', getTextDirection());
  el.style.fontFamily = getUiFontFamily();
}
