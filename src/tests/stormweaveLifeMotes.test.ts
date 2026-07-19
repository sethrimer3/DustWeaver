import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  StormweaveLifeMotes,
  STORMWEAVE_RESTING_REGION_WORLD,
  getStormweaveMoteCount,
  getStormweaveAttractionAcceleration,
  getStormweaveTrailSizing,
  getStormweaveTrailTargetIntensity,
  STORMWEAVE_TRAIL_LIFETIME_SEC,
  STORMWEAVE_TRAIL_SAMPLES_PER_MOTE,
} from '../sim/stormweave/lifeMotes';
import { applyPlayerDamageWithKnockback, type PlayerDamageTarget } from '../sim/playerDamage';
import { MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED } from '../sim/momentumCombatConfig';

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

describe('Stormweave current-mote synchronization', () => {
  test('one visual Stormweave mote exists per canonical current mote', () => {
    const cloud = new StormweaveLifeMotes();
    for (const [health, expected] of [[0, 0], [4, 4], [16, 16]] as const) {
      cloud.reconcile(getStormweaveMoteCount(health), 20, 30);
      assert.equal(cloud.moteCount, expected);
    }
  });

  test('fractional legacy values normalize to individual whole motes', () => {
    assert.equal(getStormweaveMoteCount(3), 3);
    assert.equal(getStormweaveMoteCount(7), 7);
    assert.equal(getStormweaveMoteCount(11.99), 11);
  });

  test('motes are added and removed exactly as health crosses container boundaries', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reconcile(getStormweaveMoteCount(3), 0, 0);
    assert.equal(cloud.moteCount, 3);
    cloud.reconcile(getStormweaveMoteCount(4), 0, 0);
    assert.equal(cloud.moteCount, 4);
    cloud.reconcile(getStormweaveMoteCount(2), 0, 0);
    assert.equal(cloud.moteCount, 2);
  });

  test('reset clears stale positions and reconstructs only the canonical count', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(50, 60, 4);
    cloud.update(DT_SEC, 50, 60, 0, 0, true);
    assert.equal(cloud.moteCount, 4);
    assert.equal(cloud.trailSampleCount, 0, 'reset begins with a trail rebase window');
    cloud.reset(5, 6, 1);
    assert.equal(cloud.moteCount, 1);
    assert.equal(cloud.trailSampleCount, 0);
    const mote = cloud.getMote(0);
    assert.ok(mote !== undefined);
    assert.ok(Math.hypot(mote.xWorld - 5, mote.yWorld - 6) < 40);
  });
});

describe('Stormweave life-mote steering', () => {
  test('motes follow the recorded player route instead of cutting across a turn', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 1);
    cloud.setMoteState(0, 0, 0);
    for (let x = 1; x <= 20; x++) cloud.update(DT_SEC, x, 0, 60, 0, false);
    for (let y = 1; y <= 8; y++) cloud.update(DT_SEC, 20, y, 0, 60, false);
    const mote = cloud.getMote(0);
    assert.ok(mote !== undefined);
    assert.ok(mote.xWorld < 20, 'mote should still lag behind the corner');
    assert.ok(mote.yWorld < 8, 'mote should follow the delayed vertical leg');
  });

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

