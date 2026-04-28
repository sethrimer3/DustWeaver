// xoshiro128** seeded PRNG — all sim randomness routes through here

export interface RngState {
  s0: number;
  s1: number;
  s2: number;
  s3: number;
}

export function createRng(seed: number): RngState {
  let s = seed >>> 0;
  function splitmix(): number {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  }
  return { s0: splitmix(), s1: splitmix(), s2: splitmix(), s3: splitmix() };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export function nextUint32(rng: RngState): number {
  const result = Math.imul(rotl(Math.imul(rng.s1, 5) >>> 0, 7), 9) >>> 0;
  const t = (rng.s1 << 9) >>> 0;
  rng.s2 = (rng.s2 ^ rng.s0) >>> 0;
  rng.s3 = (rng.s3 ^ rng.s1) >>> 0;
  rng.s1 = (rng.s1 ^ rng.s2) >>> 0;
  rng.s0 = (rng.s0 ^ rng.s3) >>> 0;
  rng.s2 = (rng.s2 ^ t) >>> 0;
  rng.s3 = rotl(rng.s3, 11);
  return result;
}

/** Returns a float in [0, 1) */
export function nextFloat(rng: RngState): number {
  return (nextUint32(rng) >>> 0) / 4294967296;
}

/** Returns a float in [min, max) */
export function nextFloatRange(rng: RngState, min: number, max: number): number {
  return min + nextFloat(rng) * (max - min);
}

/**
 * Returns a float in [-1, 1] with a triangular distribution peaking at 0.
 * Achieved by summing two uniform [0,1) samples and subtracting 1.
 */
export function nextFloatTriangle(rng: RngState): number {
  return nextFloat(rng) + nextFloat(rng) - 1.0;
}
