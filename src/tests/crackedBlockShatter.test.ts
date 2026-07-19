/**
 * Tests for the cracked-block momentum shatter feature.
 *
 * Covers:
 *  - Below-threshold impact does not break a cracked (crumble) block.
 *  - Exact canonical invulnerability threshold behavior.
 *  - Qualifying horizontal, upward, and downward impacts break it.
 *  - High-speed tangential contact does not break it.
 *  - Non-cracked (plain) blocks remain intact.
 *  - Full multi-tile footprint disappears in one shatter.
 *  - Collision is removed during the impact and player momentum is not cancelled.
 *  - High-speed swept collisions cannot tunnel past the trigger.
 *  - Room reload (loadRoomHazards) restores a previously-shattered block.
 *  - Multiple same-tick breaks are safe.
 *  - Particle palette + quality-bounded particle counts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// getGraphicsQuality() reads localStorage; provide a minimal in-memory shim
// since this suite runs under plain node:test (no DOM).
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  _data: new Map<string, string>(),
  getItem(key: string) { return this._data.has(key) ? this._data.get(key)! : null; },
  setItem(key: string, value: string) { this._data.set(key, value); },
  removeItem(key: string) { this._data.delete(key); },
} as unknown as Storage;

import { createWorldState, type WorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { resolveClusterSolidWallCollision } from '../sim/clusters/movementCollision';
import { updateMomentumCombatState } from '../sim/momentumCombat';
import { MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED } from '../sim/momentumCombatConfig';
import { setCombatMode } from '../sim/combatMode';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { loadRoomHazards } from '../screens/gameRoomHazards';
import type { RoomDef } from '../levels/roomDef';
import { CrackedBlockShatterRenderer } from '../render/crackedBlockShatterRenderer';
import { getCrackedBlockShatterPalette } from '../render/crackedBlockPaletteCache';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Registers a crumble ("cracked") block directly on the world, as loadRoomHazards would. */
function addCrumbleBlock(
  world: WorldState,
  xBlock: number, yBlock: number,
  wBlocks = 1, hBlocks = 1,
): { wallIndex: number; crumbleIndex: number } {
  const wallIndex = world.wallCount++;
  world.wallXWorld[wallIndex] = xBlock * BLOCK_SIZE_MEDIUM;
  world.wallYWorld[wallIndex] = yBlock * BLOCK_SIZE_MEDIUM;
  world.wallWWorld[wallIndex] = wBlocks * BLOCK_SIZE_MEDIUM;
  world.wallHWorld[wallIndex] = hBlocks * BLOCK_SIZE_MEDIUM;
  world.wallRampOrientationIndex[wallIndex] = 255;

  const crumbleIndex = world.crumbleBlockCount++;
  world.crumbleBlockXWorld[crumbleIndex] = (xBlock + wBlocks * 0.5) * BLOCK_SIZE_MEDIUM;
  world.crumbleBlockYWorld[crumbleIndex] = (yBlock + hBlocks * 0.5) * BLOCK_SIZE_MEDIUM;
  world.isCrumbleBlockActiveFlag[crumbleIndex] = 1;
  world.crumbleBlockHitsRemaining[crumbleIndex] = 2;
  world.crumbleBlockHitCooldownTicks[crumbleIndex] = 0;
  world.crumbleBlockWallIndex[crumbleIndex] = wallIndex;
  world.crumbleBlockVariant[crumbleIndex] = 0;
  world.wallCrumbleBlockIndex[wallIndex] = crumbleIndex;

  return { wallIndex, crumbleIndex };
}

/** Adds a plain (non-cracked) solid wall. */
function addPlainWall(world: WorldState, xBlock: number, yBlock: number, wBlocks = 1, hBlocks = 1): number {
  const wi = world.wallCount++;
  world.wallXWorld[wi] = xBlock * BLOCK_SIZE_MEDIUM;
  world.wallYWorld[wi] = yBlock * BLOCK_SIZE_MEDIUM;
  world.wallWWorld[wi] = wBlocks * BLOCK_SIZE_MEDIUM;
  world.wallHWorld[wi] = hBlocks * BLOCK_SIZE_MEDIUM;
  world.wallRampOrientationIndex[wi] = 255;
  return wi;
}

