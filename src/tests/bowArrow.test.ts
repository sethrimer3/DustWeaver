import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { spawnClusterParticles } from '../screens/gameSpawn';
import { initMoteQueueFromParticles } from '../sim/motes/orderedMoteQueue';
import {
  beginBowArrowAssembly,
  tickBowArrowAssembly,
  fireBowArrow,
  tickBowArrowOutbound,
  cancelBowArrow,
  bowArrowRankLineOffset,
  BOW_ARROW_PHASE_NONE,
  BOW_ARROW_PHASE_ASSEMBLING,
  BOW_ARROW_PHASE_OUTBOUND,
  BOW_ARROW_LOAD_3_TICKS,
  BOW_ARROW_LOAD_4_TICKS,
  BOW_ARROW_LOAD_5_TICKS,
} from '../sim/weaves/bowArrow';
import { BEHAVIOR_MODE_BOW_ARROW } from '../sim/particles/bowArrowBehaviorMode';
import { GOLD_DUST_OUTBOUND_SPEED_PX_PER_SEC, GOLD_DUST_MAX_TRAVEL_PX } from '../sim/motes/moteTypeConfig';

const DT_MS = 1000 / 60;

function makeFixture(moteCount = 8) {
  const world = createWorldState(DT_MS, 11);
  const player = createClusterState(0, 100, 100, 1, 20);
  world.clusters = [player];
  spawnClusterParticles(world, player.entityId, player.positionXWorld, player.positionYWorld, ParticleKind.Golden, moteCount, world.rng);
  initMoteQueueFromParticles(world, player.entityId);
  return { world, player };
}

/** Runs the held-assembly path for `ticks` ticks along a fixed aim. */
function assembleFor(world: ReturnType<typeof createWorldState>, ticks: number, aimX = 1, aimY = 0) {
  for (let i = 0; i < ticks; i++) {
    world.tick++;
    tickBowArrowAssembly(world, aimX, aimY);
  }
}

function countArrowMotes(world: ReturnType<typeof createWorldState>): number {
  let n = 0;
  for (let i = 0; i < world.particleCount; i++) {
    if (world.behaviorMode[i] === BEHAVIOR_MODE_BOW_ARROW) n++;
  }
  return n;
}

test('rank line offsets grow center-out: 0, -1, +1, -2, +2', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map(bowArrowRankLineOffset),
    [0, -1, 1, -2, 2],
  );
});

test('assembly loads on the shield-relative schedule: 3 at 0.75s, 4 at 1.25s, 5 at 1.75s', () => {
  const { world } = makeFixture(8);
  const startTick = world.tick;
  assert.equal(beginBowArrowAssembly(world, startTick, 1), true);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_ASSEMBLING);
  assert.equal(world.bowArrowCount, 1, 'center mote only at t=0');

  // Just before 0.75s: still only the center mote.
  assembleFor(world, BOW_ARROW_LOAD_3_TICKS - 2);
  assert.equal(world.bowArrowCount, 1, 'no additional motes before 0.75s');

  // Cross 0.75s → 3 motes.
  assembleFor(world, 3);
  assert.equal(world.bowArrowCount, 3, 'two motes load together at 0.75s → 3');

  // Cross 1.25s → 4 motes.
  assembleFor(world, BOW_ARROW_LOAD_4_TICKS - (world.tick - startTick) + 1);
  assert.equal(world.bowArrowCount, 4);

  // Cross 1.75s → 5 motes (max).
  assembleFor(world, BOW_ARROW_LOAD_5_TICKS - (world.tick - startTick) + 1);
  assert.equal(world.bowArrowCount, 5);

  // Beyond 1.75s never exceeds five.
  assembleFor(world, 60);
  assert.equal(world.bowArrowCount, 5, 'maximum arrow length is five');
  assert.equal(countArrowMotes(world), 5, 'all five are actual particles, no phantoms');
});

test('assembly is capped by available motes: exactly three motes → three-mote arrow max', () => {
  const { world } = makeFixture(3);
  assert.equal(beginBowArrowAssembly(world, world.tick, 1), true);
  assembleFor(world, BOW_ARROW_LOAD_5_TICKS + 10);
  assert.equal(world.bowArrowCount, 3, 'cannot load more motes than the player has');
});

test('assembly refuses to start below three total motes (shield stays valid)', () => {
  const { world } = makeFixture(2);
  assert.equal(beginBowArrowAssembly(world, world.tick, 1), false);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE);
  assert.equal(countArrowMotes(world), 0);
});

test('changing aim while holding rotates the arrow without re-running the load timers', () => {
  const { world } = makeFixture(8);
  const startTick = world.tick;
  beginBowArrowAssembly(world, startTick, 1);
  assembleFor(world, BOW_ARROW_LOAD_3_TICKS + 5, 1, 0); // aim +x → 3 motes
  assert.equal(world.bowArrowCount, 3);

  // Rotate aim to +y for a while — count must NOT reset, timers must not restart.
  assembleFor(world, 20, 0, 1);
  assert.equal(world.bowArrowCount, 3, 'aim change does not re-run the schedule');
  assert.ok(Math.abs(world.bowArrowDirXWorld) < 1e-6 && Math.abs(world.bowArrowDirYWorld - 1) < 1e-6, 'arrow now points +y');
});

