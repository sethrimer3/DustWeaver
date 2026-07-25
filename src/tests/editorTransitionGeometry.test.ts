import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSingleTransitionPlacement,
  computeFillTransitionPlacement,
  computeRectTransitionPlacement,
  DEFAULT_TRANSITION_GRADIENT_BLOCKS,
} from '../editor/editorBrush';
import type { EditorRoomData } from '../editor/editorElementTypes';

// NOTE: `getDoorCenterWorld` (editorVisualMapHelpers.ts) is not imported here
// because that module transitively imports '../levels/rooms', which relies
// on Vite-only `import.meta.env`/`import.meta.glob` and cannot load under
// the plain `node --test` runner used by `npm test`. Its formula —
// `[cx + rw, cy + yB + opening/2]` for 'right', mirrored for the other three
// directions — is exercised indirectly below via `computeSingleTransitionPlacement`
// and `computeRectTransitionPlacement`, which share the same xBlock/yBlock/
// openingSizeBlocks contract and are depth-independent by construction (depth
// only ever changes `gradientWidthBlocks`, never the opening anchor).

type TestWallRect = { xBlock: number; yBlock: number; wBlock: number; hBlock: number };

function makeRoom(overrides: Partial<EditorRoomData> = {}): EditorRoomData {
  return {
    widthBlocks: 20,
    heightBlocks: 20,
    interiorWalls: [],
    ...overrides,
  } as unknown as EditorRoomData;
}

// ── Single-click placement: all four directions ─────────────────────────────

test('single-click placement: depth defaults to 2 for all four directions', () => {
  const room = makeRoom();
  for (const direction of ['left', 'right', 'up', 'down'] as const) {
    const p = computeSingleTransitionPlacement(room, 5, 5, direction);
    assert.equal(p.gradientWidthBlocks, 2);
    assert.equal(p.gradientWidthBlocks, DEFAULT_TRANSITION_GRADIENT_BLOCKS);
    assert.ok(p.openingSizeBlocks >= 1);
  }
});

test('single-click placement: explicit depth is clamped to a minimum of 2', () => {
  const room = makeRoom();
  const p = computeSingleTransitionPlacement(room, 5, 5, 'right', undefined, 0);
  assert.equal(p.gradientWidthBlocks, 2);
  const p2 = computeSingleTransitionPlacement(room, 5, 5, 'right', undefined, -5);
  assert.equal(p2.gradientWidthBlocks, 2);
});

test('single-click placement: horizontal vs vertical zone axis matches direction', () => {
  const room = makeRoom();
  const right = computeSingleTransitionPlacement(room, 5, 5, 'right');
  const down = computeSingleTransitionPlacement(room, 5, 5, 'down');
  // Horizontal (left/right) transitions: positionBlock tracks yBlock.
  assert.equal(right.positionBlock, right.yBlock);
  // Vertical (up/down) transitions: positionBlock tracks xBlock.
  assert.equal(down.positionBlock, down.xBlock);
});

// ── Fill tool: contiguous span, stopping at obstacles ────────────────────────

test('fill tool: expands opening through contiguous unobstructed tiles until hitting obstacles', () => {
  // Room 1 tile wide (x=0..0 unused here), boundary is the 'down' edge
  // (y = heightBlocks-1). Along x (0..29), an obstacle wall occupies a
  // single column at x=10 and x=20, clicked at x=15: expect the opening to
  // span x=11..19 inclusive = 9 tiles, i.e. 10 valid contiguous tiles minus
  // click point unioned appropriately (verify exact contiguous bound math).
  const room = makeRoom({
    widthBlocks: 30,
    heightBlocks: 10,
    interiorWalls: [
      { xBlock: 10, yBlock: 9, wBlock: 1, hBlock: 1 } as TestWallRect,
      { xBlock: 20, yBlock: 9, wBlock: 1, hBlock: 1 } as TestWallRect,
    ],
  });
  const p = computeFillTransitionPlacement(room, 15, 9, 'down');
  assert.ok(p !== null);
  assert.equal(p!.gradientWidthBlocks, 2);
  // lo=11, hi=19 -> 9 tiles.
  assert.equal(p!.openingSizeBlocks, 9);
  assert.equal(p!.xBlock, 11);
});

test('fill tool: example from spec — 10 + click + 8 contiguous tiles = opening of 19', () => {
  // Along y (0..29) for a 'right' transition, boundary x = widthBlocks-1.
  // Obstacle at y=3 and y=23; clicked at y=13 (10 tiles free below down to
  // y=4, 9 tiles free above up to y=22, plus the click tile itself).
  const room = makeRoom({
    widthBlocks: 10,
    heightBlocks: 30,
    interiorWalls: [
      { xBlock: 9, yBlock: 3, wBlock: 1, hBlock: 1 } as TestWallRect,
      { xBlock: 9, yBlock: 23, wBlock: 1, hBlock: 1 } as TestWallRect,
    ],
  });
  const p = computeFillTransitionPlacement(room, 9, 13, 'right');
  assert.ok(p !== null);
  // lo=4, hi=22 -> 19 tiles.
  assert.equal(p!.openingSizeBlocks, 19);
  assert.equal(p!.yBlock, 4);
});

