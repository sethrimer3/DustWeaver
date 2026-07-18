/**
 * Wall-jump horizontal launch-speed tiers.
 *
 * Reduced horizontal launch speeds (50 for the first wall jump, 100 for the
 * second) apply only when the player is actively holding horizontal input
 * TOWARD the wall being jumped from at the moment of the jump. Every other
 * case — holding away, holding nothing, an ambiguous input state, or any
 * third-or-later wall jump — uses the default speed (150). See
 * computeWallJumpXSpeedWorld in src/sim/clusters/playerWallJump.ts, the one
 * authoritative helper both the direct and buffered wall-jump triggers
 * (attemptWallJump) resolve this through.
 *
 * Vertical wall-jump speeds, force-time, lockout, wall grace, wall
 * detection, and post-wall-jump air control are untouched by this change.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// getAdvancedWallJumpsEnabled() reads localStorage; provide a minimal
// in-memory shim since this suite runs under plain node:test (no DOM).
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  _data: new Map<string, string>(),
  getItem(key: string) { return this._data.has(key) ? this._data.get(key)! : null; },
  setItem(key: string, value: string) { this._data.set(key, value); },
  removeItem(key: string) { this._data.delete(key); },
} as unknown as Storage;

import { createWorldState, type WorldState } from '../sim/world';
import { createClusterState, type ClusterState } from '../sim/clusters/state';
import { attemptWallJump, computeWallJumpXSpeedWorld } from '../sim/clusters/playerWallJump';
import {
  WALL_JUMP_X_SPEED_FIRST_TOWARD_WALL_WORLD,
  WALL_JUMP_X_SPEED_SECOND_TOWARD_WALL_WORLD,
  WALL_JUMP_X_SPEED_DEFAULT_WORLD,
  WALL_JUMP_Y_SPEED_WORLD,
  WALL_JUMP_FIRST_BONUS_Y_SPEED_WORLD,
  WALL_JUMP_SECOND_Y_MULTIPLIER,
  WALL_JUMP_SUBSEQUENT_Y_MULTIPLIER,
  WALL_JUMP_AIR_ACCEL_MULTIPLIER,
} from '../sim/clusters/movementConstants';

function addWall(world: WorldState, x: number, y: number, w: number, h: number): void {
  const i = world.wallCount;
  world.wallXWorld[i] = x;
  world.wallYWorld[i] = y;
  world.wallWWorld[i] = w;
  world.wallHWorld[i] = h;
  world.wallIsPlatformFlag[i] = 0;
  world.wallRampOrientationIndex[i] = 255;
  world.wallCount += 1;
}

/** Builds a player with a tall, fully-eligible wall on the given side. */
function makeWorldWithWall(side: 'left' | 'right', wallJumpCountSinceReset: number): { world: WorldState; player: ClusterState } {
  const world = createWorldState(16.6667);
  world.worldHeightWorld = 10000;
  const player = createClusterState(0, 0, 0, 1, 100);
  player.isGroundedFlag = 0;
  player.velocityYWorld = 50;
  player.wallJumpCountSinceReset = wallJumpCountSinceReset;
  world.clusters = [player];

  const playerTop = player.positionYWorld - player.halfHeightWorld;
  if (side === 'right') {
    const playerRight = player.positionXWorld + player.halfWidthWorld;
    addWall(world, playerRight, playerTop - 100, 8, 300);
    player.isTouchingWallRightFlag = 1;
  } else {
    const playerLeft = player.positionXWorld - player.halfWidthWorld;
    addWall(world, playerLeft - 8, playerTop - 100, 8, 300);
    player.isTouchingWallLeftFlag = 1;
  }
  return { world, player };
}

// ── 1-3. Toward-wall tiers ───────────────────────────────────────────────────

test('first wall jump while pressing toward the wall uses 50 units/sec horizontal speed', () => {
  const { world, player } = makeWorldWithWall('right', 0);
  world.playerMoveInputDxWorld = 1; // pressing right, into the right wall
  const fired = attemptWallJump(player, world);
  assert.equal(fired, true);
  assert.equal(Math.abs(player.velocityXWorld), WALL_JUMP_X_SPEED_FIRST_TOWARD_WALL_WORLD);
  assert.equal(WALL_JUMP_X_SPEED_FIRST_TOWARD_WALL_WORLD, 50);
});

test('second wall jump while pressing toward the wall uses 100 units/sec horizontal speed', () => {
  const { world, player } = makeWorldWithWall('right', 1);
  world.playerMoveInputDxWorld = 1;
  const fired = attemptWallJump(player, world);
  assert.equal(fired, true);
  assert.equal(Math.abs(player.velocityXWorld), WALL_JUMP_X_SPEED_SECOND_TOWARD_WALL_WORLD);
  assert.equal(WALL_JUMP_X_SPEED_SECOND_TOWARD_WALL_WORLD, 100);
});

test('third and later wall jumps use 150 units/sec regardless of input direction', () => {
  for (const count of [2, 3, 10]) {
    for (const inputDx of [1, -1, 0]) {
      const { world, player } = makeWorldWithWall('right', count);
      world.playerMoveInputDxWorld = inputDx;
      const fired = attemptWallJump(player, world);
      assert.equal(fired, true);
      assert.equal(
        Math.abs(player.velocityXWorld), WALL_JUMP_X_SPEED_DEFAULT_WORLD,
        `count=${count} inputDx=${inputDx} expected default 150`,
      );
    }
  }
  assert.equal(WALL_JUMP_X_SPEED_DEFAULT_WORLD, 150);
});

