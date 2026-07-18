/**
 * Airborne horizontal input cap — projected-velocity fix.
 *
 * Bug: the old air-control gate checked `Math.abs(velocityXWorld) < airCap`,
 * which cannot distinguish "over cap, same direction as input" (must stay
 * untouched) from "over cap, OPPOSITE direction" (must be free to brake back
 * through zero). Above 100 px/s of momentum in the opposite direction, input
 * was silently ignored and the player could not reverse in the air at all.
 *
 * Fix: gate on `speedInInputDirection = velocityXWorld * inputDx` instead.
 * See applyPlayerHorizontalMovement in playerHorizontalMovement.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorldState, type WorldState } from '../sim/world';
import { createClusterState, type ClusterState } from '../sim/clusters/state';
import { applyPlayerHorizontalMovement } from '../sim/clusters/playerHorizontalMovement';
import {
  AIR_MAX_INPUT_SPEED_WORLD_PER_SEC,
  ROCKET_BOOST_AIR_ACCEL_MULTIPLIER,
} from '../sim/clusters/movementConstants';

const DT_SEC = 1 / 60;

function makeAirborne(velocityXWorld: number): { world: WorldState; player: ClusterState } {
  const world = createWorldState(16.6667);
  const player = createClusterState(0, 0, 0, 1, 100);
  player.isGroundedFlag = 0;
  player.velocityXWorld = velocityXWorld;
  world.clusters = [player];
  return { world, player };
}

/** Runs applyPlayerHorizontalMovement for many ticks with a fixed held input direction. */
function settleAirborne(velocityXWorld: number, inputDx: 1 | -1, ticks = 300): number {
  const { world, player } = makeAirborne(velocityXWorld);
  world.playerMoveInputDxWorld = inputDx;
  for (let i = 0; i < ticks; i++) {
    applyPlayerHorizontalMovement(player, world, DT_SEC);
  }
  return player.velocityXWorld;
}

// ── Same-direction input: never reduces existing velocity ──────────────────

test('same-direction input at 50 accelerates up to the air cap (100), never past it', () => {
  const settled = settleAirborne(50, 1);
  assert.ok(Math.abs(settled - AIR_MAX_INPUT_SPEED_WORLD_PER_SEC) < 0.01, `expected ~100, got ${settled}`);
});

test('same-direction input at exactly 100 (the cap) leaves velocity unchanged', () => {
  const { world, player } = makeAirborne(100);
  world.playerMoveInputDxWorld = 1;
  applyPlayerHorizontalMovement(player, world, DT_SEC);
  assert.equal(player.velocityXWorld, 100);
});

test('same-direction input at 200 (over cap, external momentum) leaves velocity unchanged — the core bug scenario', () => {
  const { world, player } = makeAirborne(200);
  world.playerMoveInputDxWorld = 1;
  applyPlayerHorizontalMovement(player, world, DT_SEC);
  assert.equal(player.velocityXWorld, 200, 'held same-direction input must never reduce externally-earned over-cap momentum');
});

test('mirror: same-direction input leftward at -50/-100/-200 behaves symmetrically', () => {
  assert.ok(Math.abs(settleAirborne(-50, -1) - -AIR_MAX_INPUT_SPEED_WORLD_PER_SEC) < 0.01);
  const { world: w100, player: p100 } = makeAirborne(-100);
  w100.playerMoveInputDxWorld = -1;
  applyPlayerHorizontalMovement(p100, w100, DT_SEC);
  assert.equal(p100.velocityXWorld, -100);
  const { world: w200, player: p200 } = makeAirborne(-200);
  w200.playerMoveInputDxWorld = -1;
  applyPlayerHorizontalMovement(p200, w200, DT_SEC);
  assert.equal(p200.velocityXWorld, -200);
});

// ── Opposite-direction input: always brakes, crosses zero, stops at cap ────

test('vx = +200, press right → remains +200 (same-direction example from spec)', () => {
  const { world, player } = makeAirborne(200);
  world.playerMoveInputDxWorld = 1;
  applyPlayerHorizontalMovement(player, world, DT_SEC);
  assert.equal(player.velocityXWorld, 200);
});

test('vx = -200, press right → accelerates right, crosses zero, settles at +100', () => {
  const settled = settleAirborne(-200, 1);
  assert.ok(Math.abs(settled - AIR_MAX_INPUT_SPEED_WORLD_PER_SEC) < 0.01, `expected ~+100, got ${settled}`);
});

test('vx = +50, press right → accelerates to +100', () => {
  const settled = settleAirborne(50, 1);
  assert.ok(Math.abs(settled - AIR_MAX_INPUT_SPEED_WORLD_PER_SEC) < 0.01, `expected ~+100, got ${settled}`);
});

test('opposite-direction input at 50 brakes and reverses to the cap (both directions)', () => {
  const rightToLeft = settleAirborne(50, -1);
  assert.ok(Math.abs(rightToLeft - -AIR_MAX_INPUT_SPEED_WORLD_PER_SEC) < 0.01, `expected ~-100, got ${rightToLeft}`);
  const leftToRight = settleAirborne(-50, 1);
  assert.ok(Math.abs(leftToRight - AIR_MAX_INPUT_SPEED_WORLD_PER_SEC) < 0.01, `expected ~+100, got ${leftToRight}`);
});

