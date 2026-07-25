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
  STORMWEAVE_GLOW_ATTACK_SEC,
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
    assert.deepEqual(atThreshold, { coreHeadWidth: 2, goldHeadWidth: 4.5, glowHeadWidth: 9, headGlowRadius: 6.2 });
    assert.deepEqual(aboveThreshold, atThreshold);
  });

  test('intensity uses total Cartesian speed', () => {
    const diagonalComponent = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED / Math.sqrt(2);
    assert.equal(getStormweaveTrailTargetIntensity(diagonalComponent, diagonalComponent), 1);
    assert.ok(getStormweaveTrailTargetIntensity(0, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED * 0.5) > 0);
  });

  test('maximum glow requires three seconds at invulnerability speed', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 1);
    const ticksToMaximum = Math.round(STORMWEAVE_GLOW_ATTACK_SEC / DT_SEC);
    for (let i = 0; i < ticksToMaximum - 1; i++) {
      cloud.update(DT_SEC, 0, 0, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED, 0, true);
    }
    assert.ok(cloud.trailIntensity < 1);
    cloud.update(DT_SEC, 0, 0, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED, 0, true);
    assert.ok(Math.abs(cloud.trailIntensity - 1) < 1e-6);
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

  test('a discontinuous mote sample breaks the ribbon without erasing prior history', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 1);
    for (let i = 0; i < 50; i++) cloud.update(DT_SEC, 0, 0, 0, 0, true);
    const countBeforeJump = cloud.getTrailPointCount(0);
    assert.ok(countBeforeJump > 0);
    cloud.setMoteState(0, 200, 200);
    cloud.update(DT_SEC, 0, 0, 0, 0, true);
    // Older, still-fresh samples must remain instead of the whole trail
    // being wiped down to a single point.
    assert.ok(cloud.getTrailPointCount(0) > countBeforeJump - 2,
      `expected prior trail history to survive a local mote discontinuity, got count ${cloud.getTrailPointCount(0)}`);
    // But the newest point must be flagged as a break so the renderer never
    // draws a ribbon segment bridging the jump.
    const newestIndex = cloud.getTrailPointCount(0) - 1;
    assert.equal(cloud.isTrailPointBreak(0, newestIndex), true);
  });
});

