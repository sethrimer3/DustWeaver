/**
 * secondaryWeaveGesture.ts — Authoritative input-gesture coordinator for the
 * secondary action button (RMB / equivalent), shared by Sword/Shield/Bow
 * Weaves.
 *
 * This module owns ONLY the physical shape of the secondary-button gesture:
 * rising-edge press detection, held state, release detection, a gesture id
 * (so a later consumer can recognize "gesture #N" and never double-process a
 * stale one), and aim capture at press/hold/release. It intentionally knows
 * nothing about sword swipes, shield formation, or bow charge/fire timing —
 * that decision-making belongs to the sim-side consumer (weaveCombat.ts and
 * friends), which reads this coordinator's press/hold/release output and
 * drives its own phase logic.
 *
 * Two external systems must be able to interrupt a gesture before it starts
 * driving weave behavior:
 *
 *  - `markSecondaryWeaveGestureConsumedByOtherSystem()` — called from the
 *    exclusive-action arbitration point (grapple zip claiming the secondary
 *    button) on the same press. The in-progress gesture is voided: no press
 *    event was "really" delivered to weave systems, and the eventual release
 *    of that same physical press produces no release event either. A new
 *    gesture may only begin after the button returns to neutral.
 *
 *  - `cancelSecondaryWeaveGesture()` — called by window blur, pause, dialogue,
 *    the dust-selection wheel opening, death, or room-transition start. Reset
 *    to IDLE cleanly (no synthetic release event). If the button is still
 *    physically held at the moment of cancellation, a new gesture cannot
 *    begin until the button is fully released and pressed again — a
 *    cancel-then-still-held button must never silently resume a gesture.
 *
 * `tickSecondaryWeaveGesture` performs zero heap allocations in its
 * steady-state path — all state lives in the caller-owned, reused
 * `SecondaryWeaveGestureState` object.
 */

/** Purely-physical phase of the secondary-button gesture. */
export enum SecondaryWeaveGesturePhase {
  /** No press in progress; button is neutral (or its press was consumed/cancelled). */
  Idle = 0,
  /** The tick the rising edge (neutral -> held) was detected. Aim captured. */
  Press = 1,
  /** Button remains physically held after the press tick; aim updates continuously. */
  Holding = 2,
  /** The tick the falling edge (held -> neutral) was detected. Release aim captured. */
  Complete = 3,
}

export interface SecondaryWeaveGestureState {
  phase: SecondaryWeaveGesturePhase;
  /**
   * Monotonically increasing id, bumped once per fresh (non-consumed) press
   * that follows a fully-neutral button state. Stage-3 consumers use this to
   * recognize "gesture #N" and avoid reprocessing a stale gesture.
   */
  gestureId: number;
  /** True while the secondary button is physically held down, unfiltered by consumption/cancellation. */
  isPhysicallyHeld: boolean;
  /** True for exactly the tick a fresh (non-consumed) press rising-edge was detected. */
  pressEventFlag: boolean;
  /** True for exactly the tick a non-consumed, non-cancelled release falling-edge was detected. */
  releaseEventFlag: boolean;
  /** True while the current physical press has been claimed by another exclusive system (e.g. grapple zip). */
  consumedByOtherSystem: boolean;
  /**
   * True after a cancel() or consume() that happened while the button was
   * still held — the button must return to full physical neutral before a
   * new gesture can begin, even though it may still read as held.
   */
  awaitingNeutral: boolean;

  pressAimXWorld: number;
  pressAimYWorld: number;
  holdAimXWorld: number;
  holdAimYWorld: number;
  releaseAimXWorld: number;
  releaseAimYWorld: number;
}

export function createSecondaryWeaveGestureState(): SecondaryWeaveGestureState {
  return {
    phase: SecondaryWeaveGesturePhase.Idle,
    gestureId: 0,
    isPhysicallyHeld: false,
    pressEventFlag: false,
    releaseEventFlag: false,
    consumedByOtherSystem: false,
    awaitingNeutral: false,
    pressAimXWorld: 0,
    pressAimYWorld: 0,
    holdAimXWorld: 0,
    holdAimYWorld: 0,
    releaseAimXWorld: 0,
    releaseAimYWorld: 0,
  };
}

/**
 * Advances the gesture coordinator by one tick/frame. Must be called exactly
 * once per tick, with the current physical held-state and aim of the
 * secondary action binding, BEFORE any sim code (weaveCombat.ts) that will
 * eventually consume this state (stage 3).
 *
 * Zero allocations in the steady-state path.
 */
