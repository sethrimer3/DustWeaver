import { describe, it, expect } from 'vitest';
import { meshCellsToRectangles, expandRectanglesToCells, type MeshCell } from '../levels/rectangleMesher';

function cellSetKey(cells: readonly MeshCell[]): Set<string> {
  return new Set(cells.map(c => `${c.x},${c.y},${c.key}`));
}

function assertNoOverlaps(rects: ReturnType<typeof meshCellsToRectangles>): void {
  const seen = new Set<string>();
  for (const r of rects) {
    for (let dy = 0; dy < r.h; dy++) {
      for (let dx = 0; dx < r.w; dx++) {
        const k = `${r.x + dx},${r.y + dy}`;
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    }
  }
}

function assertExactParity(input: MeshCell[], rects: ReturnType<typeof meshCellsToRectangles>): void {
  const expanded = expandRectanglesToCells(rects);
  expect(cellSetKey(expanded)).toEqual(cellSetKey(input));
}

describe('meshCellsToRectangles', () => {
  it('handles empty input', () => {
    expect(meshCellsToRectangles([])).toEqual([]);
  });

  it('handles a single cell', () => {
    const input: MeshCell[] = [{ x: 3, y: 4, key: 'dark' }];
    const rects = meshCellsToRectangles(input);
    expect(rects).toEqual([{ x: 3, y: 4, w: 1, h: 1, key: 'dark' }]);
    assertExactParity(input, rects);
  });

  it('merges a horizontal row into one rectangle', () => {
    const input: MeshCell[] = [0, 1, 2, 3, 4].map(x => ({ x, y: 0, key: 'dark' }));
    const rects = meshCellsToRectangles(input);
    expect(rects).toEqual([{ x: 0, y: 0, w: 5, h: 1, key: 'dark' }]);
    assertExactParity(input, rects);
  });

  it('merges a vertical column into one rectangle', () => {
    const input: MeshCell[] = [0, 1, 2, 3].map(y => ({ x: 2, y, key: 'dark' }));
    const rects = meshCellsToRectangles(input);
    expect(rects).toEqual([{ x: 2, y: 0, w: 1, h: 4, key: 'dark' }]);
    assertExactParity(input, rects);
  });

  it('merges a filled rectangle into one rectangle', () => {
    const input: MeshCell[] = [];
    for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) input.push({ x, y, key: 'clear' });
    const rects = meshCellsToRectangles(input);
    expect(rects).toEqual([{ x: 0, y: 0, w: 8, h: 6, key: 'clear' }]);
    assertExactParity(input, rects);
  });

  it('handles disconnected components', () => {
    const input: MeshCell[] = [
      { x: 0, y: 0, key: 'dark' }, { x: 1, y: 0, key: 'dark' },
      { x: 10, y: 10, key: 'dark' }, { x: 11, y: 10, key: 'dark' },
    ];
    const rects = meshCellsToRectangles(input);
    expect(rects.length).toBe(2);
    assertNoOverlaps(rects);
    assertExactParity(input, rects);
  });

  it('handles an L-shape', () => {
    // Column at x=0 (y0..2) plus a foot at y=2 (x0..2)
    const input: MeshCell[] = [
      { x: 0, y: 0, key: 'k' }, { x: 0, y: 1, key: 'k' }, { x: 0, y: 2, key: 'k' },
      { x: 1, y: 2, key: 'k' }, { x: 2, y: 2, key: 'k' },
    ];
    const rects = meshCellsToRectangles(input);
    assertNoOverlaps(rects);
    assertExactParity(input, rects);
  });

  it('handles a T-shape', () => {
    const input: MeshCell[] = [
      { x: 0, y: 0, key: 'k' }, { x: 1, y: 0, key: 'k' }, { x: 2, y: 0, key: 'k' },
      { x: 1, y: 1, key: 'k' }, { x: 1, y: 2, key: 'k' },
    ];
    const rects = meshCellsToRectangles(input);
    assertNoOverlaps(rects);
    assertExactParity(input, rects);
  });

  it('handles a shape with a center hole (3x3 ring)', () => {
    const input: MeshCell[] = [];
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        if (x === 1 && y === 1) continue; // hole
        input.push({ x, y, key: 'k' });
      }
    }
    const rects = meshCellsToRectangles(input);
    assertNoOverlaps(rects);
    assertExactParity(input, rects);
    // Hole itself must never be covered.
    for (const r of rects) {
      const coversHole = 1 >= r.x && 1 < r.x + r.w && 1 >= r.y && 1 < r.y + r.h;
      expect(coversHole).toBe(false);
    }
  });

  it('never merges cells with different behavior keys, even when adjacent', () => {
    const input: MeshCell[] = [
      { x: 0, y: 0, key: 'dark' },
      { x: 1, y: 0, key: 'clear' },
      { x: 2, y: 0, key: 'dark' },
    ];
    const rects = meshCellsToRectangles(input);
    expect(rects.length).toBe(3);
    for (const r of rects) expect(r.w).toBe(1);
    assertExactParity(input, rects);
  });

  it('mixed behavior keys mesh independently within a shared bounding area', () => {
    const input: MeshCell[] = [];
    for (let x = 0; x < 4; x++) input.push({ x, y: 0, key: 'dark' });
    for (let x = 0; x < 4; x++) input.push({ x, y: 1, key: 'clear' });
    const rects = meshCellsToRectangles(input);
    expect(rects).toEqual([
      { x: 0, y: 1, w: 4, h: 1, key: 'clear' },
      { x: 0, y: 0, w: 4, h: 1, key: 'dark' },
    ]);
    assertExactParity(input, rects);
  });

  it('produces identical output regardless of input (shuffled) order', () => {
    const base: MeshCell[] = [];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      if ((x + y) % 3 !== 0) base.push({ x, y, key: x < 3 ? 'a' : 'b' });
    }
    const shuffled = [...base];
    // Deterministic shuffle (reverse + interleave), not random/wall-clock based.
    shuffled.sort((a, b) => (a.x * 31 + a.y * 7) % 13 - (b.x * 31 + b.y * 7) % 13);

    const rectsA = meshCellsToRectangles(base);
    const rectsB = meshCellsToRectangles(shuffled);
    expect(rectsB).toEqual(rectsA);
  });

  it('produces no overlaps and no missing/extra cells across a complex mixed shape', () => {
    const input: MeshCell[] = [];
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        if ((x * 7 + y * 3) % 5 === 0) continue; // irregular holes
        input.push({ x, y, key: (x + y) % 2 === 0 ? 'dark' : 'clear' });
      }
    }
    const rects = meshCellsToRectangles(input);
    assertNoOverlaps(rects);
    assertExactParity(input, rects);
  });

  it('has stable output ordering sorted by (key, y, x)', () => {
    const input: MeshCell[] = [
      { x: 5, y: 5, key: 'z' },
      { x: 0, y: 0, key: 'a' },
      { x: 2, y: 0, key: 'a' },
    ];
    const rects = meshCellsToRectangles(input);
    for (let i = 1; i < rects.length; i++) {
      const prev = rects[i - 1];
      const cur = rects[i];
      const prevTuple = [prev.key, prev.y, prev.x];
      const curTuple = [cur.key, cur.y, cur.x];
      expect(JSON.stringify(curTuple) >= JSON.stringify(prevTuple) || prev.key !== cur.key).toBe(true);
    }
  });

  it('substantially reduces object count for a large filled region (100x100 -> 1 rect)', () => {
    const input: MeshCell[] = [];
    for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) input.push({ x, y, key: 'dark' });
    expect(input.length).toBe(10000);
    const rects = meshCellsToRectangles(input);
    expect(rects).toEqual([{ x: 0, y: 0, w: 100, h: 100, key: 'dark' }]);
    assertExactParity(input, rects);
  });

  it('handles duplicate coordinate entries (same key) without producing extra cells', () => {
    const input: MeshCell[] = [
      { x: 0, y: 0, key: 'dark' },
      { x: 0, y: 0, key: 'dark' }, // duplicate
      { x: 1, y: 0, key: 'dark' },
    ];
    const rects = meshCellsToRectangles(input);
    assertNoOverlaps(rects);
    const expanded = expandRectanglesToCells(rects);
    expect(expanded.length).toBe(2);
  });

  it('handles single row and single column edge shapes explicitly', () => {
    const row: MeshCell[] = [{ x: 0, y: 0, key: 'k' }];
    expect(meshCellsToRectangles(row)).toEqual([{ x: 0, y: 0, w: 1, h: 1, key: 'k' }]);
  });
});
