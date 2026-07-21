/**
 * timeStopFieldAudit.test.ts — Regression tests from a rigorous correctness
 * audit of the TimeStop Field implementation.
 *
 * Each test here corresponds to a specific defect found by tracing the full
 * lifecycle (editor placement → room load → region build → entry → movement
 * → exit → death/respawn/teleport/room-transition cleanup) rather than
 * testing each function in isolation. See the audit report for full
 * findings; this file locks in the fixes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorldState, type WorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import {
  markTimeStopFieldsDirty,
  getTimeStopFieldRegions,
} from '../sim/timeStopField/timeStopFieldCache';
import {
  resetTimeStopFieldPlayerState,
  releaseTimeStopFieldMomentumIfActive,
  updateTimeStopFieldPlayerState,
} from '../sim/timeStopField/timeStopFieldPlayerState';
import { GRAPPLE_ZIP_SPEED_WORLD_PER_SEC } from '../sim/clusters/grappleZip';

const B = BLOCK_SIZE_MEDIUM;

function makeWorldWithPlayer(xWorld: number, yWorld: number): WorldState {
  const world = createWorldState(1000 / 60);
  const player = createClusterState(0, xWorld, yWorld, 1, 5);
  world.clusters.push(player);
  return world;
}

function setTimeStopTilesFromPairs(world: WorldState, tilesBlock: readonly [number, number][]): void {
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

// ── CRITICAL: room-transition release must not fire every frame ────────────
//
// The actual wiring fix (moving the release call out of gameScreen.ts's
// unconditional per-frame block and into orchestrateRoomTransitions' actual
// transition-fire callback in gameRoomTransitionOrchestrator.ts) cannot be
// exercised here: that module's import chain pulls in
// levels/packedCampaignLoader.ts, which reads `import.meta.env.BASE_URL` /
// `import.meta.glob` — Vite-only APIs that throw under plain Node (this
// project's test runner, see package.json's `test` script). No existing
// test in this suite imports gameScreen.ts or gameRoomTransitionOrchestrator.ts
// for the same reason. The regression is instead locked in at the unit level
// below (releaseTimeStopFieldMomentumIfActive's own idempotency), and the
// wiring itself was manually verified by code inspection — see the audit
// report's "requires manual/environment confirmation" section.

test('releaseTimeStopFieldMomentumIfActive is idempotent under repeated calls with no intervening state change (simulates a per-frame call site)', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(5, 5));
  setTimeStopTilesFromPairs(world, [[5, 5]]);
  const player = world.clusters[0];
  player.velocityXWorld = 123;
  player.velocityYWorld = 45;
  updateTimeStopFieldPlayerState(world); // capture — hasStoredMomentumFlag = 1
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 1);

  // A correct call site must only invoke this at the moment of an actual
  // transition. This test proves the function itself does not need
  // "already released" guarding beyond its documented no-op contract — the
  // regression this audit fixed was in WHERE gameScreen.ts called it
  // (every frame) rather than in this function's own behavior.
  releaseTimeStopFieldMomentumIfActive(world);
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 0);
  assert.equal(player.velocityXWorld, 123);
  const vxAfterFirstRelease = player.velocityXWorld;

  for (let i = 0; i < 5; i++) releaseTimeStopFieldMomentumIfActive(world);
  assert.equal(player.velocityXWorld, vxAfterFirstRelease, 'repeated calls after release must never re-add momentum');
});

// ── CRITICAL: region-id stability across a cache rebuild ────────────────────

test('CRITICAL: an incidental region-cache rebuild while occupying an unchanged field rebinds silently (no false exit/entry)', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTilesFromPairs(world, [[0, 0], [1, 0]]);
  const player = world.clusters[0];
  player.velocityXWorld = 88;
  player.velocityYWorld = -12;
  updateTimeStopFieldPlayerState(world); // capture
  assert.equal(world.timeStopField.entrySequence, 1);

  // Force a cache rebuild with the SAME physical tiles (simulating a
  // rebuild triggered for an unrelated reason — e.g. a future dynamic-edit
  // path — without the tile set actually changing). BFS Set-iteration order
  // means a fresh rebuild can legally assign different array indices to the
  // same physical region.
  markTimeStopFieldsDirty();
  getTimeStopFieldRegions(world);

  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.entrySequence, 1, 'rebind must not count as a new entry');
  assert.equal(world.timeStopField.exitSequence, 0, 'rebind must not count as an exit');
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 1, 'stored momentum must survive the rebuild');
  assert.equal(world.timeStopField.storedMomentumXWorld, 88);
  assert.equal(world.timeStopField.storedMomentumYWorld, -12);
  assert.equal(world.timeStopField.isInsideFieldFlag, 1);
});

test('a rebuild that removes the tile beneath the player still releases exactly once (real removal, not a relabel)', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTilesFromPairs(world, [[0, 0]]);
  const player = world.clusters[0];
  player.velocityXWorld = 40;
  player.velocityYWorld = 10;
  updateTimeStopFieldPlayerState(world);
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 1);

  // Genuine removal: the tile the player stands on no longer exists.
  setTimeStopTilesFromPairs(world, []);
  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.exitSequence, 1);
  assert.equal(player.velocityXWorld, 40);
  assert.equal(player.velocityYWorld, 10);
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 0);
});

test('merging two regions (bridge cell added) while occupying one of them does not trigger a false exit/entry', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  // Two disconnected regions, one tile apart.
  setTimeStopTilesFromPairs(world, [[0, 0], [2, 0]]);
  let regions = getTimeStopFieldRegions(world);
  assert.equal(regions.regions.length, 2);

  const player = world.clusters[0];
  player.velocityXWorld = 60;
  player.velocityYWorld = 0;
  updateTimeStopFieldPlayerState(world); // capture in the region containing (0,0)
  assert.equal(world.timeStopField.entrySequence, 1);

  // Add the bridge cell at (1,0), merging both regions into one.
  setTimeStopTilesFromPairs(world, [[0, 0], [1, 0], [2, 0]]);
  regions = getTimeStopFieldRegions(world);
  assert.equal(regions.regions.length, 1, 'bridge cell must merge the two regions');

  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.entrySequence, 1, 'merging must not re-capture');
  assert.equal(world.timeStopField.exitSequence, 0, 'merging must not release');
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 1);
  assert.equal(world.timeStopField.storedMomentumXWorld, 60);
});

test('splitting a region (bridge cell removed) while the player stays on their own tile keeps them inside without a false transaction', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTilesFromPairs(world, [[0, 0], [1, 0], [2, 0]]);
  assert.equal(getTimeStopFieldRegions(world).regions.length, 1);

  const player = world.clusters[0];
  player.velocityXWorld = 33;
  player.velocityYWorld = 7;
  updateTimeStopFieldPlayerState(world);
  assert.equal(world.timeStopField.entrySequence, 1);

  // Remove the bridge cell at (1,0); the player's own tile (0,0) still exists.
  setTimeStopTilesFromPairs(world, [[0, 0], [2, 0]]);
  assert.equal(getTimeStopFieldRegions(world).regions.length, 2);

  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.entrySequence, 1, 'the player never left their own tile — no re-capture');
  assert.equal(world.timeStopField.exitSequence, 0);
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 1);
  assert.equal(world.timeStopField.storedMomentumXWorld, 33);
});

// ── Connected-region topology coverage (expanded) ───────────────────────────

test('U-shaped region forms one connected region', () => {
  const world = makeWorldWithPlayer(0, 0);
  // U shape: two vertical arms + a bottom bar connecting them.
  setTimeStopTilesFromPairs(world, [
    [0, 0], [0, 1], [0, 2],
    [2, 0], [2, 1], [2, 2],
    [1, 2],
  ]);
  const regions = getTimeStopFieldRegions(world);
  assert.equal(regions.regions.length, 1);
  assert.equal(regions.regions[0].tileCount, 7);
});

test('a region with a hole (ring shape) forms one region and the hole tile is excluded', () => {
  const world = makeWorldWithPlayer(0, 0);
  // 3x3 ring, center (1,1) intentionally omitted.
  const ring: [number, number][] = [];
  for (let gy = 0; gy <= 2; gy++) {
    for (let gx = 0; gx <= 2; gx++) {
      if (gx === 1 && gy === 1) continue;
      ring.push([gx, gy]);
    }
  }
  setTimeStopTilesFromPairs(world, ring);
  const regions = getTimeStopFieldRegions(world);
  assert.equal(regions.regions.length, 1, 'the ring is fully orthogonally connected');
  assert.equal(regions.regions[0].tileCount, 8);
  assert.equal(regions.regions[0].tileSet.size, 8, 'the center hole tile must not be part of the tile set');
});

test('concave (L-shaped) region is one region; the missing quadrant is not part of it', () => {
  const world = makeWorldWithPlayer(0, 0);
  // 2x2 minus the top-right cell = concave L.
  setTimeStopTilesFromPairs(world, [[0, 0], [0, 1], [1, 1]]);
  const regions = getTimeStopFieldRegions(world);
  assert.equal(regions.regions.length, 1);
  assert.equal(regions.regions[0].tileCount, 3);
});

// ── Spawn-inside-field policy ────────────────────────────────────────────────

test('documented policy: spawning with the player already inside a field captures the (zero) spawn velocity like a normal entry', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(3, 3));
  setTimeStopTilesFromPairs(world, [[3, 3]]);
  const player = world.clusters[0];
  // Matches createClusterState's fresh-spawn default: velocity starts at (0,0).
  player.velocityXWorld = 0;
  player.velocityYWorld = 0;

  // Room activation always hard-resets TimeStop state before the first tick.
  resetTimeStopFieldPlayerState(world.timeStopField);
  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.isInsideFieldFlag, 1);
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 1);
  assert.equal(world.timeStopField.storedMomentumXWorld, 0);
  assert.equal(world.timeStopField.storedMomentumYWorld, 0);
  assert.ok(Number.isFinite(world.timeStopField.storedMomentumXWorld));
  // A later exit must release exactly the captured zero, not fabricate momentum.
  [player.positionXWorld, player.positionYWorld] = centerOfBlock(9, 9);
  player.velocityXWorld = 15;
  player.velocityYWorld = 0;
  updateTimeStopFieldPlayerState(world);
  assert.equal(player.velocityXWorld, 15);
});

test('documented policy: a room-transition landing spawn inside a field captures the carried-over transition velocity', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTilesFromPairs(world, [[0, 0]]);
  const player = world.clusters[0];
  // Room-transition velocity carry-over (roomTransitionLoadCoordinator.ts)
  // applies a non-zero velocity to the fresh cluster before the first tick.
  player.velocityXWorld = 50;
  player.velocityYWorld = -5;

  resetTimeStopFieldPlayerState(world.timeStopField);
  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.hasStoredMomentumFlag, 1);
  assert.equal(world.timeStopField.storedMomentumXWorld, 50);
  assert.equal(world.timeStopField.storedMomentumYWorld, -5);
  assert.equal(player.velocityXWorld, 0, 'carried-over velocity is suspended, not lost — released later on exit');
});

// ── High-speed / tunneling-risk invariant ───────────────────────────────────

test('invariant: realistic max per-tick displacement stays well under one field tile, so point-sampling cannot tunnel through a 1-cell field', () => {
  // GRAPPLE_ZIP_SPEED_WORLD_PER_SEC is documented elsewhere in this codebase
  // (grappleZip.ts) as the fastest scripted player movement. At 60 ticks/sec
  // this is the largest displacement any single tick can realistically
  // produce, and it must stay under one tile (BLOCK_SIZE_MEDIUM) for the
  // final-position point-sample used by updateTimeStopFieldPlayerState to
  // reliably catch a 1-cell-wide field (matching the same invariant that
  // already lets every other hazard in this codebase — water/lava/spikes/
  // challenge fields — use final-position overlap tests without swept
  // collision). If this assertion ever fails, TimeStop Field region
  // detection needs a swept/segment test, not just a final-position sample.
  const dtSec = 1 / 60;
  const maxPerTickDisplacementWorld = GRAPPLE_ZIP_SPEED_WORLD_PER_SEC * dtSec;
  assert.ok(
    maxPerTickDisplacementWorld < B,
    `max per-tick displacement (${maxPerTickDisplacementWorld}) must stay under one tile (${B}) or point-sampling can tunnel`,
  );
});

test('entering at grapple-zip speed (fastest scripted movement) still correctly captures on the tick position lands inside a field', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(-1, 0));
  setTimeStopTilesFromPairs(world, [[0, 0]]);
  const player = world.clusters[0];
  player.velocityXWorld = GRAPPLE_ZIP_SPEED_WORLD_PER_SEC;
  player.velocityYWorld = 0;
  // Simulate one tick of integration landing the player inside the field tile
  // (movement.ts integrates position from velocity before this hook runs).
  [player.positionXWorld, player.positionYWorld] = centerOfBlock(0, 0);

  updateTimeStopFieldPlayerState(world);

  assert.equal(world.timeStopField.hasStoredMomentumFlag, 1, 'entry must be detected at realistic max speed');
  assert.equal(world.timeStopField.storedMomentumXWorld, GRAPPLE_ZIP_SPEED_WORLD_PER_SEC);
});

// ── Visual-transition clamping / reversal ───────────────────────────────────

test('visual intensity is clamped to [0,1] and never overshoots across many ticks', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTilesFromPairs(world, [[0, 0]]);
  for (let i = 0; i < 200; i++) {
    updateTimeStopFieldPlayerState(world);
    assert.ok(world.timeStopField.visualIntensity >= 0 && world.timeStopField.visualIntensity <= 1);
  }
  assert.equal(world.timeStopField.visualIntensity, 1);
});

test('visual intensity reverses smoothly from its current value on rapid re-entry (never restarts from zero)', () => {
  const world = makeWorldWithPlayer(...centerOfBlock(0, 0));
  setTimeStopTilesFromPairs(world, [[0, 0]]);
  updateTimeStopFieldPlayerState(world);
  updateTimeStopFieldPlayerState(world);
  updateTimeStopFieldPlayerState(world);
  const intensityWhileEntering = world.timeStopField.visualIntensity;
  assert.ok(intensityWhileEntering > 0 && intensityWhileEntering < 1);

  // Leave immediately (still mid fade-in).
  [world.clusters[0].positionXWorld, world.clusters[0].positionYWorld] = centerOfBlock(9, 9);
  updateTimeStopFieldPlayerState(world);
  const intensityAfterOneExitTick = world.timeStopField.visualIntensity;
  assert.ok(
    intensityAfterOneExitTick < intensityWhileEntering,
    'intensity must start decreasing immediately from wherever it was, not reset to 0 or 1 first',
  );
  assert.ok(intensityAfterOneExitTick > 0, 'must not have snapped straight to 0');
});

// ── Non-interference with fields absent / normal gameplay ──────────────────

test('with zero TimeStop Field tiles loaded, updateTimeStopFieldPlayerState never touches player velocity', () => {
  const world = makeWorldWithPlayer(100, 100);
  setTimeStopTilesFromPairs(world, []);
  const player = world.clusters[0];
  player.velocityXWorld = 77;
  player.velocityYWorld = -33;
  for (let i = 0; i < 10; i++) updateTimeStopFieldPlayerState(world);
  assert.equal(player.velocityXWorld, 77);
  assert.equal(player.velocityYWorld, -33);
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 0);
  assert.equal(world.timeStopField.visualIntensity, 0);
});

test('releaseTimeStopFieldMomentumIfActive with no player cluster is a safe no-op', () => {
  const world = createWorldState(1000 / 60);
  releaseTimeStopFieldMomentumIfActive(world);
  assert.equal(world.timeStopField.hasStoredMomentumFlag, 0);
});
