/**
 * Collision helper functions for cluster movement.
 *
 * Extracted from movement.ts so the main movement module stays focused on
 * input handling and physics integration.  Every function here was previously
 * a module-private helper inside movement.ts — signatures, logic, and
 * doc-comments are preserved verbatim.
 */

import type { WorldState } from '../world';
import type { ClusterState } from './state';
import { COLLISION_EPSILON } from './movementConstants';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';

/** Maximum auto step-up height (single block only). */
const PLAYER_STEP_UP_MAX_HEIGHT_WORLD = BLOCK_SIZE_SMALL;

function hasWallOverlapAtPosition(
  cluster: ClusterState,
  world: WorldState,
  positionXWorld: number,
  positionYWorld: number,
): boolean {
  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;
  const left = positionXWorld - hw;
  const right = positionXWorld + hw;
  const top = positionYWorld - hh;
  const bottom = positionYWorld + hh;

  for (let wi = 0; wi < world.wallCount; wi++) {
    const wallLeft = world.wallXWorld[wi];
    const wallTop = world.wallYWorld[wi];
    const wallRight = wallLeft + world.wallWWorld[wi];
    const wallBottom = wallTop + world.wallHWorld[wi];
    if (right <= wallLeft || left >= wallRight || bottom <= wallTop || top >= wallBottom) continue;
    return true;
  }
  return false;
}

function tryStepUpSingleBlock(
  cluster: ClusterState,
  world: WorldState,
  wallTopWorld: number,
  requiredInputDirX: -1 | 1,
): boolean {
  if (cluster.isPlayerFlag === 0) return false;
  if (cluster.velocityYWorld < 0) return false;

  const inputDxWorld = world.playerMoveInputDxWorld;
  if (inputDxWorld * requiredInputDirX <= 0) return false;

  const playerBottomWorld = cluster.positionYWorld + cluster.halfHeightWorld;
  const stepUpHeightWorld = playerBottomWorld - wallTopWorld;
  if (stepUpHeightWorld <= 0 || stepUpHeightWorld > PLAYER_STEP_UP_MAX_HEIGHT_WORLD) return false;

  const targetYWorld = wallTopWorld - cluster.halfHeightWorld;
  if (hasWallOverlapAtPosition(cluster, world, cluster.positionXWorld, targetYWorld)) return false;

  cluster.positionYWorld = targetYWorld;
  cluster.velocityYWorld = 0;
  cluster.isGroundedFlag = 1;
  return true;
}

/**
 * Resolves the cluster box against the world floor.
 * Sets isGroundedFlag to 1 when a floor landing is found.
 * Returns true if the cluster landed this tick.
 */
export function resolveClusterFloorCollision(cluster: ClusterState, world: WorldState): boolean {
  const hh = cluster.halfHeightWorld;
  const clusterBottom = cluster.positionYWorld + hh;

  // ── World floor ───────────────────────────────────────────────────────────
  const floorY = world.worldHeightWorld;
  if (clusterBottom >= floorY) {
    cluster.positionYWorld = floorY - hh;
    cluster.velocityYWorld = 0;
    cluster.isGroundedFlag = 1;
    return true;
  }

  // World floor only. Solid wall collisions (including top landings) are
  // handled by axis-separated wall sweeps in resolveClusterSolidWallCollision.
  return false;
}

/** Clears grounded state before collision passes rebuild it for this tick. */
export function resetClusterGroundedFlag(cluster: ClusterState): void {
  cluster.isGroundedFlag = 0;
}

/**
 * X-axis collision pass: resolve all wall overlaps on X only.
 * Pushes cluster left/right out of walls and zeros velX on contact.
 * Sets isTouchingWallLeftFlag / isTouchingWallRightFlag for player.
 * Platform walls (wallIsPlatformFlag=1) are skipped — no side collision.
 * Ramp walls (wallRampOrientationIndex !== 255) are skipped — handled by resolveRampSurfaces.
 */
