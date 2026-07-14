import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { createDefaultProgress } from '../progression/playerProgress';
import {
  applySkillTombActivation,
  type SkillTombActivationPorts,
} from '../screens/gameSkillTombActivation';
import { createClusterState } from '../sim/clusters/state';
import { getElementProfile } from '../sim/particles/elementProfiles';
import { ParticleKind } from '../sim/particles/kinds';
import { createWorldState, type WorldState } from '../sim/world';

function createWorldWithPlayer(
  entityId = 17,
  positionXWorld = 130,
  positionYWorld = 91,
  maxHealthPoints = 20,
): WorldState {
  const world = createWorldState(16.666);
  const player = createClusterState(
    entityId,
    positionXWorld,
    positionYWorld,
    1,
    maxHealthPoints,
  );
  player.healthPoints = 4;
  world.clusters.push(player);
  return world;
}

function createPorts(
  overrides: Partial<SkillTombActivationPorts> = {},
): SkillTombActivationPorts {
  return {
    getCurrentRoomOrigin: () => [100, 50],
    getCurrentRoomId: () => 'room-a',
    getNearbyTombIndex: () => 0,
    getTombPosition: () => ({ xWorld: 20, yWorld: 28 }),
    ...overrides,
  };
}

describe('applySkillTombActivation — lookup and save policy', () => {
  it('returns zeros and performs no port calls or mutations without cluster zero', () => {
    const world = createWorldState(16.666);
    world.particleCount = 1;
    world.respawnDelayTicks[0] = 8;
    const progress = createDefaultProgress();
    const calls: string[] = [];
    const ports = createPorts({
      getCurrentRoomOrigin: () => { calls.push('origin'); return [0, 0]; },
      getCurrentRoomId: () => { calls.push('room'); return 'room-a'; },
      getNearbyTombIndex: () => { calls.push('nearby'); return 0; },
      getTombPosition: () => { calls.push('position'); return { xWorld: 0, yWorld: 0 }; },
      onCheckpointReached: () => { calls.push('checkpoint'); },
      onSave: () => { calls.push('save'); },
    });

    assert.deepEqual(applySkillTombActivation(world, progress, ports), {
      playerXWorld: 0,
      playerYWorld: 0,
      playerHealthPoints: 0,
      playerMaxHealthPoints: 0,
    });
    assert.deepEqual(calls, []);
    assert.equal(world.respawnDelayTicks[0], 8);
    assert.equal(progress.lastSaveRoomId, null);
  });

  it('selects cluster zero even when a later cluster is marked as the player', () => {
    const world = createWorldState(16.666);
    const first = createClusterState(4, 30, 40, 0, 12);
    const laterPlayer = createClusterState(5, 300, 400, 1, 30);
    first.healthPoints = 2;
    laterPlayer.healthPoints = 3;
    world.clusters.push(first, laterPlayer);
    const lookupInputs: number[] = [];

    const result = applySkillTombActivation(world, createDefaultProgress(), createPorts({
      getCurrentRoomOrigin: () => [10, 15],
      getNearbyTombIndex: (x, y) => { lookupInputs.push(x, y); return -1; },
    }));

    assert.deepEqual(lookupInputs, [20, 25]);
    assert.equal(result.playerXWorld, 30);
    assert.equal(first.healthPoints, 12);
    assert.equal(laterPlayer.healthPoints, 3);
  });

  it('returns absolute position and passes exact room-local coordinates to lookup', () => {
    const world = createWorldWithPlayer(17, 137.5, 83.25);
    const lookupInputs: number[] = [];
    const result = applySkillTombActivation(world, createDefaultProgress(), createPorts({
      getCurrentRoomOrigin: () => [101.25, -9.5],
      getNearbyTombIndex: (x, y) => { lookupInputs.push(x, y); return -1; },
    }));

    assert.deepEqual(lookupInputs, [36.25, 92.75]);
    assert.equal(result.playerXWorld, 137.5);
    assert.equal(result.playerYWorld, 83.25);
  });

  it('skips position and save work for a negative nearby index but still heals', () => {
    const world = createWorldWithPlayer();
    const calls: string[] = [];
    const progress = createDefaultProgress();
    const result = applySkillTombActivation(world, progress, createPorts({
      getNearbyTombIndex: () => -1,
      getTombPosition: () => { calls.push('position'); return null; },
      getCurrentRoomId: () => { calls.push('room'); return 'room-a'; },
      onCheckpointReached: () => { calls.push('checkpoint'); },
      onSave: () => { calls.push('save'); },
    }));

    assert.deepEqual(calls, []);
    assert.equal(progress.lastSaveRoomId, null);
    assert.equal(world.clusters[0].healthPoints, 20);
    assert.equal(result.playerHealthPoints, 20);
  });

  it('skips save work for a null tomb position but still heals', () => {
    const world = createWorldWithPlayer();
    const calls: string[] = [];
    const progress = createDefaultProgress();
    applySkillTombActivation(world, progress, createPorts({
      getNearbyTombIndex: () => 3,
      getTombPosition: (index) => { calls.push(`position:${index}`); return null; },
      getCurrentRoomId: () => { calls.push('room'); return 'room-a'; },
      onCheckpointReached: () => { calls.push('checkpoint'); },
      onSave: () => { calls.push('save'); },
    }));

    assert.deepEqual(calls, ['position:3']);
    assert.equal(progress.lastSaveRoomId, null);
    assert.equal(world.clusters[0].healthPoints, 20);
  });

  it('writes room ID and independently rounded fractional tomb coordinates', () => {
    const world = createWorldWithPlayer();
    const progress = createDefaultProgress();
    applySkillTombActivation(world, progress, createPorts({
      getCurrentRoomId: () => 'fraction-room',
      getTombPosition: () => ({
        xWorld: 2.49 * BLOCK_SIZE_MEDIUM,
        yWorld: -1.5 * BLOCK_SIZE_MEDIUM,
      }),
    }));

    assert.equal(progress.lastSaveRoomId, 'fraction-room');
    assert.deepEqual(progress.lastSaveSpawnBlock, [2, -1]);
  });

  it('writes progress before checkpoint, checkpoint before save, and saves before healing', () => {
    const world = createWorldWithPlayer();
    const player = world.clusters[0];
    const progress = createDefaultProgress();
    const calls: string[] = [];
    const assertWritesBeforeHealing = (label: string): void => {
      assert.equal(progress.lastSaveRoomId, 'ordered-room');
      assert.deepEqual(progress.lastSaveSpawnBlock, [3, 4]);
      assert.equal(player.healthPoints, 4);
      calls.push(label);
    };

    applySkillTombActivation(world, progress, createPorts({
      getCurrentRoomId: () => { calls.push('room'); return 'ordered-room'; },
      getTombPosition: () => { calls.push('position'); return { xWorld: 24, yWorld: 32 }; },
      onCheckpointReached: () => { assertWritesBeforeHealing('checkpoint'); },
      onSave: () => { assertWritesBeforeHealing('save'); },
    }));

    assert.deepEqual(calls, ['position', 'room', 'checkpoint', 'save']);
    assert.equal(player.healthPoints, 20);
  });

  it('allows progress writes and healing when optional callbacks are absent', () => {
    const world = createWorldWithPlayer();
    const progress = createDefaultProgress();
    applySkillTombActivation(world, progress, createPorts());
    assert.equal(progress.lastSaveRoomId, 'room-a');
    assert.deepEqual(progress.lastSaveSpawnBlock, [3, 4]);
    assert.equal(world.clusters[0].healthPoints, 20);
  });

  it('propagates checkpoint failure and prevents save and healing', () => {
    const world = createWorldWithPlayer();
    const calls: string[] = [];
    const failure = new Error('checkpoint failed');
    assert.throws(() => applySkillTombActivation(world, createDefaultProgress(), createPorts({
      onCheckpointReached: () => { calls.push('checkpoint'); throw failure; },
      onSave: () => { calls.push('save'); },
    })), (error) => error === failure);
    assert.deepEqual(calls, ['checkpoint']);
    assert.equal(world.clusters[0].healthPoints, 4);
  });

  it('propagates save failure and prevents healing', () => {
    const world = createWorldWithPlayer();
    const failure = new Error('save failed');
    assert.throws(() => applySkillTombActivation(world, createDefaultProgress(), createPorts({
      onSave: () => { throw failure; },
    })), (error) => error === failure);
    assert.equal(world.clusters[0].healthPoints, 4);
  });
});

