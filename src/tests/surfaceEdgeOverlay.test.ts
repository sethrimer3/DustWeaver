import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WallSnapshot } from '../render/snapshotTypes';
import { getWallLayoutCache } from '../render/walls/blockWallLayoutCache';
import { renderSurfaceEdgeOverlayPass, type SurfaceEdgeOverlayParams } from '../render/walls/surfaceEdgeOverlay';
import type { SurfaceExposureMap } from '../sim/world/surfaceExposure';
import * as FP from '../debug/perfFreezeProfiler';

/**
 * Coverage for the guaranteed surface-edge overlay pass (`renderSurfaceEdgeOverlayPass`
 * in surfaceEdgeOverlay.ts) — the fix for the sporadic wall-edge highlight bug,
 * plus the corner-brightness hardening pass: convex (outer) corners must be
 * painted exactly once (not doubled by both adjacent side bands), and concave
 * (inner) corners — tiles with no exposed cardinal side but a diagonally
 * exposed corner — must be rendered at all.
 *
 * Deliberately imports `surfaceEdgeOverlay.ts` directly (not through
 * `wallTilePassRenderers.ts`) since that module pulls in Vite-only
 * `import.meta.glob` sprite-loading machinery that isn't available under the
 * plain node/tsx test runner.
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
  };
}

/** Helper to author a fixture as a set of unit (1x1) tile coordinates rather than merged rects. */
function makeTileSnapshot(tiles: Array<[col: number, row: number]>): WallSnapshot {
  return makeWallSnapshot(tiles.map(([col, row]) => ({ x: col * BLOCK_SIZE, y: row * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE })));
}

interface RecordedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function makeFakeCtx(): { ctx: CanvasRenderingContext2D; rects: RecordedRect[] } {
  const rects: RecordedRect[] = [];
  const ctx = {
    fillStyle: '',
    globalCompositeOperation: 'source-over',
    save(): void {},
    restore(): void {},
    fillRect(x: number, y: number, w: number, h: number): void {
      rects.push({ x, y, w, h });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects };
}

function makeParams(overrides: Partial<SurfaceEdgeOverlayParams> & Pick<SurfaceEdgeOverlayParams, 'surfaceExposureMap'>): SurfaceEdgeOverlayParams {
  return {
    ambientDepths: null,
    isBlockTintEnabled: false,
    offsetXPx: 0,
    offsetYPx: 0,
    scalePx: 1,
    blockSizePx: BLOCK_SIZE,
    filterColMinBlocks: 0,
    filterColMaxBlocks: 0x7FFFFFFF,
    filterRowMinBlocks: 0,
    filterRowMaxBlocks: 0x7FFFFFFF,
    ...overrides,
  };
}

/**
 * Reference draw-count formula derived directly from the exposure map (the
 * authoritative source of truth), independent of the overlay's own internal
 * trimming implementation: one draw per exposed cardinal side, one per
 * convex (outer) corner (both adjacent sides exposed), one per concave
 * (inner) corner. Used to sanity-check total rect counts without hardcoding
 * magic numbers per fixture.
 */
function expectedDrawCounts(map: SurfaceExposureMap): { sideBands: number; convexCorners: number; concaveCorners: number; total: number } {
  let sideBands = 0;
  let convexCorners = 0;
  for (const mask of map.masks.values()) {
    if (mask.top) sideBands++;
    if (mask.right) sideBands++;
    if (mask.bottom) sideBands++;
    if (mask.left) sideBands++;
    if (mask.top && mask.left) convexCorners++;
    if (mask.top && mask.right) convexCorners++;
    if (mask.bottom && mask.left) convexCorners++;
    if (mask.bottom && mask.right) convexCorners++;
  }
  let concaveCorners = 0;
  for (const tile of map.concaveCorners) {
    if (tile.corners.nw) concaveCorners++;
    if (tile.corners.ne) concaveCorners++;
    if (tile.corners.sw) concaveCorners++;
    if (tile.corners.se) concaveCorners++;
  }
  return { sideBands, convexCorners, concaveCorners, total: sideBands + convexCorners + concaveCorners };
}

/** Returns the first pair of rects that overlap (share any pixel area), or null if none do. */
function findOverlap(rects: readonly RecordedRect[]): [RecordedRect, RecordedRect] | null {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const overlapsX = a.x < b.x + b.w && a.x + a.w > b.x;
      const overlapsY = a.y < b.y + b.h && a.y + a.h > b.y;
      if (overlapsX && overlapsY) return [a, b];
    }
  }
  return null;
}

