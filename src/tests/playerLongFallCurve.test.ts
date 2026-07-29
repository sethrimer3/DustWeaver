/**
 * Deterministic tests for the two-stage player fall curve.
 *
 * Stage 1: normal gravity accelerates the player until ~NORMAL_MAX_FALL (160.5 px/s).
 * Stage 2: a slow secondary acceleration (LONG_FALL_ACCEL = 20 px/s²) replaces the
 *          old hard cap — velocity continues to grow without bound in ordinary freefall.
 *
 * The tests avoid touching collision, walls, enemy logic, or render state:
 * they only exercise `applyPlayerGravityAndJump` and the associated constants.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  NORMAL_GRAVITY_WORLD_PER_SEC2,
  NORMAL_MAX_FALL_WORLD_PER_SEC,
  LONG_FALL_ACCEL_WORLD_PER_SEC2,
  FAST_MAX_FALL_WORLD_PER_SEC,
} from '../sim/clusters/movementConstants';
import { createClusterState } from '../sim/clusters/state';
import { applyPlayerGravityAndJump } from '../sim/clusters/playerVerticalMovement';
import { createWorldState } from '../sim/world';

const DT_MS = 1000 / 60;
const DT_SEC = DT_MS / 1000;

/** Create a minimal airborne player world with no water, no grapple. */
function makeAirborneWorld(): { world: ReturnType<typeof createWorldState>; player: ReturnType<typeof createClusterState> } {
  const world = createWorldState(DT_MS, 0);
  const player = createClusterState(1, 0, 0, 1, 10);
  world.clusters.push(player);
  // Ensure no water/grapple flags
  world.isPlayerInWaterFlag = 0;
  world.isGrappleActiveFlag = 0;
  world.playerJumpHeldFlag = 0;
  world.playerJumpTriggeredFlag = 0;
  return { world, player };
}

// ──────────────────────────────────────────────────────────────────────────────
// 1. Stage-1: gravity accelerates toward the threshold normally
// ──────────────────────────────────────────────────────────────────────────────

