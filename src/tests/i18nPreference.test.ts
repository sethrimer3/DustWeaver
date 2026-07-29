/**
 * Language-preference persistence, legacy-format migration, and first-launch
 * platform-locale detection.
 *
 * Also pins the boundary that matters most: the language preference lives in
 * its own localStorage key and is never mixed into save-slot data.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem(key: string) { return store.has(key) ? store.get(key)! : null; },
  setItem(key: string, value: string) { store.set(key, value); },
  removeItem(key: string) { store.delete(key); },
  clear() { store.clear(); },
} as unknown as Storage;

import {
  LEGACY_LOCALE_STORAGE_KEY,
  LOCALE_STORAGE_KEY,
  clearStoredLocale,
  detectPlatformLocale,
  initI18n,
  loadStoredLocale,
  resetI18nForTests,
  saveStoredLocale,
  setLocale,
  t,
} from '../i18n';

function freshBoot(): void {
  store.clear();
  resetI18nForTests();
}

// ── 8. Persistence and restoration ──────────────────────────────────────────

test('choosing a language writes exactly one dedicated storage key', () => {
  freshBoot();
  initI18n(['en-US']);
  setLocale('es');
  assert.deepEqual([...store.keys()], [LOCALE_STORAGE_KEY]);
  assert.equal(store.get(LOCALE_STORAGE_KEY), 'es');
});

test('the stored language is restored on the next launch', () => {
  freshBoot();
  initI18n(['en-US']);
  setLocale('es');
  assert.equal(t('mainMenu.play'), 'Jugar');

  // Simulate an app restart: fresh runtime, same storage.
  resetI18nForTests();
  assert.equal(initI18n(['en-US']), 'es', 'stored preference must beat platform locale');
  assert.equal(t('mainMenu.play'), 'Jugar');
});

test('a stored locale this build no longer ships falls back to detection', () => {
  freshBoot();
  store.set(LOCALE_STORAGE_KEY, 'klingon');
  assert.equal(loadStoredLocale(), null);
  assert.equal(initI18n(['es-ES']), 'es');
});

test('setLocale can opt out of persisting (preview without committing)', () => {
  freshBoot();
  initI18n(['en-US']);
  setLocale('es', { persist: false });
  assert.equal(store.has(LOCALE_STORAGE_KEY), false);
  assert.equal(t('mainMenu.play'), 'Jugar');
  setLocale('en');
});

test('clearStoredLocale removes the preference entirely', () => {
  freshBoot();
  saveStoredLocale('es');
  assert.equal(loadStoredLocale(), 'es');
  clearStoredLocale();
  assert.equal(loadStoredLocale(), null);
});

// ── Backward-compatible migration of the old preference format ──────────────

test('a legacy raw BCP-47 preference migrates forward and is removed', () => {
  freshBoot();
  store.set(LEGACY_LOCALE_STORAGE_KEY, 'es-MX');
  assert.equal(loadStoredLocale(), 'es');
  assert.equal(store.get(LOCALE_STORAGE_KEY), 'es');
  assert.equal(store.has(LEGACY_LOCALE_STORAGE_KEY), false);
});

test('a legacy JSON preference blob migrates forward', () => {
  freshBoot();
  store.set(LEGACY_LOCALE_STORAGE_KEY, JSON.stringify({ language: 'es', volume: 0.5 }));
  assert.equal(loadStoredLocale(), 'es');
  assert.equal(store.get(LOCALE_STORAGE_KEY), 'es');
});

test('an unusable legacy value is discarded without throwing', () => {
  freshBoot();
  store.set(LEGACY_LOCALE_STORAGE_KEY, '{{not json');
  assert.equal(loadStoredLocale(), null);
  assert.equal(store.has(LEGACY_LOCALE_STORAGE_KEY), false);
});

// ── 9. Platform-locale first-launch selection ───────────────────────────────

test('first launch adopts the platform locale when nothing is stored', () => {
  freshBoot();
  assert.equal(initI18n(['es-ES', 'en-US']), 'es');
  assert.equal(t('mainMenu.play'), 'Jugar');
});

test('first launch falls back to english for unsupported platform locales', () => {
  freshBoot();
  assert.equal(initI18n(['ja-JP', 'ko-KR']), 'en');
  freshBoot();
  assert.equal(initI18n([]), 'en');
  freshBoot();
  assert.equal(initI18n(), 'en', 'no navigator in Node must not throw');
});

test('detectPlatformLocale scans the whole preference list in order', () => {
  assert.equal(detectPlatformLocale(['ja', 'es-419', 'en']), 'es');
  assert.equal(detectPlatformLocale(['en-GB', 'es']), 'en');
  assert.equal(detectPlatformLocale(['zz']), 'en');
});

test('platform detection never overrides an explicit stored choice', () => {
  freshBoot();
  saveStoredLocale('en');
  assert.equal(initI18n(['es-ES']), 'en');
});

// ── 11 (part). Preference isolation from save data ──────────────────────────

test('language storage does not collide with the save-slot key namespace', () => {
  freshBoot();
  saveStoredLocale('es');
  for (const key of store.keys()) {
    assert.ok(!key.includes('save'), `locale preference key looks save-related: ${key}`);
    assert.ok(!key.includes('slot'), `locale preference key looks slot-related: ${key}`);
    assert.ok(!key.includes('campaign'), `locale preference key looks campaign-related: ${key}`);
  }
});