describe('applySkillTombActivation — healing policy', () => {
  it('heals the player exactly to max and returns matching health values', () => {
    const world = createWorldWithPlayer(17, 8, 9, 37);
    const result = applySkillTombActivation(world, createDefaultProgress(), createPorts({
      getNearbyTombIndex: () => -1,
    }));
    assert.equal(world.clusters[0].healthPoints, 37);
    assert.equal(result.playerHealthPoints, 37);
    assert.equal(result.playerMaxHealthPoints, 37);
  });

  it('restores owned alive non-transient durability by exact kind without changing delay', () => {
    const world = createWorldWithPlayer();
    world.particleCount = 2;
    for (let index = 0; index < 2; index++) {
      world.ownerEntityId[index] = 17;
      world.isAliveFlag[index] = 1;
      world.particleDurability[index] = -4;
      world.respawnDelayTicks[index] = 9 + index;
    }
    world.kindBuffer[0] = ParticleKind.Fire;
    world.kindBuffer[1] = ParticleKind.Crystal;

    applySkillTombActivation(world, createDefaultProgress(), createPorts({
      getNearbyTombIndex: () => -1,
    }));

    assert.equal(world.particleDurability[0], getElementProfile(ParticleKind.Fire).toughness);
    assert.equal(world.particleDurability[1], getElementProfile(ParticleKind.Crystal).toughness);
    assert.deepEqual(Array.from(world.respawnDelayTicks.slice(0, 2)), [9, 10]);
  });

  it('shortens only positive delays for owned dead non-transient particles', () => {
    const world = createWorldWithPlayer();
    world.particleCount = 2;
    world.ownerEntityId[0] = 17;
    world.ownerEntityId[1] = 17;
    world.respawnDelayTicks[0] = 12;
    world.respawnDelayTicks[1] = 0;
    world.particleDurability[0] = 3;
    world.particleDurability[1] = 4;

    applySkillTombActivation(world, createDefaultProgress(), createPorts({
      getNearbyTombIndex: () => -1,
    }));

    assert.equal(world.respawnDelayTicks[0], 1);
    assert.equal(world.respawnDelayTicks[1], 0);
    assert.deepEqual(Array.from(world.particleDurability.slice(0, 2)), [3, 4]);
  });

  it('leaves owned transient and foreign particles unchanged', () => {
    const world = createWorldWithPlayer();
    world.particleCount = 3;
    world.ownerEntityId[0] = 17;
    world.ownerEntityId[1] = 17;
    world.ownerEntityId[2] = 999;
    world.isTransientFlag[0] = 1;
    world.isTransientFlag[1] = 1;
    world.isAliveFlag[0] = 0;
    world.isAliveFlag[1] = 1;
    world.isAliveFlag[2] = 1;
    world.respawnDelayTicks[0] = 11;
    world.particleDurability[1] = 12;
    world.particleDurability[2] = 13;

    applySkillTombActivation(world, createDefaultProgress(), createPorts({
      getNearbyTombIndex: () => -1,
    }));

    assert.equal(world.respawnDelayTicks[0], 11);
    assert.equal(world.particleDurability[1], 12);
    assert.equal(world.particleDurability[2], 13);
  });

  it('does not visit backing-buffer indices at or above particleCount', () => {
    const world = createWorldWithPlayer();
    world.particleCount = 1;
    world.ownerEntityId[0] = 17;
    world.ownerEntityId[1] = 17;
    world.isAliveFlag[0] = 0;
    world.isAliveFlag[1] = 0;
    world.respawnDelayTicks[0] = 8;
    world.respawnDelayTicks[1] = 9;

    applySkillTombActivation(world, createDefaultProgress(), createPorts({
      getNearbyTombIndex: () => -1,
    }));

    assert.equal(world.respawnDelayTicks[0], 1);
    assert.equal(world.respawnDelayTicks[1], 9);
  });
});

