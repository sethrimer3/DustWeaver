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
 * shading" bug and its fix.
 *
 * History: `render2x2Pass` used to compute one `openAirSidesMask2x2` for an
 * entire 2×2 group (a side counted as open only when BOTH constituent cells
 * were open) and bake that coarse mask into the 2×2 sprite's edge shading.
 * Visually this meant only some 2×2 groups got edge treatment while adjacent
 * 1×1-authored or partially-exposed tiles did not. The old fix disabled the
 * 2×2 fast path entirely (`WALL_2X2_FULL_SPRITE_ENABLED = false`), which
 * regressed 2×2-eligible themes back to four separate 8×8 draws instead of
 * one 16×16 sprite.
 *
 * The real fix (see blockSpriteRenderer.ts and wallTilePassRenderers.ts):
 * `render2x2Pass` now always draws its base sprite UNSHADED — it never bakes
 * any open-air mask, coarse or otherwise — and 100% of exposed-edge
 * presentation is handled by the separate `renderSurfaceEdgeOverlayPass`,
 * which reads `wallLayout.surfaceExposureMap` per individual cell regardless
 * of whether that cell was drawn via the 2×2 or 1×1 base-sprite pass. So the
 * 2×2 fast path is re-enabled (`WALL_2X2_FULL_SPRITE_ENABLED = true`) and is
 * safe: it only affects how many base-sprite draw calls happen, never which
 * per-cell edges get shaded.
 *
 * These tests don't have a DOM/Canvas available (see blockEdgeShading.test.ts
 * for why), so they exercise the actual occupancy/layout data structures that
 * feed the render passes — `getWallLayoutCache` + `isWallOccupied` — the same
 * calls `render1x1Pass` and `render2x2Pass` make, across the four layouts
 * called out in the original bug report: a large rectangle, a floating 2×2
 * block, a stair/overhang shape, and mixed adjacent 2×2 + 1×1 authored
 * blocks, plus fixtures added for the 2×2-path re-enablement below.
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

test('2x2 full-sprite optimization is re-enabled for solid wall rendering (unshaded base + guaranteed overlay fix)', () => {
  // blockSpriteRenderer.ts transitively imports folderBlockThemes.ts, which
  // uses Vite's `import.meta.glob` — a build-time-only feature unavailable
  // under this repo's plain node/tsx test runner — so the flag is verified by
  // reading the source rather than importing the module directly.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '../render/walls/blockSpriteRenderer.ts'), 'utf8');
  const match = src.match(/export const WALL_2X2_FULL_SPRITE_ENABLED\s*=\s*(true|false)\s*;/);
  assert.ok(match, 'WALL_2X2_FULL_SPRITE_ENABLED flag must exist in blockSpriteRenderer.ts');
  assert.equal(match![1], 'true', 'the 2x2 fast path must be enabled now that render2x2Pass draws unshaded and defers edge shading to the guaranteed overlay pass');
});

