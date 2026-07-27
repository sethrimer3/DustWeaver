import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAPPLE_MAX_LENGTH_WORLD,
  getEffectiveGrappleRangeWorld,
} from '../sim/clusters/grappleShared';
import type { WorldState } from '../sim/world';

function makeWorldWithPlayerMotes(healthPoints: number, maxHealthPoints: number): WorldState {
  return {
    clusters: [
      {
        isPlayerFlag: 1,
        isAliveFlag: 1,
        healthPoints,
        maxHealthPoints,
      },
    ],
  } as unknown as WorldState;
}

test('grapple range is identical at full health and near-death (low motes)', () => {
  const fullHealth = makeWorldWithPlayerMotes(4, 4);
  const nearDeath = makeWorldWithPlayerMotes(1, 4);

  const rangeFull = getEffectiveGrappleRangeWorld(fullHealth);
  const rangeNearDeath = getEffectiveGrappleRangeWorld(nearDeath);

  assert.equal(rangeFull, GRAPPLE_MAX_LENGTH_WORLD);
  assert.equal(rangeNearDeath, GRAPPLE_MAX_LENGTH_WORLD);
  assert.equal(rangeFull, rangeNearDeath);
});

test('grapple range is unaffected by zero motes / zero health', () => {
  const zeroMotes = makeWorldWithPlayerMotes(0, 4);
  assert.equal(getEffectiveGrappleRangeWorld(zeroMotes), GRAPPLE_MAX_LENGTH_WORLD);
});

test('grapple range with no player present still returns the configured max length', () => {
  const noPlayer = { clusters: [] } as unknown as WorldState;
  assert.equal(getEffectiveGrappleRangeWorld(noPlayer), GRAPPLE_MAX_LENGTH_WORLD);
});
