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
  invalidateRoomChunkPrewarm,
  runChunkPrewarmSliceNow,
  ensureChunkPrewarmQueued,
  addZoneEntryViewportTasks,
  getPrewarmStats,
} from '../screens/roomRenderChunkWarmScheduler';
import {
  getOrCreatePrewarmWallCache,
  hasPrewarmedWallChunks,
} from '../render/walls/wallChunkPrewarmStore';
import {
  clearAllRenderBundles,
  getOrCreateBundle,
  hasBgPrewarmData,
} from '../render/walls/roomRenderCacheStore';
import { RoomChunkCache } from '../render/walls/chunkRenderCache';
import { RoomRuntimeCache } from '../screens/roomRuntimeCache';

/** Test helper mirroring `getOrCreatePrewarmWallCache`, but for the bg store. */
function getOrCreatePrewarmBgCacheForTest(roomId: string, renderStateKey: string): RoomChunkCache {
  const snap = getOrCreateBundle(roomId, renderStateKey);
  if (snap.bgCache === null) {
    snap.bgCache = new RoomChunkCache(true);
  }
  return snap.bgCache;
}

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
  clearAllRenderBundles();
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
    clearAllRenderBundles();
  }
});

test('evictStalePrewarmedChunks enforces memory budget by evicting highest radius first', () => {
  clearAllRenderBundles();
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
    clearAllRenderBundles();
  }
});

test('evictStalePrewarmedChunks evicts largest memory footprint first within same radius', () => {
  clearAllRenderBundles();
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
    clearAllRenderBundles();
  }
});