/** Sets the player's isHighVelocityAttacking flag via the canonical predicate, from horizontal speed. */
function primeMomentumState(world: WorldState, horizontalSpeedWorld: number): void {
  setCombatMode('momentum');
  world.combatMode = 'momentum';
  world.clusters[0].velocityXWorld = horizontalSpeedWorld;
  updateMomentumCombatState(world);
}

function makeWorldWithPlayer(px: number, py: number): WorldState {
  const world = createWorldState(1000 / 60, 7);
  const player = createClusterState(0, px, py, 1, 10);
  player.halfWidthWorld = 6;
  player.halfHeightWorld = 8;
  world.clusters = [player];
  return world;
}

// ── Threshold behavior (reuses the canonical predicate) ─────────────────────

test('below-threshold horizontal impact does not shatter a cracked block', () => {
  const world = makeWorldWithPlayer(0, 0);
  const player = world.clusters[0];
  const { wallIndex, crumbleIndex } = addCrumbleBlock(world, 2, 0);
  primeMomentumState(world, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED - 1);
  assert.equal(player.isHighVelocityAttacking, 0);

  player.positionXWorld = 2 * BLOCK_SIZE_MEDIUM - player.halfWidthWorld - 1;
  player.positionYWorld = 0.5 * BLOCK_SIZE_MEDIUM;
  const prevX = player.positionXWorld;
  player.velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED - 1;
  resolveClusterSolidWallCollision(player, world, prevX, player.positionYWorld, 0.05, false);

  assert.equal(world.isCrumbleBlockActiveFlag[crumbleIndex], 1, 'block must remain intact below threshold');
  assert.ok(world.wallWWorld[wallIndex] > 0, 'wall geometry must remain solid below threshold');
  assert.equal(player.velocityXWorld, 0, 'player should stop against the still-solid block');
});

test('exact canonical threshold speed shatters the block; one unit below does not', () => {
  for (const [speed, expectShatter] of [
    [MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED, true],
    [MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED - 0.01, false],
  ] as const) {
    const world = makeWorldWithPlayer(0, 0);
    const player = world.clusters[0];
    const { crumbleIndex } = addCrumbleBlock(world, 2, 0);
    primeMomentumState(world, speed);
    assert.equal(player.isHighVelocityAttacking, expectShatter ? 1 : 0);

    player.positionXWorld = 2 * BLOCK_SIZE_MEDIUM - player.halfWidthWorld - 1;
    player.positionYWorld = 0.5 * BLOCK_SIZE_MEDIUM;
    const prevX = player.positionXWorld;
    player.velocityXWorld = speed;
    resolveClusterSolidWallCollision(player, world, prevX, player.positionYWorld, 0.05, false);

    assert.equal(
      world.isCrumbleBlockActiveFlag[crumbleIndex], expectShatter ? 0 : 1,
      `speed=${speed} expectShatter=${expectShatter}`,
    );
  }
});

// ── Directional impacts ──────────────────────────────────────────────────────

test('qualifying horizontal impact (running into a wall) shatters the block', () => {
  const world = makeWorldWithPlayer(0, 0);
  const player = world.clusters[0];
  const { wallIndex, crumbleIndex } = addCrumbleBlock(world, 2, 0);
  primeMomentumState(world, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 50);

  player.positionXWorld = 2 * BLOCK_SIZE_MEDIUM - player.halfWidthWorld - 1;
  player.positionYWorld = 0.5 * BLOCK_SIZE_MEDIUM;
  const prevX = player.positionXWorld;
  player.velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 50;
  resolveClusterSolidWallCollision(player, world, prevX, player.positionYWorld, 0.05, false);

  assert.equal(world.isCrumbleBlockActiveFlag[crumbleIndex], 0, 'block should be destroyed');
  assert.equal(world.wallWWorld[wallIndex], 0, 'wall geometry should be cleared');
  assert.equal(world.wallHWorld[wallIndex], 0);
});

test('qualifying downward impact (landing on a cracked block) shatters it', () => {
  const world = makeWorldWithPlayer(0, 0);
  const player = world.clusters[0];
  const { crumbleIndex } = addCrumbleBlock(world, 0, 2);
  primeMomentumState(world, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 20);

  player.positionXWorld = 0.5 * BLOCK_SIZE_MEDIUM;
  player.positionYWorld = 2 * BLOCK_SIZE_MEDIUM - player.halfHeightWorld - 1;
  const prevY = player.positionYWorld;
  player.velocityYWorld = 300;
  resolveClusterSolidWallCollision(player, world, player.positionXWorld, prevY, 0.05, false);

  assert.equal(world.isCrumbleBlockActiveFlag[crumbleIndex], 0, 'block hit from above should shatter');
  assert.notEqual(player.isGroundedFlag, 1, 'player should not land on a shattering block');
});

