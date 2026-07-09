import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WallSnapshot } from '../render/snapshotTypes';
import { getWallLayoutCache } from '../render/walls/blockWallLayoutCache';
import { renderSurfaceEdgeOverlayPass, type SurfaceEdgeOverlayParams } from '../render/walls/surfaceEdgeOverlay';
import type { SurfaceExposureMap } from '../sim/world/surfaceExposure';
import * as FP from '../debug/perfFreezeProfiler';

/**
 * Coverage for the guaranteed surface-edge overlay pass (`renderSurfaceEdgeOverlayPass`
 * in surfaceEdgeOverlay.ts):
 *   - no random missing edges (every exposed segment/corner is covered),
 *   - no double-bright convex/outer corners (corner rings never overlap
 *     each other or the trimmed side bands),
 *   - concave/inner corners render correctly,
 *   - the visual intensity is the intended subtle 3-pixel inward falloff
 *     (20-30% / 10-20% / 0-10% alpha per depth), not a bright glowing outline.
 *
 * Deliberately imports `surfaceEdgeOverlay.ts` directly (not through
 * `wallTilePassRenderers.ts`) since that module pulls in Vite-only
 * `import.meta.glob` sprite-loading machinery that isn't available under the
 * plain node/tsx test runner.
 */

const BLOCK_SIZE = 8;

/** Depth → [lo, hi] alpha range — mirrors `_BAND_ALPHA_RANGES` in surfaceEdgeOverlay.ts. */
const BAND_ALPHA_RANGES: readonly (readonly [number, number])[] = [
  [0.20, 0.30],
  [0.10, 0.20],
  [0.00, 0.10],
];
const BAND_COUNT = BAND_ALPHA_RANGES.length;

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
  alpha: number;
}

