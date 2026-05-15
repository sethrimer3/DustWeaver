/**
 * Camera transition and effective-bounds state for the game screen.
 *
 * Extracted from gameScreen.ts following the same pattern as
 * gameAdaptiveQuality.ts and gameSeamlessStaging.ts.
 *
 * Responsibilities:
 *  - Smooth camera interpolation after a single-room switch (BUILD 297).
 *  - Transition cooldown to prevent double-trigger on return transitions.
 *  - Effective camera clamp bounds that smoothly lerp between union bounds
 *    (during/after a seamless crossing) and the active single-room bounds.
 */

import type { CameraState } from '../render/camera';
import { updateCameraWithBounds, updateCameraUnclamped } from '../render/camera';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Duration of the post-switch camera interpolation in seconds (BUILD 297). */
export const CAM_TRANS_DURATION_SEC = 0.35;

/**
 * After a room switch, block checkRoomTransitions for this many milliseconds
 * so the spawn point's proximity to the return transition does not immediately
 * fire another room switch (double-trigger bug).
 */
export const TRANSITION_COOLDOWN_MS = 400;

/**
 * Lerp speed for camera bounds shrinkage from union bounds to single-room
 * bounds after a seamless crossing completes (world-units / second is
 * irrelevant; this is a per-axis blend factor multiplier).
 */
export const CAMERA_BOUNDS_LERP_SPEED = 4.0;

/**
 * Number of frames to smoothly settle the effective camera bounds after
 * seamless crossing finalization.  Prevents a hard snap when the union
 * bounds shrink to a narrow room's single-room bounds.
 * ~21 frames ≈ 0.35 s at 60 fps.
 */
export const CAM_SETTLING_FRAMES = 21;

// ── State ─────────────────────────────────────────────────────────────────────

export interface GameCameraState {
  /** True while the camera is interpolating from old to new room position. */
  isTransitionActive: boolean;
  transitionStartXWorld: number;
  transitionStartYWorld: number;
  transitionTargetXWorld: number;
  transitionTargetYWorld: number;
  /** Accumulated seconds since the current transition began. */
  transitionElapsedSec: number;
  /** Cooldown in ms blocking room-transition detection after a room switch. */
  transitionCooldownMs: number;
  /** Smoothly-lerped effective camera clamp bounds (left/top edge, world). */
  effBoundsMinX: number;
  effBoundsMinY: number;
  /** Smoothly-lerped effective camera clamp bounds (right/bottom edge, world). */
  effBoundsMaxX: number;
  effBoundsMaxY: number;

  // ── Camera settling after seamless crossing finalization ──────────────────
  /**
   * Frames remaining in the settling window.  While > 0, the effective
   * bounds lerp from settlingStart* toward the new room's single-room bounds
   * using a frame-count-based t so the camera never snaps on a narrow room.
   */
  camSettlingFramesLeft: number;
  /** Effective-bounds values captured when the union bounds were last active. */
  settlingMinX: number;
  settlingMinY: number;
  settlingMaxX: number;
  settlingMaxY: number;
  /** True on the frame where renderUnionBounds was non-null. */
  prevHadUnionBounds: boolean;
}

export function createGameCameraState(roomWidthWorld: number, roomHeightWorld: number): GameCameraState {
  return {
    isTransitionActive: false,
    transitionStartXWorld: 0,
    transitionStartYWorld: 0,
    transitionTargetXWorld: 0,
    transitionTargetYWorld: 0,
    transitionElapsedSec: 0,
    transitionCooldownMs: 0,
    effBoundsMinX: 0,
    effBoundsMinY: 0,
    effBoundsMaxX: roomWidthWorld,
    effBoundsMaxY: roomHeightWorld,
    camSettlingFramesLeft: 0,
    settlingMinX: 0,
    settlingMinY: 0,
    settlingMaxX: roomWidthWorld,
    settlingMaxY: roomHeightWorld,
    prevHadUnionBounds: false,
  };
}

// ── Mutation helpers ─────────────────────────────────────────────────────────

/**
 * Begins a smooth camera transition from `oldCamX/Y` to `targetCamX/Y`.
 * Called from the room transition callback immediately after `loadRoom`.
 */
export function beginCameraTransition(
  state: GameCameraState,
  oldCamX: number,
  oldCamY: number,
  targetCamX: number,
  targetCamY: number,
): void {
  state.isTransitionActive = true;
  state.transitionStartXWorld  = oldCamX;
  state.transitionStartYWorld  = oldCamY;
  state.transitionTargetXWorld = targetCamX;
  state.transitionTargetYWorld = targetCamY;
  state.transitionElapsedSec   = 0;
}

/**
 * Cancels any in-progress camera transition.
 * Called from _makeLoadRoomPhases Phase A so non-transition loads (death
 * respawn, editor reload, lambda teleport) never inherit the interpolation.
 */
export function cancelCameraTransition(state: GameCameraState): void {
  state.isTransitionActive = false;
}

/**
 * Resets the effective camera clamp bounds to the given single-room size.
 * Called from _makeLoadRoomPhases Phase F after wall/camera snap.
 */
export function resetCameraEffBoundsForRoom(
  state: GameCameraState,
  roomWidthWorld: number,
  roomHeightWorld: number,
): void {
  state.effBoundsMinX = 0;
  state.effBoundsMinY = 0;
  state.effBoundsMaxX = roomWidthWorld;
  state.effBoundsMaxY = roomHeightWorld;
}

