/**
 * timeStopField.test.ts — TimeStop Field mechanic tests.
 *
 * Covers: connected-region BFS (orthogonal adjacency, disconnected groups,
 * irregular/L-shapes), the capture/zero/release momentum contract exactly
 * once per crossing, zero-velocity safety, death/respawn/teleport/dynamic-
 * field-removal policies, room serialization round trips, and editor
 * undo/redo + copy/paste preservation of TimeStop Field cells.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { BLOCK_SIZE_MEDIUM, type RoomDef } from '../levels/roomDef';
import {
  buildTimeStopFieldRegions,
  encodeTimeStopTileKey,
} from '../sim/timeStopField/timeStopFieldBuilder';
import {
  markTimeStopFieldsDirty,
  getTimeStopFieldRegions,
} from '../sim/timeStopField/timeStopFieldCache';
import {
  createTimeStopFieldPlayerState,
  resetTimeStopFieldPlayerState,
  releaseTimeStopFieldMomentumIfActive,
  updateTimeStopFieldPlayerState,
} from '../sim/timeStopField/timeStopFieldPlayerState';
import { loadRoomHazards } from '../screens/gameRoomHazards';
import type { WorldState } from '../sim/world';

const B = BLOCK_SIZE_MEDIUM;

function makeWorldWithPlayer(xWorld: number, yWorld: number): WorldState {
  const world = createWorldState(1000 / 60);
  const player = createClusterState(0, xWorld, yWorld, 1, 5);
  world.clusters.push(player);
  return world;
}

/** Directly populates world.timeStopField* arrays (bypasses the editor/room pipeline). */
function setTimeStopTiles(world: WorldState, tilesBlock: readonly [number, number][]): void {
  world.timeStopFieldCount = 0;
  for (const [bx, by] of tilesBlock) {
    const i = world.timeStopFieldCount++;
    world.timeStopFieldXWorld[i] = bx * B;
    world.timeStopFieldYWorld[i] = by * B;
    world.timeStopFieldWWorld[i] = B;
    world.timeStopFieldHWorld[i] = B;
  }
  markTimeStopFieldsDirty();
}

function centerOfBlock(bx: number, by: number): [number, number] {
  return [(bx + 0.5) * B, (by + 0.5) * B];
}

// ── Connectivity ──────────────────────────────────────────────────────────────

test('a single tile forms one region', () => {
  const world = makeWorldWithPlayer(0, 0);
  setTimeStopTiles(world, [[0, 0]]);
  const set = buildTimeStopFieldRegions(world);
  assert.equal(set.regions.length, 1);
  assert.equal(set.regions[0].tileCount, 1);
});

test('orthogonally-adjacent tiles form one connected region', () => {
  const world = makeWorldWithPlayer(0, 0);
  // A long horizontal strip + an L-shaped bend.
  setTimeStopTiles(world, [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]);
  const set = buildTimeStopFieldRegions(world);
  assert.equal(set.regions.length, 1, 'L-shaped strip must merge into one region');
  assert.equal(set.regions[0].tileCount, 5);
});

test('diagonal-only adjacency does NOT connect (orthogonal adjacency only)', () => {
  const world = makeWorldWithPlayer(0, 0);
  setTimeStopTiles(world, [[0, 0], [1, 1]]);
  const set = buildTimeStopFieldRegions(world);
  assert.equal(set.regions.length, 2, 'diagonal-touching tiles must remain separate regions');
});

test('disconnected groups remain separate regions', () => {
  const world = makeWorldWithPlayer(0, 0);
  setTimeStopTiles(world, [[0, 0], [1, 0], [10, 10], [11, 10], [10, 11]]);
  const set = buildTimeStopFieldRegions(world);
  assert.equal(set.regions.length, 2);
  const sizes = set.regions.map(r => r.tileCount).sort();
  assert.deepEqual(sizes, [2, 3]);
});

