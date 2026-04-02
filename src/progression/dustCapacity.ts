/**
 * Dust Container / Capacity Model.
 *
 * Each dust container grants a fixed amount of capacity.
 * Different dust types consume different amounts of capacity per particle.
 * Total capacity = number of containers × CAPACITY_PER_CONTAINER.
 *
 * Example:
 *   2 containers = 8 total capacity
 *   Golden Dust (Physical) costs 1 capacity → 8 particles
 *   Fire Dust costs 2 capacity → 4 particles
 */

import { ParticleKind } from '../sim/particles/kinds';
import { getSlotCost } from '../sim/particles/slotCost';

// ---- Constants -------------------------------------------------------------

/** Capacity granted by each dust container. */
export const CAPACITY_PER_CONTAINER = 4;

// ---- Capacity calculations -------------------------------------------------

/** Returns total dust capacity for a given number of containers. */
export function getTotalCapacity(containerCount: number): number {
  return containerCount * CAPACITY_PER_CONTAINER;
}

/** Returns the capacity cost of a single particle of the given dust type. */
export function getDustCapacityCost(kind: ParticleKind): number {
  return getSlotCost(kind);
}

/**
 * Returns the maximum number of particles of a single dust type
 * that can fit in the given total capacity.
 */
export function getMaxParticlesForDust(kind: ParticleKind, totalCapacity: number): number {
  const cost = getDustCapacityCost(kind);
  if (cost <= 0) return 0;
  return Math.floor(totalCapacity / cost);
}

/**
 * Calculates the total capacity consumed by a mixed loadout.
 * Each entry is [dustKind, particleCount].
 */
export function calculateUsedCapacity(
  dustLoadout: ReadonlyArray<{ kind: ParticleKind; count: number }>,
): number {
  let total = 0;
  for (let i = 0; i < dustLoadout.length; i++) {
    total += getDustCapacityCost(dustLoadout[i].kind) * dustLoadout[i].count;
  }
  return total;
}

/**
 * Returns true if the given dust loadout fits within the available capacity.
 */
export function doesLoadoutFitCapacity(
  dustLoadout: ReadonlyArray<{ kind: ParticleKind; count: number }>,
  containerCount: number,
): boolean {
  return calculateUsedCapacity(dustLoadout) <= getTotalCapacity(containerCount);
}
