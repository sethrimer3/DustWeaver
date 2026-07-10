/**
 * Editor camera — free WASD panning independent of the player, plus
 * cursor-anchored zoom (mouse wheel and +/- keyboard shortcuts).
 * Smoothly moves at a constant speed in world units per second.
 * Hold Shift to double the pan speed.
 */

import type { CameraState } from '../render/camera';

/** Camera pan speed in world units per second. */
const EDITOR_CAMERA_SPEED_WORLD = 200;

/** Multiplier applied when Shift is held. */
const SHIFT_SPEED_MULTIPLIER = 2;

/** Minimum editor zoom — broad room overview. */
export const MIN_EDITOR_ZOOM = 0.1;

/** Maximum editor zoom — individual native-resolution pixel editing. */
export const MAX_EDITOR_ZOOM = 16;

/** Multiplicative zoom factor applied per discrete zoom step (wheel notch or keypress). */
export const EDITOR_ZOOM_STEP = 1.25;

/** Clamps a zoom value to the editor's supported zoom range. */
export function clampEditorZoom(zoom: number): number {
  return Math.min(MAX_EDITOR_ZOOM, Math.max(MIN_EDITOR_ZOOM, zoom));
}

/**
 * Sets the editor camera's zoom to `targetZoom` (clamped to the editor zoom
 * range) while keeping the world point currently under
 * (anchorXPx, anchorYPx) stationary on screen — i.e. cursor-anchored zoom.
 *
 * `offsetXPx`/`offsetYPx` must be the camera offset for the *current* zoom
 * (see `getCameraOffset`), consistent with `screenX = worldX * zoom + offsetXPx`.
 *
 * This is the single authoritative function for mutating editor zoom —
 * all zoom input (wheel, keyboard) should route through it.
 */
export function setEditorZoom(
  camera: CameraState,
  targetZoom: number,
  anchorXPx: number,
  anchorYPx: number,
  offsetXPx: number,
  offsetYPx: number,
): void {
  const newZoom = clampEditorZoom(targetZoom);
  const oldZoom = camera.zoom;
  if (newZoom === oldZoom) return;

  // World point currently under the anchor (pre-zoom).
  const worldX = (anchorXPx - offsetXPx) / oldZoom;
  const worldY = (anchorYPx - offsetYPx) / oldZoom;

  // Viewport half-extent in px, derived from the current offset/center/zoom
  // (offsetXPx = viewportWidthPx * 0.5 - centerXWorld * zoom), so we don't
  // need the raw viewport dimensions here.
  const halfViewportXPx = offsetXPx + camera.centerXWorld * oldZoom;
  const halfViewportYPx = offsetYPx + camera.centerYWorld * oldZoom;

  camera.centerXWorld = worldX + (halfViewportXPx - anchorXPx) / newZoom;
  camera.centerYWorld = worldY + (halfViewportYPx - anchorYPx) / newZoom;
  camera.zoom = newZoom;
}

/**
 * Applies one frame's worth of zoom input (wheel + keyboard) to the editor
 * camera. Centralizes zoom mutation so callers never touch `camera.zoom`
 * directly.
 *
 * @param wheelDelta        Accumulated wheel notches this frame (+1 per scroll-down notch, -1 per scroll-up notch).
 * @param wheelZoomAllowed  Whether wheel zoom is permitted this frame (restricted to the Select tool).
 * @param isZoomInPressed   '+'/'=' pressed this frame (one-shot).
 * @param isZoomOutPressed  '-' pressed this frame (one-shot).
 * @param cursorAnchorXPx   Mouse position in virtual canvas px, used as the wheel-zoom anchor.
 * @param cursorAnchorYPx   Mouse position in virtual canvas px, used as the wheel-zoom anchor.
 * @param viewportCenterXPx Viewport center in virtual canvas px, used as the keyboard-zoom anchor.
 * @param viewportCenterYPx Viewport center in virtual canvas px, used as the keyboard-zoom anchor.
 * @param offsetXPx         Current camera offset (see `getCameraOffset`).
 * @param offsetYPx         Current camera offset (see `getCameraOffset`).
 */
export function applyEditorZoomInput(
  camera: CameraState,
  wheelDelta: number,
  wheelZoomAllowed: boolean,
  isZoomInPressed: boolean,
  isZoomOutPressed: boolean,
  cursorAnchorXPx: number,
  cursorAnchorYPx: number,
  viewportCenterXPx: number,
  viewportCenterYPx: number,
  offsetXPx: number,
  offsetYPx: number,
): void {
  if (wheelZoomAllowed && wheelDelta !== 0) {
    // Scroll up (negative delta) zooms in; scroll down zooms out.
    const factor = wheelDelta < 0 ? EDITOR_ZOOM_STEP : 1 / EDITOR_ZOOM_STEP;
    setEditorZoom(camera, camera.zoom * factor, cursorAnchorXPx, cursorAnchorYPx, offsetXPx, offsetYPx);
  }
  if (isZoomInPressed) {
    setEditorZoom(camera, camera.zoom * EDITOR_ZOOM_STEP, viewportCenterXPx, viewportCenterYPx, offsetXPx, offsetYPx);
  }
  if (isZoomOutPressed) {
    setEditorZoom(camera, camera.zoom / EDITOR_ZOOM_STEP, viewportCenterXPx, viewportCenterYPx, offsetXPx, offsetYPx);
  }
}

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
