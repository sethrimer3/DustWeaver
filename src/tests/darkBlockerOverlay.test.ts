import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setActiveDarkAmbientBlockers,
  renderDarkAmbientBlockerOverlay,
} from '../render/walls/darkBlockerOverlay';

/** Minimal fake CanvasRenderingContext2D capturing fillRect calls. */
function makeFakeCtx() {
  const calls: Array<[number, number, number, number]> = [];
  const ctx = {
    fillStyle: '',
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push([x, y, w, h]);
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

function keysForRect(x0: number, y0: number, w: number, h: number): Set<string> {
  const keys = new Set<string>();
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) keys.add(`${x},${y}`);
  }
  return keys;
}

test('darkBlockerOverlay: draws nothing when there are no dark blockers', () => {
  const { ctx, calls } = makeFakeCtx();
  setActiveDarkAmbientBlockers(undefined);
  renderDarkAmbientBlockerOverlay(ctx, 0, 0, 1, 16);
  assert.equal(calls.length, 0);
});

test('darkBlockerOverlay: merges a large filled rectangular region into a single fillRect call', () => {
  const { ctx, calls } = makeFakeCtx();
  setActiveDarkAmbientBlockers(keysForRect(0, 0, 20, 20));
  renderDarkAmbientBlockerOverlay(ctx, 0, 0, 1, 16, 10000, 10000);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [0, 0, 20 * 16, 20 * 16]);
});

test('darkBlockerOverlay: merges an L-shaped region into far fewer than per-cell rects', () => {
  const { ctx, calls } = makeFakeCtx();
  const keys = new Set<string>();
  for (const k of keysForRect(0, 0, 1, 10)) keys.add(k); // vertical column
  for (const k of keysForRect(0, 9, 10, 1)) keys.add(k); // horizontal foot
  setActiveDarkAmbientBlockers(keys);
  renderDarkAmbientBlockerOverlay(ctx, 0, 0, 1, 16, 10000, 10000);
  assert.ok(calls.length < keys.size);
  assert.ok(calls.length > 0);
});

test('darkBlockerOverlay: rebuilds only when the active key set changes (dirty-flag cache)', () => {
  const { ctx, calls } = makeFakeCtx();
  setActiveDarkAmbientBlockers(keysForRect(0, 0, 5, 5));
  renderDarkAmbientBlockerOverlay(ctx, 0, 0, 1, 16, 10000, 10000);
  renderDarkAmbientBlockerOverlay(ctx, 0, 0, 1, 16, 10000, 10000);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
});

test('darkBlockerOverlay: viewport-culls rectangles fully outside the given viewport', () => {
  const { ctx, calls } = makeFakeCtx();
  setActiveDarkAmbientBlockers(keysForRect(1000, 1000, 5, 5));
  renderDarkAmbientBlockerOverlay(ctx, 0, 0, 1, 16, 480, 270);
  assert.equal(calls.length, 0);
});

test('darkBlockerOverlay: never merges across a hole (irregular shape parity)', () => {
  const { ctx, calls } = makeFakeCtx();
  const keys = keysForRect(0, 0, 5, 5);
  keys.delete('2,2'); // punch a hole in the middle
  setActiveDarkAmbientBlockers(keys);
  renderDarkAmbientBlockerOverlay(ctx, 0, 0, 1, 16, 10000, 10000);
  for (const [x, y, w, h] of calls) {
    const coversHole = 2 * 16 >= x && 2 * 16 < x + w && 2 * 16 >= y && 2 * 16 < y + h;
    assert.equal(coversHole, false);
  }
});
