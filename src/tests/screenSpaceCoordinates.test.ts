import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  nativeGamePointToOverlayCssPoint,
  snapCssPixelToDevicePixel,
} from '../render/ui/screenSpaceCoordinates';

test('native game point maps through canvas CSS scale into overlay coordinates', () => {
  const point = nativeGamePointToOverlayCssPoint({
    nativeX: 240,
    nativeY: 135,
    nativeWidth: 480,
    nativeHeight: 270,
    canvasCssRect: { left: 10, top: 20, width: 960, height: 540 },
    overlayCssRect: { left: 0, top: 0, width: 1200, height: 800 },
  });

  assert.equal(point.xCss, 490);
  assert.equal(point.yCss, 290);
});

test('native game point accounts for overlay root offset and non-integer scaling', () => {
  const point = nativeGamePointToOverlayCssPoint({
    nativeX: 123,
    nativeY: 45,
    nativeWidth: 480,
    nativeHeight: 270,
    canvasCssRect: { left: 7.5, top: 11.25, width: 853.5, height: 480.25 },
    overlayCssRect: { left: 2.5, top: 1.25, width: 900, height: 500 },
  });

  assert.equal(point.xCss, 7.5 - 2.5 + 123 * (853.5 / 480));
  assert.equal(point.yCss, 11.25 - 1.25 + 45 * (480.25 / 270));
});

test('CSS pixel snapping aligns to the active device-pixel grid', () => {
  assert.equal(snapCssPixelToDevicePixel(10.24, 2), 10);
  assert.equal(snapCssPixelToDevicePixel(10.26, 2), 10.5);
  assert.equal(snapCssPixelToDevicePixel(10.4, 1.25), 10.4);
});
