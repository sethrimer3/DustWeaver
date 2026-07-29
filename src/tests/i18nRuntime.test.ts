/**
 * Core i18n runtime coverage: catalog completeness, non-English lookup,
 * per-key + whole-locale fallback, interpolation, plurals, runtime switching,
 * and the subscription mechanism that lets mounted UI update without a restart.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  _data: new Map<string, string>(),
  getItem(key: string) { return this._data.has(key) ? this._data.get(key)! : null; },
  setItem(key: string, value: string) { this._data.set(key, value); },
  removeItem(key: string) { this._data.delete(key); },
} as unknown as Storage;

import {
  ALL_TRANSLATION_KEYS,
  EN_CATALOG,
  ES_CATALOG,
  ES_INTENTIONALLY_UNTRANSLATED,
  clearStoredLocale,
  getLocale,
  getTextDirection,
  getUiFontFamily,
  humanizeMissingKey,
  interpolate,
  resetI18nForTests,
  selectPluralCategory,
  setLocale,
  subscribeToLocaleChange,
  t,
  tDynamic,
  tPlural,
  type CatalogEntry,
  type TranslationKey,
} from '../i18n';

function freshEnglish(): void {
  resetI18nForTests();
  clearStoredLocale();
  setLocale('en');
}

// ── 1. English catalog completeness ─────────────────────────────────────────

test('english catalog has a non-empty entry for every declared key', () => {
  assert.ok(ALL_TRANSLATION_KEYS.length > 50, 'expected a substantial catalog');
  for (const key of ALL_TRANSLATION_KEYS) {
    const entry: CatalogEntry = EN_CATALOG[key];
    if (typeof entry === 'string') {
      assert.ok(entry.trim().length > 0, `empty english string for ${key}`);
    } else {
      assert.equal(typeof entry.other, 'string', `plural entry ${key} missing "other"`);
      assert.ok(entry.other.trim().length > 0, `empty plural "other" for ${key}`);
    }
  }
});

test('english catalog keys are dotted, lowercase-first, and unique', () => {
  const seen = new Set<string>();
  for (const key of ALL_TRANSLATION_KEYS) {
    assert.ok(/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(key), `malformed key: ${key}`);
    assert.ok(!seen.has(key), `duplicate key: ${key}`);
    seen.add(key);
  }
});

// ── 2. Non-English catalog lookup ───────────────────────────────────────────

test('spanish lookup returns spanish text, including accents and unicode', () => {
  freshEnglish();
  assert.equal(t('mainMenu.play'), 'Play');
  setLocale('es');
  assert.equal(t('mainMenu.play'), 'Jugar');
  assert.equal(t('common.back'), 'Atrás');
  // Unicode / punctuation survives intact.
  assert.ok(t('assistMode.note').includes('«Asistida»'));
  freshEnglish();
});

// ── 3. Missing / invalid locale falls back safely ───────────────────────────

test('unknown or malformed locale ids fall back to english without throwing', () => {
  freshEnglish();
  for (const bogus of ['klingon', '', '   ', 'zz-ZZ', '12345', 'e']) {
    const applied = setLocale(bogus);
    assert.equal(applied, 'en', `expected english fallback for "${bogus}"`);
    assert.equal(t('mainMenu.play'), 'Play');
  }
  freshEnglish();
});

test('bcp-47 regional tags resolve to their base locale', () => {
  freshEnglish();
  assert.equal(setLocale('es-419'), 'es');
  assert.equal(t('mainMenu.play'), 'Jugar');
  assert.equal(setLocale('en_GB'), 'en');
  freshEnglish();
});

// ── 4. Missing-key fallback never exposes a raw key ─────────────────────────

test('a key missing from spanish falls back to the english string, per key', () => {
  freshEnglish();
  setLocale('es');
  // Deliberately untranslated (proper noun) — must show the English source, not a key.
  assert.equal(t('mainMenu.title'), 'DustWeaver');
  // Neighbouring keys are still Spanish: fallback is per key, not per catalog.
  assert.equal(t('mainMenu.play'), 'Jugar');
  freshEnglish();
});

test('a key missing everywhere is humanized, never rendered as a raw dotted key', () => {
  const result = tDynamic('totally.missing.someMissingLabel');
  assert.equal(result, null, 'dynamic lookup reports unknown keys instead of guessing');
  const humanized = humanizeMissingKey('totally.missing.someMissingLabel');
  assert.equal(humanized, 'Some Missing Label');
  assert.ok(!humanized.includes('.'), 'humanized text must not contain the raw key');
  assert.ok(humanized.length > 0);
});

test('every translated string is non-empty and leaks no raw keys in either locale', () => {
  for (const locale of ['en', 'es'] as const) {
    freshEnglish();
    setLocale(locale);
    for (const key of ALL_TRANSLATION_KEYS) {
      const value = t(key, { count: 2, number: 1, value: 'x', name: 'x', state: 'x',
        hours: 1, minutes: 1, zone: 1, built: 1, total: 1, translated: 1,
        level: 1, creator: 'x', title: 'x', errors: 'x', error: 'x' });
      assert.ok(value.length > 0, `empty render for ${key} in ${locale}`);
      assert.notEqual(value, key, `raw key leaked for ${key} in ${locale}`);
    }
  }
  freshEnglish();
});

// ── 5. Interpolation ────────────────────────────────────────────────────────

test('interpolation substitutes named placeholders', () => {
  freshEnglish();
  assert.equal(t('mainMenu.build', { number: 566 }), 'Build 566');
  assert.equal(t('saveSlots.slotLabel', { number: 2 }), 'Save Slot 2');
  assert.equal(
    t('loading.zoneProgress', { zone: 1, built: 3, total: 12 }),
    'Loading zone 1: 3 / 12',
  );
});

test('interpolation is locale-independent and works in spanish too', () => {
  freshEnglish();
  setLocale('es');
  assert.equal(t('saveSlots.slotLabel', { number: 3 }), 'Partida 3');
  freshEnglish();
});

test('unknown placeholders are left verbatim and never throw', () => {
  assert.equal(interpolate('Hello {who}', {}), 'Hello {who}');
  assert.equal(interpolate('Hello {who}', { other: 1 }), 'Hello {who}');
  assert.equal(interpolate('100{{pct}}', {}), '100{pct}');
  assert.equal(interpolate('plain text'), 'plain text');
});

// ── 6. Singular / plural selection ──────────────────────────────────────────

test('plural rules select singular for 1 and plural otherwise', () => {
  assert.equal(selectPluralCategory('en', 1), 'one');
  assert.equal(selectPluralCategory('en', 0), 'other');
  assert.equal(selectPluralCategory('en', 2), 'other');
  assert.equal(selectPluralCategory('es', 1), 'one');
  assert.equal(selectPluralCategory('es', 7), 'other');
  assert.equal(selectPluralCategory('en', Number.NaN), 'other');
});

test('plural catalog entries render the right form with the count interpolated', () => {
  freshEnglish();
  // worldMap.subtitle is a real in-UI plural (dust slot count on the zone map).
  assert.equal(tPlural('worldMap.subtitle', 1, { level: 3 }), 'Player Level 3  |  1 dust slot');
  assert.equal(tPlural('worldMap.subtitle', 0, { level: 3 }), 'Player Level 3  |  0 dust slots');
  assert.equal(tPlural('worldMap.subtitle', 5, { level: 3 }), 'Player Level 3  |  5 dust slots');
  setLocale('es');
  assert.equal(tPlural('worldMap.subtitle', 1, { level: 3 }), 'Nivel de jugador 3  |  1 ranura de polvo');
  assert.equal(tPlural('worldMap.subtitle', 4, { level: 3 }), 'Nivel de jugador 3  |  4 ranuras de polvo');
  freshEnglish();
});

test('plural selection is deterministic across repeated calls', () => {
  freshEnglish();
  const first = tPlural('worldMap.subtitle', 3, { level: 1 });
  for (let i = 0; i < 25; i++) {
    assert.equal(tPlural('worldMap.subtitle', 3, { level: 1 }), first);
  }
});

// ── 7. Runtime switching + subscription ─────────────────────────────────────

test('subscribers are notified synchronously so mounted UI updates immediately', () => {
  freshEnglish();
  const seen: string[] = [];
  const unsubscribe = subscribeToLocaleChange((locale) => { seen.push(locale); });
  setLocale('es');
  assert.deepEqual(seen, ['es'], 'listener must fire before setLocale returns');
  setLocale('es'); // no-op, same locale
  assert.deepEqual(seen, ['es']);
  setLocale('en');
  assert.deepEqual(seen, ['es', 'en']);
  unsubscribe();
  setLocale('es');
  assert.deepEqual(seen, ['es', 'en'], 'unsubscribed listener must not fire');
  freshEnglish();
});

test('getLocale reflects the switch and text direction stays defined', () => {
  freshEnglish();
  assert.equal(getLocale(), 'en');
  setLocale('es');
  assert.equal(getLocale(), 'es');
  assert.equal(getTextDirection(), 'ltr');
  assert.ok(getUiFontFamily().length > 0);
  freshEnglish();
});

// ── 12. Catalog parity guard ────────────────────────────────────────────────

test('spanish catalog contains no keys that are unknown to english', () => {
  for (const key of Object.keys(ES_CATALOG)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(EN_CATALOG, key),
      `spanish catalog has an unknown key: ${key}`,
    );
  }
});

test('spanish catalog covers every english key, or declares it intentionally shared', () => {
  const intentional = new Set<string>(ES_INTENTIONALLY_UNTRANSLATED);
  const missing: string[] = [];
  for (const key of ALL_TRANSLATION_KEYS) {
    if (ES_CATALOG[key] !== undefined) continue;
    if (intentional.has(key)) continue;
    missing.push(key);
  }
  assert.deepEqual(missing, [], `spanish catalog is missing keys: ${missing.join(', ')}`);
});

test('intentionally-untranslated declarations must name real keys', () => {
  for (const key of ES_INTENTIONALLY_UNTRANSLATED) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(EN_CATALOG, key),
      `unknown key declared intentionally untranslated: ${key}`,
    );
    assert.equal(
      ES_CATALOG[key as TranslationKey],
      undefined,
      `${key} is declared untranslated but also present in the spanish catalog`,
    );
  }
});

test('plural entries keep matching plural shape across locales', () => {
  for (const key of ALL_TRANSLATION_KEYS) {
    const en: CatalogEntry = EN_CATALOG[key];
    const es = ES_CATALOG[key];
    if (es === undefined) continue;
    assert.equal(
      typeof en === 'string',
      typeof es === 'string',
      `plural/simple shape mismatch for ${key}`,
    );
  }
});

test('translations preserve every placeholder used by the english source', () => {
  const placeholders = (entry: CatalogEntry): Set<string> => {
    const text = typeof entry === 'string'
      ? entry
      : [entry.zero, entry.one, entry.two, entry.few, entry.many, entry.other]
        .filter((s): s is string => s !== undefined).join(' ');
    const found = new Set<string>();
    for (const match of text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) found.add(match[1]);
    return found;
  };
  for (const key of ALL_TRANSLATION_KEYS) {
    const es = ES_CATALOG[key];
    if (es === undefined) continue;
    const expected = placeholders(EN_CATALOG[key]);
    const actual = placeholders(es);
    for (const name of expected) {
      assert.ok(actual.has(name), `spanish ${key} dropped placeholder {${name}}`);
    }
    for (const name of actual) {
      assert.ok(expected.has(name), `spanish ${key} invented placeholder {${name}}`);
    }
  }
});
