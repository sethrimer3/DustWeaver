/**
 * Phase 2: Geometric grapple wrapping system.
 *
 * Handles dynamic rope wrapping around wall corners during a pendulum swing.
 * When the direct player→anchor segment is obstructed by a wall, a wrap point
 * is inserted at the nearest valid corner of the blocking wall, shortening the
 * active rope segment.  When line-of-sight to the previous anchor is restored,
 * the wrap point is removed (unwrapped).
 *
 * The main entry point is `tickGrappleWrapping`, called each tick from
 * `applyGrappleClusterConstraint` when `isGrappleWrappingEnabled === 1`.
 */

import { WorldState, MAX_GRAPPLE_WRAP_POINTS } from '../world';
import { ClusterState } from './state';
import { raycastWalls, GRAPPLE_MIN_LENGTH_WORLD } from './grappleShared';

// ============================================================================
// Constants
// ============================================================================

/**
 * Minimum world-unit distance from the player centre to a candidate wrap corner.
 * Corners closer than this are discarded to prevent degenerate short-rope behaviour.
 */
const GRAPPLE_WRAP_MIN_PLAYER_DIST_WORLD = 14.0;

/**
 * Minimum world-unit distance between consecutive wrap corners.
 * Prevents two wrap points from crowding the same geometric feature.
 */
const GRAPPLE_WRAP_MIN_WRAP_DIST_WORLD = 8.0;

/**
 * Distance (world units) by which each candidate wrap corner is offset outward
 * from the originating wall surface.  Prevents the constraint anchor from sitting
 * exactly on (or inside) the wall face under floating-point precision.
 */
const GRAPPLE_WRAP_CORNER_SKIN_WORLD = 0.6;

/**
 * LOS tolerance (world units) used when checking line-of-sight from a wrap
 * candidate to the player or to the previous anchor.  Rays that hit within
 * this distance of the target endpoint are treated as unobstructed.
 */
const GRAPPLE_WRAP_LOS_TOLERANCE_WORLD = 2.0;

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Returns true when a ray from (ox,oy) to (tx,ty) has clear line of sight —
 * i.e. no solid wall hits within (distance - tolerance) of the origin.
 */
function _grappleHasLOS(
  world: WorldState,
  ox: number, oy: number,
  tx: number, ty: number,
  tolerance: number,
): boolean {
  const dx = tx - ox;
  const dy = ty - oy;
  const distSq = dx * dx + dy * dy;
  if (distSq < 0.001) return true;
  const dist = Math.sqrt(distSq);
  const checkDist = dist - tolerance;
  if (checkDist <= 0) return true;
  const invDist = 1.0 / dist;
  const hit = raycastWalls(world, ox, oy, dx * invDist, dy * invDist, checkDist);
  return hit === null;
}

/**
 * Returns true when point (px, py) is strictly inside any solid wall AABB
 * (excluding the wall at skipWallIndex, and excluding platforms and bounce pads).
 */
