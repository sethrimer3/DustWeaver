/**
 * Per-element behavior coefficient profiles.
 *
 * These are gameplay-oriented coefficients, not strict real-world physics.
 * Each profile shapes a distinct motion personality for its element — the goal
 * is that an observer can read the element purely from how the particles move.
 *
 * Adding a new element:
 *   1. Add a value to ParticleKind in kinds.ts.
 *   2. Create an ElementProfile constant below.
 *   3. Push it into ELEMENT_PROFILES at the matching index.
 *   4. Add a color to render/particles/styles.ts → ELEMENT_COLORS.
 */

import { ParticleKind } from './kinds';

// ---- Profile shape -------------------------------------------------------

export interface ElementProfile {
  // ---- Inertia / damping --------------------------------------------------
  /** Resistance to acceleration.  Higher = sluggish, dense feel. */
  massKg: number;
  /** Velocity decay per second (0 = frictionless, 3 = heavy drag). */
  drag: number;

  // ---- Owner-anchor behaviour ---------------------------------------------
  /** Spring constant pulling particle toward its anchor point on the owner. */
  attractionStrength: number;
  /** Constant-magnitude tangential force driving circular orbit. */
  orbitalStrength: number;
  /** Orbit radius at spawn (world units). */
  orbitRadiusWorld: number;

  // ---- Turbulence / chaos -------------------------------------------------
  /** Magnitude of the random force applied each noise step. */
  noiseAmplitude: number;
  /**
   * How quickly the noise direction changes.
   * 0 = never changes, 1 = new direction every tick.
   * Internally: noiseStepTick = floor(tick * instability).
   */
  instability: number;
  /** Magnitude of structured curl-noise turbulence (position-based). */
  curlStrength: number;
  /** Extra isotropic spreading force (adds "smoke-like" diffuse motion). */
  diffusion: number;

  // ---- Vertical drift -----------------------------------------------------
  /** Constant upward force (negative = downward gravity-like pull). */
  upwardBias: number;

  // ---- Neighbor interaction (same-owner particles only) -------------------
  /** Attraction toward neighbor centroid — forms clusters. */
  cohesion: number;
  /** Repulsion from very-close neighbors — prevents clumping. */
  separation: number;
  /** Velocity matching with neighbors — forms flocking streaks. */
  alignment: number;

  // ---- Lifetime -----------------------------------------------------------
  /** Base lifetime in simulation ticks. */
  lifetimeBaseTicks: number;
  /** ±Random variance added to base at spawn (uniform distribution). */
  lifetimeVarianceTicks: number;

  // ---- Render hints (not used in physics) ---------------------------------
  /** 0–1 "glow hotness" hint for the fragment shader. */
  temperature: number;
  /** 0–1 orderliness hint; affects visual quality not motion. */
  stability: number;

  // ---- Combat stats -------------------------------------------------------
  /** Particle durability — how many damage-points it takes to destroy this particle. */
  toughness: number;
  /** Damage dealt to enemy cluster per core-contact hit. */
  attackPower: number;
  /** Maximum simultaneous alive particles for this kind per cluster. */
  maxPopulationCount: number;
  /** Ticks to wait before a combat-killed particle respawns at its owner. */
  regenerationRateTicks: number;
}

// ---- Individual element presets -----------------------------------------

/** Physical — heavy, grounded, dense.  Slow decay, moderate orbit. */
const PHYSICAL: ElementProfile = {
  massKg:               2.5,
  drag:                 2.2,
  attractionStrength:   1.2,
  orbitalStrength:      20.0,
  orbitRadiusWorld:     30.0,
  noiseAmplitude:       8.0,
  instability:          0.04,
  curlStrength:         2.0,
  diffusion:            0.5,
  upwardBias:           -4.0,  // slight gravity
  cohesion:             0.35,
  separation:           0.5,
  alignment:            0.2,
  lifetimeBaseTicks:    420,
  lifetimeVarianceTicks: 120,
  temperature:          0.15,
  stability:            0.70,
  toughness:            2.0,
  attackPower:          1.5,
  maxPopulationCount:   20,
  regenerationRateTicks: 60,
};

