/**
 * Coverage for debug panel visibility state management in debugPanelManager.ts,
 * specifically covering prewarm panel visibility toggles and persistence.
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
  debugPanelVisibility,
  toggleDebugPanel,
  setDebugPanelVisible,
  isPanelVisible,
  hideAllDebugPanels,
} from '../ui/debugPanelManager';

test('prewarm debug panel defaults to off', () => {
  assert.equal(debugPanelVisibility.prewarm, false);
  assert.equal(isPanelVisible('prewarm', debugPanelVisibility), false);
});

test('setDebugPanelVisible toggles prewarm visibility independently and persists state', () => {
  setDebugPanelVisible('prewarm', true);
  assert.equal(debugPanelVisibility.prewarm, true);
  assert.equal(isPanelVisible('prewarm', debugPanelVisibility), true);

  setDebugPanelVisible('prewarm', false);
  assert.equal(debugPanelVisibility.prewarm, false);
  assert.equal(isPanelVisible('prewarm', debugPanelVisibility), false);
});

test('toggleDebugPanel flips prewarm visibility', () => {
  setDebugPanelVisible('prewarm', false);
  toggleDebugPanel('prewarm');
  assert.equal(debugPanelVisibility.prewarm, true);
  toggleDebugPanel('prewarm');
  assert.equal(debugPanelVisibility.prewarm, false);
});

test('hideAllDebugPanels resets prewarm to false', () => {
  setDebugPanelVisible('prewarm', true);
  hideAllDebugPanels();
  assert.equal(debugPanelVisibility.prewarm, false);
});
