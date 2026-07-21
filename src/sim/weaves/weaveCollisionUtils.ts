/**
 * Shared pure geometry + damage-routing helpers for weave melee/projectile
 * collision (Sword swept-mote hits, Bow swept-mote hits).
 *
 * Centralizing these avoids two independently-drifting copies of "distance
 * from a point to a moving segment" and "how to route damage to an Orbital
 * Dust Core vs. an ordinary enemy" across the Sword and Bow modules.
 */

import { WorldState } from '../world';
import { ClusterState } from '../clusters/state';
import { applyODCHit } from '../clusters/orbitalDustCoreAi';

/**
 * Squared distance from point `(px,py)` to the closest point on the segment
 * `(ax,ay)-(bx,by)`. Used for swept per-tick mote collision: the segment is a
 * single mote's previous→next position this tick, so testing distance against
 * the whole segment (not just its endpoints) prevents a fast-moving mote from
 * tunneling past an enemy that was crossed only mid-tick.
 */
export function segmentPointDistanceSq(
  ax: number, ay: number,
  bx: number, by: number,
  px: number, py: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  let t = abLenSq > 1e-9 ? (apx * abx + apy * aby) / abLenSq : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

/**
 * Applies `damage` to the enemy cluster at `clusterIndex`, routing Orbital
 * Dust Core enemies through their specialized ring-aware hit function
 * (`applyODCHit`) instead of directly subtracting health, and applying
 * ordinary whole-number health-point damage + death otherwise. `hitXWorld/
 * YWorld` should be a reasonable approximation of the impact point (used by
 * `applyODCHit` to determine which ring was struck).
 */
export function applyRoutedWeaveDamage(
  world: WorldState,
  clusterIndex: number,
  damage: number,
  hitXWorld: number,
  hitYWorld: number,
): void {
  const c: ClusterState = world.clusters[clusterIndex];
  if (c.isOrbitalDustCoreFlag === 1) {
    applyODCHit(world, clusterIndex, hitXWorld, hitYWorld, damage);
    return;
  }
  c.healthPoints -= damage;
  if (c.healthPoints <= 0) {
    c.healthPoints = 0;
    c.isAliveFlag = 0;
  }
}
