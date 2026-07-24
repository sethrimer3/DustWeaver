import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WallSnapshot } from '../render/snapshotTypes';
import { getWallLayoutCache } from '../render/walls/blockWallLayoutCache';
import { CHUNK_SIZE_BLOCKS } from '../render/walls/chunkRenderCache';
import { normalizeSurfaceRimStyle, type SurfaceRimStyle } from '../render/walls/surfaceRimStyle';
import { renderSurfaceEdgeOverlayPass } from '../render/walls/surfaceEdgeOverlay';

const B = 8;

interface WallSpec {
  x: number; y: number; w: number; h: number;
  style?: SurfaceRimStyle;
  platform?: number;
  shape?: number;
  pillar?: boolean;
}

function snapshot(specs: WallSpec[], styleTable?: SurfaceRimStyle[]): WallSnapshot {
  const table = styleTable ?? specs.flatMap(s => s.style ? [s.style] : []);
  const count = specs.length;
  const result: WallSnapshot = {
    count,
    xWorld: Float32Array.from(specs.map(s => s.x)),
    yWorld: Float32Array.from(specs.map(s => s.y)),
    wWorld: Float32Array.from(specs.map(s => s.w)),
    hWorld: Float32Array.from(specs.map(s => s.h)),
    isPlatformFlag: Uint8Array.from(specs.map(s => s.platform === undefined ? 0 : 1)),
    platformEdge: Uint8Array.from(specs.map(s => s.platform ?? 0)),
    themeIndex: new Uint8Array(count).fill(255),
    isInvisibleFlag: new Uint8Array(count),
    rampOrientationIndex: Uint8Array.from(specs.map(s => s.shape ?? 255)),
    isPillarHalfWidthFlag: Uint8Array.from(specs.map(s => s.pillar ? 1 : 0)),
    surfaceRimStyleIndex: Uint16Array.from(specs.map(s => s.style ? table.indexOf(s.style) : 0xFFFF)),
    surfaceRimStyleTable: table,
  };
  return result;
}

function pixelsFor(widthPx: number, w = 48, h = 48) {
  const style = normalizeSurfaceRimStyle({
    mode: 'gradient', color: 'ff0000', widthPx, opacity: 1, falloff: 'linear',
  });
  return getWallLayoutCache(snapshot([{ x: 16, y: 16, w, h, style }]), B, 20, 20)
    .customSurfaceRimPixels;
}

for (const width of [1, 3, 8, 9, 16, 32]) {
  test(`world-pixel width ${width} is exact and remains inside solid geometry`, () => {
    const pixels = pixelsFor(width);
    assert.ok(pixels.length > 0);
    assert.ok(pixels.every(p => p.xWorldPx >= 16 && p.xWorldPx < 64
      && p.yWorldPx >= 16 && p.yWorldPx < 64));
    assert.equal(Math.max(...pixels.map(p => p.distancePx)), Math.min(width - 1, 23));
    assert.ok(pixels.some(p => p.distancePx === Math.min(width - 1, 23)));
    assert.equal(new Set(pixels.map(p => `${p.xWorldPx},${p.yWorldPx}`)).size, pixels.length);
  });
}

test('wide rims cross tile boundaries', () => {
  const pixels = pixelsFor(16);
  assert.ok(pixels.some(p => p.distancePx >= B));
});

test('adjacent styles keep ownership and the solid seam receives no rim', () => {
  const red = normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff0000', widthPx: 8 });
  const green = normalizeSurfaceRimStyle({ mode: 'solid', color: '00ff00', widthPx: 8 });
  const layout = getWallLayoutCache(snapshot([
    { x: 16, y: 16, w: 16, h: 24, style: red },
    { x: 32, y: 16, w: 16, h: 24, style: green },
  ]), B, 20, 20);
  const seamInterior = layout.customSurfaceRimPixels.filter(p =>
    (p.xWorldPx === 31 || p.xWorldPx === 32) && p.yWorldPx === 28);
  assert.equal(seamInterior.length, 0);
  assert.ok(layout.customSurfaceRimPixels.some(p => p.style.color === 'ff0000'));
  assert.ok(layout.customSurfaceRimPixels.some(p => p.style.color === '00ff00'));
});

test('inverted distance is world-pixel based and saturates at widthPx', () => {
  const style = normalizeSurfaceRimStyle({
    mode: 'inverted', widthPx: 9, interiorDarkness: 0.8, falloff: 'linear',
  });
  const pixels = getWallLayoutCache(
    snapshot([{ x: 8, y: 8, w: 40, h: 40, style }]), B, 10, 10,
  ).customSurfaceRimPixels;
  assert.equal(pixels.find(p => p.xWorldPx === 8 && p.yWorldPx === 8)?.distancePx, 0);
  assert.equal(pixels.find(p => p.xWorldPx === 17 && p.yWorldPx === 17)?.distancePx, 9);
});

