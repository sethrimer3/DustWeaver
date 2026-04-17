/**
 * Shared pure-math utilities.
 *
 * Pure TypeScript — no DOM or browser dependencies. Safe to import from
 * both sim/ and render/ layers.
 */

/** Clamps `value` between `min` and `max` (inclusive). */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Euclidean distance between points (ax, ay) and (bx, by). */
export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Squared Euclidean distance — avoids sqrt when only comparisons are needed. */
export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/** Linear interpolation from `a` to `b` by factor `t` (unclamped). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
