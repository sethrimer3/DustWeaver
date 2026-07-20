import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceSwordShieldTransitionSmoothing } from '../render/effects/newSwordWeaveRenderer';

test('sword-to-shield transition smoothing is monotonic toward an increasing target', () => {
  let v = 0;
  let prev = -1;
  for (let i = 0; i < 40; i++) {
    v = advanceSwordShieldTransitionSmoothing(v, 1);
    assert.ok(v >= prev, `expected monotonic increase, step ${i}: prev=${prev} v=${v}`);
    prev = v;
  }
  assert.ok(v > 0.99, `expected convergence near 1, got ${v}`);
});

test('sword-to-shield transition smoothing is monotonic toward a decreasing target', () => {
  let v = 1;
  let prev = 2;
  for (let i = 0; i < 40; i++) {
    v = advanceSwordShieldTransitionSmoothing(v, 0);
    assert.ok(v <= prev, `expected monotonic decrease, step ${i}: prev=${prev} v=${v}`);
    prev = v;
  }
  assert.ok(v < 0.01, `expected convergence near 0, got ${v}`);
});

test('sword-to-shield transition smoothing clamps to [0, 1] even for out-of-range inputs', () => {
  assert.equal(advanceSwordShieldTransitionSmoothing(0, 5), advanceSwordShieldTransitionSmoothing(0, 1));
  assert.equal(advanceSwordShieldTransitionSmoothing(0, -5), advanceSwordShieldTransitionSmoothing(0, 0));
  const clampedHigh = advanceSwordShieldTransitionSmoothing(2, 1);
  assert.ok(clampedHigh <= 1 && clampedHigh >= 0);
});

test('sword-to-shield transition smoothing reaches target exactly with rate = 1', () => {
  assert.equal(advanceSwordShieldTransitionSmoothing(0, 1, 1), 1);
  assert.equal(advanceSwordShieldTransitionSmoothing(1, 0, 1), 0);
});
