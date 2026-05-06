/**
 * Ramp surface collision resolver.
 *
 * Extracted from movementCollision.ts so that the rectangular-wall collision
 * module stays focused on axis-separated AABB resolution.  All logic and
 * comments are preserved verbatim from the original location.
 */

import type { WorldState } from '../world';
import type { ClusterState } from './state';
import { COLLISION_EPSILON } from './movementConstants';

/**
 * Ramp surface collision resolver.
 *
 * Called AFTER resolveClusterSolidWallCollision for each cluster.
 *
 * For each ramp wall whose AABB the cluster overlaps, computes the ramp surface
 * height at the cluster's clamped-center X and resolves the cluster against:
 *   • The diagonal (hypotenuse) surface — floor snap for ori 0/1, ceiling for ori 2/3.
 *   • The solid vertical side face of the filled triangle (left for ori 1/2, right for ori 0/3).
 *   • The solid horizontal bottom/top edge of the ramp AABB.
 *
 * Center X is clamped to [wallLeft, wallRight] so that when the cluster's center
 * overshoots the ramp boundary (only the edge still overlaps), the surface height
 * at the boundary matches the adjacent flush rectangular block — giving a smooth
 * seam instead of a snap or pop.
 *
 * @param prevXWorld  Cluster X position before velocity integration this tick.
 * @param prevYWorld  Cluster Y position before velocity integration this tick.
 * @returns true if the cluster landed on a floor ramp surface this tick.
 */