test('render2x2Pass always draws an unshaded base sprite (no baked open-air mask)', () => {
  // render2x2Pass itself lives in wallTilePassRenderers.ts, which transitively
  // pulls in Vite-only folder-theme machinery, so we verify the contract by
  // reading the source: the pass must never derive a per-group open-air mask
  // from surfaceExposureMap and feed it into sprite shading — it must always
  // pass a suppressed/zero mask so edge presentation is left entirely to
  // renderSurfaceEdgeOverlayPass.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '../render/walls/wallTilePassRenderers.ts'), 'utf8');
  const fnStart = src.indexOf('export function render2x2Pass');
  assert.ok(fnStart >= 0, 'render2x2Pass must exist in wallTilePassRenderers.ts');
  const fnEnd = src.indexOf('\n// ── Pass 2:', fnStart);
  const fnBody = src.slice(fnStart, fnEnd >= 0 ? fnEnd : undefined);
  assert.match(fnBody, /const openAirSidesMask2x2\s*=\s*0\s*;/, 'render2x2Pass must always use a zero open-air mask for its base sprite');
  assert.match(fnBody, /const suppressBakedEdgeShading\s*=\s*true\s*;/, 'render2x2Pass must always suppress baked edge shading on its base sprite');
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

test('isolated 2x2 wall: layout registers exactly one solid2x2Map group covering all four cells', () => {
  const snapshot = makeWallSnapshot([{ x: 40, y: 40, w: 2 * BLOCK_SIZE, h: 2 * BLOCK_SIZE }]);
  const layout = getWallLayoutCache(snapshot, BLOCK_SIZE, 100, 100);

  const col0 = 5;
  const row0 = 5;
  assert.equal(layout.solid2x2Map.size, 1, 'a standalone 2x2 block must register exactly one solid2x2Map group');
  assert.ok(layout.solid2x2Map.has(`${col0},${row0}`), 'the group key must be the top-left cell of the 2x2 block');

  // All four cells must be present in the occupancy grid so render1x1Pass's
  // coveredBy2x2Keys check (built from this same map) can skip them.
  for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
    assert.ok(isWallOccupied(layout.occupied, col0 + dc, row0 + dr), `cell (${col0 + dc},${row0 + dr}) must be occupied`);
  }
});

test('mixed 2x2 + 1x1 geometry with odd trailing row/column: trailing cells stay out of solid2x2Map', () => {
  // A 5-wide, 3-tall solid region: cols 0-3 pair up into 2x2 groups, but the
  // 5th column (col 4) and 3rd row (row 2) are odd trailing geometry that
  // must remain 1x1-only (never claimed by a solid2x2Map group).
  const snapshot = makeWallSnapshot([{ x: 0, y: 0, w: 5 * BLOCK_SIZE, h: 3 * BLOCK_SIZE }]);
  const layout = getWallLayoutCache(snapshot, BLOCK_SIZE, 100, 100);

  assert.ok(layout.solid2x2Map.size > 0, 'the 4x2 even sub-region should still register 2x2 groups');

  for (const [topLeftKey] of layout.solid2x2Map) {
    const [colStr, rowStr] = topLeftKey.split(',');
    const col = Number(colStr);
    const row = Number(rowStr);
    // No group may claim the trailing column (col 4) or trailing row (row 2).
    assert.ok(col + 1 <= 3, `2x2 group at col ${col} must not reach into the odd trailing column 4`);
    assert.ok(row + 1 <= 1, `2x2 group at row ${row} must not reach into the odd trailing row 2`);
  }

  // The trailing column/row cells are still occupied — they just render 1x1.
  assert.ok(isWallOccupied(layout.occupied, 4, 0), 'trailing column cell must still be occupied');
  assert.ok(isWallOccupied(layout.occupied, 0, 2), 'trailing row cell must still be occupied');
});

test('no duplicate base rendering: every occupied cell is claimed by at most one 2x2 group', () => {
  // Several adjacent and separate 2x2-eligible regions; no cell should ever
  // appear in more than one solid2x2Map group (which would cause render2x2Pass
  // to draw two overlapping base sprites over the same cell).
  const snapshot = makeWallSnapshot([
    { x: 0,  y: 0, w: 4 * BLOCK_SIZE, h: 4 * BLOCK_SIZE },
    { x: 40, y: 40, w: 2 * BLOCK_SIZE, h: 2 * BLOCK_SIZE },
  ]);
  const layout = getWallLayoutCache(snapshot, BLOCK_SIZE, 100, 100);

  const claimed = new Set<string>();
  for (const [topLeftKey] of layout.solid2x2Map) {
    const [colStr, rowStr] = topLeftKey.split(',');
    const col = Number(colStr);
    const row = Number(rowStr);
    for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const key = `${col + dc},${row + dr}`;
      assert.ok(!claimed.has(key), `cell ${key} must not be claimed by more than one 2x2 group`);
      claimed.add(key);
    }
  }
});

