/**
 * Verdant Dust temporary-flower bloom trigger — deterministic, distance-based
 * (per newly crossed grounded integer world pixel), NOT per-frame.
 *
 * This module only decides WHEN/WHERE a cosmetic flower-bloom event should
 * fire; it never spawns a real particle, mutates health/collision/save data,
 * or otherwise touches anything beyond the tiny per-cluster tracking fields
 * declared on `ClusterState` (`verdantFlowerHasLastPixelFlag`,
 * `verdantFlowerLastPixelX`, `verdantFlowerCrossingSeq`). The render layer
 * (`src/render/verdantFlowerTrail.ts`) owns the actual bounded cosmetic pool.
 *
 * Determinism: each newly entered integer world pixel gets exactly one 1%
 * roll, keyed by a hash of (pixel, monotonic per-crossing sequence number).
 * Using the pixel alone would make every future crossing of the same pixel
 * produce the identical outcome forever; folding in the monotonic sequence
 * (which only advances on a genuine new-pixel entry, never while stationary
 * or re-evaluating the same pixel) allows a later, genuinely independent
 * re-crossing after leaving and re-entering to get a different roll, while
 * still being fully deterministic for a given input tick history — no
 * Math.random()/wall-clock randomness.
 */

import { WorldState } from '../world';
import { ClusterState } from './state';
import { isVerdantDustEquipped } from './verdantMobility';

/** Per-pixel bloom probability. */
export const VERDANT_FLOWER_SPAWN_CHANCE = 0.01;

/** Hard bound on flower-spawn events produced in a single tick (safety cap). */
export const MAX_VERDANT_FLOWER_EVENTS_PER_TICK = 16;

export interface VerdantFlowerSpawnEvent {
  xWorld: number;
  yWorld: number;
}

/** Deterministic 32-bit hash — no Math.random()/Date.now(). */
function hash32(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = (Math.imul(h, 0x2545f491) ^ (h >>> 13)) >>> 0;
  return h >>> 0;
}

/**
 * Evaluates every newly crossed grounded integer world pixel this tick for a
 * deterministic 1% flower-bloom roll, appending any hits to `outEvents`
 * (cleared first). Caller determines ground-surface validity
 * (`isValidGroundSurface`) — e.g. reject hazardous/no-collision surfaces —
 * since that check depends on wall/surface lookups outside this module's
 * scope.
 *
 * Multiple pixels crossed in one tick (e.g. doubled Verdant ground speed, or
 * a large dt) are each evaluated exactly once, in order, so behavior is
 * equivalent whether a given distance is covered in one tick or subdivided
 * across several smaller ticks.
 */
export function updateVerdantFlowerSpawn(
  cluster: ClusterState,
  world: WorldState,
  isValidGroundSurface: boolean,
  outEvents: VerdantFlowerSpawnEvent[],
): void {
  outEvents.length = 0;

  const eligible =
    isVerdantDustEquipped(world) &&
    cluster.isGroundedFlag === 1 &&
    cluster.isWallSlidingFlag === 0 &&
    isValidGroundSurface &&
    Math.abs(cluster.velocityXWorld) > 0.01;

  if (!eligible) {
    // Leaving eligibility (airborne, wall-slide, swimming, stationary, off
    // Verdant, invalid surface, etc.) clears the baseline so re-entering
    // later starts a fresh "first pixel, no crossing yet" state rather than
    // firing a spurious roll for the gap that was skipped.
    cluster.verdantFlowerHasLastPixelFlag = 0;
    return;
  }

  const curPixel = Math.floor(cluster.positionXWorld);

  if (cluster.verdantFlowerHasLastPixelFlag === 0) {
    cluster.verdantFlowerLastPixelX = curPixel;
    cluster.verdantFlowerHasLastPixelFlag = 1;
    return;
  }

  const lastPixel = cluster.verdantFlowerLastPixelX;
  if (curPixel === lastPixel) return; // still on the same pixel: no re-roll

  const step = curPixel > lastPixel ? 1 : -1;
  const footYWorld = cluster.positionYWorld + cluster.halfHeightWorld;
  let p = lastPixel + step;
  let guard = 0;
  for (;;) {
    cluster.verdantFlowerCrossingSeq = (cluster.verdantFlowerCrossingSeq + 1) >>> 0;
    const h = hash32(p, cluster.verdantFlowerCrossingSeq);
    // h is uniform over [0, 2^32); compare against chance * 2^32.
    if (h < VERDANT_FLOWER_SPAWN_CHANCE * 4294967296) {
      if (outEvents.length < MAX_VERDANT_FLOWER_EVENTS_PER_TICK) {
        outEvents.push({ xWorld: p, yWorld: footYWorld });
      }
    }
    if (p === curPixel || guard > 4096) break;
    p += step;
    guard++;
  }

  cluster.verdantFlowerLastPixelX = curPixel;
}
