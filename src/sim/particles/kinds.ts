/** Each kind has a distinct motion signature driven by its ElementProfile. */
export enum ParticleKind {
  // ── Stable serialized particle kinds (player roster is EQUIPPABLE_KINDS) ───
  Golden    = 0,   // Golden Dust — retains the legacy "Physical" numeric value
  Fire      = 1,   // Internal fire particles
  Ice       = 2,   // Ice Dust — frozen crystals
  Lightning = 3,   // Internal lightning particles
  Poison    = 4,   // Internal poison particles
  Arcane    = 5,   // Internal arcane particles
  Wind      = 6,   // Internal wind particles
  Holy      = 7,   // Internal holy particles
  Shadow    = 8,   // Internal shadow particles
  Metal     = 9,   // Internal metal particles
  Earth     = 10,  // Internal earth particles
  Nature    = 11,  // Nature Dust — living spores
  Crystal   = 12,  // Internal crystal particles
  Void      = 13,  // Void Dust — unstable matter from beyond
  // Background / environmental (not collectible by players)
  Fluid     = 14,  // Background fluid particle — invisible until disturbed
  Water     = 15,  // Internal water particles
  Lava      = 16,  // Internal lava particles
  Stone     = 17,  // Internal stone particles
  // Special / ability particles
  Gold      = 18,  // Grappling hook chain — bright golden diamond sparkles
  Light     = 19,  // Boss light chains and collectible Light Dust share this value
}

/** Total number of defined kinds — keep in sync with the enum above. */
export const PARTICLE_KIND_COUNT = 20;

/**
 * Ordered list of particle kinds that players can collect and equip.
 * Internal particle kinds retain their serialized values but are deliberately
 * excluded from this player-facing roster.
 */
export const EQUIPPABLE_KINDS: readonly ParticleKind[] = [
  ParticleKind.Golden,
  ParticleKind.Ice,
  ParticleKind.Nature,
  ParticleKind.Void,
  ParticleKind.Light,
];

/**
 * Number of kinds that players can equip.
 * Equals EQUIPPABLE_KINDS.length; use this for iteration counts.
 */
export const EQUIPPABLE_PARTICLE_KIND_COUNT = EQUIPPABLE_KINDS.length; // 5

/** True only for dust kinds that may appear in player progression/loadouts. */
export function isEquippableParticleKind(kind: unknown): kind is ParticleKind {
  return typeof kind === 'number' && EQUIPPABLE_KINDS.includes(kind as ParticleKind);
}

/**
 * Particle shape enum — controls how each particle kind is rendered.
 * Golden uses a square; other kinds use their material-specific shapes.
 */
export enum ParticleShape {
  Circle   = 0,  // Nature, Fluid, Water, Light
  Diamond  = 1,  // Lightning, Wind, Gold
  Square   = 2,  // Golden, Shadow, Metal
  Triangle = 3,  // Fire, Earth
  Hexagon  = 4,  // Ice, Crystal
  Cross    = 5,  // Holy
  Star     = 6,  // Poison, Arcane
  Ring     = 7,  // Void
}

/** Maps each ParticleKind to its rendered shape. */
export const KIND_SHAPE: ParticleShape[] = [
  ParticleShape.Square,   // Golden — square gold dust mote
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