test('unsupported themes fall back safely: themeSupports2x2 gates the 2x2 path by theme and block size', () => {
  // blockSpriteSets.ts transitively imports folderBlockThemes.ts (Vite-only
  // import.meta.glob), so this is verified by source inspection rather than
  // importing the module, matching the pattern used elsewhere in this file.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, '../render/walls/blockSpriteSets.ts'), 'utf8');
  const match = src.match(/export function themeSupports2x2\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  assert.ok(match, 'themeSupports2x2 must exist in blockSpriteSets.ts');
  const body = match![1];
  assert.match(body, /blockSizePx !== 8/, 'themeSupports2x2 must reject non-8px block sizes');
  assert.match(body, /isFolderBasedTheme\(theme\)/, 'themeSupports2x2 must gate on folder-based theme support');

  // render2x2Pass (wallTilePassRenderers.ts) must check eligibility per-group
  // before drawing, falling back to render1x1Pass's per-cell path otherwise —
  // i.e. an ineligible group must never be added to coveredBy2x2Keys.
  const rendererSrc = readFileSync(path.join(here, '../render/walls/wallTilePassRenderers.ts'), 'utf8');
  assert.match(rendererSrc, /if \(!themeSupports2x2\(resolvedTheme, blockSizePx\)\) continue;/,
    'render2x2Pass must skip (and therefore fall back to the 1x1 path for) groups whose theme does not support 2x2');

  const rendererCacheSrc = readFileSync(path.join(here, '../render/walls/blockSpriteRenderer.ts'), 'utf8');
  assert.match(rendererCacheSrc, /if \(!themeSupports2x2\(resolvedTheme, blockSizePx\)\) continue;/,
    '_populateCoveredBy2x2Keys must also skip ineligible groups so render1x1Pass does not wrongly treat them as covered');
});

test('partial edge exposure inside a 2x2 group: guaranteed overlay shades each cell by its own exposure, not the group\'s', () => {
  // A 2x2 block adjacent to a 1x1 neighbour on its east side (sharing a wall
  // with the top-right cell only). Per-cell: top-left is open on N/W, bottom-
  // left is open on S/W, bottom-right is open on S only (E is blocked by the
  // neighbour), top-right is open on N only (E is blocked). This is exactly
  // the kind of partial/asymmetric exposure the old coarse group-mask could
  // not represent (it could only mark a whole side open/closed for all 4
  // cells at once); the guaranteed overlay must still get it right per-cell.
  // The 2x2 group must be authored as a single wall rect — solid2x2Map
  // grouping is computed per-wall-rect (see _buildSolid2x2Map), not from
  // merged occupancy, so four separately-authored 1x1 tiles would never
  // register a group at all.
  const snapshot = makeWallSnapshot([
    { x: 5 * BLOCK_SIZE, y: 5 * BLOCK_SIZE, w: 2 * BLOCK_SIZE, h: 2 * BLOCK_SIZE },
    { x: 7 * BLOCK_SIZE, y: 5 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }, // neighbour east of the group's top-right cell only
  ]);
  const layout = getWallLayoutCache(snapshot, BLOCK_SIZE, 100, 100);

  assert.ok(layout.solid2x2Map.has('5,5'), 'the 2x2 group must still be registered despite the extra neighbour tile');

  const topLeft     = computeCellMask(layout.occupied, 5, 5);
  const topRight     = computeCellMask(layout.occupied, 6, 5);
  const bottomLeft   = computeCellMask(layout.occupied, 5, 6);
  const bottomRight = computeCellMask(layout.occupied, 6, 6);

  assert.equal(topLeft,     OPEN_AIR_SIDE_N | OPEN_AIR_SIDE_W, 'top-left: open N/W, blocked E (group-mate) and S (group-mate)');
  assert.equal(topRight,    OPEN_AIR_SIDE_N, 'top-right: open N only — E is blocked by the authored neighbour tile, S/W by group-mates');
  assert.equal(bottomLeft,  OPEN_AIR_SIDE_S | OPEN_AIR_SIDE_W, 'bottom-left: open S/W, blocked N/E by group-mates');
  assert.equal(bottomRight, OPEN_AIR_SIDE_S | OPEN_AIR_SIDE_E, 'bottom-right: open S/E (its own E neighbour (7,6) is empty), blocked N/W by group-mates');
});
