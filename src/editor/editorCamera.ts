/**
 * Editor camera — free WASD panning independent of the player.
 * Smoothly moves at a constant speed in world units per second.
 */

import type { CameraState } from '../render/camera';

/** Camera pan speed in world units per second. */
const EDITOR_CAMERA_SPEED_WORLD = 200;

export interface EditorCameraInput {
  isUp: boolean;
  isDown: boolean;
  isLeft: boolean;
  isRight: boolean;
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

  camera.centerXWorld += dx * EDITOR_CAMERA_SPEED_WORLD * dtSec;
  camera.centerYWorld += dy * EDITOR_CAMERA_SPEED_WORLD * dtSec;
}
