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
  Metal     = 9,   // Heavy, dense, squared — high cost; reflects damage when blocking
  Earth     = 10,  // Grounded, steady, triangular — medium cost
  Nature    = 11,  // Organic, tendrils, circular — low cost
  Crystal   = 12,  // Precise, geometric, hexagonal — high cost
  Void      = 13,  // Dark matter ring — very high cost
  // Background / environmental (not equippable by players)
  Fluid     = 14,  // Background fluid particle — invisible until disturbed
  // World 1 themes
  Water     = 15,  // Flowing, turbulent — World 1 water enemy theme
  // World 2 themes
  Lava      = 16,  // Slow, powerful, few particles, burning aura — World 2 lava theme
  Stone     = 17,  // Heavy, shatters on wall/enemy impact into fragments — World 2 stone theme
  // Special / ability particles (not equippable)
  Gold      = 18,  // Grappling hook chain — bright golden diamond sparkles
}

/** Total number of defined kinds — keep in sync with the enum above. */
export const PARTICLE_KIND_COUNT = 19;

/**
 * Ordered list of particle kinds that players can equip.
 * Fluid (14) is intentionally excluded as it is a background-only kind.
 * All other kinds including Water (15), Lava (16), and Stone (17) are equippable.
 */
export const EQUIPPABLE_KINDS: readonly ParticleKind[] = [
  ParticleKind.Physical,
  ParticleKind.Fire,
  ParticleKind.Ice,
  ParticleKind.Lightning,
  ParticleKind.Poison,
  ParticleKind.Arcane,
  ParticleKind.Wind,
  ParticleKind.Holy,
  ParticleKind.Shadow,
  ParticleKind.Metal,
  ParticleKind.Earth,
  ParticleKind.Nature,
  ParticleKind.Crystal,
  ParticleKind.Void,
  // Fluid (14) intentionally skipped
  ParticleKind.Water,
  ParticleKind.Lava,
  ParticleKind.Stone,
];

/**
 * Number of kinds that players can equip.
 * Equals EQUIPPABLE_KINDS.length; use this for iteration counts.
 */
export const EQUIPPABLE_PARTICLE_KIND_COUNT = EQUIPPABLE_KINDS.length; // 17

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
  ParticleShape.Circle,   // Fluid — soft circular glow
  ParticleShape.Circle,   // Water — soft flowing circle
  ParticleShape.Circle,   // Lava  — molten circle (like fluid/water but fiery)
  ParticleShape.Triangle, // Stone — jagged triangle fragment
  ParticleShape.Diamond,  // Gold  — bright sparkle diamond
];

/** Returns the rendered shape for the given kind index, defaulting to Circle. */
export function getKindShape(kind: number): ParticleShape {
  return KIND_SHAPE[kind] ?? ParticleShape.Circle;
}
