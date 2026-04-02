/**
 * Per-element behavior coefficient profiles.
 *
 * These are gameplay-oriented coefficients, not strict real-world physics.
 * Each profile shapes a distinct motion personality for its element — the goal
 * is that an observer can read the element purely from how the particles move.
 *
 * Adding a new element:
 *   1. Add a value to ParticleKind in kinds.ts.
 *   2. Create an ElementProfile constant in the appropriate sub-file:
 *      - equippableProfiles.ts  (indices 0–13, player-usable kinds)
 *      - environmentalProfiles.ts  (indices 14+, world/env kinds)
 *   3. Push it into ELEMENT_PROFILES at the matching index below.
 *   4. Add a color to render/particles/styles.ts → ELEMENT_COLORS.
 */

import { ParticleKind } from './kinds';
export type { ElementProfile } from './elementProfileTypes';
import type { ElementProfile } from './elementProfileTypes';

import {
  PHYSICAL, FIRE, ICE, LIGHTNING, POISON, ARCANE, WIND, HOLY,
  SHADOW, METAL, EARTH, NATURE, CRYSTAL, VOID,
} from './elementProfiles/equippableProfiles';

import {
  FLUID, WATER, LAVA, STONE, GOLD, LIGHT,
} from './elementProfiles/environmentalProfiles';

// ---- Lookup table --------------------------------------------------------

/**
 * Profile table indexed by ParticleKind value.
 * Must stay in sync with the ParticleKind enum order.
 */
export const ELEMENT_PROFILES: ElementProfile[] = [
  PHYSICAL,   // 0  — ParticleKind.Physical
  FIRE,       // 1  — ParticleKind.Fire
  ICE,        // 2  — ParticleKind.Ice
  LIGHTNING,  // 3  — ParticleKind.Lightning
  POISON,     // 4  — ParticleKind.Poison
  ARCANE,     // 5  — ParticleKind.Arcane
  WIND,       // 6  — ParticleKind.Wind
  HOLY,       // 7  — ParticleKind.Holy
  SHADOW,     // 8  — ParticleKind.Shadow
  METAL,      // 9  — ParticleKind.Metal
  EARTH,      // 10 — ParticleKind.Earth
  NATURE,     // 11 — ParticleKind.Nature
  CRYSTAL,    // 12 — ParticleKind.Crystal
  VOID,       // 13 — ParticleKind.Void
  FLUID,      // 14 — ParticleKind.Fluid
  WATER,      // 15 — ParticleKind.Water
  LAVA,       // 16 — ParticleKind.Lava
  STONE,      // 17 — ParticleKind.Stone
  GOLD,       // 18 — ParticleKind.Gold
  LIGHT,      // 19 — ParticleKind.Light
];

/** Returns the profile for `kind`, falling back to Physical if out of range. */
export function getElementProfile(kind: number): ElementProfile {
  return ELEMENT_PROFILES[kind] ?? PHYSICAL;
}

/** Colour-palette hint for external tooling that reads this module. */
export type { ParticleKind };
