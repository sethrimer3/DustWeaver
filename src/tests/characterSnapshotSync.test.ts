import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createWorldState } from '../sim/world';
import {
  createReusableSnapshot,
  updateSnapshotInPlace,
  resetReusableSnapshot,
  createSnapshot
} from '../render/snapshot';

describe('characterSnapshotSync', () => {

  test('Initial allocating snapshot synchronizes characterId', () => {
    const world = createWorldState(16.6, 42);
    world.characterId = 'outcast';

    const snapshot = createSnapshot(world);
    assert.equal(snapshot.characterId, 'outcast', 'Allocating snapshot should adopt world characterId');
  });

  test('Reusable snapshot update correctly syncs characterId (former bug)', () => {
    // Initial creation happens while the world defaults to knight
    const world = createWorldState(16.6, 42);
    const snapshot = createReusableSnapshot(world);
    assert.equal(snapshot.characterId, 'knight', 'Snapshot defaults to knight at creation');

    // Simulate official campaign room load overwriting the world id
    world.characterId = 'outcast';
    updateSnapshotInPlace(snapshot, world);

    // This assertion would fail before the bug fix because updateSnapshotInPlace didn't copy characterId
    assert.equal(snapshot.characterId, 'outcast', 'Reusable snapshot must follow the world characterId after update');
  });

  test('Replacement-world room-swap path synchronizes characterId', () => {
    // Initial world & snapshot
    const world = createWorldState(16.6, 42);
    const snapshot = createReusableSnapshot(world);
    assert.equal(snapshot.characterId, 'knight');

    // Replacement world
    const replacementWorld = createWorldState(16.6, 99);
    replacementWorld.characterId = 'outcast';

    resetReusableSnapshot(snapshot, replacementWorld);

    assert.equal(snapshot.characterId, 'outcast', 'resetReusableSnapshot must synchronize characterId from replacement world');
  });

  test('Repeated updates synchronize characterId', () => {
    const world = createWorldState(16.6, 42);
    const snapshot = createReusableSnapshot(world);

    world.characterId = 'outcast';
    updateSnapshotInPlace(snapshot, world);
    assert.equal(snapshot.characterId, 'outcast');

    world.characterId = 'knight';
    updateSnapshotInPlace(snapshot, world);
    assert.equal(snapshot.characterId, 'knight');

    world.characterId = 'outcast';
    updateSnapshotInPlace(snapshot, world);
    assert.equal(snapshot.characterId, 'outcast');
  });

});
