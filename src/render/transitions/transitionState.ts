/**
 * transitionState.ts — Types for the room-transition debug state.
 *
 * Only the fields relevant to the active instant-transition path are kept here.
 * Legacy fields (camera interpolation progress, reveal offset, preview bubbles,
 * edge-cache status, adjacent-room rendering) have been removed.
 */

import type { TransitionDirection } from '../../levels/roomDef';

// ── Visual transition state ───────────────────────────────────────────────────

/**
 * Mutable visual state for an in-progress room transition.
 *
 * The state machine lives in gameScreen.ts.  The renderer reads
 * `fadeOutDurationMs`, `fadeInDurationMs`, and `hasLoadedNewRoom` to compute
 * the current fade alpha from the single `transitionFadeAlpha` float that is
 * already threaded through the render pipeline.
 */
export interface RoomTransitionVisualState {
  /** Room ID transitioning from. */
  fromRoomId: string;
  /** Room ID transitioning to. */
  toRoomId: string;
  /** Direction of player travel. */
  direction: TransitionDirection;
  /** Total transition duration (ms), derived from player speed. */
  durationMs: number;
  /** Fade-out portion duration (ms). */
  fadeOutDurationMs: number;
  /** Fade-in portion duration (ms). */
  fadeInDurationMs: number;
  /** Player speed (world units/sec) when the transition was triggered. */
  playerSpeedAtCrossing: number;
  /** True once loadRoom() has been called for this transition. */
  hasLoadedNewRoom: boolean;
}

// ── Debug stats passed to the render profiler ─────────────────────────────────

/** Snapshot of instant-transition state for the debug overlay. */
export interface TransitionDebugStats {
  /** Room ID of the currently loaded room. */
  currentRoomId: string;
  /** Room ID of the destination during or after the last transition. */
  destinationRoomId: string;
  /** Player speed when the last transition fired (world units/sec). */
  lastPlayerSpeedWorld: number;
  /** Transition cooldown remaining in ms (0 = no cooldown active). */
  transitionCooldownMs: number;
}
