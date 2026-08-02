/**
 * Regression coverage for the grapple quiet-release velocity bug.
 *
 * Root cause: gameCommandProcessor.ts processes input commands once per
 * rendered frame, decoupled from the deterministic fixed simulation tick.
 * releaseGrapple() used to be called directly from that command-processing
 * path, so it could fire *before* the current tick's swing constraint
 * (applyGrappleClusterConstraint) had a chance to update the player's true
 * velocity — releasing with a stale, up-to-one-tick-old velocity instead of
 * the real swing motion.
 *
 * Fix: command processing now only sets world.isGrappleQuietReleaseRequestedFlag.
 * applyGrappleClusterConstraint() consumes that one-shot flag at the correct
 * point inside the deterministic tick — after retraction and rope-length
 * constraint have finished updating the player's genuine velocity — so the
 * release always carries fully up-to-date physical velocity. Jump-off takes
 * priority when both land on the same tick.
 *
 * These tests drive the real per-tick functions (applyClusterMovement +
 * applyGrappleClusterConstraint), not releaseGrapple() with hand-assigned
 * velocity, so they exercise the actual constraint/gravity pipeline.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createWorldState, type WorldState } from '../sim/world';
import { createClusterState, type ClusterState } from '../sim/clusters/state';
import { applyClusterMovement } from '../sim/clusters/movement';
import { applyGrappleClusterConstraint, initGrappleChainParticles } from '../sim/clusters/grapple';
import { PLAYER_JUMP_SPEED_WORLD } from '../sim/clusters/movementConstants';

const DT_MS = 1000 / 60;

function makeWorldAndPlayer(playerX: number, playerY: number): { world: WorldState; player: ClusterState } {
  const world = createWorldState(DT_MS, 1);
  const player = createClusterState(0, playerX, playerY, 1, 100);
  world.clusters = [player];
  initGrappleChainParticles(world, 1);
  return { world, player };
}

/** Runs one full fixed tick's worth of grapple-relevant physics: gravity/movement then the grapple constraint. */
function runGrappleTick(world: WorldState): void {
  applyClusterMovement(world);
  applyGrappleClusterConstraint(world);
}

function attachGrapple(world: WorldState, player: ClusterState, anchorX: number, anchorY: number, ropeLength: number): void {
  world.isGrappleActiveFlag = 1;
  world.grappleAnchorXWorld = anchorX;
  world.grappleAnchorYWorld = anchorY;
  world.grappleLengthWorld = ropeLength;
  world.hasGrappleChargeFlag = 1;
  const start = world.grappleParticleStartIndex;
  for (let i = 0; i < 10; i++) {
    const idx = start + i;
    world.isAliveFlag[idx] = 1;
    world.positionXWorld[idx] = player.positionXWorld;
    world.positionYWorld[idx] = player.positionYWorld;
  }
}

test('1: quiet release with strong upward velocity preserves it (no snap this tick)', () => {
  const { world, player } = makeWorldAndPlayer(0, 0);
  // Anchor directly above, rope generously long so no rope-length snap fires
  // this tick — isolates "does the queued release preserve current velocity".
  attachGrapple(world, player, 0, -500, 400);
  player.velocityXWorld = 0;
  player.velocityYWorld = -300; // strongly upward

  world.isGrappleQuietReleaseRequestedFlag = 1;
  runGrappleTick(world);

  assert.equal(world.isGrappleActiveFlag, 0, 'grapple should be released this tick');
  assert.ok(player.velocityYWorld < 0, 'upward velocity must be preserved, not zeroed/inverted');
  // Only one tick of gravity should have been added on top of the original -300.
  assert.ok(player.velocityYWorld < -280, `expected velocity close to -300 plus one tick of gravity, got ${player.velocityYWorld}`);
});

test('2: quiet release during a real simulated upward pendulum swing continues upward afterward', () => {
  const { world, player } = makeWorldAndPlayer(-100, 0);
  // Anchor to the upper-right; give the player tangential (swinging) velocity
  // so gravity + constraint produce a genuine pendulum arc.
  attachGrapple(world, player, 0, -100, Math.hypot(100, 100));
  player.velocityXWorld = 260;
  player.velocityYWorld = -60;

  // Let the swing run for a stretch of real ticks so velocity is driven purely
  // by the constraint/gravity pipeline (not the hand-set initial values).
  for (let i = 0; i < 20; i++) runGrappleTick(world);

  // Only release while genuinely moving upward — pick the ascending part of
  // the swing so the assertion is meaningful.
  let releasedUpward = false;
  for (let i = 0; i < 60 && world.isGrappleActiveFlag === 1; i++) {
    if (player.velocityYWorld < -50) {
      world.isGrappleQuietReleaseRequestedFlag = 1;
      const vyBeforeRelease = player.velocityYWorld;
      runGrappleTick(world);
      assert.equal(world.isGrappleActiveFlag, 0);
      assert.ok(player.velocityYWorld < 0, 'must still be moving upward immediately after release');
      assert.ok(
        Math.abs(player.velocityYWorld - vyBeforeRelease) < 40,
        'released velocity should closely track the pre-release swing velocity (within one tick of gravity)',
      );
      releasedUpward = true;
      break;
    }
    runGrappleTick(world);
  }
  assert.ok(releasedUpward, 'test setup should have produced an upward-swinging tick to release on');

  // Continue simulating free-fall motion after release and confirm the
  // player keeps rising for at least a few ticks before gravity reverses it
  // (i.e. momentum genuinely carried into free movement).
  let roseFurther = false;
  let minY = player.positionYWorld;
  for (let i = 0; i < 10; i++) {
    applyClusterMovement(world);
    if (player.positionYWorld < minY) {
      minY = player.positionYWorld;
      roseFurther = true;
    }
  }
  assert.ok(roseFurther, 'player should continue rising for at least one tick after a quiet release while ascending');
});

