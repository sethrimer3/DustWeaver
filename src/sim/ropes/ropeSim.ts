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
 *
 * Wall collision: after each constraint pass, non-pinned segments are pushed
 * out of solid wall AABBs using the segment's half-thickness radius.
 */

import { WorldState, MAX_ROPE_SEGMENTS } from '../world';

/** Number of Gauss-Seidel constraint iterations per tick. */
const ROPE_CONSTRAINT_ITERATIONS = 10;

/** Gravity acceleration (world units per second²). */
const ROPE_GRAVITY_WORLD_PER_SEC2 = 320.0;

/** Small epsilon to avoid division by zero in constraint resolution. */
const ROPE_LENGTH_EPSILON = 0.001;

/**
 * Number of synthetic ticks used to pre-settle ropes into their natural
 * sagged position at room load time.  At 60 fps, 180 ticks = ~3 seconds
 * of simulation time — sufficient for most rope configurations to reach
 * a stable resting catenary without visible fall-in on first render.
 */
const ROPE_PRESIMULATE_TICKS = 180;

/** Simulated dt (seconds) used during pre-settling. */
const ROPE_PRESIMULATE_DT_SEC = 1.0 / 60.0;

/**
 * Pushes a single non-pinned rope node out of any overlapping solid wall.
 * Treats the node as a circle of radius `halfThick` and finds the minimum
 * penetration axis to resolve the overlap.
 */
function pushNodeOutOfWalls(
  world: WorldState,
  idx: number,
  halfThick: number,
): void {
  for (let wi = 0; wi < world.wallCount; wi++) {
    const wallLeft   = world.wallXWorld[wi];
    const wallTop    = world.wallYWorld[wi];
    const wallRight  = wallLeft + world.wallWWorld[wi];
    const wallBottom = wallTop  + world.wallHWorld[wi];

    const nx = world.ropeSegPosXWorld[idx];
    const ny = world.ropeSegPosYWorld[idx];

    // Expanded AABB by halfThick
    if (nx < wallLeft   - halfThick) continue;
    if (nx > wallRight  + halfThick) continue;
    if (ny < wallTop    - halfThick) continue;
    if (ny > wallBottom + halfThick) continue;

    // Closest point on AABB to node center
    const cpx = Math.max(wallLeft, Math.min(wallRight,  nx));
    const cpy = Math.max(wallTop,  Math.min(wallBottom, ny));
    const dx = nx - cpx;
    const dy = ny - cpy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist >= halfThick) continue; // No overlap

    if (dist < ROPE_LENGTH_EPSILON) {
      // Node is exactly on wall surface — push up by halfThick
      world.ropeSegPosXWorld[idx] = nx;
      world.ropeSegPosYWorld[idx] = wallTop - halfThick;
    } else {
      const pen = halfThick - dist;
      world.ropeSegPosXWorld[idx] = nx + (dx / dist) * pen;
      world.ropeSegPosYWorld[idx] = ny + (dy / dist) * pen;
    }
  }
}

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
    const halfThick = world.ropeHalfThickWorld[r];

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

      // ── Wall collision for non-pinned segments ─────────────────────────
      if (world.wallCount > 0 && halfThick > 0) {
        // Segment 0 (anchor A) is always pinned — skip.
        // Segment (segCount-1) skipped only if anchor B is also pinned.
        const lastFree = world.ropeIsAnchorBFixedFlag[r] === 1 ? segCount - 2 : segCount - 1;
        for (let s = 1; s <= lastFree; s++) {
          pushNodeOutOfWalls(world, base + s, halfThick);
        }
      }
    }
  }
}

/**
 * Pre-settles all ropes into their natural sagged resting position.
 *
 * Runs ROPE_PRESIMULATE_TICKS iterations using a fixed dt of 1/60 s so that
 * when the room first renders, ropes appear already hanging under gravity
 * rather than falling from a straight-line initial state.
 *
 * This is called once per room load (after initRopeSegments).  It is
 * deterministic: given the same room geometry the settled shape is identical
 * every time the room is entered.
 */
export function presettleRopes(world: WorldState): void {
  if (world.ropeCount === 0) return;

  // Temporarily override dtMs for the pre-simulation
  const savedDtMs = world.dtMs;
  world.dtMs = ROPE_PRESIMULATE_DT_SEC * 1000.0;

  for (let i = 0; i < ROPE_PRESIMULATE_TICKS; i++) {
    tickRopes(world);
  }

  // Restore the original dtMs
  world.dtMs = savedDtMs;

  // Sync prev positions to current so that Verlet integration on the first
  // real tick starts with zero initial velocity (settled position).
  for (let r = 0; r < world.ropeCount; r++) {
    const segCount = world.ropeSegmentCount[r];
    const base = r * MAX_ROPE_SEGMENTS;
    for (let s = 0; s < segCount; s++) {
      const idx = base + s;
      world.ropeSegPrevXWorld[idx] = world.ropeSegPosXWorld[idx];
      world.ropeSegPrevYWorld[idx] = world.ropeSegPosYWorld[idx];
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
