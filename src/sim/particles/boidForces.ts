/**
 * Boid accumulation and application — cohesion, separation, and alignment
 * forces for same-owner particle pairs.
 *
 * Extracted from forces.ts as a pure code-organization refactor.
 * All scratch buffers are module-level pre-allocated singletons (no per-frame
 * allocation).
 */

import { MAX_PARTICLES } from './state';
import { getElementProfile } from './elementProfiles';

// ---- Boid accumulator scratch (pre-allocated once) -----------------------
const _cohesionX    = new Float32Array(MAX_PARTICLES);
const _cohesionY    = new Float32Array(MAX_PARTICLES);
const _alignX       = new Float32Array(MAX_PARTICLES);
const _alignY       = new Float32Array(MAX_PARTICLES);
const _neighborCount = new Uint16Array(MAX_PARTICLES);

/**
 * Reset the boid accumulators for the given particle count.
 * Must be called once per tick before any accumulateBoidPair calls.
 */
export function resetBoidAccumulators(count: number): void {
  _cohesionX.fill(0, 0, count);
  _cohesionY.fill(0, 0, count);
  _alignX.fill(0, 0, count);
  _alignY.fill(0, 0, count);
  _neighborCount.fill(0, 0, count);
}

/**
 * Accumulate boid data for a same-owner particle pair (i, j).
 * Called from the neighbor loop in forces.ts.
 */
export function accumulateBoidPair(
  i: number, j: number,
  positionXWorld: Float32Array, positionYWorld: Float32Array,
  velocityXWorld: Float32Array, velocityYWorld: Float32Array,
  forceX: Float32Array, forceY: Float32Array,
  dist: number, dx: number, dy: number,
  separationWeight: number,
  boidRangeWorld: number,
): void {
  _cohesionX[i] += positionXWorld[j];
  _cohesionY[i] += positionYWorld[j];
  _cohesionX[j] += positionXWorld[i];
  _cohesionY[j] += positionYWorld[i];
  _alignX[i]  += velocityXWorld[j];
  _alignY[i]  += velocityYWorld[j];
  _alignX[j]  += velocityXWorld[i];
  _alignY[j]  += velocityYWorld[i];
  _neighborCount[i]++;
  _neighborCount[j]++;

  // Separation: repel inside half range
  if (dist < boidRangeWorld * 0.45) {
    const sep = separationWeight * (1.0 - dist / (boidRangeWorld * 0.45)) / dist;
    const sfx = -dx * sep * 30.0;
    const sfy = -dy * sep * 30.0;
    forceX[i] += sfx;
    forceY[i] += sfy;
    forceX[j] -= sfx;
    forceY[j] -= sfy;
  }
}

/**
 * Apply accumulated boid forces (cohesion + alignment) to all alive particles.
 * Must be called once per tick after all accumulateBoidPair calls.
 */
export function applyBoidForces(
  particleCount: number,
  isAliveFlag: Uint8Array,
  kindBuffer: Uint8Array,
  positionXWorld: Float32Array, positionYWorld: Float32Array,
  velocityXWorld: Float32Array, velocityYWorld: Float32Array,
  forceX: Float32Array, forceY: Float32Array,
): void {
  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    const nc = _neighborCount[i];
    if (nc === 0) continue;

    const profile = getElementProfile(kindBuffer[i]);
    const invNc = 1.0 / nc;

    // Cohesion: steer toward average neighbor position
    if (profile.cohesion > 0.0) {
      const avgX = _cohesionX[i] * invNc;
      const avgY = _cohesionY[i] * invNc;
      forceX[i] += (avgX - positionXWorld[i]) * profile.cohesion * 2.0;
      forceY[i] += (avgY - positionYWorld[i]) * profile.cohesion * 2.0;
    }

    // Alignment: match average neighbor velocity
    if (profile.alignment > 0.0) {
      const avgVx = _alignX[i] * invNc;
      const avgVy = _alignY[i] * invNc;
      forceX[i] += (avgVx - velocityXWorld[i]) * profile.alignment * 0.5;
      forceY[i] += (avgVy - velocityYWorld[i]) * profile.alignment * 0.5;
    }
  }
}