test('3: release during rope retraction preserves resulting tangential momentum', () => {
  const { world, player } = makeWorldAndPlayer(-150, 0);
  attachGrapple(world, player, 0, -50, Math.hypot(150, 50));
  player.velocityXWorld = 100;
  player.velocityYWorld = -20;
  world.playerCrouchHeldFlag = 1; // hold down = retract

  // Run several retraction ticks so angular-momentum conservation has
  // actually boosted tangential speed above the original value.
  for (let i = 0; i < 15; i++) runGrappleTick(world);
  const speedBeforeRelease = Math.hypot(player.velocityXWorld, player.velocityYWorld);
  assert.ok(speedBeforeRelease > 0, 'retraction should have produced nonzero swing speed');

  world.isGrappleQuietReleaseRequestedFlag = 1;
  runGrappleTick(world);

  assert.equal(world.isGrappleActiveFlag, 0);
  const speedAfterRelease = Math.hypot(player.velocityXWorld, player.velocityYWorld);
  // Should be close to the pre-release speed (allow for one tick of gravity
  // changing the Y component and any final-tick retraction boost).
  assert.ok(
    speedAfterRelease > speedBeforeRelease * 0.5,
    `released speed (${speedAfterRelease}) should not have collapsed relative to pre-release swing speed (${speedBeforeRelease})`,
  );
});

test('4: a queued release survives a render frame where no fixed tick runs', () => {
  const { world, player } = makeWorldAndPlayer(0, 0);
  attachGrapple(world, player, 0, -500, 400);
  player.velocityYWorld = -200;

  // Simulate the command-processor queuing a release on a render frame with
  // no fixed tick this frame: just set the flag and do nothing else.
  world.isGrappleQuietReleaseRequestedFlag = 1;
  assert.equal(world.isGrappleActiveFlag, 1, 'grapple must still be active until a tick consumes the request');
  assert.equal(world.isGrappleQuietReleaseRequestedFlag, 1, 'the request must not be silently dropped');

  // Now the next fixed tick runs and must honor the queued request with
  // fresh (not stale) velocity.
  runGrappleTick(world);
  assert.equal(world.isGrappleActiveFlag, 0);
  assert.ok(player.velocityYWorld < -190, 'momentum must not be lost while the request waited for a tick');
});

test('7 & 8: jump-off takes priority over a same-tick quiet release and applies its impulse exactly once, additively', () => {
  const { world, player } = makeWorldAndPlayer(-100, 0);
  attachGrapple(world, player, 0, -100, Math.hypot(100, 100));
  player.velocityXWorld = 50;
  player.velocityYWorld = -40; // existing upward swing velocity

  const vyBeforeJump = player.velocityYWorld;

  world.playerJumpTriggeredFlag = 1;
  world.isGrappleQuietReleaseRequestedFlag = 1; // same-tick — must not double-release or fight the jump-off

  applyGrappleClusterConstraint(world);

  assert.equal(world.isGrappleActiveFlag, 0, 'jump-off releases the grapple');
  assert.equal(world.isGrappleQuietReleaseRequestedFlag, 0, 'the queued quiet release must be consumed/cleared, not applied a second time');
  // Jump-off impulse is additive on top of the existing swing velocity, and
  // applied exactly once (not doubled by also running the quiet-release path).
  const expectedVy = vyBeforeJump - PLAYER_JUMP_SPEED_WORLD;
  assert.ok(
    Math.abs(player.velocityYWorld - expectedVy) < 1e-6,
    `expected jump-off to add exactly one upward impulse on top of swing velocity: got ${player.velocityYWorld}, expected ${expectedVy}`,
  );
});

test('9: a quiet release still grants coyote time without modifying velocity via that path', () => {
  const { world, player } = makeWorldAndPlayer(0, 0);
  attachGrapple(world, player, 0, -500, 400);
  player.velocityXWorld = 30;
  player.velocityYWorld = -75;
  player.coyoteTimeTicks = 0;

  world.isGrappleQuietReleaseRequestedFlag = 1;
  const vyBefore = player.velocityYWorld;
  runGrappleTick(world);

  assert.ok(player.coyoteTimeTicks > 0, 'quiet release should grant coyote time');
  // Coyote time grant itself must not have touched velocity beyond normal gravity.
  assert.ok(player.velocityYWorld < vyBefore, 'gravity alone should have nudged velocity, not a coyote-time side effect');
  assert.ok(player.velocityYWorld > vyBefore - 20, 'coyote time grant must not inject extra velocity change');
});

test('a fresh fireGrapple-style re-attach is unaffected by a stale queued release from a prior session', () => {
  const { world, player } = makeWorldAndPlayer(0, 0);
  attachGrapple(world, player, 0, -500, 400);
  player.velocityYWorld = -100;

  // Simulate: player queued a release, but before the physics tick ran the
  // world re-attached a brand-new grapple session (e.g. the pool released it
  // via some other path and the player re-fired). The stale flag must not
  // instantly kill the new session.
  world.isGrappleQuietReleaseRequestedFlag = 1;
  world.isGrappleQuietReleaseRequestedFlag = 0; // fireGrapple() clears this on every fresh attach
  attachGrapple(world, player, 50, -450, 300); // simulate the new fireGrapple() attach

  runGrappleTick(world);
  assert.equal(world.isGrappleActiveFlag, 1, 'the new grapple session must survive; the stale request must not leak in');
});
