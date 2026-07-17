import { BLOCK_SIZE_MEDIUM, type RoomDef } from '../levels/roomDef';
import { legacyChallengeGateToRoomGate, gatePersistenceKey } from '../levels/gateDefs';
import { getActiveCampaignId } from '../levels/campaigns';
import type { PlayerProgress } from '../progression/playerProgress';
import { MAX_WALLS, type WorldState } from '../sim/world';
import { createChallengeModeState, toggleChallengeTotem, updateChallengeFields } from '../sim/challengeMode';
import {
  clearGateLatchForSave,
  clearGateLatchForRoomExit,
  countQualifyingEnemies,
  createRuntimeGate,
  evaluateGateCondition,
  gateHasCollision,
  gateRectIsOccupied,
  updateGateState,
} from '../sim/gates/gateState';

const CHALLENGE_TOTEM_INTERACT_RADIUS_WORLD = 24;
const FIXED_GATE_TICK_MS = 16.666;

function installGateWall(world: WorldState, gateIndex: number): void {
  const gate = world.gates[gateIndex];
  if (world.wallCount >= MAX_WALLS) return;
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
  world.wallIsInvisibleFlag[wallIndex] = gateHasCollision(gate) ? 0 : 1;
  world.wallRampOrientationIndex[wallIndex] = 255;
  world.wallIsPillarHalfWidthFlag[wallIndex] = 0;
  world.wallIsBouncePadFlag[wallIndex] = 0;
  world.wallBouncePadSpeedFactorIndex[wallIndex] = 0;
  world.wallIsIceFlag[wallIndex] = 0;
  world.wallIsUltraIceFlag[wallIndex] = 0;
  world.wallIsKineticBlockFlag[wallIndex] = 0;
  world.wallKineticBlockIndex[wallIndex] = -1;
}

export function loadRoomChallengeElements(world: WorldState, room: RoomDef, progress?: PlayerProgress): void {
  world.challengeMode = createChallengeModeState(room.id, room.challengeFields ?? [], [], room.challengeTotems ?? []);
  const legacyGates = (room.challengeGates ?? []).map(legacyChallengeGateToRoomGate);
  const gateDefs = [...(room.gates ?? []), ...legacyGates];
  const permanentKeys = new Set(progress?.permanentlyOpenGateKeys ?? []);
  const campaignId = getActiveCampaignId();
  world.gates = gateDefs.map(def => createRuntimeGate(def, permanentKeys.has(gatePersistenceKey(campaignId, room.id, def.uid))));
  for (let i = 0; i < world.gates.length; i++) installGateWall(world, i);
  const player = world.clusters[0];
  if (player?.isPlayerFlag === 1) player.challengeMode = world.challengeMode;
}

export function updateRoomChallengeElements(world: WorldState, progress?: PlayerProgress): void {
  const player = world.clusters[0];
  if (!player || player.isPlayerFlag !== 1 || player.isAliveFlag === 0) return;
  player.challengeReturnGuard = 0;
  player.challengeMode = world.challengeMode;
  updateChallengeFields(world.challengeMode, player, BLOCK_SIZE_MEDIUM);
  if (world.challengeMode.isActive && world.challengeMode.activationAgeTicks < 90) world.challengeMode.activationAgeTicks++;
  if (world.challengeMode.returnSequence !== world.challengeMode.reconciledReturnSequence) {
    world.challengeMode.reconciledReturnSequence = world.challengeMode.returnSequence;
    world.isGrappleActiveFlag = 0;
    world.isGrappleZipActiveFlag = 0;
    world.grappleParticleStartIndex = -1;
    world.grappleCarryBlockIndex = -1;
  }

  const conditionContext = {
    challengeActive: world.challengeMode.isActive,
    playerHealth: player.healthPoints,
    playerMaxHealth: player.maxHealthPoints,
    playerVelocityXWorld: player.velocityXWorld,
    playerVelocityYWorld: player.velocityYWorld,
    qualifyingEnemyCount: countQualifyingEnemies(world.clusters),
  };
  const campaignId = getActiveCampaignId();
  for (const gate of world.gates) {
    if (progress && progress.permanentlyOpenGateKeys.includes(gatePersistenceKey(campaignId, world.builtForRoomId, gate.uid))) {
      gate.permanentlyOpen = true;
    }
    const conditionOpen = evaluateGateCondition(gate, conditionContext);
    if (conditionOpen && gate.openPersistence === 'forever' && !gate.permanentlyOpen) {
      gate.permanentlyOpen = true;
      if (progress && !progress.permanentlyOpenGateKeys.includes(gatePersistenceKey(campaignId, world.builtForRoomId, gate.uid))) {
        progress.permanentlyOpenGateKeys.push(gatePersistenceKey(campaignId, world.builtForRoomId, gate.uid));
      }
    }
    const occupied = gateRectIsOccupied(gate, world.clusters, BLOCK_SIZE_MEDIUM);
    updateGateState(gate, conditionOpen, occupied, FIXED_GATE_TICK_MS);
    if (gate.wallIndex < 0 || gate.wallIndex >= world.wallCount) continue;
    const solid = gateHasCollision(gate);
    world.wallWWorld[gate.wallIndex] = solid ? gate.wBlock * BLOCK_SIZE_MEDIUM : 0;
    world.wallHWorld[gate.wallIndex] = solid ? gate.hBlock * BLOCK_SIZE_MEDIUM : 0;
    world.wallIsInvisibleFlag[gate.wallIndex] = solid ? 0 : 1;
  }
}

export function handleGateSaveCompleted(world: WorldState): void {
  for (const gate of world.gates) clearGateLatchForSave(gate);
}

export function handleGateRoomExit(world: WorldState): void {
  for (const gate of world.gates) clearGateLatchForRoomExit(gate);
}

export function interactWithNearbyChallengeTotem(world: WorldState): boolean {
  const player = world.clusters[0];
  if (!player || player.isPlayerFlag !== 1) return false;
  let nearestUid = -1;
  let nearestDistance = CHALLENGE_TOTEM_INTERACT_RADIUS_WORLD;
  for (const totem of world.challengeMode.totems) {
    const distance = Math.hypot(player.positionXWorld - totem.xBlock * BLOCK_SIZE_MEDIUM, player.positionYWorld - totem.yBlock * BLOCK_SIZE_MEDIUM);
    if (distance <= nearestDistance) { nearestDistance = distance; nearestUid = totem.uid; }
  }
  if (nearestUid < 0) return false;
  toggleChallengeTotem(world.challengeMode, nearestUid, BLOCK_SIZE_MEDIUM);
  updateRoomChallengeElements(world);
  return true;
}
