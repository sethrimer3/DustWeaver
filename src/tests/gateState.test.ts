import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoomGateDef } from '../levels/gateDefs';
import {
  GATE_TRANSITION_DURATION_MS,
  SPEED_GATE_HYSTERESIS_WORLD,
  clearGateLatchForSave,
  clearGateLatchForRoomExit,
  countQualifyingEnemies,
  createRuntimeGate,
  evaluateGateCondition,
  gateHasCollision,
  gateRectIsOccupied,
  powderParticleCount,
  updateGateState,
} from '../sim/gates/gateState';
import { createClusterState } from '../sim/clusters/state';

const base = { schemaVersion: 1, uid: 1, xBlock: 2, yBlock: 3, wBlock: 2, hBlock: 4, openVisualMode: 'fadeAway', openPersistence: 'untilPlayerSaves' } as const;
const context = { challengeActive: false, playerHealth: 3, playerMaxHealth: 3, playerVelocityXWorld: 0, playerVelocityYWorld: 0, qualifyingEnemyCount: 0 };

test('normalization validates enums, dimensions, duplicate IDs, and speed', () => {
  const used = new Set([4]);
  const gate = normalizeRoomGateDef({ uid: 4, kind: 'speed', xBlock: -3, yBlock: 9, wBlock: 0, hBlock: 99, requiredSpeed: Number.NaN, openVisualMode: 'bad' as never }, { widthBlocks: 10, heightBlocks: 10, usedUids: used, allocateUid: () => 8 });
  assert.deepEqual(gate, { schemaVersion: 1, uid: 8, kind: 'speed', xBlock: 0, yBlock: 9, wBlock: 1, hBlock: 1, openVisualMode: 'fadeAway', openPersistence: 'untilPlayerLeavesRoom', requiredSpeed: 180 });
});

test('enemy condition follows live qualifying enemy lifecycle', () => {
  const player = createClusterState(1, 0, 0, 1, 3);
  const enemy = createClusterState(2, 0, 0, 0, 2);
  const excluded = createClusterState(3, 0, 0, 0, 2); excluded.countsTowardRoomCompletionFlag = 0;
  assert.equal(countQualifyingEnemies([player, enemy, excluded]), 1);
  enemy.isAliveFlag = 0;
  assert.equal(countQualifyingEnemies([player, enemy, excluded]), 0);
});

test('challenge and fractional heart conditions are pure and use effective max health', () => {
  const challenge = createRuntimeGate({ ...base, kind: 'challenge' });
  assert.equal(evaluateGateCondition(challenge, { ...context, challengeActive: true }), true);
  const heart = createRuntimeGate({ ...base, kind: 'heart' });
  assert.equal(evaluateGateCondition(heart, { ...context, playerHealth: 4.9995, playerMaxHealth: 5 }), true);
  assert.equal(evaluateGateCondition(heart, { ...context, playerHealth: 4.9, playerMaxHealth: 5 }), false);
});

test('speed uses velocity magnitude and four-world-unit hysteresis', () => {
  const speed = createRuntimeGate({ ...base, kind: 'speed', requiredSpeed: 100 });
  assert.equal(evaluateGateCondition(speed, { ...context, playerVelocityXWorld: 60, playerVelocityYWorld: 80 }), false);
  assert.equal(evaluateGateCondition(speed, { ...context, playerVelocityXWorld: 105, playerVelocityYWorld: 0 }), true);
  assert.equal(evaluateGateCondition(speed, { ...context, playerVelocityXWorld: 97, playerVelocityYWorld: 0 }), true);
  assert.equal(evaluateGateCondition(speed, { ...context, playerVelocityXWorld: 95, playerVelocityYWorld: 0 }), false);
  assert.equal(SPEED_GATE_HYSTERESIS_WORLD, 4);
});

test('state machine is elapsed-time based, emits powder once, and save clears its latch', () => {
  const gate = createRuntimeGate({ ...base, kind: 'heart', openVisualMode: 'powder' });
  updateGateState(gate, true, false, 10);
  assert.equal(gate.phase, 'opening'); assert.equal(gate.powderEmissionSequence, 1); assert.equal(gateHasCollision(gate), false);
  updateGateState(gate, true, false, GATE_TRANSITION_DURATION_MS);
  assert.equal(gate.phase, 'open'); assert.equal(gate.powderEmissionSequence, 1);
  clearGateLatchForSave(gate); updateGateState(gate, false, false, 1);
  assert.equal(gate.phase, 'closing');
});

test('safe closing stays pending on player or enemy and closes only after clear', () => {
  const gate = createRuntimeGate({ ...base, kind: 'heart' }); gate.phase = 'open';
  const player = createClusterState(1, 20, 32, 1, 3);
  assert.equal(gateRectIsOccupied(gate, [player], 8), true);
  updateGateState(gate, false, true, 20); assert.equal(gate.phase, 'pendingClose');
  player.positionXWorld = 100;
  updateGateState(gate, false, gateRectIsOccupied(gate, [player], 8), 20); assert.equal(gate.phase, 'closing');
  updateGateState(gate, false, false, GATE_TRANSITION_DURATION_MS); assert.equal(gate.phase, 'closed'); assert.equal(gateHasCollision(gate), true);
});

test('powder count is area based and capped', () => {
  assert.equal(powderParticleCount({ wBlock: 2, hBlock: 3 }), 18);
  assert.equal(powderParticleCount({ wBlock: 1000, hBlock: 1000 }), 160);
});

test('room-visit and permanent persistence follow explicit precedence', () => {
  const visit = createRuntimeGate({ ...base, kind: 'enemy', openPersistence: 'untilPlayerLeavesRoom' });
  updateGateState(visit, true, false, GATE_TRANSITION_DURATION_MS);
  updateGateState(visit, false, false, 1);
  assert.equal(visit.phase, 'open');
  clearGateLatchForRoomExit(visit);
  updateGateState(visit, false, false, 1);
  assert.equal(visit.phase, 'closing');

  const permanent = createRuntimeGate({ ...base, kind: 'enemy', openPersistence: 'forever' }, true);
  clearGateLatchForRoomExit(permanent);
  clearGateLatchForSave(permanent);
  updateGateState(permanent, false, false, GATE_TRANSITION_DURATION_MS);
  assert.equal(permanent.phase, 'open');
});
