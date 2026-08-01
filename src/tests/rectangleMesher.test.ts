import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meshCellsToRectangles, expandRectanglesToCells, type MeshCell, type MeshRect } from '../levels/rectangleMesher';

function cellSetKey(cells: readonly MeshCell[]): Set<string> {
  return new Set(cells.map(c => `${c.x},${c.y},${c.key}`));
}

function assertNoOverlaps(rects: readonly MeshRect[]): void {
  const seen = new Set<string>();
  for (const r of rects) {
    for (let dy = 0; dy < r.h; dy++) {
      for (let dx = 0; dx < r.w; dx++) {
        const k = `${r.x + dx},${r.y + dy}`;
        assert.equal(seen.has(k), false, `overlap at ${k}`);
        seen.add(k);
      }
    }
  }
}

function assertExactParity(input: MeshCell[], rects: readonly MeshRect[]): void {
  const expanded = expandRectanglesToCells(rects);
  assert.deepEqual(cellSetKey(expanded), cellSetKey(input));
}

test('meshCellsToRectangles: handles empty input', () => {
  assert.deepEqual(meshCellsToRectangles([]), []);
});

test('meshCellsToRectangles: handles a single cell', () => {
  const input: MeshCell[] = [{ x: 3, y: 4, key: 'dark' }];
  const rects = meshCellsToRectangles(input);
  assert.deepEqual(rects, [{ x: 3, y: 4, w: 1, h: 1, key: 'dark' }]);
  assertExactParity(input, rects);
});

test('meshCellsToRectangles: merges a horizontal row into one rectangle', () => {
  const input: MeshCell[] = [0, 1, 2, 3, 4].map(x => ({ x, y: 0, key: 'dark' }));
  const rects = meshCellsToRectangles(input);
  assert.deepEqual(rects, [{ x: 0, y: 0, w: 5, h: 1, key: 'dark' }]);
  assertExactParity(input, rects);
});

test('meshCellsToRectangles: merges a vertical column into one rectangle', () => {
  const input: MeshCell[] = [0, 1, 2, 3].map(y => ({ x: 2, y, key: 'dark' }));
  const rects = meshCellsToRectangles(input);
  assert.deepEqual(rects, [{ x: 2, y: 0, w: 1, h: 4, key: 'dark' }]);
  assertExactParity(input, rects);
});

test('meshCellsToRectangles: merges a filled rectangle into one rectangle', () => {
  const input: MeshCell[] = [];
  for (let y = 0; y < 6; y++) for (let x = 0; x < 8; x++) input.push({ x, y, key: 'clear' });
  const rects = meshCellsToRectangles(input);
  assert.deepEqual(rects, [{ x: 0, y: 0, w: 8, h: 6, key: 'clear' }]);
  assertExactParity(input, rects);
});

test('meshCellsToRectangles: handles disconnected components', () => {
  const input: MeshCell[] = [
    { x: 0, y: 0, key: 'dark' }, { x: 1, y: 0, key: 'dark' },
    { x: 10, y: 10, key: 'dark' }, { x: 11, y: 10, key: 'dark' },
  ];
  const rects = meshCellsToRectangles(input);
  assert.equal(rects.length, 2);
  assertNoOverlaps(rects);
  assertExactParity(input, rects);
});

test('meshCellsToRectangles: handles an L-shape', () => {
  const input: MeshCell[] = [
    { x: 0, y: 0, key: 'k' }, { x: 0, y: 1, key: 'k' }, { x: 0, y: 2, key: 'k' },
    { x: 1, y: 2, key: 'k' }, { x: 2, y: 2, key: 'k' },
  ];
  const rects = meshCellsToRectangles(input);
  assertNoOverlaps(rects);
  assertExactParity(input, rects);
});

test('meshCellsToRectangles: handles a T-shape', () => {
  const input: MeshCell[] = [
    { x: 0, y: 0, key: 'k' }, { x: 1, y: 0, key: 'k' }, { x: 2, y: 0, key: 'k' },
    { x: 1, y: 1, key: 'k' }, { x: 1, y: 2, key: 'k' },
  ];
  const rects = meshCellsToRectangles(input);
  assertNoOverlaps(rects);
  assertExactParity(input, rects);
});

