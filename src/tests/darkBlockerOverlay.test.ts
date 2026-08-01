import { describe, it, expect, beforeEach } from 'vitest';
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

describe('darkBlockerOverlay rectangle merging (phase 1 mesher integration)', () => {
  beforeEach(() => {
    // Clear any state left by a previous test.
    setActiveDarkAmbientBlockers(undefined);
  });

  it('draws nothing when there are no dark blockers', () => {
    const { ctx, calls } = makeFakeCtx();
    setActiveDarkAmbientBlockers(undefined);
    renderDarkAmbientBlockerOverlay(ctx, 0, 0, 1, 16);
    expect(calls.length).toBe(0);
  });

  it('merges a large filled rectangular region into a single fillRect call', () => {
    const { ctx, calls } = makeFakeCtx();
    setActiveDarkAmbientBlockers(keysForRect(0, 0, 20, 20));
    renderDarkAmbientBlockerOverlay(ctx, 0, 0, 1, 16, 10000, 10000);
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual([0, 0, 20 * 16, 20 * 16]);
  });

  it('merges an L-shaped region into more than one but far fewer than per-cell rects', () => {
    const { ctx, calls } = makeFakeCtx();
    const keys = new Set<string>();
    for (const k of keysForRect(0, 0, 1, 10)) keys.add(k); // vertical column
    for (const k of keysForRect(0, 9, 10, 1)) keys.add(k); // horizontal foot
    setActiveDarkAmbientBlockers(keys);
    renderDarkAmbientBlockerOverlay(ctx, 0, 0, 1, 16, 10000, 10000);
    expect(calls.length).toBeLessThan(keys.size);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('rebuilds only when the active key set changes (dirty-flag cache)', () => {
    const { ctx, calls } = makeFakeCtx();
    setActiveDarkAmbientBlockers(keysForRect(0, 0, 5, 5));
    renderDarkAmbientBlockerOverlay(ctx, 0, 0, 1, 16, 10000, 10000);
    renderDarkAmbientBlockerOverlay(ctx, 0, 0, 1, 16, 10000, 10000);
    // Two render calls against the same unchanged set produce the same single rect twice.
    expect(calls.length).toBe(2);
    expect(calls[0]).toEqual(calls[1]);
  });

  it('viewport-culls rectangles fully outside the given viewport', () => {
    const { ctx, calls } = makeFakeCtx();
    setActiveDarkAmbientBlockers(keysForRect(1000, 1000, 5, 5));
    renderDarkAmbientBlockerOverlay(ctx, 0, 0, 1, 16, 480, 270);
    expect(calls.length).toBe(0);
  });

  it('never merges across a hole (irregular shape parity)', () => {
    const { ctx, calls } = makeFakeCtx();
    const keys = keysForRect(0, 0, 5, 5);
    keys.delete('2,2'); // punch a hole in the middle
    setActiveDarkAmbientBlockers(keys);
    renderDarkAmbientBlockerOverlay(ctx, 0, 0, 1, 16, 10000, 10000);
    // No emitted rectangle may cover the hole cell (2,2).
    for (const [x, y, w, h] of calls) {
      const coversHole = 2 * 16 >= x && 2 * 16 < x + w && 2 * 16 >= y && 2 * 16 < y + h;
      expect(coversHole).toBe(false);
    }
  });
});
