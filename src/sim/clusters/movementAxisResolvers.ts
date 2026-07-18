/**
 * Axis-separated wall collision resolvers.
 *
 * Extracted from movementCollision.ts to keep the orchestration layer
 * (`resolveClusterSolidWallCollision`, `moveClusterByDelta`) separate from
 * the per-axis sweep implementations.
 *
 * Exports:
 *   - `BounceScratch`          — shared mutable scratch for bounce tracking
 *   - `hasWallOverlapAtPosition` — broad overlap query (also used by callers
 *                                  that need a position probe before committing)
 *   - `resolveWallsX`          — X-axis sweep pass
 *   - `resolveWallsY`          — Y-axis sweep pass
 */

import type { WorldState } from '../world';
import type { ClusterState } from './state';
import {
  COLLISION_EPSILON,
  BLOCK_POP_MAX_PIXELS,
  JUMP_CORNER_CORRECTION_PIXELS,
  debugSpeedOverrides,
  ov,
} from './movementConstants';
import { KINETIC_BLOCK_BOOST_SPEED_WORLD } from '../kineticBlocks/kineticBlockTypes';
import { aabbOverlapsWallSolid } from '../stairsWorldGeometry';
import { isPlainRectOrientationIndex, isRampOrientationIndex } from '../../levels/stairsGeometry';

/** Set to true to log bounce pad events to the console for debugging. */
const DEBUG_BOUNCE_PADS = false;

// ── Bounce scratch ────────────────────────────────────────────────────────────

/**
 * Module-private scratch object used to propagate bounce information through
 * the collision pass without per-tick heap allocation.
 * Cleared at the start of every resolveClusterSolidWallCollision call.
 */
export interface BounceScratch {
  bouncedX: boolean;
  bouncedY: boolean;
  restitutionX: number;
  restitutionY: number;
}

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

// ── Wall overlap queries ──────────────────────────────────────────────────────

/**
 * Returns true when the cluster's AABB at (positionXWorld, positionYWorld)
 * overlaps any wall (including platforms and ramps).
 * Used for step-up and position-probe checks before committing a position.
 *
 * Stair walls are tested against their individual step rectangles, not their
 * bounding box — otherwise a step-up onto a stair's lowest tread would be
 * rejected by the empty space above the higher steps.
 */
export function hasWallOverlapAtPosition(
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
    if (aabbOverlapsWallSolid(world, wi, left, top, right, bottom)) return true;
  }
  return false;
}

/**
 * Tests whether the player AABB at (posX, posY) overlaps any solid wall.
 * Used for forgiveness collision probes so that corrections do not push the
 * player into adjacent solid geometry.
 *
 * Platforms are excluded (they are one-way) and legacy ramps are excluded
 * (their diagonal is resolved separately). Stairs ARE included, tested against
 * their step rectangles.
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
    if (isRampOrientationIndex(world.wallRampOrientationIndex[wi])) continue;
    if (aabbOverlapsWallSolid(world, wi, left, top, right, bottom)) return true;
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
  wallLeft: number,
  wallRight: number,
): boolean {
  if (cluster.isPlayerFlag === 0) return false;
  if (cluster.velocityYWorld >= 0) return false; // only for upward motion

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
 * Block step-up: when the player walks into a wall whose top edge is at most
 * BLOCK_POP_MAX_PIXELS below the player's feet, pop the player over the wall
 * instead of stopping them.  Only for grounded or falling players moving in the
 * direction of the wall.  Returns true if the step-up was applied.
 */