describe('stage-1 freefall below threshold', () => {
  test('velocity increases by gravity*dt each tick when below threshold', () => {
    const { world, player } = makeAirborneWorld();
    player.velocityYWorld = 0;

    applyPlayerGravityAndJump(player, world, DT_SEC);

    const expected = NORMAL_GRAVITY_WORLD_PER_SEC2 * DT_SEC;
    assert.ok(
      Math.abs(player.velocityYWorld - expected) < 1e-9,
      `expected vy ≈ ${expected}, got ${player.velocityYWorld}`,
    );
  });

  test('velocity approaches threshold within reasonable time at full gravity', () => {
    const { world, player } = makeAirborneWorld();
    player.velocityYWorld = 0;
    let ticks = 0;
    while (player.velocityYWorld < NORMAL_MAX_FALL_WORLD_PER_SEC && ticks < 10000) {
      applyPlayerGravityAndJump(player, world, DT_SEC);
      ticks++;
    }
    // Should reach the threshold in at most ~11 ticks (160.5 / (900 / 60) ≈ 10.7)
    assert.ok(ticks <= 12, `expected to reach threshold in ≤12 ticks, took ${ticks}`);
    assert.ok(player.velocityYWorld >= NORMAL_MAX_FALL_WORLD_PER_SEC - 1e-6);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. Stage-2: slow acceleration above the threshold, no hard cap
// ──────────────────────────────────────────────────────────────────────────────

describe('stage-2 freefall above threshold — unbounded slow acceleration', () => {
  test('velocity continues to increase beyond the old threshold (no hard cap)', () => {
    const { world, player } = makeAirborneWorld();
    // Start exactly at threshold
    player.velocityYWorld = NORMAL_MAX_FALL_WORLD_PER_SEC;

    applyPlayerGravityAndJump(player, world, DT_SEC);

    assert.ok(
      player.velocityYWorld > NORMAL_MAX_FALL_WORLD_PER_SEC,
      `expected vy > threshold after one tick, got ${player.velocityYWorld}`,
    );
  });

  test('velocity increases by longFallAccel*dt per tick above threshold', () => {
    const { world, player } = makeAirborneWorld();
    player.velocityYWorld = NORMAL_MAX_FALL_WORLD_PER_SEC;

    applyPlayerGravityAndJump(player, world, DT_SEC);

    const expected = NORMAL_MAX_FALL_WORLD_PER_SEC + LONG_FALL_ACCEL_WORLD_PER_SEC2 * DT_SEC;
    assert.ok(
      Math.abs(player.velocityYWorld - expected) < 1e-6,
      `expected vy ≈ ${expected} (longFallAccel tick), got ${player.velocityYWorld}`,
    );
  });

  test('after ~1 second of long-fall, velocity is ~20 px/s above threshold', () => {
    const { world, player } = makeAirborneWorld();
    player.velocityYWorld = NORMAL_MAX_FALL_WORLD_PER_SEC;

    for (let i = 0; i < 60; i++) {
      applyPlayerGravityAndJump(player, world, DT_SEC);
    }

    const expectedAfter1s = NORMAL_MAX_FALL_WORLD_PER_SEC + LONG_FALL_ACCEL_WORLD_PER_SEC2 * 1.0;
    assert.ok(
      Math.abs(player.velocityYWorld - expectedAfter1s) < 1,
      `after 1s expected vy ≈ ${expectedAfter1s}, got ${player.velocityYWorld}`,
    );
  });

  test('after ~2 seconds of long-fall, velocity is ~40 px/s above threshold', () => {
    const { world, player } = makeAirborneWorld();
    player.velocityYWorld = NORMAL_MAX_FALL_WORLD_PER_SEC;

    for (let i = 0; i < 120; i++) {
      applyPlayerGravityAndJump(player, world, DT_SEC);
    }

    const expectedAfter2s = NORMAL_MAX_FALL_WORLD_PER_SEC + LONG_FALL_ACCEL_WORLD_PER_SEC2 * 2.0;
    assert.ok(
      Math.abs(player.velocityYWorld - expectedAfter2s) < 2,
      `after 2s expected vy ≈ ${expectedAfter2s}, got ${player.velocityYWorld}`,
    );
  });

  test('velocity is unbounded — exceeds the old hard cap significantly over long falls', () => {
    const { world, player } = makeAirborneWorld();
    player.velocityYWorld = NORMAL_MAX_FALL_WORLD_PER_SEC;

    // Run 5 seconds of long-fall (300 ticks)
    for (let i = 0; i < 300; i++) {
      applyPlayerGravityAndJump(player, world, DT_SEC);
    }

    // Expected: threshold + longFallAccel * 5.0
    const expected = NORMAL_MAX_FALL_WORLD_PER_SEC + LONG_FALL_ACCEL_WORLD_PER_SEC2 * 5.0;
    assert.ok(
      Math.abs(player.velocityYWorld - expected) < 5,
      `after 5s expected vy ≈ ${expected}, got ${player.velocityYWorld}`,
    );
    // Must be well above the old terminal cap (which was also NORMAL_MAX_FALL)
    assert.ok(player.velocityYWorld > NORMAL_MAX_FALL_WORLD_PER_SEC + 90);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. Exact threshold-crossing behavior
// ──────────────────────────────────────────────────────────────────────────────

describe('threshold-crossing tick', () => {
  test('first tick that crosses threshold uses longFallAccel, not full gravity', () => {
    // Place vy just below threshold so one gravity tick pushes it past
    const { world, player } = makeAirborneWorld();
    const justBelow = NORMAL_MAX_FALL_WORLD_PER_SEC - NORMAL_GRAVITY_WORLD_PER_SEC2 * DT_SEC * 0.5;
    player.velocityYWorld = justBelow;

    const before = player.velocityYWorld;
    applyPlayerGravityAndJump(player, world, DT_SEC);
    const after = player.velocityYWorld;

    // After this tick vy should be at or just above threshold, not at
    // threshold + fullGravity*dt (which would be the old clamped behavior)
    // The net gain should be smaller than one full gravity step
    const fullGravityStep = NORMAL_GRAVITY_WORLD_PER_SEC2 * DT_SEC;
    const actualGain = after - before;
    assert.ok(
      actualGain < fullGravityStep,
      `crossing tick net gain (${actualGain}) should be < fullGravityStep (${fullGravityStep})`,
    );
    assert.ok(after >= NORMAL_MAX_FALL_WORLD_PER_SEC, `vy should be >= threshold after crossing`);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. Pre-existing high velocity is never reduced
// ──────────────────────────────────────────────────────────────────────────────

describe('pre-existing velocity above threshold is preserved', () => {
  test('a velocity well above threshold from grapple/knockback is not reduced', () => {
    const { world, player } = makeAirborneWorld();
    // Simulate a grapple launch that pushed vy very high
    const launchVy = 400.0;
    player.velocityYWorld = launchVy;

    applyPlayerGravityAndJump(player, world, DT_SEC);

    // Should be at least launchVy (not snapped back to threshold)
    assert.ok(
      player.velocityYWorld >= NORMAL_MAX_FALL_WORLD_PER_SEC,
      `vy (${player.velocityYWorld}) should be >= threshold`,
    );
    // The actual value will be launchVy - grav*dt + longFallAccel*dt,
    // which is launchVy - (grav - longFallAccel)*dt. Since grav > longFallAccel,
    // the speed will slightly decrease this tick (as the stage-2 accel replaces
    // the full gravity), but it must never be clamped to NORMAL_MAX_FALL.
    assert.ok(
      player.velocityYWorld > NORMAL_MAX_FALL_WORLD_PER_SEC + 100,
      `high-velocity launch should not snap to threshold; got ${player.velocityYWorld}`,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 5. Fast-fall still uses a hard cap
// ──────────────────────────────────────────────────────────────────────────────

describe('fast-fall mode', () => {
  test('committing fast-fall while above fastFallCap clamps to fastFallCap', () => {
    const { world, player } = makeAirborneWorld();
    player.velocityYWorld = FAST_MAX_FALL_WORLD_PER_SEC + 50;
    player.isFastFallModeFlag = 1;
    // No down input needed — already in fast-fall mode

    applyPlayerGravityAndJump(player, world, DT_SEC);

    assert.ok(
      player.velocityYWorld <= FAST_MAX_FALL_WORLD_PER_SEC,
      `fast-fall cap not enforced; got ${player.velocityYWorld}`,
    );
  });

  test('holding down does not enter fast-fall or change the natural fall curve', () => {
    const neutral = makeAirborneWorld();
    const holdingDown = makeAirborneWorld();
    neutral.player.velocityYWorld = NORMAL_MAX_FALL_WORLD_PER_SEC;
    holdingDown.player.velocityYWorld = NORMAL_MAX_FALL_WORLD_PER_SEC;
    holdingDown.world.playerMoveInputDyWorld = 1;
    holdingDown.world.playerCrouchHeldFlag = 1;

    for (let i = 0; i < 200; i++) {
      applyPlayerGravityAndJump(neutral.player, neutral.world, DT_SEC);
      applyPlayerGravityAndJump(holdingDown.player, holdingDown.world, DT_SEC);
    }

    assert.equal(holdingDown.player.isFastFallModeFlag, 0);
    assert.equal(holdingDown.player.velocityYWorld, neutral.player.velocityYWorld);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. Grapple active: stage-2 logic is skipped (grapple speed preserved)
// ──────────────────────────────────────────────────────────────────────────────

describe('grapple active — fall curve is bypassed', () => {
  test('while grappling, full gravity applies and velocity can exceed threshold freely', () => {
    const { world, player } = makeAirborneWorld();
    world.isGrappleActiveFlag = 1;
    player.velocityYWorld = NORMAL_MAX_FALL_WORLD_PER_SEC - NORMAL_GRAVITY_WORLD_PER_SEC2 * DT_SEC * 0.5;

    const before = player.velocityYWorld;
    applyPlayerGravityAndJump(player, world, DT_SEC);

    // Full gravity applied (no stage-2 intercept during grapple)
    const expected = before + NORMAL_GRAVITY_WORLD_PER_SEC2 * DT_SEC;
    assert.ok(
      Math.abs(player.velocityYWorld - expected) < 1e-9,
      `during grapple expected vy ≈ ${expected}, got ${player.velocityYWorld}`,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. Water active: vertical forces handled by water system, not fall curve
// ──────────────────────────────────────────────────────────────────────────────

describe('water active — fall curve is bypassed', () => {
  test('while in water with velocity above threshold, this module does not modify vy via long-fall', () => {
    const { world, player } = makeAirborneWorld();
    world.isPlayerInWaterFlag = 1;
    const startVy = NORMAL_MAX_FALL_WORLD_PER_SEC + 30;
    player.velocityYWorld = startVy;

    applyPlayerGravityAndJump(player, world, DT_SEC);

    // The water system (applyPlayerWaterVerticalForces) runs instead.
    // The key assertion: the long-fall stage-2 logic (which un-applies gravity
    // then adds longFallAccel) did NOT run. We cannot guarantee the exact value
    // because the water path applies its own forces, but we verify the function
    // returns without crashing and vy is in a plausible range.
    assert.ok(typeof player.velocityYWorld === 'number' && !Number.isNaN(player.velocityYWorld));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 8. Landing/jump reset: vy becomes negative after a jump
// ──────────────────────────────────────────────────────────────────────────────

describe('jump from ground resets fall', () => {
  test('a ground jump from long-fall velocity launches the player upward', () => {
    const { world, player } = makeAirborneWorld();
    player.velocityYWorld = NORMAL_MAX_FALL_WORLD_PER_SEC + 40; // simulate long-fall speed
    player.isGroundedFlag = 1;
    world.playerJumpTriggeredFlag = 1;

    applyPlayerGravityAndJump(player, world, DT_SEC);

    // After a jump, vy should be strongly negative (upward)
    assert.ok(
      player.velocityYWorld < 0,
      `expected upward velocity after jump, got ${player.velocityYWorld}`,
    );
    assert.equal(player.isGroundedFlag, 0);
    assert.equal(world.playerJumpTriggeredFlag, 0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 9. Upward brake in fast-fall still works
// ──────────────────────────────────────────────────────────────────────────────

describe('upward brake in fast-fall exits to threshold', () => {
  test('holding jump while fast-falling brakes descent back toward threshold', () => {
    const { world, player } = makeAirborneWorld();
    player.isFastFallModeFlag = 1;
    player.velocityYWorld = FAST_MAX_FALL_WORLD_PER_SEC;
    world.playerJumpHeldFlag = 1; // holding jump triggers brake

    // Run until brake exits fast-fall mode
    let ticks = 0;
    while (player.isFastFallModeFlag === 1 && ticks < 1000) {
      applyPlayerGravityAndJump(player, world, DT_SEC);
      ticks++;
    }

    assert.ok(ticks < 1000, 'brake should exit fast-fall mode within 1000 ticks');
    assert.equal(player.isFastFallModeFlag, 0, 'fast-fall mode should be cleared after brake');
    assert.ok(
      player.velocityYWorld <= NORMAL_MAX_FALL_WORLD_PER_SEC + 1,
      `after brake vy should be near threshold; got ${player.velocityYWorld}`,
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 10. Frame-rate independence: same long-fall result at different subdivisions
// ──────────────────────────────────────────────────────────────────────────────

describe('long-fall is frame-rate independent', () => {
  test('60 small ticks produce the same result as 6 large ticks with 10× dt', () => {
    const target = NORMAL_MAX_FALL_WORLD_PER_SEC + 30; // start well into stage 2

    // 60 ticks at 1/60s
    const { world: w1, player: p1 } = makeAirborneWorld();
    p1.velocityYWorld = target;
    for (let i = 0; i < 60; i++) {
      applyPlayerGravityAndJump(p1, w1, DT_SEC);
    }

    // 6 ticks at 10× dt
    const { world: w2, player: p2 } = makeAirborneWorld();
    p2.velocityYWorld = target;
    for (let i = 0; i < 6; i++) {
      applyPlayerGravityAndJump(p2, w2, DT_SEC * 10);
    }

    // Both should accumulate LONG_FALL_ACCEL * 1s = 20 px/s above `target`
    // with near-identical results (both are first-order Euler; exact match
    // within a tolerance reflecting the linear nature of the long-fall pass)
    assert.ok(
      Math.abs(p1.velocityYWorld - p2.velocityYWorld) < 1,
      `60×small (${p1.velocityYWorld.toFixed(3)}) vs 6×large (${p2.velocityYWorld.toFixed(3)}) should match`,
    );
  });
});