test('mixed shape (1x1 stair-step + 2x2 block): total draws match the exposure-map reference count, no overlap', () => {
  // A 2x2 solid block plus an adjoining 1x1 stair-step tile, so the fixture
  // exercises the 2x2-covered path, the plain 1x1 path, and at least one
  // convex corner (each corner of the 2x2 group) in one layout.
  const snapshot = makeWallSnapshot([
    { x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: 2 * BLOCK_SIZE, h: 2 * BLOCK_SIZE }, // 2x2 block at (2,2)-(3,3)
    { x: 4 * BLOCK_SIZE, y: 3 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE },         // stair-step 1x1 at (4,3)
    { x: 4 * BLOCK_SIZE, y: 4 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE },         // stair-step 1x1 at (4,4)
  ]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  assert.ok(wallLayout.solid2x2Map.size > 0, 'fixture must actually produce a 2x2-covered group');

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap });
  renderSurfaceEdgeOverlayPass(ctx, params);

  const expected = expectedDrawCounts(wallLayout.surfaceExposureMap);
  assert.ok(expected.convexCorners > 0, 'fixture must contain at least one convex corner');
  assert.equal(rects.length, expected.total, 'total draw count must match one band per exposed side plus one square per corner');
  assert.equal(findOverlap(rects), null, 'no two drawn rects may overlap — that would double-paint a pixel');
});

test('regression: 2x2 coverage does not suppress individual tile-edge overlay output', () => {
  // A lone 2x2 block, fully surrounded by open air. Even though render1x1Pass
  // skips these cells entirely (coveredBy2x2Keys), the overlay pass must still
  // emit output for every exposed side/corner of every one of the 4
  // constituent tiles — this pass never reads coveredBy2x2Keys at all, only
  // surfaceExposureMap.
  const snapshot = makeWallSnapshot([{ x: 3 * BLOCK_SIZE, y: 3 * BLOCK_SIZE, w: 2 * BLOCK_SIZE, h: 2 * BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  assert.equal(wallLayout.solid2x2Map.size, 1);

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap });
  renderSurfaceEdgeOverlayPass(ctx, params);

  const map = wallLayout.surfaceExposureMap;
  // Each of the 4 tiles has exactly 2 exposed outer-perimeter sides (corner of a 2x2 block).
  assert.equal(map.segments.length, 8);
  const expected = expectedDrawCounts(map);
  // 8 side bands (2 per tile x 4 tiles) + 1 convex corner per tile (its own outer corner) = 12.
  assert.equal(expected.sideBands, 8);
  assert.equal(expected.convexCorners, 4);
  assert.equal(rects.length, expected.total, '2x2 coverage must not suppress any individual tile-edge overlay output');
});

test('convex corner: two adjacent exposed sides on one tile produce no doubled intensity at the shared corner', () => {
  // A single isolated 1x1 tile has all four corners convex (every pair of
  // adjacent sides is exposed) — the clearest possible case for the
  // double-paint bug this hardening pass fixes.
  const snapshot = makeWallSnapshot([{ x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  const map = wallLayout.surfaceExposureMap;

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: map });
  renderSurfaceEdgeOverlayPass(ctx, params);

  const expected = expectedDrawCounts(map);
  assert.equal(expected.convexCorners, 4, 'an isolated tile has 4 convex corners');
  assert.equal(rects.length, expected.total);
  assert.equal(findOverlap(rects), null, 'side bands must be trimmed so they never overlap the corner squares');

  // Sanity: the NW corner square must sit exactly at the tile's own corner,
  // sized bandPx x bandPx (not the full tile), and no side band may cover it.
  const bandPx = Math.max(1, Math.min(3, Math.round(BLOCK_SIZE * 0.25)));
  const nwCornerRects = rects.filter((r) => r.x === 2 * BLOCK_SIZE && r.y === 2 * BLOCK_SIZE && r.w === bandPx && r.h === bandPx);
  assert.equal(nwCornerRects.length, 1, 'exactly one rect must own the NW corner pixel square');
});

test('concave corner: a tile with no exposed cardinal side but a diagonal exposed corner still renders an inner-corner accent', () => {
  // A 3x3 solid block with its bottom-right corner tile removed. The centre
  // tile (2,2) is fully surrounded on all 4 cardinal sides by solid
  // neighbours (zero exposed cardinal sides — it would never appear in
  // `masks`), but its SE diagonal neighbour (3,3) is the removed tile (open
  // air), so it must carry a concave SE corner.
  const solidTiles: Array<[number, number]> = [];
  for (let row = 1; row <= 3; row++) {
    for (let col = 1; col <= 3; col++) {
      if (col === 3 && row === 3) continue; // remove the bottom-right corner
      solidTiles.push([col, row]);
    }
  }
  const snapshot = makeTileSnapshot(solidTiles);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 8, 8);
  const map = wallLayout.surfaceExposureMap;

  // The centre tile must have no exposed cardinal side at all.
  assert.equal(map.masks.has('2,2'), false, 'centre tile must have zero exposed cardinal sides');

  const centreCorners = map.concaveCornerMasks.get('2,2');
  assert.ok(centreCorners, 'centre tile must have a concave corner entry');
  assert.equal(centreCorners!.se, true, 'centre tile must have a concave SE corner (touching the removed diagonal tile)');
  assert.equal(centreCorners!.nw, false);
  assert.equal(centreCorners!.ne, false);
  assert.equal(centreCorners!.sw, false);

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: map });
  renderSurfaceEdgeOverlayPass(ctx, params);

  const bandPx = Math.max(1, Math.min(3, Math.round(BLOCK_SIZE * 0.25)));
  const centreTileX = 2 * BLOCK_SIZE;
  const centreTileY = 2 * BLOCK_SIZE;
  const seCornerRects = rects.filter((r) =>
    r.x === centreTileX + BLOCK_SIZE - bandPx && r.y === centreTileY + BLOCK_SIZE - bandPx &&
    r.w === bandPx && r.h === bandPx,
  );
  assert.equal(seCornerRects.length, 1, 'exactly one concave-corner accent must be drawn at the centre tile\'s SE corner');

  const expected = expectedDrawCounts(map);
  assert.ok(expected.concaveCorners > 0);
  assert.equal(rects.length, expected.total);
  assert.equal(findOverlap(rects), null);
});