test('opposite-direction input at exactly 100 brakes and reverses to the cap (both directions)', () => {
  const rightToLeft = settleAirborne(100, -1);
  assert.ok(Math.abs(rightToLeft - -AIR_MAX_INPUT_SPEED_WORLD_PER_SEC) < 0.01, `expected ~-100, got ${rightToLeft}`);
  const leftToRight = settleAirborne(-100, 1);
  assert.ok(Math.abs(leftToRight - AIR_MAX_INPUT_SPEED_WORLD_PER_SEC) < 0.01, `expected ~+100, got ${leftToRight}`);
});

test('opposite-direction input at 200 (the bug scenario) brakes and reverses to the cap (both directions)', () => {
  const rightToLeft = settleAirborne(200, -1);
  assert.ok(Math.abs(rightToLeft - -AIR_MAX_INPUT_SPEED_WORLD_PER_SEC) < 0.01, `expected ~-100, got ${rightToLeft}`);
  const leftToRight = settleAirborne(-200, 1);
  assert.ok(Math.abs(leftToRight - AIR_MAX_INPUT_SPEED_WORLD_PER_SEC) < 0.01, `expected ~+100, got ${leftToRight}`);
});

test('opposite-direction input immediately reduces velocity magnitude (does not get stuck), even from 200', () => {
  const { world, player } = makeAirborne(200);
  world.playerMoveInputDxWorld = -1;
  applyPlayerHorizontalMovement(player, world, DT_SEC);
  assert.ok(player.velocityXWorld < 200, `expected immediate reduction from 200, got ${player.velocityXWorld}`);
});

test('braking never increases speed magnitude tick-over-tick until crossing zero', () => {
  const { world, player } = makeAirborne(200);
  world.playerMoveInputDxWorld = -1;
  let prevAbs = 200;
  let crossedZero = false;
  for (let i = 0; i < 60; i++) {
    applyPlayerHorizontalMovement(player, world, DT_SEC);
    if (player.velocityXWorld < 0) { crossedZero = true; break; }
    const abs = Math.abs(player.velocityXWorld);
    assert.ok(abs <= prevAbs + 1e-6, `magnitude must not increase while braking (was ${prevAbs}, now ${abs})`);
    prevAbs = abs;
  }
  assert.ok(crossedZero, 'velocity should cross zero within 1 second');
});

// ── Rocket-boost regression: uncapped, unaffected by the projected-speed gate ──

test('rocket-boosted air acceleration remains uncapped past the air cap (same direction)', () => {
  const { world, player } = makeAirborne(50);
  player.isRocketBoostedFlag = 1;
  world.playerMoveInputDxWorld = 1;
  for (let i = 0; i < 120; i++) {
    applyPlayerHorizontalMovement(player, world, DT_SEC);
  }
  assert.ok(
    player.velocityXWorld > AIR_MAX_INPUT_SPEED_WORLD_PER_SEC,
    `rocket boost must be able to exceed the air cap, got ${player.velocityXWorld}`,
  );
});

test('rocket-boosted acceleration is unaffected by the projected-speed gate even against high opposing velocity', () => {
  const { world, player } = makeAirborne(-200);
  player.isRocketBoostedFlag = 1;
  world.playerMoveInputDxWorld = 1;
  const before = player.velocityXWorld;
  applyPlayerHorizontalMovement(player, world, DT_SEC);
  assert.ok(player.velocityXWorld > before, 'rocket boost must accelerate every tick regardless of speedInInputDirection');
  assert.ok(ROCKET_BOOST_AIR_ACCEL_MULTIPLIER > 0 && ROCKET_BOOST_AIR_ACCEL_MULTIPLIER < 1, 'sanity: rocket boost is a half-rate uncapped accel, unchanged by this fix');
});

// ── Preserve: no-input air friction, ground movement, grapple ──────────────

test('airborne with no input still applies light air friction (unaffected)', () => {
  const { world, player } = makeAirborne(50);
  world.playerMoveInputDxWorld = 0;
  applyPlayerHorizontalMovement(player, world, DT_SEC);
  assert.ok(player.velocityXWorld < 50, 'air friction should still slow the player with no input');
  assert.ok(player.velocityXWorld > 0, 'air friction should be gentle, not an instant stop');
});

test('grapple-active flag still skips all horizontal accel/decel (unaffected)', () => {
  const { world, player } = makeAirborne(200);
  world.isGrappleActiveFlag = 1;
  world.playerMoveInputDxWorld = -1;
  applyPlayerHorizontalMovement(player, world, DT_SEC);
  assert.equal(player.velocityXWorld, 200, 'grapple physics must own horizontal velocity entirely');
});

test('grounded movement is unaffected by this airborne-only fix', () => {
  const { world, player } = makeAirborne(200); // reuse helper, then force grounded
  player.isGroundedFlag = 1;
  player.groundedTicks = 10000;
  world.playerMoveInputDxWorld = -1;
  applyPlayerHorizontalMovement(player, world, DT_SEC);
  assert.ok(player.velocityXWorld < 200, 'grounded reversal braking (fixed separately) must still work');
});
