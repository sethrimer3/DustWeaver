/**
 * Representative DOM and canvas surfaces really do render translated values,
 * and both react to a runtime language switch.
 *
 * Uses a tiny hand-rolled DOM stub (no new dependency) that supports exactly
 * the operations the bound UI helpers use.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  _data: new Map<string, string>(),
  getItem(key: string) { return this._data.has(key) ? this._data.get(key)! : null; },
  setItem(key: string, value: string) { this._data.set(key, value); },
  removeItem(key: string) { this._data.delete(key); },
} as unknown as Storage;

// ── Minimal DOM stub ────────────────────────────────────────────────────────

interface StubElement {
  tagName: string;
  textContent: string;
  children: StubElement[];
  attributes: Record<string, string>;
  style: Record<string, string> & { cssText: string };
  innerHTML: string;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  appendChild(child: StubElement): StubElement;
  querySelector(selector: string): StubElement | null;
}

function createStubElement(tagName: string): StubElement {
  const el: StubElement = {
    tagName,
    textContent: '',
    children: [],
    attributes: {},
    style: { cssText: '' } as StubElement['style'],
    innerHTML: '',
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    appendChild(child) { this.children.push(child); return child; },
    querySelector(selector) {
      for (const child of this.children) {
        if (child.tagName === selector) return child;
        const nested = child.querySelector(selector);
        if (nested !== null) return nested;
      }
      return null;
    },
  };
  return el;
}

(globalThis as unknown as { document: { createElement(tag: string): StubElement } }).document = {
  createElement: createStubElement,
};

import {
  applyLocalePresentation,
  createLocaleBindings,
  localizedCanvasFont,
  resetI18nForTests,
  resolveTextAnchor,
  setLocale,
  t,
  tCanvas,
  truncateToWidth,
  wrapToWidth,
  type TextMeasureContext,
} from '../i18n';
import { buildLanguageTab, countTranslatedKeys } from '../ui/mainMenuSettingsLanguage';
import { getAvailableLocales, getLocale } from '../i18n';

function asHtml(el: StubElement): HTMLElement {
  return el as unknown as HTMLElement;
}

// ── 10a. DOM text uses translated values and live-updates ───────────────────

test('bound DOM text renders the active locale and updates on switch', () => {
  resetI18nForTests();
  setLocale('en');
  const i18n = createLocaleBindings();
  const button = createStubElement('button');
  i18n.bindText(button, 'mainMenu.play');
  assert.equal(button.textContent, 'Play');

  setLocale('es');
  assert.equal(button.textContent, 'Jugar', 'mounted DOM must update without a rebuild');

  setLocale('en');
  assert.equal(button.textContent, 'Play');
  i18n.dispose();

  // After disposal the element must stop tracking (no listener leak).
  setLocale('es');
  assert.equal(button.textContent, 'Play');
  setLocale('en');
});

test('bound attributes (accessibility text) are translated and updated', () => {
  resetI18nForTests();
  setLocale('en');
  const i18n = createLocaleBindings();
  const button = createStubElement('button');
  i18n.bindAttribute(button, 'aria-label', 'mainMenu.discordAria');
  assert.equal(button.getAttribute('aria-label'), 'Join the DustWeaver Discord server');
  setLocale('es');
  assert.equal(
    button.getAttribute('aria-label'),
    'Únete al servidor de Discord de DustWeaver',
  );
  i18n.dispose();
  setLocale('en');
});

test('interpolated DOM text updates with the locale, keeping its values', () => {
  resetI18nForTests();
  setLocale('en');
  const i18n = createLocaleBindings();
  const badge = createStubElement('div');
  i18n.bindText(badge, 'mainMenu.build', { number: 567 });
  assert.equal(badge.textContent, 'Build 567');
  setLocale('es');
  assert.equal(badge.textContent, 'Compilación 567');
  i18n.dispose();
  setLocale('en');
});

test('locale presentation sets direction and a glyph-capable font stack', () => {
  resetI18nForTests();
  setLocale('es');
  const container = createStubElement('div');
  applyLocalePresentation(asHtml(container));
  assert.equal(container.getAttribute('dir'), 'ltr');
  assert.ok(container.style.fontFamily.includes('Cinzel'));
  assert.ok(
    container.style.fontFamily.split(',').length > 1,
    'a fallback face must follow the pixel/display font',
  );
  setLocale('en');
});

// ── 10b. Language selector screen ───────────────────────────────────────────

test('the language tab lists native names and applies the choice immediately', () => {
  resetI18nForTests();
  setLocale('en');
  const tabContent = createStubElement('div');
  let captured: { value: string; label: string }[] = [];
  let onChange: ((value: string) => void) | null = null;

  buildLanguageTab(asHtml(tabContent), {
    getLocale,
    setLocale,
    locales: getAvailableLocales(),
    makeLabel: (text) => {
      const el = createStubElement('div');
      el.textContent = text;
      return asHtml(el) as unknown as HTMLDivElement;
    },
    makeStyledDropdown: (options, _current, handler) => {
      captured = options;
      onChange = handler;
      const wrapper = createStubElement('div');
      wrapper.appendChild(createStubElement('select'));
      return asHtml(wrapper) as unknown as HTMLDivElement;
    },
  });

  assert.deepEqual(
    captured.map((o) => o.value).sort(),
    ['en', 'es'],
    'every shipped locale must be offered',
  );
  assert.ok(captured.some((o) => o.label === 'Español'), 'native names are not translated');
  // Heading is translated.
  assert.equal(tabContent.children[0].textContent, 'Language');

  assert.notEqual(onChange, null);
  (onChange as unknown as (v: string) => void)('es');
  assert.equal(getLocale(), 'es', 'selecting a language applies it immediately');
  assert.equal(t('mainMenu.play'), 'Jugar');
  setLocale('en');
});

test('language coverage reporting is honest about partial locales', () => {
  const en = countTranslatedKeys('en');
  const es = countTranslatedKeys('es');
  assert.ok(en > 0);
  assert.ok(es > 0);
  assert.ok(es <= en, 'a partial locale cannot report more coverage than English');
});

// ── 10c. Canvas-rendered text ───────────────────────────────────────────────

/** Fake measure context: every glyph is 6px wide. Deterministic. */
function fakeCtx(): TextMeasureContext {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * 6 }),
  };
}

