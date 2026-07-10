/**
 * Stair surface collision resolver.
 *
 * Stair walls occupy one wall slot but are only partially solid, so the
 * rectangular resolvers in movementAxisResolvers.ts skip them (as they skip
 * legacy ramps). This module resolves a cluster against each stair's
 * individual step rectangles instead.
 *
 * Unlike `resolveRampSurfaces`, there is no diagonal here: a stair is a set of
 * ordinary axis-aligned boxes, so the resolution is the same axis-separated
 * push-out the plain wall resolvers perform, applied once per step. That is
 * what makes the player collide with the stepped profile rather than a smooth
 * slope — they land on a specific tread, and walking into a riser either stops
 * them or triggers the normal single-block step-up.
 *
 * Called from movement.ts after `resolveClusterSolidWallCollision`, mirroring
 * the X-then-Y ordering that resolver uses internally so grounding is
 * established by the final Y pass.
 *
 * Stairs are never bounce pads or kinetic blocks (the editor does not offer
 * those combinations), so this resolver has no bounce/kinetic branches. Ice
 * physics flags are honoured, inherited from the parent stair wall.
 */

import type { WorldState } from '../world';
import type { ClusterState } from './state';
import { COLLISION_EPSILON } from './movementConstants';
import { tryStepUpSingleBlock } from './movementAxisResolvers';
import { forEachWallSolidRect, isStairsWall } from '../stairsWorldGeometry';

/** Scratch buffer for the overlapping stair's step rectangles, reused every call. */
const _stepRects: number[] = [];

/**
 * Resolves `cluster` against every stair wall it overlaps.
 *
 * @param prevXWorld  Cluster X before velocity integration this tick.
 * @param prevYWorld  Cluster Y before velocity integration this tick.
 * @returns true if the cluster landed on a stair tread this tick.
 */
export function resolveStairsSurfaces(
  cluster: ClusterState,
  world: WorldState,
  prevXWorld: number,
  prevYWorld: number,
): boolean {
  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;
  const wasGrounded = cluster.isGroundedFlag === 1;
  let landed = false;

  for (let wi = 0; wi < world.wallCount; wi++) {
    if (!isStairsWall(world, wi)) continue;
    if (world.wallIsPlatformFlag[wi] === 1) continue;

    // Broad phase against the stair's bounding box before decomposing it.
    const boxLeft = world.wallXWorld[wi];
    const boxTop = world.wallYWorld[wi];
    const boxRight = boxLeft + world.wallWWorld[wi];
    const boxBottom = boxTop + world.wallHWorld[wi];
    if (cluster.positionXWorld + hw <= boxLeft || cluster.positionXWorld - hw >= boxRight) continue;
    if (cluster.positionYWorld + hh <= boxTop || cluster.positionYWorld - hh >= boxBottom) continue;

    _stepRects.length = 0;
    forEachWallSolidRect(world, wi, (x0, y0, x1, y1) => {
      _stepRects.push(x0, y0, x1, y1);
    });

    const isIce = world.wallIsIceFlag[wi] === 1;
    const isUltraIce = world.wallIsUltraIceFlag[wi] === 1;

    // X pass first, then Y — matching resolveClusterSolidWallCollision's order
    // so that the final Y pass is what establishes isGroundedFlag.
    for (let i = 0; i < _stepRects.length; i += 4) {
      _resolveStepX(cluster, world, prevXWorld, wasGrounded,
        _stepRects[i], _stepRects[i + 1], _stepRects[i + 2], _stepRects[i + 3]);
    }
    for (let i = 0; i < _stepRects.length; i += 4) {
      if (_resolveStepY(cluster, prevYWorld, isIce, isUltraIce,
        _stepRects[i], _stepRects[i + 1], _stepRects[i + 2], _stepRects[i + 3])) {
        landed = true;
      }
    }
  }

  return landed;
}

/** X-axis push-out against a single step rectangle. */
function _resolveStepX(
  cluster: ClusterState,
  world: WorldState,
  prevXWorld: number,
  wasGrounded: boolean,
  stepLeft: number, stepTop: number, stepRight: number, stepBottom: number,
): void {
  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;

  const left = cluster.positionXWorld - hw;
  const right = cluster.positionXWorld + hw;
  const top = cluster.positionYWorld - hh;
  const bottom = cluster.positionYWorld + hh;
  if (right <= stepLeft || left >= stepRight || bottom <= stepTop || top >= stepBottom) return;

  const prevRight = prevXWorld + hw;
  const prevLeft = prevXWorld - hw;

  if (prevRight <= stepLeft + COLLISION_EPSILON) {
    // Walking right into a riser: a single riser is well under the step-up
    // budget, so the player normally pops onto the tread instead of stopping.
    if (tryStepUpSingleBlock(cluster, world, stepLeft, stepRight, stepTop, 1, wasGrounded)) return;
    cluster.positionXWorld = stepLeft - hw;
    if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
    if (cluster.isPlayerFlag === 1) cluster.isTouchingWallRightFlag = 1;
  } else if (prevLeft >= stepRight - COLLISION_EPSILON) {
    if (tryStepUpSingleBlock(cluster, world, stepLeft, stepRight, stepTop, -1, wasGrounded)) return;
    cluster.positionXWorld = stepRight + hw;
    if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
    if (cluster.isPlayerFlag === 1) cluster.isTouchingWallLeftFlag = 1;
  } else {
    // Already overlapping on X at tick start (e.g. spawned inside) — shortest push-out.
    if (right - stepLeft < stepRight - left) {
      cluster.positionXWorld = stepLeft - hw;
      if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
      if (cluster.isPlayerFlag === 1) cluster.isTouchingWallRightFlag = 1;
    } else {
      cluster.positionXWorld = stepRight + hw;
      if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
      if (cluster.isPlayerFlag === 1) cluster.isTouchingWallLeftFlag = 1;
    }
  }
}

/** Y-axis push-out against a single step rectangle. Returns true on landing. */
function _resolveStepY(
  cluster: ClusterState,
  prevYWorld: number,
  isIce: boolean,
  isUltraIce: boolean,
  stepLeft: number, stepTop: number, stepRight: number, stepBottom: number,
): boolean {
  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;

  const left = cluster.positionXWorld - hw;
  const right = cluster.positionXWorld + hw;
  const top = cluster.positionYWorld - hh;
  const bottom = cluster.positionYWorld + hh;
  if (right <= stepLeft || left >= stepRight || bottom <= stepTop || top >= stepBottom) return false;

  const prevBottom = prevYWorld + hh;
  const prevTop = prevYWorld - hh;

  const land = (): boolean => {
    cluster.positionYWorld = stepTop - hh;
    cluster.velocityYWorld = 0;
    cluster.isGroundedFlag = 1;
    if (isIce) cluster.isGroundedOnIceFlag = 1;
    if (isUltraIce) cluster.isGroundedOnUltraIceFlag = 1;
    return true;
  };

  if (prevBottom <= stepTop + COLLISION_EPSILON && cluster.velocityYWorld >= 0) {
    return land();
  }
  if (prevTop >= stepBottom - COLLISION_EPSILON && cluster.velocityYWorld <= 0) {
    // Bonked the underside of a step while rising.
    cluster.positionYWorld = stepBottom + hh;
    if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
    return false;
  }

  // Already overlapping on Y at tick start — shortest push-out.
  if (bottom - stepTop < stepBottom - top) return land();
  cluster.positionYWorld = stepBottom + hh;
  if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
  return false;
}