test('meshCellsToRectangles: handles a shape with a center hole (3x3 ring)', () => {
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
  for (const r of rects) {
    const coversHole = 1 >= r.x && 1 < r.x + r.w && 1 >= r.y && 1 < r.y + r.h;
    assert.equal(coversHole, false);
  }
});

test('meshCellsToRectangles: never merges cells with different behavior keys, even when adjacent', () => {
  const input: MeshCell[] = [
    { x: 0, y: 0, key: 'dark' },
    { x: 1, y: 0, key: 'clear' },
    { x: 2, y: 0, key: 'dark' },
  ];
  const rects = meshCellsToRectangles(input);
  assert.equal(rects.length, 3);
  for (const r of rects) assert.equal(r.w, 1);
  assertExactParity(input, rects);
});

test('meshCellsToRectangles: mixed behavior keys mesh independently within a shared bounding area', () => {
  const input: MeshCell[] = [];
  for (let x = 0; x < 4; x++) input.push({ x, y: 0, key: 'dark' });
  for (let x = 0; x < 4; x++) input.push({ x, y: 1, key: 'clear' });
  const rects = meshCellsToRectangles(input);
  // Sorted by (key, y, x) -> 'clear' before 'dark' alphabetically.
  assert.deepEqual(rects, [
    { x: 0, y: 1, w: 4, h: 1, key: 'clear' },
    { x: 0, y: 0, w: 4, h: 1, key: 'dark' },
  ]);
  assertExactParity(input, rects);
});

test('meshCellsToRectangles: produces identical output regardless of input (shuffled) order', () => {
  const base: MeshCell[] = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
    if ((x + y) % 3 !== 0) base.push({ x, y, key: x < 3 ? 'a' : 'b' });
  }
  const shuffled = [...base];
  shuffled.sort((a, b) => ((a.x * 31 + a.y * 7) % 13) - ((b.x * 31 + b.y * 7) % 13));

  const rectsA = meshCellsToRectangles(base);
  const rectsB = meshCellsToRectangles(shuffled);
  assert.deepEqual(rectsB, rectsA);
});

test('meshCellsToRectangles: produces no overlaps and no missing/extra cells across a complex mixed shape', () => {
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

test('meshCellsToRectangles: has stable output ordering sorted by (key, y, x)', () => {
  const input: MeshCell[] = [
    { x: 5, y: 5, key: 'z' },
    { x: 0, y: 0, key: 'a' },
    { x: 2, y: 0, key: 'a' },
  ];
  const rects = meshCellsToRectangles(input);
  for (let i = 1; i < rects.length; i++) {
    const prev = rects[i - 1];
    const cur = rects[i];
    const inOrder = prev.key < cur.key ||
      (prev.key === cur.key && (prev.y < cur.y || (prev.y === cur.y && prev.x <= cur.x)));
    assert.equal(inOrder, true);
  }
});

test('meshCellsToRectangles: substantially reduces object count for a large filled region (100x100 -> 1 rect)', () => {
  const input: MeshCell[] = [];
  for (let y = 0; y < 100; y++) for (let x = 0; x < 100; x++) input.push({ x, y, key: 'dark' });
  assert.equal(input.length, 10000);
  const rects = meshCellsToRectangles(input);
  assert.deepEqual(rects, [{ x: 0, y: 0, w: 100, h: 100, key: 'dark' }]);
  assertExactParity(input, rects);
});

test('meshCellsToRectangles: handles duplicate coordinate entries (same key) without producing extra cells', () => {
  const input: MeshCell[] = [
    { x: 0, y: 0, key: 'dark' },
    { x: 0, y: 0, key: 'dark' }, // duplicate
    { x: 1, y: 0, key: 'dark' },
  ];
  const rects = meshCellsToRectangles(input);
  assertNoOverlaps(rects);
  const expanded = expandRectanglesToCells(rects);
  assert.equal(expanded.length, 2);
});

test('meshCellsToRectangles: handles a single-cell edge shape explicitly', () => {
  const row: MeshCell[] = [{ x: 0, y: 0, key: 'k' }];
  assert.deepEqual(meshCellsToRectangles(row), [{ x: 0, y: 0, w: 1, h: 1, key: 'k' }]);
});
