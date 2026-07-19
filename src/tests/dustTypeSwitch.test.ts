import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { ParticleKind } from '../sim/particles/kinds';
import { spawnClusterParticles } from '../screens/gameSpawn';
import {
  initMoteQueueFromParticles,
  depleteMoteSlot,
  tickMoteSlotRegeneration,
  MOTE_STATE_DEPLETED,
  MOTE_STATE_AVAILABLE,
} from '../sim/motes/orderedMoteQueue';
import {
  beginDustTypeSwitch,
  tickDustTypeSwitch,
  isDustTypeSwitchInProgress,
  cancelAllDustTypeSwitches,
  DUST_SWITCH_PHASE_NORMAL,
  DUST_SWITCH_PHASE_RECALLING,
} from '../sim/weaves/dustTypeSwitch';
import { BEHAVIOR_MODE_DUST_SWITCH_RECALL, BEHAVIOR_MODE_DUST_SWITCH_RETURN } from '../sim/particles/dustSwitchBehaviorMode';

function makeFixture(moteCount = 5, dtMs = 1000 / 60) {
  const world = createWorldState(dtMs, 7);
  const player = createClusterState(0, 100, 100, 1, 20);
  world.clusters = [player];
  spawnClusterParticles(world, player.entityId, player.positionXWorld, player.positionYWorld, ParticleKind.Golden, moteCount, world.rng);
  initMoteQueueFromParticles(world, player.entityId);
  return { world, player };
}

function runTicks(world: ReturnType<typeof createWorldState>, count: number): void {
  for (let i = 0; i < count; i++) tickDustTypeSwitch(world);
}

test('all live regular player motes enter recall when switching', () => {
  const { world } = makeFixture(5);
  beginDustTypeSwitch(world, ParticleKind.Ice);
  assert.equal(world.dustSwitchActiveSlotCount, 5);
  for (let slot = 0; slot < world.moteSlotCount; slot++) {
    assert.equal(world.dustSwitchPhase[slot], DUST_SWITCH_PHASE_RECALLING);
    const pidx = world.moteSlotParticleIndex[slot];
    assert.equal(world.behaviorMode[pidx], BEHAVIOR_MODE_DUST_SWITCH_RECALL);
  }
  assert.equal(isDustTypeSwitchInProgress(world), true);
});

test('non-player and transient particles are unaffected by a switch', () => {
  const { world, player } = makeFixture(2);
  const enemy = createClusterState(1, 300, 300, 0, 5);
  world.clusters.push(enemy);
  spawnClusterParticles(world, enemy.entityId, enemy.positionXWorld, enemy.positionYWorld, ParticleKind.Golden, 3, world.rng);
  const enemyParticleStart = 2; // after the 2 player motes
  const enemyKindsBefore = [
    world.kindBuffer[enemyParticleStart],
    world.kindBuffer[enemyParticleStart + 1],
    world.kindBuffer[enemyParticleStart + 2],
  ];

  // A transient player-owned particle (e.g. a stray shard) must never have
  // become a mote slot in the first place.
  const transientIdx = world.particleCount++;
  world.isAliveFlag[transientIdx] = 1;
  world.kindBuffer[transientIdx] = ParticleKind.Golden;
  world.ownerEntityId[transientIdx] = player.entityId;
  world.isTransientFlag[transientIdx] = 1;

  beginDustTypeSwitch(world, ParticleKind.Void);

  for (let i = 0; i < 3; i++) {
    assert.equal(world.kindBuffer[enemyParticleStart + i], enemyKindsBefore[i]);
    assert.equal(world.behaviorMode[enemyParticleStart + i], 0);
  }
  assert.equal(world.kindBuffer[transientIdx], ParticleKind.Golden, 'transient particle must not be retargeted');
  for (let slot = 0; slot < world.moteSlotCount; slot++) {
    assert.notEqual(world.moteSlotParticleIndex[slot], transientIdx);
  }
});

