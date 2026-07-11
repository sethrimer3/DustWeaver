import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getVisibleWorldRect,
  worldRectToIndexRange,
  clampIndexRangeMinToZero,
  type WorldRect,
  type IndexRange,
} from '../render/visibleWorldRect';

function rect(): WorldRect {
  return { leftWorld: 0, topWorld: 0, rightWorld: 0, bottomWorld: 0 };
}

function range(): IndexRange {
  return { colMin: 0, rowMin: 0, colMax: 0, rowMax: 0 };
}

// ── getVisibleWorldRect ────────────────────────────────────────────────────

test('getVisibleWorldRect: normal room, camera centred, zoom 1', () => {
  // 480x270 viewport, camera centred on a 200x150 world room.
  const offsetXPx = 240 - 100; // viewport half width - room-centre world x * zoom
  const offsetYPx = 135 - 75;
  const r = getVisibleWorldRect(offsetXPx, offsetYPx, 1, 480, 270, 0, rect());
  assert.equal(r.leftWorld, -offsetXPx);
  assert.equal(r.rightWorld, 480 - offsetXPx);
  assert.equal(r.rightWorld - r.leftWorld, 480);
  assert.equal(r.bottomWorld - r.topWorld, 270);
});

test('getVisibleWorldRect: wide room — width exceeds viewport, height matches', () => {
  const r = getVisibleWorldRect(-50, 0, 1, 480, 270, 0, rect());
  assert.equal(r.rightWorld - r.leftWorld, 480);
  assert.equal(r.bottomWorld - r.topWorld, 270);
});

test('getVisibleWorldRect: tall room — camera at top, middle, bottom all yield full-viewport-sized rects', () => {
  // Tall room: 100 wide x 5000 tall in world units. Camera Y varies; the
  // visible rect must always be exactly viewport-sized regardless of where
  // in the tall room the camera sits.
  const zoom = 1;
  for (const camY of [10, 2500, 4990]) {
    const offsetXPx = 240 - 50 * zoom;
    const offsetYPx = 135 - camY * zoom;
    const r = getVisibleWorldRect(offsetXPx, offsetYPx, zoom, 480, 270, 0, rect());
    assert.equal(r.rightWorld - r.leftWorld, 480 / zoom);
    assert.equal(r.bottomWorld - r.topWorld, 270 / zoom);
    // Rect must be centred on the camera target, not clipped to a fixed
    // room-height assumption.
    assert.equal((r.topWorld + r.bottomWorld) / 2, camY);
  }
});

test('getVisibleWorldRect: very tall room with zoom != 1 scales the rect correctly', () => {
  const zoom = 2;
  const camY = 3000;
  const offsetXPx = 240 - 50 * zoom;
  const offsetYPx = 135 - camY * zoom;
  const r = getVisibleWorldRect(offsetXPx, offsetYPx, zoom, 480, 270, 0, rect());
  assert.equal(r.rightWorld - r.leftWorld, 480 / zoom);
  assert.equal(r.bottomWorld - r.topWorld, 270 / zoom);
});

test('getVisibleWorldRect: margin expands the rect symmetrically', () => {
  const r = getVisibleWorldRect(0, 0, 1, 480, 270, 16, rect());
  assert.equal(r.leftWorld, -16);
  assert.equal(r.topWorld, -16);
  assert.equal(r.rightWorld, 480 + 16);
  assert.equal(r.bottomWorld, 270 + 16);
});

test('getVisibleWorldRect: non-finite/zero-zoom inputs fail safe to a zero-area rect', () => {
  for (const bad of [NaN, Infinity, -Infinity, 0, -1]) {
    const r = getVisibleWorldRect(0, 0, bad, 480, 270, 0, rect());
    assert.equal(r.leftWorld, 0);
    assert.equal(r.topWorld, 0);
    assert.equal(r.rightWorld, 0);
    assert.equal(r.bottomWorld, 0);
  }
  const r2 = getVisibleWorldRect(NaN, 0, 1, 480, 270, 0, rect());
  assert.equal(r2.rightWorld, 0);
});

