import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSurfaceExposureMap,
  getSurfaceMaskAtTile,
  getSurfaceSegments,
  filterVisibleSurfaceSegments,
  buildTileSolidityGridFromRoomWalls,
  queryNearestSurfaceSegment,
  type TileSolidityGrid,
} from '../sim/world/surfaceExposure';

const BLOCK_SIZE_PX = 8;

/** Builds a TileSolidityGrid from a 2D array of 0/1, row-major (rows[row][col]). */
function gridFromRows(rows: readonly (0 | 1)[][], blockSizePx = BLOCK_SIZE_PX): TileSolidityGrid {
  const heightBlocks = rows.length;
  const widthBlocks = rows[0]?.length ?? 0;
  return {
    widthBlocks,
    heightBlocks,
    blockSizePx,
    isSolidAt: (col: number, row: number): boolean => {
      if (row < 0 || row >= heightBlocks || col < 0 || col >= widthBlocks) return false;
      return rows[row][col] === 1;
    },
  };
}

test('single isolated solid tile in open air: all four sides exposed', () => {
  const grid = gridFromRows([
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]);
  const map = buildSurfaceExposureMap(grid);
  const mask = getSurfaceMaskAtTile(map, 1, 1);
  assert.deepEqual(mask, { top: true, right: true, bottom: true, left: true });
  assert.equal(getSurfaceSegments(map).length, 4);
});

test('two adjacent solid tiles: shared internal side not exposed, outer sides exposed', () => {
  const grid = gridFromRows([
    [0, 0, 0, 0],
    [0, 1, 1, 0],
    [0, 0, 0, 0],
  ]);
  const map = buildSurfaceExposureMap(grid);

  const left = getSurfaceMaskAtTile(map, 1, 1);
  const right = getSurfaceMaskAtTile(map, 2, 1);

  assert.equal(left.right, false, 'internal side between the two tiles must not be exposed (left tile facing right)');
  assert.equal(right.left, false, 'internal side between the two tiles must not be exposed (right tile facing left)');

  assert.deepEqual(left, { top: true, right: false, bottom: true, left: true });
  assert.deepEqual(right, { top: true, right: true, bottom: true, left: false });
});

test('solid tile at each room boundary: side facing out of bounds is not exposed', () => {
  // 3x3 room; solid tiles placed at each edge/corner-adjacent centre.
  const grid = gridFromRows([
    [1, 0, 0],
    [0, 0, 0],
    [0, 0, 1],
  ]);
  const map = buildSurfaceExposureMap(grid);

  const topLeft = getSurfaceMaskAtTile(map, 0, 0);
  assert.equal(topLeft.top, false, 'top side is out-of-bounds, must not be exposed');
  assert.equal(topLeft.left, false, 'left side is out-of-bounds, must not be exposed');
  assert.equal(topLeft.right, true);
  assert.equal(topLeft.bottom, true);

  const bottomRight = getSurfaceMaskAtTile(map, 2, 2);
  assert.equal(bottomRight.bottom, false, 'bottom side is out-of-bounds, must not be exposed');
  assert.equal(bottomRight.right, false, 'right side is out-of-bounds, must not be exposed');
  assert.equal(bottomRight.top, true);
  assert.equal(bottomRight.left, true);
});

test('solid 2x2 block: only exterior sides exposed, no internal sides', () => {
  const grid = gridFromRows([
    [0, 0, 0, 0],
    [0, 1, 1, 0],
    [0, 1, 1, 0],
    [0, 0, 0, 0],
  ]);
  const map = buildSurfaceExposureMap(grid);

  const topLeft = getSurfaceMaskAtTile(map, 1, 1);
  const topRight = getSurfaceMaskAtTile(map, 2, 1);
  const bottomLeft = getSurfaceMaskAtTile(map, 1, 2);
  const bottomRight = getSurfaceMaskAtTile(map, 2, 2);

  assert.deepEqual(topLeft, { top: true, left: true, right: false, bottom: false });
  assert.deepEqual(topRight, { top: true, right: true, left: false, bottom: false });
  assert.deepEqual(bottomLeft, { bottom: true, left: true, top: false, right: false });
  assert.deepEqual(bottomRight, { bottom: true, right: true, top: false, left: false });

  // 4 tiles * 2 exterior sides each = 8 segments, no internal ones.
  assert.equal(getSurfaceSegments(map).length, 8);
});

