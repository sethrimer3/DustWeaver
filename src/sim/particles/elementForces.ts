/**
 * Per-element layered forces: noise, curl-noise, upward bias, and diffusion.
 *
 * These forces run once per alive particle each tick and do NOT require
 * spatial queries — they only depend on the particle's own state and its
 * owner's position.  Neighbor-interaction forces (cohesion, separation,
 * alignment) live in forces.ts alongside inter-cluster repulsion.
 *
 * All randomness uses a deterministic integer hash so results are identical
 * regardless of particle processing order, avoiding a shared PRNG state.
 */

import { WorldState } from '../world';
import { getElementProfile } from './elementProfiles';

// ---- Deterministic noise hash -------------------------------------------

/**
 * Fast integer hash: maps (a, b) → float in [0, 1).
 * No external state; same inputs always produce the same output.
 */
function hashFloat(a: number, b: number): number {
  // Combine two 32-bit integers with multiply-xorshift
  let v = ((a * 1597334677) ^ (b * 3812015801)) >>> 0;
  v = (Math.imul(v ^ (v >>> 16), 0x45d9f3b)) >>> 0;
  v = v ^ (v >>> 16);
  return (v >>> 0) / 4294967296;
}

// ---- Curl-noise helper ---------------------------------------------------

/**
 * Approximates a 2D divergence-free (curl) flow field via a scalar potential.
 *
 *   ψ(x, y, t) = sin(x * FREQ + t) * cos(y * FREQ)
 *   curl_x =  ∂ψ/∂y = -sin(x * FREQ + t) * sin(y * FREQ) * FREQ
 *   curl_y = -∂ψ/∂x = -cos(x * FREQ + t) * cos(y * FREQ) * FREQ
 *
 * Multiplied by curlStrength to give a controllable force magnitude.
 */
const CURL_FREQ = 0.018;   // spatial frequency of the flow field
const CURL_TIME_SCALE = 0.004;  // how fast the flow evolves over time

function curlForce(
  outXY: Float32Array,   // [0] ← fx,  [1] ← fy  (pre-allocated scratch)
  px: number,
  py: number,
  tick: number,
  strength: number,
): void {
  const t = tick * CURL_TIME_SCALE;
  const sx = Math.sin(px * CURL_FREQ + t);
  const cx = Math.cos(px * CURL_FREQ + t);
  const sy = Math.sin(py * CURL_FREQ);
  const cy = Math.cos(py * CURL_FREQ);
  outXY[0] = -sx * sy * CURL_FREQ * strength;
  outXY[1] = -cx * cy * CURL_FREQ * strength;
}

// Pre-allocated scratch to avoid per-call allocation in the hot path.
const _curlScratch = new Float32Array(2);

// ---- Main export --------------------------------------------------------

/**
 * Applies per-element forces to every alive particle:
 *   1. Hash-noise perturbation (staggered per particle via noiseTickSeed)
 *   2. Curl-noise turbulence (structured, position-based)
 *   3. Isotropic diffusion
 *   4. Upward / buoyancy bias
 *
 * Called by tick() after force-clear and before binding / inter-particle
 * passes so forces from all layers accumulate correctly.
 */
export function applyElementForces(world: WorldState): void {
  const {
    positionXWorld, positionYWorld,
    forceX, forceY,
    isAliveFlag, kindBuffer, noiseTickSeed,
    particleCount, tick,
  } = world;

  for (let i = 0; i < particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;

    const profile = getElementProfile(kindBuffer[i]);
    const px = positionXWorld[i];
    const py = positionYWorld[i];

    // ---- 1. Hash-noise perturbation ------------------------------------
    // instability controls how fast the noise direction changes:
    //   instability=1.0 → new direction every tick
    //   instability=0.1 → new direction every ~10 ticks
    const noiseTick = Math.floor(tick * profile.instability) | 0;
    const noiseAngleRad = hashFloat(noiseTickSeed[i], noiseTick) * (Math.PI * 2);
    forceX[i] += Math.cos(noiseAngleRad) * profile.noiseAmplitude;
    forceY[i] += Math.sin(noiseAngleRad) * profile.noiseAmplitude;

    // ---- 2. Curl-noise turbulence -------------------------------------
    if (profile.curlStrength > 0.0) {
      curlForce(_curlScratch, px, py, tick, profile.curlStrength);
      forceX[i] += _curlScratch[0];
      forceY[i] += _curlScratch[1];
    }

    // ---- 3. Isotropic diffusion (second independent noise sample) -----
    if (profile.diffusion > 0.0) {
      const diffAngleRad = hashFloat(noiseTickSeed[i] ^ 0xdeadbeef, noiseTick + 7) * (Math.PI * 2);
      forceX[i] += Math.cos(diffAngleRad) * profile.diffusion;
      forceY[i] += Math.sin(diffAngleRad) * profile.diffusion;
    }

    // ---- 4. Upward / buoyancy bias ----------------------------------------
    // Force is applied in simulation/world space where Y increases downward.
    // A positive upwardBias produces an upward screen movement by subtracting
    // from forceY.  Negative values (e.g. Physical, Shadow) create a sinking
    // gravity-like pull.
    forceY[i] -= profile.upwardBias;
  }
}
