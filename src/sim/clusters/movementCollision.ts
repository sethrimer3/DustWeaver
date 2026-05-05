/**
 * Collision helper functions for cluster movement.
 *
 * Extracted from movement.ts so the main movement module stays focused on
 * input handling and physics integration.  Every function here was previously
 * a module-private helper inside movement.ts — signatures, logic, and
 * doc-comments are preserved verbatim.
 *
 * ── Collision-safe movement layer ────────────────────────────────────────────
 *
 * `ClusterMoveResult` and `moveClusterByDelta` form a lightweight reusable
 * collision-safe movement path inspired by Celeste/TowerFall: all forced or
 * special movement (grapple constraint correction, future knockback, etc.)
 * should move through this helper instead of directly assigning positions and
 * then trying to fix the result with a minimum-penetration fallback.
 *
 * Usage contract:
 *   - The helper moves the cluster from its CURRENT position by (deltaX, deltaY).
 *   - It restores the caller's velocity after the move, so the caller controls
 *     what velocity ends up on the cluster after the call.
 *   - Wall-touch flags (isTouchingWallLeftFlag / isTouchingWallRightFlag) may be
 *     mutated as a side effect if the cluster is the player — callers should
 *     reset them beforehand if that matters.
 *
 * ── Future moving-platform notes (not yet implemented) ───────────────────────
 *
 * When moving solids are added, extend this layer as follows:
 *   1. isRiding(cluster, solid): returns true when cluster is standing on the
 *      solid's top surface — used to carry actors with the platform.
 *   2. Push before carry: each tick, push all actors out of the solid's new AABB
 *      first (displacing them), THEN move riding actors with the platform delta.
 *   3. Squish / obstruction: if a pushed actor would be displaced into another
 *      solid, mark it as squished (kill or bounce it).
 *   4. Carried actors use moveClusterByDelta so they still respect other geometry
 *      even while being carried.
 *   5. Collision iteration order must remain deterministic (same wall index order
 *      each tick) so moving-platform pushes are reproducible.
 */

import type { WorldState } from '../world';
import type { ClusterState } from './state';
import {
  COLLISION_EPSILON,
  BLOCK_POP_MAX_PIXELS,
  JUMP_CORNER_CORRECTION_PIXELS,
  WALL_JUMP_PROXIMITY_PIXELS,
  debugSpeedOverrides,
  ov,
} from './movementConstants';

/** Set to true to log bounce pad events to the console for debugging. */
const DEBUG_BOUNCE_PADS = false;

/**
 * Module-private scratch object used to propagate bounce information through the
 * collision pass without per-tick heap allocation.
 * Cleared at the start of every resolveClusterSolidWallCollision call.
 */
interface BounceScratch {
  bouncedX: boolean;
  bouncedY: boolean;
  restitutionX: number;
  restitutionY: number;
}
const bounceScratch: BounceScratch = {
  bouncedX: false, bouncedY: false,
  restitutionX: 0, restitutionY: 0,
};

/**
 * Emits a bounce pad diagnostic line to the console when DEBUG_BOUNCE_PADS is
 * enabled.  Calling this after the velocity has been updated means
 * cluster.velocityXWorld / velocityYWorld already hold the outgoing values.
 *
 * @param cluster      The cluster that bounced (only logs for player clusters).
 * @param axis         Which axis was bounced ('x' or 'y').
 * @param restitution  The restitution coefficient that was applied.
 * @param incomingVel  The velocity component on the bounce axis before reflection.
 */
function logBouncePadHit(
  cluster: ClusterState,
  axis: 'x' | 'y',
  restitution: number,
  incomingVel: number,
): void {
  if (!DEBUG_BOUNCE_PADS || cluster.isPlayerFlag !== 1) return;
  const outVX = cluster.velocityXWorld.toFixed(1);
  const outVY = cluster.velocityYWorld.toFixed(1);
  if (axis === 'x') {
    const inVY = cluster.velocityYWorld.toFixed(1);
    console.log(`[BouncePad] axis=x restitution=${restitution.toFixed(2)} incoming=(${incomingVel.toFixed(1)}, ${inVY}) outgoing=(${outVX}, ${outVY})`);
  } else {
    const inVX = cluster.velocityXWorld.toFixed(1);
    console.log(`[BouncePad] axis=y restitution=${restitution.toFixed(2)} incoming=(${inVX}, ${incomingVel.toFixed(1)}) outgoing=(${outVX}, ${outVY})`);
  }
}


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

