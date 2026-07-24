import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { WallSnapshot } from '../render/snapshotTypes';
import { getWallLayoutCache, isWallOccupied } from '../render/walls/blockWallLayoutCache';
import {
  OPEN_AIR_SIDE_N,
  OPEN_AIR_SIDE_E,
  OPEN_AIR_SIDE_S,
  OPEN_AIR_SIDE_W,
} from '../render/walls/blockEdgeShading';

/**
 * Regression coverage for the "2×2 full-sprite grouping breaks per-cell edge
 * shading" bug: `render2x2Pass` computed one `openAirSidesMask2x2` for an
 * entire 2×2 group (a side counted as open only when BOTH constituent cells
 * were open), and cells covered by a 2×2 group were skipped entirely by
 * `render1x1Pass`'s per-cell shading path. Visually this meant only some 2×2
 * groups got edge treatment while adjacent 1×1-authored or partially-exposed
 * tiles did not — the effect looked random instead of applying uniformly to
 * every exposed wall surface.
 *
 * The fix disables the 2×2 fast path for solid wall rendering
 * (`WALL_2X2_FULL_SPRITE_ENABLED = false` in blockSpriteRenderer.ts) so every
 * solid tile always goes through the 1×1 per-cell path, where the mask is:
 *   north open  iff tile above  is not solid
 *   east  open  iff tile right  is not solid
 *   south open  iff tile below  is not solid
 *   west  open  iff tile left   is not solid
 *
 * These tests don't have a DOM/Canvas available (see blockEdgeShading.test.ts
 * for why), so they exercise the actual occupancy/layout data structures that
 * feed the render passes — `getWallLayoutCache` + `isWallOccupied` — the same
 * calls `render1x1Pass` and `render2x2Pass` make, across the four layouts
 * called out in the bug report: a large rectangle, a floating 2×2 block, a
 * stair/overhang shape, and mixed adjacent 2×2 + 1×1 authored blocks.
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
    themeIndex: new Uint8Array(count).fill(255), // 255 = room default
    isInvisibleFlag: new Uint8Array(count),
    rampOrientationIndex: new Uint8Array(count).fill(255), // 255 = not a ramp
    isPillarHalfWidthFlag: new Uint8Array(count),
    surfaceRimStyleIndex: new Uint16Array(count).fill(0xFFFF),
    surfaceRimStyleTable: [],
  };
}

/** Recomputes the per-cell open-air mask exactly the way render1x1Pass does. */
function computeCellMask(occupied: Set<string>, col: number, row: number): number {
  const northSolid = isWallOccupied(occupied, col, row - 1);
  const eastSolid  = isWallOccupied(occupied, col + 1, row);
  const southSolid = isWallOccupied(occupied, col, row + 1);
  const westSolid  = isWallOccupied(occupied, col - 1, row);
  return (northSolid ? 0 : OPEN_AIR_SIDE_N) |
         (eastSolid  ? 0 : OPEN_AIR_SIDE_E) |
         (southSolid ? 0 : OPEN_AIR_SIDE_S) |
         (westSolid  ? 0 : OPEN_AIR_SIDE_W);
}

test('2x2 full-sprite optimization is disabled for solid wall rendering (per-cell shading fix)', () => {
  // blockSpriteRenderer.ts transitively imports folderBlockThemes.ts, which
  // uses Vite's `import.meta.glob` — a build-time-only feature unavailable
  // under this repo's plain node/tsx test runner — so the flag is verified by
  // reading the source rather than importing the module directly.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '../render/walls/blockSpriteRenderer.ts'), 'utf8');
  const match = src.match(/export const WALL_2X2_FULL_SPRITE_ENABLED\s*=\s*(true|false)\s*;/);
  assert.ok(match, 'WALL_2X2_FULL_SPRITE_ENABLED flag must exist in blockSpriteRenderer.ts');
  assert.equal(match![1], 'false', 'the 2x2 fast path must stay disabled until it supports correct per-cell partial edge shading');
});

test('large rectangular wall: every cell along the exposed top edge gets a consistent north-open mask', () => {
  // 8x4 blocks region authored as ONE large wall rect (not per-tile blocks).
  const wallsWide = 8;
  const wallsTall = 4;
  const snapshot = makeWallSnapshot([{ x: 0, y: 0, w: wallsWide * BLOCK_SIZE, h: wallsTall * BLOCK_SIZE }]);
  const layout = getWallLayoutCache(snapshot, BLOCK_SIZE, 100, 100);

  // Confirm the layout DOES register 2x2 sub-groups for this rect (proving the
  // bug scenario exists in the data) — the render-path fix is what prevents
  // them from being consumed for shading purposes, not the absence of the data.
  assert.ok(layout.solid2x2Map.size > 0, 'a large rect should still populate solid2x2Map internally');

  for (let col = 0; col < wallsWide; col++) {
    const mask = computeCellMask(layout.occupied, col, 0);
    assert.ok(mask & OPEN_AIR_SIDE_N, `top row cell (${col},0) must have north-open bit set`);
    // Interior columns should have no east/west exposure; edge columns do.
  }
  // Every top-row cell must be consistently treated the same way — none skipped.
  const topRowMasks = Array.from({ length: wallsWide }, (_, col) => computeCellMask(layout.occupied, col, 0));
  assert.ok(topRowMasks.every(m => (m & OPEN_AIR_SIDE_N) !== 0), 'no gaps in top-edge shading across the whole rectangle');

  // Bottom row must NOT be north-shaded (it's interior relative to N) and the interior
  // cell (not on any boundary) must have mask 0.
  const interiorMask = computeCellMask(layout.occupied, 3, 2);
  assert.equal(interiorMask, 0, 'a fully interior cell surrounded on all four sides must get no edge treatment');
});