test('mixed straight edges + convex + concave corners all render together without overlap', () => {
  // An L-shaped/staircase region: a 2-wide horizontal arm and a 2-wide
  // vertical arm sharing one tile, producing straight edges, at least one
  // convex outer corner, and at least one concave inner corner (at the
  // inside of the L's elbow) in a single fixture.
  const solidTiles: Array<[number, number]> = [
    [1, 1], [2, 1], [3, 1], // top arm
    [1, 2], [1, 3],         // left arm (shares (1,1) with the top arm)
  ];
  const snapshot = makeTileSnapshot(solidTiles);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 8, 8);
  const map = wallLayout.surfaceExposureMap;

  // The elbow tile (2,2) is open air, bordered by solid (2,1) above and
  // (1,2) to the left — its NW diagonal (1,1) is solid, so there is no
  // concave corner there; instead the *solid* tile (1,1) has both its right
  // ((2,1) solid) and bottom ((1,2) solid) neighbours solid, but check its
  // SE diagonal (2,2), which is open air => concave SE corner at (1,1).
  assert.equal(map.masks.get('1,1')?.right, false);
  assert.equal(map.masks.get('1,1')?.bottom, false);
  const elbowCorners = map.concaveCornerMasks.get('1,1');
  assert.ok(elbowCorners, 'elbow tile (1,1) must have a concave corner entry');
  assert.equal(elbowCorners!.se, true, 'elbow tile must have a concave SE corner facing the inside of the L');

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: map });
  renderSurfaceEdgeOverlayPass(ctx, params);

  const expected = expectedDrawCounts(map);
  assert.ok(expected.sideBands > 0, 'fixture must have straight edges');
  assert.ok(expected.convexCorners > 0, 'fixture must have at least one convex corner');
  assert.ok(expected.concaveCorners > 0, 'fixture must have at least one concave corner');
  assert.equal(rects.length, expected.total);
  assert.equal(findOverlap(rects), null, 'straight edges, convex corners, and concave corners must never overlap each other');
});

test('darkness attenuation: fully dark tiles are skipped so the overlay does not glow through darkness', () => {
  const snapshot = makeWallSnapshot([{ x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);

  const ambientDepths = new Map<string, number>([['2,2', 1]]); // pitch black
  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap, ambientDepths, isBlockTintEnabled: true });

  renderSurfaceEdgeOverlayPass(ctx, params);

  assert.equal(rects.length, 0, 'fully dark tile must not receive any overlay band or corner');
});

