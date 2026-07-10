import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOrganicEdgeShading,
  OPEN_AIR_SIDE_N,
  OPEN_AIR_SIDE_E,
  OPEN_AIR_SIDE_S,
  OPEN_AIR_SIDE_W,
  OPEN_AIR_ALL_SIDES,
  EDGE_SHADING_VERSION,
} from '../render/walls/blockEdgeShading';

/**
 * These tests exercise `applyOrganicEdgeShading` directly against a minimal
 * fake `CanvasRenderingContext2D` (this project's Node test runner has no DOM,
 * so a real HTMLCanvasElement/2D context is unavailable — see the note in the
 * PR description for how this differs from a true browser-rendered
 * integration test).  The fake context implements only the subset of the API
 * the function actually uses: `getImageData` / `putImageData` over a plain
 * RGBA buffer, matching real canvas semantics exactly for this purpose.
 *
 * This is what proves the *algorithm* darkens/brightens edge pixels
 * differently from interior pixels for a given `openAirSidesMask` — the same
 * mask value that `wallTilePassRenderers.render1x1Pass` now computes from
 * live neighbour-solidity data and feeds into both the legacy blackRock/
 * world-number sprite path (via `legacyBlockShading.getLegacyShadedSprite`)
 * and the folder-based theme path (via `folderBlockThemes.getTheme1x1SpriteShaded`).
 */

interface FakeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function makeFakeCtx(width: number, height: number, fillRGBA: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4]     = fillRGBA[0];
    data[i * 4 + 1] = fillRGBA[1];
    data[i * 4 + 2] = fillRGBA[2];
    data[i * 4 + 3] = fillRGBA[3];
  }
  const ctx = {
    getImageData(_x: number, _y: number, w: number, h: number): FakeImageData {
      return { data, width: w, height: h };
    },
    putImageData(imageData: FakeImageData, _x: number, _y: number): void {
      data.set(imageData.data);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, data };
}

function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number, number] {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
}

test('edge-shading version constant is defined and stable within a run', () => {
  assert.equal(typeof EDGE_SHADING_VERSION, 'number');
  assert.ok(EDGE_SHADING_VERSION >= 1);
});

test('a fully solid 8x8 tile with all sides exposed shades edge pixels differently than the center pixel', () => {
  const SIZE = 8;
  const { ctx, data } = makeFakeCtx(SIZE, SIZE, [100, 100, 100, 255]);

  applyOrganicEdgeShading(ctx, SIZE, SIZE, OPEN_AIR_ALL_SIDES, 0, 0, 1);

  const edge   = pixelAt(data, SIZE, 0, 0);   // top-left corner — depth 0, exposed on N and W
  const center = pixelAt(data, SIZE, 4, 4);   // interior — Chebyshev distance > 2 from any border

  assert.notDeepEqual(edge, [100, 100, 100, 255], 'edge pixel should be modified by shading');
  assert.deepEqual(center, [100, 100, 100, 255], 'interior pixel beyond the 3px band must be untouched');
});

test('a tile with only the north side exposed does not shade pixels along the solid east/south/west borders', () => {
  const SIZE = 8;
  const { ctx, data } = makeFakeCtx(SIZE, SIZE, [80, 80, 80, 255]);

  applyOrganicEdgeShading(ctx, SIZE, SIZE, OPEN_AIR_SIDE_N, 0, 0, 1);

  const topRow    = pixelAt(data, SIZE, 4, 0);
  const bottomRow = pixelAt(data, SIZE, 4, SIZE - 1);
  const rightCol  = pixelAt(data, SIZE, SIZE - 1, 4);
  const leftCol   = pixelAt(data, SIZE, 0, 4);

  assert.notDeepEqual(topRow, [80, 80, 80, 255], 'north-exposed row should be shaded');
  assert.deepEqual(bottomRow, [80, 80, 80, 255], 'south border is solid-neighbour — must stay unshaded (no seam)');
  assert.deepEqual(rightCol,  [80, 80, 80, 255], 'east border is solid-neighbour — must stay unshaded (no seam)');
  assert.deepEqual(leftCol,   [80, 80, 80, 255], 'west border is solid-neighbour — must stay unshaded (no seam)');
});

