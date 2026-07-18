import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRenderViewportMetrics,
  computeVisibleWorldBounds,
  resetCanvasPass,
  resizeCanvasBackingStore,
} from '../render/canvasViewport';

test('viewport metrics preserve the CSS aspect ratio at initial creation', () => {
  const metrics = computeRenderViewportMetrics(1920, 1080, 1920, 1080, 1, 270);
  assert.deepEqual(metrics, {
    cssWidthPx: 1920,
    cssHeightPx: 1080,
    renderScale: 1,
    backingWidthPx: 1920,
    backingHeightPx: 1080,
    logicalWidthPx: 480,
    logicalHeightPx: 270,
  });
});

test('width-only, height-only, and simultaneous CSS changes update both axes', () => {
  const widthOnly = computeRenderViewportMetrics(1600, 1080, 1920, 1080, 1, 270);
  assert.equal(widthOnly.backingWidthPx, 1600);
  assert.equal(widthOnly.backingHeightPx, 1080);
  assert.equal(widthOnly.logicalWidthPx, 400);

  const heightOnly = computeRenderViewportMetrics(1920, 900, 1920, 1080, 1, 270);
  assert.equal(heightOnly.backingWidthPx, 1920);
  assert.equal(heightOnly.backingHeightPx, 900);
  assert.equal(heightOnly.logicalWidthPx, 576);

  const both = computeRenderViewportMetrics(1280, 800, 1920, 1080, 1, 270);
  assert.equal(both.backingWidthPx, 1728);
  assert.equal(both.backingHeightPx, 1080);
  assert.equal(both.logicalWidthPx, 432);
});

test('DPR changes resize the backing store without changing logical viewport', () => {
  const one = computeRenderViewportMetrics(1920, 1080, 1920, 1080, 1, 270);
  const two = computeRenderViewportMetrics(1920, 1080, 1920, 1080, 2, 270);
  assert.equal(two.backingWidthPx, one.backingWidthPx * 2);
  assert.equal(two.backingHeightPx, one.backingHeightPx * 2);
  assert.equal(two.logicalWidthPx, one.logicalWidthPx);
  assert.equal(two.logicalHeightPx, one.logicalHeightPx);
});

test('repeated resize cycles keep every target matched to authoritative dimensions', () => {
  const target = { width: 1, height: 1 };
  const cycles = [
    computeRenderViewportMetrics(1920, 1080, 1920, 1080, 1, 270),
    computeRenderViewportMetrics(1080, 1920, 1920, 1080, 2, 360),
    computeRenderViewportMetrics(2560, 1080, 2560, 1440, 1.25, 540),
    computeRenderViewportMetrics(1920, 1080, 1920, 1080, 1, 270),
  ];
  for (const metrics of cycles) {
    resizeCanvasBackingStore(target, metrics.backingWidthPx, metrics.backingHeightPx);
    assert.equal(target.width, metrics.backingWidthPx);
    assert.equal(target.height, metrics.backingHeightPx);
  }
});

test('camera-visible world bounds move without changing viewport coverage', () => {
  const start = computeVisibleWorldBounds(0, 0, 2, 480, 270);
  const moved = computeVisibleWorldBounds(-320, -180, 2, 480, 270);
  assert.deepEqual(start, { leftWorld: 0, topWorld: 0, rightWorld: 240, bottomWorld: 135 });
  assert.deepEqual(moved, { leftWorld: 160, topWorld: 90, rightWorld: 400, bottomWorld: 225 });
});

test('frame boundary resets state and clears the full backing store in identity space', () => {
  const calls: unknown[][] = [];
  const context = {
    globalAlpha: 0.25,
    globalCompositeOperation: 'multiply' as GlobalCompositeOperation,
    imageSmoothingEnabled: true,
    reset: () => calls.push(['reset']),
    setTransform: (...args: number[]) => calls.push(['setTransform', ...args]),
    clearRect: (...args: number[]) => calls.push(['clearRect', ...args]),
  };
  resetCanvasPass(context, 3840, 2160, false);
  assert.deepEqual(calls, [
    ['reset'],
    ['setTransform', 1, 0, 0, 1, 0, 0],
    ['clearRect', 0, 0, 3840, 2160],
  ]);
  assert.equal(context.globalAlpha, 1);
  assert.equal(context.globalCompositeOperation, 'source-over');
  assert.equal(context.imageSmoothingEnabled, false);
});
