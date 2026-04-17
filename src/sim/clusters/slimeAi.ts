/**
 * Slime enemy AI.
 *
 * Small Slime: hops toward the player every HOP_INTERVAL_TICKS when grounded.
 * Large Dust Slime: slower hops, orbiting dust, splits into 2 small slimes on death.
 *
 * Pure deterministic logic — no Math.random(), no DOM, no wall-clock time.
 */

import { WorldState } from '../world';
import { ClusterState, createClusterState } from './state';
import { nextFloat } from '../rng';

/** Ticks between hops for a small slime. */
const SLIME_HOP_INTERVAL_TICKS = 60;
/** Horizontal speed during hop (world units/s). */
const SLIME_HOP_SPEED_X_WORLD = 150;
/** Vertical launch speed during hop (world units/s, upward = negative). */
const SLIME_HOP_SPEED_Y_WORLD = -200;
/** Gravity (world units/s²). */
const SLIME_GRAVITY_WORLD_PER_SEC2 = 900;
/** Max fall speed (world units/s). */
const SLIME_MAX_FALL_WORLD_PER_SEC = 400;

/** Ticks between hops for a large slime. */
const LARGE_SLIME_HOP_INTERVAL_TICKS = 90;
/** Horizontal speed during large slime hop (world units/s). */
const LARGE_SLIME_HOP_SPEED_X_WORLD = 90;
/** Vertical launch speed during large slime hop (world units/s, upward = negative). */
const LARGE_SLIME_HOP_SPEED_Y_WORLD = -160;
/** Orbit angular velocity (radians/tick). */
const LARGE_SLIME_ORBIT_SPEED_RAD_PER_TICK = 0.04;

/** Half-width and half-height of a small slime (world units). */
export const SLIME_HALF_SIZE_WORLD = 4;
/** Half-width and half-height of a large slime (world units). */
export const LARGE_SLIME_HALF_SIZE_WORLD = 7;
/** Horizontal offset for each child small slime on split (world units). */
const SPLIT_OFFSET_X_WORLD = 10;

export function applySlimeAI(world: WorldState): void {
  const dtSec = world.dtMs * 0.001;

  // Find player
  let playerXWorld = 0;
  let playerFound = false;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerXWorld = c.positionXWorld;
      playerFound = true;
      break;
    }
  }

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isSlimeFlag !== 1 || cluster.isAliveFlag === 0) continue;

    // Apply gravity
    cluster.velocityYWorld += SLIME_GRAVITY_WORLD_PER_SEC2 * dtSec;
    if (cluster.velocityYWorld > SLIME_MAX_FALL_WORLD_PER_SEC) {
      cluster.velocityYWorld = SLIME_MAX_FALL_WORLD_PER_SEC;
    }

    // Count down hop timer
    cluster.slimeHopTimerTicks -= 1;
    if (cluster.slimeHopTimerTicks <= 0 && cluster.isGroundedFlag === 1 && playerFound) {
      const dirX = playerXWorld > cluster.positionXWorld ? 1 : -1;
      cluster.velocityXWorld = dirX * SLIME_HOP_SPEED_X_WORLD;
      cluster.velocityYWorld = SLIME_HOP_SPEED_Y_WORLD;
      cluster.slimeHopTimerTicks = SLIME_HOP_INTERVAL_TICKS;
    } else if (cluster.slimeHopTimerTicks <= 0) {
      cluster.slimeHopTimerTicks = SLIME_HOP_INTERVAL_TICKS;
    }
  }
}

export function applyLargeSlimeAI(world: WorldState): void {
  const dtSec = world.dtMs * 0.001;

  // Find player
  let playerXWorld = 0;
  let playerFound = false;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerXWorld = c.positionXWorld;
      playerFound = true;
      break;
    }
  }

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isLargeSlimeFlag !== 1 || cluster.isAliveFlag === 0) continue;

    // Apply gravity
    cluster.velocityYWorld += SLIME_GRAVITY_WORLD_PER_SEC2 * dtSec;
    if (cluster.velocityYWorld > SLIME_MAX_FALL_WORLD_PER_SEC) {
      cluster.velocityYWorld = SLIME_MAX_FALL_WORLD_PER_SEC;
    }

    // Orbit angle for dust visuals
    cluster.largeSlimeDustOrbitAngleRad += LARGE_SLIME_ORBIT_SPEED_RAD_PER_TICK;

    // Hop timer
    cluster.slimeHopTimerTicks -= 1;
    if (cluster.slimeHopTimerTicks <= 0 && cluster.isGroundedFlag === 1 && playerFound) {
      const dirX = playerXWorld > cluster.positionXWorld ? 1 : -1;
      cluster.velocityXWorld = dirX * LARGE_SLIME_HOP_SPEED_X_WORLD;
      cluster.velocityYWorld = LARGE_SLIME_HOP_SPEED_Y_WORLD;
      cluster.slimeHopTimerTicks = LARGE_SLIME_HOP_INTERVAL_TICKS;
    } else if (cluster.slimeHopTimerTicks <= 0) {
      cluster.slimeHopTimerTicks = LARGE_SLIME_HOP_INTERVAL_TICKS;
    }
  }
}

/**
 * After the main tick, check for large slimes that just died and haven't
 * split yet. Returns newly created small-slime clusters to add to the world.
 * Called from gameScreen after tick().
 */
export function processLargeSlimeSplits(world: WorldState): ClusterState[] {
  const toAdd: ClusterState[] = [];
  let nextId = 1;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    nextId = Math.max(nextId, world.clusters[ci].entityId + 1);
  }

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (
      cluster.isLargeSlimeFlag !== 1 ||
      cluster.isAliveFlag !== 0 ||
      cluster.largeSlimeSplitDoneFlag !== 0
    ) continue;

    cluster.largeSlimeSplitDoneFlag = 1;

    for (let s = 0; s < 2; s++) {
      const offsetX = s === 0 ? -SPLIT_OFFSET_X_WORLD : SPLIT_OFFSET_X_WORLD;
      const child = createClusterState(
        nextId++,
        cluster.positionXWorld + offsetX,
        cluster.positionYWorld,
        0,
        8,
      );
      child.isSlimeFlag = 1;
      child.halfWidthWorld = SLIME_HALF_SIZE_WORLD;
      child.halfHeightWorld = SLIME_HALF_SIZE_WORLD;
      child.slimeHopTimerTicks = 20 + ((nextFloat(world.rng) * 20) | 0);
      child.velocityYWorld = -80;
      toAdd.push(child);
    }
  }

  return toAdd;
}
