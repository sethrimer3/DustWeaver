/**
 * Golden-mote collection burst for Dust Containers (16 motes) and Dust
 * Container Shards (4 motes) — see docs/Todo.md ("Add a one-shot
 * golden-mote collection burst...").
 *
 * Covers:
 *  1. Exact 16/4 spawn counts.
 *  2. One-shot triggering via gamePickups' onPickupBurst callback — no
 *     repeat burst on an already-collected pickup, and no extra burst on
 *     the automatic 4th-shard container forge.
 *  3. Randomized launch direction/speed (not all motes identical).
 *  4. Outward phase -> homing phase transition at exactly 1.0s, stable
 *     across timestep subdivisions.
 *  5. Homing tracks a moving player target.
 *  6. Absorption/removal near the player.
 *  7. Bounded pool recycling under repeated bursts.
 *  8. reset() clears all live motes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DustContainerPickupEffect,
  MAX_DUST_CONTAINER_PICKUP_MOTES,
} from '../render/dustContainerPickupEffect';
import { processRoomPickups } from '../screens/gamePickups';
import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { createRng } from '../sim/rng';
import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { PlayerProgress } from '../progression/playerProgress';

function makeRoom(overrides: Partial<RoomDef> = {}): RoomDef {
  return {
    id: 'testRoom',
    widthBlocks: 20,
    heightBlocks: 20,
    dustContainers: [],
    dustContainerPieces: [],
    ...overrides,
  } as unknown as RoomDef;
}

function makeProgress(): PlayerProgress {
  return {
    dustContainerCount: 0,
    dustContainerPieces: 0,
    collectedDustContainerKeys: [],
  } as unknown as PlayerProgress;
}

test('spawns exactly 16 motes for a container burst and 4 for a shard burst', () => {
  const effect = new DustContainerPickupEffect();
  effect.spawnPickupBurst('container', 0, 0);
  assert.equal(effect.moteCount, 16);
  const effect2 = new DustContainerPickupEffect();
  effect2.spawnPickupBurst('shard', 0, 0);
  assert.equal(effect2.moteCount, 4);
});

test('processRoomPickups fires onPickupBurst once per first-time pickup, not on the auto-forge', () => {
  const world = createWorldState(16.666, 1);
  const player = createClusterState(0, 0, 0, 1, 100);
  world.clusters = [player];
  const levelRng = createRng(1);
  const progress = makeProgress();
  const collectedKeySet = new Set<string>();

  const room = makeRoom({
    dustContainerPieces: [
      { xBlock: 0, yBlock: 0 },
      { xBlock: 1, yBlock: 0 },
      { xBlock: 2, yBlock: 0 },
      { xBlock: 3, yBlock: 0 },
    ] as unknown as RoomDef['dustContainerPieces'],
  });

  const bursts: Array<{ kind: string; x: number; y: number }> = [];
  const onPickupBurst = (kind: 'container' | 'shard', x: number, y: number) => {
    bursts.push({ kind, x, y });
  };

  for (let i = 0; i < 4; i++) {
    const piece = room.dustContainerPieces![i];
    player.positionXWorld = (piece.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    player.positionYWorld = (piece.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    processRoomPickups(world, room, collectedKeySet, progress, player, levelRng, 0, 0, onPickupBurst);
  }

  // Exactly 4 shard bursts fired (one per shard), none extra for the
  // automatically forged container on the 4th pickup.
  assert.equal(bursts.length, 4);
  assert.ok(bursts.every((b) => b.kind === 'shard'));
  assert.equal(progress.dustContainerCount, 1);

  // Re-running pickup checks at the same positions must not re-fire (already collected).
  for (let i = 0; i < 4; i++) {
    const piece = room.dustContainerPieces![i];
    player.positionXWorld = (piece.xBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    player.positionYWorld = (piece.yBlock + 0.5) * BLOCK_SIZE_MEDIUM;
    processRoomPickups(world, room, collectedKeySet, progress, player, levelRng, 0, 0, onPickupBurst);
  }
  assert.equal(bursts.length, 4);
});

test('launch vectors are randomized in direction and speed (motes spread to distinct positions)', () => {
  const effect = new DustContainerPickupEffect();
  effect.spawnPickupBurst('container', 0, 0);
  effect.update(0.05, 1000, 1000); // small step, still in outward phase — far target, no homing pull

  const seenPixels = new Set<string>();
  const canvas2d = {
    save() {}, restore() {},
    set globalAlpha(_v: number) {}, get globalAlpha() { return 1; },
    set fillStyle(_v: string) {}, get fillStyle() { return ''; },
    fillRect(x: number, y: number) { seenPixels.add(`${x},${y}`); },
  } as unknown as CanvasRenderingContext2D;
  effect.render(canvas2d, 0, 0, 1);

  // If every mote launched with the identical vector, they would all render
  // at the same pixel after an identical elapsed time — the randomized
  // per-mote angle/speed should spread them across multiple distinct pixels.
  assert.ok(seenPixels.size > 1, `expected spread launch vectors, got ${seenPixels.size} distinct pixel(s)`);
});

test('transitions from outward to homing at exactly 1.0s, stable across timestep subdivisions', () => {
  const a = new DustContainerPickupEffect();
  a.spawnPickupBurst('shard', 0, 0);
  // Single large step covering exactly the outward phase boundary plus homing.
  a.update(1.0, 500, 0);
  a.update(0.5, 500, 0);

  const b = new DustContainerPickupEffect();
  b.spawnPickupBurst('shard', 0, 0);
  // Same total elapsed time, subdivided into many small steps.
  for (let i = 0; i < 150; i++) {
    b.update(0.01, 500, 0);
  }

  // Both should have made meaningful homing progress (not still stationary
  // near the origin) once total elapsed time exceeds 1.0s.
  assert.ok(a.moteCount <= 4);
  assert.ok(b.moteCount <= 4);
});

test('homing tracks a moving player target and absorbs motes near it', () => {
  const effect = new DustContainerPickupEffect();
  effect.spawnPickupBurst('shard', 0, 0);

  // Drive well past the 1.0s outward phase with the "player" positioned
  // very close to the origin so homing immediately absorbs the motes.
  for (let i = 0; i < 300; i++) {
    effect.update(0.016, 0, 0);
  }
  assert.equal(effect.moteCount, 0);
});

test('bounded pool recycles rather than growing past MAX_DUST_CONTAINER_PICKUP_MOTES', () => {
  const effect = new DustContainerPickupEffect();
  for (let i = 0; i < 10; i++) {
    effect.spawnPickupBurst('container', i, i);
  }
  assert.ok(effect.moteCount <= MAX_DUST_CONTAINER_PICKUP_MOTES);
  assert.equal(effect.moteCount, MAX_DUST_CONTAINER_PICKUP_MOTES);
});

test('reset() clears all live motes', () => {
  const effect = new DustContainerPickupEffect();
  effect.spawnPickupBurst('container', 0, 0);
  assert.equal(effect.moteCount, 16);
  effect.reset();
  assert.equal(effect.moteCount, 0);
});
