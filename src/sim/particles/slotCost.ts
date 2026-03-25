/**
 * Dust slot costs per ParticleKind.
 *
 * Slot cost represents how "expensive" a particle type is to equip.
 * Higher-cost types tend to be more powerful or have unique properties.
 * The player's available dust slots grow with level (see playerProgress.ts).
 *
 * Cost scale: 1 (cheapest) → 4 (rarest/most powerful)
 */

import { ParticleKind, EQUIPPABLE_PARTICLE_KIND_COUNT } from './kinds';

/**
 * Slot cost table indexed by ParticleKind value.
 * Must stay in sync with the ParticleKind enum.
 */
const SLOT_COSTS: number[] = [
  1, // Physical   — basic, costs 1 slot
  2, // Fire       — moderate cost
  2, // Ice        — moderate cost
  3, // Lightning  — high cost (very powerful, short-lived)
  2, // Poison     — moderate cost
  3, // Arcane     — high cost (complex behaviour)
  2, // Wind       — moderate cost
  3, // Holy       — high cost (stable, orderly)
  3, // Shadow     — high cost (unpredictable)
  3, // Metal      — high cost (dense, durable)
  2, // Earth      — moderate cost
  1, // Nature     — low cost (organic, light)
  3, // Crystal    — high cost (precise, long-lived)
  4, // Void       — maximum cost (rare, exotic)
];

if (SLOT_COSTS.length !== EQUIPPABLE_PARTICLE_KIND_COUNT) {
  throw new Error(
    `SLOT_COSTS length (${SLOT_COSTS.length}) must equal EQUIPPABLE_PARTICLE_KIND_COUNT (${EQUIPPABLE_PARTICLE_KIND_COUNT})`,
  );
}

/** Returns the dust slot cost for the given kind, defaulting to 1. */
export function getSlotCost(kind: ParticleKind | number): number {
  return SLOT_COSTS[kind] ?? 1;
}

/**
 * Returns the total slot cost of a list of equipped kinds.
 * Duplicate kinds are counted once per occurrence.
 */
export function totalSlotCost(kinds: ReadonlyArray<ParticleKind>): number {
  let total = 0;
  for (let i = 0; i < kinds.length; i++) {
    total += getSlotCost(kinds[i]);
  }
  return total;
}