function _grapplePointInSolid(world: WorldState, px: number, py: number, skipWallIndex: number): boolean {
  for (let wi = 0; wi < world.wallCount; wi++) {
    if (wi === skipWallIndex) continue;
    if (world.wallIsPlatformFlag[wi] === 1) continue;
    if (world.wallIsBouncePadFlag[wi] === 1) continue;
    const minX = world.wallXWorld[wi];
    const minY = world.wallYWorld[wi];
    const maxX = minX + world.wallWWorld[wi];
    const maxY = minY + world.wallHWorld[wi];
    if (px > minX && px < maxX && py > minY && py < maxY) return true;
  }
  return false;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Ticks the geometric wrapping system each pendulum frame:
 * 1. Check if the current player→active-anchor segment is obstructed.
 *    If so, pick a wall corner as a new wrap point.
 * 2. Check if the newest wrap point can be unwrapped (LOS from player to
 *    the previous anchor is clear).  If so, remove it.
 *
 * Updates grappleWrapPointCount, grappleWrapPointXWorld/Y, and
 * grappleLengthWorld when wrap points change.
 *
 * @param world  Mutable world state.
 * @param player The player ClusterState (passed in to avoid repeated lookup).
 */
export function tickGrappleWrapping(world: WorldState, player: ClusterState): void {
  const px = player.positionXWorld;
  const py = player.positionYWorld;
  let wrapCount = world.grappleWrapPointCount;

  // ── Safety: validate existing wrap points ────────────────────────────────
  // If any wrap point's originating wall is gone (breakable/crumble destroyed)
  // or if a wrap point has ended up inside solid geometry, clear all wraps and
  // fall back to normal grapple to avoid an invalid constraint.
  for (let wi = 0; wi < wrapCount; wi++) {
    const wallIdx = world.grappleWrapPointWallIndex[wi];
    if (wallIdx >= 0 && wallIdx < world.wallCount) {
      // Check that the wall is still solid (e.g. not a destroyed crumble block).
      // For now we rely on the wall still being in the array; breakable blocks
      // shrink the wall count when destroyed.  A stale index is safe to ignore.
    }
    // Check: if the wrap point is inside solid geometry it is invalid.
    if (_grapplePointInSolid(world, world.grappleWrapPointXWorld[wi], world.grappleWrapPointYWorld[wi], wallIdx)) {
      world.grappleWrapPointCount = 0;
      // Restore length to main-anchor distance.
      const dX = px - world.grappleAnchorXWorld;
      const dY = py - world.grappleAnchorYWorld;
      world.grappleLengthWorld = Math.max(
        GRAPPLE_MIN_LENGTH_WORLD,
        Math.sqrt(dX * dX + dY * dY),
      );
      return;
    }
  }
  wrapCount = world.grappleWrapPointCount; // reload after safety pass

  // ── Compute current active anchor ────────────────────────────────────────
  const activeAx = wrapCount > 0
    ? world.grappleWrapPointXWorld[wrapCount - 1]
    : world.grappleAnchorXWorld;
  const activeAy = wrapCount > 0
    ? world.grappleWrapPointYWorld[wrapCount - 1]
    : world.grappleAnchorYWorld;

  // ── Unwrap check: can we see the previous anchor directly? ────────────────
  // This is done before the wrap check so we don't immediately re-wrap after
  // unwrapping in the same tick.
  if (wrapCount > 0) {
    const prevAx = wrapCount > 1
      ? world.grappleWrapPointXWorld[wrapCount - 2]
      : world.grappleAnchorXWorld;
    const prevAy = wrapCount > 1
      ? world.grappleWrapPointYWorld[wrapCount - 2]
      : world.grappleAnchorYWorld;
    if (_grappleHasLOS(world, px, py, prevAx, prevAy, GRAPPLE_WRAP_LOS_TOLERANCE_WORLD)) {
      // Player can see the previous anchor — unwrap the newest wrap point.
      world.grappleWrapPointCount--;
      wrapCount--;
      // Update grappleLengthWorld to the new active segment distance.
      const newAx2 = wrapCount > 0
        ? world.grappleWrapPointXWorld[wrapCount - 1]
        : world.grappleAnchorXWorld;
      const newAy2 = wrapCount > 0
        ? world.grappleWrapPointYWorld[wrapCount - 1]
        : world.grappleAnchorYWorld;
      const uDx = px - newAx2;
      const uDy = py - newAy2;
      world.grappleLengthWorld = Math.max(
        GRAPPLE_MIN_LENGTH_WORLD,
        Math.sqrt(uDx * uDx + uDy * uDy),
      );
      return; // process at most one wrap change per tick to prevent flickering
    }
  }

  // ── Wrap check: is the active segment obstructed? ─────────────────────────
  if (wrapCount >= MAX_GRAPPLE_WRAP_POINTS) return; // already at capacity

  const dxToAnchor = activeAx - px;
  const dyToAnchor = activeAy - py;
  const distToAnchor = Math.sqrt(dxToAnchor * dxToAnchor + dyToAnchor * dyToAnchor);
  if (distToAnchor < GRAPPLE_WRAP_MIN_PLAYER_DIST_WORLD) return; // too close

  const checkDist = distToAnchor - GRAPPLE_WRAP_LOS_TOLERANCE_WORLD;
  if (checkDist <= 0) return;
  const invDist = 1.0 / distToAnchor;
  const hit = raycastWalls(
    world,
    px, py,
    dxToAnchor * invDist, dyToAnchor * invDist,
    checkDist,
  );
  if (hit === null) return; // clear LOS — no wrap needed

  // Must be a solid non-platform, non-bounce-pad wall.
  const hitWallIdx = hit.wallIndex;
  if (hitWallIdx < 0 || hitWallIdx >= world.wallCount) return;
  if (world.wallIsPlatformFlag[hitWallIdx] === 1) return;
  if (world.wallIsBouncePadFlag[hitWallIdx] === 1) return;
  // Ignore ramp walls for wrapping (geometry is ambiguous at corners of ramps).
  if (world.wallRampOrientationIndex[hitWallIdx] !== 255) return;

  // ── Select best corner of the blocking wall ───────────────────────────────
  const minX = world.wallXWorld[hitWallIdx];
  const minY = world.wallYWorld[hitWallIdx];
  const maxX = minX + world.wallWWorld[hitWallIdx];
  const maxY = minY + world.wallHWorld[hitWallIdx];

  // The 4 AABB corners with outward skin offsets.
  // Corner offset direction: inward from the center of the wall to ensure the
  // wrap point sits just outside the wall surface, not inside it.
  const skin = GRAPPLE_WRAP_CORNER_SKIN_WORLD;
  const corners: Array<{ cx: number; cy: number }> = [
    { cx: minX - skin, cy: minY - skin },
    { cx: maxX + skin, cy: minY - skin },
    { cx: minX - skin, cy: maxY + skin },
    { cx: maxX + skin, cy: maxY + skin },
  ];

  // Evaluate each corner and pick the best valid one (closest to the ray intersection).
  let bestCornerX = 0.0;
  let bestCornerY = 0.0;
  let bestDistSqToHit = Infinity;
  let foundCorner = false;

  for (let ci = 0; ci < corners.length; ci++) {
    const cx = corners[ci].cx;
    const cy = corners[ci].cy;

    // 1. Must not be inside another solid wall.
    if (_grapplePointInSolid(world, cx, cy, hitWallIdx)) continue;

    // 2. Must not be too close to the player.
    const pdx = cx - px;
    const pdy = cy - py;
    const pdistSq = pdx * pdx + pdy * pdy;
    if (pdistSq < GRAPPLE_WRAP_MIN_PLAYER_DIST_WORLD * GRAPPLE_WRAP_MIN_PLAYER_DIST_WORLD) continue;

    // 3. Must not be too close to the current newest wrap point (if any).
    if (wrapCount > 0) {
      const wpx = world.grappleWrapPointXWorld[wrapCount - 1];
      const wpy = world.grappleWrapPointYWorld[wrapCount - 1];
      const wdx = cx - wpx;
      const wdy = cy - wpy;
      if (wdx * wdx + wdy * wdy < GRAPPLE_WRAP_MIN_WRAP_DIST_WORLD * GRAPPLE_WRAP_MIN_WRAP_DIST_WORLD) continue;
    }

    // 4. Must have LOS to the player.
    if (!_grappleHasLOS(world, cx, cy, px, py, GRAPPLE_WRAP_LOS_TOLERANCE_WORLD)) continue;

    // 5. Must have LOS to the previous/main anchor.
    if (!_grappleHasLOS(world, cx, cy, activeAx, activeAy, GRAPPLE_WRAP_LOS_TOLERANCE_WORLD)) continue;

    // Score by squared distance from the ray hit point.
    const scX = cx - hit.x;
    const scY = cy - hit.y;
    const scoreSq = scX * scX + scY * scY;
    if (scoreSq < bestDistSqToHit) {
      bestDistSqToHit = scoreSq;
      bestCornerX = cx;
      bestCornerY = cy;
      foundCorner = true;
    }
  }

  if (!foundCorner) return;

  // ── Add the wrap point ─────────────────────────────────────────────────────
  world.grappleWrapPointXWorld[wrapCount]     = bestCornerX;
  world.grappleWrapPointYWorld[wrapCount]     = bestCornerY;
  world.grappleWrapPointWallIndex[wrapCount]  = hitWallIdx;
  world.grappleWrapPointCount                 = wrapCount + 1;

  // Update grappleLengthWorld to player → new wrap point distance.
  const wDx = px - bestCornerX;
  const wDy = py - bestCornerY;
  world.grappleLengthWorld = Math.max(
    GRAPPLE_MIN_LENGTH_WORLD,
    Math.sqrt(wDx * wDx + wDy * wDy),
  );
}