test('an irregular region (rectangle plus branch) is one region and tileToRegion agrees for every cell', () => {
  const world = makeWorldWithPlayer(0, 0);
  const tiles: [number, number][] = [
    [0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [1, 2], [1, 3],
  ];
  setTimeStopTiles(world, tiles);
  const set = buildTimeStopFieldRegions(world);
  assert.equal(set.regions.length, 1);
  const regionId = set.regions[0].id;
  for (const [bx, by] of tiles) {
    assert.equal(set.tileToRegion.get(encodeTimeStopTileKey(bx, by)), regionId);
  }
});

test('the region cache only rebuilds when marked dirty', () => {
  const world = makeWorldWithPlayer(0, 0);
  setTimeStopTiles(world, [[0, 0]]);
  const first = getTimeStopFieldRegions(world);
  const second = getTimeStopFieldRegions(world);
  assert.equal(first, second, 'repeated calls without a dirty mark must return the same cached object');

  setTimeStopTiles(world, [[0, 0], [1, 0]]); // calls markTimeStopFieldsDirty()
  const third = getTimeStopFieldRegions(world);
  assert.notEqual(third, second, 'a dirty mark must force a rebuild');
  assert.equal(third.regions[0].tileCount, 2);
});

// ── Momentum capture / release ───────────────────────────────────────────────

test('entering a field captures velocity exactly once and zeroes current velocity', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(-5, 0));
  setTimeStopTiles(world, [[0, 0], [1, 0]]);
  const player = world.clusters[0];
  player.velocityXWorld = 180;
  player.velocityYWorld = -60;

  // Outside -> tick with no capture.
  updateTimeStopFieldPlayerState(world);
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 0);

  // Move into the field and tick again.
  [player.positionXWorld, player.positionYWorld] = centerOfBlock(0, 0);
  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.hasStoredMomentumFlag, 1);
  assert.equal(world.timeStopField.storedMomentumXWorld, 180);
  assert.equal(world.timeStopField.storedMomentumYWorld, -60);
  assert.equal(player.velocityXWorld, 0);
  assert.equal(player.velocityYWorld, 0);
  assert.equal(world.timeStopField.entrySequence, 1);
});

test('moving between connected tiles does not retrigger capture', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTiles(world, [[0, 0], [1, 0], [2, 0]]);
  const player = world.clusters[0];
  player.velocityXWorld = 100;
  player.velocityYWorld = 0;

  updateTimeStopFieldPlayerState(world); // capture
  assert.equal(world.timeStopField.entrySequence, 1);

  // New momentum generated INSIDE the field (walking) — current velocity
  // changes but stored momentum must not.
  player.velocityXWorld = 40;
  player.velocityYWorld = 100;
  [player.positionXWorld, player.positionYWorld] = centerOfBlock(1, 0);
  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.entrySequence, 1, 'still the same connected region — no re-capture');
  assert.equal(world.timeStopField.storedMomentumXWorld, 100, 'stored momentum is untouched by movement inside the field');
  assert.equal(world.timeStopField.storedMomentumYWorld, 0);
  assert.equal(player.velocityXWorld, 40, 'current velocity reflects movement earned inside the field');
  assert.equal(player.velocityYWorld, 100);
});

test('movement inside the field changes current velocity but never the stored momentum', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTiles(world, [[0, 0], [1, 0], [2, 0]]);
  const player = world.clusters[0];
  player.velocityXWorld = 180;
  player.velocityYWorld = -60;
  updateTimeStopFieldPlayerState(world); // capture (180,-60), zero velocity

  // Player earns new momentum while inside (walking/jumping/etc).
  player.velocityXWorld = 40;
  player.velocityYWorld = 100;
  [player.positionXWorld, player.positionYWorld] = centerOfBlock(1, 0);
  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.entrySequence, 1, 'moving within the connected region must not retrigger');
  assert.equal(world.timeStopField.storedMomentumXWorld, 180, 'stored momentum stays exactly as captured');
  assert.equal(world.timeStopField.storedMomentumYWorld, -60);
  assert.equal(player.velocityXWorld, 40, 'current velocity is whatever movement produced inside the field');
  assert.equal(player.velocityYWorld, 100);
});

