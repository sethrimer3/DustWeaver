import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculatePlayerSpeedometerCssPositions,
  calculatePlayerSpeedometerNativeAnchors,
  formatDisplayVelocity,
  getDisplayVelocityComponents,
  normalizeDisplayVelocity,
  shouldShowPlayerSpeedometer,
} from '../render/ui/playerSpeedometerOverlayRenderer';

test('converts world velocity to Cartesian display signs', () => {
  assert.deepEqual(getDisplayVelocityComponents(120, -45), { x: 120, y: 45 });
  assert.deepEqual(getDisplayVelocityComponents(-120, 45), { x: -120, y: -45 });
});

test('normalizes small values and negative zero', () => {
  assert.equal(Object.is(normalizeDisplayVelocity(-0), -0), false);
  assert.equal(normalizeDisplayVelocity(-0.49), 0);
  assert.equal(formatDisplayVelocity(-0.49), '0 px/s');
});

test('formats rounded signed component values in px/s', () => {
  assert.equal(formatDisplayVelocity(123.6), '124 px/s');
  assert.equal(formatDisplayVelocity(-123.6), '-124 px/s');
});

test('requires debug mode, the setting, and a living player for visibility', () => {
  assert.equal(shouldShowPlayerSpeedometer(true, true, true), true);
  assert.equal(shouldShowPlayerSpeedometer(true, false, true), false);
  assert.equal(shouldShowPlayerSpeedometer(false, true, true), false);
  assert.equal(shouldShowPlayerSpeedometer(true, true, false), false);
});

test('calculates sprite-edge anchors from interpolated world-to-screen coordinates', () => {
  assert.deepEqual(calculatePlayerSpeedometerNativeAnchors({
    playerRenderXWorld: 10.25,
    playerRenderYWorld: 20.25,
    halfWidthWorld: 3,
    halfHeightWorld: 5,
    offsetXPx: 7,
    offsetYPx: -2,
    zoom: 2,
  }), {
    horizontal: { x: 28, y: 49 },
    vertical: { x: 22, y: 39 },
  });
});

test('centers horizontal text below and vertical text left of sprite edges', () => {
  assert.deepEqual(calculatePlayerSpeedometerCssPositions({
    horizontalAnchor: { xCss: 100, yCss: 80 },
    verticalAnchor: { xCss: 90, yCss: 70 },
    horizontalWidth: 60,
    horizontalHeight: 16,
    verticalWidth: 56,
    verticalHeight: 16,
    devicePixelRatio: 2,
    gapCssPx: 8,
  }), {
    horizontal: { xCss: 70, yCss: 88 },
    vertical: { xCss: 26, yCss: 62 },
  });
});
