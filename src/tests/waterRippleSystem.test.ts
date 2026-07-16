import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { LiquidBody } from '../render/liquidBodyCache';
import {
  MAX_WATER_RIPPLES,
  WATER_RIPPLE_LIFETIME_SEC,
  WaterRippleSystem,
} from '../render/waterSplashSystem';
import { PLAYER_WATER_STATE_SURFACE } from '../sim/clusters/playerWaterPhysics';
import { createClusterState } from '../sim/clusters/state';

function createWaterBody(): LiquidBody {
  return {
    kind: 'water',
    tileCount: 8,
    tileSet: new Set<number>(),
    minXWorld: 0,
    maxXWorld: 96,
    minYWorld: 100,
    maxYWorld: 132,
    mergedRects: [],
    topEdgeRuns: [
      { xWorld: 0, yWorld: 100, wWorld: 32 },
      { xWorld: 64, yWorld: 100, wWorld: 32 },
    ],
    bottomByColumn: new Map<number, number>(),
    topByColumn: new Map<number, number>(),
    columnKeys: [],
    bubbles: [],
    nextBubbleSpawnTicks: 0,
    bubbleCap: 0,
  };
}

describe('bounded water ripple state', () => {
  test('disturbances expire and are removed', () => {
    const ripples = new WaterRippleSystem();
    assert.equal(ripples.spawn([createWaterBody()], 16, 100, 0, 120), true);
    assert.equal(ripples.activeCount, 1);

    ripples.advance(WATER_RIPPLE_LIFETIME_SEC);

    assert.equal(ripples.activeCount, 0);
  });

  test('disturbance count remains bounded and reuses the oldest slot', () => {
    const ripples = new WaterRippleSystem(MAX_WATER_RIPPLES);
    const body = createWaterBody();

    for (let i = 0; i < MAX_WATER_RIPPLES * 3; i++) {
      assert.equal(ripples.spawn([body], 16, 100, i * 10, 120), true);
      ripples.advance(0.001);
    }

    assert.equal(ripples.activeCount, MAX_WATER_RIPPLES);
    assert.equal(ripples.getSnapshotsForTests().length, MAX_WATER_RIPPLES);
  });

  test('propagation expands horizontally and fades with age', () => {
    const ripples = new WaterRippleSystem();
    ripples.spawn([createWaterBody()], 16, 100, 0, 160);
    const initial = ripples.getSnapshotsForTests()[0];

    ripples.advance(0.4);
    const advanced = ripples.getSnapshotsForTests()[0];

    assert.ok(advanced.radiusWorld > initial.radiusWorld);
    assert.ok(advanced.ageSec > initial.ageSec);
  });

  test('a ripple remains constrained to its originating exposed surface run', () => {
    const ripples = new WaterRippleSystem();
    ripples.spawn([createWaterBody()], 16, 100, 0, 160);
    ripples.advance(1);

    assert.equal(ripples.getOffsetAt(80, 100), 0, 'the disconnected right run must not inherit the left-run ripple');
  });
});

describe('directional ripple energy', () => {
  test('rightward player velocity creates stronger right-side energy', () => {
    const ripples = new WaterRippleSystem();
    ripples.spawn([createWaterBody()], 16, 100, 140, 80);
    const ripple = ripples.getSnapshotsForTests()[0];

    assert.ok(ripple.rightAmplitudeWorld > ripple.leftAmplitudeWorld);
    assert.ok(ripple.leftAmplitudeWorld > 0);
  });

  test('leftward player velocity creates stronger left-side energy', () => {
    const ripples = new WaterRippleSystem();
    ripples.spawn([createWaterBody()], 16, 100, -140, 80);
    const ripple = ripples.getSnapshotsForTests()[0];

    assert.ok(ripple.leftAmplitudeWorld > ripple.rightAmplitudeWorld);
    assert.ok(ripple.rightAmplitudeWorld > 0);
  });

  test('near-zero horizontal velocity creates symmetrical energy', () => {
    const ripples = new WaterRippleSystem();
    ripples.spawn([createWaterBody()], 16, 100, 0.01, 100);
    const ripple = ripples.getSnapshotsForTests()[0];

    assert.ok(Math.abs(ripple.leftAmplitudeWorld - ripple.rightAmplitudeWorld) < 0.001);
  });
});

describe('effect gating and physics isolation', () => {
  test('stationary surface contact does not emit a ripple every tick', () => {
    const ripples = new WaterRippleSystem();
    const body = createWaterBody();

    for (let tick = 1; tick <= 120; tick++) {
      ripples.updateFromPlayer(
        [body], tick, 1 / 60, true,
        0, 0, 0, 0, 0, 0,
        PLAYER_WATER_STATE_SURFACE, 16, 100, 0, 0,
      );
    }

    assert.equal(ripples.activeCount, 0);
  });

  test('surface travel accumulates into controlled intermittent disturbances', () => {
    const ripples = new WaterRippleSystem();
    const body = createWaterBody();

    for (let tick = 1; tick <= 60; tick++) {
      ripples.updateFromPlayer(
        [body], tick, 1 / 60, true,
        0, 0, 0, 0, 0, 0,
        PLAYER_WATER_STATE_SURFACE, 16, 100, 80, 0,
      );
    }

    assert.ok(ripples.activeCount > 0);
    assert.ok(ripples.activeCount < 10, 'thresholds should prevent per-frame ripple emission');
  });

  test('disabling effects clears visual state without changing player velocity', () => {
    const ripples = new WaterRippleSystem();
    const body = createWaterBody();
    const player = createClusterState(1, 16, 100, 1, 10);
    player.velocityXWorld = 90;
    player.velocityYWorld = -45;
    ripples.spawn([body], 16, 100, player.velocityXWorld, player.velocityYWorld);

    ripples.updateFromPlayer(
      [body], 1, 1 / 60, false,
      0, 0, 0, 0, 0, 0,
      PLAYER_WATER_STATE_SURFACE,
      player.positionXWorld,
      100,
      player.velocityXWorld,
      player.velocityYWorld,
    );

    assert.equal(ripples.activeCount, 0);
    assert.equal(player.velocityXWorld, 90);
    assert.equal(player.velocityYWorld, -45);
  });
});
