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
};

// ---- Lookup table --------------------------------------------------------

/**
 * Profile table indexed by ParticleKind value.
 * Must stay in sync with the ParticleKind enum order.
 */
export const ELEMENT_PROFILES: ElementProfile[] = [
  PHYSICAL,   // 0 — ParticleKind.Physical
  FIRE,       // 1 — ParticleKind.Fire
  ICE,        // 2 — ParticleKind.Ice
  LIGHTNING,  // 3 — ParticleKind.Lightning
  POISON,     // 4 — ParticleKind.Poison
  ARCANE,     // 5 — ParticleKind.Arcane
  WIND,       // 6 — ParticleKind.Wind
  HOLY,       // 7 — ParticleKind.Holy
  SHADOW,     // 8 — ParticleKind.Shadow
];

/** Returns the profile for `kind`, falling back to Physical if out of range. */
export function getElementProfile(kind: number): ElementProfile {
  return ELEMENT_PROFILES[kind] ?? PHYSICAL;
}

/** Colour-palette hint for external tooling that reads this module. */
export type { ParticleKind };
