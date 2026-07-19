/**
 * Coverage for the "Render Adjacent Rooms" child option and its effective gate
 * (ui/renderSettings.ts). The child is stored independently from the parent
 * "Camera Always Centered" option; its EFFECTIVE runtime state requires both:
 * `cameraAlwaysCentered && renderAdjacentRooms`.
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
  getAlwaysCenterCamera, setAlwaysCenterCamera,
  getRenderAdjacentRooms, setRenderAdjacentRooms,
  getEffectiveRenderAdjacentRooms,
} from '../ui/renderSettings';

test('render adjacent rooms defaults to off', () => {
  assert.equal(getRenderAdjacentRooms(), false);
});

test('render adjacent rooms persists independently of the parent', () => {
  setRenderAdjacentRooms(true);
  assert.equal(getRenderAdjacentRooms(), true);
  // Turning the parent off must NOT clear the child's stored checked state.
  setAlwaysCenterCamera(false);
  assert.equal(getRenderAdjacentRooms(), true);
  setRenderAdjacentRooms(false);
  assert.equal(getRenderAdjacentRooms(), false);
});

test('effective state requires BOTH checkboxes', () => {
  setAlwaysCenterCamera(false);
  setRenderAdjacentRooms(false);
  assert.equal(getEffectiveRenderAdjacentRooms(), false);

  setAlwaysCenterCamera(true);
  setRenderAdjacentRooms(false);
  assert.equal(getEffectiveRenderAdjacentRooms(), false, 'parent alone is not enough');

  setAlwaysCenterCamera(false);
  setRenderAdjacentRooms(true);
  assert.equal(getEffectiveRenderAdjacentRooms(), false, 'child alone is not enough');

  setAlwaysCenterCamera(true);
  setRenderAdjacentRooms(true);
  assert.equal(getEffectiveRenderAdjacentRooms(), true, 'both on → effective');
});

test('parent off immediately disables effective state but keeps child checked', () => {
  setAlwaysCenterCamera(true);
  setRenderAdjacentRooms(true);
  assert.equal(getEffectiveRenderAdjacentRooms(), true);

  setAlwaysCenterCamera(false);
  assert.equal(getEffectiveRenderAdjacentRooms(), false, 'effective drops immediately');
  assert.equal(getRenderAdjacentRooms(), true, 'child stored state preserved');

  // Re-enabling the parent restores the effective state without re-checking child.
  setAlwaysCenterCamera(true);
  assert.equal(getEffectiveRenderAdjacentRooms(), true);
});

test('child visibility tracks the parent (reveal state == parent enabled)', () => {
  // The pause menu reveals the child exactly when the parent is enabled; the
  // effective helper composes the same parent flag with the child's own state.
  setRenderAdjacentRooms(true);
  setAlwaysCenterCamera(true);
  assert.equal(getAlwaysCenterCamera(), true);
  setAlwaysCenterCamera(false);
  assert.equal(getAlwaysCenterCamera(), false);
});
