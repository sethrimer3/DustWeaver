/**
 * Environmental dust disturbance system.
 *
 * Background Fluid particles (ParticleKind.Fluid) are re-purposed here as
 * decorative dust motes. They rest on level surfaces at a low base visibility.
 * When movement-driven air disturbance passes close by, dust is lifted and swirled:
 *   • disturbanceFactor rises toward 1.0 (brighter/more visible).
 *   • A local push force is applied, giving a light airborne swirl response.
 *
 * Disturbance decays exponentially each tick toward RESTING_DUST_VISIBILITY
 * so the layer remains faintly visible even when calm.
 *
 * This runs after applyElementForces so forces accumulate correctly before
 * integration.  It is O(fluid_count × non_fluid_count); with ~300 fluid
 * particles and ~40 combat particles the inner loop is ≈12 000 iterations
 * per tick — negligible overhead.
 */

import { WorldState } from '../world';
import { ParticleKind } from './kinds';

/** Radius within which nearby moving particles disturb decorative dust. */
const DISTURB_RANGE_WORLD = 78.0;
const DISTURB_RANGE_SQ    = DISTURB_RANGE_WORLD * DISTURB_RANGE_WORLD;

/** Minimum speed (world units / tick) for a particle to count as "fast". */
const DISTURB_SPEED_THRESHOLD_SQ = 10.0 * 10.0;

/** Amount added to disturbanceFactor per disturbing neighbour per tick (scaled by influence). */
const DISTURB_INCREMENT = 0.20;

/** Exponential decay multiplier applied to disturbanceFactor each tick. */
const DISTURB_DECAY = 0.955;

/** Resting alpha level for the decorative dust layer. */
const RESTING_DUST_VISIBILITY = 0.22;

/** Magnitude of the push force applied to a Fluid particle when disturbed. */
const FLUID_PUSH_FORCE = 26.0;
/** Burst disturbance radius for hard landings. */
const LANDING_BURST_RANGE_WORLD = 110.0;
const LANDING_BURST_RANGE_SQ = LANDING_BURST_RANGE_WORLD * LANDING_BURST_RANGE_WORLD;
/** Extra burst influence applied by a landing event. */
const LANDING_BURST_GAIN = 0.65;

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

    // Decay disturbance toward a low resting visibility each tick.
    disturbanceFactor[i] = RESTING_DUST_VISIBILITY
      + (disturbanceFactor[i] - RESTING_DUST_VISIBILITY) * DISTURB_DECAY;

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

    for (let b = 0; b < world.dustAirBurstCount; b++) {
      const dx = px - world.dustAirBurstXWorld[b];
      const dy = py - world.dustAirBurstYWorld[b];
      const distSq = dx * dx + dy * dy;
      if (distSq > LANDING_BURST_RANGE_SQ) continue;

      const dist = Math.sqrt(distSq);
      const burstFalloff = 1.0 - dist / LANDING_BURST_RANGE_WORLD;
      const burstInfluence = burstFalloff * world.dustAirBurstStrength[b];
      const newFactor = disturbanceFactor[i] + LANDING_BURST_GAIN * burstInfluence;
      disturbanceFactor[i] = newFactor > 1.0 ? 1.0 : newFactor;

      const invDist = 1.0 / (dist + 0.001);
      forceX[i] += dx * invDist * FLUID_PUSH_FORCE * burstInfluence;
      // Give bursts a slight upward lift so landing sends a visible dust puff.
      forceY[i] += (dy * invDist - 0.25) * FLUID_PUSH_FORCE * burstInfluence;
    }
  }
}
