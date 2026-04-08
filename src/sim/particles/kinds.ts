/** Each kind has a distinct motion signature driven by its ElementProfile. */
export enum ParticleKind {
  /** Gold Dust — the player's only equippable dust type. */
  Physical  = 0,
  // ── Legacy kinds (removed from player equipment, kept for backward compat) ──
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Fire      = 1,
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Ice       = 2,
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Lightning = 3,
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Poison    = 4,
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Arcane    = 5,
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Wind      = 6,
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Holy      = 7,
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Shadow    = 8,
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Metal     = 9,
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Earth     = 10,
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Nature    = 11,
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Crystal   = 12,
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Void      = 13,
  // Background / environmental (not equippable by players)
  Fluid     = 14,  // Background fluid particle — invisible until disturbed
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Water     = 15,
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Lava      = 16,
  /** @deprecated Removed from player equipment. Enemies may still use. */
  Stone     = 17,
  // Special / ability particles (not equippable)
  Gold      = 18,  // Grappling hook chain — bright golden diamond sparkles
  Light     = 19,  // Boss light chains — radiant white-gold glow
}

/** Total number of defined kinds — keep in sync with the enum above. */
export const PARTICLE_KIND_COUNT = 20;

/**
 * Ordered list of particle kinds that players can equip.
 * Only Gold Dust (Physical) is equippable; all other kinds have been removed
 * from player equipment (enemies may still use them).
 */
export const EQUIPPABLE_KINDS: readonly ParticleKind[] = [
  ParticleKind.Physical,
];

/**
 * Number of kinds that players can equip.
 * Equals EQUIPPABLE_KINDS.length; use this for iteration counts.
 */
export const EQUIPPABLE_PARTICLE_KIND_COUNT = EQUIPPABLE_KINDS.length; // 1

/**
 * Particle shape enum — controls how each particle kind is rendered.
 * Physical uses Circle; all other kinds use non-circle polygons.
 */
export enum ParticleShape {
  Circle   = 0,  // Nature, Fluid, Water, Light
  Diamond  = 1,  // Lightning, Wind, Gold
  Square   = 2,  // Physical, Shadow, Metal
  Triangle = 3,  // Fire, Earth
  Hexagon  = 4,  // Ice, Crystal
  Cross    = 5,  // Holy
  Star     = 6,  // Poison, Arcane
  Ring     = 7,  // Void
}

/** Maps each ParticleKind to its rendered shape. */
export const KIND_SHAPE: ParticleShape[] = [
  ParticleShape.Square,   // Physical — square gold dust mote
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
  ParticleShape.Circle,   // Light — radiant boss glow
];

/** Returns the rendered shape for the given kind index, defaulting to Circle. */
export function getKindShape(kind: number): ParticleShape {
  return KIND_SHAPE[kind] ?? ParticleShape.Circle;
}