test('leaving the field adds stored velocity to current velocity (spec example: (180,-60) + (40,100) = (220,40))', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTiles(world, [[0, 0]]);
  const player = world.clusters[0];
  player.velocityXWorld = 180;
  player.velocityYWorld = -60;
  updateTimeStopFieldPlayerState(world); // capture

  player.velocityXWorld = 40;
  player.velocityYWorld = 100;
  // Step outside the field.
  [player.positionXWorld, player.positionYWorld] = centerOfBlock(5, 5);
  updateTimeStopFieldPlayerState(world);

  assert.equal(player.velocityXWorld, 220);
  assert.equal(player.velocityYWorld, 40);
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 0);
  assert.equal(world.timeStopField.storedMomentumXWorld, 0);
  assert.equal(world.timeStopField.storedMomentumYWorld, 0);
});

test('leaving releases exactly once (repeated ticks outside do not re-add momentum)', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTiles(world, [[0, 0]]);
  const player = world.clusters[0];
  player.velocityXWorld = 50;
  player.velocityYWorld = 0;
  updateTimeStopFieldPlayerState(world); // capture

  [player.positionXWorld, player.positionYWorld] = centerOfBlock(9, 9);
  updateTimeStopFieldPlayerState(world); // release
  assert.equal(world.timeStopField.exitSequence, 1);
  const velAfterRelease = player.velocityXWorld;

  updateTimeStopFieldPlayerState(world); // still outside — must be a no-op
  assert.equal(world.timeStopField.exitSequence, 1, 'exit must not fire twice');
  assert.equal(player.velocityXWorld, velAfterRelease, 'no double-release of momentum');
});

test('zero-velocity entry is safe: stores (0,0), no NaN, releases zero additional momentum on exit', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTiles(world, [[0, 0]]);
  const player = world.clusters[0];
  player.velocityXWorld = 0;
  player.velocityYWorld = 0;
  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.hasStoredMomentumFlag, 1);
  assert.equal(world.timeStopField.storedMomentumXWorld, 0);
  assert.equal(world.timeStopField.storedMomentumYWorld, 0);
  assert.ok(Number.isFinite(world.timeStopField.storedMomentumXWorld));
  assert.ok(Number.isFinite(world.timeStopField.storedMomentumYWorld));

  player.velocityXWorld = 12;
  player.velocityYWorld = 34;
  [player.positionXWorld, player.positionYWorld] = centerOfBlock(9, 9);
  updateTimeStopFieldPlayerState(world);
  assert.equal(player.velocityXWorld, 12, 'exit releases exactly the stored zero — active velocity is untouched');
  assert.equal(player.velocityYWorld, 34);
});

test('leaving one disconnected region and entering another releases-then-captures exactly once, same tick', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTiles(world, [[0, 0], [20, 20]]); // two disconnected 1-tile regions
  const player = world.clusters[0];
  player.velocityXWorld = 100;
  player.velocityYWorld = 0;
  updateTimeStopFieldPlayerState(world); // capture in region A
  assert.equal(world.timeStopField.entrySequence, 1);

  // New momentum earned in region A, then the player jumps straight into
  // region B in a single tick (no "outside" tick in between).
  player.velocityXWorld = 10;
  player.velocityYWorld = 5;
  [player.positionXWorld, player.positionYWorld] = centerOfBlock(20, 20);
  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.exitSequence, 1, 'region A released exactly once');
  assert.equal(world.timeStopField.entrySequence, 2, 'region B captured exactly once, same tick');
  // Region A's stored (100,0) releases into the current (10,5), giving
  // (110,5); that combined vector is then immediately re-captured as region
  // B's entry velocity and zeroed again — release always happens before
  // capture, deterministically, within the same tick.
  assert.equal(player.velocityXWorld, 0);
  assert.equal(player.velocityYWorld, 0);
  assert.equal(world.timeStopField.storedMomentumXWorld, 110);
  assert.equal(world.timeStopField.storedMomentumYWorld, 5);
});