test('vertical wall: entire exposed left/right surface is consistently shaded', () => {
  // A 3-wide, 10-tall column so left/right faces are fully exposed the whole height.
  const cols = 3;
  const rows = 10;
  const snapshot = makeWallSnapshot([{ x: 0, y: 0, w: cols * BLOCK_SIZE, h: rows * BLOCK_SIZE }]);
  const layout = getWallLayoutCache(snapshot, BLOCK_SIZE, 100, 100);

  for (let row = 0; row < rows; row++) {
    const leftMask  = computeCellMask(layout.occupied, 0, row);
    const rightMask = computeCellMask(layout.occupied, cols - 1, row);
    assert.ok(leftMask & OPEN_AIR_SIDE_W,  `left column row ${row} must be west-open`);
    assert.ok(rightMask & OPEN_AIR_SIDE_E, `right column row ${row} must be east-open`);
  }
});

test('floating 2x2 block: all four sides shade correctly and no internal seam forms between its own cells', () => {
  // A standalone 2x2 block floating in open space.
  const snapshot = makeWallSnapshot([{ x: 40, y: 40, w: 2 * BLOCK_SIZE, h: 2 * BLOCK_SIZE }]);
  const layout = getWallLayoutCache(snapshot, BLOCK_SIZE, 100, 100);

  const col0 = 5; // 40 / 8
  const row0 = 5;

  const topLeft     = computeCellMask(layout.occupied, col0,     row0);
  const topRight    = computeCellMask(layout.occupied, col0 + 1, row0);
  const bottomLeft  = computeCellMask(layout.occupied, col0,     row0 + 1);
  const bottomRight = computeCellMask(layout.occupied, col0 + 1, row0 + 1);

  // Each cell is exposed on its own two outer faces...
  assert.equal(topLeft,     OPEN_AIR_SIDE_N | OPEN_AIR_SIDE_W);
  assert.equal(topRight,    OPEN_AIR_SIDE_N | OPEN_AIR_SIDE_E);
  assert.equal(bottomLeft,  OPEN_AIR_SIDE_S | OPEN_AIR_SIDE_W);
  assert.equal(bottomRight, OPEN_AIR_SIDE_S | OPEN_AIR_SIDE_E);

  // ...and NOT exposed on the faces shared with its own group-mates (no seam).
  assert.equal(topLeft & OPEN_AIR_SIDE_E, 0, 'top-left cell must not shade its east face (touches top-right)');
  assert.equal(topLeft & OPEN_AIR_SIDE_S, 0, 'top-left cell must not shade its south face (touches bottom-left)');
});

test('stair/overhang shape: exposed step surfaces shade per-cell even though authored as one wall rect', () => {
  // A 2-step staircase: row 0 is 4 wide, row 1 (below) is only 2 wide (cols 2-3),
  // creating an overhang on the left where row 0's cols 0-1 have open air below.
  const snapshot = makeWallSnapshot([
    { x: 0 * BLOCK_SIZE, y: 0, w: 4 * BLOCK_SIZE, h: 1 * BLOCK_SIZE },
    { x: 2 * BLOCK_SIZE, y: 1 * BLOCK_SIZE, w: 2 * BLOCK_SIZE, h: 1 * BLOCK_SIZE },
  ]);
  const layout = getWallLayoutCache(snapshot, BLOCK_SIZE, 100, 100);

  // Row 0, cols 0-1 overhang: south face must be open (no wall below them).
  assert.ok(computeCellMask(layout.occupied, 0, 0) & OPEN_AIR_SIDE_S, 'overhang cell (0,0) must be south-open');
  assert.ok(computeCellMask(layout.occupied, 1, 0) & OPEN_AIR_SIDE_S, 'overhang cell (1,0) must be south-open');
  // Row 0, cols 2-3 sit directly above row 1 — south face must be solid (no shading).
  assert.equal(computeCellMask(layout.occupied, 2, 0) & OPEN_AIR_SIDE_S, 0, 'cell (2,0) has a solid neighbour below — no seam');
  assert.equal(computeCellMask(layout.occupied, 3, 0) & OPEN_AIR_SIDE_S, 0, 'cell (3,0) has a solid neighbour below — no seam');
});

test('mixed adjacent 2x2 and 1x1 authored blocks produce identical masks regardless of authoring granularity', () => {
  // Same 4x2 solid rectangle, once authored as a single 2x2-friendly rect and
  // once authored as eight separate 1x1 wall entries. The resulting per-cell
  // open-air masks must be identical — the fix's whole point is that visual
  // treatment must not depend on how the region was authored.
  const asOneRect = makeWallSnapshot([{ x: 0, y: 0, w: 4 * BLOCK_SIZE, h: 2 * BLOCK_SIZE }]);
  const singleTiles: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      singleTiles.push({ x: col * BLOCK_SIZE, y: row * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE });
    }
  }
  const asManyTiles = makeWallSnapshot(singleTiles);

  const layoutRect  = getWallLayoutCache(asOneRect, BLOCK_SIZE, 100, 100);
  const layoutTiles = getWallLayoutCache(asManyTiles, BLOCK_SIZE, 100, 100);

  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const maskRect  = computeCellMask(layoutRect.occupied, col, row);
      const maskTiles = computeCellMask(layoutTiles.occupied, col, row);
      assert.equal(
        maskRect, maskTiles,
        `cell (${col},${row}) must have the same open-air mask whether authored as one rect or many 1x1 tiles`,
      );
    }
  }
});