export function resolveWallsX(
  cluster: ClusterState,
  world: WorldState,
  prevXWorld: number,
): void {
  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;

  for (let wi = 0; wi < world.wallCount; wi++) {
    // Platforms and ramps have no horizontal collision
    if (world.wallIsPlatformFlag[wi] === 1) continue;
    if (world.wallRampOrientationIndex[wi] !== 255) continue;

    const wallLeft   = world.wallXWorld[wi];
    const wallTop    = world.wallYWorld[wi];
    const wallRight  = wallLeft + world.wallWWorld[wi];
    const wallBottom = wallTop + world.wallHWorld[wi];

    const left   = cluster.positionXWorld - hw;
    const right  = cluster.positionXWorld + hw;
    const top    = cluster.positionYWorld - hh;
    const bottom = cluster.positionYWorld + hh;

    // Skip if no overlap
    if (right <= wallLeft || left >= wallRight || bottom <= wallTop || top >= wallBottom) continue;

    const prevRight = prevXWorld + hw;
    const prevLeft  = prevXWorld - hw;

    // Determine push direction from previous position
    if (prevRight <= wallLeft + COLLISION_EPSILON) {
      if (tryStepUpSingleBlock(cluster, world, wallTop, 1)) continue;
      // Was to the left of wall — push out left
      cluster.positionXWorld = wallLeft - hw;
      if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
      if (cluster.isPlayerFlag === 1) cluster.isTouchingWallRightFlag = 1;
    } else if (prevLeft >= wallRight - COLLISION_EPSILON) {
      if (tryStepUpSingleBlock(cluster, world, wallTop, -1)) continue;
      // Was to the right of wall — push out right
      cluster.positionXWorld = wallRight + hw;
      if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
      if (cluster.isPlayerFlag === 1) cluster.isTouchingWallLeftFlag = 1;
    } else {
      // Fallback: push out on the shortest X-axis direction.
      // Edge case where cluster was already overlapping on X at start of tick, e.g. spawn.
      const penLeft  = right - wallLeft;
      const penRight = wallRight - left;
      if (penLeft < penRight) {
        cluster.positionXWorld = wallLeft - hw;
        if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
        if (cluster.isPlayerFlag === 1) cluster.isTouchingWallRightFlag = 1;
      } else {
        cluster.positionXWorld = wallRight + hw;
        if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
        if (cluster.isPlayerFlag === 1) cluster.isTouchingWallLeftFlag = 1;
      }
    }
  }
}

/**
 * Y-axis collision pass: resolve all wall overlaps on Y only.
 * Pushes cluster up/down out of walls and zeros velY on contact.
 * Sets isGroundedFlag when landing on a top face.
 * Platform walls (wallIsPlatformFlag=1) only collide from the configured edge.
 * Ramp walls (wallRampOrientationIndex !== 255) are skipped — handled by resolveRampSurfaces.
 * Returns true if the cluster landed on a top surface.
 */
