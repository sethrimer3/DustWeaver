/**
 * Equippable element profiles — Physical through Void (ParticleKind indices 0–13).
 *
 * These are the 14 kinds players can equip and use in combat.
 */

import type { ElementProfile } from '../elementProfileTypes';

/** Physical — heavy, grounded, dense.  Slow decay, moderate orbit. */
export const PHYSICAL: ElementProfile = {
  massKg:               2.5,
  drag:                 2.2,
  attractionStrength:   1.2,
  orbitalStrength:      20.0,
  orbitRadiusWorld:     3.0,
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
export const FIRE: ElementProfile = {
  massKg:               0.4,
  drag:                 0.8,
  attractionStrength:   0.35,
  orbitalStrength:      38.0,
  orbitRadiusWorld:     3.0,
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
export const ICE: ElementProfile = {
  massKg:               1.8,
  drag:                 3.0,
  attractionStrength:   2.4,
  orbitalStrength:      14.0,
  orbitRadiusWorld:     3.0,
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
export const LIGHTNING: ElementProfile = {
  massKg:               0.05,
  drag:                 0.2,
  attractionStrength:   0.25,
  orbitalStrength:      90.0,
  orbitRadiusWorld:     2.5,
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
export const POISON: ElementProfile = {
  massKg:               0.9,
  drag:                 1.5,
  attractionStrength:   0.7,
  orbitalStrength:      12.0,
  orbitRadiusWorld:     3.0,
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
export const ARCANE: ElementProfile = {
  massKg:               0.3,
  drag:                 0.6,
  attractionStrength:   0.5,
  orbitalStrength:      60.0,
  orbitRadiusWorld:     3.5,
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
export const WIND: ElementProfile = {
  massKg:               0.15,
  drag:                 0.4,
  attractionStrength:   0.3,
  orbitalStrength:      50.0,
  orbitRadiusWorld:     3.5,
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
export const HOLY: ElementProfile = {
  massKg:               0.6,
  drag:                 1.8,
  attractionStrength:   1.0,
  orbitalStrength:      26.0,
  orbitRadiusWorld:     3.0,
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
export const SHADOW: ElementProfile = {
  massKg:               1.2,
  drag:                 1.2,
  attractionStrength:   0.8,
  orbitalStrength:      20.0,
  orbitRadiusWorld:     3.0,
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
export const METAL: ElementProfile = {
  massKg:               4.0,
  drag:                 3.5,
  attractionStrength:   3.0,
  orbitalStrength:      10.0,
  orbitRadiusWorld:     3.0,
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
export const EARTH: ElementProfile = {
  massKg:               2.0,
  drag:                 2.8,
  attractionStrength:   1.8,
  orbitalStrength:      16.0,
  orbitRadiusWorld:     3.0,
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
export const NATURE: ElementProfile = {
  massKg:               0.7,
  drag:                 1.2,
  attractionStrength:   0.6,
  orbitalStrength:      22.0,
  orbitRadiusWorld:     3.0,
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
export const CRYSTAL: ElementProfile = {
  massKg:               1.4,
  drag:                 2.6,
  attractionStrength:   2.2,
  orbitalStrength:      18.0,
  orbitRadiusWorld:     3.5,
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
export const VOID: ElementProfile = {
  massKg:               0.8,
  drag:                 0.9,
  attractionStrength:   1.4,
  orbitalStrength:      30.0,
  orbitRadiusWorld:     4.0,
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
