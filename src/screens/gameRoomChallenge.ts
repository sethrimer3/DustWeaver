import { BLOCK_SIZE_MEDIUM, type RoomDef } from '../levels/roomDef';
import { MAX_WALLS, type WorldState } from '../sim/world';
import { createChallengeModeState, toggleChallengeTotem, updateChallengeFields } from '../sim/challengeMode';

const CHALLENGE_TOTEM_INTERACT_RADIUS_WORLD = 24;

export function loadRoomChallengeElements(world: WorldState, room: RoomDef): void {
  world.challengeMode = createChallengeModeState(
    room.id,
    room.challengeFields ?? [],
    room.challengeGates ?? [],
    room.challengeTotems ?? [],
  );
  for (const gate of world.challengeMode.gates) {
    if (world.wallCount >= MAX_WALLS) break;
    const wallIndex = world.wallCount++;
    gate.wallIndex = wallIndex;
    world.wallXWorld[wallIndex] = gate.xBlock * BLOCK_SIZE_MEDIUM;
    world.wallYWorld[wallIndex] = gate.yBlock * BLOCK_SIZE_MEDIUM;
    world.wallWWorld[wallIndex] = gate.wBlock * BLOCK_SIZE_MEDIUM;
    world.wallHWorld[wallIndex] = gate.hBlock * BLOCK_SIZE_MEDIUM;
    world.wallIsPlatformFlag[wallIndex] = 0;
    world.wallPlatformEdge[wallIndex] = 0;
    world.wallThemeIndex[wallIndex] = 255;
    world.wallSoundHardnessIndex[wallIndex] = 1;
    world.wallIsInvisibleFlag[wallIndex] = 0;
    world.wallRampOrientationIndex[wallIndex] = 255;
    world.wallIsPillarHalfWidthFlag[wallIndex] = 0;
    world.wallIsBouncePadFlag[wallIndex] = 0;
    world.wallBouncePadSpeedFactorIndex[wallIndex] = 0;
    world.wallIsIceFlag[wallIndex] = 0;
    world.wallIsUltraIceFlag[wallIndex] = 0;
    world.wallIsKineticBlockFlag[wallIndex] = 0;
    world.wallKineticBlockIndex[wallIndex] = -1;
  }
  const player = world.clusters[0];
  if (player?.isPlayerFlag === 1) player.challengeMode = world.challengeMode;
}

export function updateRoomChallengeElements(world: WorldState): void {
  const player = world.clusters[0];
  if (!player || player.isPlayerFlag !== 1 || player.isAliveFlag === 0) return;
  player.challengeReturnGuard = 0;
  player.challengeMode = world.challengeMode;
  updateChallengeFields(world.challengeMode, player, BLOCK_SIZE_MEDIUM);
  if (world.challengeMode.returnSequence !== world.challengeMode.reconciledReturnSequence) {
    world.challengeMode.reconciledReturnSequence = world.challengeMode.returnSequence;
    world.isGrappleActiveFlag = 0;
    world.isGrappleZipActiveFlag = 0;
    world.grappleParticleStartIndex = -1;
    world.grappleCarryBlockIndex = -1;
  }
  const open = world.challengeMode.isActive;
  for (const gate of world.challengeMode.gates) {
    if (gate.wallIndex < 0 || gate.wallIndex >= world.wallCount) continue;
    world.wallWWorld[gate.wallIndex] = open ? 0 : gate.wBlock * BLOCK_SIZE_MEDIUM;
    world.wallHWorld[gate.wallIndex] = open ? 0 : gate.hBlock * BLOCK_SIZE_MEDIUM;
    world.wallIsInvisibleFlag[gate.wallIndex] = open ? 1 : 0;
  }
}

export function interactWithNearbyChallengeTotem(world: WorldState): boolean {
  const player = world.clusters[0];
  if (!player || player.isPlayerFlag !== 1) return false;
  let nearestUid = -1;
  let nearestDistance = CHALLENGE_TOTEM_INTERACT_RADIUS_WORLD;
  for (const totem of world.challengeMode.totems) {
    const distance = Math.hypot(
      player.positionXWorld - totem.xBlock * BLOCK_SIZE_MEDIUM,
      player.positionYWorld - totem.yBlock * BLOCK_SIZE_MEDIUM,
    );
    if (distance <= nearestDistance) {
      nearestDistance = distance;
      nearestUid = totem.uid;
    }
  }
  if (nearestUid < 0) return false;
  toggleChallengeTotem(world.challengeMode, nearestUid, BLOCK_SIZE_MEDIUM);
  updateRoomChallengeElements(world);
  return true;
}
