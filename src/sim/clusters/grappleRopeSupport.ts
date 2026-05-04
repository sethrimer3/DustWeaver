/**
 * Rope segment grapple support.
 *
 * Provides two utilities for the grapple system to interact with dynamic rope
 * chains (Verlet-simulated ropes placed in the level):
 *
 *   raycastRopeSegments  — sweeps a ray against all rope capsule chains and
 *                          returns the nearest hit within a max distance.
 *                          Used by fireGrapple to let the player attach their
 *                          grapple hook to a swaying rope segment.
 *
 *   updateGrappleRopeAnchor — called once per tick (after tickRopes) when the
 *                          grapple is attached to a rope segment.  Keeps the
 *                          grapple anchor tracking the rope as it sways so the
 *                          pendulum swing follows the dynamic attachment point.
 */

import { WorldState, MAX_ROPE_SEGMENTS } from '../world';

/** Small epsilon for rope-segment raycast distance comparisons. */
const ROPE_RAYCAST_EPSILON = 0.001;

/** Describes a hit point on a rope capsule surface. */
export interface RopeHitResult {
  /** World X of the hit point on the rope capsule surface. */
  hitX: number;
  /** World Y of the hit point on the rope capsule surface. */
  hitY: number;
  /** Travel distance from ray origin to hit point. */
  distWorld: number;
  /** Index of the rope that was hit. */
  ropeIndex: number;
  /** Float segment index (e.g. 2.7 = 70 % along segment 2→3). */
  segF: number;
}

/**
 * Casts a ray from (ox, oy) in direction (dirX, dirY) and tests it against
 * all rope capsule chains.  Returns the nearest hit within maxDist, or null.
 *
 * Each rope segment is modelled as a capsule (cylinder with hemispherical caps)
 * of radius ropeHalfThickWorld.  The 2D ray-vs-capsule test used here is:
 *   1. Ray vs. infinite cylinder (line segment) → two potential entry/exit t values.
 *   2. Clamp t to [0, 1] along the segment and keep the closest entry.
 *   3. Take the minimum across all segments.
 */
export function raycastRopeSegments(
  world: WorldState,
  ox: number,
  oy: number,
  dirX: number,
  dirY: number,
  maxDist: number,
): RopeHitResult | null {
  let bestDist = maxDist;
  let bestResult: RopeHitResult | null = null;

  for (let r = 0; r < world.ropeCount; r++) {
    const segCount = world.ropeSegmentCount[r];
    if (segCount < 2) continue;
    const halfThick = world.ropeHalfThickWorld[r];
    const base = r * MAX_ROPE_SEGMENTS;

    for (let s = 0; s < segCount - 1; s++) {
      const ax = world.ropeSegPosXWorld[base + s];
      const ay = world.ropeSegPosYWorld[base + s];
      const bx = world.ropeSegPosXWorld[base + s + 1];
      const by = world.ropeSegPosYWorld[base + s + 1];

      // 2D ray-vs-capsule algorithm:
      //   1. Find the point P* on segment [A, B] closest to the ray origin,
      //      parameterised as t_seg ∈ [0,1]: P* = A + t_seg·S.
      //   2. Express P* in ray-relative coordinates: cp = P* - O.
      //   3. Decompose cp into a radial component along the ray direction and a
      //      perpendicular component.  The perpendicular distance is the minimum
      //      distance from the ray to the capsule axis at P*.
      //   4. If perpDist < R (capsule radius), compute the entry t along the ray
      //      using the standard circle-intersection formula: tEntry = cpDotDir - √(R²-perpDist²).
      // This gives a tight capsule hit without building a full swept-volume test.
      const segDx = bx - ax;
      const segDy = by - ay;
      const rdx = ox - ax;
      const rdy = oy - ay;

      // Closest point on ray to closest point on segment.
      const segLenSq = segDx * segDx + segDy * segDy;
      if (segLenSq < ROPE_RAYCAST_EPSILON) continue;

      // Step 1: t_seg — closest point on the segment to the ray origin.
      const t_seg = Math.max(0.0, Math.min(1.0,
        (rdx * segDx + rdy * segDy) / segLenSq,
      ));
      // cp = P* - O (P* in ray-relative coords)
      const cpx = ax + t_seg * segDx - ox;
      const cpy = ay + t_seg * segDy - oy;

      // Step 2–3: project cp onto ray direction; compute perpendicular distance.
      const cpDotDir = cpx * dirX + cpy * dirY;
      const perpX = cpx - cpDotDir * dirX;
      const perpY = cpy - cpDotDir * dirY;
      const perpDistSq = perpX * perpX + perpY * perpY;

      if (perpDistSq > halfThick * halfThick) continue;

      // Step 4: entry t along ray.
      const offset = Math.sqrt(halfThick * halfThick - perpDistSq);
      const tEntry = cpDotDir - offset;

      if (tEntry < ROPE_RAYCAST_EPSILON || tEntry >= bestDist) continue;

      // Valid hit
      bestDist = tEntry;
      bestResult = {
        hitX:       ox + dirX * tEntry,
        hitY:       oy + dirY * tEntry,
        distWorld:  tEntry,
        ropeIndex:  r,
        segF:       s + t_seg,
      };
    }
  }

  return bestResult;
}

/**
 * Updates the grapple anchor world position from the moving rope segment it is
 * attached to.  Called once per tick (after tickRopes) when grappleRopeIndex >= 0.
 *
 * This keeps the grapple anchor point moving with the rope as it sways,
 * so the player swings naturally from the dynamic rope segment position.
 */
export function updateGrappleRopeAnchor(world: WorldState): void {
  if (world.grappleRopeIndex < 0) return;
  if (world.isGrappleActiveFlag === 0) {
    world.grappleRopeIndex = -1;
    return;
  }

  const r = world.grappleRopeIndex;
  if (r >= world.ropeCount) {
    world.grappleRopeIndex = -1;
    return;
  }

  const segCount = world.ropeSegmentCount[r];
  const base = r * MAX_ROPE_SEGMENTS;
  const segF = world.grappleRopeAttachSegF;
  const si = Math.min(Math.floor(segF), segCount - 2);
  const frac = segF - si;

  const ax = world.ropeSegPosXWorld[base + si];
  const ay = world.ropeSegPosYWorld[base + si];
  const bx = world.ropeSegPosXWorld[base + si + 1];
  const by = world.ropeSegPosYWorld[base + si + 1];

  world.grappleAnchorXWorld = ax + (bx - ax) * frac;
  world.grappleAnchorYWorld = ay + (by - ay) * frac;
}
