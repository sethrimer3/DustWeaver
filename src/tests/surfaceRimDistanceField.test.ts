/**
 * surfaceRimDistanceField.test.ts — Coverage for the 'inverted'-mode interior
 * darkening distance field: `buildInteriorRimDistanceField` (pure BFS) plus
 * its render-time consumer in `surfaceEdgeOverlay.ts` (falloff curves,
 * distance-0 exemption, no double-painting, cache invalidation via
 * `getWallLayoutCache`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInteriorRimDistanceField } from '../render/walls/surfaceRimDistanceField';
import type { SurfaceMask } from '../sim/world/surfaceExposure';
import type { WallSnapshot } from '../render/snapshotTypes';
import { getWallLayoutCache } from '../render/walls/blockWallLayoutCache';
import { renderSurfaceEdgeOverlayPass, type SurfaceEdgeOverlayParams } from '../render/walls/surfaceEdgeOverlay';
import { normalizeSurfaceRimStyle, type SurfaceRimStyle } from '../render/walls/surfaceRimStyle';

const BLOCK_SIZE = 8;

// ── buildInteriorRimDistanceField (pure BFS) ────────────────────────────────────

function fullyExposedMask(): SurfaceMask {
  return { top: true, right: true, bottom: true, left: true };
}
function noMask(): SurfaceMask {
  return { top: false, right: false, bottom: false, left: false };
}

test('buildInteriorRimDistanceField: seed tiles (in masks) get distance 0', () => {
  const occupied = new Set(['0,0']);
  const masks = new Map([['0,0', fullyExposedMask()]]);
  const dist = buildInteriorRimDistanceField(occupied, masks);
  assert.equal(dist.get('0,0'), 0);
});

test('buildInteriorRimDistanceField: a straight 5-tile corridor produces distances 0,1,2,1,0', () => {
  // Row of 5 solid tiles; only the two ends are exposed (imagine a corridor
  // open at both ends, solid on the long sides — masks only contains the
  // tiles that actually have a cardinal exposed side).
  const occupied = new Set(['0,0', '1,0', '2,0', '3,0', '4,0']);
  const masks = new Map<string, SurfaceMask>([
    ['0,0', fullyExposedMask()],
    ['4,0', fullyExposedMask()],
  ]);
  const dist = buildInteriorRimDistanceField(occupied, masks);
  assert.equal(dist.get('0,0'), 0);
  assert.equal(dist.get('1,0'), 1);
  assert.equal(dist.get('2,0'), 2);
  assert.equal(dist.get('3,0'), 1);
  assert.equal(dist.get('4,0'), 0);
});

test('buildInteriorRimDistanceField: a sealed interior pocket (unreachable) is absent from the map', () => {
  // 3x3 solid block: only the perimeter would be in `masks` in a real room,
  // but here we simulate a fully sealed pocket by giving NO tile a mask
  // entry at all — nothing is reachable, so the map stays empty.
  const occupied = new Set(['1,1']);
  const masks = new Map<string, SurfaceMask>();
  const dist = buildInteriorRimDistanceField(occupied, masks);
  assert.equal(dist.has('1,1'), false, 'unreachable tiles must be absent, not zero');
});

test('buildInteriorRimDistanceField: a 2D block interior is reached via the shortest path around the shape', () => {
  // 3x3 solid square; only the 8 perimeter tiles are exposed (center has no
  // cardinal exposure). Center should be distance 1 (adjacent to any edge tile).
  const occupied = new Set<string>();
  const masks = new Map<string, SurfaceMask>();
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      occupied.add(`${c},${r}`);
      if (!(c === 1 && r === 1)) masks.set(`${c},${r}`, fullyExposedMask());
    }
  }
  const dist = buildInteriorRimDistanceField(occupied, masks);
  assert.equal(dist.get('1,1'), 1);
});

void noMask; // referenced for symmetry/documentation of the mask-shape helpers above

// ── Render-time falloff curves ──────────────────────────────────────────────────

interface RecordedRect { x: number; y: number; w: number; h: number; fillStyle: string }

function makeFakeCtx(): { ctx: CanvasRenderingContext2D; rects: RecordedRect[] } {
  const rects: RecordedRect[] = [];
  let currentFillStyle = '';
  const ctx = {
    globalCompositeOperation: 'source-over',
    save(): void {}, restore(): void {},
    set fillStyle(v: string) { currentFillStyle = v; },
    get fillStyle() { return currentFillStyle; },
    fillRect(x: number, y: number, w: number, h: number): void {
      rects.push({ x, y, w, h, fillStyle: currentFillStyle });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects };
}

function makeWallSnapshot(rects: Array<{ x: number; y: number; w: number; h: number }>): WallSnapshot {
  const count = rects.length;
  const xWorld = new Float32Array(count);
  const yWorld = new Float32Array(count);
  const wWorld = new Float32Array(count);
  const hWorld = new Float32Array(count);
  rects.forEach((r, i) => { xWorld[i] = r.x; yWorld[i] = r.y; wWorld[i] = r.w; hWorld[i] = r.h; });
  return {
    count, xWorld, yWorld, wWorld, hWorld,
    isPlatformFlag: new Uint8Array(count),
    platformEdge: new Uint8Array(count),
    themeIndex: new Uint8Array(count).fill(255),
    isInvisibleFlag: new Uint8Array(count),
    rampOrientationIndex: new Uint8Array(count).fill(255),
    isPillarHalfWidthFlag: new Uint8Array(count),
    surfaceRimStyleIndex: new Uint16Array(count),
    surfaceRimStyleTable: [normalizeSurfaceRimStyle({ mode: 'inverted' })],
  };
}

function makeParams(overrides: Partial<SurfaceEdgeOverlayParams> & Pick<SurfaceEdgeOverlayParams, 'surfaceExposureMap'>): SurfaceEdgeOverlayParams {
  return {
    ambientDepths: null, isBlockTintEnabled: false,
    offsetXPx: 0, offsetYPx: 0, scalePx: 1, blockSizePx: BLOCK_SIZE,
    filterColMinBlocks: 0, filterColMaxBlocks: 0x7FFFFFFF,
    filterRowMinBlocks: 0, filterRowMaxBlocks: 0x7FFFFFFF,
    ...overrides,
  };
}

// Blocks in these fixtures are placed a few tiles in from (0,0) — the room
// boundary is NOT treated as open air (see buildSurfaceExposureMap's
// room-bounds awareness), so a block flush against col/row 0 would have its
// edge-facing-the-room-boundary side silently NOT count as exposed. Offsetting
// by OFFSET tiles keeps every side of the fixture genuinely open-air-adjacent.
const OFFSET = 2;

/** A 5-wide x 3-tall solid block: middle row's center tile sits deepest (distance 1 from any edge). */
function makeThickWallLayout() {
  const snapshot = makeWallSnapshot([{ x: OFFSET * BLOCK_SIZE, y: OFFSET * BLOCK_SIZE, w: 5 * BLOCK_SIZE, h: 3 * BLOCK_SIZE }]);
  return getWallLayoutCache(snapshot, BLOCK_SIZE, 20, 20);
}