export function resolveWallsY(
  cluster: ClusterState,
  world: WorldState,
  prevYWorld: number,
): boolean {
  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;
  let landed = false;

  for (let wi = 0; wi < world.wallCount; wi++) {
    // Skip ramps — handled by resolveRampSurfaces
    if (world.wallRampOrientationIndex[wi] !== 255) continue;

    const wallLeft   = world.wallXWorld[wi];
    const wallTop    = world.wallYWorld[wi];
    const wallRight  = wallLeft + world.wallWWorld[wi];
    const wallBottom = wallTop + world.wallHWorld[wi];

    const left   = cluster.positionXWorld - hw;
    const right  = cluster.positionXWorld + hw;
    const top    = cluster.positionYWorld - hh;
    const bottom = cluster.positionYWorld + hh;

    // Skip if no overlap
    if (right <= wallLeft || left >= wallRight || bottom <= wallTop || top >= wallBottom) continue;

    const prevBottom = prevYWorld + hh;

    if (world.wallIsPlatformFlag[wi] === 1) {
      const edge = world.wallPlatformEdge[wi];
      if (edge === 1) {
        // Bottom-edge platform: land on bottom surface when moving up
        const prevTop = prevYWorld - hh;
        if (prevTop >= wallBottom - COLLISION_EPSILON && cluster.velocityYWorld <= 0) {
          cluster.positionYWorld = wallBottom + hh;
          if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
        }
      } else {
        // Top-edge platform (default): only land on top surface when falling
        if (prevBottom <= wallTop + COLLISION_EPSILON && cluster.velocityYWorld >= 0) {
          cluster.positionYWorld = wallTop - hh;
          cluster.velocityYWorld = 0;
          cluster.isGroundedFlag = 1;
          landed = true;
        }
      }
      // Left/right platforms (edge 2 or 3) are not currently implemented as
      // special collision surfaces; they fall through to the top-edge platform
      // handling above (which does nothing for them since prevBottom and
      // velocityYWorld conditions won't typically match). This is intentional:
      // left/right platform edges are a visual/data feature reserved for future
      // directional one-way wall support.
      continue;
    }

    const prevTop    = prevYWorld - hh;

    // Determine push direction from previous position
    if (prevBottom <= wallTop + COLLISION_EPSILON && cluster.velocityYWorld >= 0) {
      // Was above wall — land on top
      cluster.positionYWorld = wallTop - hh;
      cluster.velocityYWorld = 0;
      cluster.isGroundedFlag = 1;
      landed = true;
    } else if (prevTop >= wallBottom - COLLISION_EPSILON && cluster.velocityYWorld <= 0) {
      // Was below wall — push down
      cluster.positionYWorld = wallBottom + hh;
      if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
    } else {
      // Fallback: push out on the shortest Y-axis direction.
      // Edge case where cluster was already overlapping on Y at start of tick, e.g. spawn.
      const penTop    = bottom - wallTop;
      const penBottom = wallBottom - top;
      if (penTop < penBottom) {
        cluster.positionYWorld = wallTop - hh;
        cluster.velocityYWorld = 0;
        cluster.isGroundedFlag = 1;
        landed = true;
      } else {
        cluster.positionYWorld = wallBottom + hh;
        if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
      }
    }
  }
  return landed;
}

/**
 * Axis-separated sweep collision resolver with sub-tick safety.
 *
 * Two-pass approach:
 *   X pass: apply velX, resolve all X overlaps.
 *   Y pass: apply velY, resolve all Y overlaps.
 *
 * Each axis is sub-stepped if the movement distance exceeds half the
 * cluster's dimension on that axis, preventing tunneling through thin
 * walls at high speed (e.g. sprint-boost through a BLOCK_SIZE_SMALL = 3 unit wall).
 *
 * Returns true if the cluster landed on a top surface this tick.
 */
export function resolveClusterSolidWallCollision(
  cluster: ClusterState,
  world: WorldState,
  prevX: number,
  prevY: number,
  dtSec: number,
): boolean {
  // Restore position to pre-integration state — we re-integrate per axis.
  cluster.positionXWorld = prevX;
  cluster.positionYWorld = prevY;

  // ── X pass with sub-tick safety ──────────────────────────────────────────
  const moveDistXWorld = Math.abs(cluster.velocityXWorld * dtSec);
  const stepsX = moveDistXWorld > cluster.halfWidthWorld
    ? Math.ceil(moveDistXWorld / cluster.halfWidthWorld)
    : 1;
  const dtX = dtSec / stepsX;
  for (let i = 0; i < stepsX; i++) {
    const subPrevX = cluster.positionXWorld;
    cluster.positionXWorld += cluster.velocityXWorld * dtX;
    resolveWallsX(cluster, world, subPrevX);
  }

  // ── Y pass with sub-tick safety ──────────────────────────────────────────
  const moveDistYWorld = Math.abs(cluster.velocityYWorld * dtSec);
  const stepsY = moveDistYWorld > cluster.halfHeightWorld
    ? Math.ceil(moveDistYWorld / cluster.halfHeightWorld)
    : 1;
  const dtY = dtSec / stepsY;
  let landed = false;
  for (let i = 0; i < stepsY; i++) {
    const subPrevY = cluster.positionYWorld;
    cluster.positionYWorld += cluster.velocityYWorld * dtY;
    if (resolveWallsY(cluster, world, subPrevY)) {
      landed = true;
    }
  }

  return landed;
}

