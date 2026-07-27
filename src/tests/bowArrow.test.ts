import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { spawnClusterParticles } from '../screens/gameSpawn';
import {
  beginBowArrowAssembly,
  tickBowArrowAssembly,
  fireBowArrow,
  latchBowArrowRelease,
  tryResolveLatchedBowArrowRelease,
  tickBowArrowOutbound,
  cancelBowArrow,
  bowArrowRankLineOffset,
  countSeatedBowArrowMotes,
  BOW_ARROW_PHASE_NONE,
  BOW_ARROW_PHASE_ASSEMBLING,
  BOW_ARROW_PHASE_OUTBOUND,
  BOW_ARROW_LOAD_3_TICKS,
  BOW_ARROW_LOAD_4_TICKS,
  BOW_ARROW_LOAD_5_TICKS,
} from '../sim/weaves/bowArrow';
import { BEHAVIOR_MODE_BOW_ARROW } from '../sim/particles/bowArrowBehaviorMode';
import { GOLD_DUST_OUTBOUND_SPEED_PX_PER_SEC, GOLD_DUST_MAX_TRAVEL_PX } from '../sim/motes/moteTypeConfig';
import { SHIELD_CRESCENT_RADIUS_WORLD } from '../sim/weaves/shieldGeometry';

const DT_MS = 1000 / 60;

function makeFixture(moteCount = 8) {
  const world = createWorldState(DT_MS, 11);
  const player = createClusterState(0, 100, 100, 1, 20);
  world.clusters = [player];
  spawnClusterParticles(world, player.entityId, player.positionXWorld, player.positionYWorld, ParticleKind.Golden, moteCount, world.rng);
  player.healthPoints = moteCount;
  player.maxHealthPoints = moteCount;
  return { world, player };
}

/** Runs the held-assembly path for `ticks` ticks along a fixed aim. */
function assembleFor(world: ReturnType<typeof createWorldState>, ticks: number, aimX = 1, aimY = 0) {
  for (let i = 0; i < ticks; i++) {
    world.tick++;
    tickBowArrowAssembly(world, aimX, aimY, /* isHeld */ true);
  }
}