// ── 4-5. Away / no-input fall back to default ───────────────────────────────

test('first or second wall jump while pressing away from the wall uses 150', () => {
  for (const count of [0, 1]) {
    const { world, player } = makeWorldWithWall('right', count);
    world.playerMoveInputDxWorld = -1; // pressing left while wall is to the right = away
    const fired = attemptWallJump(player, world);
    assert.equal(fired, true);
    assert.equal(Math.abs(player.velocityXWorld), WALL_JUMP_X_SPEED_DEFAULT_WORLD, `count=${count}`);
  }
});

test('first or second wall jump with no horizontal input uses 150', () => {
  for (const count of [0, 1]) {
    const { world, player } = makeWorldWithWall('right', count);
    world.playerMoveInputDxWorld = 0;
    const fired = attemptWallJump(player, world);
    assert.equal(fired, true);
    assert.equal(Math.abs(player.velocityXWorld), WALL_JUMP_X_SPEED_DEFAULT_WORLD, `count=${count}`);
  }
});

test('computeWallJumpXSpeedWorld treats a genuinely ambiguous input value (NaN) as not-toward-the-wall (default speed)', () => {
  // NaN comparisons are always false, so an ambiguous/unreadable input state
  // safely falls back to the default speed rather than accidentally granting
  // the reduced toward-wall tier.
  assert.equal(computeWallJumpXSpeedWorld(0, 1, NaN), WALL_JUMP_X_SPEED_DEFAULT_WORLD);
  assert.equal(computeWallJumpXSpeedWorld(0, -1, NaN), WALL_JUMP_X_SPEED_DEFAULT_WORLD);
});

test('computeWallJumpXSpeedWorld only grants the reduced tier for exact toward-wall input', () => {
  assert.equal(computeWallJumpXSpeedWorld(0, 1, 1), WALL_JUMP_X_SPEED_FIRST_TOWARD_WALL_WORLD);
  assert.equal(computeWallJumpXSpeedWorld(1, 1, 1), WALL_JUMP_X_SPEED_SECOND_TOWARD_WALL_WORLD);
  assert.equal(computeWallJumpXSpeedWorld(0, -1, -1), WALL_JUMP_X_SPEED_FIRST_TOWARD_WALL_WORLD);
});

// ── 6. Signed launch direction ───────────────────────────────────────────────

test('right-wall jump launches leftward (away); left-wall jump launches rightward (away)', () => {
  const right = makeWorldWithWall('right', 0);
  right.world.playerMoveInputDxWorld = 1;
  assert.equal(attemptWallJump(right.player, right.world), true);
  assert.ok(right.player.velocityXWorld < 0, 'jumping off a right wall must launch leftward');

  const left = makeWorldWithWall('left', 0);
  left.world.playerMoveInputDxWorld = -1;
  assert.equal(attemptWallJump(left.player, left.world), true);
  assert.ok(left.player.velocityXWorld > 0, 'jumping off a left wall must launch rightward');
});

// ── 7. Vertical / other wall-jump behavior unchanged ────────────────────────

test('vertical wall-jump speeds are unaffected by the horizontal-speed tiering', () => {
  // First jump
  {
    const { world, player } = makeWorldWithWall('right', 0);
    world.playerMoveInputDxWorld = 1; // toward wall (reduced horizontal tier)
    attemptWallJump(player, world);
    assert.equal(player.velocityYWorld, -(WALL_JUMP_Y_SPEED_WORLD + WALL_JUMP_FIRST_BONUS_Y_SPEED_WORLD));
  }
  // Second jump
  {
    const { world, player } = makeWorldWithWall('right', 1);
    world.playerMoveInputDxWorld = -1; // away (default horizontal tier)
    attemptWallJump(player, world);
    const firstJumpY = WALL_JUMP_Y_SPEED_WORLD + WALL_JUMP_FIRST_BONUS_Y_SPEED_WORLD;
    assert.equal(player.velocityYWorld, -(firstJumpY * WALL_JUMP_SECOND_Y_MULTIPLIER));
  }
  // Third jump
  {
    const { world, player } = makeWorldWithWall('right', 2);
    world.playerMoveInputDxWorld = 0;
    attemptWallJump(player, world);
    assert.equal(player.velocityYWorld, -(WALL_JUMP_Y_SPEED_WORLD * WALL_JUMP_SUBSEQUENT_Y_MULTIPLIER));
  }
});

test('force-time, lockout, and post-wall-jump air-accel constants are unchanged by this refactor', () => {
  const { world, player } = makeWorldWithWall('right', 0);
  world.playerMoveInputDxWorld = 1;
  attemptWallJump(player, world);
  assert.ok(player.wallJumpForceTimeTicks > 0);
  assert.ok(player.wallJumpLockoutTicks > 0);
  assert.equal(WALL_JUMP_AIR_ACCEL_MULTIPLIER, 2.0);
});