/** Fire — flickering, rising, chaotic, lively.  Short lifetime. */
const FIRE: ElementProfile = {
  massKg:               0.4,
  drag:                 0.8,
  attractionStrength:   0.35,
  orbitalStrength:      38.0,
  orbitRadiusWorld:     28.0,
  noiseAmplitude:       65.0,
  instability:          0.38,   // noise direction changes ~every 3 ticks
  curlStrength:         20.0,
  diffusion:            14.0,
  upwardBias:           32.0,   // strong upward drift
  cohesion:             0.04,
  separation:           0.12,
  alignment:            0.04,
  lifetimeBaseTicks:    85,
  lifetimeVarianceTicks: 45,
  temperature:          1.0,
  stability:            0.08,
  toughness:            1.0,
  attackPower:          1.0,
  maxPopulationCount:   24,
  regenerationRateTicks: 30,
};

/** Ice — smooth, structured, crystalline.  Long lifetime. */
const ICE: ElementProfile = {
  massKg:               1.8,
  drag:                 3.0,
  attractionStrength:   2.4,
  orbitalStrength:      14.0,
  orbitRadiusWorld:     32.0,
  noiseAmplitude:       3.0,
  instability:          0.02,   // near-stable direction
  curlStrength:         1.0,
  diffusion:            0.15,
  upwardBias:           0.0,
  cohesion:             0.6,
  separation:           0.85,
  alignment:            0.55,
  lifetimeBaseTicks:    600,
  lifetimeVarianceTicks: 70,
  temperature:          0.04,
  stability:            0.95,
  toughness:            3.0,
  attackPower:          2.0,
  maxPopulationCount:   18,
  regenerationRateTicks: 90,
};

/** Lightning — jittery, snapping, volatile.  Very short lifetime. */
const LIGHTNING: ElementProfile = {
  massKg:               0.05,
  drag:                 0.2,
  attractionStrength:   0.25,
  orbitalStrength:      90.0,
  orbitRadiusWorld:     26.0,
  noiseAmplitude:       220.0,  // extreme random kicks
  instability:          1.0,    // new noise direction every tick
  curlStrength:         5.0,
  diffusion:            35.0,
  upwardBias:           0.0,
  cohesion:             0.0,
  separation:           1.3,    // spread far apart
  alignment:            0.0,
  lifetimeBaseTicks:    22,
  lifetimeVarianceTicks: 12,
  temperature:          0.8,
  stability:            0.0,
  toughness:            1.0,
  attackPower:          3.0,
  maxPopulationCount:   16,
  regenerationRateTicks: 20,
};

/** Poison — sticky, diffuse, slowly drifting. */
const POISON: ElementProfile = {
  massKg:               0.9,
  drag:                 1.5,
  attractionStrength:   0.7,
  orbitalStrength:      12.0,
  orbitRadiusWorld:     30.0,
  noiseAmplitude:       22.0,
  instability:          0.15,
  curlStrength:         10.0,
  diffusion:            18.0,
  upwardBias:           2.0,
  cohesion:             0.2,
  separation:           0.4,
  alignment:            0.15,
  lifetimeBaseTicks:    200,
  lifetimeVarianceTicks: 60,
  temperature:          0.3,
  stability:            0.3,
  toughness:            1.5,
  attackPower:          1.0,
  maxPopulationCount:   22,
  regenerationRateTicks: 45,
};

/** Arcane — tight orbital spiral, strange turbulence. */
const ARCANE: ElementProfile = {
  massKg:               0.3,
  drag:                 0.6,
  attractionStrength:   0.5,
  orbitalStrength:      60.0,
  orbitRadiusWorld:     34.0,
  noiseAmplitude:       28.0,
  instability:          0.12,
  curlStrength:         32.0,
  diffusion:            5.0,
  upwardBias:           0.0,
  cohesion:             0.1,
  separation:           0.3,
  alignment:            0.4,
  lifetimeBaseTicks:    300,
  lifetimeVarianceTicks: 100,
  temperature:          0.6,
  stability:            0.4,
  toughness:            1.5,
  attackPower:          2.0,
  maxPopulationCount:   20,
  regenerationRateTicks: 50,
};

/** Wind — fast, swirling, highly aligned. */
const WIND: ElementProfile = {
  massKg:               0.15,
  drag:                 0.4,
  attractionStrength:   0.3,
  orbitalStrength:      50.0,
  orbitRadiusWorld:     36.0,
  noiseAmplitude:       42.0,
  instability:          0.2,
  curlStrength:         38.0,
  diffusion:            22.0,
  upwardBias:           9.0,
  cohesion:             0.05,
  separation:           0.2,
  alignment:            0.65,
  lifetimeBaseTicks:    150,
  lifetimeVarianceTicks: 50,
  temperature:          0.1,
  stability:            0.35,
  toughness:            1.0,
  attackPower:          1.0,
  maxPopulationCount:   26,
  regenerationRateTicks: 25,
};

