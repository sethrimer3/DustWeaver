/**
 * viewportCull.ts — Reusable helpers for determining whether a world-space or
 * screen-space element intersects the visible camera viewport.
 *
 * All helpers are pure functions with no allocations.  Pass them the camera
 * offset (ox, oy), zoom, and virtual canvas dimensions (vpW, vpH) as computed
 * each frame from getCameraOffset().
 *
 * Coordinate conventions:
 *   World  — simulation units (1 unit = 1 virtual pixel at zoom 1.0)
 *   Screen — virtual canvas pixels (the 480×270 space before device upscale)
 */

// ── Screen-space culling ─────────────────────────────────────────────────────
// These are the cheapest variants — call them when screen-space (sx, sy)
// coordinates have already been computed.

/**
 * Returns true when the axis-aligned rectangle [sx, sy, sx+w, sy+h] overlaps
 * the viewport rectangle [0, 0, vpW, vpH].  Treats w/h as non-negative sizes.
 */
export function isScreenRectVisible(
  sx: number,
  sy: number,
  w: number,
  h: number,
  vpW: number,
  vpH: number,
): boolean {
  return sx + w > 0 && sx < vpW && sy + h > 0 && sy < vpH;
}

/**
 * Returns true when the circle at (cx, cy) with radius r overlaps the viewport.
 */
export function isScreenCircleVisible(
  cx: number,
  cy: number,
  r: number,
  vpW: number,
  vpH: number,
): boolean {
  return cx + r > 0 && cx - r < vpW && cy + r > 0 && cy - r < vpH;
}

// ── World-space culling ──────────────────────────────────────────────────────
// These convert from world units to screen pixels using the camera offset and
// zoom, then delegate to the screen-space variants.

/**
 * Returns true when the world-space AABB rooted at (wx, wy) with size (ww, wh)
 * overlaps the viewport.
 */
export function isWorldRectVisible(
  wx: number,
  wy: number,
  ww: number,
  wh: number,
  ox: number,
  oy: number,
  zoom: number,
  vpW: number,
  vpH: number,
): boolean {
  return isScreenRectVisible(
    wx * zoom + ox,
    wy * zoom + oy,
    ww * zoom,
    wh * zoom,
    vpW,
    vpH,
  );
}

/**
 * Returns true when the world-space circle at (cx, cy) with world-unit radius
 * rWorld overlaps the viewport.
 */
export function isWorldCircleVisible(
  cx: number,
  cy: number,
  rWorld: number,
  ox: number,
  oy: number,
  zoom: number,
  vpW: number,
  vpH: number,
): boolean {
  return isScreenCircleVisible(
    cx * zoom + ox,
    cy * zoom + oy,
    rWorld * zoom,
    vpW,
    vpH,
  );
}
