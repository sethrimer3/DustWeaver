import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRectShadowOccluderPx, type ShadowCasterOccluderPx } from '../render/effects/shadowCaster';

function emptyShadow(): ShadowCasterOccluderPx {
  return { baseAx: 0, baseAy: 0, baseBx: 0, baseBy: 0, tipAx: 0, tipAy: 0, tipBx: 0, tipBy: 0 };
}

function approx(actual: number, expected: number, epsilon = 0.0001): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} ~= ${expected}`);
}

test('rectangle shadow projects each silhouette corner away from the point light', () => {
  const shadow = emptyShadow();
  const ok = buildRectShadowOccluderPx(
    10, 0,
    2, 1,
    0, 0,
    10,
    shadow,
  );

  assert.equal(ok, true);

  // From a light directly left of the rectangle, the tangent/silhouette points
  // are the left top and left bottom corners. They form the near edge.
  approx(shadow.baseAx, 8);
  approx(shadow.baseBx, 8);
  assert.deepEqual([shadow.baseAy, shadow.baseBy].sort((a, b) => a - b), [-1, 1]);

  // Each far point is projected from its own silhouette point along its own
  // light-to-corner ray, so the far edge expands instead of collapsing inward.
  const expectedTopScale = 10 / Math.sqrt(8 * 8 + 1 * 1);
  const expectedFarX = 8 + 8 * expectedTopScale;
  approx(shadow.tipAx, expectedFarX);
  approx(shadow.tipBx, expectedFarX);
  assert.deepEqual(
    [shadow.tipAy, shadow.tipBy].sort((a, b) => a - b).map((value) => Number(value.toFixed(4))),
    [
      Number((-1 - expectedTopScale).toFixed(4)),
      Number((1 + expectedTopScale).toFixed(4)),
    ],
  );

  const nearWidth = Math.hypot(shadow.baseAx - shadow.baseBx, shadow.baseAy - shadow.baseBy);
  const farWidth = Math.hypot(shadow.tipAx - shadow.tipBx, shadow.tipAy - shadow.tipBy);
  assert.ok(farWidth > nearWidth, `expected far width ${farWidth} to exceed near width ${nearWidth}`);
});

test('rectangle shadow skips point lights inside the caster', () => {
  const shadow = emptyShadow();
  assert.equal(buildRectShadowOccluderPx(10, 10, 2, 2, 10, 10, 12, shadow), false);
});