/** Holy — rising, orderly, warm glow. */
const HOLY: ElementProfile = {
  massKg:               0.6,
  drag:                 1.8,
  attractionStrength:   1.0,
  orbitalStrength:      26.0,
  orbitRadiusWorld:     30.0,
  noiseAmplitude:       10.0,
  instability:          0.06,
  curlStrength:         5.0,
  diffusion:            2.0,
  upwardBias:           13.0,
  cohesion:             0.5,
  separation:           0.4,
  alignment:            0.35,
  lifetimeBaseTicks:    360,
  lifetimeVarianceTicks: 90,
  temperature:          0.7,
  stability:            0.8,
  toughness:            2.0,
  attackPower:          2.5,
  maxPopulationCount:   18,
  regenerationRateTicks: 70,
};

/** Shadow — sinking, diffuse, unstable. */
const SHADOW: ElementProfile = {
  massKg:               1.2,
  drag:                 1.2,
  attractionStrength:   0.8,
  orbitalStrength:      20.0,
  orbitRadiusWorld:     30.0,
  noiseAmplitude:       38.0,
  instability:          0.18,
  curlStrength:         14.0,
  diffusion:            8.0,
  upwardBias:           -9.0,  // sinking
  cohesion:             0.15,
  separation:           0.35,
  alignment:            0.1,
  lifetimeBaseTicks:    260,
  lifetimeVarianceTicks: 80,
  temperature:          0.2,
  stability:            0.25,
  toughness:            1.5,
  attackPower:          2.0,
  maxPopulationCount:   20,
  regenerationRateTicks: 40,
};

/** Metal — dense, rigid, square-shaped. Slow orbit, high cohesion. */
const METAL: ElementProfile = {
  massKg:               4.0,
  drag:                 3.5,
  attractionStrength:   3.0,
  orbitalStrength:      10.0,
  orbitRadiusWorld:     28.0,
  noiseAmplitude:       4.0,
  instability:          0.01,
  curlStrength:         0.5,
  diffusion:            0.1,
  upwardBias:           -8.0,  // heavy gravity
  cohesion:             0.8,
  separation:           0.9,
  alignment:            0.6,
  lifetimeBaseTicks:    800,
  lifetimeVarianceTicks: 100,
  temperature:          0.05,
  stability:            0.98,
  toughness:            4.0,
  attackPower:          1.5,
  maxPopulationCount:   16,
  regenerationRateTicks: 120,
};

/** Earth — grounded, steady, triangular drift. Moderate lifetime. */
const EARTH: ElementProfile = {
  massKg:               2.0,
  drag:                 2.8,
  attractionStrength:   1.8,
  orbitalStrength:      16.0,
  orbitRadiusWorld:     30.0,
  noiseAmplitude:       12.0,
  instability:          0.05,
  curlStrength:         4.0,
  diffusion:            1.5,
  upwardBias:           -6.0,  // gravity-like
  cohesion:             0.5,
  separation:           0.6,
  alignment:            0.3,
  lifetimeBaseTicks:    500,
  lifetimeVarianceTicks: 120,
  temperature:          0.10,
  stability:            0.75,
  toughness:            2.5,
  attackPower:          1.0,
  maxPopulationCount:   20,
  regenerationRateTicks: 80,
};

/** Nature — organic tendrils, gently curling and flowing. */
const NATURE: ElementProfile = {
  massKg:               0.7,
  drag:                 1.2,
  attractionStrength:   0.6,
  orbitalStrength:      22.0,
  orbitRadiusWorld:     32.0,
  noiseAmplitude:       18.0,
  instability:          0.10,
  curlStrength:         26.0,   // strong curl gives organic feel
  diffusion:            6.0,
  upwardBias:           4.0,   // gentle upward drift
  cohesion:             0.25,
  separation:           0.35,
  alignment:            0.2,
  lifetimeBaseTicks:    320,
  lifetimeVarianceTicks: 80,
  temperature:          0.2,
  stability:            0.45,
  toughness:            1.5,
  attackPower:          1.0,
  maxPopulationCount:   24,
  regenerationRateTicks: 40,
};

