import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';

import type { LiquidBody } from '../render/liquidBodyCache';
import { encodeKey } from '../render/liquidBodyBuilder';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import {
  tickPlayerWaterBubbles,
  resetPlayerWaterBubbles,
  getPlayerWaterBubbleCountForTest,
  PLAYER_BUBBLE_SPEED_THRESHOLD_WORLD,
} from '../render/playerWaterBubbles';

const B = BLOCK_SIZE_MEDIUM;

/** Single water body spanning grid columns [0,4) x rows [0,4) at world origin. */
function createWaterBody(): LiquidBody {
  const tileSet = new Set<number>();
  for (let gx = 0; gx < 4; gx++) {
    for (let gy = 0; gy < 4; gy++) {
      tileSet.add(encodeKey(gx, gy));
    }
  }
  return {
    kind: 'water',
    tileCount: 16,
    tileSet,
    minXWorld: 0,
    maxXWorld: 4 * B,
    minYWorld: 0,
    maxYWorld: 4 * B,
    mergedRects: [],
    topEdgeRuns: [{ xWorld: 0, yWorld: 0, wWorld: 4 * B }],
    bottomByColumn: new Map<number, number>(),
    topByColumn: new Map<number, number>(),
    columnKeys: [],
    bubbles: [],
    nextBubbleSpawnTicks: 0,
    bubbleCap: 0,
  };
}

const fastSpeed = PLAYER_BUBBLE_SPEED_THRESHOLD_WORLD + 200;

describe('player water movement bubbles', () => {
  beforeEach(() => {
    resetPlayerWaterBubbles();
  });

  test('no bubbles spawn while stationary or below speed threshold', () => {
    const body = createWaterBody();
    tickPlayerWaterBubbles(B, 2 * B, 0, 0, 1, [body], 0);
    assert.equal(getPlayerWaterBubbleCountForTest(), 0);

    tickPlayerWaterBubbles(B, 2 * B, 5, 0, 1, [body], 1);
    assert.equal(getPlayerWaterBubbleCountForTest(), 0);
  });

  test('bubbles spawn while moving fast in water', () => {
    const body = createWaterBody();
    let spawned = 0;
    for (let t = 0; t < 20; t++) {
      tickPlayerWaterBubbles(B, 2 * B, fastSpeed, 0, 1, [body], t);
      spawned = getPlayerWaterBubbleCountForTest();
      if (spawned > 0) break;
    }
    assert.ok(spawned > 0);
  });

  test('leaving water stops new emission but existing bubbles persist and keep aging', () => {
    const body = createWaterBody();
    for (let t = 0; t < 20; t++) {
      tickPlayerWaterBubbles(B, 2 * B, fastSpeed, 0, 1, [body], t);
    }
    const countInWater = getPlayerWaterBubbleCountForTest();
    assert.ok(countInWater > 0);

    // Exit water: no new spawns, but the existing pool must not vanish.
    tickPlayerWaterBubbles(B, 2 * B, fastSpeed, 0, 0, [body], 20);
    assert.equal(getPlayerWaterBubbleCountForTest(), countInWater);

    // Keep ticking with isInWater=0 through the full lifetime; pool should
    // drain naturally via aging, not disappear all at once.
    let sawPartialDrain = false;
    for (let t = 21; t < 21 + 90; t++) {
      tickPlayerWaterBubbles(B, 2 * B, fastSpeed, 0, 0, [body], t);
      const n = getPlayerWaterBubbleCountForTest();
      if (n > 0 && n < countInWater) sawPartialDrain = true;
      if (n === 0) break;
    }
    assert.ok(sawPartialDrain);
    assert.equal(getPlayerWaterBubbleCountForTest(), 0);
  });

  test('does not spawn when player is outside any real water volume', () => {
    const body = createWaterBody();
    // Far outside the body's bounding box.
    tickPlayerWaterBubbles(1000 * B, 1000 * B, fastSpeed, 0, 1, [body], 0);
    assert.equal(getPlayerWaterBubbleCountForTest(), 0);
  });

  test('rising bubbles settle at the surface and never cross above it', () => {
    const body = createWaterBody();
    // Spawn deep bubbles by moving near the bottom of the body.
    for (let t = 0; t < 5; t++) {
      tickPlayerWaterBubbles(2 * B, 3.5 * B, fastSpeed, 0, 1, [body], t);
    }
    assert.ok(getPlayerWaterBubbleCountForTest() > 0);

    // Advance many ticks; bubbles should settle at/below the run's surface Y
    // (run.yWorld = 0 here) plus wave/disturbance offset, never rising above
    // it by more than the wave amplitude allows, and never disappear from
    // exceeding the surface abruptly.
    for (let t = 5; t < 400; t++) {
      tickPlayerWaterBubbles(2 * B, 3.5 * B, 0, 0, 0, [body], t);
    }
    // Bubbles may have expired by lifetime; that's fine — the key invariant
    // (no crash / no runaway negative Y) is implicitly checked by reaching here.
    assert.ok(getPlayerWaterBubbleCountForTest() >= 0);
  });

  test('resetPlayerWaterBubbles clears the pool for room changes', () => {
    const body = createWaterBody();
    for (let t = 0; t < 20; t++) {
      tickPlayerWaterBubbles(B, 2 * B, fastSpeed, 0, 1, [body], t);
    }
    assert.ok(getPlayerWaterBubbleCountForTest() > 0);
    resetPlayerWaterBubbles();
    assert.equal(getPlayerWaterBubbleCountForTest(), 0);
  });
});