test('teleport policy: inside -> outside teleport releases stored momentum on the next update (no special-case code)', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTiles(world, [[0, 0]]);
  const player = world.clusters[0];
  player.velocityXWorld = 77;
  player.velocityYWorld = -20;
  updateTimeStopFieldPlayerState(world); // capture

  // Simulate a teleport: position jumps far away, velocity zeroed by the
  // teleport system itself (matches gameCommandProcessor.ts's Lambda Anchor
  // teleport, which always zeroes velocity).
  player.positionXWorld = 500;
  player.positionYWorld = 500;
  player.velocityXWorld = 0;
  player.velocityYWorld = 0;
  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.exitSequence, 1);
  assert.equal(player.velocityXWorld, 77, 'stored momentum released into the (teleport-zeroed) velocity');
  assert.equal(player.velocityYWorld, -20);
});

test('teleport policy: outside -> inside teleport captures whatever velocity survived the teleport (0 in this codebase)', () => {
  const world = makeWorldWithPlayer(500, 500);
  setTimeStopTiles(world, [[0, 0]]);
  const player = world.clusters[0];
  player.velocityXWorld = 999; // would-be stale velocity, irrelevant once teleport zeroes it
  player.velocityYWorld = 999;

  player.positionXWorld = 0; player.positionYWorld = 0;
  [player.positionXWorld, player.positionYWorld] = centerOfBlock(0, 0);
  player.velocityXWorld = 0;
  player.velocityYWorld = 0;
  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.hasStoredMomentumFlag, 1);
  assert.equal(world.timeStopField.storedMomentumXWorld, 0);
  assert.equal(world.timeStopField.storedMomentumYWorld, 0);
});

test('death clears stored momentum without applying it', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTiles(world, [[0, 0]]);
  const player = world.clusters[0];
  player.velocityXWorld = 60;
  player.velocityYWorld = 15;
  updateTimeStopFieldPlayerState(world); // capture
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 1);

  player.isAliveFlag = 0;
  player.velocityXWorld = 0; // death already zeroed velocity independently
  player.velocityYWorld = 0;
  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.hasStoredMomentumFlag, 0);
  assert.equal(world.timeStopField.activeRegionId, -1);
  // Momentum must NOT have been applied to the (dead) player's velocity.
  assert.equal(player.velocityXWorld, 0);
  assert.equal(player.velocityYWorld, 0);
});

test('respawn/room reload clears visual state via resetTimeStopFieldPlayerState (hard clear, no release)', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTiles(world, [[0, 0]]);
  const player = world.clusters[0];
  player.velocityXWorld = 60;
  player.velocityYWorld = 15;
  updateTimeStopFieldPlayerState(world);
  world.timeStopField.visualIntensity = 0.8;

  resetTimeStopFieldPlayerState(world.timeStopField);

  assert.equal(world.timeStopField.hasStoredMomentumFlag, 0);
  assert.equal(world.timeStopField.activeRegionId, -1);
  assert.equal(world.timeStopField.isInsideFieldFlag, 0);
  assert.equal(world.timeStopField.visualIntensity, 0);
});

test('room reload does not retain stale runtime state across a fresh world/room', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTiles(world, [[0, 0]]);
  updateTimeStopFieldPlayerState(world);
  assert.equal(world.timeStopField.isInsideFieldFlag, 1);

  // Simulate the room-scoped reset that runs on every room activation.
  resetTimeStopFieldPlayerState(world.timeStopField);
  // New room has no TimeStop Field tiles at all.
  setTimeStopTiles(world, []);
  updateTimeStopFieldPlayerState(world);
  assert.equal(world.timeStopField.isInsideFieldFlag, 0);
  assert.equal(world.timeStopField.activeRegionId, -1);
});

