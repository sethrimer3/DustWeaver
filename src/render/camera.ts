/**
 * Camera system for the Metroidvania game.
 *
 * The camera follows the player cluster with a smooth lerp, zooms in
 * so the player fills more of the screen, and clamps to room bounds
 * so the viewport never shows the "void" outside a room.
 *
 * All state is pre-allocated — no per-frame object creation.
 */

/** Default camera zoom factor. 1.0× means 1 world unit = 1 virtual pixel. */
export const CAMERA_DEFAULT_ZOOM = 1.0;

/** Lerp speed per second (0 = no follow, 1 = instant snap). */
const CAMERA_FOLLOW_SPEED = 8.0;

export interface CameraState {
  /** Camera center X in world units. */
  centerXWorld: number;
  /** Camera center Y in world units. */
  centerYWorld: number;
  /** Zoom multiplier (world units → screen pixels). */
  zoom: number;
}

export function createCameraState(): CameraState {
  return {
    centerXWorld: 0,
    centerYWorld: 0,
    zoom: CAMERA_DEFAULT_ZOOM,
  };
}

/**
 * Snap the camera instantly to a target position (no lerp).
 * Used when loading a new room.
 */
export function snapCamera(
  camera: CameraState,
  targetXWorld: number,
  targetYWorld: number,
  roomWidthWorld: number,
  roomHeightWorld: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
): void {
  camera.centerXWorld = targetXWorld;
  camera.centerYWorld = targetYWorld;
  clampCameraToRoom(camera, roomWidthWorld, roomHeightWorld, viewportWidthPx, viewportHeightPx);
}

/**
 * Smoothly move the camera toward the target (player position).
 *
 * @param dtSec - frame delta time in seconds (NOT sim dtMs).
 */
export function updateCamera(
  camera: CameraState,
  targetXWorld: number,
  targetYWorld: number,
  roomWidthWorld: number,
  roomHeightWorld: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
  dtSec: number,
): void {
  const t = Math.min(1.0, CAMERA_FOLLOW_SPEED * dtSec);
  camera.centerXWorld += (targetXWorld - camera.centerXWorld) * t;
  camera.centerYWorld += (targetYWorld - camera.centerYWorld) * t;
  clampCameraToRoom(camera, roomWidthWorld, roomHeightWorld, viewportWidthPx, viewportHeightPx);
}

/**
 * Clamp the camera so the viewport stays within the room bounds.
 *
 * If the room is smaller than the viewport (at current zoom), the
 * camera centers on the room instead.
 */
function clampCameraToRoom(
  camera: CameraState,
  roomWidthWorld: number,
  roomHeightWorld: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
): void {
  const halfViewW = viewportWidthPx / (2 * camera.zoom);
  const halfViewH = viewportHeightPx / (2 * camera.zoom);

  if (roomWidthWorld <= halfViewW * 2) {
    camera.centerXWorld = roomWidthWorld * 0.5;
  } else {
    if (camera.centerXWorld < halfViewW) camera.centerXWorld = halfViewW;
    if (camera.centerXWorld > roomWidthWorld - halfViewW) camera.centerXWorld = roomWidthWorld - halfViewW;
  }

  if (roomHeightWorld <= halfViewH * 2) {
    camera.centerYWorld = roomHeightWorld * 0.5;
  } else {
    if (camera.centerYWorld < halfViewH) camera.centerYWorld = halfViewH;
    if (camera.centerYWorld > roomHeightWorld - halfViewH) camera.centerYWorld = roomHeightWorld - halfViewH;
  }
}

/**
 * Compute the screen-space offset needed to position world origin on
 * the canvas given the current camera state.
 *
 * Usage:
 *   screenX = worldX * zoom + offsetXPx
 *   screenY = worldY * zoom + offsetYPx
 */
export function getCameraOffset(
  camera: CameraState,
  viewportWidthPx: number,
  viewportHeightPx: number,
): { offsetXPx: number; offsetYPx: number } {
  return {
    offsetXPx: viewportWidthPx * 0.5 - camera.centerXWorld * camera.zoom,
    offsetYPx: viewportHeightPx * 0.5 - camera.centerYWorld * camera.zoom,
  };
}