export function tryStepUpSingleBlock(
  cluster: ClusterState,
  world: WorldState,
  wallLeftWorld: number,
  wallRightWorld: number,
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

  // Reject step-up if this wall segment isn't the top of its stack — i.e. another
  // segment sits directly above it (a seam), which would make wallTopWorld a false
  // "top edge" in the middle of a tall stacked wall.
  if (isWallSegmentBelowAnotherWall(world, wallLeftWorld, wallRightWorld, wallTopWorld)) return false;

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
 * True if some other wall segment sits directly above [wallLeft, wallRight) at
 * wallTopWorld (its bottom edge meets wallTopWorld) and overlaps horizontally —
 * i.e. wallTopWorld is a seam between stacked segments, not the true top of the wall.
 */
function isWallSegmentBelowAnotherWall(
  world: WorldState,
  wallLeftWorld: number,
  wallRightWorld: number,
  wallTopWorld: number,
): boolean {
  for (let wi = 0; wi < world.wallCount; wi++) {
    if (world.wallIsPlatformFlag[wi] === 1) continue;
    if (!isPlainRectOrientationIndex(world.wallRampOrientationIndex[wi])) continue;

    const otherLeft   = world.wallXWorld[wi];
    const otherRight  = otherLeft + world.wallWWorld[wi];
    const otherBottom = world.wallYWorld[wi] + world.wallHWorld[wi];

    if (Math.abs(otherBottom - wallTopWorld) > COLLISION_EPSILON) continue;
    if (otherRight <= wallLeftWorld || otherLeft >= wallRightWorld) continue;
    return true;
  }
  return false;
}

// ── Axis resolvers ────────────────────────────────────────────────────────────

/**
 * X-axis collision pass: resolve all wall overlaps on X only.
 * Pushes cluster left/right out of walls and zeros velX on contact.
 * Sets isTouchingWallLeftFlag / isTouchingWallRightFlag for player.
 * Platform walls (wallIsPlatformFlag=1) are skipped — no side collision.
 * Shaped walls are skipped: legacy ramps are handled by `resolveRampSurfaces`,
 * stairs by `resolveStairsSurfaces`.
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
    // Platforms and shaped walls (ramps, stairs) have no plain horizontal collision
    if (world.wallIsPlatformFlag[wi] === 1) continue;
    if (!isPlainRectOrientationIndex(world.wallRampOrientationIndex[wi])) continue;

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

    const isBounce  = world.wallIsBouncePadFlag[wi] === 1;
    const isKinetic = world.wallIsKineticBlockFlag[wi] === 1;
    // Speed factor for bounce: index 0 → 50 %, index 1 → 100 %
    const bounceSf = isBounce ? (world.wallBouncePadSpeedFactorIndex[wi] === 1 ? 1.0 : 0.5) : 0.0;

    // Determine push direction from previous position
    if (prevRight <= wallLeft + COLLISION_EPSILON) {
      // Step-up is disabled for kinetic blocks so the boost always fires rather than silently stepping.
      if (!isBounce && !isKinetic && tryStepUpSingleBlock(cluster, world, wallLeft, wallRight, wallTop, 1, wasGrounded)) continue;
      // Was to the left of wall — push out left
      cluster.positionXWorld = wallLeft - hw;
      if (isKinetic) {
        cluster.velocityXWorld = -KINETIC_BLOCK_BOOST_SPEED_WORLD;
      } else if (isBounce) {
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
      if (!isBounce && !isKinetic && tryStepUpSingleBlock(cluster, world, wallLeft, wallRight, wallTop, -1, wasGrounded)) continue;
      // Was to the right of wall — push out right
      cluster.positionXWorld = wallRight + hw;
      if (isKinetic) {
        cluster.velocityXWorld = +KINETIC_BLOCK_BOOST_SPEED_WORLD;
      } else if (isBounce) {
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
        if (isKinetic) {
          cluster.velocityXWorld = -KINETIC_BLOCK_BOOST_SPEED_WORLD;
        } else if (isBounce) {
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
        if (isKinetic) {
          cluster.velocityXWorld = +KINETIC_BLOCK_BOOST_SPEED_WORLD;
        } else if (isBounce) {
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
 * Shaped walls are skipped: legacy ramps are handled by `resolveRampSurfaces`,
 * stairs by `resolveStairsSurfaces`.
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
    // Skip shaped walls — ramps go through resolveRampSurfaces, stairs through resolveStairsSurfaces
    if (!isPlainRectOrientationIndex(world.wallRampOrientationIndex[wi])) continue;

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

    const isBounce  = world.wallIsBouncePadFlag[wi] === 1;
    const isKinetic = world.wallIsKineticBlockFlag[wi] === 1;
    const bounceSf = isBounce ? (world.wallBouncePadSpeedFactorIndex[wi] === 1 ? 1.0 : 0.5) : 0.0;
    const isIce = world.wallIsIceFlag[wi] === 1;
    const isUltraIce = world.wallIsUltraIceFlag[wi] === 1;
    const isRocket = world.wallIsRocketBlockFlag[wi] === 1;

    // Determine push direction from previous position
    if (prevBottom <= wallTop + COLLISION_EPSILON && cluster.velocityYWorld >= 0) {
      // Was above wall — land on top
      cluster.positionYWorld = wallTop - hh;
      if (isKinetic) {
        cluster.velocityYWorld = -KINETIC_BLOCK_BOOST_SPEED_WORLD;
        // Do NOT set isGroundedFlag — kinetic block launches the player upward
      } else if (isBounce) {
        const inVY = cluster.velocityYWorld;
        cluster.velocityYWorld = -inVY * bounceSf;
        // Do NOT set isGroundedFlag — player cannot ground-jump off a bounce pad
        bounceScratch.bouncedY = true;
        bounceScratch.restitutionY = bounceSf;
        logBouncePadHit(cluster, 'y', bounceSf, inVY);
      } else {
        cluster.velocityYWorld = 0;
        cluster.isGroundedFlag = 1;
        if (isIce) cluster.isGroundedOnIceFlag = 1;
        if (isUltraIce) cluster.isGroundedOnUltraIceFlag = 1;
        if (isRocket) cluster.isGroundedOnRocketFlag = 1;
        landed = true;
      }
    } else if (prevTop >= wallBottom - COLLISION_EPSILON && cluster.velocityYWorld <= 0) {
      // Was below wall — bonked ceiling moving upward.
      // Attempt jump corner correction before committing to the ceiling response.
      if (!isBounce && !isKinetic && tryJumpCornerCorrection(cluster, world, wallLeft, wallRight)) {
        // Corner was cleared — skip velocity zeroing for this wall and continue.
        continue;
      }
      // Normal ceiling response.
      cluster.positionYWorld = wallBottom + hh;
      if (isKinetic) {
        cluster.velocityYWorld = +KINETIC_BLOCK_BOOST_SPEED_WORLD;
      } else if (isBounce) {
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
        if (isKinetic) {
          cluster.velocityYWorld = -KINETIC_BLOCK_BOOST_SPEED_WORLD;
        } else if (isBounce) {
          const inVY = cluster.velocityYWorld;
          cluster.velocityYWorld = -inVY * bounceSf;
          bounceScratch.bouncedY = true;
          bounceScratch.restitutionY = bounceSf;
          logBouncePadHit(cluster, 'y', bounceSf, inVY);
        } else {
          cluster.velocityYWorld = 0;
          cluster.isGroundedFlag = 1;
          if (isIce) cluster.isGroundedOnIceFlag = 1;
          if (isUltraIce) cluster.isGroundedOnUltraIceFlag = 1;
          landed = true;
        }
      } else {
        cluster.positionYWorld = wallBottom + hh;
        if (isKinetic) {
          cluster.velocityYWorld = +KINETIC_BLOCK_BOOST_SPEED_WORLD;
        } else if (isBounce) {
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
