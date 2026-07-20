import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isParticleTrailMotionActive,
  TRAIL_START_SPEED_WORLD,
  TRAIL_STOP_SPEED_WORLD,
} from '../render/particles/trailRenderer';

test('near-stationary particles cannot start or sustain a trail', () => {
  assert.equal(isParticleTrailMotionActive(false, 2, 3), false);
  assert.equal(isParticleTrailMotionActive(true, 2, 3), false);
});

test('trail motion gate uses hysteresis to avoid boundary flicker', () => {
  const betweenThresholds = (TRAIL_START_SPEED_WORLD + TRAIL_STOP_SPEED_WORLD) / 2;

  assert.equal(isParticleTrailMotionActive(false, betweenThresholds, 0), false);
  assert.equal(isParticleTrailMotionActive(true, betweenThresholds, 0), true);
  assert.equal(isParticleTrailMotionActive(false, TRAIL_START_SPEED_WORLD, 0), true);
  assert.equal(isParticleTrailMotionActive(true, TRAIL_STOP_SPEED_WORLD - 0.01, 0), false);
});