/** Runs the NOT-held (post-release, seat-finishing) path for `ticks` ticks. */
function seatFor(world: ReturnType<typeof createWorldState>, ticks: number) {
  for (let i = 0; i < ticks; i++) {
    world.tick++;
    tickBowArrowAssembly(world, world.bowArrowDirXWorld, world.bowArrowDirYWorld, /* isHeld */ false);
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

test('assembly loads on the shield-relative schedule: 3 at 0.75s, 4 at 1.25s, 5 at 1.75s (reserved count; seating adds 12 ticks)', () => {
  const { world } = makeFixture(8);
  const startTick = world.tick;
  assert.equal(beginBowArrowAssembly(world, startTick, 1), true);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_ASSEMBLING);
  assert.equal(world.bowArrowCount, 1, 'center mote only at t=0');

  // Just before 0.75s: still only the center mote.
  assembleFor(world, BOW_ARROW_LOAD_3_TICKS - 2);
  assert.equal(world.bowArrowCount, 1, 'no additional motes before 0.75s');

  // Cross 0.75s → 3 reserved (2 begin loading together).
  assembleFor(world, 3);
  assert.equal(world.bowArrowCount, 3, 'two motes begin loading together at 0.75s → 3 reserved');

  // Cross 1.25s → 4th mote begins loading.
  assembleFor(world, BOW_ARROW_LOAD_4_TICKS - (world.tick - startTick) + 1);
  assert.equal(world.bowArrowCount, 4);

  // Cross 1.75s → 5th mote begins loading (max reserved).
  assembleFor(world, BOW_ARROW_LOAD_5_TICKS - (world.tick - startTick) + 1);
  assert.equal(world.bowArrowCount, 5);

  // Beyond 1.75s never exceeds five, and given enough time all finish seating.
  assembleFor(world, 60);
  assert.equal(world.bowArrowCount, 5, 'maximum arrow length is five');
  assert.equal(countSeatedBowArrowMotes(world), 5, 'all five finish seating given enough time');
  assert.equal(countArrowMotes(world), 5, 'all five are actual particles, no phantoms');
});

test('assembly is capped by available motes: exactly three motes → three-mote arrow max', () => {
  const { world } = makeFixture(3);
  assert.equal(beginBowArrowAssembly(world, world.tick, 1), true);
  assembleFor(world, BOW_ARROW_LOAD_5_TICKS + 20);
  assert.equal(world.bowArrowCount, 3, 'cannot load more motes than the player has');
  assert.equal(countSeatedBowArrowMotes(world), 3);
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

test('firing requires SEATED motes, not merely reserved ones; three+ seated fires straight and outbound from the shield center', () => {
  const { world, player } = makeFixture(8);
  beginBowArrowAssembly(world, world.tick, 1);
  // Only the center mote so far.
  assert.equal(fireBowArrow(world, 1, 0), false, 'cannot fire a one-mote arrow');
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_ASSEMBLING);

  // Cross the 0.75s threshold — 3 reserved, but NOT yet seated (still arcing in).
  assembleFor(world, BOW_ARROW_LOAD_3_TICKS + 1);
  assert.equal(world.bowArrowCount, 3);
  assert.ok(countSeatedBowArrowMotes(world) < 3, 'freshly-reserved motes are still loading, not seated');
  assert.equal(fireBowArrow(world, 1, 0), false, 'cannot fire while still loading (task section 6)');

  // Let seating finish.
  assembleFor(world, 13);
  assert.equal(countSeatedBowArrowMotes(world), 3);
  assert.equal(fireBowArrow(world, 1, 0), true);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_OUTBOUND);
  assert.ok(Math.abs(world.bowArrowDirXWorld - 1) < 1e-6 && Math.abs(world.bowArrowDirYWorld) < 1e-6, 'straight +x');
  assert.ok(Math.abs(world.bowArrowOriginXWorld - (player.positionXWorld + SHIELD_CRESCENT_RADIUS_WORLD)) < 1e-3, 'launches from the shield center, not the player body');
  assert.ok(Math.abs(world.bowArrowOriginYWorld - player.positionYWorld) < 1e-3);
});

test('releasing before three seated latches and fires automatically once seating finishes (task section 6)', () => {
  const { world } = makeFixture(8);
  beginBowArrowAssembly(world, world.tick, 1);
  assembleFor(world, BOW_ARROW_LOAD_3_TICKS + 1); // 3 reserved, still loading
  assert.ok(countSeatedBowArrowMotes(world) < 3);

  // Player releases now: fireBowArrow fails, so the coordinator would latch.
  assert.equal(fireBowArrow(world, 1, 0), false);
  assert.equal(latchBowArrowRelease(world, 1, 0), true, 'enough reserved (>=3) to eventually seat — latch armed');
  assert.equal(world.bowArrowReleaseLatchedFlag, 1);

  // Seating continues even though the gesture is no longer held.
  for (let i = 0; i < 13; i++) {
    seatFor(world, 1);
    tryResolveLatchedBowArrowRelease(world);
  }
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_OUTBOUND, 'latched release fired once seating finished');
  assert.equal(world.bowArrowReleaseLatchedFlag, 0);
});

test('releasing with fewer than three ever reserved cannot latch — must cancel (never waits forever)', () => {
  const { world } = makeFixture(8);
  beginBowArrowAssembly(world, world.tick, 1);
  // Release almost immediately: only the center mote is reserved.
  assert.equal(world.bowArrowCount, 1);
  assert.equal(fireBowArrow(world, 1, 0), false);
  assert.equal(latchBowArrowRelease(world, 1, 0), false, 'cannot latch — could never reach the minimum');
  cancelBowArrow(world);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE);
  assert.equal(countArrowMotes(world), 0, 'center mote released, nothing stranded');
});

test('a 4th mote still loading at release fires only the 3 seated motes; the loading one returns to orbit in place, not snapped in', () => {
  const { world } = makeFixture(8);
  beginBowArrowAssembly(world, world.tick, 1);
  assembleFor(world, BOW_ARROW_LOAD_3_TICKS + 13); // 3 fully seated
  assert.equal(countSeatedBowArrowMotes(world), 3);
  assembleFor(world, BOW_ARROW_LOAD_4_TICKS - (BOW_ARROW_LOAD_3_TICKS + 13) + 1); // 4th begins loading
  assert.equal(world.bowArrowCount, 4);
  assert.equal(countSeatedBowArrowMotes(world), 3, '4th mote still mid-arc');

  const fourthPidx = world.bowArrowParticleIndex[3];
  const posBeforeFire = { x: world.positionXWorld[fourthPidx], y: world.positionYWorld[fourthPidx] };

  assert.equal(fireBowArrow(world, 1, 0), true, 'fires with exactly the 3 already-seated motes');
  assert.equal(world.bowArrowCount, 3, 'only the seated motes are part of the fired arrow');
  assert.equal(world.behaviorMode[fourthPidx], 0, 'the still-loading 4th mote returned to Storm following');
  assert.ok(
    Math.abs(world.positionXWorld[fourthPidx] - posBeforeFire.x) < 1e-6 &&
    Math.abs(world.positionYWorld[fourthPidx] - posBeforeFire.y) < 1e-6,
    'released in place — not snapped/teleported',
  );
});

