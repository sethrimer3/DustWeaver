import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStraightBowAimEnd,
  computeBowPreviewShouldBeVisible,
  BowTrajectoryPreviewRenderer,
  BOW_PREVIEW_MAX_RANGE_WORLD,
} from '../render/effects/bowTrajectoryPreviewRenderer';
import { SecondaryWeaveGesturePhase } from '../input/secondaryWeaveGesture';
import { BOW_ARROW_PHASE_ASSEMBLING, BOW_ARROW_PHASE_NONE, BOW_ARROW_PHASE_OUTBOUND } from '../sim/weaves/bowArrow';
import { GOLD_DUST_MAX_TRAVEL_PX } from '../sim/motes/moteTypeConfig';

test('bow aim preview is a straight line of the Gold Dust max travel length', () => {
  assert.equal(BOW_PREVIEW_MAX_RANGE_WORLD, GOLD_DUST_MAX_TRAVEL_PX);
  const out = { x: 0, y: 0 };
  computeStraightBowAimEnd(out, 0, 0, 1, 0, BOW_PREVIEW_MAX_RANGE_WORLD, null);
  assert.equal(out.x, GOLD_DUST_MAX_TRAVEL_PX, 'straight along +x');
  assert.equal(out.y, 0, 'no vertical drop — the aim line is always straight');
});

test('bow aim preview stays straight for a diagonal aim (no ballistic curve)', () => {
  const out = { x: 0, y: 0 };
  const inv = 1 / Math.SQRT2;
  computeStraightBowAimEnd(out, 10, 10, 1, 1, 100, null);
  // End lies exactly on the ray from the start along the normalized aim.
  assert.ok(Math.abs(out.x - (10 + inv * 100)) < 1e-4);
  assert.ok(Math.abs(out.y - (10 + inv * 100)) < 1e-4);
});

test('bow aim preview clips at a terrain raycast hit', () => {
  const out = { x: 0, y: 0 };
  const raycast = () => ({ x: 5, y: 0 });
  computeStraightBowAimEnd(out, 0, 0, 1, 0, BOW_PREVIEW_MAX_RANGE_WORLD, raycast);
  assert.equal(out.x, 5);
  assert.equal(out.y, 0);
});

test('bow preview visibility requires unlock + held gesture + assembling arrow', () => {
  assert.equal(computeBowPreviewShouldBeVisible(0, SecondaryWeaveGesturePhase.Holding, BOW_ARROW_PHASE_ASSEMBLING), false);
  assert.equal(computeBowPreviewShouldBeVisible(1, SecondaryWeaveGesturePhase.Idle, BOW_ARROW_PHASE_ASSEMBLING), false);
  assert.equal(computeBowPreviewShouldBeVisible(1, SecondaryWeaveGesturePhase.Holding, BOW_ARROW_PHASE_NONE), false);
  assert.equal(computeBowPreviewShouldBeVisible(1, SecondaryWeaveGesturePhase.Holding, BOW_ARROW_PHASE_OUTBOUND), false);
  assert.equal(computeBowPreviewShouldBeVisible(1, SecondaryWeaveGesturePhase.Holding, BOW_ARROW_PHASE_ASSEMBLING), true);
  assert.equal(computeBowPreviewShouldBeVisible(1, SecondaryWeaveGesturePhase.Press, BOW_ARROW_PHASE_ASSEMBLING), true);
});

test('renderer reset() clears stale fade-alpha interpolation state back to fresh-load default', () => {
  const renderer = new BowTrajectoryPreviewRenderer();
  const rendererAny = renderer as unknown as { _visibleAlpha: number };
  rendererAny._visibleAlpha = 0.85;
  renderer.reset();
  assert.equal(rendererAny._visibleAlpha, 0, 'visible alpha must reset to 0');
});