// ── worldRectToIndexRange ───────────────────────────────────────────────────

test('worldRectToIndexRange: covers exact tile boundaries with floor/ceil', () => {
  const r: WorldRect = { leftWorld: 0, topWorld: 0, rightWorld: 100, bottomWorld: 80 };
  const out = worldRectToIndexRange(r, 8, 0, range());
  assert.equal(out.colMin, 0);
  assert.equal(out.rowMin, 0);
  assert.equal(out.colMax, Math.ceil(100 / 8));
  assert.equal(out.rowMax, Math.ceil(80 / 8));
});

test('worldRectToIndexRange: tall-room deep-Y camera produces large positive row indices, never inverted', () => {
  // Camera near the bottom of a very tall room: top/bottom are both large
  // positive world values. Range must stay ordered (rowMax >= rowMin).
  const r: WorldRect = { leftWorld: 0, topWorld: 4900, rightWorld: 100, bottomWorld: 5100 };
  const out = worldRectToIndexRange(r, 8, 1, range());
  assert.ok(out.rowMax >= out.rowMin);
  assert.ok(out.rowMin > 0);
});

test('worldRectToIndexRange: negative world coordinates (camera above/left of origin) do not skip rows/cols', () => {
  const r: WorldRect = { leftWorld: -50, topWorld: -40, rightWorld: 50, bottomWorld: 40 };
  const out = worldRectToIndexRange(r, 8, 0, range());
  assert.ok(out.colMin < 0);
  assert.ok(out.rowMin < 0);
  assert.ok(out.colMax > out.colMin);
  assert.ok(out.rowMax > out.rowMin);
});

test('worldRectToIndexRange: margin extends the range on every side', () => {
  const r: WorldRect = { leftWorld: 0, topWorld: 0, rightWorld: 32, bottomWorld: 32 };
  const base = worldRectToIndexRange(r, 8, 0, range());
  const withMargin = worldRectToIndexRange(r, 8, 2, range());
  assert.equal(withMargin.colMin, base.colMin - 2);
  assert.equal(withMargin.rowMin, base.rowMin - 2);
  assert.equal(withMargin.colMax, base.colMax + 2);
  assert.equal(withMargin.rowMax, base.rowMax + 2);
});

test('worldRectToIndexRange: non-finite/zero size unit fails safe to an empty range', () => {
  const r: WorldRect = { leftWorld: 0, topWorld: 0, rightWorld: 100, bottomWorld: 100 };
  for (const bad of [0, -8, NaN, Infinity]) {
    const out = worldRectToIndexRange(r, bad, 0, range());
    assert.ok(out.colMax < out.colMin, `sizeUnit=${bad} should yield an empty col range`);
    assert.ok(out.rowMax < out.rowMin, `sizeUnit=${bad} should yield an empty row range`);
  }
  const badRect: WorldRect = { leftWorld: NaN, topWorld: 0, rightWorld: 100, bottomWorld: 100 };
  const out2 = worldRectToIndexRange(badRect, 8, 0, range());
  assert.ok(out2.colMax < out2.colMin);
});

// ── clampIndexRangeMinToZero ─────────────────────────────────────────────────

test('clampIndexRangeMinToZero: clamps only the min indices, leaves max untouched', () => {
  const r: IndexRange = { colMin: -5, rowMin: -3, colMax: 10, rowMax: 400 };
  const out = clampIndexRangeMinToZero(r);
  assert.equal(out.colMin, 0);
  assert.equal(out.rowMin, 0);
  assert.equal(out.colMax, 10);
  // A very tall room's rowMax (e.g. hundreds of chunk rows) must never be
  // clamped — that would silently cut off the bottom of the room.
  assert.equal(out.rowMax, 400);
});
