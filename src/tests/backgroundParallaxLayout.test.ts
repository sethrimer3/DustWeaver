import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBackgroundParallaxLayout } from '../render/backgroundRenderer';
import { createCameraState, getCameraOffset } from '../render/camera';

const VIEW_W = 480;
const VIEW_H = 270;
const TILE = 8; // 8 world units per tile

function assertViewportCovered(layout: ReturnType<typeof computeBackgroundParallaxLayout>, viewW: number, viewH: number, label: string) {
  assert.ok(layout.drawX <= 1e-6, `${label}: drawX (${layout.drawX}) must be <= 0 to cover left viewport edge`);
  assert.ok(layout.drawY <= 1e-6, `${label}: drawY (${layout.drawY}) must be <= 0 to cover top viewport edge`);
  assert.ok(
    layout.drawX + layout.bgWidthPx >= viewW - 1e-6,
    `${label}: right edge (${layout.drawX + layout.bgWidthPx}) must be >= viewW (${viewW})`,
  );
  assert.ok(
    layout.drawY + layout.bgHeightPx >= viewH - 1e-6,
    `${label}: bottom edge (${layout.drawY + layout.bgHeightPx}) must be >= viewH (${viewH})`,
  );
}

function assertAspectRatioPreserved(layout: ReturnType<typeof computeBackgroundParallaxLayout>, imgW: number, imgH: number, label: string) {
  const expectedRatio = imgW / imgH;
  const actualRatio = layout.bgWidthPx / layout.bgHeightPx;
  assert.ok(
    Math.abs(expectedRatio - actualRatio) < 1e-9,
    `${label}: aspect ratio (${actualRatio}) must match texture aspect ratio (${expectedRatio})`,
  );
}

test('Small room background sizing and parallax behavior (under 100 tiles)', () => {
  const roomW = 30 * TILE; // 240
  const roomH = 20 * TILE; // 160
  const imgW = 512;
  const imgH = 512;

  // Center camera
  const camera = createCameraState();
  camera.centerXWorld = roomW * 0.5;
  camera.centerYWorld = roomH * 0.5;
  const { offsetXPx, offsetYPx } = getCameraOffset(camera, VIEW_W, VIEW_H);

  const layout = computeBackgroundParallaxLayout(VIEW_W, VIEW_H, offsetXPx, offsetYPx, roomW, roomH, 1, imgW, imgH);
  assert.equal(layout.effectiveParallaxX, 0.2, 'Small room retains base 0.2 parallax factor horizontally');
  assert.equal(layout.effectiveParallaxY, 0.2, 'Small room retains base 0.2 parallax factor vertically');
  assertViewportCovered(layout, VIEW_W, VIEW_H, 'Small room centered');
  assertAspectRatioPreserved(layout, imgW, imgH, 'Small room square texture');
});

test('Medium room (60×40 tiles) covers viewport at all room corners and edges', () => {
  const roomW = 60 * TILE; // 480
  const roomH = 40 * TILE; // 320
  const imgW = 600;
  const imgH = 400;

  const positions = [
    [0, 0, 'Top-left corner'],
    [roomW * 0.5, 0, 'Top edge'],
    [roomW, 0, 'Top-right corner'],
    [0, roomH * 0.5, 'Left edge'],
    [roomW, roomH * 0.5, 'Right edge'],
    [0, roomH, 'Bottom-left corner'],
    [roomW * 0.5, roomH, 'Bottom edge'],
    [roomW, roomH, 'Bottom-right corner'],
  ] as const;

  for (const [camX, camY, label] of positions) {
    const camera = createCameraState();
    camera.centerXWorld = camX;
    camera.centerYWorld = camY;
    const { offsetXPx, offsetYPx } = getCameraOffset(camera, VIEW_W, VIEW_H);

    const layout = computeBackgroundParallaxLayout(VIEW_W, VIEW_H, offsetXPx, offsetYPx, roomW, roomH, 1, imgW, imgH);
    assertViewportCovered(layout, VIEW_W, VIEW_H, label);
    assertAspectRatioPreserved(layout, imgW, imgH, label);
  }
});

