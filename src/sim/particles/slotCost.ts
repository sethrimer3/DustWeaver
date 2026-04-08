/**
 * Dust slot costs per ParticleKind.
 *
 * Only Gold Dust (Physical) is player-equippable; its cost is 1.
 * All other kinds have a uniform cost of 1 (legacy — enemies may use them).
 *
 * The array is indexed by ParticleKind value (0–PARTICLE_KIND_COUNT-1).
 */

import { ParticleKind, PARTICLE_KIND_COUNT } from './kinds';

/**
 * Slot cost table indexed directly by ParticleKind value.
 * Must stay in sync with the ParticleKind enum order.
 * Length must equal PARTICLE_KIND_COUNT.
 */
const SLOT_COSTS: number[] = [
  1, // Physical   (0)
  1, // Fire       (1)  — legacy
  1, // Ice        (2)  — legacy
  1, // Lightning  (3)  — legacy
  1, // Poison     (4)  — legacy
  1, // Arcane     (5)  — legacy
  1, // Wind       (6)  — legacy
  1, // Holy       (7)  — legacy
  1, // Shadow     (8)  — legacy
  1, // Metal      (9)  — legacy
  1, // Earth      (10) — legacy
  1, // Nature     (11) — legacy
  1, // Crystal    (12) — legacy
  1, // Void       (13) — legacy
  0, // Fluid      (14) — non-equippable placeholder
  1, // Water      (15) — legacy
  1, // Lava       (16) — legacy
  1, // Stone      (17) — legacy
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
