/**
 * Regression coverage for the ordinary-("quiet")-grapple-release velocity bug
 * exposed by commit cbe9f835 (see nextSteps.md BUILD 606).
 *
 * Root cause: gameCommandProcessor.ts called releaseGrapple() directly at
 * render-frame command-processing time, which runs once per rAF frame and is
 * decoupled from the deterministic fixed-tick simulation loop
 * (gameScreen.ts's `while (accumulatorMs >= FIXED_DT_MS) { ... tick(world) ... }`).
 * Because command processing runs BEFORE that loop each frame, releasing
 * immediately deactivated the grapple before the current tick's swing physics
 * (retraction + rope-length constraint) had a chance to fold the tick's true
 * motion into player.velocityXWorld/velocityYWorld, so release preserved a
 * stale, pre-tick velocity instead of the player's genuine swing momentum.
 *
 * Fix: ordinary release requests are now queued via
 * world.isGrappleQuietReleaseRequestedFlag and consumed inside
 * applyGrappleClusterConstraint() (grappleConstraint.ts) at the correct point
 * in the fixed tick — after retraction and the rope-length constraint have
 * finished updating velocity, and after jump-off (which takes priority) has
 * had first refusal.
 *
 * These tests drive the real, end-to-end fixed-tick pipeline (tick() from
 * sim/tick.ts, the same function gameScreen.ts calls) rather than calling
 * releaseGrapple() directly with manually assigned velocity.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import type { WorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { initGrappleChainParticles } from '../sim/clusters/grapple';
import { tick } from '../sim/tick';
import { COYOTE_TIME_TICKS, PLAYER_JUMP_SPEED_WORLD } from '../sim/clusters/movementConstants';

/** Sets up a world with a real active grapple (anchor above-right of player). */
function setUpActiveGrapple(
  world: WorldState,
  playerX: number,
  playerY: number,
  anchorDx = 100,
  anchorDy = -100,
): void {
  const player = createClusterState(1, playerX, playerY, 1, 100);
  world.clusters.push(player);
  initGrappleChainParticles(world, 1);

  world.isGrappleActiveFlag = 1;
  world.grappleAnchorXWorld = playerX + anchorDx;
  world.grappleAnchorYWorld = playerY + anchorDy;
  world.grappleLengthWorld = Math.sqrt(anchorDx * anchorDx + anchorDy * anchorDy);

  const start = world.grappleParticleStartIndex;
  for (let i = 0; i < 8; i++) {
    const idx = start + i;
    world.isAliveFlag[idx] = 1;
    world.positionXWorld[idx] = playerX + i * 5;
    world.positionYWorld[idx] = playerY - i * 5;
  }
}

test('1. quiet release while moving strongly upward preserves upward velocity (real fixed tick)', () => {
  const world = createWorldState(1000 / 60, 1);
  setUpActiveGrapple(world, 0, 0);
  const player = world.clusters[0];
  player.velocityXWorld = 50;
  player.velocityYWorld = -300; // strongly upward

  world.isGrappleQuietReleaseRequestedFlag = 1; // queued by gameCommandProcessor.ts on mouse-up
  tick(world);

  assert.equal(world.isGrappleActiveFlag, 0, 'grapple released this tick');
  // Only one tick's worth of gravity may have been subtracted — velocity must
  // remain strongly negative (upward), not collapse toward zero or flip sign.
  assert.ok(player.velocityYWorld < -250, `expected still-strong upward velocity, got ${player.velocityYWorld}`);
});

test('2. quiet release during a real simulated upward pendulum swing continues upward afterward', () => {
  const world = createWorldState(1000 / 60, 1);
  // Anchor directly above the player so an initial rightward velocity creates
  // a genuine pendulum swing (not just free-fall).
  setUpActiveGrapple(world, 0, 0, 0, -150);
  const player = world.clusters[0];
  player.velocityXWorld = 220; // tangential — starts the swing

  // Run the swing forward until the player is on the rising (upward) part of
  // the arc — i.e. velocityYWorld goes negative as the pendulum climbs past
  // the bottom of the arc.
  let ticksRun = 0;
  while (ticksRun < 120 && !(world.isGrappleActiveFlag === 1 && player.velocityYWorld < -20)) {
    tick(world);
    ticksRun++;
  }
  assert.equal(world.isGrappleActiveFlag, 1, 'grapple should still be active mid-swing');
  assert.ok(player.velocityYWorld < -20, 'player should be moving upward mid-swing before release');

  const velYBeforeRelease = player.velocityYWorld;
  world.isGrappleQuietReleaseRequestedFlag = 1;
  tick(world);

  assert.equal(world.isGrappleActiveFlag, 0);
  // Momentum must carry over — released velocity should be close to (within
  // one tick of gravity of) the pre-release swing velocity, not reset/zeroed.
  assert.ok(
    player.velocityYWorld < velYBeforeRelease + 40,
    `expected release to preserve upward swing momentum: before=${velYBeforeRelease}, after=${player.velocityYWorld}`,
  );
  assert.ok(player.velocityYWorld < 0, 'player should continue moving upward immediately after release');
});