test('Very wide room (200×30 tiles) damps horizontal parallax and bounds overscan', () => {
  const roomW = 200 * TILE; // 1600 (2x the 100-tile / 800 world unit threshold)
  const roomH = 30 * TILE; // 240
  const imgW = 1000;
  const imgH = 500;

  const camera = createCameraState();
  camera.centerXWorld = 0; // extreme left
  camera.centerYWorld = roomH * 0.5;
  const { offsetXPx, offsetYPx } = getCameraOffset(camera, VIEW_W, VIEW_H);

  const layout = computeBackgroundParallaxLayout(VIEW_W, VIEW_H, offsetXPx, offsetYPx, roomW, roomH, 1, imgW, imgH);

  // Parallax factor should be halved (800 / 1600 * 0.2 = 0.1) so rapid sliding is prevented.
  assert.equal(layout.effectiveParallaxX, 0.1, 'Horizontal parallax factor damped inversely with size above 100 tiles');
  assert.equal(layout.effectiveParallaxY, 0.2, 'Vertical parallax factor undisturbed for dimension < 100 tiles');

  // Notice that target width is modest (viewport + bounded overscan) rather than full room size (1600).
  assert.ok(layout.targetWidthPx < 700, 'Target width must remain compact (modest overscan), not scaled to 1600px room width');
  assertViewportCovered(layout, VIEW_W, VIEW_H, 'Very wide room at extreme left');
  assertAspectRatioPreserved(layout, imgW, imgH, 'Very wide room texture');
});

test('Very tall room (30×200 tiles) damps vertical parallax and covers viewport', () => {
  const roomW = 30 * TILE; // 240
  const roomH = 200 * TILE; // 1600
  const imgW = 512;
  const imgH = 512;

  const camera = createCameraState();
  camera.centerXWorld = roomW * 0.5;
  camera.centerYWorld = roomH; // extreme bottom
  const { offsetXPx, offsetYPx } = getCameraOffset(camera, VIEW_W, VIEW_H);

  const layout = computeBackgroundParallaxLayout(VIEW_W, VIEW_H, offsetXPx, offsetYPx, roomW, roomH, 1, imgW, imgH);

  assert.equal(layout.effectiveParallaxY, 0.1, 'Vertical parallax factor damped above 100 tiles');
  assert.ok(layout.targetHeightPx < 500, 'Target height remains modest rather than scaling to 1600px room height');
  assertViewportCovered(layout, VIEW_W, VIEW_H, 'Very tall room at extreme bottom');
});

test('100+ tile huge room in both axes (300×300 tiles) maintains consistent subtle parallax and zero empty edges', () => {
  const roomW = 300 * TILE; // 2400
  const roomH = 300 * TILE; // 2400
  const imgW = 1200;
  const imgH = 800;

  const camera = createCameraState();
  camera.centerXWorld = roomW; // bottom-right extreme corner
  camera.centerYWorld = roomH;
  const { offsetXPx, offsetYPx } = getCameraOffset(camera, VIEW_W, VIEW_H);

  const layout = computeBackgroundParallaxLayout(VIEW_W, VIEW_H, offsetXPx, offsetYPx, roomW, roomH, 1, imgW, imgH);

  assert.ok(layout.effectiveParallaxX < 0.07, 'Horizontal parallax damped heavily for 300-tile room');
  assert.ok(layout.effectiveParallaxY < 0.07, 'Vertical parallax damped heavily for 300-tile room');

  // Maximum parallax shift should be capped exactly as in a 100-tile room (800 * 0.5 * 0.2 = 80px shift -> 160px overscan).
  assert.equal(layout.requiredOverscanX, 160, 'Horizontal required overscan capped at 160px regardless of room size >100 tiles');
  assert.equal(layout.requiredOverscanY, 160, 'Vertical required overscan capped at 160px regardless of room size >100 tiles');
  assert.equal(layout.targetWidthPx, VIEW_W + 160, 'Target width is viewport + modest overscan');
  assert.equal(layout.targetHeightPx, VIEW_H + 160, 'Target height is viewport + modest overscan');

  assertViewportCovered(layout, VIEW_W, VIEW_H, 'Huge 300×300 room corner');
  assertAspectRatioPreserved(layout, imgW, imgH, 'Huge 300×300 room');
});

test('Extreme out-of-bounds camera panning clamps parallax offset to prevent revealing edges', () => {
  const roomW = 50 * TILE;
  const roomH = 50 * TILE;
  const imgW = 500;
  const imgH = 500;

  // Simulate an extreme camera offset far outside room bounds (e.g. editor debug panning or screen knockback)
  const offsetXPx = -10000;
  const offsetYPx = 10000;

  const layout = computeBackgroundParallaxLayout(VIEW_W, VIEW_H, offsetXPx, offsetYPx, roomW, roomH, 1, imgW, imgH);
  assertViewportCovered(layout, VIEW_W, VIEW_H, 'Extreme out-of-bounds pan');
});
