/**
 * Coverage for the "Air Currents" debug overlay toggle
 * (ui/renderSettings.ts getAirCurrentsDebugEnabled/setAirCurrentsDebugEnabled).
 *
 * The overlay itself is only ever rendered when BOTH the shared game debug
 * mode AND this independent toggle are on (see gameRender.ts's
 * `if (isDebugMode && getAirCurrentsDebugEnabled())` gate) — this suite
 * covers the toggle's own state management: defaults off, persists via the
 * same localStorage convention as the other debug/gameplay toggles, and is
 * independent of other settings.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  _data: new Map<string, string>(),
  getItem(key: string) { return this._data.has(key) ? this._data.get(key)! : null; },
  setItem(key: string, value: string) { this._data.set(key, value); },
  removeItem(key: string) { this._data.delete(key); },
} as unknown as Storage;

import { getAirCurrentsDebugEnabled, setAirCurrentsDebugEnabled } from '../ui/renderSettings';

test('air currents overlay defaults to off', () => {
  assert.equal(getAirCurrentsDebugEnabled(), false);
});

test('toggle persists on/off state independently', () => {
  setAirCurrentsDebugEnabled(true);
  assert.equal(getAirCurrentsDebugEnabled(), true);
  setAirCurrentsDebugEnabled(false);
  assert.equal(getAirCurrentsDebugEnabled(), false);
});
