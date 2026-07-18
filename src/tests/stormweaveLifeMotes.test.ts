import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  StormweaveLifeMotes,
  STORMWEAVE_RESTING_REGION_WORLD,
  getFullLifeContainerCount,
  getStormweaveAttractionAcceleration,
} from '../sim/stormweave/lifeMotes';
import { applyPlayerDamageWithKnockback, type PlayerDamageTarget } from '../sim/playerDamage';

const DT_SEC = 1 / 60;

function makeDamageTarget(healthPoints: number): PlayerDamageTarget {
  return {
    healthPoints,
    isAliveFlag: 1,
    positionXWorld: 10,
    positionYWorld: 10,
    velocityXWorld: 0,
    velocityYWorld: 0,
    isGroundedFlag: 1,
    invulnerabilityTicks: 0,
    hurtTicks: 0,
    isHighVelocityAttacking: 0,
  };
}

describe('Stormweave life-container synchronization', () => {
  test('one visual mote exists per full canonical life container', () => {
    const cloud = new StormweaveLifeMotes();
    for (const [health, expected] of [[0, 0], [4, 1], [16, 4]] as const) {
      cloud.reconcile(getFullLifeContainerCount(health), 20, 30);
      assert.equal(cloud.moteCount, expected);
    }
  });

  test('partial container fill does not add an extra mote', () => {
    assert.equal(getFullLifeContainerCount(3), 0);
    assert.equal(getFullLifeContainerCount(7), 1);
    assert.equal(getFullLifeContainerCount(11.99), 2);
  });

  test('motes are added and removed exactly as health crosses container boundaries', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reconcile(getFullLifeContainerCount(12), 0, 0);
    assert.equal(cloud.moteCount, 3);
    cloud.reconcile(getFullLifeContainerCount(15), 0, 0);
    assert.equal(cloud.moteCount, 3, 'partial healing is not a completed container');
    cloud.reconcile(getFullLifeContainerCount(16), 0, 0);
    assert.equal(cloud.moteCount, 4);
    cloud.reconcile(getFullLifeContainerCount(11), 0, 0);
    assert.equal(cloud.moteCount, 2);
  });

  test('reset clears stale positions and reconstructs only the canonical count', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(50, 60, 4);
    cloud.update(DT_SEC, 50, 60, 0, 0, true);
    assert.equal(cloud.moteCount, 4);
    assert.ok(cloud.trailSampleCount > 0);
    cloud.reset(5, 6, 1);
    assert.equal(cloud.moteCount, 1);
    assert.equal(cloud.trailSampleCount, 0);
    const mote = cloud.getMote(0);
    assert.ok(mote !== undefined);
    assert.ok(Math.hypot(mote.xWorld - 5, mote.yWorld - 6) < 40);
  });
});

describe('Stormweave life-mote steering', () => {
  test('far-away motes receive stronger attraction than near motes', () => {
    const near = getStormweaveAttractionAcceleration(8);
    const far = getStormweaveAttractionAcceleration(40);
    assert.ok(far > near * 4, `expected far attraction ${far} to greatly exceed ${near}`);
  });

  test('attraction weakens smoothly through the resting region without a boundary snap', () => {
    const inner = getStormweaveAttractionAcceleration(STORMWEAVE_RESTING_REGION_WORLD - 0.01);
    const outer = getStormweaveAttractionAcceleration(STORMWEAVE_RESTING_REGION_WORLD + 0.01);
    assert.ok(inner > 0);
    assert.ok(Math.abs(outer - inner) / outer < 0.01, 'force should remain continuous at 15 world pixels');
    assert.ok(getStormweaveAttractionAcceleration(2) < getStormweaveAttractionAcceleration(8));
  });

  test('nearby motes repel one another', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 2);
    cloud.setMoteState(0, -0.5, 0);
    cloud.setMoteState(1, 0.5, 0);
    cloud.update(DT_SEC, 0, 0, 0, 0, false);
    const a = cloud.getMote(0);
    const b = cloud.getMote(1);
    assert.ok(a !== undefined && b !== undefined);
    assert.ok(a.velocityXWorld < b.velocityXWorld, 'pair should gain separating relative velocity');
  });

  test('zero-distance motes remain finite', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 2);
    cloud.setMoteState(0, 0, 0);
    cloud.setMoteState(1, 0, 0);
    for (let i = 0; i < 10; i++) cloud.update(DT_SEC, 0, 0, 0, 0, false);
    for (let i = 0; i < 2; i++) {
      const mote = cloud.getMote(i);
      assert.ok(mote !== undefined);
      assert.ok(Number.isFinite(mote.xWorld));
      assert.ok(Number.isFinite(mote.yWorld));
      assert.ok(Number.isFinite(mote.velocityXWorld));
      assert.ok(Number.isFinite(mote.velocityYWorld));
    }
  });
});

describe('Stormweave high-speed trails', () => {
  test('canonical invulnerability-speed flag activates emission and samples actual motes', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(10, 20, 2);
    cloud.update(DT_SEC, 10, 20, 220, 0, true);
    assert.equal(cloud.isTrailEmitting, true);
    assert.equal(cloud.trailSampleCount, 2);
  });

  test('emission stops below the canonical condition and history stays bounded', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 4);
    for (let i = 0; i < 300; i++) cloud.update(DT_SEC, i, 0, 240, 0, true);
    assert.equal(cloud.trailSampleCount, cloud.trailCapacity);
    cloud.update(DT_SEC, 300, 0, 20, 0, false);
    assert.equal(cloud.isTrailEmitting, false);
    assert.equal(cloud.trailSampleCount, cloud.trailCapacity);
  });
});

describe('canonical zero-container damage rule', () => {
  test('the next valid damage event is fatal when only a partial container remains', () => {
    const player = makeDamageTarget(3);
    assert.equal(applyPlayerDamageWithKnockback(player, 1, 0, 0), true);
    assert.equal(player.healthPoints, 0);
    assert.equal(player.isAliveFlag, 0);
  });

  test('damage retains the existing decrement model while a full container remains', () => {
    const player = makeDamageTarget(8);
    assert.equal(applyPlayerDamageWithKnockback(player, 1, 0, 0), true);
    assert.equal(player.healthPoints, 7);
    assert.equal(player.isAliveFlag, 1);
  });
});