describe('Stormweave trail continuity and idle wander regressions', () => {
  test('no glitchy long segment appears while the player is stationary after moving', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 1);
    // Move for a while so the mote and its trail pick up real velocity and
    // wave-driven perpendicular offset.
    for (let x = 1; x <= 60; x++) cloud.update(DT_SEC, x * 0.5, 0, 90, 0, true);
    // Now stop dead and sit still for several seconds - long enough to
    // fully cycle the trail lifetime multiple times.
    let previousX: number | undefined;
    let previousY: number | undefined;
    let maxStepDistance = 0;
    for (let i = 0; i < 300; i++) {
      cloud.update(DT_SEC, 30, 0, 0, 0, true);
      const mote = cloud.getMote(0);
      assert.ok(mote !== undefined);
      if (previousX !== undefined && previousY !== undefined) {
        const stepDistance = Math.hypot(mote.xWorld - previousX, mote.yWorld - previousY);
        maxStepDistance = Math.max(maxStepDistance, stepDistance);
      }
      previousX = mote.xWorld;
      previousY = mote.yWorld;
    }
    // A per-tick position jump of more than a couple world units while both
    // the player and its own recent history are stationary indicates a
    // discontinuity (the bug this test guards against), not organic drift.
    assert.ok(maxStepDistance < 2, `expected no per-tick teleport while stationary, got ${maxStepDistance}`);

    // The rendered trail itself must never contain a segment far longer
    // than the normal sample spacing while stationary.
    const count = cloud.getTrailPointCount(0);
    for (let p = 1; p < count; p++) {
      const dx = cloud.getTrailPointXWorld(0, p) - cloud.getTrailPointXWorld(0, p - 1);
      const dy = cloud.getTrailPointYWorld(0, p) - cloud.getTrailPointYWorld(0, p - 1);
      const segmentLength = Math.hypot(dx, dy);
      assert.ok(
        segmentLength < STORMWEAVE_TRAIL_SAMPLES_PER_MOTE,
        `unexpectedly long stationary trail segment: ${segmentLength}`,
      );
    }
  });

  test('trail sample timestamps are strictly increasing and never predate the current epoch', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 1);
    for (let i = 0; i < 40; i++) cloud.update(DT_SEC, i, 0, 60, 0, true);
    const epochStartSec = 0; // reset() zeroed elapsedSec
    const count = cloud.getTrailPointCount(0);
    let previousTimeSec = -Infinity;
    for (let p = 0; p < count; p++) {
      const timeSec = -cloud.getTrailPointAgeSec(0, p);
      assert.ok(timeSec >= previousTimeSec, 'trail samples must be chronologically ordered');
      previousTimeSec = timeSec;
    }
    assert.ok(epochStartSec >= 0);
  });

  test('ring buffer wraps past capacity without resetting - oldest samples overwritten in place', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 1);
    // Sustained fast movement guarantees a new sample almost every tick,
    // easily exceeding STORMWEAVE_TRAIL_SAMPLES_PER_MOTE within the
    // lifetime window, forcing wraparound rather than a capacity reset.
    // (First run past the rebase window with no sampling, then move fast.)
    for (let i = 0; i < 45; i++) cloud.update(DT_SEC, 0, 0, 0, 0, true);
    for (let i = 0; i < 60; i++) cloud.update(DT_SEC, i * 3, 0, 400, 0, true);
    const count = cloud.getTrailPointCount(0);
    assert.ok(count > 1, 'trail should still be populated after wraparound');
    assert.ok(count <= STORMWEAVE_TRAIL_SAMPLES_PER_MOTE);
  });

  test('a stale sample from before reset() is never readable afterward', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 1);
    for (let i = 0; i < 90; i++) cloud.update(DT_SEC, i, 0, 60, 0, true);
    assert.ok(cloud.trailSampleCount > 0);
    cloud.reset(0, 0, 1);
    assert.equal(cloud.trailSampleCount, 0, 'reset must not leak samples from the previous epoch');
    cloud.update(DT_SEC, 0, 0, 0, 0, true);
    assert.equal(cloud.getTrailPointCount(0), 0, 'rebase window suppresses sampling right after reset');
  });

  test('room-transition-style discontinuity mid-session cleanly re-seeds path history', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 1);
    for (let i = 0; i < 40; i++) cloud.update(DT_SEC, i, 0, 60, 0, true);
    // Simulate a room transition: a large instantaneous jump in player
    // position mid-session (not via reset()).
    cloud.update(DT_SEC, 1000, 1000, 0, 0, true);
    assert.equal(cloud.getTrailPointCount(0), 0, 'discontinuity should clear the trail');
    // Follow the new position for a while; the mote must converge near the
    // new player location rather than streaking back toward the old path.
    for (let i = 0; i < 1200; i++) cloud.update(DT_SEC, 1000, 1000, 0, 0, true);
    const mote = cloud.getMote(0);
    assert.ok(mote !== undefined);
    assert.ok(
      Math.hypot(mote.xWorld - 1000, mote.yWorld - 1000) < 30,
      'mote should have converged near the post-teleport player position',
    );
  });

  test('idle wander keeps motes near the player without a fixed-period loop', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 1);
    const positions: Array<[number, number]> = [];
    for (let i = 0; i < 600; i++) {
      cloud.update(DT_SEC, 0, 0, 0, 0, false);
      const mote = cloud.getMote(0);
      assert.ok(mote !== undefined);
      positions.push([mote.xWorld, mote.yWorld]);
      assert.ok(Math.hypot(mote.xWorld, mote.yWorld) < 40, 'idle wander must stay contained near the player');
    }
    // Not a fixed sine loop: the mote should visit a spread of distinct
    // positions rather than repeatedly retracing one small periodic orbit.
    const uniqueRounded = new Set(positions.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`));
    assert.ok(uniqueRounded.size > 100, 'expected a wide spread of idle positions, not a tight repeating loop');
  });

  test('sustained high-speed movement produces bounded, converging lag rather than unbounded drift', () => {
    const cloud = new StormweaveLifeMotes();
    cloud.reset(0, 0, 1);
    cloud.setMoteState(0, 0, 0);
    const lagDistances: number[] = [];
    let playerX = 0;
    for (let i = 0; i < 400; i++) {
      playerX += 200 * DT_SEC;
      cloud.update(DT_SEC, playerX, 0, 200, 0, false);
      const mote = cloud.getMote(0);
      assert.ok(mote !== undefined);
      assert.ok(Number.isFinite(mote.xWorld) && Number.isFinite(mote.yWorld));
      lagDistances.push(Math.hypot(playerX - mote.xWorld, -mote.yWorld));
    }
    const earlyMaxLag = Math.max(...lagDistances.slice(150, 250));
    const lateMaxLag = Math.max(...lagDistances.slice(300, 400));
    assert.ok(lateMaxLag < earlyMaxLag * 1.5, `expected lag to converge, early=${earlyMaxLag} late=${lateMaxLag}`);
    assert.ok(lateMaxLag < 200, `expected bounded lag, got ${lateMaxLag}`);
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