test('3. release during rope retraction preserves the resulting tangential (boosted) momentum', () => {
  const world = createWorldState(1000 / 60, 1);
  setUpActiveGrapple(world, 0, 0, 0, -150);
  const player = world.clusters[0];
  player.velocityXWorld = 150;

  // Hold down (retract) for several ticks to build up boosted tangential speed.
  world.playerCrouchHeldFlag = 1;
  for (let i = 0; i < 10; i++) tick(world);
  assert.ok(world.isGrappleActiveFlag === 1, 'still swinging after retraction ticks');
  const speedBeforeRelease = Math.hypot(player.velocityXWorld, player.velocityYWorld);

  // Same tick: still retracting AND requesting a quiet release.
  world.isGrappleQuietReleaseRequestedFlag = 1;
  tick(world);

  assert.equal(world.isGrappleActiveFlag, 0);
  const speedAfterRelease = Math.hypot(player.velocityXWorld, player.velocityYWorld);
  // The retraction boost from THIS tick must be reflected in the released
  // velocity (allow generous tolerance for gravity's contribution this tick).
  assert.ok(
    speedAfterRelease > speedBeforeRelease * 0.85,
    `expected boosted retraction momentum to carry into release: before=${speedBeforeRelease}, after=${speedAfterRelease}`,
  );
});

test('4. release requested on a render frame with no fixed tick does not lose momentum', () => {
  const world = createWorldState(1000 / 60, 1);
  setUpActiveGrapple(world, 0, 0);
  const player = world.clusters[0];
  player.velocityYWorld = -180;

  // Simulate command processing on a high-refresh render frame where the
  // accumulator has not reached FIXED_DT_MS yet: the flag is queued, but no
  // tick() runs this "frame".
  world.isGrappleQuietReleaseRequestedFlag = 1;

  // No tick this frame — momentum and the pending request must both survive.
  assert.equal(world.isGrappleActiveFlag, 1, 'grapple must still be active with no tick run yet');
  assert.equal(world.isGrappleQuietReleaseRequestedFlag, 1, 'request must remain queued');
  assert.equal(player.velocityYWorld, -180, 'velocity must be untouched with no tick run');

  // Next frame: a fixed tick finally runs and must consume the queued request.
  tick(world);
  assert.equal(world.isGrappleActiveFlag, 0, 'queued release consumed on the first tick that runs');
  assert.ok(player.velocityYWorld < -140, `expected preserved upward velocity, got ${player.velocityYWorld}`);
});

test('7 & 8. jump-off in the same tick as a quiet release takes priority, applies its impulse exactly once, additively', () => {
  const world = createWorldState(1000 / 60, 1);
  setUpActiveGrapple(world, 0, 0, 0, -150);
  const player = world.clusters[0];
  player.velocityXWorld = 40;
  player.velocityYWorld = -60; // existing upward swing velocity

  world.playerJumpTriggeredFlag = 1;
  world.isGrappleQuietReleaseRequestedFlag = 1; // same tick — jump-off must win
  const velYBefore = player.velocityYWorld;
  tick(world);

  assert.equal(world.isGrappleActiveFlag, 0, 'grapple released via jump-off');
  assert.equal(world.isGrappleQuietReleaseRequestedFlag, 0, 'quiet-release request consumed/cleared, not left pending');
  // Jump-off impulse is additive to existing swing velocity, applied exactly
  // once: velYBefore - PLAYER_JUMP_SPEED_WORLD (minus this tick's gravity,
  // which is small relative to the jump impulse).
  const expectedApprox = velYBefore - PLAYER_JUMP_SPEED_WORLD;
  assert.ok(
    Math.abs(player.velocityYWorld - expectedApprox) < 20,
    `expected additive single jump-off impulse near ${expectedApprox}, got ${player.velocityYWorld}`,
  );
  // Coyote time must NOT be granted for a jump-off release (grantCoyoteTime=false).
  assert.equal(player.coyoteTimeTicks, 0);
});

test('9. quiet release grants coyote time without modifying velocity beyond normal tick physics', () => {
  const world = createWorldState(1000 / 60, 1);
  setUpActiveGrapple(world, 0, 0);
  const player = world.clusters[0];
  player.velocityXWorld = 30;
  player.velocityYWorld = -40;
  const velYBefore = player.velocityYWorld;

  world.isGrappleQuietReleaseRequestedFlag = 1;
  tick(world);

  assert.equal(world.isGrappleActiveFlag, 0);
  assert.equal(player.coyoteTimeTicks, COYOTE_TIME_TICKS, 'quiet release grants coyote time');
  // No jump-off impulse — only ordinary per-tick gravity may have changed velocityY
  // (gravity increases velocityYWorld toward positive/downward by a small amount).
  assert.ok(
    Math.abs(player.velocityYWorld - velYBefore) < 40,
    `unexpected large velocity change from release itself: before=${velYBefore}, after=${player.velocityYWorld}`,
  );
});

test('11. rope-constraint position correction does not leave an artificial downward release velocity', () => {
  const world = createWorldState(1000 / 60, 1);
  // Player already sitting exactly on the rope circle's boundary with strong
  // upward+outward tangential motion, so the rope-length constraint will
  // trigger a position snap this tick while genuine swing velocity is upward.
  setUpActiveGrapple(world, 150, -150, -150, -150);
  const player = world.clusters[0];
  // Player is directly below-right of the anchor at exactly rope length;
  // give it velocity that both swings tangentially and drifts outward so the
  // constraint has to correct position.
  player.velocityXWorld = -180;
  player.velocityYWorld = -120;

  world.isGrappleQuietReleaseRequestedFlag = 1;
  tick(world);

  assert.equal(world.isGrappleActiveFlag, 0);
  // The rope constraint only ever REMOVES outward radial velocity or leaves
  // tangential velocity untouched — it must never inject extra downward
  // velocity from the position-only snap correction. The player was moving
  // upward, so it must still be moving upward (or at worst neutral) after
  // release, not suddenly falling.
  assert.ok(
    player.velocityYWorld < 40,
    `rope-constraint snap must not fabricate downward release velocity, got ${player.velocityYWorld}`,
  );
});