/**
 * Tests whether the player AABB at (posX, posY) overlaps any solid (non-platform,
 * non-ramp) wall.  Used for forgiveness collision probes so that corrections do
 * not push the player into adjacent solid geometry.
 */
function hasSolidWallOverlapAtPosition(
  cluster: ClusterState,
  world: WorldState,
  posX: number,
  posY: number,
): boolean {
  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;
  const left = posX - hw;
  const right = posX + hw;
  const top = posY - hh;
  const bottom = posY + hh;

  for (let wi = 0; wi < world.wallCount; wi++) {
    if (world.wallIsPlatformFlag[wi] === 1) continue;
    if (world.wallRampOrientationIndex[wi] !== 255) continue;
    const wallLeft = world.wallXWorld[wi];
    const wallTop = world.wallYWorld[wi];
    const wallRight = wallLeft + world.wallWWorld[wi];
    const wallBottom = wallTop + world.wallHWorld[wi];
    if (right <= wallLeft || left >= wallRight || bottom <= wallTop || top >= wallBottom) continue;
    return true;
  }
  return false;
}

/**
 * Jump corner correction: when the player is moving upward and bonks the
 * underside corner of a solid block, attempt to nudge the player horizontally
 * by up to JUMP_CORNER_CORRECTION_PIXELS so the jump continues cleanly.
 *
 * Only applies to the player, only on upward motion, and only when the nudged
 * position would be completely collision-free.  The direction of horizontal
 * velocity is preferred; if near zero, both sides are tested.
 *
 * Returns true if a correction was applied (caller should skip the normal
 * ceiling velocity-zero response for this wall).
 */
