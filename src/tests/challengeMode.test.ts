import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activateChallengeField,
  createChallengeModeState,
  toggleChallengeTotem,
  updateChallengeFields,
} from '../sim/challengeMode';
import { applyPlayerDamageWithKnockback } from '../sim/playerDamage';

const BLOCK = 8;
const fields = [
  { uid: 1, xBlock: 2, yBlock: 2, wBlock: 4, hBlock: 4 },
  { uid: 2, xBlock: 10, yBlock: 2, wBlock: 2, hBlock: 2 },
];
const totems = [{ uid: 3, xBlock: 20, yBlock: 5 }];

function player() {
  return {
    healthPoints: 3, isAliveFlag: 1 as const, positionXWorld: 0, positionYWorld: 0,
    velocityXWorld: 12, velocityYWorld: -4, isGroundedFlag: 1 as const,
    invulnerabilityTicks: 0, hurtTicks: 0, isHighVelocityAttacking: 0 as const,
    halfWidthWorld: 3, halfHeightWorld: 4,
    challengeReturnGuard: 0 as 0 | 1,
  };
}

test('challenge anchors supersede one another and instances are isolated', () => {
  const a = createChallengeModeState('a', fields, [], totems);
  const b = createChallengeModeState('b', fields, [], totems);
  assert.equal(activateChallengeField(a, 1, BLOCK), true);
  assert.deepEqual([a.anchorType, a.anchorUid, a.anchorXWorld, a.anchorYWorld], ['field', 1, 32, 32]);
  activateChallengeField(a, 2, BLOCK);
  assert.equal(a.anchorUid, 2);
  toggleChallengeTotem(a, 3, BLOCK);
  assert.deepEqual([a.anchorType, a.anchorUid], ['totem', 3]);
  assert.equal(b.isActive, false);
  assert.equal(toggleChallengeTotem(a, 3, BLOCK), false);
  assert.equal(a.isActive, false);
});

test('accepted damage returns without health loss, knockback, death, or repeat event', () => {
  const state = createChallengeModeState('room', fields);
  activateChallengeField(state, 1, BLOCK);
  const p = player();
  let cleared = 0;
  assert.equal(applyPlayerDamageWithKnockback(p, 99, 0, 0, { challengeState: state, clearTransientMovement: () => cleared++ }), true);
  assert.deepEqual([p.healthPoints, p.isAliveFlag, p.velocityXWorld, p.velocityYWorld], [3, 1, 0, 0]);
  assert.deepEqual([p.positionXWorld, p.positionYWorld], [32, 32]);
  assert.equal(state.returnSequence, 1);
  assert.equal(state.fields[0].visualState, 'cooldown');
  assert.equal(cleared, 1);
  assert.equal(applyPlayerDamageWithKnockback(p, 1, 0, 0, { challengeState: state }), false);
  assert.equal(p.healthPoints, 3);
  assert.equal(state.returnSequence, 1);
});

test('rejected damage does not consume challenge mode', () => {
  for (const setup of [(p: ReturnType<typeof player>) => { p.invulnerabilityTicks = 1; }, (p: ReturnType<typeof player>) => { p.isHighVelocityAttacking = 1; }]) {
    const state = createChallengeModeState('room', fields);
    activateChallengeField(state, 1, BLOCK);
    const p = player(); setup(p);
    assert.equal(applyPlayerDamageWithKnockback(p, 1, 0, 0, { challengeState: state }), false);
    assert.equal(state.isActive, true);
  }
});

test('field cooldown rearms at exact AABB separation and requires reentry', () => {
  const state = createChallengeModeState('room', fields);
  activateChallengeField(state, 1, BLOCK);
  const p = player();
  applyPlayerDamageWithKnockback(p, 1, 0, 0, { challengeState: state });
  updateChallengeFields(state, p, BLOCK);
  assert.equal(state.fields[0].visualState, 'cooldown');
  p.positionXWorld = fields[0].xBlock * BLOCK - p.halfWidthWorld! - 3 * BLOCK + 0.01;
  updateChallengeFields(state, p, BLOCK);
  assert.equal(state.fields[0].visualState, 'cooldown');
  p.positionXWorld -= 0.01;
  updateChallengeFields(state, p, BLOCK);
  assert.equal(state.fields[0].visualState, 'armed');
  p.positionXWorld = 32;
  p.positionYWorld = 32;
  updateChallengeFields(state, p, BLOCK);
  assert.equal(state.isActive, true);
});
