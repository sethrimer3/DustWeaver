import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCameraState, getCameraOffset } from '../render/camera';
import {
  MIN_EDITOR_ZOOM,
  MAX_EDITOR_ZOOM,
  EDITOR_ZOOM_STEP,
  clampEditorZoom,
  setEditorZoom,
  applyEditorZoomInput,
  panEditorCameraByScreenDelta,
} from '../editor/editorCamera';

const VIEWPORT_W = 800;
const VIEWPORT_H = 600;

test('clampEditorZoom clamps to [MIN_EDITOR_ZOOM, MAX_EDITOR_ZOOM]', () => {
  assert.equal(clampEditorZoom(0.001), MIN_EDITOR_ZOOM);
  assert.equal(clampEditorZoom(1000), MAX_EDITOR_ZOOM);
  assert.equal(clampEditorZoom(2), 2);
});

test('setEditorZoom clamps at the minimum limit', () => {
  const camera = createCameraState();
  camera.centerXWorld = 100;
  camera.centerYWorld = 100;
  const { offsetXPx, offsetYPx } = getCameraOffset(camera, VIEWPORT_W, VIEWPORT_H);
  setEditorZoom(camera, MIN_EDITOR_ZOOM / 2, VIEWPORT_W / 2, VIEWPORT_H / 2, offsetXPx, offsetYPx);
  assert.equal(camera.zoom, MIN_EDITOR_ZOOM);
});

test('setEditorZoom clamps at the maximum limit', () => {
  const camera = createCameraState();
  camera.centerXWorld = 100;
  camera.centerYWorld = 100;
  const { offsetXPx, offsetYPx } = getCameraOffset(camera, VIEWPORT_W, VIEWPORT_H);
  setEditorZoom(camera, MAX_EDITOR_ZOOM * 2, VIEWPORT_W / 2, VIEWPORT_H / 2, offsetXPx, offsetYPx);
  assert.equal(camera.zoom, MAX_EDITOR_ZOOM);
});

test('setEditorZoom keeps the world point under the anchor stationary on screen', () => {
  const camera = createCameraState();
  camera.centerXWorld = 300;
  camera.centerYWorld = 200;
  camera.zoom = 1;

  const anchorXPx = 550; // arbitrary point on screen, not the viewport center
  const anchorYPx = 180;

  const { offsetXPx, offsetYPx } = getCameraOffset(camera, VIEWPORT_W, VIEWPORT_H);
  const worldXBefore = (anchorXPx - offsetXPx) / camera.zoom;
  const worldYBefore = (anchorYPx - offsetYPx) / camera.zoom;

  setEditorZoom(camera, 4, anchorXPx, anchorYPx, offsetXPx, offsetYPx);
  assert.equal(camera.zoom, 4);

  const newOffset = getCameraOffset(camera, VIEWPORT_W, VIEWPORT_H);
  const worldXAfter = (anchorXPx - newOffset.offsetXPx) / camera.zoom;
  const worldYAfter = (anchorYPx - newOffset.offsetYPx) / camera.zoom;

  assert.ok(Math.abs(worldXAfter - worldXBefore) < 1e-9, `worldX drifted: ${worldXBefore} -> ${worldXAfter}`);
  assert.ok(Math.abs(worldYAfter - worldYBefore) < 1e-9, `worldY drifted: ${worldYBefore} -> ${worldYAfter}`);
});

test('setEditorZoom is a no-op when the clamped target equals the current zoom', () => {
  const camera = createCameraState();
  camera.centerXWorld = 42;
  camera.centerYWorld = 42;
  camera.zoom = MAX_EDITOR_ZOOM;
  const { offsetXPx, offsetYPx } = getCameraOffset(camera, VIEWPORT_W, VIEWPORT_H);
  setEditorZoom(camera, MAX_EDITOR_ZOOM * 10, 10, 10, offsetXPx, offsetYPx);
  assert.equal(camera.centerXWorld, 42);
  assert.equal(camera.centerYWorld, 42);
});