// ── Per-frame update ─────────────────────────────────────────────────────────

/** Smoothstep ease-out curve for camera transition interpolation. */
function _camTransEase(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Updates the camera follow position each frame.  Handles three modes:
 *  1. Camera transition active — smoothly interpolates from old to new room.
 *  2. Always-center mode — follow player without room-edge clamping.
 *  3. Normal mode — clamp to effective bounds (lerped toward single-room bounds).
 */
export function updateCameraFollow(
  camState: GameCameraState,
  camera: CameraState,
  camTargetX: number,
  camTargetY: number,
  renderUnionBounds: { minXWorld: number; minYWorld: number; maxXWorld: number; maxYWorld: number } | null,
  roomWidthWorld: number,
  roomHeightWorld: number,
  virtualWidthPx: number,
  virtualHeightPx: number,
  elapsedMs: number,
  alwaysCenterCamera: boolean,
): void {
  if (camState.isTransitionActive) {
    // ── Camera transition interpolation (BUILD 297) ─────────────────────────
    // Smoothly pan from the camera position in the old room to the correct
    // clamped position in the new room.  Normal follow-and-clamp is
    // suppressed for the duration so room bounds do not force a hard snap.
    const dtSec = elapsedMs / 1000;
    camState.transitionElapsedSec += dtSec;
    const t    = Math.min(1.0, camState.transitionElapsedSec / CAM_TRANS_DURATION_SEC);
    const ease = _camTransEase(t);
    camera.centerXWorld = camState.transitionStartXWorld + (camState.transitionTargetXWorld - camState.transitionStartXWorld) * ease;
    camera.centerYWorld = camState.transitionStartYWorld + (camState.transitionTargetYWorld - camState.transitionStartYWorld) * ease;
    if (t >= 1.0) {
      // Snap to exact target on completion and return control to normal path.
      camState.isTransitionActive = false;
      camera.centerXWorld = camState.transitionTargetXWorld;
      camera.centerYWorld = camState.transitionTargetYWorld;
    }
    // Effective bounds are irrelevant while the camera position is overridden.
  } else if (alwaysCenterCamera) {
    // Always-center mode: follow the player with no room-edge clamping.
    // Areas outside the room show as black — clip rect is skipped in renderFrame.
    updateCameraUnclamped(camera, camTargetX, camTargetY, elapsedMs / 1000);
  } else {
    // ── Update effective camera clamp bounds ───────────────────────────────
    // Smoothly transition from union bounds (during/after crossing) to
    // single-room bounds to prevent an instant camera snap.
    if (renderUnionBounds !== null) {
      // Snap effective bounds to union immediately while union is active.
      camState.effBoundsMinX = renderUnionBounds.minXWorld;
      camState.effBoundsMinY = renderUnionBounds.minYWorld;
      camState.effBoundsMaxX = renderUnionBounds.maxXWorld;
      camState.effBoundsMaxY = renderUnionBounds.maxYWorld;
      // Capture settling start in case the union expires next frame.
      camState.settlingMinX = camState.effBoundsMinX;
      camState.settlingMinY = camState.effBoundsMinY;
      camState.settlingMaxX = camState.effBoundsMaxX;
      camState.settlingMaxY = camState.effBoundsMaxY;
      camState.prevHadUnionBounds = true;
    } else {
      // Union bounds just expired → start settling window.
      if (camState.prevHadUnionBounds) {
        camState.camSettlingFramesLeft = CAM_SETTLING_FRAMES;
        camState.prevHadUnionBounds = false;
      }

      if (camState.camSettlingFramesLeft > 0) {
        // Frame-count lerp from settlingStart toward single-room bounds.
        // Decrement first so t reaches 1.0 on the last settling frame.
        camState.camSettlingFramesLeft--;
        const t = 1.0 - camState.camSettlingFramesLeft / CAM_SETTLING_FRAMES;
        camState.effBoundsMinX = camState.settlingMinX + (0              - camState.settlingMinX) * t;
        camState.effBoundsMinY = camState.settlingMinY + (0              - camState.settlingMinY) * t;
        camState.effBoundsMaxX = camState.settlingMaxX + (roomWidthWorld  - camState.settlingMaxX) * t;
        camState.effBoundsMaxY = camState.settlingMaxY + (roomHeightWorld - camState.settlingMaxY) * t;
      } else {
        // Post-settling: lerp effective bounds toward the active single-room bounds.
        const dtSec = elapsedMs / 1000;
        const bt = Math.min(1, CAMERA_BOUNDS_LERP_SPEED * dtSec);
        camState.effBoundsMinX += (0              - camState.effBoundsMinX) * bt;
        camState.effBoundsMinY += (0              - camState.effBoundsMinY) * bt;
        camState.effBoundsMaxX += (roomWidthWorld  - camState.effBoundsMaxX) * bt;
        camState.effBoundsMaxY += (roomHeightWorld - camState.effBoundsMaxY) * bt;
      }
    }

    updateCameraWithBounds(
      camera,
      camTargetX,
      camTargetY,
      camState.effBoundsMinX,
      camState.effBoundsMinY,
      camState.effBoundsMaxX,
      camState.effBoundsMaxY,
      virtualWidthPx,
      virtualHeightPx,
      elapsedMs / 1000,
    );
  }
}