describe('applySkillTombActivation — mutation and ownership boundaries', () => {
  it('leaves unrelated cluster, world-buffer, and progress fields unchanged', () => {
    const world = createWorldWithPlayer();
    const player = world.clusters[0];
    const progress = createDefaultProgress();
    player.velocityXWorld = 7;
    player.isGroundedFlag = 1;
    world.tick = 123;
    world.positionXWorld[4] = 44;
    progress.characterId = 'demonFox';
    progress.dustContainerCount = 5;

    applySkillTombActivation(world, progress, createPorts({ getNearbyTombIndex: () => -1 }));

    assert.equal(player.velocityXWorld, 7);
    assert.equal(player.isGroundedFlag, 1);
    assert.equal(world.tick, 123);
    assert.equal(world.positionXWorld[4], 44);
    assert.equal(progress.characterId, 'demonFox');
    assert.equal(progress.dustContainerCount, 5);
  });

  it('does not mutate lookup inputs or the returned tomb-position object', () => {
    const world = createWorldWithPlayer();
    const origin = Object.freeze([100, 50] as const);
    const tombPosition = Object.freeze({ xWorld: 20, yWorld: 28 });
    const lookupInputs: number[] = [];
    assert.doesNotThrow(() => applySkillTombActivation(world, createDefaultProgress(), createPorts({
      getCurrentRoomOrigin: () => origin,
      getNearbyTombIndex: (x, y) => { lookupInputs.push(x, y); return 2; },
      getTombPosition: () => tombPosition,
    })));
    assert.deepEqual(origin, [100, 50]);
    assert.deepEqual(tombPosition, { xWorld: 20, yWorld: 28 });
    assert.deepEqual(lookupInputs, [30, 41]);
  });

  it('uses supplied worlds independently without retaining prior-world state', () => {
    const firstWorld = createWorldWithPlayer(1, 10, 20, 11);
    const secondWorld = createWorldWithPlayer(2, 200, 300, 22);
    const firstResult = applySkillTombActivation(
      firstWorld,
      createDefaultProgress(),
      createPorts({ getNearbyTombIndex: () => -1 }),
    );
    const secondResult = applySkillTombActivation(
      secondWorld,
      createDefaultProgress(),
      createPorts({ getNearbyTombIndex: () => -1 }),
    );

    assert.deepEqual(firstResult, {
      playerXWorld: 10,
      playerYWorld: 20,
      playerHealthPoints: 11,
      playerMaxHealthPoints: 11,
    });
    assert.deepEqual(secondResult, {
      playerXWorld: 200,
      playerYWorld: 300,
      playerHealthPoints: 22,
      playerMaxHealthPoints: 22,
    });
    assert.equal(firstWorld.clusters[0].healthPoints, 11);
    assert.equal(secondWorld.clusters[0].healthPoints, 22);
  });
});