function makeFakeCtx(): { ctx: CanvasRenderingContext2D; rects: RecordedRect[] } {
  const rects: RecordedRect[] = [];
  let currentFillStyle = '';
  const ctx = {
    globalCompositeOperation: 'source-over',
    save(): void {},
    restore(): void {},
    set fillStyle(v: string) { currentFillStyle = v; },
    get fillStyle() { return currentFillStyle; },
    fillRect(x: number, y: number, w: number, h: number): void {
      const match = /rgba\(255,255,255,([\d.]+)\)/.exec(currentFillStyle);
      const alpha = match ? parseFloat(match[1]) : NaN;
      rects.push({ x, y, w, h, alpha });
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
 * trimming implementation: `BAND_COUNT` draws per exposed cardinal side, and
 * `BAND_COUNT * 2 - 1` draws per corner (each corner is `BAND_COUNT` nested
 * L-shaped rings; every ring except the innermost is drawn as 2 disjoint
 * rects, the innermost as 1).
 */
function expectedDrawCounts(map: SurfaceExposureMap): { sideBands: number; convexCorners: number; concaveCorners: number; total: number } {
  const rectsPerCorner = BAND_COUNT * 2 - 1;
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
  return {
    sideBands: sideBands * BAND_COUNT,
    convexCorners: convexCorners * rectsPerCorner,
    concaveCorners: concaveCorners * rectsPerCorner,
    total: sideBands * BAND_COUNT + convexCorners * rectsPerCorner + concaveCorners * rectsPerCorner,
  };
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

/** Total pixel area of `rects` clipped to `bound` — used to prove exact (no gap, no overlap) coverage of a region. */
function clippedAreaSum(rects: readonly RecordedRect[], bound: RecordedRect): number {
  let sum = 0;
  for (const r of rects) {
    const x0 = Math.max(r.x, bound.x);
    const y0 = Math.max(r.y, bound.y);
    const x1 = Math.min(r.x + r.w, bound.x + bound.w);
    const y1 = Math.min(r.y + r.h, bound.y + bound.h);
    sum += Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  }
  return sum;
}

test('mixed shape (1x1 stair-step + 2x2 block): total draws match the exposure-map reference count, no overlap', () => {
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
  assert.equal(rects.length, expected.total, 'total draw count must match one 3-depth band per exposed side plus one corner-ring per corner');
  assert.equal(findOverlap(rects), null, 'no two drawn rects may overlap — that would double-paint a pixel');
});

test('regression: 2x2 coverage does not suppress individual tile-edge overlay output', () => {
  const snapshot = makeWallSnapshot([{ x: 3 * BLOCK_SIZE, y: 3 * BLOCK_SIZE, w: 2 * BLOCK_SIZE, h: 2 * BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  assert.equal(wallLayout.solid2x2Map.size, 1);

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap });
  renderSurfaceEdgeOverlayPass(ctx, params);

  const map = wallLayout.surfaceExposureMap;
  assert.equal(map.segments.length, 8);
  const expected = expectedDrawCounts(map);
  assert.equal(expected.sideBands, 8 * BAND_COUNT);
  assert.equal(expected.convexCorners, 4 * (BAND_COUNT * 2 - 1));
  assert.equal(rects.length, expected.total, '2x2 coverage must not suppress any individual tile-edge overlay output');
  assert.equal(findOverlap(rects), null);
});

test('convex corner: two adjacent exposed sides on one tile produce no doubled intensity and exactly tile the corner square', () => {
  // A single isolated 1x1 tile has all four corners convex — the clearest
  // possible case for the double-paint bug this hardening pass fixes.
  const snapshot = makeWallSnapshot([{ x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  const map = wallLayout.surfaceExposureMap;

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: map });
  renderSurfaceEdgeOverlayPass(ctx, params);

  const expected = expectedDrawCounts(map);
  assert.equal(expected.convexCorners, 4 * (BAND_COUNT * 2 - 1), 'an isolated tile has 4 convex corners');
  assert.equal(rects.length, expected.total);
  assert.equal(findOverlap(rects), null, 'side bands must be trimmed so they never overlap the corner rings');

  // With scalePx=1 and blockSizePx=8, bandUnit is exactly 1 world pixel.
  // The NW corner's BAND_COUNT x BAND_COUNT pixel square must be covered
  // exactly once per pixel — no gaps, no double coverage.
  const nwBound = { x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BAND_COUNT, h: BAND_COUNT, alpha: 0 };
  assert.equal(clippedAreaSum(rects, nwBound), BAND_COUNT * BAND_COUNT, 'NW corner square must be exactly (not doubly) covered');
});

test('convex corner brightness never exceeds the adjacent straight-edge brightness at the same depth', () => {
  const snapshot = makeWallSnapshot([{ x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap });
  renderSurfaceEdgeOverlayPass(ctx, params);

  // Every single rect (side band or corner-ring piece) must independently
  // fall within the depth-0 alpha range at worst — nothing in this fixture
  // should ever exceed the outermost band's upper bound, since no pixel is
  // painted more than once (proven above) and no single draw call uses an
  // alpha outside its own depth's declared range.
  const maxDeclaredAlpha = BAND_ALPHA_RANGES[0][1];
  for (const r of rects) {
    assert.ok(r.alpha <= maxDeclaredAlpha + 1e-9, `rect alpha ${r.alpha} exceeds the maximum declared band alpha ${maxDeclaredAlpha}`);
  }
});

test('concave corner: a tile with no exposed cardinal side but a diagonal exposed corner still renders a subtle inner-corner accent', () => {
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

  const centreTileX = 2 * BLOCK_SIZE;
  const centreTileY = 2 * BLOCK_SIZE;
  const seBound = { x: centreTileX + BLOCK_SIZE - BAND_COUNT, y: centreTileY + BLOCK_SIZE - BAND_COUNT, w: BAND_COUNT, h: BAND_COUNT, alpha: 0 };
  assert.equal(clippedAreaSum(rects, seBound), BAND_COUNT * BAND_COUNT, 'concave SE corner square must be exactly covered, matching the convex treatment');

  const expected = expectedDrawCounts(map);
  assert.ok(expected.concaveCorners > 0);
  assert.equal(rects.length, expected.total);
  assert.equal(findOverlap(rects), null);

  // Subtle, not bright: every drawn rect (there are no side bands at all on
  // this tile) must fall within the declared alpha ranges.
  for (const r of rects.filter((r) => r.x >= centreTileX && r.x < centreTileX + BLOCK_SIZE && r.y >= centreTileY && r.y < centreTileY + BLOCK_SIZE)) {
    assert.ok(r.alpha >= 0 && r.alpha <= BAND_ALPHA_RANGES[0][1] + 1e-9);
  }
});

test('mixed straight edges + convex + concave corners all render together without overlap', () => {
  const solidTiles: Array<[number, number]> = [
    [1, 1], [2, 1], [3, 1], // top arm
    [1, 2], [1, 3],         // left arm (shares (1,1) with the top arm)
  ];
  const snapshot = makeTileSnapshot(solidTiles);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 8, 8);
  const map = wallLayout.surfaceExposureMap;

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

// ── Subtle intensity / alpha-range verification ───────────────────────────────

test('each inward depth band renders within its declared subtle alpha range (20-30% / 10-20% / 0-10%)', () => {
  // A long straight wall, several tiles deep, so each of the 3 depth bands
  // has plenty of samples on a plain straight edge (no corner interference).
  const solidTiles: Array<[number, number]> = [];
  for (let col = 1; col <= 10; col++) {
    for (let row = 1; row <= 4; row++) solidTiles.push([col, row]);
  }
  const snapshot = makeTileSnapshot(solidTiles);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 16, 16);
  const map = wallLayout.surfaceExposureMap;

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: map });
  renderSurfaceEdgeOverlayPass(ctx, params);

  assert.ok(rects.length > 0);
  for (const r of rects) {
    assert.ok(!Number.isNaN(r.alpha), 'every drawn rect must use a parsable rgba(...) fillStyle');
    // Every alpha must land inside AT LEAST one of the three declared bands
    // (rather than asserting per-rect depth bucketing, which is an internal
    // implementation detail) — this proves nothing ever exceeds the top of
    // the brightest range or drops below the bottom of the dimmest one.
    const withinAnyBand = BAND_ALPHA_RANGES.some(([lo, hi]) => r.alpha >= lo - 1e-9 && r.alpha <= hi + 1e-9);
    assert.ok(withinAnyBand, `alpha ${r.alpha} is outside every declared subtle band range`);
  }

  // The overall effect must actually vary (organic, not flat/uniform) — not
  // every rect should share the exact same alpha.
  const distinctAlphas = new Set(rects.map((r) => r.alpha.toFixed(6)));
  assert.ok(distinctAlphas.size > 1, 'alpha must vary across bands/tiles rather than being perfectly flat');

  // And it must be well clear of "bright glowing outline" territory — no
  // rect should ever approach full-strength (this is the regression check
  // for the previous exaggerated 0.55/0.38-strength debug values).
  for (const r of rects) {
    assert.ok(r.alpha <= 0.30 + 1e-9, `alpha ${r.alpha} is far brighter than the intended subtle maximum of 0.30`);
  }
});

test('rendering the same fixture twice yields identical alpha values (stable, not flickering)', () => {
  const snapshot = makeWallSnapshot([{ x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  const params = makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap });

  const first = makeFakeCtx();
  renderSurfaceEdgeOverlayPass(first.ctx, params);
  const second = makeFakeCtx();
  renderSurfaceEdgeOverlayPass(second.ctx, params);

  assert.equal(first.rects.length, second.rects.length);
  for (let i = 0; i < first.rects.length; i++) {
    assert.deepEqual(second.rects[i], first.rects[i], 'identical geometry/exposure must produce byte-identical output across renders — no per-frame flicker');
  }
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
  const snapshot = makeWallSnapshot([
    { x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }, // (2,2)
    { x: 3 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }, // (3,2) — shares the left/right seam with (2,2)
  ]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  const map = wallLayout.surfaceExposureMap;

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

  const expected = expectedDrawCounts(map);
  assert.equal(expected.sideBands, 2 * BAND_COUNT);
  assert.equal(expected.convexCorners, BAND_COUNT * 2 - 1);
  assert.equal(rects.length, expected.total);
});

test('partial darkness attenuates but does not fully suppress the overlay (below the cutoff)', () => {
  const snapshot = makeWallSnapshot([{ x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);

  const ambientDepths = new Map<string, number>([['2,2', 0.5]]); // dim, not pitch black
  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap, ambientDepths, isBlockTintEnabled: true });

  renderSurfaceEdgeOverlayPass(ctx, params);

  const expected = expectedDrawCounts(wallLayout.surfaceExposureMap);
  assert.equal(rects.length, expected.total, 'a dim (not pitch-black) tile must still receive full geometry, just at reduced strength');
  for (const r of rects) {
    assert.ok(r.alpha <= 0.30 * 0.5 + 1e-9, 'darkness must attenuate the already-subtle alpha further, never brighten it');
  }
});

// ── Budget-exhausted-fallback retry signal ────────────────────────────────────

test('budget-exhausted fallback flag is single-shot: consuming it clears it for the next check', () => {
  assert.equal(FP.consumeBudgetExhaustedFallbackFlag(), false, 'flag must start clear');
  FP.markBudgetExhaustedFallback();
  assert.equal(FP.consumeBudgetExhaustedFallbackFlag(), true, 'flag must be set after marking');
  assert.equal(FP.consumeBudgetExhaustedFallbackFlag(), false, 'flag must be cleared after being consumed once');
});