test('qualifying upward impact (striking a ceiling) shatters it', () => {
  const world = makeWorldWithPlayer(0, 0);
  const player = world.clusters[0];
  const { crumbleIndex } = addCrumbleBlock(world, 0, -2);
  primeMomentumState(world, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 20);

  player.positionXWorld = 0.5 * BLOCK_SIZE_MEDIUM;
  player.positionYWorld = -2 * BLOCK_SIZE_MEDIUM + BLOCK_SIZE_MEDIUM + player.halfHeightWorld + 1;
  const prevY = player.positionYWorld;
  player.velocityYWorld = -300;
  resolveClusterSolidWallCollision(player, world, player.positionXWorld, prevY, 0.05, false);

  assert.equal(world.isCrumbleBlockActiveFlag[crumbleIndex], 0, 'block hit from below should shatter');
});

// ── Tangential contact must not shatter ──────────────────────────────────────

test('high-speed tangential contact (sliding along the top, not into the side) does not shatter', () => {
  const world = makeWorldWithPlayer(0, 0);
  const player = world.clusters[0];
  const { crumbleIndex } = addCrumbleBlock(world, 2, 0);
  primeMomentumState(world, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 50);

  // Player standing exactly on top of the block (no Y overlap into its slab)
  // and sliding horizontally alongside/over it — never crosses into its side face.
  player.positionYWorld = 0 * BLOCK_SIZE_MEDIUM - player.halfHeightWorld;
  player.positionXWorld = 2 * BLOCK_SIZE_MEDIUM + BLOCK_SIZE_MEDIUM * 0.5; // centered over the block, already past its left edge
  const prevX = player.positionXWorld - 1; // tiny prior movement, staying on top
  player.velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 50;
  resolveClusterSolidWallCollision(player, world, prevX, player.positionYWorld, 0.001, false);

  assert.equal(world.isCrumbleBlockActiveFlag[crumbleIndex], 1, 'tangential top-slide contact must not shatter the block');
});

// ── Non-cracked blocks are unaffected ────────────────────────────────────────

test('a plain (non-cracked) wall never shatters, regardless of speed', () => {
  const world = makeWorldWithPlayer(0, 0);
  const player = world.clusters[0];
  const wallIndex = addPlainWall(world, 2, 0);
  primeMomentumState(world, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 200);

  player.positionXWorld = 2 * BLOCK_SIZE_MEDIUM - player.halfWidthWorld - 1;
  player.positionYWorld = 0.5 * BLOCK_SIZE_MEDIUM;
  const prevX = player.positionXWorld;
  player.velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 200;
  resolveClusterSolidWallCollision(player, world, prevX, player.positionYWorld, 0.05, false);

  assert.ok(world.wallWWorld[wallIndex] > 0, 'plain wall geometry must remain intact');
  assert.equal(player.velocityXWorld, 0, 'player should still stop against a plain wall');
});

// ── Multi-tile footprint ─────────────────────────────────────────────────────

test('a 2x2 cracked-block placement is entirely destroyed by one qualifying impact', () => {
  const world = makeWorldWithPlayer(0, 0);
  const player = world.clusters[0];
  const { wallIndex, crumbleIndex } = addCrumbleBlock(world, 2, 0, 2, 2);
  primeMomentumState(world, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 50);

  player.positionXWorld = 2 * BLOCK_SIZE_MEDIUM - player.halfWidthWorld - 1;
  player.positionYWorld = 1 * BLOCK_SIZE_MEDIUM;
  const prevX = player.positionXWorld;
  player.velocityXWorld = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 50;
  resolveClusterSolidWallCollision(player, world, prevX, player.positionYWorld, 0.05, false);

  assert.equal(world.isCrumbleBlockActiveFlag[crumbleIndex], 0, 'entire multi-tile placement should be gone');
  assert.equal(world.wallWWorld[wallIndex], 0);
  assert.equal(world.wallHWorld[wallIndex], 0);
});

// ── Momentum preserved / player continues through ────────────────────────────

