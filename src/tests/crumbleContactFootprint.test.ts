/**
 * Tests for the contact-based crumble-block break hitbox (src/sim/hazards.ts,
 * "Crumble blocks" section inside `applyHazards`).
 *
 * Prior to the fix under test, contact-break used a fixed one-block-sized box
 * around the crumble block's center regardless of its authored wBlock/hBlock,
 * so a 2x2 (or larger) crumble block only registered a break-triggering
 * contact within a single block's worth of area instead of its full
 * footprint. This suite proves:
 *
 *  - A 2x2 rectangular crumble block breaks on contact anywhere across its
 *    full footprint, including corners a naive 1-block check would miss.
 *  - A contact point genuinely outside the 2x2 footprint does NOT break it.
 *  - A crumble stairs block (nonrectangular solid geometry, via the shared
 *    `aabbOverlapsWallSolid` shape-aware helper) only breaks on contact with
 *    its actual solid steps, not its empty notch corner — i.e. the fix does
 *    not regress the existing shape-aware contact contract into a naive
 *    full-rectangle AABB.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as unknown as { localStorage: Storage }).localStorage = {
  _data: new Map<string, string>(),
  getItem(key: string) { return this._data.has(key) ? this._data.get(key)! : null; },
  setItem(key: string, value: string) { this._data.set(key, value); },
  removeItem(key: string) { this._data.delete(key); },
} as unknown as Storage;

import { createWorldState, type WorldState } from '../sim/world';
import { createClusterState } from '../sim/clusters/state';
import { applyHazards } from '../sim/hazards';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { encodeStairsOrientationIndex } from '../levels/stairsGeometry';

/** Registers a rectangular crumble ("cracked") block directly on the world. */
function addCrumbleBlock(
  world: WorldState,
  xBlock: number, yBlock: number,
  wBlocks = 1, hBlocks = 1,
  rampOrientationIndex = 255,
): { wallIndex: number; crumbleIndex: number } {
  const wallIndex = world.wallCount++;
  world.wallXWorld[wallIndex] = xBlock * BLOCK_SIZE_MEDIUM;
  world.wallYWorld[wallIndex] = yBlock * BLOCK_SIZE_MEDIUM;
  world.wallWWorld[wallIndex] = wBlocks * BLOCK_SIZE_MEDIUM;
  world.wallHWorld[wallIndex] = hBlocks * BLOCK_SIZE_MEDIUM;
  world.wallRampOrientationIndex[wallIndex] = rampOrientationIndex;

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

/** A world with a single tiny (near-point) player cluster at (px, py). */
function makeWorldWithPointPlayer(px: number, py: number): WorldState {
  const world = createWorldState(1000 / 60, 7);
  const player = createClusterState(0, px, py, 1, 10);
  // Tiny half-extents so the player's AABB approximates a point contact,
  // letting these tests probe specific corners/notches precisely.
  player.halfWidthWorld = 0.05;
  player.halfHeightWorld = 0.05;
  world.clusters = [player];
  return world;
}

// ── 2x2 rectangular footprint ────────────────────────────────────────────────

test('a 2x2 crumble block breaks on contact at a far corner outside a naive 1-block box', () => {
  const world = makeWorldWithPointPlayer(0, 0);
  // 2x2 crumble block occupying blocks (0,0)-(1,1), i.e. world px [0,16)x[0,16).
  addCrumbleBlock(world, 0, 0, 2, 2);

  // Contact point near the far (bottom-right) corner of the 2x2 footprint —
  // well outside a fixed single-BLOCK_SIZE_MEDIUM (8px) box centered on the
  // block, which a pre-fix implementation would miss entirely.
  const player = world.clusters[0];
  player.positionXWorld = 2 * BLOCK_SIZE_MEDIUM - 1; // x = 15
  player.positionYWorld = 2 * BLOCK_SIZE_MEDIUM - 1; // y = 15

  assert.equal(world.crumbleBlockHitsRemaining[0], 2);
  applyHazards(world);
  assert.equal(world.crumbleBlockHitsRemaining[0], 1, 'first contact should crack (not yet destroy) the 2x2 block');
});

test('a contact point genuinely outside a 2x2 crumble block footprint does not trigger a break', () => {
  const world = makeWorldWithPointPlayer(0, 0);
  addCrumbleBlock(world, 0, 0, 2, 2); // occupies world px [0,16)x[0,16)

  const player = world.clusters[0];
  // Just past the far edge of the 2x2 footprint.
  player.positionXWorld = 2 * BLOCK_SIZE_MEDIUM + 2; // x = 18
  player.positionYWorld = 2 * BLOCK_SIZE_MEDIUM + 2; // y = 18

  applyHazards(world);
  assert.equal(world.crumbleBlockHitsRemaining[0], 2, 'contact outside the real footprint must not crack the block');
});

// ── Nonrectangular shape (crumble stairs) ────────────────────────────────────

test('a crumble stairs block breaks on contact with its solid step area', () => {
  const world = makeWorldWithPointPlayer(0, 0);
  // Orientation 0: solid region is the diagonal-and-below (bottom-right-ish)
  // portion of the AABB; the empty notch is the top-left corner.
  addCrumbleBlock(world, 0, 0, 1, 1, encodeStairsOrientationIndex(0));

  const player = world.clusters[0];
  // Bottom-right corner of the 1-block (8x8 px) stairs AABB — solid step cell.
  player.positionXWorld = BLOCK_SIZE_MEDIUM - 0.5; // x = 7.5
  player.positionYWorld = BLOCK_SIZE_MEDIUM - 0.5; // y = 7.5

  applyHazards(world);
  assert.equal(world.crumbleBlockHitsRemaining[0], 1, 'contact in the stairs solid step area should crack the block');
});

test('a crumble stairs block does NOT break on contact within its empty notch corner', () => {
  const world = makeWorldWithPointPlayer(0, 0);
  // Same orientation-0 stairs shape; its empty notch is the top-left corner.
  addCrumbleBlock(world, 0, 0, 1, 1, encodeStairsOrientationIndex(0));

  const player = world.clusters[0];
  // Top-left corner of the AABB — inside the stairs' empty notch, so this
  // must NOT count as contact even though it's within the block's bounding
  // box (proving the fix reuses shape-aware solid-geometry testing rather
  // than regressing to a naive full-rectangle AABB).
  player.positionXWorld = 0.5;
  player.positionYWorld = 0.5;

  applyHazards(world);
  assert.equal(world.crumbleBlockHitsRemaining[0], 2, 'contact in the stairs empty notch must not crack the block');
});

test('a particle touching only the far region of a 2x2 crumble block still triggers a break', () => {
  // Player kept well away; only a stray particle contacts the block.
  const world = makeWorldWithPointPlayer(-100, -100);
  addCrumbleBlock(world, 0, 0, 2, 2);

  const p = world.particleCount++;
  world.isAliveFlag[p] = 1;
  world.positionXWorld[p] = 2 * BLOCK_SIZE_MEDIUM - 1; // x = 15, far corner
  world.positionYWorld[p] = 2 * BLOCK_SIZE_MEDIUM - 1; // y = 15

  applyHazards(world);
  assert.equal(world.crumbleBlockHitsRemaining[0], 1, 'a particle contacting the far corner of the real 2x2 footprint should crack it');
});
