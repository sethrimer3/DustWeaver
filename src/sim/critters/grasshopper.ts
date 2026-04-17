/**
 * Grasshopper critter simulation.
 *
 * Grasshoppers are ambient 1×1 pixel critters that hop randomly and flee
 * from the player and enemies within a detection radius.
 *
 * Pure deterministic logic — no Math.random(), no DOM, no wall-clock time.
 */

import { WorldState } from '../world';
import { nextFloat } from '../rng';

/** Detection radius: flee any threat within this distance (world units). */
const FLEE_RADIUS_WORLD = 60;
/** Horizontal flee speed (world units/s). */
const FLEE_HOP_SPEED_X_WORLD = 70;
/** Normal random hop horizontal speed (world units/s). */
const RANDOM_HOP_SPEED_X_WORLD = 30;
/** Vertical launch speed for each hop (world units/s, upward = negative). */
const HOP_SPEED_Y_WORLD = -120;
/** Gravity (world units/s²). */
const GRAVITY_WORLD_PER_SEC2 = 800;
/** Max fall speed (world units/s). */
const MAX_FALL_WORLD_PER_SEC = 350;
/** Min ticks between hops. */
const GRASSHOPPER_HOP_INTERVAL_MIN_TICKS = 50;
/** Random additional range for hop interval (ticks). */
const GRASSHOPPER_HOP_INTERVAL_RAND_TICKS = 80;

export function tickGrasshoppers(world: WorldState): void {
  const dtSec = world.dtMs * 0.001;

  // Find nearest threat (player or any live enemy cluster)
  let nearestThreatXWorld = 0;
  let nearestThreatYWorld = 0;
  let hasThreat = false;

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isAliveFlag === 0) continue;
    if (!hasThreat) {
      nearestThreatXWorld = c.positionXWorld;
      nearestThreatYWorld = c.positionYWorld;
      hasThreat = true;
    } else if (c.isPlayerFlag === 1) {
      nearestThreatXWorld = c.positionXWorld;
      nearestThreatYWorld = c.positionYWorld;
      break;
    }
  }

  for (let i = 0; i < world.grasshopperCount; i++) {
    if (world.isGrasshopperAliveFlag[i] === 0) continue;

    // Apply gravity
    world.grasshopperVelYWorld[i] += GRAVITY_WORLD_PER_SEC2 * dtSec;
    if (world.grasshopperVelYWorld[i] > MAX_FALL_WORLD_PER_SEC) {
      world.grasshopperVelYWorld[i] = MAX_FALL_WORLD_PER_SEC;
    }

    // Integrate position
    world.grasshopperXWorld[i] += world.grasshopperVelXWorld[i] * dtSec;
    world.grasshopperYWorld[i] += world.grasshopperVelYWorld[i] * dtSec;

    // Simple ground settle: clamp to world bottom edge
    if (world.grasshopperYWorld[i] > world.worldHeightWorld - 2) {
      world.grasshopperYWorld[i] = world.worldHeightWorld - 2;
      world.grasshopperVelYWorld[i] = 0;
    }

    // Clamp to world left/right
    if (world.grasshopperXWorld[i] < 2) {
      world.grasshopperXWorld[i] = 2;
      world.grasshopperVelXWorld[i] = Math.abs(world.grasshopperVelXWorld[i]);
    }
    if (world.grasshopperXWorld[i] > world.worldWidthWorld - 2) {
      world.grasshopperXWorld[i] = world.worldWidthWorld - 2;
      world.grasshopperVelXWorld[i] = -Math.abs(world.grasshopperVelXWorld[i]);
    }

    // Hop timer countdown
    world.grasshopperHopTimerTicks[i] -= 1;
    if (world.grasshopperHopTimerTicks[i] <= 0) {
      _triggerHop(world, i, nearestThreatXWorld, nearestThreatYWorld, hasThreat);
      world.grasshopperHopTimerTicks[i] = GRASSHOPPER_HOP_INTERVAL_MIN_TICKS
        + nextFloat(world.rng) * GRASSHOPPER_HOP_INTERVAL_RAND_TICKS;
    }
  }
}

function _triggerHop(
  world: WorldState,
  i: number,
  threatXWorld: number,
  threatYWorld: number,
  hasThreat: boolean,
): void {
  // Only hop when near-grounded (vel Y >= 0, i.e., not actively rising)
  if (world.grasshopperVelYWorld[i] < -10) return;

  let velX: number;

  if (hasThreat) {
    const dxToThreat = world.grasshopperXWorld[i] - threatXWorld;
    const dyToThreat = world.grasshopperYWorld[i] - threatYWorld;
    const distToThreat = Math.sqrt(dxToThreat * dxToThreat + dyToThreat * dyToThreat);
    if (distToThreat < FLEE_RADIUS_WORLD) {
      // Flee away from threat
      const fleeDir = dxToThreat >= 0 ? 1 : -1;
      velX = fleeDir * FLEE_HOP_SPEED_X_WORLD;
    } else {
      velX = (nextFloat(world.rng) > 0.5 ? 1 : -1) * RANDOM_HOP_SPEED_X_WORLD;
    }
  } else {
    velX = (nextFloat(world.rng) > 0.5 ? 1 : -1) * RANDOM_HOP_SPEED_X_WORLD;
  }

  world.grasshopperVelXWorld[i] = velX;
  world.grasshopperVelYWorld[i] = HOP_SPEED_Y_WORLD;
}
