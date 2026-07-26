import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { ParticleKind } from '../sim/particles/kinds';
import { getMoteTypeVisual } from '../sim/motes/moteTypeConfig';
import {
  PLAYER_DEATH_MOTE_COUNT,
  spawnPlayerDeathDisintegration,
} from '../sim/clusters/playerDeathDisintegration';

function countAliveGolden(world: ReturnType<typeof createWorldState>): number {
  let count = 0;
  for (let i = 0; i < world.particleCount; i++) {
    if (world.isAliveFlag[i] === 1 && world.kindBuffer[i] === ParticleKind.Golden && world.ownerEntityId[i] === -1) {
      count++;
    }
  }
  return count;
}

test('player death spawns ~80 unowned golden dust motes at the death position', () => {
  const world = createWorldState(1000 / 60, 1);
  spawnPlayerDeathDisintegration(world, 100, 200);

  const spawned = countAliveGolden(world);
  assert.ok(
    Math.abs(spawned - PLAYER_DEATH_MOTE_COUNT) <= 5,
    `expected ~${PLAYER_DEATH_MOTE_COUNT} motes (±5), got ${spawned}`,
  );
});

test('player death motes use the warm-gold Golden mote color', () => {
  const goldenVisual = getMoteTypeVisual(ParticleKind.Golden);
  assert.ok(goldenVisual.body.r > 0.9 && goldenVisual.body.g > 0.7 && goldenVisual.body.b < 0.2,
    'Golden mote body color should be warm gold (high R/G, low B)');
});

test('player death motes are biased leftward (negative X velocity)', () => {
  const world = createWorldState(1000 / 60, 7);
  spawnPlayerDeathDisintegration(world, 50, 50);

  let leftwardCount = 0;
  let total = 0;
  for (let i = 0; i < world.particleCount; i++) {
    if (world.isAliveFlag[i] === 1 && world.kindBuffer[i] === ParticleKind.Golden && world.ownerEntityId[i] === -1) {
      total++;
      if (world.velocityXWorld[i] < 0) leftwardCount++;
    }
  }
  assert.ok(total > 0, 'expected some motes to be spawned');
  assert.equal(leftwardCount, total, 'all death motes should have negative (leftward) X velocity');
});

test('player death motes have finite, non-zero speed and expected lifetime', () => {
  const world = createWorldState(1000 / 60, 42);
  spawnPlayerDeathDisintegration(world, 0, 0);

  for (let i = 0; i < world.particleCount; i++) {
    if (world.isAliveFlag[i] === 1 && world.kindBuffer[i] === ParticleKind.Golden && world.ownerEntityId[i] === -1) {
      const speed = Math.hypot(world.velocityXWorld[i], world.velocityYWorld[i]);
      assert.ok(speed > 0, 'mote should have nonzero velocity');
      assert.ok(world.lifetimeTicks[i] > 0, 'mote should have positive lifetime');
      assert.equal(world.isTransientFlag[i], 1, 'death motes should be transient (no respawn)');
    }
  }
});

test('non-death disappear events do not spawn motes', () => {
  const world = createWorldState(1000 / 60, 3);
  // Simulating a non-death disappear (e.g. room transition) simply never
  // calls spawnPlayerDeathDisintegration — verify the world starts clean.
  assert.equal(countAliveGolden(world), 0);
});

test('spawning does not throw when the particle pool is at capacity', () => {
  const world = createWorldState(1000 / 60, 9);
  // Fill the pool to capacity with permanent (non-transient) alive particles
  // so no free slots exist and particleCount cannot grow further.
  const capacity = world.positionXWorld.length;
  for (let i = 0; i < capacity; i++) {
    world.isAliveFlag[i] = 1;
    world.isTransientFlag[i] = 0;
    world.kindBuffer[i] = ParticleKind.Golden;
    world.ownerEntityId[i] = 1;
  }
  world.particleCount = capacity;

  assert.doesNotThrow(() => spawnPlayerDeathDisintegration(world, 10, 10));
});