test('a fully surrounded tile (mask = 0, no open air sides) receives no edge treatment at all', () => {
  const SIZE = 8;
  const { ctx, data } = makeFakeCtx(SIZE, SIZE, [60, 60, 60, 255]);

  applyOrganicEdgeShading(ctx, SIZE, SIZE, 0, 0, 0, 1);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      assert.deepEqual(
        pixelAt(data, SIZE, x, y),
        [60, 60, 60, 255],
        `pixel (${x},${y}) of a fully-enclosed tile must be unchanged`,
      );
    }
  }
});

test('east and west exposure masks each shade their own edge and leave the other alone', () => {
  const SIZE = 8;

  const east = makeFakeCtx(SIZE, SIZE, [90, 90, 90, 255]);
  applyOrganicEdgeShading(east.ctx, SIZE, SIZE, OPEN_AIR_SIDE_E, 0, 0, 1);
  assert.notDeepEqual(pixelAt(east.data, SIZE, SIZE - 1, 4), [90, 90, 90, 255]);
  assert.deepEqual(pixelAt(east.data, SIZE, 0, 4), [90, 90, 90, 255]);

  const west = makeFakeCtx(SIZE, SIZE, [90, 90, 90, 255]);
  applyOrganicEdgeShading(west.ctx, SIZE, SIZE, OPEN_AIR_SIDE_W, 0, 0, 1);
  assert.notDeepEqual(pixelAt(west.data, SIZE, 0, 4), [90, 90, 90, 255]);
  assert.deepEqual(pixelAt(west.data, SIZE, SIZE - 1, 4), [90, 90, 90, 255]);
});

test('south exposure mask shades the bottom row but not the top row', () => {
  const SIZE = 8;
  const { ctx, data } = makeFakeCtx(SIZE, SIZE, [70, 70, 70, 255]);
  applyOrganicEdgeShading(ctx, SIZE, SIZE, OPEN_AIR_SIDE_S, 0, 0, 1);
  assert.notDeepEqual(pixelAt(data, SIZE, 4, SIZE - 1), [70, 70, 70, 255]);
  assert.deepEqual(pixelAt(data, SIZE, 4, 0), [70, 70, 70, 255]);
});

// ── Regression: the baked shader must never add a white/bright additive rim ──
//
// `applyOrganicEdgeShading` used to also apply an additive RGB "rim light"
// brighten on exposed depth-0 pixels (`_EDGE_HIGHLIGHT_ADD`/`_TOP`), which
// stacked with `surfaceEdgeOverlay.ts`'s guaranteed highlight and made
// isolated exposed tiles blow out to near-white. That additive term has been
// removed — this shader is now multiply-only, so it can only ever darken
// (never exceed) the source pixel.

test('applyOrganicEdgeShading never increases any RGB channel above its source value, for every exposed-side mask', () => {
  const SIZE = 8;
  const masksToTry = [
    OPEN_AIR_ALL_SIDES,
    OPEN_AIR_SIDE_N,
    OPEN_AIR_SIDE_E,
    OPEN_AIR_SIDE_S,
    OPEN_AIR_SIDE_W,
    OPEN_AIR_SIDE_N | OPEN_AIR_SIDE_E,
  ];
  for (const mask of masksToTry) {
    const source: [number, number, number, number] = [128, 64, 32, 255];
    const { ctx, data } = makeFakeCtx(SIZE, SIZE, source);
    applyOrganicEdgeShading(ctx, SIZE, SIZE, mask, 0, 0, 1);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const [r, g, b] = pixelAt(data, SIZE, x, y);
        assert.ok(r <= source[0], `mask ${mask}: R channel at (${x},${y}) exceeded source (${r} > ${source[0]})`);
        assert.ok(g <= source[1], `mask ${mask}: G channel at (${x},${y}) exceeded source (${g} > ${source[1]})`);
        assert.ok(b <= source[2], `mask ${mask}: B channel at (${x},${y}) exceeded source (${b} > ${source[2]})`);
      }
    }
  }
});

test('an isolated fully-exposed tile does not blow out to near-white (no additive rim highlight)', () => {
  const SIZE = 8;
  const { ctx, data } = makeFakeCtx(SIZE, SIZE, [100, 100, 100, 255]);
  applyOrganicEdgeShading(ctx, SIZE, SIZE, OPEN_AIR_ALL_SIDES, 0, 0, 1);
  const corner = pixelAt(data, SIZE, 0, 0);
  assert.ok(corner[0] <= 100 && corner[1] <= 100 && corner[2] <= 100, 'exposed corner pixel must not brighten past its source value');
});
