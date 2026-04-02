/**
 * ElementProfile interface — shared type definition used by elementProfiles.ts
 * and the per-category sub-files.
 */

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