/** Crystal — precise hexagonal orbits, very stable, bright. */
const CRYSTAL: ElementProfile = {
  massKg:               1.4,
  drag:                 2.6,
  attractionStrength:   2.2,
  orbitalStrength:      18.0,
  orbitRadiusWorld:     34.0,
  noiseAmplitude:       2.0,
  instability:          0.015,
  curlStrength:         0.8,
  diffusion:            0.1,
  upwardBias:           0.0,
  cohesion:             0.7,
  separation:           0.95,
  alignment:            0.65,
  lifetimeBaseTicks:    700,
  lifetimeVarianceTicks: 50,
  temperature:          0.55,
  stability:            0.92,
  toughness:            3.0,
  attackPower:          2.5,
  maxPopulationCount:   18,
  regenerationRateTicks: 100,
};

/** Void — drifting ring-shaped particles, slow decay, gravitational pull. */
const VOID: ElementProfile = {
  massKg:               0.8,
  drag:                 0.9,
  attractionStrength:   1.4,
  orbitalStrength:      30.0,
  orbitRadiusWorld:     40.0,
  noiseAmplitude:       16.0,
  instability:          0.08,
  curlStrength:         18.0,
  diffusion:            3.0,
  upwardBias:           -3.0,  // slow sink
  cohesion:             0.12,
  separation:           0.5,
  alignment:            0.3,
  lifetimeBaseTicks:    450,
  lifetimeVarianceTicks: 120,
  temperature:          0.45,
  stability:            0.5,
  toughness:            2.0,
  attackPower:          3.0,
  maxPopulationCount:   16,
  regenerationRateTicks: 60,
};

/**
 * Fluid — invisible background particles that flow like water.
 * They have no owner and drift freely via gentle curl noise.
 * They become visible when disturbed by nearby fast-moving particles.
 */
const FLUID: ElementProfile = {
  massKg:               0.12,   // very light — responsive to forces
  drag:                 1.8,    // enough drag to settle back after disturbance
  attractionStrength:   0.0,    // no owner anchor
  orbitalStrength:      0.0,
  orbitRadiusWorld:     60.0,   // spawn spread reference (used at spawn time)
  noiseAmplitude:       3.0,    // gentle random perturbation
  instability:          0.02,   // very slow noise direction changes — smooth drift
  curlStrength:         6.0,    // curl noise gives fluid-like meandering flow
  diffusion:            0.5,
  upwardBias:           0.0,
  cohesion:             0.0,    // no boid behaviour — fluid particles ignore each other
  separation:           0.0,
  alignment:            0.0,
  lifetimeBaseTicks:    4000,   // very long-lived; rarely respawn
  lifetimeVarianceTicks: 800,
  temperature:          0.0,    // cold/neutral
  stability:            1.0,
  toughness:            0.1,
  attackPower:          0.0,
  maxPopulationCount:   300,
  regenerationRateTicks: 0,
};

/**
 * Water — flowing, turbulent, moderately powerful.
 * Used for World 1 water-theme enemies.  Behaves like flowing liquid:
 * medium mass, strong curl noise, upward diffusion, moderate lifetime.
 */
const WATER: ElementProfile = {
  massKg:               0.55,
  drag:                 1.4,
  attractionStrength:   0.55,
  orbitalStrength:      28.0,
  orbitRadiusWorld:     32.0,
  noiseAmplitude:       28.0,
  instability:          0.12,
  curlStrength:         30.0,   // strong curl gives fluid flow feel
  diffusion:            12.0,
  upwardBias:           5.0,    // slight upward bubble tendency
  cohesion:             0.22,
  separation:           0.38,
  alignment:            0.28,
  lifetimeBaseTicks:    280,
  lifetimeVarianceTicks: 70,
  temperature:          0.18,
  stability:            0.42,
  toughness:            1.8,
  attackPower:          1.5,
  maxPopulationCount:   22,
  regenerationRateTicks: 50,
};

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
];

/** Returns the profile for `kind`, falling back to Physical if out of range. */
export function getElementProfile(kind: number): ElementProfile {
  return ELEMENT_PROFILES[kind] ?? PHYSICAL;
}

/** Colour-palette hint for external tooling that reads this module. */
export type { ParticleKind };
