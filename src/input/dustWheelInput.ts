/**
 * Dust Selection Wheel — Interact gesture recognition.
 *
 * The Interact input (keyboard "F" by default) is otherwise a simple
 * edge-triggered action (see handler.ts / commands.ts). This module layers
 * hold-to-open and double-tap-to-open detection on top of the raw physical
 * press/hold/release state exposed by InputState, while preserving ordinary
 * tap behavior:
 *
 *   - A short tap always performs exactly one normal Interact action, fired
 *     on release (not on press) so hold/double-tap detection has time to work.
 *   - Holding Interact for DUST_WHEEL_HOLD_DURATION_MS opens the wheel and
 *     suppresses the normal interaction on release.
 *   - A second press within DUST_WHEEL_DOUBLE_TAP_WINDOW_MS of the first
 *     tap's release opens the wheel immediately and is fully consumed; the
 *     first tap still performs its normal interaction.
 *   - Both hold and double-tap open paths are gated on `isWheelEligible`
 *     (fewer than two unlocked dust types ⇒ the wheel can never open and
 *     Interact behaves like a plain tap-on-release action).
 *   - While the wheel is already open, any further Interact press cancels it
 *     and is fully consumed (no normal interaction, no re-opening).
 *
 * This is UI/input-timing logic only — it uses wall-clock timestamps
 * (performance.now(), threaded in as `nowMs`) and never touches the
 * deterministic sim tick.
 */

import type { InputState } from './handler';

/** Hold duration (ms) required to open the dust wheel via a long press. */
export const DUST_WHEEL_HOLD_DURATION_MS = 1000;
/** Maximum gap (ms) between a completed tap and a second press to count as a double-tap. */
export const DUST_WHEEL_DOUBLE_TAP_WINDOW_MS = 1000;

export interface DustWheelGestureState {
  /**
   * True once the current physical press has already been resolved into a
   * wheel action (hold-open, double-tap-open, or cancel-while-open) — its
   * eventual release must not also fire a normal Interact.
   */
  isCurrentPressConsumed: boolean;
  /** True once the current press has already triggered the hold-open path (prevents repeat-triggering every frame past the threshold). */
  hasHoldTriggeredThisPress: boolean;
  /** performance.now() timestamp of the most recent *unconsumed* tap's release; 0 = no pending double-tap window. */
  lastTapReleaseTimeMs: number;
}

export function createDustWheelGestureState(): DustWheelGestureState {
  return {
    isCurrentPressConsumed: false,
    hasHoldTriggeredThisPress: false,
    lastTapReleaseTimeMs: 0,
  };
}

export interface DustWheelGestureResult {
  /** A short, unconsumed tap completed this frame — perform the normal Interact action. */
  fireNormalInteract: boolean;
  /** Open the dust wheel now. */
  openWheel: boolean;
  /** Close/cancel an already-open dust wheel without changing the selected dust. */
  cancelWheel: boolean;
}

/**
 * Advances Interact gesture recognition by one frame.
 *
 * Consumes (clears) `input.isInteractPressEdgeFlag` / `isInteractReleaseEdgeFlag`.
 * Must be called exactly once per frame, before commands are collected, so
 * `collectCommands` sees a clean, already-resolved `isInteractTriggeredFlag`.
 */
export function updateDustWheelGesture(
  state: DustWheelGestureState,
  input: InputState,
  nowMs: number,
  isWheelEligible: boolean,
  isWheelOpen: boolean,
): DustWheelGestureResult {
  const pressEdge = input.isInteractPressEdgeFlag;
  const releaseEdge = input.isInteractReleaseEdgeFlag;
  input.isInteractPressEdgeFlag = false;
  input.isInteractReleaseEdgeFlag = false;

  let fireNormalInteract = false;
  let openWheel = false;
  let cancelWheel = false;

  if (isWheelOpen) {
    // Any fresh press while the wheel is already open cancels it outright,
    // and consumes the whole gesture (its release must not interact/reopen).
    if (pressEdge) {
      cancelWheel = true;
      state.isCurrentPressConsumed = true;
      state.hasHoldTriggeredThisPress = true;
    }
    if (releaseEdge) {
      state.isCurrentPressConsumed = false;
      state.hasHoldTriggeredThisPress = false;
      state.lastTapReleaseTimeMs = 0;
    }
    return { fireNormalInteract, openWheel, cancelWheel };
  }

  // ---- Wheel closed: resolve tap vs. hold-open vs. double-tap-open --------
  if (pressEdge) {
    if (isWheelEligible
        && state.lastTapReleaseTimeMs > 0
        && (nowMs - state.lastTapReleaseTimeMs) <= DUST_WHEEL_DOUBLE_TAP_WINDOW_MS) {
      // Second press of a valid double-tap — opens immediately, fully consumed.
      openWheel = true;
      state.isCurrentPressConsumed = true;
      state.hasHoldTriggeredThisPress = true;
    } else {
      state.isCurrentPressConsumed = false;
      state.hasHoldTriggeredThisPress = false;
    }
    // Every new press clears any stale pending double-tap window; a fresh one
    // is only established when this press's own release completes a plain tap.
    state.lastTapReleaseTimeMs = 0;
  }

  if (input.isInteractDownFlag
      && !state.isCurrentPressConsumed
      && !state.hasHoldTriggeredThisPress
      && isWheelEligible
      && (nowMs - input.interactDownTimeMs) >= DUST_WHEEL_HOLD_DURATION_MS) {
    openWheel = true;
    state.isCurrentPressConsumed = true;
    state.hasHoldTriggeredThisPress = true;
  }

  if (releaseEdge) {
    if (!state.isCurrentPressConsumed) {
      fireNormalInteract = true;
      state.lastTapReleaseTimeMs = nowMs;
    }
    state.isCurrentPressConsumed = false;
    state.hasHoldTriggeredThisPress = false;
  }

  return { fireNormalInteract, openWheel, cancelWheel };
}

// ── Aim direction resolution ─────────────────────────────────────────────────

/**
 * Center dead-zone radius (world units) around the player: aim points closer
 * than this to the player's visual center highlight/select nothing. Shared by
 * mouse, touch, and any other grapple-aim source since all of them funnel
 * through the same world-space aim point.
 */
export const DUST_WHEEL_AIM_DEAD_ZONE_WORLD = 10.0;

export interface DustWheelAimResult {
  /** atan2 angle (radians) from the player's visual center toward the aim point. Meaningless when isInDeadZone is true. */
  angleRad: number;
  /** Distance (world units) from the player's visual center to the aim point. */
  magnitudeWorld: number;
  /** True when the aim point is within the center dead zone — no option should be highlighted or selected. */
  isInDeadZone: boolean;
}

/**
 * Converts a world-space aim point into a normalized direction (angle +
 * dead-zone test) relative to the player's visual center. Used identically
 * for mouse aim, touch aim, and continuous highlight-preview aim so all
 * sources select consistently.
 */
export function computeDustWheelAim(
  aimXWorld: number,
  aimYWorld: number,
  playerXWorld: number,
  playerYWorld: number,
): DustWheelAimResult {
  const dx = aimXWorld - playerXWorld;
  const dy = aimYWorld - playerYWorld;
  const magnitudeWorld = Math.hypot(dx, dy);
  const isInDeadZone = magnitudeWorld < DUST_WHEEL_AIM_DEAD_ZONE_WORLD;
  return {
    angleRad: isInDeadZone ? 0 : Math.atan2(dy, dx),
    magnitudeWorld,
    isInDeadZone,
  };
}