export function resolveRampSurfaces(
  cluster: ClusterState,
  world: WorldState,
  prevXWorld: number,
  prevYWorld: number,
): boolean {
  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;
  let landed = false;

  for (let wi = 0; wi < world.wallCount; wi++) {
    const ori = world.wallRampOrientationIndex[wi];
    if (ori === 255) continue; // not a ramp

    const wallLeft   = world.wallXWorld[wi];
    const wallTop    = world.wallYWorld[wi];
    const wallRight  = wallLeft + world.wallWWorld[wi];
    const wallBottom = wallTop + world.wallHWorld[wi];
    const wallWidth  = world.wallWWorld[wi];
    const wallHeight = world.wallHWorld[wi];

    const clusterLeft   = cluster.positionXWorld - hw;
    const clusterRight  = cluster.positionXWorld + hw;
    const clusterBottom = cluster.positionYWorld + hh;
    const clusterTop    = cluster.positionYWorld - hh;

    // Full AABB overlap check — previously center-X only, which caused the
    // cluster to "fall off" the ramp when its center crossed the ramp boundary
    // while part of its body was still overlapping.
    if (clusterRight <= wallLeft || clusterLeft >= wallRight
        || clusterBottom <= wallTop || clusterTop >= wallBottom) continue;

    // Clamp center X to ramp bounds for surface-height sampling.
    // When the cluster's center overshoots the boundary (only an edge overlaps),
    // clamping ensures the ramp surface equals the adjacent flush block's top,
    // giving a smooth transition without a visible seam or snap.
    const cx = Math.max(wallLeft, Math.min(wallRight, cluster.positionXWorld));
    const t = wallWidth > 0 ? (cx - wallLeft) / wallWidth : 0; // 0..1

    const isBouncePad = world.wallIsBouncePadFlag[wi] === 1;
    const bounceSf = isBouncePad ? (world.wallBouncePadSpeedFactorIndex[wi] === 1 ? 1.0 : 0.5) : 0.0;

    const rampDiag = Math.sqrt(wallWidth * wallWidth + wallHeight * wallHeight);

    const prevLeft   = prevXWorld - hw;
    const prevRight  = prevXWorld + hw;
    const prevBottom = prevYWorld + hh;
    const prevTop    = prevYWorld - hh;

    if (ori === 0) {
      // Rises going right (/): surface goes from wallBottom (left) to wallTop (right).
      // Solid triangle (lower-right): vertices (wallLeft,wallBottom), (wallRight,wallBottom),
      // (wallRight,wallTop).  Solid faces: diagonal surface, right side, bottom edge.
      const surfaceY = wallBottom - t * wallHeight;

      // ── Diagonal (top) surface ────────────────────────────────────────────
      let surfaceSnapped = false;
      if (clusterBottom >= surfaceY - COLLISION_EPSILON && cluster.velocityYWorld >= 0) {
        cluster.positionYWorld = surfaceY - hh;
        if (isBouncePad) {
          if (rampDiag > 0.001) {
            const nx = -wallHeight / rampDiag;
            const ny = -wallWidth / rampDiag;
            const vDotN = cluster.velocityXWorld * nx + cluster.velocityYWorld * ny;
            if (vDotN < 0) {
              cluster.velocityXWorld -= (1.0 + bounceSf) * vDotN * nx;
              cluster.velocityYWorld -= (1.0 + bounceSf) * vDotN * ny;
            }
          }
        } else {
          cluster.velocityYWorld = 0;
          cluster.isGroundedFlag = 1;
          landed = true;
        }
        surfaceSnapped = true;
      }

      if (!surfaceSnapped && !isBouncePad) {
        // ── Right solid face (x = wallRight, y ∈ [wallTop, wallBottom]) ─────
        // Only applies when the cluster's feet are below the ramp's top surface,
        // i.e. the cluster is in the solid region of the right face.
        if (clusterBottom > wallTop + COLLISION_EPSILON
            && clusterLeft < wallRight && clusterRight > wallRight
            && prevLeft >= wallRight - COLLISION_EPSILON) {
          cluster.positionXWorld = wallRight + hw;
          if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
          if (cluster.isPlayerFlag === 1) cluster.isTouchingWallLeftFlag = 1;
        }

        // ── Solid bottom face (y = wallBottom, x ∈ [wallLeft, wallRight]) ───
        if (clusterTop < wallBottom && clusterBottom > wallBottom
            && prevTop >= wallBottom - COLLISION_EPSILON
            && cluster.velocityYWorld <= 0) {
          cluster.positionYWorld = wallBottom + hh;
          if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
        }
      }

    } else if (ori === 1) {
      // Rises going left (\): surface goes from wallTop (left) to wallBottom (right).
      // Solid triangle (lower-left): vertices (wallLeft,wallTop), (wallLeft,wallBottom),
      // (wallRight,wallBottom).  Solid faces: diagonal surface, left side, bottom edge.
      const surfaceY = wallTop + t * wallHeight;

      // ── Diagonal (top) surface ────────────────────────────────────────────
      let surfaceSnapped = false;
      if (clusterBottom >= surfaceY - COLLISION_EPSILON && cluster.velocityYWorld >= 0) {
        cluster.positionYWorld = surfaceY - hh;
        if (isBouncePad) {
          if (rampDiag > 0.001) {
            const nx = wallHeight / rampDiag;
            const ny = -wallWidth / rampDiag;
            const vDotN = cluster.velocityXWorld * nx + cluster.velocityYWorld * ny;
            if (vDotN < 0) {
              cluster.velocityXWorld -= (1.0 + bounceSf) * vDotN * nx;
              cluster.velocityYWorld -= (1.0 + bounceSf) * vDotN * ny;
            }
          }
        } else {
          cluster.velocityYWorld = 0;
          cluster.isGroundedFlag = 1;
          landed = true;
        }
        surfaceSnapped = true;
      }

      if (!surfaceSnapped && !isBouncePad) {
        // ── Left solid face (x = wallLeft, y ∈ [wallTop, wallBottom]) ────────
        if (clusterBottom > wallTop + COLLISION_EPSILON
            && clusterLeft < wallLeft && clusterRight > wallLeft
            && prevRight <= wallLeft + COLLISION_EPSILON) {
          cluster.positionXWorld = wallLeft - hw;
          if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
          if (cluster.isPlayerFlag === 1) cluster.isTouchingWallRightFlag = 1;
        }

        // ── Solid bottom face (y = wallBottom, x ∈ [wallLeft, wallRight]) ───
        if (clusterTop < wallBottom && clusterBottom > wallBottom
            && prevTop >= wallBottom - COLLISION_EPSILON
            && cluster.velocityYWorld <= 0) {
          cluster.positionYWorld = wallBottom + hh;
          if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
        }
      }

    } else if (ori === 2) {
      // Ceiling ramp (⌐, upside-down /): ceiling goes from wallTop (left) to wallBottom (right).
      // Solid triangle (upper-left): vertices (wallLeft,wallTop), (wallRight,wallTop),
      // (wallLeft,wallBottom).  Solid faces: diagonal ceiling, left side, top edge.
      const surfaceY = wallTop + t * wallHeight;

      // ── Diagonal (bottom/ceiling) surface ─────────────────────────────────
      let surfaceSnapped = false;
      if (clusterTop <= surfaceY + COLLISION_EPSILON &&
          clusterTop >= surfaceY - hh - COLLISION_EPSILON &&
          cluster.velocityYWorld <= 0) {
        cluster.positionYWorld = surfaceY + hh;
        if (isBouncePad) {
          if (rampDiag > 0.001) {
            const nx = -wallHeight / rampDiag;
            const ny = wallWidth / rampDiag;
            const vDotN = cluster.velocityXWorld * nx + cluster.velocityYWorld * ny;
            if (vDotN < 0) {
              cluster.velocityXWorld -= (1.0 + bounceSf) * vDotN * nx;
              cluster.velocityYWorld -= (1.0 + bounceSf) * vDotN * ny;
            }
          }
        } else {
          if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
        }
        surfaceSnapped = true;
      }

      if (!surfaceSnapped && !isBouncePad) {
        // ── Left solid face (x = wallLeft, y ∈ [wallTop, wallBottom]) ────────
        if (clusterTop < wallBottom - COLLISION_EPSILON
            && clusterLeft < wallLeft && clusterRight > wallLeft
            && prevRight <= wallLeft + COLLISION_EPSILON) {
          cluster.positionXWorld = wallLeft - hw;
          if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
          if (cluster.isPlayerFlag === 1) cluster.isTouchingWallRightFlag = 1;
        }

        // ── Solid top face (y = wallTop, x ∈ [wallLeft, wallRight]) ──────────
        if (clusterBottom > wallTop && clusterTop < wallTop
            && prevBottom <= wallTop + COLLISION_EPSILON
            && cluster.velocityYWorld >= 0) {
          cluster.positionYWorld = wallTop - hh;
          cluster.velocityYWorld = 0;
          cluster.isGroundedFlag = 1;
          landed = true;
        }
      }

    } else if (ori === 3) {
      // Ceiling ramp (¬, upside-down \): ceiling goes from wallBottom (left) to wallTop (right).
      // Solid triangle (upper-right): vertices (wallLeft,wallTop), (wallRight,wallTop),
      // (wallRight,wallBottom).  Solid faces: diagonal ceiling, right side, top edge.
      const surfaceY = wallBottom - t * wallHeight;

      // ── Diagonal (bottom/ceiling) surface ─────────────────────────────────
      let surfaceSnapped = false;
      if (clusterTop <= surfaceY + COLLISION_EPSILON &&
          clusterTop >= surfaceY - hh - COLLISION_EPSILON &&
          cluster.velocityYWorld <= 0) {
        cluster.positionYWorld = surfaceY + hh;
        if (isBouncePad) {
          if (rampDiag > 0.001) {
            const nx = wallHeight / rampDiag;
            const ny = wallWidth / rampDiag;
            const vDotN = cluster.velocityXWorld * nx + cluster.velocityYWorld * ny;
            if (vDotN < 0) {
              cluster.velocityXWorld -= (1.0 + bounceSf) * vDotN * nx;
              cluster.velocityYWorld -= (1.0 + bounceSf) * vDotN * ny;
            }
          }
        } else {
          if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
        }
        surfaceSnapped = true;
      }

      if (!surfaceSnapped && !isBouncePad) {
        // ── Right solid face (x = wallRight, y ∈ [wallTop, wallBottom]) ─────
        if (clusterTop < wallBottom - COLLISION_EPSILON
            && clusterLeft < wallRight && clusterRight > wallRight
            && prevLeft >= wallRight - COLLISION_EPSILON) {
          cluster.positionXWorld = wallRight + hw;
          if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
          if (cluster.isPlayerFlag === 1) cluster.isTouchingWallLeftFlag = 1;
        }

        // ── Solid top face (y = wallTop, x ∈ [wallLeft, wallRight]) ──────────
        if (clusterBottom > wallTop && clusterTop < wallTop
            && prevBottom <= wallTop + COLLISION_EPSILON
            && cluster.velocityYWorld >= 0) {
          cluster.positionYWorld = wallTop - hh;
          cluster.velocityYWorld = 0;
          cluster.isGroundedFlag = 1;
          landed = true;
        }
      }
    }
  }
  return landed;
}
