/**
 * Rope physics simulation using Verlet integration.
 *
 * Each rope consists of up to MAX_ROPE_SEGMENTS Verlet nodes connected by
 * rigid-distance constraints.  Anchor A (index 0) is always fixed.  Anchor B
 * (last index) may also be fixed when ropeIsAnchorBFixedFlag=1.
 *
 * Integration uses a simple position-Verlet scheme:
 *   newPos = 2·pos - prevPos + gravity·dt²
 * Constraints are relaxed ROPE_CONSTRAINT_ITERATIONS times per tick.
 */

import { WorldState, MAX_ROPE_SEGMENTS } from '../world';

/** Number of Gauss-Seidel constraint iterations per tick. */
const ROPE_CONSTRAINT_ITERATIONS = 10;

/** Gravity acceleration (world units per second²). */
const ROPE_GRAVITY_WORLD_PER_SEC2 = 320.0;

/** Small epsilon to avoid division by zero in constraint resolution. */
const ROPE_LENGTH_EPSILON = 0.001;

export function tickRopes(world: WorldState): void {
  if (world.ropeCount === 0) return;

  const dtSec = world.dtMs * 0.001;
  const dt2 = dtSec * dtSec;
  const gravityDt2 = ROPE_GRAVITY_WORLD_PER_SEC2 * dt2;

  for (let r = 0; r < world.ropeCount; r++) {
    const segCount = world.ropeSegmentCount[r];
    if (segCount < 2) continue;
    const base = r * MAX_ROPE_SEGMENTS;
    const restLen = world.ropeSegRestLenWorld[r];

    // ── Verlet integration (skip segment 0 — always anchored) ───────────
    for (let s = 1; s < segCount; s++) {
      const idx = base + s;
      const curX = world.ropeSegPosXWorld[idx];
      const curY = world.ropeSegPosYWorld[idx];
      const prevX = world.ropeSegPrevXWorld[idx];
      const prevY = world.ropeSegPrevYWorld[idx];
      const velX = curX - prevX;
      const velY = curY - prevY;
      world.ropeSegPrevXWorld[idx] = curX;
      world.ropeSegPrevYWorld[idx] = curY;
      world.ropeSegPosXWorld[idx] = curX + velX;
      world.ropeSegPosYWorld[idx] = curY + velY + gravityDt2;
    }

    // ── Constraint relaxation ─────────────────────────────────────────────
    for (let iter = 0; iter < ROPE_CONSTRAINT_ITERATIONS; iter++) {
      // Re-pin anchor A
      world.ropeSegPosXWorld[base] = world.ropeAnchorAXWorld[r];
      world.ropeSegPosYWorld[base] = world.ropeAnchorAYWorld[r];

      // Distance constraints between adjacent segments
      for (let s = 0; s < segCount - 1; s++) {
        const idxA = base + s;
        const idxB = base + s + 1;
        const dx = world.ropeSegPosXWorld[idxB] - world.ropeSegPosXWorld[idxA];
        const dy = world.ropeSegPosYWorld[idxB] - world.ropeSegPosYWorld[idxA];
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < ROPE_LENGTH_EPSILON) continue;
        const diff = (dist - restLen) / dist;

        const isAFixed = s === 0;
        const isBFixed = (s + 1 === segCount - 1) && world.ropeIsAnchorBFixedFlag[r] === 1;

        if (isAFixed && isBFixed) {
          // Both pinned — no correction
        } else if (isAFixed) {
          world.ropeSegPosXWorld[idxB] -= dx * diff;
          world.ropeSegPosYWorld[idxB] -= dy * diff;
        } else if (isBFixed) {
          world.ropeSegPosXWorld[idxA] += dx * diff;
          world.ropeSegPosYWorld[idxA] += dy * diff;
        } else {
          const half = diff * 0.5;
          world.ropeSegPosXWorld[idxA] += dx * half;
          world.ropeSegPosYWorld[idxA] += dy * half;
          world.ropeSegPosXWorld[idxB] -= dx * half;
          world.ropeSegPosYWorld[idxB] -= dy * half;
        }
      }

      // Re-pin anchor B if fixed
      if (world.ropeIsAnchorBFixedFlag[r] === 1) {
        const lastIdx = base + segCount - 1;
        world.ropeSegPosXWorld[lastIdx] = world.ropeAnchorBXWorld[r];
        world.ropeSegPosYWorld[lastIdx] = world.ropeAnchorBYWorld[r];
      }
    }
  }
}

/**
 * Initialises a rope's Verlet node positions as a straight line from anchor A
 * to anchor B, with prev positions equal to current (zero initial velocity).
 */
export function initRopeSegments(
  world: WorldState,
  ropeIndex: number,
): void {
  const segCount = world.ropeSegmentCount[ropeIndex];
  const base = ropeIndex * MAX_ROPE_SEGMENTS;
  const ax = world.ropeAnchorAXWorld[ropeIndex];
  const ay = world.ropeAnchorAYWorld[ropeIndex];
  const bx = world.ropeAnchorBXWorld[ropeIndex];
  const by = world.ropeAnchorBYWorld[ropeIndex];

  for (let s = 0; s < segCount; s++) {
    const t = segCount > 1 ? s / (segCount - 1) : 0.0;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const idx = base + s;
    world.ropeSegPosXWorld[idx]  = x;
    world.ropeSegPosYWorld[idx]  = y;
    world.ropeSegPrevXWorld[idx] = x;
    world.ropeSegPrevYWorld[idx] = y;
  }
}