test('outbound speed is exactly 250 px/s and does not depend on load duration', () => {
  for (const loadTicks of [BOW_ARROW_LOAD_3_TICKS + 13, BOW_ARROW_LOAD_5_TICKS + 13]) {
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
  assembleFor(world, BOW_ARROW_LOAD_3_TICKS + 13);
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

  let anyMoving = false;
  for (let i = 0; i < world.particleCount; i++) {
    if (Math.hypot(world.velocityXWorld[i], world.velocityYWorld[i]) > 1) anyMoving = true;
  }
  assert.ok(anyMoving, 'released motes carry an initial return velocity');
});

test('wall collision reflects the group biased toward the true reflection and does not embed motes', () => {
  const { world } = makeFixture(8);
  // Wall to the right of the shield center (player at x=100, shield center at x=112): left face at x=140.
  world.wallCount = 1;
  world.wallXWorld[0] = 140;
  world.wallYWorld[0] = 60;
  world.wallWWorld[0] = 40;
  world.wallHWorld[0] = 80;

  beginBowArrowAssembly(world, world.tick, 1);
  assembleFor(world, BOW_ARROW_LOAD_3_TICKS + 13);
  fireBowArrow(world, 1, 0); // fire +x toward the wall

  let resolved = false;
  for (let i = 0; i < 600 && !resolved; i++) {
    world.tick++;
    resolved = tickBowArrowOutbound(world);
  }
  assert.ok(resolved, 'arrow resolves on wall contact before max distance');
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE);

  let sawLeftward = false;
  for (let i = 0; i < world.particleCount; i++) {
    if (world.behaviorMode[i] !== 0) continue;
    if (world.velocityXWorld[i] < -10) sawLeftward = true;
    assert.ok(world.positionXWorld[i] <= 140 + 1e-3, `mote ${i} must not embed in terrain`);
  }
  assert.ok(sawLeftward, 'reflected velocity points back off the wall');
});

test('cancel returns all reserved motes to orbit with no arrow left', () => {
  const { world } = makeFixture(8);
  beginBowArrowAssembly(world, world.tick, 1);
  assembleFor(world, BOW_ARROW_LOAD_4_TICKS + 13);
  assert.ok(countArrowMotes(world) >= 4);
  cancelBowArrow(world);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE);
  assert.equal(world.bowArrowCount, 0);
  assert.equal(countArrowMotes(world), 0, 'all motes returned to orbit');
});

test('particle identity regression test: exact follower particle IDs are reserved, launched, and returned to normal Storm behavior', () => {
  const { world } = makeFixture(8);
  beginBowArrowAssembly(world, world.tick, 1);
  assembleFor(world, BOW_ARROW_LOAD_5_TICKS + 13);
  assert.equal(world.bowArrowCount, 5, '5 motes loaded into arrow');

  // Verify and record the exact particle indices reserved for the arrow
  const reservedIndices: number[] = [];
  for (let i = 0; i < world.bowArrowCount; i++) {
    const idx = world.bowArrowParticleIndex[i];
    assert.ok(idx >= 0 && idx < world.particleCount, 'valid particle index');
    assert.equal(world.behaviorMode[idx], BEHAVIOR_MODE_BOW_ARROW, 'particle marked with bow arrow behavior mode');
    reservedIndices.push(idx);
  }

  // Fire arrow and verify the same particle indices remain in bow arrow behavior mode during outbound flight
  fireBowArrow(world, 1, 0);
  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_OUTBOUND);
  for (const idx of reservedIndices) {
    assert.equal(world.behaviorMode[idx], BEHAVIOR_MODE_BOW_ARROW, 'particle remains reserved during flight');
  }

  // Complete outbound flight to max travel distance
  let resolved = false;
  for (let i = 0; i < 600 && !resolved; i++) {
    world.tick++;
    resolved = tickBowArrowOutbound(world);
  }
  assert.ok(resolved, 'outbound flight resolved');

  // Verify every single reserved particle index has been restored to behaviorMode 0 (normal Storm following)
  for (const idx of reservedIndices) {
    assert.equal(world.behaviorMode[idx], 0, 'exact particle index returned to Storm following behavior');
  }
});