test('chunk/viewport filtering: segments outside the filter bounds are not drawn', () => {
  const snapshot = makeWallSnapshot([
    { x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE },
    { x: 8 * BLOCK_SIZE, y: 8 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE },
  ]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 20, 20);
  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({
    surfaceExposureMap: wallLayout.surfaceExposureMap,
    filterColMinBlocks: 0, filterColMaxBlocks: 4,
    filterRowMinBlocks: 0, filterRowMaxBlocks: 4,
  });

  renderSurfaceEdgeOverlayPass(ctx, params);

  // The (8,8) tile (and its corner) must be excluded entirely; only the
  // (2,2) tile's full side-bands + corners should draw.
  const inRangeTileMap = wallLayout.surfaceExposureMap;
  const onlyInRangeTile: SurfaceExposureMap = {
    ...inRangeTileMap,
    masks: new Map([...inRangeTileMap.masks].filter(([key]) => key === '2,2')),
    concaveCorners: inRangeTileMap.concaveCorners.filter((t) => t.col <= 4 && t.row <= 4),
  };
  const expected = expectedDrawCounts(onlyInRangeTile);
  assert.equal(rects.length, expected.total);
  assert.ok(rects.length < expectedDrawCounts(inRangeTileMap).total, 'fixture must have at least one out-of-range tile excluded');
});

test('no overlay band is ever emitted for an internal solid-solid seam', () => {
  // Two horizontally-adjacent 1x1 tiles: the shared seam between them must
  // never receive a band, on either side of it.
  const snapshot = makeWallSnapshot([
    { x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }, // (2,2)
    { x: 3 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }, // (3,2) — shares the left/right seam with (2,2)
  ]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  const map = wallLayout.surfaceExposureMap;

  // The exposure map itself must not carry a seam segment — this is the
  // authoritative source the overlay reads from, so if this holds, the
  // overlay can't possibly draw one either.
  const leftTileRightSide = map.segments.find((s) => s.col === 2 && s.row === 2 && s.side === 'right');
  const rightTileLeftSide = map.segments.find((s) => s.col === 3 && s.row === 2 && s.side === 'left');
  assert.equal(leftTileRightSide, undefined, 'internal seam (right face of left tile) must not be an exposed segment');
  assert.equal(rightTileLeftSide, undefined, 'internal seam (left face of right tile) must not be an exposed segment');

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: map });
  renderSurfaceEdgeOverlayPass(ctx, params);

  const expected = expectedDrawCounts(map);
  assert.equal(rects.length, expected.total);
});

test('no overlay band is emitted for a side facing outside the room bounds', () => {
  // A wall tile sitting in the top-left corner of a small room: its top and
  // left faces point outside the room and must never receive a band, even
  // though nothing is "solid" out there to seam against.
  const snapshot = makeWallSnapshot([{ x: 0, y: 0, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 5, 5);
  const map = wallLayout.surfaceExposureMap;

  const topSeg  = map.segments.find((s) => s.col === 0 && s.row === 0 && s.side === 'top');
  const leftSeg = map.segments.find((s) => s.col === 0 && s.row === 0 && s.side === 'left');
  assert.equal(topSeg, undefined, 'top face is out-of-room-bounds — must not be an exposed segment');
  assert.equal(leftSeg, undefined, 'left face is out-of-room-bounds — must not be an exposed segment');

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: map });
  renderSurfaceEdgeOverlayPass(ctx, params);

  // Only the two genuinely-exposed sides (right, bottom) should draw, plus
  // their shared SE convex corner.
  const expected = expectedDrawCounts(map);
  assert.equal(expected.sideBands, 2);
  assert.equal(expected.convexCorners, 1);
  assert.equal(rects.length, expected.total);
});

test('partial darkness attenuates but does not fully suppress the overlay (below the cutoff)', () => {
  // Distinguishes "attenuate" from "skip": a tile that is dimly lit (not at
  // the full-darkness cutoff) should still receive output, just weaker.
  const snapshot = makeWallSnapshot([{ x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);

  const ambientDepths = new Map<string, number>([['2,2', 0.5]]); // dim, not pitch black
  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap, ambientDepths, isBlockTintEnabled: true });

  renderSurfaceEdgeOverlayPass(ctx, params);

  const expected = expectedDrawCounts(wallLayout.surfaceExposureMap);
  assert.equal(rects.length, expected.total, 'a dim (not pitch-black) tile must still receive full geometry, just at reduced strength');
});

// ── Budget-exhausted-fallback retry signal ────────────────────────────────────

test('budget-exhausted fallback flag is single-shot: consuming it clears it for the next check', () => {
  assert.equal(FP.consumeBudgetExhaustedFallbackFlag(), false, 'flag must start clear');
  FP.markBudgetExhaustedFallback();
  assert.equal(FP.consumeBudgetExhaustedFallbackFlag(), true, 'flag must be set after marking');
  assert.equal(FP.consumeBudgetExhaustedFallbackFlag(), false, 'flag must be cleared after being consumed once');
});