test('a mote only transforms after reaching or crossing the player center', () => {
  const { world, player } = makeFixture(1);
  const pidx = world.moteSlotParticleIndex[0];
  world.positionXWorld[pidx] = player.positionXWorld - 200;
  world.positionYWorld[pidx] = player.positionYWorld;
  world.velocityXWorld[pidx] = 0;
  world.velocityYWorld[pidx] = 0;

  beginDustTypeSwitch(world, ParticleKind.Nature);
  assert.equal(world.kindBuffer[pidx], ParticleKind.Golden, 'kind unchanged the instant recall begins');

  // One tick at normal dt cannot cover 200 world units — must still be Golden.
  tickDustTypeSwitch(world);
  assert.equal(world.kindBuffer[pidx], ParticleKind.Golden);
  assert.equal(world.dustSwitchPhase[0], DUST_SWITCH_PHASE_RECALLING);

  // Run enough ticks for the custom steering to close the distance.
  let transformedTick = -1;
  for (let t = 0; t < 600 && transformedTick === -1; t++) {
    tickDustTypeSwitch(world);
    if (world.kindBuffer[pidx] === ParticleKind.Nature) transformedTick = t;
  }
  assert.notEqual(transformedTick, -1, 'mote never transformed within a generous tick budget');
});

test('high-speed movement cannot skip over the transformation point', () => {
  // A huge dt makes a single tick's potential travel distance vastly exceed
  // the initial gap — the segment-crossing test must snap exactly onto the
  // player center rather than overshooting past it.
  const { world, player } = makeFixture(1, 5000);
  const pidx = world.moteSlotParticleIndex[0];
  world.positionXWorld[pidx] = player.positionXWorld - 10;
  world.positionYWorld[pidx] = player.positionYWorld;

  beginDustTypeSwitch(world, ParticleKind.Light);
  tickDustTypeSwitch(world);

  assert.equal(world.positionXWorld[pidx], player.positionXWorld);
  assert.equal(world.positionYWorld[pidx], player.positionYWorld);
  assert.equal(world.kindBuffer[pidx], ParticleKind.Light);
  assert.equal(world.moteSlotKind[0], ParticleKind.Light);
  assert.equal(world.behaviorMode[pidx], BEHAVIOR_MODE_DUST_SWITCH_RETURN);
});

test('each logical slot changes to the target type exactly once, and a second selection is blocked mid-transition', () => {
  const { world } = makeFixture(3);
  beginDustTypeSwitch(world, ParticleKind.Void);
  const targetsAfterFirst = Array.from({ length: world.moteSlotCount }, (_, i) => world.dustSwitchTargetKind[i]);
  assert.ok(targetsAfterFirst.every(k => k === ParticleKind.Void));

  // Attempting another selection while a switch is in progress must no-op.
  beginDustTypeSwitch(world, ParticleKind.Light);
  for (let i = 0; i < world.moteSlotCount; i++) {
    assert.equal(world.dustSwitchTargetKind[i], ParticleKind.Void, 'second selection must not overwrite an in-progress switch');
  }

  runTicks(world, 2000);
  for (let slot = 0; slot < world.moteSlotCount; slot++) {
    assert.equal(world.moteSlotKind[slot], ParticleKind.Void);
  }
  assert.equal(isDustTypeSwitchInProgress(world), false);
});

test('depleted motes remain depleted and later respawn as the target type', () => {
  const { world } = makeFixture(3);
  depleteMoteSlot(world, 0, 50);
  assert.equal(world.moteSlotState[0], MOTE_STATE_DEPLETED);

  beginDustTypeSwitch(world, ParticleKind.Ice);

  // Retargeted immediately, no animation — never entered the recall phase.
  assert.equal(world.moteSlotKind[0], ParticleKind.Ice);
  assert.equal(world.dustSwitchPhase[0], DUST_SWITCH_PHASE_NORMAL);
  assert.equal(world.moteSlotState[0], MOTE_STATE_DEPLETED, 'depletion cooldown preserved');
  assert.equal(world.dustSwitchActiveSlotCount, 2, 'the depleted slot does not count toward the animated total');

  for (let i = 0; i < 60; i++) tickMoteSlotRegeneration(world);
  assert.equal(world.moteSlotState[0], MOTE_STATE_AVAILABLE);
  const pidx = world.moteSlotParticleIndex[0];
  assert.equal(world.kindBuffer[pidx], ParticleKind.Ice, 'respawns as the newly selected kind');
});

