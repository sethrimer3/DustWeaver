/**
 * In-game collectible pickup logic for the game screen.
 *
 * Handles dust containers (permanent capacity upgrades) and dust boost jars
 * (temporary particle grants).  Called every frame while the player is alive.
 */

import type { WorldState } from '../sim/world';
import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { ClusterState } from '../sim/clusters/state';
import type { PlayerProgress } from '../progression/playerProgress';
import type { RngState } from '../sim/rng';
import { ParticleKind } from '../sim/particles/kinds';
import { spawnClusterParticles } from './gameSpawn';
import { DUST_CONTAINER_PICKUP_RADIUS_WORLD, DUST_CONTAINER_DUST_GAIN } from './gameRoom';

/**
 * Checks dust containers and dust boost jars for proximity pickup by the
 * player, spawning particles and updating progress state as appropriate.
 *
 * @param world          Mutable world state.
 * @param currentRoom    Active room definition (supplies dustContainers array).
 * @param collectedKeySet  Set of already-collected pickup keys (mutated on pickup).
 * @param progress       Player progression state, or undefined in arcade mode.
 * @param player         The live player cluster (positionXWorld/Y, entityId).
 * @param levelRng       Room-level RNG for particle spawning.
 */
export function processRoomPickups(
  world: WorldState,
  currentRoom: RoomDef,
  collectedKeySet: Set<string>,
  progress: PlayerProgress | undefined,
  player: ClusterState,
  levelRng: RngState,
): void {
  // ── Dust container pickups ─────────────────────────────────────────────────
  // Grants +1 dust container (+4 particle capacity) and spawns burst particles.
  const roomDustContainers = currentRoom.dustContainers ?? [];
  for (let i = 0; i < roomDustContainers.length; i++) {
    const pickupKey = `${currentRoom.id}:${i}`;
    if (collectedKeySet.has(pickupKey)) continue;

    const dc = roomDustContainers[i];
    const cx = (dc.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    const cy = (dc.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    const dx = player.positionXWorld - cx;
    const dy = player.positionYWorld - cy;
    if (dx * dx + dy * dy <= DUST_CONTAINER_PICKUP_RADIUS_WORLD * DUST_CONTAINER_PICKUP_RADIUS_WORLD) {
      collectedKeySet.add(pickupKey);
      if (progress) {
        progress.dustContainerCount += 1;
      }
      spawnClusterParticles(
        world,
        player.entityId,
        player.positionXWorld,
        player.positionYWorld,
        ParticleKind.Physical,
        DUST_CONTAINER_DUST_GAIN,
        levelRng,
      );
    }
  }

  // ── Dust boost jar pickups ─────────────────────────────────────────────────
  // The sim (hazards.ts) deactivates jars on contact; we detect the transition
  // here and spawn particles of the jar's element kind on the renderer side.
  for (let i = 0; i < world.dustBoostJarCount; i++) {
    const jarKey = `dustjar:${currentRoom.id}:${i}`;
    if (world.isDustBoostJarActiveFlag[i] === 0 && !collectedKeySet.has(jarKey)) {
      collectedKeySet.add(jarKey);
      const dustKind = world.dustBoostJarKind[i] as ParticleKind;
      const dustCount = world.dustBoostJarDustCount[i];
      spawnClusterParticles(
        world,
        player.entityId,
        player.positionXWorld,
        player.positionYWorld,
        dustKind,
        dustCount,
        levelRng,
      );
    }
  }
}