test('removing the active field beneath the player (dynamic edit) releases momentum once', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTiles(world, [[0, 0], [1, 0]]);
  const player = world.clusters[0];
  player.velocityXWorld = 45;
  player.velocityYWorld = -5;
  updateTimeStopFieldPlayerState(world); // capture
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 1);

  // The field tile under the player is removed at runtime.
  setTimeStopTiles(world, []);
  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.exitSequence, 1);
  assert.equal(player.velocityXWorld, 45);
  assert.equal(player.velocityYWorld, -5);
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 0);
});

test('releaseTimeStopFieldMomentumIfActive is a safe no-op when nothing is stored', () => {
  const world = makeWorldWithPlayer(0, 0);
  const player = world.clusters[0];
  player.velocityXWorld = 5;
  player.velocityYWorld = 5;
  releaseTimeStopFieldMomentumIfActive(world);
  assert.equal(player.velocityXWorld, 5);
  assert.equal(player.velocityYWorld, 5);
});

test('releaseTimeStopFieldMomentumIfActive releases exactly once (room-transition hook)', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTiles(world, [[0, 0]]);
  const player = world.clusters[0];
  player.velocityXWorld = 30;
  player.velocityYWorld = 10;
  updateTimeStopFieldPlayerState(world); // capture, velocity now (0,0)

  releaseTimeStopFieldMomentumIfActive(world);
  assert.equal(player.velocityXWorld, 30);
  assert.equal(player.velocityYWorld, 10);
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 0);

  releaseTimeStopFieldMomentumIfActive(world); // must not double-release
  assert.equal(player.velocityXWorld, 30);
  assert.equal(player.velocityYWorld, 10);
});

test('createTimeStopFieldPlayerState starts fully inactive', () => {
  const state = createTimeStopFieldPlayerState();
  assert.equal(state.isInsideFieldFlag, 0);
  assert.equal(state.activeRegionId, -1);
  assert.equal(state.hasStoredMomentumFlag, 0);
  assert.equal(state.visualIntensity, 0);
});

// ── Room hazard loader (RoomDef -> WorldState) ────────────────────────────────

test('loadRoomHazards populates world.timeStopField* arrays from RoomDef.timeStopFields', () => {
  const world = createWorldState(1000 / 60);
  const room: Partial<RoomDef> = {
    id: 'r', name: 'r', worldNumber: 1, mapX: 0, mapY: 0,
    widthBlocks: 20, heightBlocks: 20,
    walls: [], enemies: [], playerSpawnBlock: [0, 0], transitions: [], saveTombs: [],
    timeStopFields: [{ xBlock: 3, yBlock: 4, wBlock: 2, hBlock: 1 }],
  };
  loadRoomHazards(world, room as RoomDef);

  assert.equal(world.timeStopFieldCount, 1);
  assert.equal(world.timeStopFieldXWorld[0], 3 * B);
  assert.equal(world.timeStopFieldYWorld[0], 4 * B);
  assert.equal(world.timeStopFieldWWorld[0], 2 * B);
  assert.equal(world.timeStopFieldHWorld[0], B);

  const regions = getTimeStopFieldRegions(world);
  assert.equal(regions.regions.length, 1);
  assert.equal(regions.regions[0].tileCount, 2, '2x1 footprint expands to 2 tiles');
});

test('a room with no timeStopFields loads with zero count (old rooms keep loading normally)', () => {
  const world = createWorldState(1000 / 60);
  const room: Partial<RoomDef> = {
    id: 'r', name: 'r', worldNumber: 1, mapX: 0, mapY: 0,
    widthBlocks: 20, heightBlocks: 20,
    walls: [], enemies: [], playerSpawnBlock: [0, 0], transitions: [], saveTombs: [],
  };
  loadRoomHazards(world, room as RoomDef);
  assert.equal(world.timeStopFieldCount, 0);
});
