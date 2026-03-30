/**
 * Dust slot costs per ParticleKind.
 *
 * Slot cost represents how "expensive" a particle type is to equip.
 * Higher-cost types tend to be more powerful or have unique properties.
 * The player's available dust slots grow with level (see playerProgress.ts).
 *
 * Cost scale: 1 (cheapest) → 4 (rarest/most powerful)
 *
 * The array is indexed by ParticleKind value (0–PARTICLE_KIND_COUNT-1).
 * Fluid (14) is non-equippable and has a placeholder cost of 0.
 */

import { ParticleKind, PARTICLE_KIND_COUNT } from './kinds';

/**
 * Slot cost table indexed directly by ParticleKind value.
 * Must stay in sync with the ParticleKind enum order.
 * Length must equal PARTICLE_KIND_COUNT.
 */
const SLOT_COSTS: number[] = [
  1, // Physical   (0)  — basic, costs 1 slot
  2, // Fire       (1)  — moderate cost
  2, // Ice        (2)  — moderate cost
  3, // Lightning  (3)  — high cost (very powerful, short-lived)
  2, // Poison     (4)  — moderate cost
  3, // Arcane     (5)  — high cost (complex behaviour)
  2, // Wind       (6)  — moderate cost
  3, // Holy       (7)  — high cost (stable, orderly)
  3, // Shadow     (8)  — high cost (unpredictable)
  3, // Metal      (9)  — high cost (dense, durable, reflective block)
  2, // Earth      (10) — moderate cost
  1, // Nature     (11) — low cost (organic, light)
  3, // Crystal    (12) — high cost (precise, long-lived)
  4, // Void       (13) — maximum cost (rare, exotic)
  0, // Fluid      (14) — non-equippable placeholder
  2, // Water      (15) — moderate cost (flowing, World 1 theme)
  4, // Lava       (16) — maximum cost (rare, devastating, slow)
  2, // Stone      (17) — moderate cost (physical shatter)
  0, // Gold       (18) — non-equippable grapple-chain placeholder
  0, // Light      (19) — non-equippable boss light-chain placeholder
];

if (SLOT_COSTS.length !== PARTICLE_KIND_COUNT) {
  throw new Error(
    `SLOT_COSTS length (${SLOT_COSTS.length}) must equal PARTICLE_KIND_COUNT (${PARTICLE_KIND_COUNT})`,
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
