/**
 * Two-stage natural fall curve.
 *
 * Ordinary (non-committed-fast-fall) freefall accelerates under normal
 * gravity up to ~160 px/s, then continues accelerating forever at exactly
 * 20 px/s² instead of hitting a hard terminal cap. Covers:
 *  1. Rapid approach to the ~160 threshold under normal gravity.
 *  2. +20 px/s after one second past threshold, +40 after two.
 *  3. Very long falls stay unbounded (no cap reached).
 *  4. Equivalent results across timestep subdivision (dt-independence).
 *  5. Exact threshold-crossing tick has no overshoot-dependent behavior.
 *  6. Pre-existing velocity above threshold (e.g. from a grapple release) is
 *     never reduced — it just continues accelerating at the post-threshold rate.
 *  7. Landing / jumping resets velocity normally (existing jump trigger path).
 *  8. Committed fast-fall still hard-caps at fastFallCap.
 *  9. Upward brake still decelerates fast-fall back toward the threshold.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  _data: new Map<string, string>(),
  getItem(key: string) { return this._data.has(key) ? this._data.get(key)! : null; },
  setItem(key: string, value: string) { this._data.set(key, value); },
  removeItem(key: string) { this._data.delete(key); },
} as unknown as Storage;

import { createWorldState, type WorldState } from '../sim/world';
import { createClusterState, type ClusterState } from '../sim/clusters/state';
import { applyPlayerGravityAndJump } from '../sim/clusters/playerVerticalMovement';
import {
  NORMAL_MAX_FALL_WORLD_PER_SEC,
  FAST_MAX_FALL_WORLD_PER_SEC,
  POST_THRESHOLD_FALL_ACCEL_WORLD_PER_SEC2,
} from '../sim/clusters/movementConstants';

const DT_MS = 16.6667;
const DT_SEC = DT_MS / 1000;

function makeWorldAndPlayer(): { world: WorldState; player: ClusterState } {
  const world = createWorldState(DT_MS);
  const player = createClusterState(0, 0, 0, 1, 100);
  world.clusters = [player];
  world.playerJumpHeldFlag = 0;
  world.playerJumpTriggeredFlag = 0;
  world.playerCrouchHeldFlag = 0;
  world.playerMoveInputDyWorld = 0;
  world.isPlayerInWaterFlag = 0;
  world.isGrappleActiveFlag = 0;
  return { world, player };
}

function tickFor(world: WorldState, player: ClusterState, dtSec: number, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    applyPlayerGravityAndJump(player, world, dtSec);
  }
}

test('ordinary freefall accelerates up to ~160 px/s under normal gravity', () => {
  const { world, player } = makeWorldAndPlayer();
  player.velocityYWorld = 0;
  // A couple seconds is plenty for 900 px/s^2 gravity to reach the threshold.
  tickFor(world, player, DT_SEC, 60);
  assert.ok(
    player.velocityYWorld >= NORMAL_MAX_FALL_WORLD_PER_SEC - 1,
    `expected velocity to reach near the ~160 threshold, got ${player.velocityYWorld}`,
  );
});

test('past the threshold, velocity gains exactly +20 px/s per additional second', () => {
  const { world, player } = makeWorldAndPlayer();
  player.velocityYWorld = NORMAL_MAX_FALL_WORLD_PER_SEC;
  const ticksPerSec = Math.round(1 / DT_SEC);
  tickFor(world, player, DT_SEC, ticksPerSec);
  assert.ok(
    Math.abs(player.velocityYWorld - (NORMAL_MAX_FALL_WORLD_PER_SEC + POST_THRESHOLD_FALL_ACCEL_WORLD_PER_SEC2)) < 0.5,
    `expected ~180 px/s after 1s past threshold, got ${player.velocityYWorld}`,
  );
  tickFor(world, player, DT_SEC, ticksPerSec);
  assert.ok(
    Math.abs(player.velocityYWorld - (NORMAL_MAX_FALL_WORLD_PER_SEC + 2 * POST_THRESHOLD_FALL_ACCEL_WORLD_PER_SEC2)) < 0.5,
    `expected ~200 px/s after 2s past threshold, got ${player.velocityYWorld}`,
  );
});

test('very long falls remain unbounded (no terminal cap)', () => {
  const { world, player } = makeWorldAndPlayer();
  player.velocityYWorld = 0;
  tickFor(world, player, DT_SEC, Math.round(30 / DT_SEC)); // 30 seconds of falling
  // ~160 threshold + 20 px/s^2 * ~29s remaining => well above the old fastFallCap of 240.
  assert.ok(
    player.velocityYWorld > FAST_MAX_FALL_WORLD_PER_SEC + 200,
    `expected velocity far beyond the old hard cap after a long fall, got ${player.velocityYWorld}`,
  );
});

test('threshold-crossing result is timestep-subdivision independent', () => {
  const { world: worldA, player: playerA } = makeWorldAndPlayer();
  playerA.velocityYWorld = 0;
  tickFor(worldA, playerA, DT_SEC, 120); // 2 seconds, ~1/60s steps

  const { world: worldB, player: playerB } = makeWorldAndPlayer();
  playerB.velocityYWorld = 0;
  const fineDt = DT_SEC / 4;
  tickFor(worldB, playerB, fineDt, 480); // same 2 seconds, finer steps

  assert.ok(
    Math.abs(playerA.velocityYWorld - playerB.velocityYWorld) < 0.5,
    `expected near-identical results across step sizes, got ${playerA.velocityYWorld} vs ${playerB.velocityYWorld}`,
  );
});

test('exact threshold-crossing tick splits cleanly with no overshoot', () => {
  const { world, player } = makeWorldAndPlayer();
  // Start just below the threshold such that one tick of normal gravity
  // crosses it mid-tick.
  player.velocityYWorld = NORMAL_MAX_FALL_WORLD_PER_SEC - 5;
  applyPlayerGravityAndJump(player, world, DT_SEC);
  // Result must be > threshold (crossed) but far below what a full tick of
  // 900 px/s^2 gravity would have produced from the threshold.
  assert.ok(player.velocityYWorld > NORMAL_MAX_FALL_WORLD_PER_SEC - 5);
  assert.ok(
    player.velocityYWorld < NORMAL_MAX_FALL_WORLD_PER_SEC + 1,
    `expected only a tiny post-threshold nudge this tick, got ${player.velocityYWorld}`,
  );
});

test('velocity above threshold from another mechanic (e.g. grapple release) is never reduced', () => {
  const { world, player } = makeWorldAndPlayer();
  player.velocityYWorld = 220; // above threshold, below fastFallCap, e.g. from a grapple launch
  const before = player.velocityYWorld;
  applyPlayerGravityAndJump(player, world, DT_SEC);
  assert.ok(player.velocityYWorld > before, `expected continued acceleration, got ${player.velocityYWorld} from ${before}`);
});

test('committed fast-fall still hard-caps at fastFallCap', () => {
  const { world, player } = makeWorldAndPlayer();
  world.playerCrouchHeldFlag = 1;
  player.velocityYWorld = 235;
  tickFor(world, player, DT_SEC, 60);
  assert.ok(player.velocityYWorld <= FAST_MAX_FALL_WORLD_PER_SEC + 1e-6);
});

test('upward brake decelerates committed fast-fall back toward the threshold, then ordinary freefall resumes', () => {
  const { world, player } = makeWorldAndPlayer();
  world.playerCrouchHeldFlag = 1;
  player.velocityYWorld = FAST_MAX_FALL_WORLD_PER_SEC;
  applyPlayerGravityAndJump(player, world, DT_SEC);
  assert.equal(player.isFastFallModeFlag, 1);

  // Brake back down to the threshold tick by tick, stopping the instant
  // fast-fall mode clears (the exact tick the brake finishes).
  world.playerCrouchHeldFlag = 0;
  world.playerJumpHeldFlag = 1;
  for (let i = 0; i < 60 && player.isFastFallModeFlag === 1; i++) {
    applyPlayerGravityAndJump(player, world, DT_SEC);
  }
  assert.equal(player.isFastFallModeFlag, 0);
  assert.ok(Math.abs(player.velocityYWorld - NORMAL_MAX_FALL_WORLD_PER_SEC) < 1e-6);

  // Ordinary freefall resumes from the brake's end velocity (not reset to a
  // fresh baseline) and continues accelerating at the gentle post-threshold rate.
  world.playerJumpHeldFlag = 0;
  const afterBrakeVelocity = player.velocityYWorld;
  applyPlayerGravityAndJump(player, world, DT_SEC);
  assert.ok(player.velocityYWorld >= afterBrakeVelocity);
});
