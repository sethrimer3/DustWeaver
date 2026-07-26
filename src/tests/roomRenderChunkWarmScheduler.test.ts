/**
 * Tests for render chunk prewarm scheduling and memory management
 * (src/screens/roomRenderChunkWarmScheduler.ts).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { RoomDef, RoomTransitionDef, TransitionDirection } from '../levels/roomDef';
import {
  scheduleChunkPrewarms,
  evictStalePrewarmedChunks,
  runChunkPrewarmSliceNow,
  getPrewarmStats,
} from '../screens/roomRenderChunkWarmScheduler';
import {
  getOrCreatePrewarmWallCache,
  hasPrewarmedWallChunks,
} from '../render/walls/wallChunkPrewarmStore';
import { clearAllRenderSnapshots } from '../render/walls/roomRenderCacheStore';
import { RoomRuntimeCache } from '../screens/roomRuntimeCache';

function tx(direction: TransitionDirection, targetRoomId: string): RoomTransitionDef {
  return {
    direction,
    targetRoomId,
    xBlock: 0,
    yBlock: 0,
    positionBlock: 0,
    openingSizeBlocks: 4,
    targetSpawnBlock: [0, 0],
  };
}

function room(id: string, transitions: RoomTransitionDef[] = []): RoomDef {
  return {
    id,
    name: id,
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    widthBlocks: 40,
    heightBlocks: 20,
    walls: [],
    enemies: [],
    playerSpawnBlock: [1, 1],
    transitions,
    saveTombs: [],
  } as unknown as RoomDef;
}

test('evictStalePrewarmedChunks drops rooms outside keepSet while preserving active room', () => {
  clearAllRenderSnapshots();
  const room0 = room('room0');
  const room1 = room('room1');
  const room2 = room('room2');
  const registry = new Map<string, RoomDef>([
    ['room0', room0],
    ['room1', room1],
    ['room2', room2],
  ]);
  const runtimeCache = new RoomRuntimeCache();
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  try {
    getOrCreatePrewarmWallCache('room0', 'key0').stats.totalChunkCount = 1;
    getOrCreatePrewarmWallCache('room1', 'key1').stats.totalChunkCount = 1;
    getOrCreatePrewarmWallCache('room2', 'key2').stats.totalChunkCount = 1;

    assert.equal(hasPrewarmedWallChunks('room0'), true);
    assert.equal(hasPrewarmedWallChunks('room1'), true);
    assert.equal(hasPrewarmedWallChunks('room2'), true);

    evictStalePrewarmedChunks(new Set(['room1']), 'high');

    assert.equal(hasPrewarmedWallChunks('room0'), true, 'Current active room should never be evicted');
    assert.equal(hasPrewarmedWallChunks('room1'), true, 'Kept neighbor room should not be evicted');
    assert.equal(hasPrewarmedWallChunks('room2'), false, 'Stale room outside keep set should be evicted');
  } catch (e) {
    console.error('Test 1 failure:', e);
    throw e;
  } finally {
    handle.cancel();
    clearAllRenderSnapshots();
  }
});

test('evictStalePrewarmedChunks enforces memory budget by evicting highest radius first', () => {
  clearAllRenderSnapshots();
  const room3 = room('room3', []);
  const room2 = room('room2', [tx('east', 'room3')]);
  const room1 = room('room1', [tx('east', 'room2')]);
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0],
    ['room1', room1],
    ['room2', room2],
    ['room3', room3],
  ]);
  const runtimeCache = new RoomRuntimeCache();
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'low', () => 10, 800, 600, 1);
  try {
    getOrCreatePrewarmWallCache('room1', 'key1').stats.memoryEstimateKB = 2000;
    getOrCreatePrewarmWallCache('room2', 'key2').stats.memoryEstimateKB = 2000;
    getOrCreatePrewarmWallCache('room3', 'key3').stats.memoryEstimateKB = 2000;

    evictStalePrewarmedChunks(new Set(['room0', 'room1', 'room2', 'room3']), 'low');

    assert.equal(hasPrewarmedWallChunks('room3'), false, 'Radius-3 room should be evicted first under memory cap');
    assert.equal(hasPrewarmedWallChunks('room2'), true, 'Radius-2 room should survive once under budget');
    assert.equal(hasPrewarmedWallChunks('room1'), true, 'Radius-1 room should survive once under budget');
  } catch (e) {
    console.error('Test 2 failure:', e);
    throw e;
  } finally {
    handle.cancel();
    clearAllRenderSnapshots();
  }
});

test('evictStalePrewarmedChunks evicts largest memory footprint first within same radius', () => {
  clearAllRenderSnapshots();
  const room2A = room('room2A', []);
  const room2B = room('room2B', []);
  const room1 = room('room1', [tx('north', 'room2A'), tx('south', 'room2B')]);
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0],
    ['room1', room1],
    ['room2A', room2A],
    ['room2B', room2B],
  ]);
  const runtimeCache = new RoomRuntimeCache();
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'low', () => 10, 800, 600, 1);
  try {
    getOrCreatePrewarmWallCache('room1', 'key1').stats.memoryEstimateKB = 1500;
    getOrCreatePrewarmWallCache('room2A', 'key2A').stats.memoryEstimateKB = 3000;
    getOrCreatePrewarmWallCache('room2B', 'key2B').stats.memoryEstimateKB = 1000;

    evictStalePrewarmedChunks(new Set(['room0', 'room1', 'room2A', 'room2B']), 'low');

    assert.equal(hasPrewarmedWallChunks('room2A'), false, 'Larger memory candidate within same radius should be evicted first');
    assert.equal(hasPrewarmedWallChunks('room2B'), true, 'Smaller memory candidate should survive once under budget');
    assert.equal(hasPrewarmedWallChunks('room1'), true, 'Lower radius room should survive');
  } catch (e) {
    console.error('Test 3 failure:', e);
    throw e;
  } finally {
    handle.cancel();
    clearAllRenderSnapshots();
  }
});

test('adaptive radius-3 chunk warming discards radius-3 tasks when frame time is poor', () => {
  clearAllRenderSnapshots();
  const room3 = room('room3', []);
  const room2 = room('room2', [tx('east', 'room3')]);
  const room1 = room('room1', [tx('east', 'room2')]);
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0],
    ['room1', room1],
    ['room2', room2],
    ['room3', room3],
  ]);
  const runtimeCache = new RoomRuntimeCache();

  let handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  try {
    runChunkPrewarmSliceNow(50);
    assert.equal(getPrewarmStats().pausedForFrameTime, false);
    assert.equal(getPrewarmStats().queueLength, 3, 'Radius-3 room should remain queued when frame time is stable');
  } catch (e) {
    console.error('Test 4A failure:', e);
    throw e;
  } finally {
    handle.cancel();
  }

  handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => 30, 800, 600, 1);
  try {
    runChunkPrewarmSliceNow(50);
    assert.equal(getPrewarmStats().pausedForFrameTime, true, 'pausedForFrameTime should be true when frame time > 20ms');
    assert.equal(getPrewarmStats().queueLength, 2, 'Radius-3 room should be discarded from queue during poor frame time');
  } catch (e) {
    console.error('Test 4B failure:', e);
    throw e;
  } finally {
    handle.cancel();
  }

  handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'med', () => 10, 800, 600, 1);
  try {
    runChunkPrewarmSliceNow(50);
    assert.equal(getPrewarmStats().queueLength, 2, 'Radius-3 room should be discarded from queue on med quality');
  } catch (e) {
    console.error('Test 4C failure:', e);
    throw e;
  } finally {
    handle.cancel();
    clearAllRenderSnapshots();
  }
});