function darkenAlphaAt(rects: RecordedRect[], col: number, row: number): number | undefined {
  const x = col * BLOCK_SIZE;
  const y = row * BLOCK_SIZE;
  const r = rects.find(rr => rr.x === x && rr.y === y && /rgba\(0,0,0,/.test(rr.fillStyle));
  if (!r) return undefined;
  return parseFloat(/rgba\(0,0,0,([\d.]+)\)/.exec(r.fillStyle)![1]);
}

function renderInverted(style: SurfaceRimStyle): { rects: RecordedRect[]; wallLayout: ReturnType<typeof makeThickWallLayout> } {
  const wallLayout = makeThickWallLayout();
  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({
    surfaceExposureMap: wallLayout.surfaceExposureMap,
    getStyleForTile: () => style,
    interiorTileCoords: wallLayout.occupiedTiles,
    getInteriorDistanceForTile: (col, row) => wallLayout.interiorRimDistanceField.get(`${col},${row}`),
  });
  renderSurfaceEdgeOverlayPass(ctx, params);
  return { rects, wallLayout };
}

test('inverted distance field: the center tile of a thick wall (max distance in this shape) sits at distance 1', () => {
  // 5x3 block spans col OFFSET..OFFSET+4, row OFFSET..OFFSET+2. Center tile
  // (col OFFSET+2, row OFFSET+1): 1 tile from top/bottom edge, 2 from left/right — min is 1.
  const wallLayout = makeThickWallLayout();
  assert.equal(wallLayout.interiorRimDistanceField.get(`${OFFSET + 2},${OFFSET + 1}`), 1);
});

test('inverted falloff: hard mode is a step function (0 at distance 0, full darkness at any distance > 0)', () => {
  const style = normalizeSurfaceRimStyle({ mode: 'inverted', color: 'ffffff', widthPx: 1, opacity: 0.2, falloff: 'hard', interiorDarkness: 0.9 });
  const { rects } = renderInverted(style);
  assert.equal(darkenAlphaAt(rects, OFFSET, OFFSET), undefined, 'edge tile (distance 0) must have no darken rect');
  assert.equal(darkenAlphaAt(rects, OFFSET + 2, OFFSET + 1), 0.9, 'any interior tile (distance > 0) is immediately at full interiorDarkness under hard falloff');
});

test('inverted falloff: linear mode scales darkness proportionally to normalized distance', () => {
  const style = normalizeSurfaceRimStyle({ mode: 'inverted', color: 'ffffff', widthPx: 1, opacity: 0.2, falloff: 'linear', interiorDarkness: 1.0 });
  const { rects } = renderInverted(style);
  const alpha = darkenAlphaAt(rects, OFFSET + 2, OFFSET + 1)!;
  // distance 1 / max-distance-tiles constant (6) = 1/6.
  assert.ok(Math.abs(alpha - 1 / 6) < 1e-6, `expected ~${1 / 6}, got ${alpha}`);
});

test('inverted falloff: smooth and exponential both start at 0 for distance 0 and rise monotonically', () => {
  for (const falloff of ['smooth', 'exponential'] as const) {
    const style = normalizeSurfaceRimStyle({ mode: 'inverted', color: 'ffffff', widthPx: 1, opacity: 0.2, falloff, interiorDarkness: 1.0 });
    const { rects } = renderInverted(style);
    assert.equal(darkenAlphaAt(rects, OFFSET, OFFSET), undefined, `${falloff}: distance 0 must have no darken rect`);
    const alpha = darkenAlphaAt(rects, OFFSET + 2, OFFSET + 1)!;
    assert.ok(alpha > 0 && alpha < 1, `${falloff}: intermediate distance must be strictly between 0 and full darkness, got ${alpha}`);
  }
});

test('inverted falloff: distance at/beyond the max-distance constant saturates at full interiorDarkness', () => {
  // Build a much thicker block so some tile sits at/beyond the 6-tile cap.
  const snapshot = makeWallSnapshot([{ x: OFFSET * BLOCK_SIZE, y: OFFSET * BLOCK_SIZE, w: 15 * BLOCK_SIZE, h: 15 * BLOCK_SIZE }]);
  const wallLayout = getWallLayoutCache(snapshot, BLOCK_SIZE, 20, 20);
  const style = normalizeSurfaceRimStyle({ mode: 'inverted', color: 'ffffff', widthPx: 1, opacity: 0.2, falloff: 'linear', interiorDarkness: 0.7 });
  const { ctx, rects } = makeFakeCtx();
  const params = makeParams({
    surfaceExposureMap: wallLayout.surfaceExposureMap,
    getStyleForTile: () => style,
    interiorTileCoords: wallLayout.occupiedTiles,
    getInteriorDistanceForTile: (col, row) => wallLayout.interiorRimDistanceField.get(`${col},${row}`),
  });
  renderSurfaceEdgeOverlayPass(ctx, params);
  // The exact center of a 15x15 block is 7 tiles from every edge — past the cap.
  const alpha = darkenAlphaAt(rects, OFFSET + 7, OFFSET + 7);
  assert.ok(alpha !== undefined && Math.abs(alpha - 0.7) < 1e-6, `expected saturated 0.7, got ${alpha}`);
});

test('no double-painting: interior darken rects never overlap each other or the exposed-edge rim bands', () => {
  const style = normalizeSurfaceRimStyle({ mode: 'inverted', color: 'ffffff', widthPx: 2, opacity: 0.3, falloff: 'smooth', interiorDarkness: 0.8 });
  const { rects } = renderInverted(style);
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]; const b = rects[j];
      const overlapsX = a.x < b.x + b.w && a.x + a.w > b.x;
      const overlapsY = a.y < b.y + b.h && a.y + a.h > b.y;
      assert.ok(!(overlapsX && overlapsY), `rects ${i} and ${j} overlap: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
    }
  }
});

// ── Cache invalidation ────────────────────────────────────────────────────────

test('cache invalidation: interiorRimDistanceField is rebuilt when wall geometry (and thus exposure) changes', () => {
  const snapshotA = makeWallSnapshot([{ x: OFFSET * BLOCK_SIZE, y: OFFSET * BLOCK_SIZE, w: 3 * BLOCK_SIZE, h: 3 * BLOCK_SIZE }]);
  const layoutA = getWallLayoutCache(snapshotA, BLOCK_SIZE, 20, 20);
  assert.equal(layoutA.interiorRimDistanceField.get(`${OFFSET + 1},${OFFSET + 1}`), 1);

  // Grow the block so a previously-center tile is no longer the deepest,
  // proving the field actually recomputes rather than being stale/cached
  // from the first shape.
  const snapshotB = makeWallSnapshot([{ x: OFFSET * BLOCK_SIZE, y: OFFSET * BLOCK_SIZE, w: 5 * BLOCK_SIZE, h: 5 * BLOCK_SIZE }]);
  const layoutB = getWallLayoutCache(snapshotB, BLOCK_SIZE, 20, 20);
  assert.equal(layoutB.interiorRimDistanceField.get(`${OFFSET + 2},${OFFSET + 2}`), 2, 'the new shape\'s true center must reflect the new, larger exposure map');
  assert.notEqual(layoutA, layoutB, 'geometry change must produce a fresh layout object, not reuse the old one');
});

test('performance: layouts without inverted styles do not construct an interior distance field', () => {
  const snapshot = makeWallSnapshot([{ x: OFFSET * BLOCK_SIZE, y: OFFSET * BLOCK_SIZE, w: 5 * BLOCK_SIZE, h: 5 * BLOCK_SIZE }]);
  snapshot.surfaceRimStyleIndex.fill(0xFFFF);
  const layout = getWallLayoutCache(snapshot, BLOCK_SIZE, 20, 20);
  assert.equal(layout.interiorRimDistanceField.size, 0);
});