test('fill tool: zero/degenerate click on an obstructed tile returns null', () => {
  const room = makeRoom({
    widthBlocks: 10,
    heightBlocks: 10,
    interiorWalls: [{ xBlock: 9, yBlock: 5, wBlock: 1, hBlock: 1 } as TestWallRect],
  });
  const p = computeFillTransitionPlacement(room, 9, 5, 'right');
  assert.equal(p, null);
});

test('fill tool: click outside room bounds returns null', () => {
  const room = makeRoom({ widthBlocks: 10, heightBlocks: 10 });
  // 'down' expands along the x axis, so an out-of-range x is the relevant case.
  const p = computeFillTransitionPlacement(room, -1, 9, 'down');
  assert.equal(p, null);
});

// ── Rect tool: two-click bounding box geometry ───────────────────────────────

test('rect tool: box touching the left edge creates a "left" transition with correct depth/opening', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 20 });
  // Box from (0,2) to (3,7): touches left edge (dist 0), width=4 -> depth,
  // height=6 -> opening.
  const p = computeRectTransitionPlacement(room, 0, 2, 3, 7);
  assert.equal(p.direction, 'left');
  assert.equal(p.gradientWidthBlocks, 4);
  assert.equal(p.openingSizeBlocks, 6);
  assert.equal(p.xBlock, 0);
  assert.equal(p.yBlock, 2);
});

test('rect tool: box touching the right edge anchors depth against the right wall', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 20 });
  const p = computeRectTransitionPlacement(room, 16, 2, 19, 7);
  assert.equal(p.direction, 'right');
  assert.equal(p.gradientWidthBlocks, 4);
  assert.equal(p.xBlock, 16); // widthBlocks(20) - gw(4)
});

test('rect tool: box touching the top edge creates an "up" transition', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 20 });
  const p = computeRectTransitionPlacement(room, 2, 0, 8, 2);
  assert.equal(p.direction, 'up');
  assert.equal(p.gradientWidthBlocks, 3);
  assert.equal(p.openingSizeBlocks, 7);
  assert.equal(p.yBlock, 0);
});

test('rect tool: box touching the bottom edge creates a "down" transition', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 20 });
  const p = computeRectTransitionPlacement(room, 2, 17, 8, 19);
  assert.equal(p.direction, 'down');
  assert.equal(p.gradientWidthBlocks, 3);
  assert.equal(p.yBlock, 17); // heightBlocks(20) - gw(3)
});

test('rect tool: depth is clamped to a minimum of 2 for a 1-tile-thin box', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 20 });
  const p = computeRectTransitionPlacement(room, 0, 5, 0, 9);
  assert.equal(p.gradientWidthBlocks, 2);
});

test('rect tool: degenerate single-cell click produces a valid minimum-size transition', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 20 });
  const p = computeRectTransitionPlacement(room, 0, 5, 0, 5);
  assert.equal(p.direction, 'left');
  assert.equal(p.gradientWidthBlocks, 2);
  assert.equal(p.openingSizeBlocks, 1);
});

// ── Map-anchor (door-center) correctness, independent of depth ──────────────
//
// `getDoorCenterWorld` (editorVisualMapHelpers.ts) computes the door anchor
// as [roomEdge, yBlock + openingSizeBlocks/2] (or the transposed form for
// up/down) — it reads xBlock/yBlock/openingSizeBlocks but never
// gradientWidthBlocks. These placement helpers own xBlock/yBlock/opening, so
// asserting they don't vary with depth here is an equivalent, importable
// proxy for "the map anchor doesn't move when depth changes" (see note above
// for why importing editorVisualMapHelpers.ts itself isn't possible in this
// test runner).

test('rect tool: door anchor (xBlock/yBlock/openingSizeBlocks) is unaffected by requested depth', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 20 });
  const shallow = computeRectTransitionPlacement(room, 16, 2, 18, 7); // 3-wide box -> depth 3
  const deep = computeRectTransitionPlacement(room, 12, 2, 18, 7); // 7-wide box -> depth 7
  // Both touch the right edge; opening + yBlock (the door's along-edge
  // anchor) must match even though depth differs.
  assert.equal(shallow.direction, 'right');
  assert.equal(deep.direction, 'right');
  assert.equal(shallow.yBlock, deep.yBlock);
  assert.equal(shallow.openingSizeBlocks, deep.openingSizeBlocks);
  assert.notEqual(shallow.gradientWidthBlocks, deep.gradientWidthBlocks);
});

test('single-click: door anchor (yBlock/openingSizeBlocks) is unaffected by gradientWidthBlocks', () => {
  const room = makeRoom({ widthBlocks: 20, heightBlocks: 20 });
  const shallow = computeSingleTransitionPlacement(room, 5, 5, 'right', 6, 2);
  const deep = computeSingleTransitionPlacement(room, 5, 5, 'right', 6, 10);
  assert.equal(shallow.yBlock, deep.yBlock);
  assert.equal(shallow.openingSizeBlocks, deep.openingSizeBlocks);
  assert.equal(shallow.positionBlock, deep.positionBlock);
});