test('a mote depleted mid-recall resolves safely instead of deadlocking', () => {
  const { world, player } = makeFixture(1);
  const pidx = world.moteSlotParticleIndex[0];
  world.positionXWorld[pidx] = player.positionXWorld - 500; // never reaches center on its own
  beginDustTypeSwitch(world, ParticleKind.Void);
  assert.equal(world.dustSwitchActiveSlotCount, 1);

  tickDustTypeSwitch(world);
  assert.equal(world.dustSwitchPhase[0], DUST_SWITCH_PHASE_RECALLING);

  // Simulate the particle dying mid-recall (defensive robustness case).
  world.isAliveFlag[pidx] = 0;
  tickDustTypeSwitch(world);

  assert.equal(world.dustSwitchPhase[0], DUST_SWITCH_PHASE_NORMAL);
  assert.equal(world.moteSlotKind[0], ParticleKind.Void);
  assert.equal(world.dustSwitchActiveSlotCount, 0, 'the transition must resolve rather than hang forever');
});

test('trail samples record a smooth pre/post-transform split', () => {
  const { world, player } = makeFixture(1, 5000); // large dt forces a same-tick transform
  const pidx = world.moteSlotParticleIndex[0];
  world.positionXWorld[pidx] = player.positionXWorld - 5;
  world.positionYWorld[pidx] = player.positionYWorld;

  beginDustTypeSwitch(world, ParticleKind.Nature);
  tickDustTypeSwitch(world);

  const cap = 6; // DUST_SWITCH_TRAIL_SAMPLES_PER_SLOT
  const activeCount = world.dustSwitchTrailActiveCount[0];
  assert.ok(activeCount >= 2);
  let sawPre = false;
  let sawPost = false;
  for (let s = 0; s < activeCount; s++) {
    const flag = world.dustSwitchTrailIsPostTransformFlag[s];
    if (flag === 0) sawPre = true;
    if (flag === 1) sawPost = true;
  }
  assert.equal(sawPre, true, 'trail must record at least one pre-transform (source color) sample');
  assert.equal(sawPost, true, 'trail must record at least one post-transform (target color) sample');

  const agesBefore = Array.from({ length: activeCount }, (_, s) => world.dustSwitchTrailAgeTicks[s]);
  tickDustTypeSwitch(world);
  for (let s = 0; s < activeCount; s++) {
    assert.ok(world.dustSwitchTrailAgeTicks[s] >= agesBefore[s], 'trail samples age forward every tick');
  }
  void cap;
});

test('cancelAllDustTypeSwitches resolves every in-progress slot and never desyncs kinds', () => {
  const { world } = makeFixture(4);
  beginDustTypeSwitch(world, ParticleKind.Light);
  tickDustTypeSwitch(world);
  cancelAllDustTypeSwitches(world);

  assert.equal(world.dustSwitchActiveSlotCount, 0);
  for (let slot = 0; slot < world.moteSlotCount; slot++) {
    assert.equal(world.dustSwitchPhase[slot], DUST_SWITCH_PHASE_NORMAL);
    assert.equal(world.moteSlotKind[slot], ParticleKind.Light);
    const pidx = world.moteSlotParticleIndex[slot];
    if (pidx >= 0) {
      assert.equal(world.kindBuffer[pidx], ParticleKind.Light, 'physical and logical kind must never desync');
      assert.notEqual(world.behaviorMode[pidx], BEHAVIOR_MODE_DUST_SWITCH_RECALL);
      assert.notEqual(world.behaviorMode[pidx], BEHAVIOR_MODE_DUST_SWITCH_RETURN);
    }
  }
});
