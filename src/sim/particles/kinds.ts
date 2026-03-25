/** Each kind has a distinct motion signature driven by its ElementProfile. */
export enum ParticleKind {
  Physical  = 0,
  Fire      = 1,
  Ice       = 2,
  Lightning = 3,
  Poison    = 4,
  Arcane    = 5,
  Wind      = 6,
  Holy      = 7,
  Shadow    = 8,
  // New particle types
  Metal     = 9,   // Heavy, dense, squared — high cost
  Earth     = 10,  // Grounded, steady, triangular — medium cost
  Nature    = 11,  // Organic, tendrils, circular — low cost
  Crystal   = 12,  // Precise, geometric, hexagonal — high cost
  Void      = 13,  // Dark matter ring — very high cost
}

/** Total number of defined kinds — keep in sync with the enum above. */
export const PARTICLE_KIND_COUNT = 14;

/**
 * Particle shape enum — controls how each particle kind is rendered.
 * Physical uses Circle; all other kinds use non-circle polygons.
 */
export enum ParticleShape {
  Circle   = 0,  // Physical, Nature
  Diamond  = 1,  // Lightning, Wind
  Square   = 2,  // Shadow, Metal
  Triangle = 3,  // Fire, Earth
  Hexagon  = 4,  // Ice, Crystal
  Cross    = 5,  // Holy
  Star     = 6,  // Poison, Arcane
  Ring     = 7,  // Void
}

/** Maps each ParticleKind to its rendered shape. */
export const KIND_SHAPE: ParticleShape[] = [
  ParticleShape.Circle,   // Physical
  ParticleShape.Triangle, // Fire
  ParticleShape.Hexagon,  // Ice
  ParticleShape.Diamond,  // Lightning
  ParticleShape.Star,     // Poison
  ParticleShape.Star,     // Arcane
  ParticleShape.Diamond,  // Wind
  ParticleShape.Cross,    // Holy
  ParticleShape.Square,   // Shadow
  ParticleShape.Square,   // Metal
  ParticleShape.Triangle, // Earth
  ParticleShape.Circle,   // Nature
  ParticleShape.Hexagon,  // Crystal
  ParticleShape.Ring,     // Void
];

/** Returns the rendered shape for the given kind index, defaulting to Circle. */
export function getKindShape(kind: number): ParticleShape {
  return KIND_SHAPE[kind] ?? ParticleShape.Circle;
}