test('platform, stair, ramp, half-width pillar, and rectangle pixels are clipped to visible geometry', () => {
  const style = normalizeSurfaceRimStyle({ mode: 'solid', widthPx: 3 });
  const specs: WallSpec[] = [
    { x: 8, y: 8, w: 8, h: 8, style, platform: 0 },
    { x: 24, y: 8, w: 8, h: 8, style, shape: 4 },
    { x: 40, y: 8, w: 8, h: 8, style, shape: 0 },
    { x: 56, y: 8, w: 4, h: 8, style, pillar: true },
    { x: 72, y: 8, w: 8, h: 8, style },
  ];
  const pixels = getWallLayoutCache(snapshot(specs), B, 20, 20).customSurfaceRimPixels;
  assert.equal(pixels.some(p => p.xWorldPx >= 8 && p.xWorldPx < 16 && p.yWorldPx >= 11), false);
  assert.equal(pixels.some(p => p.xWorldPx === 24 && p.yWorldPx === 8), false);
  assert.equal(pixels.some(p => p.xWorldPx === 40 && p.yWorldPx === 8), false);
  assert.equal(pixels.some(p => p.xWorldPx >= 60 && p.xWorldPx < 64), false);
  assert.ok(pixels.some(p => p.xWorldPx >= 72 && p.xWorldPx < 80));
});

test('style-table content participates in gameplay cache signature', () => {
  const red = normalizeSurfaceRimStyle({ mode: 'solid', color: 'ff0000' });
  const blue = normalizeSurfaceRimStyle({ mode: 'solid', color: '0000ff' });
  const a = getWallLayoutCache(snapshot([{ x: 8, y: 8, w: 8, h: 8, style: red }], [red]), B, 10, 10);
  const b = getWallLayoutCache(snapshot([{ x: 8, y: 8, w: 8, h: 8, style: blue }], [blue]), B, 10, 10);
  assert.notEqual(a.signature, b.signature);
  assert.notEqual(a, b);
});

test('cache reuses same-geometry/style layouts across room snapshots', () => {
  const style = normalizeSurfaceRimStyle({ mode: 'solid', color: 'abcdef' });
  const a = getWallLayoutCache(snapshot([{ x: 8, y: 8, w: 8, h: 8, style }]), B, 10, 10);
  const b = getWallLayoutCache(snapshot([{ x: 8, y: 8, w: 8, h: 8, style }]), B, 10, 10);
  assert.equal(a, b);
});

test('no custom style performs no pixel-distance construction', () => {
  const layout = getWallLayoutCache(snapshot([{ x: 8, y: 8, w: 32, h: 32 }]), B, 10, 10);
  assert.equal(layout.customSurfaceRimPixels.length, 0);
  assert.equal(layout.customSurfaceRimByChunkKey.size, 0);
});

test('none mode performs no pixel-distance construction', () => {
  const style = normalizeSurfaceRimStyle({ mode: 'none' });
  const layout = getWallLayoutCache(snapshot([{ x: 8, y: 8, w: 32, h: 32, style }]), B, 10, 10);
  assert.equal(layout.customSurfaceRimPixels.length, 0);
  assert.equal(layout.customSurfaceRimByChunkKey.size, 0);
});

test('custom buckets contain only their chunk pixels', () => {
  const style = normalizeSurfaceRimStyle({ mode: 'solid', widthPx: 3 });
  const layout = getWallLayoutCache(snapshot([{ x: 8, y: 8, w: 400, h: 8, style }]), B, 60, 10);
  assert.ok(layout.customSurfaceRimByChunkKey.size > 1);
  for (const [key, pixels] of layout.customSurfaceRimByChunkKey) {
    const [cx, cy] = key.split(',').map(Number);
    assert.ok(pixels.every(p =>
      Math.floor(Math.floor(p.xWorldPx / B) / CHUNK_SIZE_BLOCKS) === cx
      && Math.floor(Math.floor(p.yWorldPx / B) / CHUNK_SIZE_BLOCKS) === cy));
  }
});

test('rendered custom pixels stay in geometry and are painted exactly once', () => {
  const style = normalizeSurfaceRimStyle({
    mode: 'inverted', color: 'ff8000', widthPx: 16, interiorDarkness: 0.75,
  });
  const layout = getWallLayoutCache(snapshot([{ x: 16, y: 16, w: 40, h: 40, style }]), B, 10, 10);
  const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  const ctx = {
    globalCompositeOperation: 'source-over',
    save() {}, restore() {},
    set fillStyle(_value: string) {},
    fillRect(x: number, y: number, w: number, h: number) { rects.push({ x, y, w, h }); },
  } as unknown as CanvasRenderingContext2D;
  renderSurfaceEdgeOverlayPass(ctx, {
    surfaceExposureMap: { masks: new Map(), segments: [], concaveCorners: [] },
    ambientDepths: null,
    isBlockTintEnabled: false,
    offsetXPx: 0, offsetYPx: 0, scalePx: 1, blockSizePx: B,
    filterColMinBlocks: 0, filterColMaxBlocks: 10,
    filterRowMinBlocks: 0, filterRowMaxBlocks: 10,
    customRimPixels: layout.customSurfaceRimPixels,
  });
  assert.ok(rects.every(r => r.w === 1 && r.h === 1
    && r.x >= 16 && r.x < 56 && r.y >= 16 && r.y < 56));
  assert.equal(new Set(rects.map(r => `${r.x},${r.y}`)).size, rects.length);
});
