import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoomDef } from '../levels/roomDef';
import {
  drawRoomSketch,
  drawRoomSketchOpenAir,
  clearContourCache,
  clearOpenAirContourCache,
} from '../ui/mapSketchRenderer';

/**
 * Coverage for the single-stroke sketch contour fix in mapSketchRenderer.ts.
 *
 * Previously each contour was drawn with STROKE_COUNT (3) independently
 * jittered stroke() passes, producing a layered "pencil" look with multiple
 * parallel outlines around the same geometry. The fix collapses this to
 * exactly one stroke() call per drawable contour while retaining one
 * deterministic per-point jitter field.
 */

/** Minimal fake CanvasRenderingContext2D that records path/draw call counts. */
function makeFakeCtx() {
  const calls = { stroke: 0, closePath: 0, fill: 0, beginPath: 0 };
  const ctx = {
    save: () => {},
    restore: () => {},
    beginPath: () => { calls.beginPath++; },
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => { calls.closePath++; },
    stroke: () => { calls.stroke++; },
    fill: () => { calls.fill++; },
    set globalAlpha(_v: number) {},
    set strokeStyle(_v: string) {},
    set fillStyle(_v: string) {},
    set lineWidth(_v: number) {},
    set lineJoin(_v: string) {},
    set lineCap(_v: string) {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

/**
 * A solid 5x5 room with a single interior tile (2,2) carved out. All outer
 * solid-tile edges touch the room boundary and are suppressed by design, so
 * the only contour produced is the closed loop tracing the interior hole —
 * a reliable, algorithm-agnostic shape that both the legacy and open-air
 * contour builders resolve into exactly one closed contour.
 */
function makeHoleRoom(id: string): RoomDef {
  const w = 5;
  const h = 5;
  const walls = [
    { xBlock: 0, yBlock: 0, wBlock: w, hBlock: 2, isInvisibleFlag: 0 }, // rows 0-1
    { xBlock: 0, yBlock: 2, wBlock: 2, hBlock: 1, isInvisibleFlag: 0 }, // row 2, left of hole
    { xBlock: 3, yBlock: 2, wBlock: 2, hBlock: 1, isInvisibleFlag: 0 }, // row 2, right of hole
    { xBlock: 0, yBlock: 3, wBlock: w, hBlock: 2, isInvisibleFlag: 0 }, // rows 3-4
  ];
  return {
    id,
    name: id,
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    widthBlocks: w,
    heightBlocks: h,
    walls,
    enemies: [],
    playerSpawnBlock: [0, 0],
    transitions: [],
    saveTombs: [],
  } as unknown as RoomDef;
}

/**
 * A 3x3 room with a single solid tile in the top-left corner. Its top and
 * left edges touch the room boundary (suppressed); its right and bottom
 * edges border interior empty space, so the open-air tracer (which records
 * dead-end chain endpoints) resolves this into exactly one OPEN 3-point
 * "corner" contour — useful for verifying open contours are never closed.
 */
function makeCornerRoom(id: string): RoomDef {
  const w = 3;
  const h = 3;
  const walls = [{ xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 1, isInvisibleFlag: 0 }];
  return {
    id,
    name: id,
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    widthBlocks: w,
    heightBlocks: h,
    walls,
    enemies: [],
    playerSpawnBlock: [0, 0],
    transitions: [],
    saveTombs: [],
  } as unknown as RoomDef;
}

test('drawRoomSketch: exactly one stroke() call for the single closed contour', () => {
  clearContourCache();
  const room = makeHoleRoom('sketch-hole-a');
  const { ctx, calls } = makeFakeCtx();
  drawRoomSketch(ctx, room, 0, 0, 0, 0, 8, 1, false);
  // Only the interior hole contour is drawable (outer edges are boundary-
  // suppressed), so stroke() must be called exactly once — not STROKE_COUNT
  // (3) times as with the old layered-pencil implementation.
  assert.equal(calls.stroke, 1, 'expected exactly one stroke() call for the single contour');
});

test('drawRoomSketchOpenAir: exactly one stroke() call for the single closed contour', () => {
  clearOpenAirContourCache();
  const room = makeHoleRoom('sketch-hole-b');
  const { ctx, calls } = makeFakeCtx();
  drawRoomSketchOpenAir(ctx, room, 0, 0, 0, 0, 8, 1, false);
  assert.equal(calls.stroke, 1, 'expected exactly one stroke() call for the single contour');
});

test('open contours are never closed with closePath() or filled', () => {
  clearOpenAirContourCache();
  const room = makeCornerRoom('open-contour-room');
  const { ctx, calls } = makeFakeCtx();
  drawRoomSketchOpenAir(ctx, room, 0, 0, 0, 0, 8, 1, false);
  assert.equal(calls.stroke, 1, 'expected the single open contour to still be stroked once');
  assert.equal(calls.closePath, 0, 'open contour must not be closed with closePath()');
  assert.equal(calls.fill, 0, 'open contour must not be filled');
});

test('closed contours remain closed (fill + closed stroke path)', () => {
  clearContourCache();
  const room = makeHoleRoom('closed-contour-room');
  const { ctx, calls } = makeFakeCtx();
  drawRoomSketch(ctx, room, 0, 0, 0, 0, 8, 1, false);
  // A closed contour is drawn as: fill pass (beginPath/closePath/fill) +
  // stroke pass (beginPath/closePath/stroke) — one closePath from each path,
  // so two total, plus exactly one fill() and one stroke().
  assert.equal(calls.fill, 1, 'expected exactly one fill() call for the closed hole contour');
  assert.equal(calls.closePath, 2, 'expected one closePath() for the fill path and one for the stroke path');
  assert.equal(calls.stroke, 1, 'expected exactly one stroke() call for the closed contour');
});

test('rendering is deterministic for identical inputs', () => {
  clearContourCache();
  const room = makeHoleRoom('determinism-room');

  function captureCallSequence(): string[] {
    const seq: string[] = [];
    const ctx = {
      save: () => {},
      restore: () => {},
      beginPath: () => { seq.push('beginPath'); },
      moveTo: (x: number, y: number) => { seq.push(`moveTo(${x.toFixed(3)},${y.toFixed(3)})`); },
      lineTo: (x: number, y: number) => { seq.push(`lineTo(${x.toFixed(3)},${y.toFixed(3)})`); },
      closePath: () => { seq.push('closePath'); },
      stroke: () => { seq.push('stroke'); },
      fill: () => { seq.push('fill'); },
      set globalAlpha(_v: number) {},
      set strokeStyle(_v: string) {},
      set fillStyle(_v: string) {},
      set lineWidth(_v: number) {},
      set lineJoin(_v: string) {},
      set lineCap(_v: string) {},
    } as unknown as CanvasRenderingContext2D;
    drawRoomSketch(ctx, room, 0, 0, 0, 0, 8, 1, false);
    return seq;
  }

  const first = captureCallSequence();
  const second = captureCallSequence();
  assert.deepEqual(second, first, 'identical inputs must produce identical draw call sequences');
});

test('legacy and open-air entry points both use the single-stroke policy', () => {
  clearContourCache();
  clearOpenAirContourCache();
  const legacyRoom = makeHoleRoom('policy-legacy-room');
  const openAirRoom = makeHoleRoom('policy-openair-room');

  const legacy = makeFakeCtx();
  drawRoomSketch(legacy.ctx, legacyRoom, 0, 0, 0, 0, 8, 1, true);

  const openAir = makeFakeCtx();
  drawRoomSketchOpenAir(openAir.ctx, openAirRoom, 0, 0, 0, 0, 8, 1, true);

  assert.equal(legacy.calls.stroke, 1, 'legacy renderer must stroke the contour exactly once');
  assert.equal(openAir.calls.stroke, 1, 'open-air renderer must stroke the contour exactly once');
});
