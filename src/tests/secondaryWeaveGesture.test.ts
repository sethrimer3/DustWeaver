import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  cancelSecondaryWeaveGesture,
  createSecondaryWeaveGestureState,
  markSecondaryWeaveGestureConsumedByOtherSystem,
  SecondaryWeaveGesturePhase,
  tickSecondaryWeaveGesture,
} from '../input/secondaryWeaveGesture';

describe('secondaryWeaveGesture', () => {
  test('press -> hold -> release produces exactly one press and one release event', () => {
    const state = createSecondaryWeaveGestureState();

    // Neutral tick.
    tickSecondaryWeaveGesture(state, false, 0, 0);
    assert.equal(state.pressEventFlag, false);
    assert.equal(state.phase, SecondaryWeaveGesturePhase.Idle);

    // Press.
    tickSecondaryWeaveGesture(state, true, 10, 20);
    assert.equal(state.pressEventFlag, true);
    assert.equal(state.releaseEventFlag, false);
    assert.equal(state.phase, SecondaryWeaveGesturePhase.Press);
    assert.equal(state.gestureId, 1);

    // Hold for several ticks — never re-fires press.
    for (let i = 0; i < 5; i++) {
      tickSecondaryWeaveGesture(state, true, 11 + i, 20);
      assert.equal(state.pressEventFlag, false, `press re-fired on hold tick ${i}`);
      assert.equal(state.releaseEventFlag, false);
      assert.equal(state.phase, SecondaryWeaveGesturePhase.Holding);
    }

    // Release.
    tickSecondaryWeaveGesture(state, false, 99, 88);
    assert.equal(state.pressEventFlag, false);
    assert.equal(state.releaseEventFlag, true);
    assert.equal(state.phase, SecondaryWeaveGesturePhase.Complete);

    // Next neutral tick settles back to Idle, no further events.
    tickSecondaryWeaveGesture(state, false, 0, 0);
    assert.equal(state.releaseEventFlag, false);
    assert.equal(state.phase, SecondaryWeaveGesturePhase.Idle);
  });

  test('gesture id increments only on a fresh press following full neutral', () => {
    const state = createSecondaryWeaveGestureState();

    tickSecondaryWeaveGesture(state, true, 0, 0);
    assert.equal(state.gestureId, 1);
    for (let i = 0; i < 3; i++) tickSecondaryWeaveGesture(state, true, 0, 0);
    assert.equal(state.gestureId, 1, 'gesture id must not increment while held');

    tickSecondaryWeaveGesture(state, false, 0, 0); // release
    tickSecondaryWeaveGesture(state, false, 0, 0); // neutral settle

    tickSecondaryWeaveGesture(state, true, 0, 0); // second fresh press
    assert.equal(state.gestureId, 2);
  });

  test('a press consumed by grapple-zip priority produces no weave press/release events', () => {
    const state = createSecondaryWeaveGestureState();

    // Press starts (this is the tick the caller would also route to grapple
    // arbitration and discover grapple is active).
    tickSecondaryWeaveGesture(state, true, 5, 5);
    assert.equal(state.pressEventFlag, true);
    const claimedGestureId = state.gestureId;

    // Grapple claims this press within the same frame's command processing.
    markSecondaryWeaveGestureConsumedByOtherSystem(state);
    assert.equal(state.pressEventFlag, false, 'press event must be retracted once consumed');
    assert.equal(state.consumedByOtherSystem, true);
    assert.equal(state.phase, SecondaryWeaveGesturePhase.Idle);

    // Holding the (grapple-owned) button never fires weave events.
    for (let i = 0; i < 4; i++) {
      tickSecondaryWeaveGesture(state, true, 5, 5);
      assert.equal(state.pressEventFlag, false);
      assert.equal(state.releaseEventFlag, false);
    }

    // Releasing the consumed press must not fire a release event.
    tickSecondaryWeaveGesture(state, false, 5, 5);
    assert.equal(state.releaseEventFlag, false);
    assert.equal(state.phase, SecondaryWeaveGesturePhase.Idle);

    // A fresh press after full release starts a genuinely new gesture.
    tickSecondaryWeaveGesture(state, true, 6, 6);
    assert.equal(state.pressEventFlag, true);
    assert.equal(state.gestureId, claimedGestureId + 1);
  });

  test('window-blur/menu/pause/dust-wheel style cancellation mid-hold resets cleanly with no stale release', () => {
    const state = createSecondaryWeaveGestureState();

    tickSecondaryWeaveGesture(state, true, 1, 1);
    tickSecondaryWeaveGesture(state, true, 1, 1);
    assert.equal(state.phase, SecondaryWeaveGesturePhase.Holding);

    cancelSecondaryWeaveGesture(state);
    assert.equal(state.phase, SecondaryWeaveGesturePhase.Idle);
    assert.equal(state.pressEventFlag, false);
    assert.equal(state.releaseEventFlag, false);
    assert.equal(state.awaitingNeutral, true, 'button still physically held at cancel time');

    // Physical release after cancellation must not emit a release event.
    tickSecondaryWeaveGesture(state, false, 1, 1);
    assert.equal(state.releaseEventFlag, false);
    assert.equal(state.awaitingNeutral, false);
  });

  test('a cancelled-while-held gesture requires full physical release before a new gesture can start', () => {
    const state = createSecondaryWeaveGestureState();

    tickSecondaryWeaveGesture(state, true, 0, 0);
    const firstGestureId = state.gestureId;
    cancelSecondaryWeaveGesture(state);

    // Button stays down (still held physically) across several ticks —
    // must not silently resume a gesture.
    for (let i = 0; i < 5; i++) {
      tickSecondaryWeaveGesture(state, true, 0, 0);
      assert.equal(state.pressEventFlag, false, `press must not resume while still held, tick ${i}`);
      assert.equal(state.phase, SecondaryWeaveGesturePhase.Idle);
      assert.equal(state.gestureId, firstGestureId);
    }

    // Full release, then a fresh press is a genuinely new gesture.
    tickSecondaryWeaveGesture(state, false, 0, 0);
    tickSecondaryWeaveGesture(state, true, 0, 0);
    assert.equal(state.pressEventFlag, true);
    assert.equal(state.gestureId, firstGestureId + 1);
  });

  test('press-time, hold-time, and release-time aim are captured independently', () => {
    const state = createSecondaryWeaveGestureState();

    tickSecondaryWeaveGesture(state, true, 100, 200);
    assert.equal(state.pressAimXWorld, 100);
    assert.equal(state.pressAimYWorld, 200);
    assert.equal(state.holdAimXWorld, 100);
    assert.equal(state.holdAimYWorld, 200);

    tickSecondaryWeaveGesture(state, true, 150, 250);
    // Press aim must not change once captured.
    assert.equal(state.pressAimXWorld, 100);
    assert.equal(state.pressAimYWorld, 200);
    // Hold aim updates continuously.
    assert.equal(state.holdAimXWorld, 150);
    assert.equal(state.holdAimYWorld, 250);

    tickSecondaryWeaveGesture(state, false, 300, 400);
    assert.equal(state.releaseAimXWorld, 300);
    assert.equal(state.releaseAimYWorld, 400);
    // Press/hold aim from earlier in the gesture remain unchanged by release.
    assert.equal(state.pressAimXWorld, 100);
    assert.equal(state.holdAimXWorld, 150);
  });

  test('cancel() is idempotent / safe to call every frame while already idle', () => {
    const state = createSecondaryWeaveGestureState();
    cancelSecondaryWeaveGesture(state);
    cancelSecondaryWeaveGesture(state);
    assert.equal(state.phase, SecondaryWeaveGesturePhase.Idle);
    assert.equal(state.awaitingNeutral, false);

    tickSecondaryWeaveGesture(state, true, 3, 4);
    assert.equal(state.pressEventFlag, true);
    assert.equal(state.gestureId, 1);
  });

  test('markSecondaryWeaveGestureConsumedByOtherSystem is a no-op when no press is in progress', () => {
    const state = createSecondaryWeaveGestureState();
    markSecondaryWeaveGestureConsumedByOtherSystem(state);
    assert.equal(state.consumedByOtherSystem, false);

    tickSecondaryWeaveGesture(state, true, 0, 0);
    assert.equal(state.pressEventFlag, true);
    assert.equal(state.gestureId, 1);
  });

  // The coordinator takes a plain boolean held-state + aim, agnostic to
  // whatever physical binding produced it (RMB, controller secondaryAction
  // per keybindings.ts, or a future rebind target) — as of this stage RMB is
  // hardcoded in input/handler.ts and controller secondaryAction has no
  // runtime Gamepad polling wired up yet, so there is no live rebinding to
  // exercise; this test instead verifies gesture behavior is identical
  // regardless of which logical source flips the held boolean.
  test('gesture behavior is identical regardless of the physical input source driving isPhysicallyHeldNow', () => {
    const rmbDrivenState = createSecondaryWeaveGestureState();
    const controllerDrivenState = createSecondaryWeaveGestureState();

    tickSecondaryWeaveGesture(rmbDrivenState, true, 42, 24);
    tickSecondaryWeaveGesture(controllerDrivenState, true, 42, 24);
    assert.deepEqual(rmbDrivenState, controllerDrivenState);

    tickSecondaryWeaveGesture(rmbDrivenState, false, 1, 1);
    tickSecondaryWeaveGesture(controllerDrivenState, false, 1, 1);
    assert.deepEqual(rmbDrivenState, controllerDrivenState);
  });
});
