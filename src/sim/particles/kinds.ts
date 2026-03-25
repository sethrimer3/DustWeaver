/** Each kind has a distinct motion signature driven by its ElementProfile. */
export enum ParticleKind {
  Physical  = 0,
  Fire      = 1,
  Ice       = 2,
  Lightning = 3,
  // Placeholders — add an ElementProfile entry to activate
  Poison    = 4,
  Arcane    = 5,
  Wind      = 6,
  Holy      = 7,
  Shadow    = 8,
}

/** Total number of defined kinds — keep in sync with the enum above. */
export const PARTICLE_KIND_COUNT = 9;
