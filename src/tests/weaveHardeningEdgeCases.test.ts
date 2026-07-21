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
  BOW_ARROW_PHASE_NONE,
  BOW_ARROW_LOAD_3_TICKS,
} from '../sim/weaves/bowArrow';
import { startNewSwordSwipe, tickNewSwordSwipe, NEW_SWORD_SLASH_TICKS } from '../sim/weaves/swordWeave';
import { resetSecondaryWeaveCoordinatorState } from '../sim/weaves/secondaryWeaveCoordinator';
import { BEHAVIOR_MODE_BOW_ARROW } from '../sim/particles/bowArrowBehaviorMode';
import { BEHAVIOR_MODE_SWORD_SLASH } from '../sim/particles/swordSlashBehaviorMode';
import { beginDustTypeSwitch, tickDustTypeSwitch } from '../sim/weaves/dustTypeSwitch';

const DT_MS = 1000 / 60;

function makeFixture(moteCount = 8) {
  const world = createWorldState(DT_MS, 17);
  const player = createClusterState(0, 100, 100, 1, 20);
  world.clusters = [player];
  spawnClusterParticles(world, player.entityId, player.positionXWorld, player.positionYWorld, ParticleKind.Golden, moteCount, world.rng);
  initMoteQueueFromParticles(world, player.entityId);
  return { world, player };
}

// ── Room-transition / death cleanup ─────────────────────────────────────────

test('resetSecondaryWeaveCoordinatorState (room load / death respawn) clears a mid-assembly bow arrow completely', () => {
  const { world } = makeFixture(8);
  beginBowArrowAssembly(world, world.tick, 1);
  for (let i = 0; i < BOW_ARROW_LOAD_3_TICKS + 5; i++) {
    world.tick++;
    tickBowArrowAssembly(world, 1, 0, true);
  }
  assert.ok(world.bowArrowCount > 0);

  resetSecondaryWeaveCoordinatorState(world);

  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE);
  assert.equal(world.bowArrowCount, 0);
  assert.equal(world.bowArrowReleaseLatchedFlag, 0);
  for (let r = 0; r < world.bowArrowParticleIndex.length; r++) {
    assert.equal(world.bowArrowParticleIndex[r], -1);
    assert.equal(world.bowArrowRankState[r], 0);
  }
});

test('resetSecondaryWeaveCoordinatorState clears a mid-swipe sword cleanly', () => {
  const { world, player } = makeFixture(8);
  startNewSwordSwipe(world, player, 1, player.positionXWorld + 20, player.positionYWorld);
  tickNewSwordSwipe(world);
  assert.ok(world.newSwordMoteCount > 0);

  resetSecondaryWeaveCoordinatorState(world);

  assert.equal(world.newSwordActiveFlag, 0);
  assert.equal(world.newSwordMoteCount, 0);
  for (let r = 0; r < world.newSwordMoteParticleIndex.length; r++) {
    assert.equal(world.newSwordMoteParticleIndex[r], -1);
  }
});

test('a fresh room load after death restores a valid mote state even after an outbound arrow existed', () => {
  const { world } = makeFixture(8);
  beginBowArrowAssembly(world, world.tick, 1);
  for (let i = 0; i < BOW_ARROW_LOAD_3_TICKS + 13; i++) {
    world.tick++;
    tickBowArrowAssembly(world, 1, 0, true);
  }
  assert.equal(fireBowArrow(world, 1, 0), true);
  world.tick++;
  tickBowArrowOutbound(world); // one step of outbound flight

  // Simulate room reload: rebuild the mote queue fresh (as gameLoadRoomPhases
  // does) and reset coordinator bookkeeping.
  world.particleCount = 0;
  const player2 = world.clusters[0];
  spawnClusterParticles(world, player2.entityId, player2.positionXWorld, player2.positionYWorld, ParticleKind.Golden, 8, world.rng);
  initMoteQueueFromParticles(world, player2.entityId);
  resetSecondaryWeaveCoordinatorState(world);

  assert.equal(world.bowArrowPhase, BOW_ARROW_PHASE_NONE, 'no stale outbound arrow survives a room reload');
  for (let i = 0; i < world.particleCount; i++) {
    assert.notEqual(world.behaviorMode[i], BEHAVIOR_MODE_BOW_ARROW, 'freshly-spawned motes must not inherit stale arrow ownership');
    assert.notEqual(world.behaviorMode[i], BEHAVIOR_MODE_SWORD_SLASH);
  }
});

// ── Arrows spawned near / aimed into a wall ─────────────────────────────────

test('an arrow aimed into a wall immediately in front of the shield resolves a bounce promptly, without embedding', () => {
  const { world, player } = makeFixture(8);
  // Wall immediately in front of the shield center (a few world units past
  // where the arrow launches from — walls cannot physically overlap the
  // player/shield position in real level geometry, since the player itself
  // collides with walls).
  world.wallCount = 1;
  world.wallXWorld[0] = player.positionXWorld + 12 + 3;
  world.wallYWorld[0] = player.positionYWorld - 20;
  world.wallWWorld[0] = 40;
  world.wallHWorld[0] = 40;

  beginBowArrowAssembly(world, world.tick, 1);
  for (let i = 0; i < BOW_ARROW_LOAD_3_TICKS + 13; i++) {
    world.tick++;
    tickBowArrowAssembly(world, 1, 0, true);
  }
  assert.equal(fireBowArrow(world, 1, 0), true);

  let resolved = false;
  for (let i = 0; i < 60 && !resolved; i++) {
    world.tick++;
    resolved = tickBowArrowOutbound(world);
  }
  assert.ok(resolved, 'arrow aimed directly into an adjacent wall resolves promptly');
  for (let i = 0; i < world.particleCount; i++) {
    if (world.behaviorMode[i] === 0) {
      assert.ok(world.positionXWorld[i] <= world.wallXWorld[0] + 1e-3, 'no mote embedded past the wall face');
    }
  }
});