test('player momentum is not cancelled by the shatter — continues through the opened space', () => {
  const world = makeWorldWithPlayer(0, 0);
  const player = world.clusters[0];
  addCrumbleBlock(world, 2, 0);
  primeMomentumState(world, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 50);

  player.positionXWorld = 2 * BLOCK_SIZE_MEDIUM - player.halfWidthWorld - 1;
  player.positionYWorld = 0.5 * BLOCK_SIZE_MEDIUM;
  const prevX = player.positionXWorld;
  const speed = MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 50;
  player.velocityXWorld = speed;
  resolveClusterSolidWallCollision(player, world, prevX, player.positionYWorld, 0.05, false);

  assert.equal(player.velocityXWorld, speed, 'velocity must be preserved through the shatter, not zeroed');
  assert.ok(player.positionXWorld > prevX, 'player should have continued moving forward through the destroyed block');
});

// ── Anti-tunneling ────────────────────────────────────────────────────────────

test('a very high-speed swept move still triggers the shatter rather than tunneling past it', () => {
  const world = makeWorldWithPlayer(0, 0);
  const player = world.clusters[0];
  const { crumbleIndex } = addCrumbleBlock(world, 20, 0);
  primeMomentumState(world, 4000);

  // Player starts far to the left; one huge dt would normally risk tunneling
  // straight through a thin block without sub-stepping.
  player.positionXWorld = 1 * BLOCK_SIZE_MEDIUM;
  player.positionYWorld = 0.5 * BLOCK_SIZE_MEDIUM;
  const prevX = player.positionXWorld;
  player.velocityXWorld = 4000;
  resolveClusterSolidWallCollision(player, world, prevX, player.positionYWorld, 0.05, false);

  assert.equal(world.isCrumbleBlockActiveFlag[crumbleIndex], 0, 'fast sweep must still register the impact and shatter the block');
  // Player must not have flown past the block's far edge in the same tick as
  // if collision never happened — it should land right around the block.
  assert.ok(player.positionXWorld < 22 * BLOCK_SIZE_MEDIUM + 50, 'sweep should stop resolving near the block, not fly arbitrarily far');
});

// ── Room reset restores destroyed blocks ─────────────────────────────────────

test('reloading room hazards restores a previously-shattered block (room-death/reset policy)', () => {
  const room = {
    id: 'test-room',
    crumbleBlocks: [{ xBlock: 2, yBlock: 0 }],
  } as unknown as RoomDef;

  const world = createWorldState(1000 / 60, 3);
  loadRoomHazards(world, room);
  assert.equal(world.crumbleBlockCount, 1);
  assert.equal(world.isCrumbleBlockActiveFlag[0], 1);

  // Simulate a momentum shatter having destroyed it during play.
  world.isCrumbleBlockActiveFlag[0] = 0;
  world.wallWWorld[world.crumbleBlockWallIndex[0]] = 0;
  world.wallHWorld[world.crumbleBlockWallIndex[0]] = 0;

  // Room reload (death / re-entry) rebuilds hazard state from RoomDef.
  loadRoomHazards(world, room);
  assert.equal(world.isCrumbleBlockActiveFlag[0], 1, 'block must be restored on room reload');
  assert.ok(world.wallWWorld[world.crumbleBlockWallIndex[0]] > 0, 'wall geometry must be restored on room reload');
});

test('loadRoomHazards never leaves a stale wallCrumbleBlockIndex on a reused, non-crumble wall slot', () => {
  const roomWithCrumble = {
    id: 'room-a',
    crumbleBlocks: [{ xBlock: 0, yBlock: 0 }, { xBlock: 1, yBlock: 0 }],
  } as unknown as RoomDef;
  const roomWithoutCrumble = {
    id: 'room-b',
    crumbleBlocks: [],
  } as unknown as RoomDef;

  const world = createWorldState(1000 / 60, 3);
  loadRoomHazards(world, roomWithCrumble);
  const staleWallIndex = world.crumbleBlockWallIndex[0];
  assert.ok(world.wallCrumbleBlockIndex[staleWallIndex] >= 0);

  loadRoomHazards(world, roomWithoutCrumble);
  assert.equal(world.crumbleBlockCount, 0);
  assert.equal(world.wallCrumbleBlockIndex[staleWallIndex], -1, 'stale crumble linkage must be cleared on transition to a room without crumble blocks');
});

// ── Multiple same-tick breaks are safe ────────────────────────────────────────

