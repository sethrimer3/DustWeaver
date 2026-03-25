/**
 * Fluid particle disturbance system.
 *
 * Background Fluid particles (ParticleKind.Fluid) are normally 100 % transparent
 * and invisible.  When a fast-moving non-Fluid particle passes close by, the
 * Fluid particle becomes disturbed:
 *   • Its disturbanceFactor increases toward 1.0 (fully visible).
 *   • A gentle push force is applied, making it flow away — like water parting.
 *
 * Each tick, disturbanceFactor decays exponentially back toward 0 so that
 * trails fade smoothly after the disturbing particle has moved on.
 *
 * This runs after applyElementForces so forces accumulate correctly before
 * integration.  It is O(fluid_count × non_fluid_count); with ~300 fluid
 * particles and ~40 combat particles the inner loop is ≈12 000 iterations
 * per tick — negligible overhead.
 */

import { WorldState } from '../world';
import { ParticleKind } from './kinds';

/** Radius within which a fast non-Fluid particle disturbs nearby Fluid. */
const DISTURB_RANGE_WORLD = 70.0;
const DISTURB_RANGE_SQ    = DISTURB_RANGE_WORLD * DISTURB_RANGE_WORLD;

/** Minimum speed (world units / tick) for a particle to count as "fast". */
const DISTURB_SPEED_THRESHOLD_SQ = 10.0 * 10.0;

/** Amount added to disturbanceFactor per disturbing neighbour per tick (scaled by influence). */
const DISTURB_INCREMENT = 0.20;

/** Exponential decay multiplier applied to disturbanceFactor each tick. */
const DISTURB_DECAY = 0.965;

/** Magnitude of the push force applied to a Fluid particle when disturbed. */
const FLUID_PUSH_FORCE = 18.0;

export function applyFluidDisturbance(world: WorldState): void {
  const {
    positionXWorld, positionYWorld,
    velocityXWorld, velocityYWorld,
    forceX, forceY,
    kindBuffer, isAliveFlag,
    disturbanceFactor,
    particleCount,
  } = world;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    if (kindBuffer[i] !== ParticleKind.Fluid) continue;

    // Decay disturbance toward zero each tick
    disturbanceFactor[i] *= DISTURB_DECAY;

    const px = positionXWorld[i];
    const py = positionYWorld[i];

    // Check all non-Fluid alive particles for proximity and speed
    for (let j = 0; j < particleCount; j++) {
      if (isAliveFlag[j] === 0) continue;
      if (kindBuffer[j] === ParticleKind.Fluid) continue;

      const dx = px - positionXWorld[j];
      const dy = py - positionYWorld[j];
      const distSq = dx * dx + dy * dy;

      if (distSq > DISTURB_RANGE_SQ) continue;

      const vx = velocityXWorld[j];
      const vy = velocityYWorld[j];
      const speedSq = vx * vx + vy * vy;

      if (speedSq < DISTURB_SPEED_THRESHOLD_SQ) continue;

      const dist = Math.sqrt(distSq);
      const influence = 1.0 - dist / DISTURB_RANGE_WORLD;

      // Raise disturbance — clamped to [0, 1]
      const newFactor = disturbanceFactor[i] + DISTURB_INCREMENT * influence;
      disturbanceFactor[i] = newFactor > 1.0 ? 1.0 : newFactor;

      // Push the Fluid particle away from the disturbing particle
      const invDist = 1.0 / (dist + 0.001);
      forceX[i] += dx * invDist * FLUID_PUSH_FORCE * influence;
      forceY[i] += dy * invDist * FLUID_PUSH_FORCE * influence;
    }
  }
}