test('applyEditorZoomInput: wheel zoom only applies when wheelZoomAllowed is true', () => {
  const camera = createCameraState();
  const { offsetXPx, offsetYPx } = getCameraOffset(camera, VIEWPORT_W, VIEWPORT_H);

  // Wheel delta present but zoom not allowed (e.g. non-Select tool) — no change.
  applyEditorZoomInput(camera, -1, false, false, false, 400, 300, 400, 300, offsetXPx, offsetYPx);
  assert.equal(camera.zoom, 1);

  // Same delta, now allowed — zoom changes.
  applyEditorZoomInput(camera, -1, true, false, false, 400, 300, 400, 300, offsetXPx, offsetYPx);
  assert.equal(camera.zoom, EDITOR_ZOOM_STEP);
});

test('applyEditorZoomInput: negative wheelDelta (scroll up) zooms in, positive zooms out', () => {
  const cameraIn = createCameraState();
  const offIn = getCameraOffset(cameraIn, VIEWPORT_W, VIEWPORT_H);
  applyEditorZoomInput(cameraIn, -1, true, false, false, 400, 300, 400, 300, offIn.offsetXPx, offIn.offsetYPx);
  assert.ok(cameraIn.zoom > 1);

  const cameraOut = createCameraState();
  const offOut = getCameraOffset(cameraOut, VIEWPORT_W, VIEWPORT_H);
  applyEditorZoomInput(cameraOut, 1, true, false, false, 400, 300, 400, 300, offOut.offsetXPx, offOut.offsetYPx);
  assert.ok(cameraOut.zoom < 1);
});

test('applyEditorZoomInput: isZoomInPressed / isZoomOutPressed work regardless of wheelZoomAllowed', () => {
  const cameraIn = createCameraState();
  const offIn = getCameraOffset(cameraIn, VIEWPORT_W, VIEWPORT_H);
  applyEditorZoomInput(cameraIn, 0, false, true, false, 400, 300, 400, 300, offIn.offsetXPx, offIn.offsetYPx);
  assert.equal(cameraIn.zoom, EDITOR_ZOOM_STEP);

  const cameraOut = createCameraState();
  const offOut = getCameraOffset(cameraOut, VIEWPORT_W, VIEWPORT_H);
  applyEditorZoomInput(cameraOut, 0, false, false, true, 400, 300, 400, 300, offOut.offsetXPx, offOut.offsetYPx);
  assert.equal(cameraOut.zoom, 1 / EDITOR_ZOOM_STEP);
});

test('panEditorCameraByScreenDelta keeps middle-drag movement 1:1 at the current zoom', () => {
  const camera = createCameraState();
  camera.centerXWorld = 100;
  camera.centerYWorld = 200;
  camera.zoom = 2;

  panEditorCameraByScreenDelta(camera, 40, -20);

  assert.equal(camera.centerXWorld, 80);
  assert.equal(camera.centerYWorld, 210);
});

test('repeated zoom steps clamp cleanly at the limits without drifting past them', () => {
  const camera = createCameraState();
  let offset = getCameraOffset(camera, VIEWPORT_W, VIEWPORT_H);
  for (let i = 0; i < 100; i++) {
    applyEditorZoomInput(camera, -1, true, false, false, 400, 300, 400, 300, offset.offsetXPx, offset.offsetYPx);
    offset = getCameraOffset(camera, VIEWPORT_W, VIEWPORT_H);
  }
  assert.equal(camera.zoom, MAX_EDITOR_ZOOM);

  for (let i = 0; i < 200; i++) {
    applyEditorZoomInput(camera, 1, true, false, false, 400, 300, 400, 300, offset.offsetXPx, offset.offsetYPx);
    offset = getCameraOffset(camera, VIEWPORT_W, VIEWPORT_H);
  }
  assert.equal(camera.zoom, MIN_EDITOR_ZOOM);
});

test('screen-to-world conversion stays correct at min, default, and max zoom', () => {
  for (const zoom of [MIN_EDITOR_ZOOM, 1, MAX_EDITOR_ZOOM]) {
    const camera = createCameraState();
    camera.centerXWorld = 500;
    camera.centerYWorld = 250;
    camera.zoom = zoom;

    const { offsetXPx, offsetYPx } = getCameraOffset(camera, VIEWPORT_W, VIEWPORT_H);
    // The camera center should map to the viewport center on screen.
    const screenX = camera.centerXWorld * zoom + offsetXPx;
    const screenY = camera.centerYWorld * zoom + offsetYPx;
    assert.ok(Math.abs(screenX - VIEWPORT_W / 2) < 1e-9);
    assert.ok(Math.abs(screenY - VIEWPORT_H / 2) < 1e-9);
  }
});
