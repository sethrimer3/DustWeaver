import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RoomChunkCache, CHUNK_SIZE_BLOCKS } from '../render/walls/chunkRenderCache';

/**
 * Regression coverage for tall-room chunk culling (see task: "harden
 * rendering for unusually tall campaign rooms"). `isViewportCovered` is a
 * pure read that runs the same `_fillChunkRange` arithmetic used by
 * `renderVisibleChunks`, so it's a safe way to exercise the range math
 * without needing a real `HTMLCanvasElement`/document.
 */

const BLOCK_SIZE = 8;
const VP_W = 480;
const VP_H = 270;

test('chunk range: camera at top of a very tall room stays within a small non-negative row range', () => {
  const cache = new RoomChunkCache();
  // scalePx must be set before isViewportCovered will do real range math
  // (it bails out early when _scalePx === 0), so seed it via a private-cast
  // poke — mirrors the pattern used in chunkRenderCacheGameplayFallback.test.ts.
  (cache as unknown as { _scalePx: number })._scalePx = 1;

  const offsetXPx = VP_W / 2 - 50; // camera x=50
  const offsetYPx = VP_H / 2 - 10; // camera y=10, near room top
  // Room is 100 x 5000 world units tall — isViewportCovered doesn't take the
  // room size directly, but the point is the same range math must behave
  // identically regardless of how tall the room actually is.
  const covered = cache.isViewportCoreCovered(offsetXPx, offsetYPx, VP_W, VP_H, 1, BLOCK_SIZE);
  // No chunks built yet, so it must report NOT covered (never silently "ok").
  assert.equal(covered, false);
});

test('chunk range: camera deep in a tall room (large Y) produces a valid non-inverted row range', () => {
  const cache = new RoomChunkCache();
  (cache as unknown as { _scalePx: number })._scalePx = 1;

  const offsetXPx = VP_W / 2 - 50;
  const offsetYPx = VP_H / 2 - 4990; // camera y=4990, near bottom of a 5000-tall room
  // Must not throw and must consistently report false (no chunks built) —
  // an inverted or NaN range would either throw inside the loop or silently
  // report `true` (vacuously "covered" because the loop body never runs).
  assert.doesNotThrow(() => {
    cache.isViewportCoreCovered(offsetXPx, offsetYPx, VP_W, VP_H, 1, BLOCK_SIZE);
  });
  assert.equal(cache.isViewportCoreCovered(offsetXPx, offsetYPx, VP_W, VP_H, 1, BLOCK_SIZE), false);
});

test('chunk range: degenerate scalePx/blockSizePx never produces a range that vacuously reads as covered', () => {
  const cache = new RoomChunkCache();
  (cache as unknown as { _scalePx: number })._scalePx = 1;

  // scalePx mismatch (0) short-circuits inside isViewportCoreCovered's own
  // guard, so exercise the degenerate-blockSizePx path directly instead,
  // which flows through _fillChunkRange's own defensive branch.
  for (const badBlockSize of [0, -8, NaN, Infinity]) {
    assert.doesNotThrow(() => {
      cache.isViewportCoreCovered(0, 0, VP_W, VP_H, 1, badBlockSize);
    });
    assert.equal(
      cache.isViewportCoreCovered(0, 0, VP_W, VP_H, 1, badBlockSize),
      false,
      `blockSizePx=${badBlockSize} must never report vacuously covered`,
    );
  }
});

test('CHUNK_SIZE_BLOCKS is a positive integer (sanity guard for chunk math)', () => {
  assert.ok(Number.isInteger(CHUNK_SIZE_BLOCKS));
  assert.ok(CHUNK_SIZE_BLOCKS > 0);
});
