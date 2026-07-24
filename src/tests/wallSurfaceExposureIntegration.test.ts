import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WallSnapshot } from '../render/snapshotTypes';
import { getWallLayoutCache } from '../render/walls/blockWallLayoutCache';
import { getSurfaceMaskAtTile } from '../sim/world/surfaceExposure';

/**
 * Integration coverage proving the wall-tile edge-shading renderer
 * (`wallTilePassRenderers.ts`) and the grapple edge-glow renderer
 * (`grappleInfluenceRenderer.ts`) read exposure from the *same*
 * `CachedWallLayout.surfaceExposureMap` — this is what
 * `getWallLayoutCache` now builds and caches, room-bounds aware, from the
 * authoritative `src/sim/world/surfaceExposure.ts` module rather than each
 * renderer re-deriving exposure from local neighbour checks.
 */

const BLOCK_SIZE = 8;

function makeWallSnapshot(rects: Array<{ x: number; y: number; w: number; h: number }>): WallSnapshot {
  const count = rects.length;
  const xWorld = new Float32Array(count);
  const yWorld = new Float32Array(count);
  const wWorld = new Float32Array(count);
  const hWorld = new Float32Array(count);
  rects.forEach((r, i) => {
    xWorld[i] = r.x;
    yWorld[i] = r.y;
    wWorld[i] = r.w;
    hWorld[i] = r.h;
  });
  return {
    count,
    xWorld,
    yWorld,
    wWorld,
    hWorld,
    isPlatformFlag: new Uint8Array(count),
    platformEdge: new Uint8Array(count),
    themeIndex: new Uint8Array(count).fill(255),
    isInvisibleFlag: new Uint8Array(count),
    rampOrientationIndex: new Uint8Array(count).fill(255),
    isPillarHalfWidthFlag: new Uint8Array(count),
    surfaceRimStyleIndex: new Uint16Array(count).fill(0xFFFF),
    surfaceRimStyleTable: [],
  };
}

test('single tile: all exposed sides receive the edge effect via the shared surface map', () => {
  // A lone 1x1 block at tile (2,2) inside a 10x10-block room, well clear of
  // every room edge, so every side is genuinely open air.
  const snapshot = makeWallSnapshot([{ x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const layout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);

  const mask = getSurfaceMaskAtTile(layout.surfaceExposureMap, 2, 2);
  assert.deepEqual(mask, { top: true, right: true, bottom: true, left: true });
});

test('adjacent tiles / 2x2 block: only outer perimeter sides receive the effect', () => {
  const snapshot = makeWallSnapshot([{ x: 3 * BLOCK_SIZE, y: 3 * BLOCK_SIZE, w: 2 * BLOCK_SIZE, h: 2 * BLOCK_SIZE }]);
  const layout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  const map = layout.surfaceExposureMap;

  const topLeft     = getSurfaceMaskAtTile(map, 3, 3);
  const topRight     = getSurfaceMaskAtTile(map, 4, 3);
  const bottomLeft   = getSurfaceMaskAtTile(map, 3, 4);
  const bottomRight  = getSurfaceMaskAtTile(map, 4, 4);

  assert.deepEqual(topLeft,     { top: true, left: true, right: false, bottom: false });
  assert.deepEqual(topRight,    { top: true, right: true, left: false, bottom: false });
  assert.deepEqual(bottomLeft,  { bottom: true, left: true, top: false, right: false });
  assert.deepEqual(bottomRight, { bottom: true, right: true, top: false, left: false });
});

test('boundary case: no effect on out-of-bounds-facing room edges', () => {
  // A 5x5-block room; a wall tile sits directly in the top-left corner.
  const snapshot = makeWallSnapshot([{ x: 0, y: 0, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const layout = getWallLayoutCache(snapshot, BLOCK_SIZE, 5, 5);

  const mask = getSurfaceMaskAtTile(layout.surfaceExposureMap, 0, 0);
  assert.equal(mask.top, false, 'top faces out of the room bounds — must not be shaded');
  assert.equal(mask.left, false, 'left faces out of the room bounds — must not be shaded');
  assert.equal(mask.right, true);
  assert.equal(mask.bottom, true);
});

test('concave shape: only real air-exposed sides receive the effect', () => {
  // Same "U" shape used in the base surfaceExposure tests: two vertical arms
  // with a reachable air pocket between them, closed off at the bottom.
  const snapshot = makeWallSnapshot([
    { x: 1 * BLOCK_SIZE, y: 1 * BLOCK_SIZE, w: BLOCK_SIZE, h: 2 * BLOCK_SIZE }, // left arm, rows 1-2
    { x: 3 * BLOCK_SIZE, y: 1 * BLOCK_SIZE, w: BLOCK_SIZE, h: 2 * BLOCK_SIZE }, // right arm, rows 1-2
    { x: 1 * BLOCK_SIZE, y: 3 * BLOCK_SIZE, w: 3 * BLOCK_SIZE, h: BLOCK_SIZE }, // bottom bar
  ]);
  const layout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  const map = layout.surfaceExposureMap;

  assert.equal(getSurfaceMaskAtTile(map, 1, 1).right, true, 'left arm faces the reachable air pocket');
  assert.equal(getSurfaceMaskAtTile(map, 3, 1).left, true, 'right arm faces the reachable air pocket');
  assert.equal(getSurfaceMaskAtTile(map, 2, 3).top, true, 'bottom bar centre faces the reachable air pocket');

  // Solid-solid internal seams must never be shaded.
  assert.equal(getSurfaceMaskAtTile(map, 1, 3).right, false, 'bottom bar has no internal seam between its own tiles');
  assert.equal(getSurfaceMaskAtTile(map, 1, 2).bottom, false, 'left arm bottom tile sits directly on the bottom bar — solid neighbour');
});

test('regression: deterministic side selection — same wall layout always yields the same masks', () => {
  // Regression coverage for the previously "random-looking" edge highlight
  // bug: the same authored geometry, queried twice (once via the cache hit
  // path, once forcing a rebuild with an equivalent-but-distinct snapshot),
  // must produce byte-identical masks — exposure is a pure function of
  // tile solidity + room bounds, never of authoring order or render timing.
  const rectA = makeWallSnapshot([{ x: 0, y: 0, w: 4 * BLOCK_SIZE, h: 2 * BLOCK_SIZE }]);
  const tiles: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      tiles.push({ x: col * BLOCK_SIZE, y: row * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE });
    }
  }
  const rectB = makeWallSnapshot(tiles);

  const layoutA = getWallLayoutCache(rectA, BLOCK_SIZE, 20, 20);
  const layoutB = getWallLayoutCache(rectB, BLOCK_SIZE, 20, 20);

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      assert.deepEqual(
        getSurfaceMaskAtTile(layoutA.surfaceExposureMap, col, row),
        getSurfaceMaskAtTile(layoutB.surfaceExposureMap, col, row),
        `mask at (${col},${row}) must be identical regardless of authoring granularity`,
      );
    }
  }
});
