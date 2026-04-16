/**
 * Shared AABB and geometry collision utilities for the simulation layer.
 *
 * Pure TypeScript — no DOM or browser dependencies.
 */

/**
 * Returns true if the axis-aligned bounding box centred at (cx, cy) with
 * half-extents (hw, hh) overlaps the AABB defined by (left, top, right, bottom).
 */
export function overlapAABB(
  cx: number, cy: number, hw: number, hh: number,
  left: number, top: number, right: number, bottom: number,
): boolean {
  return cx + hw > left && cx - hw < right && cy + hh > top && cy - hh < bottom;
}

/**
 * Minimum-penetration AABB push-out for a cluster against a static wall.
 * Mutates `cluster.positionXWorld`, `cluster.positionYWorld`,
 * `cluster.velocityXWorld`, `cluster.velocityYWorld` when an overlap exists.
 * Returns `true` if a resolution was applied, `false` if no overlap.
 *
 * NOTE: This is a last-resort minimum-penetration resolver. Prefer the
 * axis-separated sweep (resolveClusterSolidWallCollision) for primary
 * resolution. See ARCHITECTURE.md §Collision.
 */
export function resolveAABBPenetration(
  cluster: {
    positionXWorld: number; positionYWorld: number;
    velocityXWorld: number; velocityYWorld: number;
  },
  halfW: number,
  halfH: number,
  wLeft: number, wTop: number, wRight: number, wBottom: number,
): boolean {
  const pLeft   = cluster.positionXWorld - halfW;
  const pRight  = cluster.positionXWorld + halfW;
  const pTop    = cluster.positionYWorld - halfH;
  const pBottom = cluster.positionYWorld + halfH;

  if (!(pRight > wLeft && pLeft < wRight && pBottom > wTop && pTop < wBottom)) {
    return false;
  }

  const overlapLeft   = pRight  - wLeft;
  const overlapRight  = wRight  - pLeft;
  const overlapTop    = pBottom - wTop;
  const overlapBottom = wBottom - pTop;
  const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

  if (minOverlap === overlapTop) {
    cluster.positionYWorld = wTop - halfH;
    if (cluster.velocityYWorld > 0) cluster.velocityYWorld = 0;
  } else if (minOverlap === overlapBottom) {
    cluster.positionYWorld = wBottom + halfH;
    if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
  } else if (minOverlap === overlapLeft) {
    cluster.positionXWorld = wLeft - halfW;
    if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
  } else {
    cluster.positionXWorld = wRight + halfW;
    if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
  }
  return true;
}

/**
 * Returns the closest point on segment AB to point P, along with its
 * squared distance. All coordinates are in world units.
 */
export function closestPointOnSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): { xWorld: number; yWorld: number; distSq: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq < 0.001) {
    return { xWorld: ax, yWorld: ay, distSq: apx * apx + apy * apy };
  }
  let t = (apx * abx + apy * aby) / abLenSq;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const xWorld = ax + t * abx;
  const yWorld = ay + t * aby;
  const dx = px - xWorld;
  const dy = py - yWorld;
  return { xWorld, yWorld, distSq: dx * dx + dy * dy };
}
