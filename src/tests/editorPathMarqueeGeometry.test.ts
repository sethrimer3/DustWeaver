/**
 * Phase 3.1, Fix 2: segment-level path marquee geometry.
 *
 * Ropes and guide dust paths used to test marquee selection against their
 * bounding box, which false-positives when the marquee clips empty space
 * inside the box but never actually touches a segment or control point.
 * `segmentIntersectsRect` (editorElementRegistry.ts) replaces that with real
 * segment/segment intersection, and the rope/guideDustPath adapters use it
 * per-segment (plus the loop-closing segment for guide paths).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState } from '../editor/editorState';
import type { EditorRoomData } from '../editor/editorElementTypes';
import { segmentIntersectsRect, ELEMENT_ADAPTERS, type MarqueeRect } from '../editor/editorElementRegistry';
import { getAllElementsInRect } from '../editor/editorTools';

function makeRoom(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    id: 'test_room', name: 'Test Room', worldNumber: 1, mapX: 0, mapY: 0,
    blockTheme: 'blackRock', backgroundId: 'cave', lightingEffect: 'DEFAULT', songId: '_continue',
    widthBlocks: 30, heightBlocks: 30, playerSpawnBlock: [28, 28],
    interiorWalls: [], enemies: [], transitions: [], saveTombs: [], skillTombs: [],
    dustContainers: [], dustContainerPieces: [], dustBoostJars: [], dustSwarms: [],
    lambdaAnchors: [], dustPiles: [], grasshopperAreas: [], fireflyAreas: [],
    decorations: [], ambientLightBlockers: [], lightSources: [],
    ...overrides,
  } as unknown as EditorRoomData;
}

// ── segmentIntersectsRect helper ───────────────────────────────────────────

test('segmentIntersectsRect: segment touching a rect edge intersects', () => {
  const rect: MarqueeRect = { minX: 5, minY: 5, maxX: 10, maxY: 10 };
  assert.ok(segmentIntersectsRect({ x: 0, y: 7 }, { x: 20, y: 7 }, rect));
});

test('segmentIntersectsRect: segment entirely outside the rect does not intersect', () => {
  const rect: MarqueeRect = { minX: 5, minY: 5, maxX: 10, maxY: 10 };
  assert.ok(!segmentIntersectsRect({ x: 0, y: 0 }, { x: 1, y: 1 }, rect));
});

test('segmentIntersectsRect: diagonal segment clearly missing the rect does not intersect', () => {
  const rect: MarqueeRect = { minX: 5, minY: 5, maxX: 6, maxY: 6 };
  // A diagonal from (0,0) to (4,1) passes well below/left of the rect.
  assert.ok(!segmentIntersectsRect({ x: 0, y: 0 }, { x: 4, y: 1 }, rect));
});

test('segmentIntersectsRect: diagonal segment crossing the rect intersects', () => {
  const rect: MarqueeRect = { minX: 5, minY: 5, maxX: 10, maxY: 10 };
  assert.ok(segmentIntersectsRect({ x: 0, y: 0 }, { x: 20, y: 20 }, rect));
});

test('segmentIntersectsRect: an endpoint landing inside the rect intersects', () => {
  const rect: MarqueeRect = { minX: 5, minY: 5, maxX: 10, maxY: 10 };
  assert.ok(segmentIntersectsRect({ x: 7, y: 7 }, { x: 20, y: 20 }, rect));
});

// ── Rope adapter ────────────────────────────────────────────────────────────

function makeRope(overrides: Record<string, unknown> = {}) {
  return {
    uid: 1, anchorAXBlock: 0, anchorAYBlock: 0, anchorBXBlock: 10, anchorBYBlock: 10,
    segmentCount: 4, isAnchorBFixedFlag: 1, destructibility: 'indestructible', thicknessIndex: 0,
    ...overrides,
  };
}

test('rope: marquee touching the anchor segment selects it', () => {
  const rope = makeRope();
  const rect: MarqueeRect = { minX: 4, minY: 4, maxX: 6, maxY: 6 };
  assert.ok(ELEMENT_ADAPTERS.rope.marqueeTest(rope, rect, makeRoom()));
});

test('rope: marquee inside the bounding box but not touching the segment does NOT select it', () => {
  // A rope from (0,0) to (10,0) is horizontal — its bounding box is the whole
  // strip y in [0,0], so pick a marquee strictly below that line's y but
  // still inside a naive bbox test using a rope that has real diagonal width
  // via two separate anchors far apart, testing a marquee that sits to the
  // side of the actual line but within the old bbox.
  const rope = makeRope({ anchorAXBlock: 0, anchorAYBlock: 0, anchorBXBlock: 10, anchorBYBlock: 10 });
  // The rope's bounding box is x:[0,10], y:[0,10]. This marquee sits fully
  // inside that box but well off the diagonal line itself.
  const rect: MarqueeRect = { minX: 8, minY: 1, maxX: 9, maxY: 2 };
  assert.ok(!ELEMENT_ADAPTERS.rope.marqueeTest(rope, rect, makeRoom()));
});

test('rope: marquee touching a control point (anchor) but no interior segment point selects it', () => {
  const rope = makeRope({ anchorAXBlock: 5, anchorAYBlock: 5, anchorBXBlock: 20, anchorBYBlock: 20 });
  const rect: MarqueeRect = { minX: 5, minY: 5, maxX: 5, maxY: 5 };
  assert.ok(ELEMENT_ADAPTERS.rope.marqueeTest(rope, rect, makeRoom()));
});

test('rope: integration via getAllElementsInRect — in range vs out of range', () => {
  const room = makeRoom({ ropes: [makeRope({ anchorAXBlock: 2, anchorAYBlock: 2, anchorBXBlock: 6, anchorBYBlock: 6 })] } as Partial<EditorRoomData>);
  const state = createEditorState();
  state.roomData = room;
  const inRange = getAllElementsInRect(state, room, 0, 0, 8, 8);
  assert.ok(inRange.some(e => e.type === 'rope'));
  const outOfRange = getAllElementsInRect(state, room, 20, 20, 25, 25);
  assert.ok(!outOfRange.some(e => e.type === 'rope'));
});

// ── Guide dust path adapter ─────────────────────────────────────────────────

function makePath(points: Array<{ xBlock: number; yBlock: number }>, loop = false) {
  return {
    uid: 1,
    points: points.map(p => ({ ...p, speed: 1 })),
    loop, visibleInGame: true, moteCount: 8, moteSpeedFactor: 1, opacityPct: 100,
  };
}

test('guide path: marquee touching a segment selects it', () => {
  const path = makePath([{ xBlock: 0, yBlock: 0 }, { xBlock: 10, yBlock: 0 }]);
  const rect: MarqueeRect = { minX: 4, minY: -1, maxX: 6, maxY: 1 };
  assert.ok(ELEMENT_ADAPTERS.guideDustPath.marqueeTest(path, rect, makeRoom()));
});

test('guide path: diagonal segment — marquee clearly not on it does NOT select', () => {
  const path = makePath([{ xBlock: 0, yBlock: 0 }, { xBlock: 4, yBlock: 1 }]);
  const rect: MarqueeRect = { minX: 5, minY: 5, maxX: 6, maxY: 6 };
  assert.ok(!ELEMENT_ADAPTERS.guideDustPath.marqueeTest(path, rect, makeRoom()));
});

test('guide path: diagonal segment — marquee on the segment selects', () => {
  const path = makePath([{ xBlock: 0, yBlock: 0 }, { xBlock: 20, yBlock: 20 }]);
  const rect: MarqueeRect = { minX: 9, minY: 9, maxX: 11, maxY: 11 };
  assert.ok(ELEMENT_ADAPTERS.guideDustPath.marqueeTest(path, rect, makeRoom()));
});

test('guide path: multi-segment path — marquee inside bounding box but off every segment does NOT select', () => {
  // An "L" shaped path: (0,0) -> (10,0) -> (10,10). Bounding box is [0,10]x[0,10],
  // but a marquee near (2,8) touches neither the horizontal nor vertical leg.
  const path = makePath([{ xBlock: 0, yBlock: 0 }, { xBlock: 10, yBlock: 0 }, { xBlock: 10, yBlock: 10 }]);
  const rect: MarqueeRect = { minX: 1, minY: 7, maxX: 3, maxY: 9 };
  assert.ok(!ELEMENT_ADAPTERS.guideDustPath.marqueeTest(path, rect, makeRoom()));
});

test('guide path: loop-closing segment is tested when loop=true', () => {
  // Square-ish path where only the loop-closing segment (last -> first) passes
  // through the marquee; the authored segments do not.
  const path = makePath([
    { xBlock: 0, yBlock: 0 },
    { xBlock: 10, yBlock: 0 },
    { xBlock: 10, yBlock: 10 },
  ], true);
  // Loop-closing segment goes from (10,10) back to (0,0) — a marquee on that
  // diagonal (e.g. around (5,5)) only intersects the closing segment.
  const rect: MarqueeRect = { minX: 4, minY: 4, maxX: 6, maxY: 6 };
  assert.ok(ELEMENT_ADAPTERS.guideDustPath.marqueeTest(path, rect, makeRoom()));
});

test('guide path: without loop, the same marquee near the would-be closing segment does NOT select', () => {
  const path = makePath([
    { xBlock: 0, yBlock: 0 },
    { xBlock: 10, yBlock: 0 },
    { xBlock: 10, yBlock: 10 },
  ], false);
  const rect: MarqueeRect = { minX: 4, minY: 4, maxX: 6, maxY: 6 };
  assert.ok(!ELEMENT_ADAPTERS.guideDustPath.marqueeTest(path, rect, makeRoom()));
});

test('guide path: marquee touching a waypoint (but no segment) selects it', () => {
  const path = makePath([{ xBlock: 0, yBlock: 0 }, { xBlock: 100, yBlock: 100 }]);
  const rect: MarqueeRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  assert.ok(ELEMENT_ADAPTERS.guideDustPath.marqueeTest(path, rect, makeRoom()));
});
