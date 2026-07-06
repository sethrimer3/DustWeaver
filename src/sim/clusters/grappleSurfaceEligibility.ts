/**
 * grappleSurfaceEligibility.ts — gameplay eligibility filter layered on top
 * of the authoritative geometric `SurfaceExposureMap`
 * (src/sim/world/surfaceExposure.ts).
 *
 * This is the "active/visible surface eligibility" layer described in that
 * module: the base map only knows geometry (solid tile + in-bounds air
 * neighbour). Whether a given exposed side should currently be highlighted
 * or grapple-targetable additionally depends on dynamic state — range,
 * facing, and line-of-sight today; darkness/forbidden-material/etc. can be
 * added here later without touching the base map.
 *
 * `src/render/grappleInfluenceRenderer.ts` (the golden edge-glow highlight)
 * and `src/sim/clusters/grapple.ts` (`fireGrapple`, via `raycastWalls`) are
 * the two current consumers of grapple surface truth. They are not yet
 * unified on a single code path — `fireGrapple` still raycasts against
 * merged wall rects rather than walking `SurfaceSegment`s — but both should
 * eventually route eligibility decisions through `isSurfaceEligibleForGrapple`
 * so highlight and attach never disagree about what counts as a valid
 * surface.
 *
 * TODO(surface-exposure): once `fireGrapple` needs stricter surface
 * validation (not just "did the raycast hit something"), cross-check its
 * hit tile against `isSurfaceEligibleForGrapple` using the same
 * `SurfaceExposureMap` the highlight renderer already builds, instead of
 * inventing a second geometric check.
 */

import type { SurfaceSegment } from '../world/surfaceExposure';

export interface GrappleEligibilityState {
  readonly playerXWorld: number;
  readonly playerYWorld: number;
  /** Squared max range (world units) — segments farther than this are ineligible. */
  readonly maxRangeWorldSq: number;
  /**
   * Returns true if nothing solid blocks the straight line from the player
   * to (xWorld, yWorld). Callers typically implement this against their own
   * wall-rect occlusion test; kept as a callback so this module never needs
   * to know about wall geometry representations.
   */
  hasLineOfSight(xWorld: number, yWorld: number): boolean;
}

/** Clamps (px, py) onto the segment from (x0,y0) to (x1,y1) and returns the closest point. */
function closestPointOnSegment(
  px: number, py: number,
  x0: number, y0: number, x1: number, y1: number,
): { x: number; y: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: x0, y: y0 };
  let t = ((px - x0) * dx + (py - y0) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return { x: x0 + t * dx, y: y0 + t * dy };
}

/**
 * Determines whether a geometrically-exposed surface segment is currently
 * eligible for grapple targeting/highlighting.
 *
 * A segment is eligible iff:
 *   1. The player is on the outward-normal side of the surface (i.e. facing
 *      the exposed face, not somehow behind it) — this preserves the
 *      "player must be on the correct side" rule the legacy edge-glow
 *      renderer enforced per-edge.
 *   2. The closest point on the segment is within `state.maxRangeWorldSq`.
 *   3. The straight line from the player to that closest point is not
 *      occluded, per `state.hasLineOfSight`.
 *
 * This function never looks at wall geometry directly — it only trusts the
 * segment's own normal/endpoints (from the base geometric map) plus the
 * caller-supplied dynamic state, keeping geometry and eligibility cleanly
 * separated.
 */
export function isSurfaceEligibleForGrapple(
  segment: SurfaceSegment,
  state: GrappleEligibilityState,
): boolean {
  const closest = closestPointOnSegment(
    state.playerXWorld, state.playerYWorld,
    segment.x0, segment.y0, segment.x1, segment.y1,
  );

  const toPlayerX = state.playerXWorld - closest.x;
  const toPlayerY = state.playerYWorld - closest.y;

  // Player must be strictly on the exposed (outward-normal) side of the surface.
  if (segment.normalX !== 0 && toPlayerX * segment.normalX <= 0) return false;
  if (segment.normalY !== 0 && toPlayerY * segment.normalY <= 0) return false;

  const distSq = toPlayerX * toPlayerX + toPlayerY * toPlayerY;
  if (distSq > state.maxRangeWorldSq) return false;

  if (!state.hasLineOfSight(closest.x, closest.y)) return false;

  return true;
}
