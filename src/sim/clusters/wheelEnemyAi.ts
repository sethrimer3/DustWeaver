/**
 * Wheel Enemy AI — rolls along surfaces toward the player.
 * Adheres to the floor (normal gravity), reverses direction at edges.
 *
 * Pure deterministic logic — no Math.random(), no DOM, no wall-clock time.
 */

import { WorldState } from '../world';

/** Roll speed toward player (world units/s). */
const WHEEL_ROLL_SPEED_WORLD_PER_SEC = 55;
/** Roll visual radius (world units) — used to convert velocity to angle. */
const WHEEL_RADIUS_WORLD = 4;
/** Half-width and half-height of a wheel enemy (world units). */
export const WHEEL_ENEMY_HALF_SIZE_WORLD = 4;
/** Gravity (world units/s²). */
const NORMAL_GRAVITY_WORLD_PER_SEC2 = 900;
/** Max fall speed (world units/s). */
const FAST_MAX_FALL_WORLD_PER_SEC = 400;
/** Edge detection lookahead below cluster edge (world units). */
const EDGE_LOOKAHEAD_WORLD = 4;
/** Offset beyond cluster half-width for edge sample point (world units). */
const EDGE_SAMPLE_OFFSET_WORLD = 1;

function hasFloorBelow(
  world: WorldState,
  clusterBottomYWorld: number,
  sampleXWorld: number,
): boolean {
  for (let wi = 0; wi < world.wallCount; wi++) {
    if (world.wallIsPlatformFlag[wi] === 1) continue;
    const wx = world.wallXWorld[wi];
    const wy = world.wallYWorld[wi];
    const ww = world.wallWWorld[wi];
    const wh = world.wallHWorld[wi];
    const wallTopY = wy;
    const wallBottomY = wy + wh;
    if (
      sampleXWorld >= wx &&
      sampleXWorld <= wx + ww &&
      clusterBottomYWorld >= wallTopY - EDGE_LOOKAHEAD_WORLD &&
      clusterBottomYWorld <= wallTopY + EDGE_LOOKAHEAD_WORLD &&
      wallBottomY > wallTopY
    ) {
      return true;
    }
  }
  return false;
}

export function applyWheelEnemyAI(world: WorldState): void {
  const dtSec = world.dtMs * 0.001;

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
    if (cluster.isWheelEnemyFlag !== 1 || cluster.isAliveFlag === 0) continue;

    // Apply gravity
    cluster.velocityYWorld += NORMAL_GRAVITY_WORLD_PER_SEC2 * dtSec;
    if (cluster.velocityYWorld > FAST_MAX_FALL_WORLD_PER_SEC) {
      cluster.velocityYWorld = FAST_MAX_FALL_WORLD_PER_SEC;
    }

    if (playerFound && cluster.isGroundedFlag === 1) {
      const dxToPlayerWorld = playerXWorld - cluster.positionXWorld;
      const dirX = dxToPlayerWorld > 0 ? 1 : -1;

      const clusterBottomYWorld = cluster.positionYWorld + cluster.halfHeightWorld;
      const leadingEdgeSampleXWorld = cluster.positionXWorld + dirX * (cluster.halfWidthWorld + EDGE_SAMPLE_OFFSET_WORLD);
      const hasFloor = hasFloorBelow(world, clusterBottomYWorld, leadingEdgeSampleXWorld);

      if (!hasFloor) {
        cluster.velocityXWorld = -dirX * WHEEL_ROLL_SPEED_WORLD_PER_SEC;
      } else {
        cluster.velocityXWorld = dirX * WHEEL_ROLL_SPEED_WORLD_PER_SEC;
      }
    } else if (!playerFound) {
      cluster.velocityXWorld = 0;
    }

    // Update roll angle from horizontal velocity
    cluster.wheelRollAngleRad += cluster.velocityXWorld * dtSec / WHEEL_RADIUS_WORLD;
  }
}
