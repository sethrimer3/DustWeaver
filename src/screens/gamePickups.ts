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
import { ParticleKind, isEquippableParticleKind } from '../sim/particles/kinds';
import { spawnClusterParticles } from './gameSpawn';
import { grantDustContainerMotes, grantPlayerMotes } from '../sim/playerMoteLife';
import {
  DUST_CONTAINER_PICKUP_RADIUS_WORLD,
  DUST_CONTAINER_SHARD_PICKUP_RADIUS_WORLD,
  DUST_CONTAINER_SHARDS_PER_CONTAINER,
} from './gameRoom';

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
 * @param onPickupBurst  Optional callback invoked once per first-time Dust
 *   Container / Shard pickup with the collectible's world-space center, so
 *   the caller can drive a render-only cosmetic effect without coupling this
 *   deterministic sim/progression code to Canvas or DOM. Not invoked for the
 *   automatic 4th-shard container forge (that grant piggybacks on the shard's
 *   own pickup, which already fired its callback).
 */
export function processRoomPickups(
  world: WorldState,
  currentRoom: RoomDef,
  collectedKeySet: Set<string>,
  progress: PlayerProgress | undefined,
  player: ClusterState,
  levelRng: RngState,
  roomOriginXWorld = 0,
  roomOriginYWorld = 0,
  onPickupBurst?: (kind: 'container' | 'shard', xWorld: number, yWorld: number) => void,
): void {
  // ── Dust container pickups ─────────────────────────────────────────────────
  // One permanent Dust Container adds four mote-capacity slots and fills all
  // four new slots in one atomic pickup transaction.
  const roomDustContainers = currentRoom.dustContainers ?? [];
  for (let i = 0; i < roomDustContainers.length; i++) {
    const pickupKey = `${currentRoom.id}:container:${i}`;
    if (collectedKeySet.has(pickupKey)) continue;

    const dc = roomDustContainers[i];
    // Container positions are in room-local coords; convert to world-space.
    const cx = roomOriginXWorld + (dc.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    const cy = roomOriginYWorld + (dc.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    const dx = player.positionXWorld - cx;
    const dy = player.positionYWorld - cy;
    if (dx * dx + dy * dy <= DUST_CONTAINER_PICKUP_RADIUS_WORLD * DUST_CONTAINER_PICKUP_RADIUS_WORLD) {
      collectedKeySet.add(pickupKey);
      grantDustContainerMotes(player);
      if (progress) {
        progress.dustContainerCount += 1;
        if (!progress.collectedDustContainerKeys.includes(pickupKey)) {
          progress.collectedDustContainerKeys.push(pickupKey);
        }
      }
      if (onPickupBurst) onPickupBurst('container', cx, cy);
    }
  }

  // A Dust Shard restores one current mote. The existing persistent four-shard
  // forging rule remains; forging grants the resulting Container atomically.
  const roomDustContainerPieces = currentRoom.dustContainerPieces ?? [];
  for (let i = 0; i < roomDustContainerPieces.length; i++) {
    const pickupKey = `${currentRoom.id}:containerShard:${i}`;
    if (collectedKeySet.has(pickupKey)) continue;

    const piece = roomDustContainerPieces[i];
    const cx = roomOriginXWorld + (piece.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    const cy = roomOriginYWorld + (piece.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    const dx = player.positionXWorld - cx;
    const dy = player.positionYWorld - cy;
    if (dx * dx + dy * dy <= DUST_CONTAINER_SHARD_PICKUP_RADIUS_WORLD * DUST_CONTAINER_SHARD_PICKUP_RADIUS_WORLD) {
      collectedKeySet.add(pickupKey);
      grantPlayerMotes(player, 1);
      if (progress) {
        progress.dustContainerPieces += 1;
        if (!progress.collectedDustContainerKeys.includes(pickupKey)) {
          progress.collectedDustContainerKeys.push(pickupKey);
        }
        if (progress.dustContainerPieces >= DUST_CONTAINER_SHARDS_PER_CONTAINER) {
          const forgedContainerCount = Math.floor(progress.dustContainerPieces / DUST_CONTAINER_SHARDS_PER_CONTAINER);
          progress.dustContainerCount += forgedContainerCount;
          grantDustContainerMotes(player, forgedContainerCount);
          progress.dustContainerPieces %= DUST_CONTAINER_SHARDS_PER_CONTAINER;
        }
      }
      // Only the shard's own 4-mote burst fires here — the auto-forged
      // container (if any) intentionally does not add a second 16-mote burst.
      if (onPickupBurst) onPickupBurst('shard', cx, cy);
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
      if (!isEquippableParticleKind(dustKind)) continue;
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
