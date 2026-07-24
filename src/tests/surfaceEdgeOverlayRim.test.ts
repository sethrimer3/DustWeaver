import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WallSnapshot } from '../render/snapshotTypes';
import { getWallLayoutCache } from '../render/walls/blockWallLayoutCache';
import { renderSurfaceEdgeOverlayPass, type SurfaceEdgeOverlayParams } from '../render/walls/surfaceEdgeOverlay';
import { normalizeSurfaceRimStyle } from '../render/walls/surfaceRimStyle';

/**
 * Coverage for the generalized Surface Rim modes layered onto
 * `renderSurfaceEdgeOverlayPass` via `SurfaceEdgeOverlayParams.getStyleForTile`.
 * A 'default'/absent style must reproduce the original hard-coded overlay
 * byte-for-byte (see surfaceEdgeOverlay.test.ts for that coverage); this file
 * covers 'none' / 'solid' / 'gradient' / 'inverted'.
 */

const BLOCK_SIZE = 8;

function makeWallSnapshot(rects: Array<{ x: number; y: number; w: number; h: number }>): WallSnapshot {
  const count = rects.length;
  const xWorld = new Float32Array(count);
  const yWorld = new Float32Array(count);
  const wWorld = new Float32Array(count);
  const hWorld = new Float32Array(count);
  rects.forEach((r, i) => {
    xWorld[i] = r.x; yWorld[i] = r.y; wWorld[i] = r.w; hWorld[i] = r.h;
  });
  return {
    count, xWorld, yWorld, wWorld, hWorld,
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

interface RecordedRect { x: number; y: number; w: number; h: number; fillStyle: string }

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
      rects.push({ x, y, w, h, fillStyle: currentFillStyle });
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

function findOverlap(rects: readonly RecordedRect[]): [RecordedRect, RecordedRect] | null {
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]; const b = rects[j];
      const overlapsX = a.x < b.x + b.w && a.x + a.w > b.x;
      const overlapsY = a.y < b.y + b.h && a.y + a.h > b.y;
      if (overlapsX && overlapsY) return [a, b];
    }
  }
  return null;
}

test("'none' mode: suppresses all overlay output for that tile, unaffected tiles unchanged", () => {
  // Two separate 1x1 blocks so each has a fully independent exposure mask.
  const snapshot = makeWallSnapshot([
    { x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE },
    { x: 8 * BLOCK_SIZE, y: 8 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE },
  ]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 20, 20);

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({
    surfaceExposureMap: wallLayout.surfaceExposureMap,
    getStyleForTile: (col, row) => (col === 2 && row === 2) ? normalizeSurfaceRimStyle({ mode: 'none' }) : null,
  });
  renderSurfaceEdgeOverlayPass(ctx, params);

  // No rect should fall within the (2,2) tile's bounds.
  const tileBound = { x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE };
  for (const r of rects) {
    const overlapsX = r.x < tileBound.x + tileBound.w && r.x + r.w > tileBound.x;
    const overlapsY = r.y < tileBound.y + tileBound.h && r.y + r.h > tileBound.y;
    assert.ok(!(overlapsX && overlapsY), `'none' tile must produce zero overlay draws, found ${JSON.stringify(r)}`);
  }
  assert.ok(rects.length > 0, 'the unaffected (8,8) tile must still render normally');
});

test("'solid' mode: constant strength across all bands (no inward falloff)", () => {
  const snapshot = makeWallSnapshot([{ x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  const style = normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff0000', widthPx: 3, opacity: 0.5 });

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap, getStyleForTile: () => style });
  renderSurfaceEdgeOverlayPass(ctx, params);

  assert.ok(rects.length > 0);
  for (const r of rects) {
    assert.match(r.fillStyle, /rgba\(255,0,0,0\.5\)/, `solid mode must use flat opacity, got ${r.fillStyle}`);
  }
});

test("'gradient' mode: strength falls off inward (outer band strictly stronger than inner band)", () => {
  const snapshot = makeWallSnapshot([{ x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  const style = normalizeSurfaceRimStyle({ mode: 'gradient', color: '00ff00', widthPx: 3, opacity: 0.6, falloff: 'linear' });

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap, getStyleForTile: () => style });
  renderSurfaceEdgeOverlayPass(ctx, params);

  const alphas = rects.map(r => parseFloat(/rgba\(0,255,0,([\d.]+)\)/.exec(r.fillStyle)?.[1] ?? 'NaN'));
  assert.ok(alphas.every(a => !Number.isNaN(a)));
  const maxAlpha = Math.max(...alphas);
  const minAlpha = Math.min(...alphas);
  assert.ok(maxAlpha > minAlpha, 'gradient must vary strength across depth bands');
  assert.ok(Math.abs(maxAlpha - style.opacity) < 1e-6, 'outermost band should hit full configured opacity');
});

test("'inverted' mode: adds an interior darken rect beyond the rim band width, scaled by interiorDarkness", () => {
  const snapshot = makeWallSnapshot([{ x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  const style = normalizeSurfaceRimStyle({ mode: 'inverted', color: 'ffffff', widthPx: 2, opacity: 0.3, interiorDarkness: 0.8 });

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap, getStyleForTile: () => style });
  renderSurfaceEdgeOverlayPass(ctx, params);

  const darkenRects = rects.filter(r => /rgba\(0,0,0,/.test(r.fillStyle));
  assert.equal(darkenRects.length, 1, 'exactly one interior darken rect per inverted tile');
  assert.match(darkenRects[0].fillStyle, /rgba\(0,0,0,0\.8\)/);
});

test('custom styles never overlap each other or the trimmed side bands (no double-painting)', () => {
  const snapshot = makeWallSnapshot([
    { x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: 2 * BLOCK_SIZE, h: 2 * BLOCK_SIZE },
  ]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);
  const style = normalizeSurfaceRimStyle({ mode: 'gradient', color: '3366ff', widthPx: 3, opacity: 0.4, falloff: 'smooth' });

  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap, getStyleForTile: () => style });
  renderSurfaceEdgeOverlayPass(ctx, params);

  assert.equal(findOverlap(rects), null, 'no two drawn rects may overlap under a custom style either');
});

test("'default' style from the resolver reproduces the exact same draw count as no resolver at all", () => {
  const snapshot = makeWallSnapshot([{ x: 2 * BLOCK_SIZE, y: 2 * BLOCK_SIZE, w: BLOCK_SIZE, h: BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 10, 10);

  const baseline = makeFakeCtx();
  renderSurfaceEdgeOverlayPass(baseline.ctx, makeParams({ surfaceExposureMap: wallLayout.surfaceExposureMap }));

  const withDefault = makeFakeCtx();
  renderSurfaceEdgeOverlayPass(withDefault.ctx, makeParams({
    surfaceExposureMap: wallLayout.surfaceExposureMap,
    getStyleForTile: () => normalizeSurfaceRimStyle({ mode: 'default' }),
  }));

  assert.deepEqual(withDefault.rects, baseline.rects);
});
