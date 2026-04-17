/**
 * Shared enemy-AI helpers.
 *
 * Pure sim/ logic — no DOM or browser dependencies.
 */

import { WorldState } from '../world';

/**
 * Returns the Euclidean distance from `cluster` to the player (clusters[0]).
 * Returns `Infinity` if the player is absent or dead.
 */
export function distToPlayer(
  cluster: { positionXWorld: number; positionYWorld: number },
  world: WorldState,
): number {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return Infinity;
  const dx = player.positionXWorld - cluster.positionXWorld;
  const dy = player.positionYWorld - cluster.positionYWorld;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Returns `true` if the player is alive and within `rangeWorld` of `cluster`.
 */
export function isPlayerInRange(
  cluster: { positionXWorld: number; positionYWorld: number },
  world: WorldState,
  rangeWorld: number,
): boolean {
  return distToPlayer(cluster, world) <= rangeWorld;
}
