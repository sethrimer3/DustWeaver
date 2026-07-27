import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CW_FIRE_CIRCLE_TOTAL_TICKS,
  getCrimsonWizardFireCircleFrame,
} from '../sim/clusters/crimsonWizardFireCircleAnimation';

test('Crimson Wizard fire circle plays 125 frames at one frame per tick', () => {
  assert.deepEqual(getCrimsonWizardFireCircleFrame(1), { frameIndex: 0, opacity: 1 });
  assert.deepEqual(getCrimsonWizardFireCircleFrame(125), { frameIndex: 124, opacity: 1 });
});

test('Crimson Wizard fire circle holds its last frame for 0.5 seconds', () => {
  assert.deepEqual(getCrimsonWizardFireCircleFrame(155), { frameIndex: 124, opacity: 1 });
});

test('Crimson Wizard fire circle fades for 0.75 seconds and then despawns', () => {
  const firstFade = getCrimsonWizardFireCircleFrame(156);
  const lastFade = getCrimsonWizardFireCircleFrame(CW_FIRE_CIRCLE_TOTAL_TICKS);
  assert.equal(firstFade?.frameIndex, 124);
  assert.ok(Math.abs((firstFade?.opacity ?? 0) - 44 / 45) < 1e-12);
  assert.deepEqual(lastFade, { frameIndex: 124, opacity: 0 });
  assert.equal(getCrimsonWizardFireCircleFrame(CW_FIRE_CIRCLE_TOTAL_TICKS + 1), null);
});
