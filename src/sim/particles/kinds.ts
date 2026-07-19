/** Each kind has a distinct motion signature driven by its ElementProfile. */
export enum ParticleKind {
  // ── Collectible dust types — equippable by the player ──────────────────────
  Golden    = 0,   // Golden Dust — dense gold motes, the starting dust type (legacy "Golden")
  Fire      = 1,   // Fire Dust — scorching embers
  Ice       = 2,   // Ice Dust — frozen crystals
  Lightning = 3,   // Lightning Dust — crackling sparks
  Poison    = 4,   // Poison Dust — toxic spores
  Arcane    = 5,   // Arcane Dust — mysterious energy
  Wind      = 6,   // Wind Dust — whirling gusts
  Holy      = 7,   // Holy Dust — sacred motes
  Shadow    = 8,   // Shadow Dust — tendrils of darkness
  Metal     = 9,   // Metal Dust — razor shards
  Earth     = 10,  // Earth Dust — heavy stone fragments
  Nature    = 11,  // Nature Dust — living spores
  Crystal   = 12,  // Crystal Dust — glittering shards
  Void      = 13,  // Void Dust — unstable matter from beyond
  // Background / environmental (not collectible by players)
  Fluid     = 14,  // Background fluid particle — invisible until disturbed
  Water     = 15,  // Water Dust — flowing droplets (collectible)
  Lava      = 16,  // Lava Dust — molten fragments (collectible)
  Stone     = 17,  // Stone Dust — ancient worn fragments (collectible)
  // Special / ability particles (not equippable)
  Gold      = 18,  // Grappling hook chain — bright golden diamond sparkles
  Light     = 19,  // Boss light chains — radiant white-gold glow
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
