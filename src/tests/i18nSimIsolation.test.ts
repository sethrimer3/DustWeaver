/**
 * Locale must never leak into gameplay.
 *
 * Guards that switching language leaves save-slot payloads, deterministic
 * hashes, and simulation-facing helpers byte-identical, and that no gameplay
 * key is written by the language preference.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem(key: string) { return store.has(key) ? store.get(key)! : null; },
  setItem(key: string, value: string) { store.set(key, value); },
  removeItem(key: string) { store.delete(key); },
} as unknown as Storage;

import { LOCALE_STORAGE_KEY, resetI18nForTests, setLocale } from '../i18n';
import { createNewSaveSlot, loadSaveSlot, saveSaveSlot, formatRunTimer } from '../progression/saveSlots';
import { hashString } from '../utils/deterministicHash';

test('save-slot payloads are byte-identical across locales', () => {
  resetI18nForTests();
  setLocale('en');
  const english = createNewSaveSlot(false);
  english.lastPlayedIso = '2026-07-29T00:00:00.000Z';
  english.playTimeMs = 3_723_000;

  setLocale('es');
  const spanish = createNewSaveSlot(false);
  spanish.lastPlayedIso = '2026-07-29T00:00:00.000Z';
  spanish.playTimeMs = 3_723_000;

  assert.equal(JSON.stringify(spanish), JSON.stringify(english));
  assert.equal(hashString(JSON.stringify(spanish)), hashString(JSON.stringify(english)));
});

test('round-tripping a save through storage is unaffected by the active locale', () => {
  resetI18nForTests();
  setLocale('en');
  const data = createNewSaveSlot(true);
  data.playTimeMs = 12_345;
  saveSaveSlot(0, data);
  const loadedEnglish = loadSaveSlot(0);

  setLocale('es');
  const loadedSpanish = loadSaveSlot(0);

  assert.notEqual(loadedEnglish, null);
  assert.deepEqual(loadedSpanish, loadedEnglish);
  assert.equal(
    hashString(JSON.stringify(loadedSpanish)),
    hashString(JSON.stringify(loadedEnglish)),
  );
});

test('the speedrun timer format stays locale-independent', () => {
  // Run timers are compared and submitted, so they must NOT be localized.
  resetI18nForTests();
  setLocale('en');
  const english = formatRunTimer(3_723_456);
  setLocale('es');
  assert.equal(formatRunTimer(3_723_456), english);
});

test('deterministic hashes of the same input are identical in every locale', () => {
  const sample = 'room:zone1/keep-01|seed:12345|tiles:aabbcc';
  resetI18nForTests();
  setLocale('en');
  const english = hashString(sample);
  setLocale('es');
  assert.equal(hashString(sample), english);
  setLocale('en');
  assert.equal(hashString(sample), english);
});

test('switching language writes only the locale preference key', () => {
  store.clear();
  resetI18nForTests();
  setLocale('es');
  setLocale('en');
  setLocale('es');
  assert.deepEqual([...store.keys()], [LOCALE_STORAGE_KEY]);
});

test('save data never carries a locale field', () => {
  resetI18nForTests();
  setLocale('es');
  const data = createNewSaveSlot(false);
  const serialized = JSON.stringify(data);
  for (const marker of ['locale', 'language', '"es"', 'lang']) {
    assert.ok(!serialized.includes(marker), `save payload leaked ${marker}`);
  }
});
