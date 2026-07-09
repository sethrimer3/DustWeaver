import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WallSnapshot } from '../render/snapshotTypes';
import { getWallLayoutCache } from '../render/walls/blockWallLayoutCache';
import { renderSurfaceEdgeOverlayPass, type SurfaceEdgeOverlayParams } from '../render/walls/surfaceEdgeOverlay';
import * as FP from '../debug/perfFreezeProfiler';

/**
 * Coverage for the guaranteed surface-edge overlay pass (`renderSurfaceEdgeOverlayPass`
 * in surfaceEdgeOverlay.ts) — the fix for the sporadic wall-edge highlight bug.
 * Unlike the sprite-baked `applyOrganicEdgeShading` treatment, this pass reads
 * directly from `wallLayout.surfaceExposureMap.segments` and must draw every
 * exposed segment regardless of 2x2 grouping or sprite-bake fallback state.
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

test('mixed shape (1x1 stair-step + 2x2 block): every surfaceExposureMap segment is drawn by the overlay pass', () => {
  // A 2x2 solid block plus an adjoining 1x1 stair-step tile, so the fixture
  // exercises both the 2x2-covered path and the plain 1x1 path in one layout.
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

  const segments = wallLayout.surfaceExposureMap.segments;
  assert.ok(segments.length > 0, 'fixture must have exposed segments');
  // Every exposed segment must produce exactly one drawn rect.
  assert.equal(rects.length, segments.length, 'overlay must draw exactly one band per exposed segment');
});

test('regression: 2x2 coverage does not suppress individual tile-edge overlay output', () => {
  // A lone 2x2 block, fully surrounded by open air. Even though render1x1Pass
  // skips these cells entirely (coveredBy2x2Keys), the overlay pass must still
  // emit a band for every exposed side of every one of the 4 constituent tiles
  // — this pass never reads coveredBy2x2Keys at all, only surfaceExposureMap.
  const snapshot = makeWallSnapshot([{ x: 3 * BLOCK_SIZE, y: 3 * BLOCK_SIZE, w: 2 * BLOCK_SIZE, h: 2 * BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  assert.equal(wallLayout.solid2x2Map.size, 1);

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap });

  renderSurfaceEdgeOverlayPass(ctx, params);

  // Each of the 4 tiles has exactly 2 exposed outer-perimeter sides (corner of a 2x2 block).
  assert.equal(wallLayout.surfaceExposureMap.segments.length, 8);
  assert.equal(rects.length, 8, '2x2 coverage must not suppress any individual tile-edge overlay output');
});

test('darkness attenuation: fully dark tiles are skipped so the overlay does not glow through darkness', () => {
  const snapshot = makeWallSnapshot([{ x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);

  const ambientDepths = new Map<string, number>([['2,2', 1]]); // pitch black
  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap, ambientDepths, isBlockTintEnabled: true });

  renderSurfaceEdgeOverlayPass(ctx, params);

  assert.equal(rects.length, 0, 'fully dark tile must not receive any overlay band');
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

  const inRangeSegments = wallLayout.surfaceExposureMap.segments.filter((s) => s.col <= 4 && s.row <= 4);
  assert.equal(rects.length, inRangeSegments.length);
  assert.ok(rects.length < wallLayout.surfaceExposureMap.segments.length, 'fixture must have at least one out-of-range segment excluded');
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

  // Every drawn rect must correspond to a real segment — i.e. exactly one
  // band per segment, none extra for the seam.
  assert.equal(rects.length, map.segments.length);
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

  // Only the two genuinely-exposed sides (right, bottom) should draw.
  assert.equal(rects.length, 2);
  assert.equal(map.segments.length, 2);
});

test('partial darkness attenuates but does not fully suppress the overlay (below the cutoff)', () => {
  // Distinguishes "attenuate" from "skip": a tile that is dimly lit (not at
  // the full-darkness cutoff) should still receive a band, just weaker.
  const snapshot = makeWallSnapshot([{ x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);

  const ambientDepths = new Map<string, number>([['2,2', 0.5]]); // dim, not pitch black
  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap, ambientDepths, isBlockTintEnabled: true });

  renderSurfaceEdgeOverlayPass(ctx, params);

  assert.equal(rects.length, wallLayout.surfaceExposureMap.segments.length, 'a dim (not pitch-black) tile must still receive a band per exposed side');
});

// ── Budget-exhausted-fallback retry signal ────────────────────────────────────

test('budget-exhausted fallback flag is single-shot: consuming it clears it for the next check', () => {
  assert.equal(FP.consumeBudgetExhaustedFallbackFlag(), false, 'flag must start clear');
  FP.markBudgetExhaustedFallback();
  assert.equal(FP.consumeBudgetExhaustedFallbackFlag(), true, 'flag must be set after marking');
  assert.equal(FP.consumeBudgetExhaustedFallbackFlag(), false, 'flag must be cleared after being consumed once');
});
