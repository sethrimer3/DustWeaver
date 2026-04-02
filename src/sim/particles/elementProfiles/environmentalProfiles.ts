/**
 * Environmental / non-equippable element profiles — Fluid through Light
 * (ParticleKind indices 14–19).
 *
 * These are used by the world environment, grapple system, and boss particles —
 * not directly equippable by the player.
 */

import type { ElementProfile } from '../elementProfileTypes';

/**
 * Fluid — invisible background particles that flow like water.
 * They have no owner and drift freely via gentle curl noise.
 * They become visible when disturbed by nearby fast-moving particles.
 */
export const FLUID: ElementProfile = {
  massKg:               0.12,   // very light — responsive to forces
  drag:                 1.8,    // enough drag to settle back after disturbance
  attractionStrength:   0.0,    // no owner anchor
  orbitalStrength:      0.0,
  orbitRadiusWorld:     30.0,   // spawn spread reference (used at spawn time)
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
export const WATER: ElementProfile = {
  massKg:               0.55,
  drag:                 1.4,
  attractionStrength:   0.55,
  orbitalStrength:      28.0,
  orbitRadiusWorld:     3.0,
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

/**
 * Lava — slow, heavy, few in number but powerful.
 * Extremely long lifetime; low noise; strong gravity.
 * Leaves burning trails (implemented via lavaEffect.ts AoE damage).
 */
export const LAVA: ElementProfile = {
  massKg:               6.0,   // very heavy — slow and sluggish
  drag:                 4.5,   // high drag — settles quickly
  attractionStrength:   2.5,
  orbitalStrength:      8.0,   // slow orbit
  orbitRadiusWorld:     2.5,
  noiseAmplitude:       5.0,   // low turbulence — deliberate movement
  instability:          0.02,
  curlStrength:         3.0,
  diffusion:            0.5,
  upwardBias:           -12.0, // strong gravity — sinks like molten rock
  cohesion:             0.6,
  separation:           0.8,
  alignment:            0.4,
  lifetimeBaseTicks:    900,   // very long-lived — persistent threats
  lifetimeVarianceTicks: 120,
  temperature:          1.0,   // maximum heat glow
  stability:            0.85,
  toughness:            3.5,   // durable
  attackPower:          3.0,   // high damage per contact
  maxPopulationCount:   8,     // few particles — rare and impactful
  regenerationRateTicks: 150,  // slow regeneration
};

/**
 * Stone — dense, physical, fragmented.
 * Moderate lifetime; low noise; shatters into small stone shards on
 * impact with walls or enemy particles.
 */
export const STONE: ElementProfile = {
  massKg:               3.0,   // heavy but less than lava
  drag:                 3.0,
  attractionStrength:   2.0,
  orbitalStrength:      12.0,
  orbitRadiusWorld:     3.0,
  noiseAmplitude:       6.0,
  instability:          0.03,
  curlStrength:         1.5,
  diffusion:            0.3,
  upwardBias:           -8.0,  // falls like rocks
  cohesion:             0.55,
  separation:           0.7,
  alignment:            0.35,
  lifetimeBaseTicks:    550,
  lifetimeVarianceTicks: 100,
  temperature:          0.05,
  stability:            0.80,
  toughness:            2.8,   // tough but brittle on impact
  attackPower:          2.0,
  maxPopulationCount:   14,
  regenerationRateTicks: 100,
};

/**
 * Gold — grappling hook chain particles.
 * Stable, low-turbulence, warm glowing appearance.
 * Positions are overridden each tick by the grapple system; physics parameters
 * have minimal effect but are set low to avoid visible drift between updates.
 */
export const GOLD: ElementProfile = {
  massKg:               1.0,
  drag:                 2.5,
  attractionStrength:   0.0,   // grapple system controls position directly
  orbitalStrength:      0.0,
  orbitRadiusWorld:     5.0,
  noiseAmplitude:       4.0,   // slight shimmer
  instability:          0.06,
  curlStrength:         0.8,
  diffusion:            0.3,
  upwardBias:           0.0,
  cohesion:             0.0,
  separation:           0.0,
  alignment:            0.0,
  lifetimeBaseTicks:    999999, // effectively infinite — managed by grapple system
  lifetimeVarianceTicks: 0,
  temperature:          0.85,   // warm glow
  stability:            0.90,
  toughness:            1.0,
  attackPower:          0.0,    // chain particles deal no combat damage
  maxPopulationCount:   10,
  regenerationRateTicks: 0,
};

/**
 * Light — Radiant Tether boss particles.
 * Bright, floaty, with moderate orbit.  Non-combat (damage is via chain system).
 */
export const LIGHT: ElementProfile = {
  massKg:               0.6,
  drag:                 1.8,
  attractionStrength:   120.0,
  orbitalStrength:      55.0,
  orbitRadiusWorld:     12.0,
  noiseAmplitude:       8.0,
  instability:          0.08,
  curlStrength:         2.0,
  diffusion:            0.6,
  upwardBias:           3.0,
  cohesion:             0.15,
  separation:           0.10,
  alignment:            0.05,
  lifetimeBaseTicks:    600,
  lifetimeVarianceTicks: 120,
  temperature:          0.95,
  stability:            0.85,
  toughness:            1.0,
  attackPower:          0.5,
  maxPopulationCount:   50,
  regenerationRateTicks: 30,
};