export function tickSecondaryWeaveGesture(
  state: SecondaryWeaveGestureState,
  isPhysicallyHeldNow: boolean,
  aimXWorld: number,
  aimYWorld: number,
): void {
  const wasHeld = state.isPhysicallyHeld;
  state.pressEventFlag = false;
  state.releaseEventFlag = false;

  if (!wasHeld && isPhysicallyHeldNow) {
    // Rising edge: a fresh physical press, always starting from neutral.
    state.isPhysicallyHeld = true;
    state.consumedByOtherSystem = false;
    state.awaitingNeutral = false;
    state.gestureId += 1;
    state.phase = SecondaryWeaveGesturePhase.Press;
    state.pressEventFlag = true;
    state.pressAimXWorld = aimXWorld;
    state.pressAimYWorld = aimYWorld;
    state.holdAimXWorld = aimXWorld;
    state.holdAimYWorld = aimYWorld;
    return;
  }

  if (wasHeld && isPhysicallyHeldNow) {
    state.isPhysicallyHeld = true;
    // Only an in-progress (non-consumed, non-cancelled) gesture advances to
    // Holding and keeps sampling aim. If phase is Idle, this press was either
    // consumed by another system or cancelled mid-hold — do nothing until
    // the button returns to neutral.
    if (state.phase === SecondaryWeaveGesturePhase.Press
      || state.phase === SecondaryWeaveGesturePhase.Holding) {
      state.phase = SecondaryWeaveGesturePhase.Holding;
      state.holdAimXWorld = aimXWorld;
      state.holdAimYWorld = aimYWorld;
    }
    return;
  }

  if (wasHeld && !isPhysicallyHeldNow) {
    // Falling edge.
    state.isPhysicallyHeld = false;
    const wasActiveGesture = !state.consumedByOtherSystem
      && (state.phase === SecondaryWeaveGesturePhase.Press || state.phase === SecondaryWeaveGesturePhase.Holding);
    if (wasActiveGesture) {
      state.releaseEventFlag = true;
      state.releaseAimXWorld = aimXWorld;
      state.releaseAimYWorld = aimYWorld;
      state.phase = SecondaryWeaveGesturePhase.Complete;
    } else {
      state.phase = SecondaryWeaveGesturePhase.Idle;
    }
    state.consumedByOtherSystem = false;
    state.awaitingNeutral = false;
    return;
  }

  // Steady neutral state (not held, wasn't held).
  state.isPhysicallyHeld = false;
  if (state.phase === SecondaryWeaveGesturePhase.Complete) {
    state.phase = SecondaryWeaveGesturePhase.Idle;
  }
  state.awaitingNeutral = false;
}

/**
 * Call from the exclusive-action arbitration point at the exact moment
 * another system (grapple zip) claims the current physical press of the
 * secondary button. No-op if no press is currently in progress.
 *
 * After this call: no press/release event has "really" fired for weave
 * purposes on this physical press (a pending press event this same tick is
 * retracted), and the eventual release of this same press will not produce a
 * release event. A new gesture requires the button to return to neutral.
 */
export function markSecondaryWeaveGestureConsumedByOtherSystem(state: SecondaryWeaveGestureState): void {
  if (!state.isPhysicallyHeld) return;
  state.consumedByOtherSystem = true;
  state.pressEventFlag = false;
  state.releaseEventFlag = false;
  state.phase = SecondaryWeaveGesturePhase.Idle;
  state.awaitingNeutral = true;
}

/**
 * Cancels any in-progress gesture immediately and resets to IDLE, without
 * emitting a synthetic release event. Safe to call every frame while a
 * suppressing condition (pause, dialogue, dust wheel open, death, room
 * transition, window blur) is active — idempotent when already idle.
 *
 * If the button is still physically held at the moment of cancellation, a
 * new gesture cannot begin until the button is fully released and re-pressed
 * (tracked via `awaitingNeutral`).
 */
export function cancelSecondaryWeaveGesture(state: SecondaryWeaveGestureState): void {
  state.pressEventFlag = false;
  state.releaseEventFlag = false;
  state.consumedByOtherSystem = false;
  state.phase = SecondaryWeaveGesturePhase.Idle;
  state.awaitingNeutral = state.isPhysicallyHeld;
}