test('concave cave-like arrangement: surfaces adjacent to real air exposed, internal sides not', () => {
  // A "U" shape of solid tiles around a central air pocket that IS reachable
  // from outside (opening at the top).
  const grid = gridFromRows([
    [0, 0, 0, 0, 0],
    [0, 1, 0, 1, 0],
    [0, 1, 0, 1, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 0, 0],
  ]);
  const map = buildSurfaceExposureMap(grid);

  // Inner-facing sides of the two vertical arms, facing the reachable air pocket, are exposed.
  const leftArmTop = getSurfaceMaskAtTile(map, 1, 1);
  assert.equal(leftArmTop.right, true, 'left arm should be exposed toward the internal air pocket');

  const rightArmTop = getSurfaceMaskAtTile(map, 3, 1);
  assert.equal(rightArmTop.left, true, 'right arm should be exposed toward the internal air pocket');

  // The bottom-centre tile's top side faces the air pocket too.
  const bottomCentre = getSurfaceMaskAtTile(map, 2, 3);
  assert.equal(bottomCentre.top, true);

  // No solid-solid internal sides anywhere (e.g. bottom-left tile's right side touches bottom-centre, both solid).
  const bottomLeft = getSurfaceMaskAtTile(map, 1, 3);
  assert.equal(bottomLeft.right, false, 'both neighbours solid — must not be exposed');
});

test('darkness/visibility does not affect base geometric exposure', () => {
  const grid = gridFromRows([
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]);
  const map = buildSurfaceExposureMap(grid);
  // Base map has no concept of darkness at all — it's still fully exposed.
  const mask = getSurfaceMaskAtTile(map, 1, 1);
  assert.deepEqual(mask, { top: true, right: true, bottom: true, left: true });
  assert.equal(getSurfaceSegments(map).length, 4);
});

test('active/visible layer can filter exposed segments by an external darkness predicate', () => {
  const grid = gridFromRows([
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]);
  const map = buildSurfaceExposureMap(grid);

  // Simulate: only the top side's air cell (1,0) is "lit"; everything else is dark.
  const isLit = (col: number, row: number): boolean => col === 1 && row === 0;

  const visible = filterVisibleSurfaceSegments(map, (seg) => isLit(seg.airCol, seg.airRow));
  assert.equal(visible.length, 1);
  assert.equal(visible[0].side, 'top');
});

test('connected-open-air flood fill: sealed internal air pocket is not treated as open air', () => {
  // Fully sealed 1x1 air pocket in the centre of a solid block, with no opening.
  const grid = gridFromRows([
    [1, 1, 1],
    [1, 0, 1],
    [1, 1, 1],
  ]);

  // Seed from a definitely-external, definitely-air cell — none exist in this
  // grid (whole border is solid), so the connected set should end up empty
  // and every solid tile should report no exposure at all.
  const map = buildSurfaceExposureMap(grid, {
    connectedOpenAirOnly: true,
    openAirSeeds: [{ col: -1, row: -1 }], // out of bounds seed, ignored
  });

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      if (!grid.isSolidAt(col, row)) continue;
      const mask = getSurfaceMaskAtTile(map, col, row);
      assert.deepEqual(mask, { top: false, right: false, bottom: false, left: false },
        `tile (${col},${row}) borders a sealed cavity, must not be exposed under connected-open-air mode`);
    }
  }
  assert.equal(getSurfaceSegments(map).length, 0);
});

test('connected-open-air flood fill: accessible interior cave air still exposes surfaces', () => {
  // Same "U" shape as the cave test above, but this time require the pocket
  // be reachable from a seed at the top opening.
  const grid = gridFromRows([
    [0, 0, 0, 0, 0],
    [0, 1, 0, 1, 0],
    [0, 1, 0, 1, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 0, 0],
  ]);
  const map = buildSurfaceExposureMap(grid, {
    connectedOpenAirOnly: true,
    openAirSeeds: [{ col: 2, row: 0 }], // top-centre air cell, connected to the pocket below
  });

  const leftArmTop = getSurfaceMaskAtTile(map, 1, 1);
  assert.equal(leftArmTop.right, true, 'pocket is reachable from the seed, so this side should still be exposed');
});

test('adapter: one-way platforms are not treated as solid, invisible walls are', () => {
  const walls = [
    { xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1 }, // plain solid tile at (0,0)
    { xBlock: 1, yBlock: 0, wBlock: 1, hBlock: 1, isPlatformFlag: 1 as const }, // platform at (1,0) — not solid
    { xBlock: 2, yBlock: 0, wBlock: 1, hBlock: 1, isInvisibleFlag: 1 as const }, // invisible boundary — solid
  ];
  const grid = buildTileSolidityGridFromRoomWalls(walls, 3, 1, BLOCK_SIZE_PX);

  assert.equal(grid.isSolidAt(0, 0), true);
  assert.equal(grid.isSolidAt(1, 0), false, 'one-way platforms should not count as solid for surface exposure');
  assert.equal(grid.isSolidAt(2, 0), true, 'invisible collision boundaries should still count as solid');
});

test('queryNearestSurfaceSegment finds the closest exposed segment to a point', () => {
  const grid = gridFromRows([
    [0, 0, 0],
    [0, 1, 0],
    [0, 0, 0],
  ]);
  const map = buildSurfaceExposureMap(grid);

  // Point just above the tile's top side, in pixel space (tile (1,1) spans px 8..16, 8..16).
  const nearest = queryNearestSurfaceSegment(map, { x: 12, y: 6 });
  assert.ok(nearest !== null);
  assert.equal(nearest!.side, 'top');
});