test('two cracked blocks hit in the same collision sweep both shatter safely', () => {
  const world = makeWorldWithPlayer(0, 0);
  const player = world.clusters[0];
  // Two separate crumble placements stacked vertically; a large downward sweep
  // (sub-stepped) should be able to resolve through both without corrupting state.
  const a = addCrumbleBlock(world, 0, 5);
  const b = addCrumbleBlock(world, 0, 6);
  primeMomentumState(world, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED + 30);
  // The canonical flag is already latched from the horizontal priming above;
  // zero horizontal velocity now so this vertical-only sweep doesn't carry the
  // player sideways off the (1-block-wide) column before the Y pass runs.
  player.velocityXWorld = 0;

  player.positionXWorld = 0.5 * BLOCK_SIZE_MEDIUM;
  player.positionYWorld = 5 * BLOCK_SIZE_MEDIUM - player.halfHeightWorld - 1;
  const prevY = player.positionYWorld;
  player.velocityYWorld = 3000; // huge downward sweep, sub-stepped through both blocks
  assert.doesNotThrow(() => {
    resolveClusterSolidWallCollision(player, world, player.positionXWorld, prevY, 0.05, false);
  });

  assert.equal(world.isCrumbleBlockActiveFlag[a.crumbleIndex], 0);
  assert.equal(world.isCrumbleBlockActiveFlag[b.crumbleIndex], 0);
});

// ── Particle palette + quality-bounded counts ────────────────────────────────

test('shatter particle palette falls back to a theme-appropriate palette when sprite sampling is unavailable', () => {
  const palette = getCrackedBlockShatterPalette('ice');
  assert.ok(palette.length > 0, 'palette must never be empty');
  for (const c of palette) {
    assert.ok(c.r >= 0 && c.r <= 255 && c.g >= 0 && c.g <= 255 && c.b >= 0 && c.b <= 255);
  }
});

test('shatter particle palette for an unrecognised theme still returns a non-empty fallback', () => {
  const palette = getCrackedBlockShatterPalette('totallyUnknownThemeXYZ');
  assert.ok(palette.length > 0);
});

test('particle counts respect graphics quality and stay bounded', () => {
  const renderer = new CrackedBlockShatterRenderer();
  renderer.notifyShatter(
    0, 0, BLOCK_SIZE_MEDIUM, BLOCK_SIZE_MEDIUM,
    0, 0, -1, 0,
    0, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED,
  );
  // Internal particle pool caps at MAX_PARTICLES=220; a single 1x1 shatter must
  // stay well under that even at 'high' quality with speed/footprint scaling.
  let liveCount = 0;
  renderer.render({
    save() {}, restore() {}, translate() {}, rotate() {}, fillRect() { liveCount++; },
  } as unknown as CanvasRenderingContext2D, 0, 0, 1);
  assert.ok(liveCount > 0, 'shatter must spawn at least some particles');
  assert.ok(liveCount <= 60, `particle count should stay modest for a 1x1 block at threshold speed, got ${liveCount}`);
});

test('particle counts scale up (bounded) with a larger footprint and higher speed', () => {
  const small = new CrackedBlockShatterRenderer();
  small.notifyShatter(0, 0, BLOCK_SIZE_MEDIUM, BLOCK_SIZE_MEDIUM, 0, 0, -1, 0, 0, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED);
  const big = new CrackedBlockShatterRenderer();
  big.notifyShatter(0, 0, BLOCK_SIZE_MEDIUM * 2, BLOCK_SIZE_MEDIUM * 2, 0, 0, -1, 0, 0, MOMENTUM_COMBAT_MIN_HORIZONTAL_SPEED * 3);

  const stubCtx = (counterRef: { n: number }) => ({
    save() {}, restore() {}, translate() {}, rotate() {}, fillRect() { counterRef.n++; },
  } as unknown as CanvasRenderingContext2D);
  const smallCounter = { n: 0 };
  const bigCounter = { n: 0 };
  small.render(stubCtx(smallCounter), 0, 0, 1);
  big.render(stubCtx(bigCounter), 0, 0, 1);
  const smallCount = smallCounter.n;
  const bigCount = bigCounter.n;

  assert.ok(bigCount > smallCount, `larger/faster shatter should spawn more particles (small=${smallCount}, big=${bigCount})`);
  assert.ok(bigCount <= 220, 'particle count must stay bounded even for large/fast shatters');
});