test('firing below the minimum three motes is refused; three+ fires straight and outbound', () => {
  const { world } = makeFixture(8);
  beginBowArrowAssembly(world, world.tick, 1);
  // Only the center mote so far.
  assert.equal(fireBowArrow(world, 1, 0), false, 'cannot fire a one-mote arrow');
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_ASSEMBLING);

  assembleFor(world, BOW_ARROW_LOAD_3_TICKS + 2);
  assert.ok(world.bowArrowCount >= 3);
  assert.equal(fireBowArrow(world, 1, 0), true);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_OUTBOUND);
  assert.ok(Math.abs(world.bowArrowDirXWorld - 1) < 1e-6 && Math.abs(world.bowArrowDirYWorld) < 1e-6, 'straight +x');
});

test('outbound speed is exactly 250 px/s and does not depend on load duration', () => {
  for (const loadTicks of [BOW_ARROW_LOAD_3_TICKS + 2, BOW_ARROW_LOAD_5_TICKS + 2]) {
    const { world } = makeFixture(8);
    beginBowArrowAssembly(world, world.tick, 1);
    assembleFor(world, loadTicks);
    fireBowArrow(world, 1, 0);
    world.tick++;
    tickBowArrowOutbound(world);
    const expectedStep = GOLD_DUST_OUTBOUND_SPEED_PX_PER_SEC * (DT_MS / 1000);
    assert.ok(
      Math.abs(world.bowArrowTravelPx - expectedStep) < 1e-3,
      `one tick should advance ${expectedStep}px regardless of load (${loadTicks} ticks)`,
    );
  }
});

test('outbound travel ends at exactly 250px and then curves home, releasing motes to Storm', () => {
  const { world } = makeFixture(8);
  const beforeMotes = world.particleCount;
  beginBowArrowAssembly(world, world.tick, 1);
  assembleFor(world, BOW_ARROW_LOAD_3_TICKS + 2);
  fireBowArrow(world, 1, 0);

  let resolved = false;
  for (let i = 0; i < 600 && !resolved; i++) {
    world.tick++;
    resolved = tickBowArrowOutbound(world);
    assert.ok(world.bowArrowTravelPx <= GOLD_DUST_MAX_TRAVEL_PX + 1e-6, 'never overshoots max travel');
  }
  assert.ok(resolved, 'arrow resolves at max distance');
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE);
  assert.equal(countArrowMotes(world), 0, 'motes handed back to Storm (no longer arrow-owned)');
  assert.equal(world.particleCount, beforeMotes, 'no motes created or destroyed');

  // Curve-home gives them an initial return velocity (not a teleport, not a stop).
  const center = world.bowArrowParticleIndex; // cleared, but motes still exist as particles
  void center;
  let anyMoving = false;
  for (let i = 0; i < world.particleCount; i++) {
    if (Math.hypot(world.velocityXWorld[i], world.velocityYWorld[i]) > 1) anyMoving = true;
  }
  assert.ok(anyMoving, 'released motes carry an initial return velocity');
});

test('wall collision reflects the group biased toward the true reflection and does not embed motes', () => {
  const { world } = makeFixture(8);
  // Wall to the right of the player: left face at x=140.
  world.wallCount = 1;
  world.wallXWorld[0] = 140;
  world.wallYWorld[0] = 60;
  world.wallWWorld[0] = 40;
  world.wallHWorld[0] = 80;

  beginBowArrowAssembly(world, world.tick, 1);
  assembleFor(world, BOW_ARROW_LOAD_3_TICKS + 2);
  fireBowArrow(world, 1, 0); // fire +x toward the wall

  let resolved = false;
  for (let i = 0; i < 600 && !resolved; i++) {
    world.tick++;
    resolved = tickBowArrowOutbound(world);
  }
  assert.ok(resolved, 'arrow resolves on wall contact before max distance');
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE);

  // Motes released to Storm with a velocity reflected back off the left face
  // (normal = -x): the x-component of the return velocity must be negative,
  // strongly biased toward the true mirror reflection.
  let sawLeftward = false;
  for (let i = 0; i < world.particleCount; i++) {
    if (world.behaviorMode[i] !== 0) continue;
    if (world.velocityXWorld[i] < -10) sawLeftward = true;
    // No mote embedded past the wall's left face.
    assert.ok(world.positionXWorld[i] <= 140 + 1e-3, `mote ${i} must not embed in terrain`);
  }
  assert.ok(sawLeftward, 'reflected velocity points back off the wall');
});

test('cancel returns all reserved motes to orbit with no arrow left', () => {
  const { world } = makeFixture(8);
  beginBowArrowAssembly(world, world.tick, 1);
  assembleFor(world, BOW_ARROW_LOAD_4_TICKS + 2);
  assert.ok(countArrowMotes(world) >= 4);
  cancelBowArrow(world);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE);
  assert.equal(world.bowArrowCount, 0);
  assert.equal(countArrowMotes(world), 0, 'all motes returned to orbit');
});