test('canvas HUD text is translated and switches at runtime', () => {
  resetI18nForTests();
  setLocale('en');
  const ctx = fakeCtx();
  const english = tCanvas(ctx, 'hud.controlHintKeyboard');
  assert.ok(english.includes('walk'));
  setLocale('es');
  const spanish = tCanvas(ctx, 'hud.controlHintKeyboard');
  assert.ok(spanish.includes('andar'));
  assert.notEqual(spanish, english);
  setLocale('en');
});

test('canvas font strings carry the locale fallback stack at integer sizes', () => {
  resetI18nForTests();
  setLocale('es');
  const font = localizedCanvasFont(12.4);
  assert.ok(font.startsWith('12px '), `expected a rounded integer size, got: ${font}`);
  assert.ok(font.includes('Cinzel'));
  assert.ok(font.split(',').length > 1, 'fallback faces must be present for accented glyphs');
  assert.equal(localizedCanvasFont(10, '700').startsWith('700 10px '), true);
  setLocale('en');
});

test('long translations truncate instead of overflowing the canvas', () => {
  const ctx = fakeCtx();
  const text = 'A very long localized control hint that will not fit';
  const out = truncateToWidth(ctx, text, 60);
  assert.ok(out.length * 6 <= 60, 'truncated text must fit the budget');
  assert.ok(out.endsWith('…'));
  assert.equal(truncateToWidth(ctx, 'short', 600), 'short', 'fitting text is untouched');
  assert.equal(truncateToWidth(ctx, 'anything', 0), '');
});

test('accented and non-Latin text wraps without dropping content', () => {
  const ctx = fakeCtx();
  const lines = wrapToWidth(ctx, 'Cámara siempre centrada 日本語 テキスト', 60);
  assert.ok(lines.length > 1);
  for (const line of lines) {
    assert.ok(line.length * 6 <= 60, `line overflows: ${line}`);
  }
  assert.ok(lines.join(' ').includes('Cámara'));
  assert.ok(lines.join(' ').includes('日本語'));
});

test('an unbreakably long word is truncated rather than overflowing', () => {
  const ctx = fakeCtx();
  const lines = wrapToWidth(ctx, 'Donaudampfschifffahrtsgesellschaftskapitaen', 30);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].length * 6 <= 30);
});

test('logical text anchors resolve to integer pixel positions (crisp pixel art)', () => {
  resetI18nForTests();
  setLocale('en');
  const start = resolveTextAnchor('start', 10.4, 100.6);
  assert.deepEqual(start, { xPx: 10, textAlign: 'left' });
  const end = resolveTextAnchor('end', 10.4, 100.6);
  assert.deepEqual(end, { xPx: 101, textAlign: 'right' });
  const center = resolveTextAnchor('center', 10, 100);
  assert.deepEqual(center, { xPx: 55, textAlign: 'center' });
  assert.ok(Number.isInteger(center.xPx), 'non-integer positions blur nearest-neighbour text');
});