describe('Stormweave high-quality persistent trails', () => {
  test('trails are active only on High graphics and sample each mote', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(10, 20, 2);
    cloud.update(DT_SEC, 10, 20, 0, 0, false);
    assert.equal(cloud.isTrailEmitting, false);
    assert.equal(cloud.trailSampleCount, 0);
    cloud.update(DT_SEC, 10, 20, 0, 0, true);
    assert.equal(cloud.isTrailEmitting, true);
    assert.equal(cloud.trailSampleCount, 0, 'startup warm-up should not record spawn convergence');
    for (let i = 0; i < 45; i++) cloud.update(DT_SEC, 10, 20, 0, 0, true);
    assert.ok(cloud.trailSampleCount >= 2);
  });

  test('zero speed has nonzero baseline widths and widths grow smoothly with speed', () => {
    const zero = getStormweaveTrailSizing(getStormweaveTrailTargetIntensity(0, 0));
    const middle = getStormweaveTrailSizing(getStormweaveTrailTargetIntensity(MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED * 0.5, 0));
    const near = getStormweaveTrailSizing(getStormweaveTrailTargetIntensity(MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED * 0.51, 0));
    assert.ok(zero.coreHeadWidth > 0 && zero.goldHeadWidth > 0 && zero.glowHeadWidth > 0);
    assert.ok(middle.glowHeadWidth > zero.glowHeadWidth);
    assert.ok(near.glowHeadWidth > middle.glowHeadWidth);
    assert.ok(near.glowHeadWidth - middle.glowHeadWidth < 0.2);
  });

  test('maximum width begins exactly at the canonical threshold and stays capped above it', () => {
    const atThreshold = getStormweaveTrailSizing(getStormweaveTrailTargetIntensity(MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED, 0));
    const aboveThreshold = getStormweaveTrailSizing(getStormweaveTrailTargetIntensity(MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED * 4, 0));
    assert.deepEqual(atThreshold, { coreHeadWidth: 2, goldHeadWidth: 4.5, glowHeadWidth: 9, headGlowRadius: 7 });
    assert.deepEqual(aboveThreshold, atThreshold);
  });

  test('intensity uses total Cartesian speed', () => {
    const diagonalComponent = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED / Math.sqrt(2);
    assert.equal(getStormweaveTrailTargetIntensity(diagonalComponent, diagonalComponent), 1);
    assert.ok(getStormweaveTrailTargetIntensity(0, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED * 0.5) > 0);
  });

  test('history expires by elapsed time and remains bounded per mote', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 1);
    for (let i = 0; i < 180; i++) cloud.update(DT_SEC, i * 2, 0, 120, 0, true);
    assert.ok(cloud.getTrailPointCount(0) <= STORMWEAVE_TRAIL_SAMPLES_PER_MOTE);
    assert.ok(cloud.getTrailPointCount(0) > 1);
    assert.ok(cloud.getTrailPointAgeSec(0, 0) < STORMWEAVE_TRAIL_LIFETIME_SEC);
  });

  test('discontinuous player movement clears and rebases trail history', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 1);
    for (let i = 0; i < 55; i++) cloud.update(DT_SEC, i, 0, 60, 0, true);
    assert.ok(cloud.trailSampleCount > 1);
    cloud.update(DT_SEC, 500, 500, 0, 0, true);
    assert.equal(cloud.getTrailPointCount(0), 0);
    for (let i = 0; i < 30; i++) cloud.update(DT_SEC, 500, 500, 0, 0, true);
    assert.equal(cloud.getTrailPointCount(0), 0, 'teleport destination should remain in its rebase window');
  });

  test('a discontinuous mote sample rebases instead of drawing a long ribbon', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 1);
    for (let i = 0; i < 50; i++) cloud.update(DT_SEC, 0, 0, 0, 0, true);
    assert.ok(cloud.getTrailPointCount(0) > 0);
    cloud.setMoteState(0, 200, 200);
    cloud.update(DT_SEC, 0, 0, 0, 0, true);
    assert.equal(cloud.getTrailPointCount(0), 1);
  });
});

describe('canonical zero-mote damage rule', () => {
  test('reaching zero motes does not kill; the next valid hit does', () => {
    const player = makeDamageTarget(1);
    assert.equal(applyPlayerDamageWithKnockback(player, 1, 0, 0), true);
    assert.equal(player.healthPoints, 0);
    assert.equal(player.isAliveFlag, 1);
    player.invulnerabilityTicks = 0;
    assert.equal(applyPlayerDamageWithKnockback(player, 1, 0, 0), true);
    assert.equal(player.isAliveFlag, 0);
  });

  test('damage removes the existing number of individual motes', () => {
    const player = makeDamageTarget(8);
    assert.equal(applyPlayerDamageWithKnockback(player, 1, 0, 0), true);
    assert.equal(player.healthPoints, 7);
    assert.equal(player.isAliveFlag, 1);
  });
});
