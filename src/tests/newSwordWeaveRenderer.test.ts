import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceSwordShieldTransitionSmoothing,
  NewSwordWeaveRenderer,
} from '../render/effects/newSwordWeaveRenderer';

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

test('renderer reset() clears stale smoothed transition/interpolation state back to fresh-load defaults', () => {
  const renderer = new NewSwordWeaveRenderer();
  // Drive the private smoothing state far from its default via the public
  // advance function used internally, then poke it in through the same
  // shape render() would leave it in after a near-complete transition.
  const rendererAny = renderer as unknown as { _smoothedTransition01: number; _prevActiveFlag: 0 | 1 };
  rendererAny._smoothedTransition01 = 0.97;
  rendererAny._prevActiveFlag = 1;

  renderer.reset();

  assert.equal(rendererAny._smoothedTransition01, 0, 'smoothed transition must reset to 0, not carry stale progress into a fresh room');
  assert.equal(rendererAny._prevActiveFlag, 0, 'prev-active-flag baseline must reset so the next swipe starts a clean transition');
});