/**
 * Ramp surface collision resolver.
 * Called AFTER resolveClusterSolidWallCollision for each cluster.
 *
 * For each ramp wall the cluster overlaps horizontally, computes the ramp
 * surface height at the cluster's center X and pushes the cluster up onto
 * the surface if its feet are at or below it (floor ramps, ori 0 and 1).
 * For ceiling ramps (ori 2 and 3), pushes the cluster down off the surface
 * if its head is at or above it.
 *
 * Returns true if the cluster landed on a floor ramp surface this tick.
 */
export function resolveRampSurfaces(cluster: ClusterState, world: WorldState): boolean {
  const hh = cluster.halfHeightWorld;
  const hw = cluster.halfWidthWorld;
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

    // Quick horizontal bounds check
    if (clusterRight <= wallLeft || clusterLeft >= wallRight) continue;

    // Clamp cluster center to wall x range for surface height computation
    const cx = cluster.positionXWorld < wallLeft ? wallLeft
      : cluster.positionXWorld > wallRight ? wallRight
      : cluster.positionXWorld;
    const t = wallWidth > 0 ? (cx - wallLeft) / wallWidth : 0; // 0..1

    if (ori === 0) {
      // Rises going right (/): surface at x goes from wallBottom (left) to wallTop (right)
      // y_surface = wallBottom - t * wallHeight
      const surfaceY = wallBottom - t * wallHeight;
      if (clusterBottom >= surfaceY - COLLISION_EPSILON &&
          clusterBottom <= surfaceY + wallHeight + hh * 2 &&
          cluster.velocityYWorld >= 0) {
        cluster.positionYWorld = surfaceY - hh;
        cluster.velocityYWorld = 0;
        cluster.isGroundedFlag = 1;
        landed = true;
      }
    } else if (ori === 1) {
      // Rises going left (\): surface at x goes from wallTop (left) to wallBottom (right)
      // y_surface = wallTop + t * wallHeight
      const surfaceY = wallTop + t * wallHeight;
      if (clusterBottom >= surfaceY - COLLISION_EPSILON &&
          clusterBottom <= surfaceY + wallHeight + hh * 2 &&
          cluster.velocityYWorld >= 0) {
        cluster.positionYWorld = surfaceY - hh;
        cluster.velocityYWorld = 0;
        cluster.isGroundedFlag = 1;
        landed = true;
      }
    } else if (ori === 2) {
      // Ceiling ramp (⌐, upside-down /): ceiling goes from wallTop (left) to wallBottom (right)
      const surfaceY = wallTop + t * wallHeight;
      if (clusterTop <= surfaceY + COLLISION_EPSILON &&
          clusterTop >= surfaceY - wallHeight - hh * 2 &&
          cluster.velocityYWorld <= 0) {
        cluster.positionYWorld = surfaceY + hh;
        if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
      }
    } else if (ori === 3) {
      // Ceiling ramp (¬, upside-down \): ceiling goes from wallBottom (left) to wallTop (right)
      const surfaceY = wallBottom - t * wallHeight;
      if (clusterTop <= surfaceY + COLLISION_EPSILON &&
          clusterTop >= surfaceY - wallHeight - hh * 2 &&
          cluster.velocityYWorld <= 0) {
        cluster.positionYWorld = surfaceY + hh;
        if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
      }
    }
  }
  return landed;
}
