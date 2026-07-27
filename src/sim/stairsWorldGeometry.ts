/**
 * stairsWorldGeometry.ts — bridges `levels/stairsGeometry.ts` to the flat wall
 * arrays on `WorldState`.
 *
 * Stair walls occupy a single wall slot whose AABB is only partially solid.
 * Any consumer that needs exact solidity (rather than the conservative
 * bounding box) resolves that slot into its step rectangles through this
 * module, so the template mask stays the one authority.
 *
 * Legacy ramp walls are deliberately NOT decomposed here: they have their own
 * diagonal surface resolver (movementRampCollision.ts) and every consumer that
 * cares already skips them. `forEachWallSolidRect` therefore reports a ramp's
 * full bounding rectangle, preserving the behaviour those consumers have
 * always seen.
 */

import type { WorldState } from './world';
import {
  decodeStairsPhysicsOrientationIndex,
  getStairsSolidRects,
  isStairsPhysicsOrientationIndex,
  isStairsSolidAtLocalPx,
} from '../levels/stairsGeometry';

/** True when wall slot `wi` is a stair wall. */
export function isStairsWall(world: WorldState, wi: number): boolean {
  return isStairsPhysicsOrientationIndex(world.wallRampOrientationIndex[wi]);
}

/**
 * Invokes `cb` once per solid world-space rectangle of wall `wi`.
 *
 * For a stair wall that is one rectangle per step; for every other wall it is
 * the wall's own AABB, called exactly once.
 */
export function forEachWallSolidRect(
  world: WorldState,
  wi: number,
  cb: (x0: number, y0: number, x1: number, y1: number) => void,
): void {
  const x0 = world.wallXWorld[wi];
  const y0 = world.wallYWorld[wi];
  const w = world.wallWWorld[wi];
  const h = world.wallHWorld[wi];

  const oriIndex = world.wallRampOrientationIndex[wi];
  if (!isStairsPhysicsOrientationIndex(oriIndex)) {
    cb(x0, y0, x0 + w, y0 + h);
    return;
  }

  const rects = getStairsSolidRects(decodeStairsPhysicsOrientationIndex(oriIndex), w, h);
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    cb(x0 + r.xPx, y0 + r.yPx, x0 + r.xPx + r.wPx, y0 + r.yPx + r.hPx);
  }
}

/**
 * True when the AABB `[left,right) × [top,bottom)` overlaps any solid part of
 * wall `wi`. Stair walls are tested against their step rectangles, so a box
 * sitting in a stair's empty upper corner reports no overlap.
 */
export function aabbOverlapsWallSolid(
  world: WorldState,
  wi: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  if (!isStairsWall(world, wi)) {
    const wallLeft = world.wallXWorld[wi];
    const wallTop = world.wallYWorld[wi];
    return !(right <= wallLeft || left >= wallLeft + world.wallWWorld[wi]
          || bottom <= wallTop || top >= wallTop + world.wallHWorld[wi]);
  }

  let hit = false;
  forEachWallSolidRect(world, wi, (x0, y0, x1, y1) => {
    if (hit) return;
    if (!(right <= x0 || left >= x1 || bottom <= y0 || top >= y1)) hit = true;
  });
  return hit;
}

/**
 * True when the world-space point lies inside a solid cell of stair wall `wi`.
 * Returns false for a point outside the stair's bounding box.
 */
export function stairsWallContainsPoint(
  world: WorldState,
  wi: number,
  xWorld: number,
  yWorld: number,
): boolean {
  const oriIndex = world.wallRampOrientationIndex[wi];
  if (!isStairsPhysicsOrientationIndex(oriIndex)) return false;
  return isStairsSolidAtLocalPx(
    decodeStairsPhysicsOrientationIndex(oriIndex),
    world.wallWWorld[wi],
    world.wallHWorld[wi],
    xWorld - world.wallXWorld[wi],
    yWorld - world.wallYWorld[wi],
  );
}
