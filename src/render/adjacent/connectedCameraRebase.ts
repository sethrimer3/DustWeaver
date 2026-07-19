/**
 * connectedCameraRebase.ts — Pure render-coordinate rebase for connected-room
 * activation.
 *
 * When the active room changes through a *visible* connected transition, the
 * newly-active room must become the world-space origin (0,0) without visibly
 * moving anything on screen. If room A is the current origin, the destination
 * room B is being rendered at offset `O`, and the camera centre is `C`, then
 * after B becomes active:
 *
 *   - B becomes origin 0
 *   - A becomes adjacent at -O
 *   - the camera centre becomes  C - O
 *
 * This preserves the screen-space mapping `worldPosition + roomOrigin - camera`
 * for every point in both rooms across the rebase (see the invariant tests).
 *
 * This is intentionally a tiny pure module: the render-only room origin must not
 * be conflated with the simulation's room-local origin. Callers apply the
 * returned camera centre before the first gameplay frame after activation so the
 * scene stays continuous and no snap/black-flash occurs.
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/**
 * Rebase the camera centre for a connected activation where the destination was
 * being rendered at world offset `renderedOrigin` in the outgoing room's space.
 */
export function rebaseCameraCenter(cameraCenter: Vec2, renderedOrigin: Vec2): Vec2 {
  return {
    x: cameraCenter.x - renderedOrigin.x,
    y: cameraCenter.y - renderedOrigin.y,
  };
}

/**
 * Rebase an arbitrary world position from the outgoing room's origin frame into
 * the newly-active room's origin frame (the outgoing room now sits at
 * `-renderedOrigin`). Used to keep the outgoing entity-fade ghost anchored in
 * the correct room-space position after activation.
 */
export function rebaseWorldPosition(worldPosition: Vec2, renderedOrigin: Vec2): Vec2 {
  return {
    x: worldPosition.x - renderedOrigin.x,
    y: worldPosition.y - renderedOrigin.y,
  };
}

/**
 * Screen-space position of a world point given its room origin and the camera
 * centre: `worldPosition + roomOrigin - cameraCenter`. Provided so tests (and
 * callers) can assert the rebase invariant directly rather than re-deriving it.
 */
export function worldToScreenOffset(
  worldPosition: Vec2,
  roomOrigin: Vec2,
  cameraCenter: Vec2,
): Vec2 {
  return {
    x: worldPosition.x + roomOrigin.x - cameraCenter.x,
    y: worldPosition.y + roomOrigin.y - cameraCenter.y,
  };
}
