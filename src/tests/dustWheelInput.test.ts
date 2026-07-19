import test from 'node:test';
import assert from 'node:assert/strict';
import { createInputState } from '../input/handler';
import {
  createDustWheelGestureState,
  updateDustWheelGesture,
  DUST_WHEEL_HOLD_DURATION_MS,
  DUST_WHEEL_DOUBLE_TAP_WINDOW_MS,
  computeDustWheelAim,
  DUST_WHEEL_AIM_DEAD_ZONE_WORLD,
} from '../input/dustWheelInput';

function press(input: ReturnType<typeof createInputState>, atMs: number): void {
  input.isInteractDownFlag = true;
  input.interactDownTimeMs = atMs;
  input.isInteractPressEdgeFlag = true;
}

function release(input: ReturnType<typeof createInputState>): void {
  input.isInteractDownFlag = false;
  input.isInteractReleaseEdgeFlag = true;
}

test('a single short tap fires exactly one normal interaction', () => {
  const input = createInputState();
  const gesture = createDustWheelGestureState();

  press(input, 0);
  let result = updateDustWheelGesture(gesture, input, 0, true, false);
  assert.equal(result.fireNormalInteract, false);
  assert.equal(result.openWheel, false);

  release(input);
  result = updateDustWheelGesture(gesture, input, 40, true, false);
  assert.equal(result.fireNormalInteract, true);
  assert.equal(result.openWheel, false);

  // No further interactions leak from subsequent idle frames.
  result = updateDustWheelGesture(gesture, input, 60, true, false);
  assert.equal(result.fireNormalInteract, false);
});

test('holding for 999ms does not open the wheel', () => {
  const input = createInputState();
  const gesture = createDustWheelGestureState();
  press(input, 0);
  updateDustWheelGesture(gesture, input, 0, true, false);
  const result = updateDustWheelGesture(gesture, input, 999, true, false);
  assert.equal(result.openWheel, false);
});

test('holding for the full duration opens the wheel when eligible', () => {
  const input = createInputState();
  const gesture = createDustWheelGestureState();
  press(input, 0);
  updateDustWheelGesture(gesture, input, 0, true, false);
  const result = updateDustWheelGesture(gesture, input, DUST_WHEEL_HOLD_DURATION_MS, true, false);
  assert.equal(result.openWheel, true);
});

test('long-hold opening does not also fire a normal interaction on release', () => {
  const input = createInputState();
  const gesture = createDustWheelGestureState();
  press(input, 0);
  updateDustWheelGesture(gesture, input, 0, true, false);
  const openResult = updateDustWheelGesture(gesture, input, DUST_WHEEL_HOLD_DURATION_MS, true, false);
  assert.equal(openResult.openWheel, true);

  // Still held next frame — must not repeatedly open or interact.
  const heldAgain = updateDustWheelGesture(gesture, input, DUST_WHEEL_HOLD_DURATION_MS + 16, true, false);
  assert.equal(heldAgain.openWheel, false);
  assert.equal(heldAgain.fireNormalInteract, false);

  release(input);
  const releaseResult = updateDustWheelGesture(gesture, input, DUST_WHEEL_HOLD_DURATION_MS + 50, true, false);
  assert.equal(releaseResult.fireNormalInteract, false);
  assert.equal(releaseResult.openWheel, false);
});

test('a valid double tap inside the window opens the wheel and consumes the second press', () => {
  const input = createInputState();
  const gesture = createDustWheelGestureState();

  press(input, 0);
  updateDustWheelGesture(gesture, input, 0, true, false);
  release(input);
  const firstTap = updateDustWheelGesture(gesture, input, 50, true, false);
  assert.equal(firstTap.fireNormalInteract, true, 'first completed tap performs its normal interaction');

  press(input, 300);
  const secondPress = updateDustWheelGesture(gesture, input, 300, true, false);
  assert.equal(secondPress.openWheel, true);
  assert.equal(secondPress.fireNormalInteract, false);

  release(input);
  const secondRelease = updateDustWheelGesture(gesture, input, 340, true, false);
  assert.equal(secondRelease.fireNormalInteract, false, 'the wheel-opening press never also interacts on release');
});

test('a second tap outside the double-tap window does not open the wheel', () => {
  const input = createInputState();
  const gesture = createDustWheelGestureState();

  press(input, 0);
  updateDustWheelGesture(gesture, input, 0, true, false);
  release(input);
  updateDustWheelGesture(gesture, input, 50, true, false);

  const outsideWindowMs = 50 + DUST_WHEEL_DOUBLE_TAP_WINDOW_MS + 1;
  press(input, outsideWindowMs);
  const secondPress = updateDustWheelGesture(gesture, input, outsideWindowMs, true, false);
  assert.equal(secondPress.openWheel, false);

  release(input);
  const secondRelease = updateDustWheelGesture(gesture, input, outsideWindowMs + 30, true, false);
  assert.equal(secondRelease.fireNormalInteract, true, 'an independent second tap still performs its own interaction');
});

test('the wheel never opens with fewer than two available types — Interact behaves normally', () => {
  const input = createInputState();
  const gesture = createDustWheelGestureState();

  // Long hold while ineligible.
  press(input, 0);
  updateDustWheelGesture(gesture, input, 0, false, false);
  const heldResult = updateDustWheelGesture(gesture, input, DUST_WHEEL_HOLD_DURATION_MS + 100, false, false);
  assert.equal(heldResult.openWheel, false);
  release(input);
  const releaseResult = updateDustWheelGesture(gesture, input, DUST_WHEEL_HOLD_DURATION_MS + 120, false, false);
  assert.equal(releaseResult.fireNormalInteract, true);

  // Double tap while ineligible: both taps just interact independently.
  press(input, 2000);
  updateDustWheelGesture(gesture, input, 2000, false, false);
  release(input);
  const tap1 = updateDustWheelGesture(gesture, input, 2020, false, false);
  assert.equal(tap1.fireNormalInteract, true);
  press(input, 2100);
  const tap2Press = updateDustWheelGesture(gesture, input, 2100, false, false);
  assert.equal(tap2Press.openWheel, false);
  release(input);
  const tap2Release = updateDustWheelGesture(gesture, input, 2120, false, false);
  assert.equal(tap2Release.fireNormalInteract, true);
});

test('a fresh Interact press while the wheel is open cancels it and consumes the gesture', () => {
  const input = createInputState();
  const gesture = createDustWheelGestureState();

  press(input, 0);
  const cancelResult = updateDustWheelGesture(gesture, input, 0, true, true);
  assert.equal(cancelResult.cancelWheel, true);
  assert.equal(cancelResult.openWheel, false);

  release(input);
  const afterCancelRelease = updateDustWheelGesture(gesture, input, 20, true, false);
  assert.equal(afterCancelRelease.fireNormalInteract, false, 'the cancelling press must not also interact on release');
});

// ── Aim / dead zone ──────────────────────────────────────────────────────────

test('aim inside the dead zone is flagged and yields no meaningful angle', () => {
  const aim = computeDustWheelAim(0, DUST_WHEEL_AIM_DEAD_ZONE_WORLD * 0.5, 0, 0);
  assert.equal(aim.isInDeadZone, true);
});

test('aim outside the dead zone resolves an atan2 angle', () => {
  const aim = computeDustWheelAim(10, 0, 0, 0);
  assert.equal(aim.isInDeadZone, false);
  assert.ok(Math.abs(aim.angleRad - 0) < 1e-9);

  const aimUp = computeDustWheelAim(0, -10, 0, 0);
  assert.ok(Math.abs(aimUp.angleRad - (-Math.PI / 2)) < 1e-9);
});