function tryJumpCornerCorrection(
  cluster: ClusterState,
  world: WorldState,
  wallIndex: number,
): boolean {
  if (cluster.isPlayerFlag === 0) return false;
  if (cluster.velocityYWorld >= 0) return false; // only for upward motion

  const wallLeft  = world.wallXWorld[wallIndex];
  const wallRight = wallLeft + world.wallWWorld[wallIndex];
  const hw = cluster.halfWidthWorld;
  const maxCorrection = ov(debugSpeedOverrides.jumpCornerCorrectionPixels, JUMP_CORNER_CORRECTION_PIXELS);

  // Prefer the direction the player is already moving horizontally.
  const preferRight = cluster.velocityXWorld >= 0;

  for (let offset = 1; offset <= maxCorrection; offset++) {
    const dx1 = preferRight ? offset : -offset;
    const dx2 = preferRight ? -offset : offset;

    for (let pass = 0; pass < 2; pass++) {
      const dx = pass === 0 ? dx1 : dx2;
      const testX = cluster.positionXWorld + dx;
      const testLeft  = testX - hw;
      const testRight = testX + hw;

      // If the nudged box no longer overlaps this wall horizontally, the ceiling
      // collision is cleared for this wall.
      const stillOverlapsCeiling = testRight > wallLeft && testLeft < wallRight;
      if (stillOverlapsCeiling) continue;

      // Verify no other solid wall is hit at the nudged position.
      // (The ceiling wall itself is excluded by the horizontal overlap check above.)
      if (!hasSolidWallOverlapAtPosition(cluster, world, testX, cluster.positionYWorld)) {
        cluster.positionXWorld = testX;
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns the gap distance (world units) between the player AABB and the nearest
 * solid wall on each side, clamped to WALL_JUMP_PROXIMITY_PIXELS.
 * Returns Infinity when no wall is within proximity on a given side.
 *
 * Used to implement the wide wall-jump window: the player can initiate a wall
 * jump even when slightly away from a wall face.
 */
export function getNearbyWallForWallJump(
  cluster: ClusterState,
  world: WorldState,
): { nearLeftDistWorld: number; nearRightDistWorld: number } {
  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;
  const posX = cluster.positionXWorld;
  const posY = cluster.positionYWorld;
  const proximity = ov(debugSpeedOverrides.wallJumpProximityPixels, WALL_JUMP_PROXIMITY_PIXELS);

  const top    = posY - hh;
  const bottom = posY + hh;
  const playerLeft  = posX - hw;
  const playerRight = posX + hw;

  let nearLeftDistWorld  = Infinity;
  let nearRightDistWorld = Infinity;

  for (let wi = 0; wi < world.wallCount; wi++) {
    if (world.wallIsPlatformFlag[wi] === 1) continue;
    if (world.wallRampOrientationIndex[wi] !== 255) continue;

    const wallLeft   = world.wallXWorld[wi];
    const wallTop    = world.wallYWorld[wi];
    const wallRight  = wallLeft + world.wallWWorld[wi];
    const wallBottom = wallTop + world.wallHWorld[wi];

    // Require vertical overlap with the player box.
    if (bottom <= wallTop || top >= wallBottom) continue;

    // Left side: wall face is to the player's left and within proximity.
    const leftGap = playerLeft - wallRight;
    if (leftGap >= 0 && leftGap <= proximity) {
      nearLeftDistWorld = Math.min(nearLeftDistWorld, leftGap);
    }

    // Right side: wall face is to the player's right and within proximity.
    const rightGap = wallLeft - playerRight;
    if (rightGap >= 0 && rightGap <= proximity) {
      nearRightDistWorld = Math.min(nearRightDistWorld, rightGap);
    }
  }

  return { nearLeftDistWorld, nearRightDistWorld };
}

function tryStepUpSingleBlock(
  cluster: ClusterState,
  world: WorldState,
  wallTopWorld: number,
  requiredInputDirX: -1 | 1,
  wasGrounded: boolean,
): boolean {
  if (cluster.isPlayerFlag === 0) return false;
  if (cluster.velocityYWorld < 0) return false; // never when rising
  if (cluster.isFastFallModeFlag === 1) return false; // not during fast fall
  // Apply only when grounded OR falling (not while airborne and stationary/rising).
  const isFalling = cluster.velocityYWorld > 0;
  if (!wasGrounded && !isFalling) return false;

  const inputDxWorld = world.playerMoveInputDxWorld;
  if (inputDxWorld * requiredInputDirX <= 0) return false;

  const playerBottomWorld = cluster.positionYWorld + cluster.halfHeightWorld;
  const stepUpHeightWorld = playerBottomWorld - wallTopWorld;
  const maxPopPixels = ov(debugSpeedOverrides.blockPopMaxPixels, BLOCK_POP_MAX_PIXELS);
  if (stepUpHeightWorld <= 0 || stepUpHeightWorld > maxPopPixels) return false;

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
  wasGrounded: boolean,
  bounceScratch: BounceScratch,
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

    const isBounce = world.wallIsBouncePadFlag[wi] === 1;
    // Speed factor for bounce: index 0 → 50 %, index 1 → 100 %
    const bounceSf = isBounce ? (world.wallBouncePadSpeedFactorIndex[wi] === 1 ? 1.0 : 0.5) : 0.0;

    // Determine push direction from previous position
    if (prevRight <= wallLeft + COLLISION_EPSILON) {
      if (!isBounce && tryStepUpSingleBlock(cluster, world, wallTop, 1, wasGrounded)) continue;
      // Was to the left of wall — push out left
      cluster.positionXWorld = wallLeft - hw;
      if (isBounce) {
        if (cluster.velocityXWorld > 0) {
          const inVX = cluster.velocityXWorld;
          cluster.velocityXWorld = -inVX * bounceSf;
          bounceScratch.bouncedX = true;
          bounceScratch.restitutionX = bounceSf;
          logBouncePadHit(cluster, 'x', bounceSf, inVX);
        }
      } else {
        if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
        if (cluster.isPlayerFlag === 1) cluster.isTouchingWallRightFlag = 1;
      }
    } else if (prevLeft >= wallRight - COLLISION_EPSILON) {
      if (!isBounce && tryStepUpSingleBlock(cluster, world, wallTop, -1, wasGrounded)) continue;
      // Was to the right of wall — push out right
      cluster.positionXWorld = wallRight + hw;
      if (isBounce) {
        if (cluster.velocityXWorld < 0) {
          const inVX = cluster.velocityXWorld;
          cluster.velocityXWorld = -inVX * bounceSf;
          bounceScratch.bouncedX = true;
          bounceScratch.restitutionX = bounceSf;
          logBouncePadHit(cluster, 'x', bounceSf, inVX);
        }
      } else {
        if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
        if (cluster.isPlayerFlag === 1) cluster.isTouchingWallLeftFlag = 1;
      }
    } else {
      // Fallback: push out on the shortest X-axis direction.
      // Edge case where cluster was already overlapping on X at start of tick, e.g. spawn.
      const penLeft  = right - wallLeft;
      const penRight = wallRight - left;
      if (penLeft < penRight) {
        cluster.positionXWorld = wallLeft - hw;
        if (isBounce) {
          if (cluster.velocityXWorld > 0) {
            const inVX = cluster.velocityXWorld;
            cluster.velocityXWorld = -inVX * bounceSf;
            bounceScratch.bouncedX = true;
            bounceScratch.restitutionX = bounceSf;
            logBouncePadHit(cluster, 'x', bounceSf, inVX);
          }
        } else {
          if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
          if (cluster.isPlayerFlag === 1) cluster.isTouchingWallRightFlag = 1;
        }
      } else {
        cluster.positionXWorld = wallRight + hw;
        if (isBounce) {
          if (cluster.velocityXWorld < 0) {
            const inVX = cluster.velocityXWorld;
            cluster.velocityXWorld = -inVX * bounceSf;
            bounceScratch.bouncedX = true;
            bounceScratch.restitutionX = bounceSf;
            logBouncePadHit(cluster, 'x', bounceSf, inVX);
          }
        } else {
          if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
          if (cluster.isPlayerFlag === 1) cluster.isTouchingWallLeftFlag = 1;
        }
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
  bounceScratch: BounceScratch,
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

    const isBounce = world.wallIsBouncePadFlag[wi] === 1;
    const bounceSf = isBounce ? (world.wallBouncePadSpeedFactorIndex[wi] === 1 ? 1.0 : 0.5) : 0.0;

    // Determine push direction from previous position
    if (prevBottom <= wallTop + COLLISION_EPSILON && cluster.velocityYWorld >= 0) {
      // Was above wall — land on top
      cluster.positionYWorld = wallTop - hh;
      if (isBounce) {
        const inVY = cluster.velocityYWorld;
        cluster.velocityYWorld = -inVY * bounceSf;
        // Do NOT set isGroundedFlag — player cannot ground-jump off a bounce pad
        bounceScratch.bouncedY = true;
        bounceScratch.restitutionY = bounceSf;
        logBouncePadHit(cluster, 'y', bounceSf, inVY);
      } else {
        cluster.velocityYWorld = 0;
        cluster.isGroundedFlag = 1;
        landed = true;
      }
    } else if (prevTop >= wallBottom - COLLISION_EPSILON && cluster.velocityYWorld <= 0) {
      // Was below wall — bonked ceiling moving upward.
      // Attempt jump corner correction before committing to the ceiling response.
      if (!isBounce && tryJumpCornerCorrection(cluster, world, wi)) {
        // Corner was cleared — skip velocity zeroing for this wall and continue.
        continue;
      }
      // Normal ceiling response.
      cluster.positionYWorld = wallBottom + hh;
      if (isBounce) {
        if (cluster.velocityYWorld < 0) {
          const inVY = cluster.velocityYWorld;
          cluster.velocityYWorld = -inVY * bounceSf;
          bounceScratch.bouncedY = true;
          bounceScratch.restitutionY = bounceSf;
          logBouncePadHit(cluster, 'y', bounceSf, inVY);
        }
      } else {
        if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
      }
    } else {
      // Fallback: push out on the shortest Y-axis direction.
      // Edge case where cluster was already overlapping on Y at start of tick, e.g. spawn.
      const penTop    = bottom - wallTop;
      const penBottom = wallBottom - top;
      if (penTop < penBottom) {
        cluster.positionYWorld = wallTop - hh;
        if (isBounce) {
          const inVY = cluster.velocityYWorld;
          cluster.velocityYWorld = -inVY * bounceSf;
          bounceScratch.bouncedY = true;
          bounceScratch.restitutionY = bounceSf;
          logBouncePadHit(cluster, 'y', bounceSf, inVY);
        } else {
          cluster.velocityYWorld = 0;
          cluster.isGroundedFlag = 1;
          landed = true;
        }
      } else {
        cluster.positionYWorld = wallBottom + hh;
        if (isBounce) {
          if (cluster.velocityYWorld < 0) {
            const inVY = cluster.velocityYWorld;
            cluster.velocityYWorld = -inVY * bounceSf;
            bounceScratch.bouncedY = true;
            bounceScratch.restitutionY = bounceSf;
            logBouncePadHit(cluster, 'y', bounceSf, inVY);
          }
        } else {
          if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
        }
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
 * Returns a SolidWallCollisionResult with landing and bounce information.
 */
export function resolveClusterSolidWallCollision(
  cluster: ClusterState,
  world: WorldState,
  prevX: number,
  prevY: number,
  dtSec: number,
  wasGrounded: boolean,
): SolidWallCollisionResult {
  // Reset bounce tracking for this sweep.
  bounceScratch.bouncedX = false;
  bounceScratch.bouncedY = false;
  bounceScratch.restitutionX = 0;
  bounceScratch.restitutionY = 0;

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
    resolveWallsX(cluster, world, subPrevX, wasGrounded, bounceScratch);
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
    if (resolveWallsY(cluster, world, subPrevY, bounceScratch)) {
      landed = true;
    }
  }

  return {
    landed,
    bouncedX: bounceScratch.bouncedX,
    bouncedY: bounceScratch.bouncedY,
    bounceRestitutionX: bounceScratch.restitutionX,
    bounceRestitutionY: bounceScratch.restitutionY,
  };
}

/**
 * Structured result returned by resolveClusterSolidWallCollision.
 */
export interface SolidWallCollisionResult {
  /** Cluster landed on a top surface this tick. */
  landed: boolean;
  /** A bounce pad was hit on the X axis (left or right face). */
  bouncedX: boolean;
  /** A bounce pad was hit on the Y axis (top or bottom face). */
  bouncedY: boolean;
  /** Restitution applied to the X-axis bounce (0 if no X bounce). */
  bounceRestitutionX: number;
  /** Restitution applied to the Y-axis bounce (0 if no Y bounce). */
  bounceRestitutionY: number;
}

/**
 * Structured result returned by moveClusterByDelta.
 * Tells the caller which axes were blocked and whether the cluster landed.
 *
 * All booleans are set relative to the requested delta direction:
 *   collidedLeft  — blocked while moving left  (deltaX < 0 and X was stopped)
 *   collidedRight — blocked while moving right (deltaX > 0 and X was stopped)
 *   collidedAbove — blocked while moving up    (deltaY < 0 and Y was stopped)
 *   collidedBelow — blocked while moving down  (deltaY > 0 and Y was stopped)
 *   landed        — cluster landed on a top surface this move (implies collidedBelow)
 *   blockedX      — X axis reached less than requested displacement (any direction)
 *   blockedY      — Y axis reached less than requested displacement (any direction)
 *
 * Bounce fields (only meaningful when bounced is true):
 *   bounced                — a bounce pad was contacted during the sweep
 *   bounceRestitutionX     — restitution for X-axis bounce (0 if none)
 *   bounceRestitutionY     — restitution for Y-axis bounce (0 if none)
 *   reflectedVelocityXWorld — reflected real velocity X after applying restitution
 *   reflectedVelocityYWorld — reflected real velocity Y after applying restitution
 */
export interface ClusterMoveResult {
  collidedLeft: boolean;
  collidedRight: boolean;
  collidedAbove: boolean;
  collidedBelow: boolean;
  landed: boolean;
  blockedX: boolean;
  blockedY: boolean;
  bounced: boolean;
  bounceRestitutionX: number;
  bounceRestitutionY: number;
  reflectedVelocityXWorld: number;
  reflectedVelocityYWorld: number;
}

/**
 * Collision-safe movement helper.
 *
 * Moves the cluster from its CURRENT position by (deltaXWorld, deltaYWorld)
 * using the same axis-separated, sub-stepped collision logic as normal movement.
 * Returns a ClusterMoveResult describing what was contacted.
 *
 * This function:
 *   - Applies the caller's velocity after the sweep.  When a bounce pad is
 *     contacted the affected axis velocity is replaced with the reflected real
 *     velocity (-savedVel * restitution); on non-bounced axes the saved velocity
 *     is restored unchanged.  Callers should inspect ClusterMoveResult.bounced
 *     and act on the reflected velocity if needed (e.g. release a grapple).
 *   - Does NOT call resolveRampSurfaces — callers that need ramp landing
 *     should call that separately.
 *   - Preserves all side effects of resolveClusterSolidWallCollision
 *     (wall-touch flags, isGroundedFlag updates) as a by-product of the sweep.
 *
 * Typical use: forced position corrections (grapple constraint snap, future
 * knockback) that must not clip through walls.  Normal per-tick movement should
 * continue to call resolveClusterSolidWallCollision directly.
 *
 * @param cluster     The cluster to move.
 * @param world       Current world state.
 * @param deltaXWorld Desired X displacement this step (world units).
 * @param deltaYWorld Desired Y displacement this step (world units).
 * @param wasGrounded Whether the cluster was grounded before this move.
 * @param dtSec       Tick duration in seconds (used to convert delta → velocity
 *                    for the sweep; sub-step count is derived from this).
 *                    Pass the current frame's dtSec; never 0.
 */
export function moveClusterByDelta(
  cluster: ClusterState,
  world: WorldState,
  deltaXWorld: number,
  deltaYWorld: number,
  wasGrounded: boolean,
  dtSec: number,
): ClusterMoveResult {
  // Guard: zero-delta is a no-op.
  if (deltaXWorld === 0 && deltaYWorld === 0) {
    return {
      collidedLeft: false, collidedRight: false,
      collidedAbove: false, collidedBelow: false,
      landed: false, blockedX: false, blockedY: false,
      bounced: false, bounceRestitutionX: 0, bounceRestitutionY: 0,
      reflectedVelocityXWorld: 0, reflectedVelocityYWorld: 0,
    };
  }

  const startX = cluster.positionXWorld;
  const startY = cluster.positionYWorld;

  // Save the caller's velocity — we temporarily overwrite it to drive the sweep.
  // If no bounce occurs, it is fully restored after the sweep.
  // If a bounce occurs on an axis, the reflected velocity (based on the REAL
  // pre-impact velocity) replaces the saved value on that axis.
  const savedVelX = cluster.velocityXWorld;
  const savedVelY = cluster.velocityYWorld;

  // Convert displacement to velocity so that (velocity × dtSec) == delta,
  // which is what resolveClusterSolidWallCollision integrates per axis.
  const invDt = dtSec > 0.00001 ? 1.0 / dtSec : 0;
  cluster.velocityXWorld = deltaXWorld * invDt;
  cluster.velocityYWorld = deltaYWorld * invDt;

  const swResult = resolveClusterSolidWallCollision(
    cluster, world, startX, startY, dtSec, wasGrounded,
  );

  const actualDeltaX = cluster.positionXWorld - startX;
  const actualDeltaY = cluster.positionYWorld - startY;

  // Determine final velocity for the cluster.
  // If a bounce occurred, reflect the REAL pre-impact velocity on the bounced
  // axis so high-speed forced movement (e.g. grapple swing) produces a proper
  // elastic response rather than a tiny "pop" based on the synthetic delta velocity.
  const bounced = swResult.bouncedX || swResult.bouncedY;
  const finalVelXWorld = swResult.bouncedX ? -savedVelX * swResult.bounceRestitutionX : savedVelX;
  const finalVelYWorld = swResult.bouncedY ? -savedVelY * swResult.bounceRestitutionY : savedVelY;
  cluster.velocityXWorld = finalVelXWorld;
  cluster.velocityYWorld = finalVelYWorld;

  // A displacement axis is "blocked" when the cluster moved measurably less
  // than requested.  Threshold of 0.5 wu absorbs float rounding without
  // masking real collisions (the smallest wall is BLOCK_SIZE_SMALL = 3 wu).
  const blockedX = Math.abs(actualDeltaX - deltaXWorld) > 0.5;
  const blockedY = Math.abs(actualDeltaY - deltaYWorld) > 0.5;

  return {
    collidedLeft:  blockedX && deltaXWorld < 0,
    collidedRight: blockedX && deltaXWorld > 0,
    collidedAbove: blockedY && deltaYWorld < 0,
    collidedBelow: blockedY && deltaYWorld > 0 || swResult.landed,
    landed: swResult.landed,
    blockedX,
    blockedY,
    bounced,
    bounceRestitutionX: swResult.bounceRestitutionX,
    bounceRestitutionY: swResult.bounceRestitutionY,
    reflectedVelocityXWorld: finalVelXWorld,
    reflectedVelocityYWorld: finalVelYWorld,
  };
}


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
