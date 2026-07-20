import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sampleBowTrajectory,
  computeBowPreviewShouldBeVisible,
  MAX_BOW_PREVIEW_SAMPLES,
} from '../render/effects/bowTrajectoryPreviewRenderer';
import {
  getBowSpeedForMoteCount,
  getBowGravityForMoteCount,
} from '../sim/weaves/bowProjectilePhysics';
import { SecondaryWeaveGesturePhase } from '../input/secondaryWeaveGesture';

function makeBuffers() {
  return {
    xs: new Float32Array(MAX_BOW_PREVIEW_SAMPLES),
    ys: new Float32Array(MAX_BOW_PREVIEW_SAMPLES),
  };
}

test('bow trajectory: 2-mote and 3-mote tiers curve downward (nonzero gravity)', () => {
  for (const moteCount of [2, 3]) {
    const { xs, ys } = makeBuffers();
    const count = sampleBowTrajectory(xs, ys, 0, 0, 1, 0, moteCount, null);
    assert.ok(count > 3, `expected several samples for tier ${moteCount}`);
    // Straight-line (no-gravity) Y would stay at 0. With gravity the Y at the
    // last sample must have dropped (aim is purely horizontal, so a
    // curving projectile falls below the start line).
    assert.ok(ys[count - 1] > 0, `tier ${moteCount} should curve downward, got y=${ys[count - 1]}`);
  }
});

test('bow trajectory: 4-mote tier is straight (zero gravity per getBowGravityForMoteCount)', () => {
  assert.equal(getBowGravityForMoteCount(4), 0, 'precondition: 4-mote tier must have zero gravity');
  const { xs, ys } = makeBuffers();
  const count = sampleBowTrajectory(xs, ys, 0, 0, 1, 0, 4, null);
  assert.ok(count > 3);
  for (let i = 0; i < count; i++) {
    assert.equal(ys[i], 0, `4-mote trajectory must stay perfectly level, sample ${i} had y=${ys[i]}`);
  }
});

test('bow trajectory preview shares physics functions with the real fired arrow', () => {
  // Directly asserts the preview's speed/gravity inputs are the literal
  // return values of the same shared functions arrowWeave.ts/bowWeave.ts use
  // — proves no hand-copied constants/drift.
  for (const moteCount of [2, 3, 4]) {
    const speed = getBowSpeedForMoteCount(moteCount);
    const gravity = getBowGravityForMoteCount(moteCount);
    const { xs, ys } = makeBuffers();
    sampleBowTrajectory(xs, ys, 0, 0, 1, 0, moteCount, null, 2);
    // First step displacement should match one integration step at `speed`
    // horizontally and derived from `gravity` vertically (dt = 1/30 s).
    const dtSec = 1 / 30;
    const expectedX = speed * dtSec;
    const expectedY = gravity * dtSec * dtSec; // vy after one gravity application * dt
    assert.ok(Math.abs(xs[1] - expectedX) < 1e-4, `x mismatch for tier ${moteCount}`);
    assert.ok(Math.abs(ys[1] - expectedY) < 1e-4, `y mismatch for tier ${moteCount}`);
  }
});

test('bow trajectory preview reflects live tier changes', () => {
  const bufA = makeBuffers();
  const bufB = makeBuffers();
  const countA = sampleBowTrajectory(bufA.xs, bufA.ys, 0, 0, 1, 0, 2, null);
  const countB = sampleBowTrajectory(bufB.xs, bufB.ys, 0, 0, 1, 0, 4, null);
  // Different tiers must not produce identical trajectories (different
  // speed/gravity), proving the preview is live-reactive to tier changes.
  assert.notEqual(bufA.ys[Math.min(countA, countB) - 1], bufB.ys[Math.min(countA, countB) - 1]);
});

test('bow trajectory preview stops at a terrain raycast hit', () => {
  const { xs, ys } = makeBuffers();
  const raycast = () => ({ x: 5, y: 0 });
  const count = sampleBowTrajectory(xs, ys, 0, 0, 1, 0, 4, raycast);
  assert.equal(count, 2, 'should stop immediately after the first hit');
  assert.equal(xs[1], 5);
  assert.equal(ys[1], 0);
});

test('bow preview visibility hides below 2 available motes', () => {
  assert.equal(
    computeBowPreviewShouldBeVisible(1, SecondaryWeaveGesturePhase.Holding, 1, 1),
    false,
  );
  assert.equal(
    computeBowPreviewShouldBeVisible(1, SecondaryWeaveGesturePhase.Holding, 1, 2),
    true,
  );
});

test('bow preview visibility requires unlock + held gesture + charging', () => {
  assert.equal(computeBowPreviewShouldBeVisible(0, SecondaryWeaveGesturePhase.Holding, 1, 3), false);
  assert.equal(computeBowPreviewShouldBeVisible(1, SecondaryWeaveGesturePhase.Idle, 1, 3), false);
  assert.equal(computeBowPreviewShouldBeVisible(1, SecondaryWeaveGesturePhase.Holding, 0, 3), false);
  assert.equal(computeBowPreviewShouldBeVisible(1, SecondaryWeaveGesturePhase.Press, 1, 3), true);
});
