/**
 * Editor camera — free WASD panning independent of the player.
 * Smoothly moves at a constant speed in world units per second.
 * Hold Shift to double the pan speed.
 */

import type { CameraState } from '../render/camera';

/** Camera pan speed in world units per second. */
const EDITOR_CAMERA_SPEED_WORLD = 200;

/** Multiplier applied when Shift is held. */
const SHIFT_SPEED_MULTIPLIER = 2;

export interface EditorCameraInput {
  isUp: boolean;
  isDown: boolean;
  isLeft: boolean;
  isRight: boolean;
  isShiftHeld: boolean;
}

/**
 * Updates the camera position based on WASD input.
 * Called each frame while editor mode is active.
 */
export function updateEditorCamera(
  camera: CameraState,
  input: EditorCameraInput,
  dtSec: number,
): void {
  let dx = 0;
  let dy = 0;
  if (input.isLeft) dx -= 1;
  if (input.isRight) dx += 1;
  if (input.isUp) dy -= 1;
  if (input.isDown) dy += 1;

  // Normalize diagonal movement
  if (dx !== 0 && dy !== 0) {
    const inv = 1.0 / Math.sqrt(2);
    dx *= inv;
    dy *= inv;
  }

  const speed = input.isShiftHeld
    ? EDITOR_CAMERA_SPEED_WORLD * SHIFT_SPEED_MULTIPLIER
    : EDITOR_CAMERA_SPEED_WORLD;

  camera.centerXWorld += dx * speed * dtSec;
  camera.centerYWorld += dy * speed * dtSec;
}
