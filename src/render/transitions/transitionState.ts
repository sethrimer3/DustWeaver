/**
 * transitionState.ts — Types for the room-transition visual state machine.
 *
 * Owned by gameScreen.ts; passed read-only to renderFrame() so the renderer
 * can decide fade alpha, camera entry offset, and debug overlay content.
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

/** Snapshot of transition state for the debug overlay. */
export interface TransitionDebugStats {
  /** Room ID of the currently loaded room. */
  currentRoomId: string;
  /** Whether a transition is currently animating. */
  isTransitioning: boolean;
  /** Total duration of the last transition (ms). */
  lastDurationMs: number;
  /** Player speed when the last transition fired (world units/sec). */
  lastPlayerSpeedWorld: number;
  /** Number of preview bubbles rendered this frame. */
  activeBubbleCount: number;
  /** Whether the edge extension cache is populated for the current room. */
  edgeCacheFilled: boolean;
  /** Whether the smooth camera transition is currently interpolating. */
  isCameraTransitioning: boolean;
  /** Camera transition progress [0, 1]. */
  cameraTransProgress: number;
  /** Camera start X world unit (at the moment of room switch). */
  cameraTransStartXWorld: number;
  /** Camera start Y world unit (at the moment of room switch). */
  cameraTransStartYWorld: number;
  /** Camera target X world unit (clamped position in the new room). */
  cameraTransTargetXWorld: number;
  /** Camera target Y world unit (clamped position in the new room). */
  cameraTransTargetYWorld: number;
  /** Room ID of the destination during or after the last transition. */
  destinationRoomId: string;
  /**
   * True when adjacent-room gameplay rendering is disabled.
   * Always true in BUILD 297+; preserved as an explicit flag for debugging.
   */
  isAdjacentRoomRenderingDisabled: boolean;
}
