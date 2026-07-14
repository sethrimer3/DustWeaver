import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { PlayerProgress } from '../progression/playerProgress';
import { getElementProfile } from '../sim/particles/elementProfiles';
import type { WorldState } from '../sim/world';

export interface SkillTombActivationPorts {
  getCurrentRoomOrigin(): readonly [number, number];
  getCurrentRoomId(): string;
  getNearbyTombIndex(localXWorld: number, localYWorld: number): number;
  getTombPosition(index: number): { xWorld: number; yWorld: number } | null;
  onCheckpointReached?: () => void;
  onSave?: () => void;
}

export interface SkillTombActivationResult {
  playerXWorld: number;
  playerYWorld: number;
  playerHealthPoints: number;
  playerMaxHealthPoints: number;
}

export function applySkillTombActivation(
  world: WorldState,
  progress: PlayerProgress,
  ports: SkillTombActivationPorts,
): SkillTombActivationResult {
  const player = world.clusters[0];
  if (player === undefined) {
    return {
      playerXWorld: 0,
      playerYWorld: 0,
      playerHealthPoints: 0,
      playerMaxHealthPoints: 0,
    };
  }

  const [currentRoomOriginXWorld, currentRoomOriginYWorld] = ports.getCurrentRoomOrigin();
  const nearbyIndex = ports.getNearbyTombIndex(
    player.positionXWorld - currentRoomOriginXWorld,
    player.positionYWorld - currentRoomOriginYWorld,
  );
  if (nearbyIndex >= 0) {
    const tombPosition = ports.getTombPosition(nearbyIndex);
    if (tombPosition !== null) {
      progress.lastSaveRoomId = ports.getCurrentRoomId();
      progress.lastSaveSpawnBlock = [
        Math.round(tombPosition.xWorld / BLOCK_SIZE_MEDIUM),
        Math.round(tombPosition.yWorld / BLOCK_SIZE_MEDIUM),
      ];
      if (ports.onCheckpointReached) ports.onCheckpointReached();
      if (ports.onSave) ports.onSave();
    }
  }

  player.healthPoints = player.maxHealthPoints;
  for (let particleIndex = 0; particleIndex < world.particleCount; particleIndex++) {
    if (world.ownerEntityId[particleIndex] !== player.entityId) continue;
    if (world.isTransientFlag[particleIndex] === 1) continue;
    if (world.isAliveFlag[particleIndex] === 0 && world.respawnDelayTicks[particleIndex] > 0) {
      world.respawnDelayTicks[particleIndex] = 1;
    }
    if (world.isAliveFlag[particleIndex] === 1) {
      world.particleDurability[particleIndex] = getElementProfile(world.kindBuffer[particleIndex]).toughness;
    }
  }

  return {
    playerXWorld: player.positionXWorld,
    playerYWorld: player.positionYWorld,
    playerHealthPoints: player.maxHealthPoints,
    playerMaxHealthPoints: player.maxHealthPoints,
  };
}
