import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getPlayerMoteCapacityForContainerCount,
  getPlayerMoteCount,
  grantDustContainerMotes,
  grantPlayerMotes,
  MOTES_PER_DUST_CONTAINER,
} from '../sim/playerMoteLife';
import {
  getMoteLifeColumnCount,
  getMoteLifeSlotPosition,
  MOTE_LIFE_SLOT_ROWS,
} from '../render/hud/moteLifeSlots';
import { StormweaveLifeMotes, getStormweaveMoteCount } from '../sim/stormweave/lifeMotes';
import { createShieldWeaveState, updateShieldWeaveState } from '../sim/stormweave/shieldWeave';
import { applyPlayerDamageWithKnockback, type PlayerDamageTarget } from '../sim/playerDamage';

function makeMoteLife(currentMotes: number, maxMoteCapacity: number) {
  return { healthPoints: currentMotes, maxHealthPoints: maxMoteCapacity };
}

function makeDamageTarget(currentMotes: number): PlayerDamageTarget {
  return {
    healthPoints: currentMotes,
    isAliveFlag: 1,
    positionXWorld: 0,
    positionYWorld: 0,
    velocityXWorld: 0,
    velocityYWorld: 0,
    isGroundedFlag: 1,
    invulnerabilityTicks: 0,
    hurtTicks: 0,
  };
}

describe('canonical player mote life and pickups', () => {
  test('a Dust Shard grants exactly one mote without exceeding capacity', () => {
    const player = makeMoteLife(2, 4);
    assert.equal(grantPlayerMotes(player, 1), 1);
    assert.equal(getPlayerMoteCount(player), 3);
    grantPlayerMotes(player, 99);
    assert.equal(getPlayerMoteCount(player), 4);
  });

  test('a Dust Container adds and fills exactly four mote slots atomically', () => {
    const player = makeMoteLife(3, 4);
    assert.equal(grantDustContainerMotes(player), MOTES_PER_DUST_CONTAINER);
    assert.deepEqual(player, { healthPoints: 7, maxHealthPoints: 8 });
  });

  test('container-count capacity derivation adds four slots per persisted container', () => {
    assert.equal(
      getPlayerMoteCapacityForContainerCount(2) - getPlayerMoteCapacityForContainerCount(1),
      4,
    );
  });
});

describe('two-row column-major mote HUD layout', () => {
  test('slots 1 and 2 are top/bottom in column one; slots 3 and 4 use column two', () => {
    const slots = [0, 1, 2, 3].map(getMoteLifeSlotPosition);
    assert.deepEqual(slots.map(slot => [slot.column, slot.row]), [[0, 0], [0, 1], [1, 0], [1, 1]]);
    assert.equal(MOTE_LIFE_SLOT_ROWS, 2);
  });

  test('four additional capacity slots add exactly two visible columns', () => {
    assert.equal(getMoteLifeColumnCount(8) - getMoteLifeColumnCount(4), 2);
  });

  test('every capacity slot remains addressable when current motes are zero', () => {
    const capacity = 8;
    const positions = Array.from({ length: capacity }, (_, index) => getMoteLifeSlotPosition(index));
    assert.equal(positions.length, capacity);
    assert.equal(getMoteLifeColumnCount(capacity), 4);
  });
});

describe('HUD, Stormweave, and Shield Weave synchronization', () => {
  test('filled HUD, Stormweave, and Shield Weave counts share current motes', () => {
    const player = makeMoteLife(5, 8);
    const filledHudSlots = getPlayerMoteCount(player);
    const cloud = new StormweaveLifeMotes();
    cloud.reconcile(getStormweaveMoteCount(player.healthPoints), 0, 0);
    const shield = createShieldWeaveState();
    shield.isHeldRequested = true;
    updateShieldWeaveState(shield, 1 / 60, filledHudSlots, 0, 0, 20, 1, 0);
    assert.equal(filledHudSlots, 5);
    assert.equal(cloud.moteCount, filledHudSlots);
    assert.equal(shield.moteCount, filledHudSlots);
  });

  test('zero motes empties all derived counts without death, then a valid hit kills', () => {
    const player = makeDamageTarget(1);
    applyPlayerDamageWithKnockback(player, 1, 10, 0);
    assert.equal(player.healthPoints, 0);
    assert.equal(player.isAliveFlag, 1);
    assert.equal(getStormweaveMoteCount(player.healthPoints), 0);
    player.invulnerabilityTicks = 0;
    applyPlayerDamageWithKnockback(player, 1, 10, 0);
    assert.equal(player.isAliveFlag, 0);
  });

  test('invulnerability rejects zero-mote damage without killing the player', () => {
    const player = makeDamageTarget(0);
    player.invulnerabilityTicks = 1;
    assert.equal(applyPlayerDamageWithKnockback(player, 1, 10, 0), false);
    assert.equal(player.isAliveFlag, 1);
  });
});
