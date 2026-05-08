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
  type BounceScratch,
  resolveWallsX,
  resolveWallsY,
} from './movementAxisResolvers';

// Re-export so that existing callers importing resolveRampSurfaces from this
// module continue to work without modification.
export { resolveRampSurfaces } from './movementRampCollision';
// Re-export so playerMovement.ts can continue to import from this module.
export { getNearbyWallForWallJump } from './movementAxisResolvers';

/**
 * Module-private scratch object used to propagate bounce information through the
 * collision pass without per-tick heap allocation.
 * Cleared at the start of every resolveClusterSolidWallCollision call.
 */
const bounceScratch: BounceScratch = {
  bouncedX: false, bouncedY: false,
  restitutionX: 0, restitutionY: 0,
};

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
 * Axis-separated sweep collision resolver with sub-tick safety.
 *
 * Two-pass approach:
 *   X pass: apply velX, resolve all X overlaps.
 *   Y pass: apply velY, resolve all Y overlaps.
 *
 * Each axis is sub-stepped if the movement distance exceeds half the
 * cluster's dimension on that axis, preventing tunneling through thin
 * walls at high speed.
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