// ── Variable dtMs ────────────────────────────────────────────────────────────

test('outbound travel accumulates correctly across wildly variable dtMs (pause/resume, frame drops)', () => {
  const { world } = makeFixture(8);
  beginBowArrowAssembly(world, world.tick, 1);
  for (let i = 0; i < BOW_ARROW_LOAD_3_TICKS + 13; i++) {
    world.tick++;
    tickBowArrowAssembly(world, 1, 0, true);
  }
  fireBowArrow(world, 1, 0);

  const dtPattern = [16.67, 0.001, 100, 16.67, 33.33, 16.67];
  let resolved = false;
  for (let i = 0; i < 500 && !resolved; i++) {
    world.dtMs = dtPattern[i % dtPattern.length];
    world.tick++;
    resolved = tickBowArrowOutbound(world);
    assert.ok(world.bowArrowTravelPx <= 250 + 1e-6, 'never overshoots max travel regardless of step size');
  }
  assert.ok(resolved, 'arrow eventually resolves despite highly variable dt');
});

// ── Fewer available motes than requested / mixed mote kinds ─────────────────

test('bow assembly with mixed mote kinds captures the seated center mote\'s actual kind, not a fixed default', () => {
  const { world, player } = makeFixture(6);
  // Mix kinds across the queue.
  const kinds = [ParticleKind.Ice, ParticleKind.Golden, ParticleKind.Nature, ParticleKind.Golden, ParticleKind.Void, ParticleKind.Golden];
  for (let i = 0; i < world.moteSlotCount; i++) world.moteSlotKind[i] = kinds[i % kinds.length];
  const centerPidx0 = world.moteSlotParticleIndex[0];
  world.kindBuffer[centerPidx0] = kinds[0];

  beginBowArrowAssembly(world, world.tick, 1);
  for (let i = 0; i < BOW_ARROW_LOAD_3_TICKS + 13; i++) {
    world.tick++;
    tickBowArrowAssembly(world, 1, 0, true);
  }
  fireBowArrow(world, 1, 0);
  assert.equal(world.bowArrowDustKind, kinds[0], 'captures the actual seated center mote\'s kind');
  void player;
});

test('dust switching during outbound flight does not corrupt bow-arrow ownership (task cleanliness requirement)', () => {
  const { world, player } = makeFixture(8);
  beginBowArrowAssembly(world, world.tick, 1);
  for (let i = 0; i < BOW_ARROW_LOAD_3_TICKS + 13; i++) {
    world.tick++;
    tickBowArrowAssembly(world, 1, 0, true);
  }
  fireBowArrow(world, 1, 0);
  const arrowPidx = [world.bowArrowParticleIndex[0], world.bowArrowParticleIndex[1], world.bowArrowParticleIndex[2]];

  // Attempt a dust-type switch mid-flight — must not hijack the arrow motes'
  // behaviorMode out from under the Bow Weave.
  beginDustTypeSwitch(world, ParticleKind.Ice);
  for (const pidx of arrowPidx) {
    assert.equal(world.behaviorMode[pidx], BEHAVIOR_MODE_BOW_ARROW, 'arrow mote ownership must survive a concurrent dust-type switch');
  }
  tickDustTypeSwitch(world);
  for (const pidx of arrowPidx) {
    assert.equal(world.behaviorMode[pidx], BEHAVIOR_MODE_BOW_ARROW, 'still owned by the Bow after a dust-switch tick');
  }

  // The arrow itself continues to resolve normally afterward.
  let resolved = false;
  for (let i = 0; i < 300 && !resolved; i++) {
    world.tick++;
    resolved = tickBowArrowOutbound(world);
  }
  assert.ok(resolved);
  void player;
});

test('dust switching mid sword-swipe does not corrupt sword-mote ownership', () => {
  const { world, player } = makeFixture(8);
  startNewSwordSwipe(world, player, 1, player.positionXWorld + 20, player.positionYWorld);
  tickNewSwordSwipe(world);
  const swordPidx = [world.newSwordMoteParticleIndex[0], world.newSwordMoteParticleIndex[1]];

  beginDustTypeSwitch(world, ParticleKind.Void);
  for (const pidx of swordPidx) {
    assert.equal(world.behaviorMode[pidx], BEHAVIOR_MODE_SWORD_SLASH, 'sword mote ownership must survive a concurrent dust-type switch');
  }

  for (let i = 1; i < NEW_SWORD_SLASH_TICKS; i++) tickNewSwordSwipe(world);
  assert.equal(world.newSwordActiveFlag, 0, 'swipe still completes normally');
});
