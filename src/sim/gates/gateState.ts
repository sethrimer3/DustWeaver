import type { ClusterState } from '../clusters/state';
import type { GateKind, GateOpenPersistence, GateOpenVisualMode, RoomGateDef } from '../../levels/gateDefs';

export type GatePhase = 'closed' | 'opening' | 'open' | 'pendingClose' | 'closing';
export const GATE_TRANSITION_DURATION_MS = 180;
export const SPEED_GATE_HYSTERESIS_WORLD = 4;
export const POWDER_PARTICLES_PER_BLOCK = 3;
export const POWDER_PARTICLE_CAP = 160;

export interface RuntimeGate extends RoomGateDef {
  phase: GatePhase;
  transitionElapsedMs: number;
  wallIndex: number;
  runtimeLatchedOpen: boolean;
  permanentlyOpen: boolean;
  powderEmissionSequence: number;
  speedConditionWasOpen: boolean;
}

export interface GateConditionContext {
  challengeActive: boolean;
  playerHealth: number;
  playerMaxHealth: number;
  playerVelocityXWorld: number;
  playerVelocityYWorld: number;
  qualifyingEnemyCount: number;
}

export interface GateOccupant {
  isAliveFlag: 0 | 1;
  positionXWorld: number;
  positionYWorld: number;
  halfWidthWorld: number;
  halfHeightWorld: number;
}

export function createRuntimeGate(def: RoomGateDef, permanentlyOpen = false): RuntimeGate {
  return {
    ...def,
    phase: permanentlyOpen ? 'open' : 'closed',
    transitionElapsedMs: permanentlyOpen ? GATE_TRANSITION_DURATION_MS : 0,
    wallIndex: -1,
    runtimeLatchedOpen: false,
    permanentlyOpen,
    powderEmissionSequence: 0,
    speedConditionWasOpen: false,
  };
}

export function countsTowardEnemyGate(cluster: ClusterState): boolean {
  return cluster.isPlayerFlag === 0 && cluster.isAliveFlag === 1 && cluster.countsTowardRoomCompletionFlag === 1;
}

export function countQualifyingEnemies(clusters: readonly ClusterState[]): number {
  let count = 0;
  for (const cluster of clusters) if (countsTowardEnemyGate(cluster)) count++;
  return count;
}

export function evaluateGateCondition(gate: RuntimeGate, context: GateConditionContext): boolean {
  switch (gate.kind) {
    case 'enemy': return context.qualifyingEnemyCount === 0;
    case 'challenge': return context.challengeActive;
    case 'heart': return context.playerHealth + 0.001 >= context.playerMaxHealth;
    case 'speed': {
      const speed = Math.hypot(context.playerVelocityXWorld, context.playerVelocityYWorld);
      const threshold = gate.requiredSpeed ?? 0;
      const margin = gate.speedConditionWasOpen ? -SPEED_GATE_HYSTERESIS_WORLD : SPEED_GATE_HYSTERESIS_WORLD;
      const open = speed >= threshold + margin;
      gate.speedConditionWasOpen = open;
      return open;
    }
  }
}

export function gateRectIsOccupied(gate: RoomGateDef, occupants: readonly GateOccupant[], blockSizeWorld: number): boolean {
  const left = gate.xBlock * blockSizeWorld;
  const right = (gate.xBlock + gate.wBlock) * blockSizeWorld;
  const top = gate.yBlock * blockSizeWorld;
  const bottom = (gate.yBlock + gate.hBlock) * blockSizeWorld;
  for (const occupant of occupants) {
    if (occupant.isAliveFlag === 0) continue;
    if (occupant.positionXWorld + occupant.halfWidthWorld > left &&
        occupant.positionXWorld - occupant.halfWidthWorld < right &&
        occupant.positionYWorld + occupant.halfHeightWorld > top &&
        occupant.positionYWorld - occupant.halfHeightWorld < bottom) return true;
  }
  return false;
}

function wantsOpen(gate: RuntimeGate, conditionOpen: boolean): boolean {
  return gate.permanentlyOpen || gate.runtimeLatchedOpen || conditionOpen;
}

export function updateGateState(
  gate: RuntimeGate,
  conditionOpen: boolean,
  occupied: boolean,
  elapsedMs: number,
): void {
  const desiredOpen = wantsOpen(gate, conditionOpen);
  if (desiredOpen && gate.openPersistence !== 'forever') gate.runtimeLatchedOpen = true;
  if (desiredOpen) {
    if (gate.phase === 'closed' || gate.phase === 'closing' || gate.phase === 'pendingClose') {
      gate.phase = 'opening';
      gate.transitionElapsedMs = 0;
      if (gate.openVisualMode === 'powder') gate.powderEmissionSequence++;
    }
    if (gate.phase === 'opening') {
      gate.transitionElapsedMs = Math.min(GATE_TRANSITION_DURATION_MS, gate.transitionElapsedMs + Math.max(0, elapsedMs));
      if (gate.transitionElapsedMs >= GATE_TRANSITION_DURATION_MS) gate.phase = 'open';
    }
    return;
  }
  if (gate.phase === 'open' || gate.phase === 'opening') {
    gate.phase = occupied ? 'pendingClose' : 'closing';
    gate.transitionElapsedMs = 0;
  } else if (gate.phase === 'pendingClose' && !occupied) {
    gate.phase = 'closing';
    gate.transitionElapsedMs = 0;
  } else if (gate.phase === 'closing') {
    if (occupied) {
      gate.phase = 'pendingClose';
      gate.transitionElapsedMs = 0;
    } else {
      gate.transitionElapsedMs = Math.min(GATE_TRANSITION_DURATION_MS, gate.transitionElapsedMs + Math.max(0, elapsedMs));
      if (gate.transitionElapsedMs >= GATE_TRANSITION_DURATION_MS) gate.phase = 'closed';
    }
  }
}

export function gateHasCollision(gate: RuntimeGate): boolean {
  return gate.phase === 'closed';
}

export function gateVisualOpacity(gate: RuntimeGate): number {
  const t = Math.max(0, Math.min(1, gate.transitionElapsedMs / GATE_TRANSITION_DURATION_MS));
  if (gate.phase === 'closed' || gate.phase === 'pendingClose') return gate.phase === 'closed' ? 1 : 0;
  if (gate.phase === 'opening') return 1 - t;
  if (gate.phase === 'closing') return t;
  return gate.openVisualMode === 'darkRecessed' ? 0.28 : 0;
}

export function clearGateLatchForSave(gate: RuntimeGate): void {
  if (gate.openPersistence === 'untilPlayerSaves') gate.runtimeLatchedOpen = false;
}

export function clearGateLatchForRoomExit(gate: RuntimeGate): void {
  if (gate.openPersistence === 'untilPlayerLeavesRoom') gate.runtimeLatchedOpen = false;
}

export function powderParticleCount(gate: Pick<RuntimeGate, 'wBlock' | 'hBlock'>, qualityScale = 1): number {
  return Math.min(POWDER_PARTICLE_CAP, Math.max(0, Math.floor(gate.wBlock * gate.hBlock * POWDER_PARTICLES_PER_BLOCK * qualityScale)));
}

export type { GateKind, GateOpenPersistence, GateOpenVisualMode };
