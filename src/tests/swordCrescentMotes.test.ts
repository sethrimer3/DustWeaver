import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { spawnClusterParticles } from '../screens/gameSpawn';
import { initMoteQueueFromParticles } from '../sim/motes/orderedMoteQueue';
import {
  startNewSwordSwipe,
  tickNewSwordSwipe,
  resetNewSwordState,
  NEW_SWORD_SLASH_TICKS,
} from '../sim/weaves/swordWeave';
import { BEHAVIOR_MODE_SWORD_SLASH } from '../sim/particles/swordSlashBehaviorMode';

const DT_MS = 1000 / 60;

function makeFixture(moteCount = 6) {
  const world = createWorldState(DT_MS, 5);
  const player = createClusterState(0, 100, 100, 1, 20);
  world.clusters = [player];
  spawnClusterParticles(world, player.entityId, player.positionXWorld, player.positionYWorld, ParticleKind.Golden, moteCount, world.rng);
  initMoteQueueFromParticles(world, player.entityId);
  return { world, player };
}

function angleAround(world: ReturnType<typeof createWorldState>, pidx: number): number {
  return Math.atan2(
    world.positionYWorld[pidx] - world.newSwordHandAnchorYWorld,
    world.positionXWorld[pidx] - world.newSwordHandAnchorXWorld,
  );
}
function radiusAround(world: ReturnType<typeof createWorldState>, pidx: number): number {
  return Math.hypot(
    world.positionXWorld[pidx] - world.newSwordHandAnchorXWorld,
    world.positionYWorld[pidx] - world.newSwordHandAnchorYWorld,
  );
}

/** Shortest signed delta a→b in (-π,π]. */
function shortestDelta(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

test('sword reserves the actual player motes as the blade (BEHAVIOR_MODE_SWORD_SLASH)', () => {
  const { world, player } = makeFixture(6);
  startNewSwordSwipe(world, player, 1, player.positionXWorld + 20, player.positionYWorld);
  assert.ok(world.newSwordMoteCount > 0, 'motes reserved');
  let inSlashMode = 0;
  for (let i = 0; i < world.particleCount; i++) {
    if (world.behaviorMode[i] === BEHAVIOR_MODE_SWORD_SLASH) inSlashMode++;
  }
  assert.equal(inSlashMode, world.newSwordMoteCount, 'exactly the reserved motes are in slash mode');
});

test('sword motes stage behind the aim, then sweep to terminate in front of the aim', () => {
  const { world, player } = makeFixture(4);
  const aimX = player.positionXWorld + 20; // aim +x → aim angle 0
  startNewSwordSwipe(world, player, 1, aimX, player.positionYWorld);

  // One tick in: staging — the leading mote should be BEHIND the aim (its
  // angular distance from the aim direction is large, > 90°).
  world.newSwordTicksElapsed = 0;
  tickNewSwordSwipe(world);
  const leadPidx = world.newSwordMoteParticleIndex[0];
  const stagingDelta = Math.abs(shortestDelta(0, angleAround(world, leadPidx)));
  assert.ok(stagingDelta > Math.PI / 2, `leading mote should stage behind the aim, delta=${stagingDelta}`);

  // Run to completion; capture the leading mote's final angle just before exit.
  let finalLeadAngle = 0;
  for (let i = 1; i < NEW_SWORD_SLASH_TICKS; i++) {
    const done = tickNewSwordSwipe(world);
    if (!done) finalLeadAngle = angleAround(world, leadPidx);
  }
  // By the last active tick the leading mote should have swung to the front
  // (close to the aim direction, within ~35°).
  const frontDelta = Math.abs(shortestDelta(0, finalLeadAngle));
  assert.ok(frontDelta < Math.PI * 0.25, `leading mote should terminate in front of the aim, delta=${frontDelta}`);
});

test('sword motes form a layered crescent: each trails slightly behind and sits slightly farther out', () => {
  const { world, player } = makeFixture(5);
  startNewSwordSwipe(world, player, 1, player.positionXWorld + 20, player.positionYWorld);
  // Advance into the sweep (past staging) a few ticks.
  world.newSwordTicksElapsed = 0;
  for (let i = 0; i < 6; i++) tickNewSwordSwipe(world);

  const n = world.newSwordMoteCount;
  assert.ok(n >= 3, 'need several motes for the layering check');
  // Radius strictly increases with rank; each successive mote is farther out.
  for (let r = 1; r < n; r++) {
    const rPrev = radiusAround(world, world.newSwordMoteParticleIndex[r - 1]);
    const rCur = radiusAround(world, world.newSwordMoteParticleIndex[r]);
    assert.ok(rCur > rPrev, `rank ${r} radius ${rCur} should exceed rank ${r - 1} radius ${rPrev}`);
  }
});

test('sword motes exit cleanly to Storm following after the swipe finishes', () => {
  const { world, player } = makeFixture(6);
  startNewSwordSwipe(world, player, 1, player.positionXWorld + 20, player.positionYWorld);
  let done = false;
  for (let i = 0; i < NEW_SWORD_SLASH_TICKS + 2 && !done; i++) done = tickNewSwordSwipe(world);
  assert.ok(done, 'swipe completes');
  assert.equal(world.newSwordActiveFlag, 0);
  assert.equal(world.newSwordMoteCount, 0, 'no motes left under sword control');
  for (let i = 0; i < world.particleCount; i++) {
    assert.notEqual(world.behaviorMode[i], BEHAVIOR_MODE_SWORD_SLASH, 'no stale sword-slash control persists');
  }
});

test('aim direction rotates the crescent (different aim → different staging angle)', () => {
  const { world, player } = makeFixture(4);

  startNewSwordSwipe(world, player, 1, player.positionXWorld + 20, player.positionYWorld); // aim +x
  const offsetRight = shortestDelta(world.newSwordAimAngleRad, world.newSwordStartAngleRad);
  resetNewSwordState(world);

  startNewSwordSwipe(world, player, 2, player.positionXWorld, player.positionYWorld + 20); // aim +y
  const offsetUp = shortestDelta(world.newSwordAimAngleRad, world.newSwordStartAngleRad);

  // The crescent rotates rigidly with the aim: the staging angle's offset from
  // the aim direction is identical regardless of aim direction.
  assert.ok(Math.abs(offsetRight - offsetUp) < 1e-6, `crescent staging offset must be rigid to aim (${offsetRight} vs ${offsetUp})`);
  // And it is genuinely a rear staging offset (behind the aim, > 90°).
  assert.ok(Math.abs(offsetRight) > Math.PI / 2, 'staging is behind the aim');
});

test('resetNewSwordState releases reserved motes back to orbit (cancel safety)', () => {
  const { world, player } = makeFixture(6);
  startNewSwordSwipe(world, player, 1, player.positionXWorld + 20, player.positionYWorld);
  tickNewSwordSwipe(world);
  assert.ok(world.newSwordMoteCount > 0);
  resetNewSwordState(world);
  assert.equal(world.newSwordMoteCount, 0);
  for (let i = 0; i < world.particleCount; i++) {
    assert.notEqual(world.behaviorMode[i], BEHAVIOR_MODE_SWORD_SLASH, 'cancel returns motes to orbit');
  }
});