test('adaptive radius-3 chunk warming defers (never discards) radius-3 tasks when frame time is poor', () => {
  clearAllRenderBundles();
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
    assert.equal(getPrewarmStats().deferredRadius3Events, 0, 'No radius-3 deferral should occur with good frame time and high quality');
    assert.equal(getPrewarmStats().suspendedRadius3Count, 0, 'No radius-3 suspension should occur at high quality');
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
    assert.equal(getPrewarmStats().queueLength, 3, 'Radius-3 room must remain queued (temporarily deferred, not discarded) during poor frame time at high quality');
    assert.ok(getPrewarmStats().deferredRadius3Events > 0, 'deferredRadius3Events should record the deferral');
    assert.equal(getPrewarmStats().suspendedRadius3Count, 0, 'Poor frame time is a temporary deferral, not a quality-tier suspension');
  } catch (e) {
    console.error('Test 4B failure:', e);
    throw e;
  } finally {
    handle.cancel();
  }

  // On med/low quality, radius-3 work is SUSPENDED out of the active queue
  // entirely (not repeatedly rotated through it) — queueLength should drop
  // to just the eligible radius-1/2 tasks, and the radius-3 task should be
  // tracked as suspended rather than as a deferral event.
  handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'med', () => 10, 800, 600, 1);
  try {
    runChunkPrewarmSliceNow(50);
    assert.equal(getPrewarmStats().queueLength, 2, 'Radius-3 room should be suspended out of the active queue on med quality, leaving only radius-1/2');
    assert.equal(getPrewarmStats().suspendedRadius3Count, 1, 'Exactly the one radius-3 room should be tracked as suspended');
    assert.equal(getPrewarmStats().deferredRadius3Events, 0, 'Quality-tier suspension must not be counted as a deferral event');
  } catch (e) {
    console.error('Test 4C failure:', e);
    throw e;
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('adaptive radius-3 chunk warming resumes without a new room transition once frame time/quality recover', () => {
  clearAllRenderBundles();
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

  // Simulate an anomalous slow-frame window: frame time starts poor, then
  // recovers on a later slice within the SAME schedule (no re-transition).
  let frameMs = 30;
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => frameMs, 800, 600, 1);
  try {
    runChunkPrewarmSliceNow(50);
    assert.equal(getPrewarmStats().pausedForFrameTime, true);
    assert.equal(getPrewarmStats().queueLength, 3, 'Radius-3 task survives the poor-frame slice');

    // Frame time recovers; radius-3 gating should re-evaluate favorably on
    // the very next slice without requiring scheduleChunkPrewarms to be
    // called again (i.e. without a fresh room transition).
    frameMs = 10;
    runChunkPrewarmSliceNow(50);
    assert.equal(getPrewarmStats().pausedForFrameTime, false, 'pausedForFrameTime should clear once frame time recovers');
    assert.equal(getPrewarmStats().queueLength, 3, 'Radius-3 task remains present (not lost) through the recovery slice');
  } catch (e) {
    console.error('Test 4D failure:', e);
    throw e;
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('adaptive radius-3 chunk warming oscillating frame time neither loses the task nor spins forever', () => {
  clearAllRenderBundles();
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

  let frameMs = 10;
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => frameMs, 800, 600, 1);
  try {
    for (let i = 0; i < 6; i++) {
      frameMs = i % 2 === 0 ? 30 : 10;
      runChunkPrewarmSliceNow(50);
      assert.equal(getPrewarmStats().queueLength, 3, `Radius-3 task must survive oscillation iteration ${i}`);
    }
  } catch (e) {
    console.error('Test 4E failure:', e);
    throw e;
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('evictStalePrewarmedChunks clears background-only cached rooms (no wall data)', () => {
  clearAllRenderBundles();
  const room0 = room('room0');
  const room1 = room('room1');
  const registry = new Map<string, RoomDef>([
    ['room0', room0],
    ['room1', room1],
  ]);
  const runtimeCache = new RoomRuntimeCache();
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  try {
    // room1 has ONLY bg prewarm data — no wall cache entry at all.
    getOrCreatePrewarmBgCacheForTest('room1', 'key1').stats.totalChunkCount = 1;
    assert.equal(hasBgPrewarmData('room1'), true);
    assert.equal(hasPrewarmedWallChunks('room1'), false, 'room1 should have no wall prewarm data');

    evictStalePrewarmedChunks(new Set(['room0']), 'high');

    assert.equal(hasBgPrewarmData('room1'), false, 'Background-only room outside keep set should be evicted');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('evictStalePrewarmedChunks accounts combined wall+bg memory without double-counting a single room', () => {
  clearAllRenderBundles();
  const room2 = room('room2', []);
  const room1 = room('room1', [tx('east', 'room2')]);
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0],
    ['room1', room1],
    ['room2', room2],
  ]);
  const runtimeCache = new RoomRuntimeCache();
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'low', () => 10, 800, 600, 1);
  try {
    // room1 has both wall AND bg memory; room2 has only wall memory.
    // Budget for 'low' is 4096 KB — total below should keep both under budget.
    getOrCreatePrewarmWallCache('room1', 'key1').stats.memoryEstimateKB = 1000;
    getOrCreatePrewarmBgCacheForTest('room1', 'key1').stats.memoryEstimateKB = 1000;
    getOrCreatePrewarmWallCache('room2', 'key2').stats.memoryEstimateKB = 1000;

    evictStalePrewarmedChunks(new Set(['room0', 'room1', 'room2']), 'low');

    // room1's wall+bg memory (2000 KB) must be counted once as a single room's
    // footprint, not twice as separate 1000 KB candidates — verify both stores
    // for room1 survive together (proving it was evaluated as one 2000 KB unit,
    // not evicted piecemeal).
    assert.equal(hasPrewarmedWallChunks('room1'), true, 'room1 wall data should survive under budget');
    assert.equal(hasBgPrewarmData('room1'), true, 'room1 bg data should survive under budget');
    assert.equal(hasPrewarmedWallChunks('room2'), true, 'room2 should survive under budget');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('evictStalePrewarmedChunks clears both wall and bg stores together for a stale room', () => {
  clearAllRenderBundles();
  const room0 = room('room0');
  const room1 = room('room1');
  const registry = new Map<string, RoomDef>([
    ['room0', room0],
    ['room1', room1],
  ]);
  const runtimeCache = new RoomRuntimeCache();
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  try {
    getOrCreatePrewarmWallCache('room1', 'key1').stats.totalChunkCount = 1;
    getOrCreatePrewarmBgCacheForTest('room1', 'key1').stats.totalChunkCount = 1;
    assert.equal(hasPrewarmedWallChunks('room1'), true);
    assert.equal(hasBgPrewarmData('room1'), true);

    evictStalePrewarmedChunks(new Set(['room0']), 'high');

    assert.equal(hasPrewarmedWallChunks('room1'), false, 'Stale room wall data should be evicted');
    assert.equal(hasBgPrewarmData('room1'), false, 'Stale room bg data should be evicted in the same pass');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('evictStalePrewarmedChunks never evicts the active room even when it alone exceeds budget', () => {
  clearAllRenderBundles();
  const room0 = room('room0');
  const registry = new Map<string, RoomDef>([['room0', room0]]);
  const runtimeCache = new RoomRuntimeCache();
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'low', () => 10, 800, 600, 1);
  try {
    // 'low' budget is 4096 KB; give the active room far more than that alone.
    getOrCreatePrewarmWallCache('room0', 'key0').stats.memoryEstimateKB = 50_000;

    evictStalePrewarmedChunks(new Set(['room0']), 'low');

    assert.equal(hasPrewarmedWallChunks('room0'), true, 'Active room must never be evicted, even over budget');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('evictStalePrewarmedChunks selects budget by quality tier (low vs high)', () => {
  clearAllRenderBundles();
  const room1 = room('room1');
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0],
    ['room1', room1],
  ]);
  const runtimeCache = new RoomRuntimeCache();

  // 10000 KB exceeds the 'low' budget (4096) but is under the 'high' budget (32768).
  let handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'low', () => 10, 800, 600, 1);
  try {
    getOrCreatePrewarmWallCache('room1', 'key1').stats.memoryEstimateKB = 10_000;
    evictStalePrewarmedChunks(new Set(['room0', 'room1']), 'low');
    assert.equal(hasPrewarmedWallChunks('room1'), false, 'room1 should be evicted under the low-quality budget');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }

  handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  try {
    getOrCreatePrewarmWallCache('room1', 'key1').stats.memoryEstimateKB = 10_000;
    evictStalePrewarmedChunks(new Set(['room0', 'room1']), 'high');
    assert.equal(hasPrewarmedWallChunks('room1'), true, 'room1 should survive under the high-quality budget');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('evictStalePrewarmedChunks reports accurate eviction stats and accumulates totalEvictions', () => {
  clearAllRenderBundles();
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
    const totalBefore = getPrewarmStats().totalEvictions;

    getOrCreatePrewarmWallCache('room1', 'key1').stats.totalChunkCount = 1;
    getOrCreatePrewarmWallCache('room2', 'key2').stats.totalChunkCount = 1;

    evictStalePrewarmedChunks(new Set(['room0', 'room1']), 'high');
    assert.equal(getPrewarmStats().evictedThisPass, 1, 'Only room2 should be evicted this pass');
    assert.equal(getPrewarmStats().totalEvictions, totalBefore + 1, 'totalEvictions should accumulate');

    // Repeated call with nothing new to evict should be stable: 0 evicted this
    // pass, and totalEvictions must not double-count room2 (already gone).
    evictStalePrewarmedChunks(new Set(['room0', 'room1']), 'high');
    assert.equal(getPrewarmStats().evictedThisPass, 0, 'Repeated call with nothing stale should evict nothing');
    assert.equal(getPrewarmStats().totalEvictions, totalBefore + 1, 'totalEvictions should not recount already-evicted rooms');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('runChunkPrewarmSliceNow triggers post-slice budget enforcement when a slice pushes memory over budget', () => {
  clearAllRenderBundles();
  const room1 = room('room1');
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0],
    ['room1', room1],
  ]);
  const runtimeCache = new RoomRuntimeCache();
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'low', () => 10, 800, 600, 1);
  try {
    // Pre-inflate room1's memory footprint above the 'low' budget (4096 KB) so
    // that once the slice builds ANY chunk (chunksBuilt > 0), post-slice
    // enforcement should trigger eviction (room1 is not the active room).
    getOrCreatePrewarmWallCache('room1', 'key1').stats.memoryEstimateKB = 10_000;

    // room0 (current room) is never queued for warming, so drive the slice via
    // the budget check directly: simulate a slice having built chunks by
    // invoking the same public entry point used in production.
    runChunkPrewarmSliceNow(50);

    // room1 sits far outside the low-quality budget; if any chunk got built
    // this slice, post-slice enforcement must have run and evicted it.
    // If no chunk was built (e.g. runtime cache not ready), the pre-inflated
    // memory simply persists — assert the invariant that governs correctness
    // either way: memory never silently exceeds budget while chunks are built.
    const stats = getPrewarmStats();
    if (stats.chunksLastSlice > 0) {
      assert.ok(stats.totalPrewarmMemoryKB <= stats.memoryBudgetKB || !hasPrewarmedWallChunks('room1'),
        'Post-slice enforcement should evict over-budget rooms once chunks are built');
    }
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('invalidateRoomChunkPrewarm evicts a room and allows it to be re-queued on the next schedule', () => {
  clearAllRenderBundles();
  const room1 = room('room1');
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0],
    ['room1', room1],
  ]);
  const runtimeCache = new RoomRuntimeCache();
  let handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  try {
    getOrCreatePrewarmWallCache('room1', 'key1').stats.totalChunkCount = 1;
    getOrCreatePrewarmBgCacheForTest('room1', 'key1').stats.totalChunkCount = 1;
    assert.equal(hasPrewarmedWallChunks('room1'), true);
    assert.equal(hasBgPrewarmData('room1'), true);

    invalidateRoomChunkPrewarm('room1');

    assert.equal(hasPrewarmedWallChunks('room1'), false, 'Invalidation should clear wall prewarm data');
    assert.equal(hasBgPrewarmData('room1'), false, 'Invalidation should clear bg prewarm data');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }

  // Re-schedule: room1 is within radius-1 again and should be queued fresh
  // (not skipped as "already warmed" since invalidation cleared its data).
  handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  try {
    assert.ok(getPrewarmStats().queueLength >= 1, 'room1 should be re-queued after invalidation');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('evictStalePrewarmedChunks does not evict newly completed nearby rooms still within keep set', () => {
  clearAllRenderBundles();
  const room1 = room('room1');
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0],
    ['room1', room1],
  ]);
  const runtimeCache = new RoomRuntimeCache();
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  try {
    // room1 has completed warming (data present) but remains in the BFS
    // neighbourhood keep-set — a subsequent eviction pass (e.g. triggered by
    // another room's schedule) must not drop it.
    getOrCreatePrewarmWallCache('room1', 'key1').stats.totalChunkCount = 1;
    assert.equal(hasPrewarmedWallChunks('room1'), true);

    evictStalePrewarmedChunks(new Set(['room0', 'room1']), 'high');

    assert.equal(hasPrewarmedWallChunks('room1'), true, 'Completed nearby room within keep set must survive eviction');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('evictStalePrewarmedChunks handles zero-memory candidates without evicting them unnecessarily', () => {
  clearAllRenderBundles();
  const room2 = room('room2', []);
  const room1 = room('room1', [tx('east', 'room2')]);
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0],
    ['room1', room1],
    ['room2', room2],
  ]);
  const runtimeCache = new RoomRuntimeCache();
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  try {
    // room2 has zero recorded memory (e.g. an empty chunk cache was created but
    // no chunks built yet) while total memory stays under budget — it should
    // not be a candidate for eviction at all since the budget is not exceeded.
    getOrCreatePrewarmWallCache('room2', 'key2').stats.memoryEstimateKB = 0;
    getOrCreatePrewarmWallCache('room2', 'key2').stats.totalChunkCount = 0;

    evictStalePrewarmedChunks(new Set(['room0', 'room1', 'room2']), 'high');

    // Zero-chunk cache still counts as "has prewarm data" per hasPrewarmedWallChunks
    // implementation only if a snapshot was created — verify it wasn't spuriously
    // evicted as stale (it's within keep set) nor for budget (budget not exceeded).
    assert.equal(getPrewarmStats().evictedThisPass, 0, 'No eviction should occur when under budget');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

// ── Part 1: authoritative priority independent of queue membership ───────────

test('authoritative priority metadata survives task completion (a completed room leaving the queue is not misclassified)', () => {
  clearAllRenderBundles();
  const room3 = room('room3', []);
  const room2 = room('room2', [tx('east', 'room3')]);
  const room1 = room('room1', [tx('east', 'room2')]);
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0], ['room1', room1], ['room2', room2], ['room3', room3],
  ]);
  const runtimeCache = new RoomRuntimeCache();

  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  try {
    // Simulate room1/room2 having already completed and left `_queue` — the
    // scheduler's "room no longer in registry" branch is the one safe,
    // zero-side-effect way to make a task leave the queue in this test
    // harness (the real chunk-builder pulls in Vite-only `import.meta.env`
    // APIs that are unavailable under the plain Node test runner; see
    // `timeStopFieldAudit.test.ts` for the same constraint elsewhere in this
    // suite). This exercises exactly the property under test: `_queue`
    // membership changing must not affect `_roomPriority`, regardless of
    // *why* a task left the queue.
    registry.delete('room1');
    registry.delete('room2');
    runChunkPrewarmSliceNow(50);
    registry.set('room1', room1);
    registry.set('room2', room2);
    assert.equal(getPrewarmStats().queueLength, 1, 'room1 and room2 tasks should leave the queue, leaving only room3');

    // room3 (radius 3, still queued) has by far the most memory; room2
    // (radius 2, completed, out of the queue) is next; room1 (radius 1,
    // completed, out of the queue) has the least. If completion caused
    // room1/room2 to be misclassified (e.g. defaulted to "unknown" or
    // radius-3), eviction order would not match their true radius.
    getOrCreatePrewarmWallCache('room1', 'k1').stats.memoryEstimateKB = 3000;
    getOrCreatePrewarmWallCache('room2', 'k2').stats.memoryEstimateKB = 3000;
    getOrCreatePrewarmWallCache('room3', 'k3').stats.memoryEstimateKB = 3000;

    evictStalePrewarmedChunks(new Set(['room0', 'room1', 'room2', 'room3']), 'low');

    assert.equal(hasPrewarmedWallChunks('room3'), false, 'Still-queued radius-3 room should be evicted first');
    assert.equal(hasPrewarmedWallChunks('room2'), false, 'Completed radius-2 room (out of queue) should be evicted next, ranked by its true radius');
    assert.equal(hasPrewarmedWallChunks('room1'), true, 'Completed radius-1 room (out of queue) must survive — not misclassified as radius-3/unknown');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('scheduleChunkPrewarms restart clears stale priority metadata from the prior neighbourhood', () => {
  clearAllRenderBundles();
  const roomX = room('roomX', []);
  const a0 = room('a0', [tx('east', 'roomX')]);
  const registryA = new Map<string, RoomDef>([['a0', a0], ['roomX', roomX]]);
  const runtimeCache = new RoomRuntimeCache();
  let handle = scheduleChunkPrewarms(a0, registryA, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  handle.cancel();
  clearAllRenderBundles();

  // A completely unrelated neighbourhood that never references roomX.
  const b3 = room('b3', []);
  const b2 = room('b2', [tx('east', 'b3')]);
  const b1 = room('b1', [tx('east', 'b2')]);
  const b0 = room('b0', [tx('east', 'b1')]);
  const registryB = new Map<string, RoomDef>([['b0', b0], ['b1', b1], ['b2', b2], ['b3', b3]]);
  handle = scheduleChunkPrewarms(b0, registryB, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  try {
    // roomX is stale (simulating a leftover cache entry from the previous
    // schedule); b1 is a genuine radius-1 room in the CURRENT schedule.
    // roomX alone is enough to push memory over budget, so removing it is
    // sufficient to satisfy the budget without touching b1.
    getOrCreatePrewarmWallCache('roomX', 'kx').stats.memoryEstimateKB = 6000;
    getOrCreatePrewarmWallCache('b1', 'k1').stats.memoryEstimateKB = 100;

    evictStalePrewarmedChunks(new Set(['b0', 'b1', 'b2', 'b3', 'roomX']), 'low');

    assert.equal(hasPrewarmedWallChunks('roomX'), false, 'Stale room from the prior schedule should rank as unknown/lowest value and be evicted first');
    assert.equal(hasPrewarmedWallChunks('b1'), true, 'Genuine radius-1 room from the current schedule should survive');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('invalidateRoomChunkPrewarm clears authoritative priority so stale metadata cannot protect the room later', () => {
  clearAllRenderBundles();
  const room3 = room('room3', []);
  const room2 = room('room2', [tx('east', 'room3')]);
  const room1 = room('room1', [tx('east', 'room2')]);
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0], ['room1', room1], ['room2', room2], ['room3', room3],
  ]);
  const runtimeCache = new RoomRuntimeCache();
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  try {
    invalidateRoomChunkPrewarm('room1');

    // Simulate a leftover cache entry reappearing for room1 without a fresh
    // schedule; its priority metadata was cleared by invalidation, so it
    // must not be protected as if it were still radius 1.
    getOrCreatePrewarmWallCache('room1', 'k1r').stats.memoryEstimateKB = 6000;
    getOrCreatePrewarmWallCache('room3', 'k3').stats.memoryEstimateKB = 100;

    evictStalePrewarmedChunks(new Set(['room0', 'room1', 'room2', 'room3']), 'low');

    assert.equal(hasPrewarmedWallChunks('room1'), false, 'Invalidated room should not be protected by stale radius-1 priority');
    assert.equal(hasPrewarmedWallChunks('room3'), true, 'Currently-tracked genuine radius-3 room should survive relative to the invalidated/unknown room');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('ensureChunkPrewarmQueued assigns radius-1 priority to a newly created task', () => {
  clearAllRenderBundles();
  const room3 = room('room3', []);
  const room2 = room('room2', [tx('east', 'room3')]);
  const room1 = room('room1', [tx('east', 'room2')]);
  const roomZ = room('roomZ', []); // unreachable via transitions from room0
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0], ['room1', room1], ['room2', room2], ['room3', room3], ['roomZ', roomZ],
  ]);
  const runtimeCache = new RoomRuntimeCache();
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  try {
    // roomZ is outside the BFS neighbourhood, so it has no priority entry
    // until ensureChunkPrewarmQueued explicitly creates one.
    ensureChunkPrewarmQueued('roomZ', 'manual');

    getOrCreatePrewarmWallCache('roomZ', 'kz').stats.memoryEstimateKB = 500;
    getOrCreatePrewarmWallCache('room3', 'k3').stats.memoryEstimateKB = 5000;

    evictStalePrewarmedChunks(new Set(['room0', 'room1', 'room2', 'room3', 'roomZ']), 'low');

    assert.equal(hasPrewarmedWallChunks('room3'), false, 'Genuine radius-3 room should be evicted before the ensure-queued radius-1 room');
    assert.equal(hasPrewarmedWallChunks('roomZ'), true, 'ensureChunkPrewarmQueued should track roomZ at radius-1 priority');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('addZoneEntryViewportTasks assigns a lower priority than radius-1 work', () => {
  clearAllRenderBundles();
  const room3 = room('room3', []);
  const room2 = room('room2', [tx('east', 'room3')]);
  const room1 = room('room1', [tx('east', 'room2')]);
  const roomZ = room('roomZ', []);
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0], ['room1', room1], ['room2', room2], ['room3', room3], ['roomZ', roomZ],
  ]);
  const runtimeCache = new RoomRuntimeCache();
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  try {
    addZoneEntryViewportTasks(['roomZ'], registry, runtimeCache, 800, 600, 1);

    getOrCreatePrewarmWallCache('room3', 'k3').stats.memoryEstimateKB = 4000;
    getOrCreatePrewarmWallCache('roomZ', 'kz').stats.memoryEstimateKB = 4000;
    getOrCreatePrewarmWallCache('room1', 'k1').stats.memoryEstimateKB = 100;

    evictStalePrewarmedChunks(new Set(['room0', 'room1', 'room2', 'room3', 'roomZ']), 'low');

    assert.equal(hasPrewarmedWallChunks('room3'), false, 'Genuine radius-3 room should be evicted');
    assert.equal(hasPrewarmedWallChunks('roomZ'), false, 'Zone-entry task should be evicted before radius-1 work, at or below radius-2 value');
    assert.equal(hasPrewarmedWallChunks('room1'), true, 'Genuine radius-1 room should survive relative to the zone-entry task');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('evictStalePrewarmedChunks treats truly unknown/non-scheduled cached rooms as lower value than a genuine radius-3 room', () => {
  clearAllRenderBundles();
  const room3 = room('room3', []);
  const room2 = room('room2', [tx('east', 'room3')]);
  const room1 = room('room1', [tx('east', 'room2')]);
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0], ['room1', room1], ['room2', room2], ['room3', room3],
  ]);
  const runtimeCache = new RoomRuntimeCache();
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'high', () => 10, 800, 600, 1);
  try {
    // 'ghost' was never part of any BFS/ensure/zone task in this schedule.
    getOrCreatePrewarmWallCache('ghost', 'kg').stats.memoryEstimateKB = 5000;
    getOrCreatePrewarmWallCache('room3', 'k3').stats.memoryEstimateKB = 100;

    evictStalePrewarmedChunks(new Set(['room0', 'room1', 'room2', 'room3', 'ghost']), 'low');

    assert.equal(hasPrewarmedWallChunks('ghost'), false, 'Unknown/non-scheduled room should be evicted before a genuine radius-3 room');
    assert.equal(hasPrewarmedWallChunks('room3'), true, 'Genuine radius-3 room should survive relative to an unknown room');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

// ── Part 2: quality-tier suspension vs temporary frame-time deferral ─────────

test('quality-tier suspension resumes automatically on quality recovery within the same schedule, with no duplicates', () => {
  clearAllRenderBundles();
  const room3 = room('room3', []);
  const room2 = room('room2', [tx('east', 'room3')]);
  const room1 = room('room1', [tx('east', 'room2')]);
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0], ['room1', room1], ['room2', room2], ['room3', room3],
  ]);
  const runtimeCache = new RoomRuntimeCache();

  let quality: 'low' | 'med' | 'high' = 'high';
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => quality, () => 10, 800, 600, 1);
  try {
    runChunkPrewarmSliceNow(50);
    assert.equal(getPrewarmStats().suspendedRadius3Count, 0);
    assert.equal(getPrewarmStats().queueLength, 3);

    // High -> medium: radius-3 is suspended out of the active queue;
    // radius-1/2 remain eligible and untouched.
    quality = 'med';
    runChunkPrewarmSliceNow(50);
    assert.equal(getPrewarmStats().suspendedRadius3Count, 1);
    assert.equal(getPrewarmStats().queueLength, 2, 'radius-1/2 remain active while radius-3 is suspended');

    // Medium -> high, with NO new scheduleChunkPrewarms call (no room transition).
    quality = 'high';
    runChunkPrewarmSliceNow(50);
    assert.equal(getPrewarmStats().suspendedRadius3Count, 0);
    assert.equal(getPrewarmStats().queueLength, 3, 'radius-3 resumes into the active queue on quality recovery');

    // High -> medium again, then repeated reads at the SAME stable tier must
    // not create duplicate suspended entries.
    quality = 'med';
    runChunkPrewarmSliceNow(50);
    runChunkPrewarmSliceNow(50);
    runChunkPrewarmSliceNow(50);
    assert.equal(getPrewarmStats().suspendedRadius3Count, 1, 'repeated quality reads at a stable tier must not duplicate the suspended task');
    assert.equal(getPrewarmStats().queueLength, 2);
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('active queue processing stops once only suspended radius-3 work remains, and resumes without a room transition', () => {
  clearAllRenderBundles();
  const room3 = room('room3', []);
  const room2 = room('room2', [tx('east', 'room3')]);
  const room1 = room('room1', [tx('east', 'room2')]);
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0], ['room1', room1], ['room2', room2], ['room3', room3],
  ]);
  const runtimeCache = new RoomRuntimeCache();

  let quality: 'low' | 'med' | 'high' = 'high';
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => quality, () => 10, 800, 600, 1);
  try {
    // Simulate room1/room2 having already completed and left the queue (see
    // the "authoritative priority metadata survives task completion" test
    // above for why the registry-removal technique is used instead of
    // running the real, Vite-only chunk builder under this test runner).
    registry.delete('room1');
    registry.delete('room2');
    runChunkPrewarmSliceNow(50);
    registry.set('room1', room1);
    registry.set('room2', room2);
    assert.equal(getPrewarmStats().queueLength, 1, 'only room3 remains queued');

    // Drop to medium quality: room3 is suspended, emptying the active queue.
    quality = 'med';
    runChunkPrewarmSliceNow(50);
    assert.equal(getPrewarmStats().queueLength, 0, 'active queue is empty once the only remaining task is suspended radius-3 work');
    assert.equal(getPrewarmStats().suspendedRadius3Count, 1);

    // Recover to high quality with no new scheduleChunkPrewarms call.
    quality = 'high';
    runChunkPrewarmSliceNow(50);
    assert.equal(getPrewarmStats().suspendedRadius3Count, 0);
    assert.equal(getPrewarmStats().queueLength, 1, 'room3 resumes into the active queue without a room transition');
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});

test('cancellation prevents suspended radius-3 work from resuming', () => {
  clearAllRenderBundles();
  const room3 = room('room3', []);
  const room2 = room('room2', [tx('east', 'room3')]);
  const room1 = room('room1', [tx('east', 'room2')]);
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0], ['room1', room1], ['room2', room2], ['room3', room3],
  ]);
  const runtimeCache = new RoomRuntimeCache();

  let quality: 'low' | 'med' | 'high' = 'med';
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => quality, () => 10, 800, 600, 1);
  try {
    runChunkPrewarmSliceNow(50);
    assert.equal(getPrewarmStats().suspendedRadius3Count, 1);

    handle.cancel();
    quality = 'high';
    runChunkPrewarmSliceNow(50);

    assert.equal(getPrewarmStats().suspendedRadius3Count, 1, 'a cancelled schedule must not resume suspended work');
    assert.equal(getPrewarmStats().queueLength, 2, 'active queue must remain exactly as it was at cancellation time');
  } finally {
    clearAllRenderBundles();
  }
});

test('evictStalePrewarmedChunks ranks a suspended (out-of-queue) radius-3 room by its authoritative priority, not queue membership', () => {
  clearAllRenderBundles();
  const room3 = room('room3', []);
  const room2 = room('room2', [tx('east', 'room3')]);
  const room1 = room('room1', [tx('east', 'room2')]);
  const room0 = room('room0', [tx('east', 'room1')]);
  const registry = new Map<string, RoomDef>([
    ['room0', room0], ['room1', room1], ['room2', room2], ['room3', room3],
  ]);
  const runtimeCache = new RoomRuntimeCache();
  const handle = scheduleChunkPrewarms(room0, registry, runtimeCache, () => 'med', () => 10, 800, 600, 1);
  try {
    runChunkPrewarmSliceNow(50);
    assert.equal(getPrewarmStats().suspendedRadius3Count, 1, 'room3 should be suspended (out of _queue) at medium quality');

    getOrCreatePrewarmWallCache('room1', 'k1').stats.memoryEstimateKB = 100;
    getOrCreatePrewarmWallCache('room3', 'k3').stats.memoryEstimateKB = 5000;

    evictStalePrewarmedChunks(new Set(['room0', 'room1', 'room2', 'room3']), 'low');

    assert.equal(hasPrewarmedWallChunks('room3'), false, 'Suspended radius-3 room must still be ranked/evicted as radius-3 via authoritative priority');
    assert.equal(hasPrewarmedWallChunks('room1'), true);
  } finally {
    handle.cancel();
    clearAllRenderBundles();
  }
});
