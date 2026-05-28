/**
 * tileGridCompressor.ts — Greedy tile-grid compression algorithm for the v2
 * room schema.
 *
 * Encodes a boolean raster of occupied block cells into a compact
 * rects/runs/points representation.  Used by `roomSchemaV2.ts` to compress
 * uniform solid walls during room dehydration.
 *
 * Extracted from roomSchemaV2.ts to keep the schema/hydration code focused on
 * data shapes and I/O rather than algorithmic internals.
 *
 * Algorithm overview (three-pass deterministic tile cover):
 *   1. Rectangles (minimum 2×2, minimum area RECT_MIN_AREA).
 *   2. Horizontal runs (length ≥ RUN_MIN_LENGTH).
 *   3. Remaining single cells become points.
 */

// ── Primitive saved-layer types ──────────────────────────────────────────────

/** A compact axis-aligned rectangle: [x, y, w, h] in block units. */
export type SavedRect = readonly [number, number, number, number];
/** A compact horizontal run: [y, xStart, xEndExclusive] in block units. */
export type SavedRun = readonly [number, number, number];
/** A compact point (single tile): [x, y] in block units. */
export type SavedPoint = readonly [number, number];

/** Encoded solids for a single block theme. All three forms may be empty. */
export interface SavedSolidLayer {
  rects?: SavedRect[];
  runs?: SavedRun[];
  points?: SavedPoint[];
}

// ── Algorithm constants ──────────────────────────────────────────────────────

/** Minimum area for a greedy rectangle to be emitted as a rect (vs. runs). */
const RECT_MIN_AREA = 4;
/** Minimum side length for a greedy rectangle. */
const RECT_MIN_SIDE = 2;
/** Minimum length for a horizontal run primitive. */
const RUN_MIN_LENGTH = 2;

// ── TileGrid ─────────────────────────────────────────────────────────────────

interface TileGrid {
  widthBlocks: number;
  heightBlocks: number;
  cells: Uint8Array;
}

export function createTileGrid(widthBlocks: number, heightBlocks: number): TileGrid {
  return {
    widthBlocks,
    heightBlocks,
    cells: new Uint8Array(widthBlocks * heightBlocks),
  };
}

function gridIndex(grid: TileGrid, x: number, y: number): number {
  return y * grid.widthBlocks + x;
}

/**
 * Fills a rectangular region in the grid, clamping to grid bounds so
 * out-of-bounds tiles are silently discarded (the boundary wall regenerator
 * may emit rectangles that extend past `widthBlocks` for tunnel overhangs).
 */
export function paintRect(grid: TileGrid, x: number, y: number, w: number, h: number): void {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(grid.widthBlocks, x + w);
  const y1 = Math.min(grid.heightBlocks, y + h);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      grid.cells[gridIndex(grid, xx, yy)] = 1;
    }
  }
}

/**
 * Greedy maximal rectangle starting at (x0, y0).  Grows right as far as
 * possible while every cell is filled, then grows down as far as possible
 * while every cell in the row is filled.
 */
function maximalRectAt(grid: TileGrid, x0: number, y0: number): { w: number; h: number } {
  // Grow width.
  let w = 0;
  while (x0 + w < grid.widthBlocks && grid.cells[gridIndex(grid, x0 + w, y0)] === 1) {
    w += 1;
  }
  if (w === 0) return { w: 0, h: 0 };

  // Grow height — each new row must be fully filled across [x0, x0+w).
  let h = 1;
  while (y0 + h < grid.heightBlocks) {
    let allFilled = true;
    const rowStart = gridIndex(grid, x0, y0 + h);
    for (let i = 0; i < w; i++) {
      if (grid.cells[rowStart + i] !== 1) { allFilled = false; break; }
    }
    if (!allFilled) break;
    h += 1;
  }
  return { w, h };
}

function clearRect(grid: TileGrid, x: number, y: number, w: number, h: number): void {
  for (let yy = y; yy < y + h; yy++) {
    const rowStart = gridIndex(grid, x, yy);
    for (let i = 0; i < w; i++) {
      grid.cells[rowStart + i] = 0;
    }
  }
}

// ── Expansion helpers (hydrate direction) ─────────────────────────────────────

/**
 * Expand a SavedSolidLayer back to an array of [x, y, w, h] rectangles.
 *
 * Used by the hydrator to convert compressed zone layers (water/lava/bgBlocks)
 * back to the verbose rectangle list the rest of the engine expects.
 *
 *  • Each `rects` entry is passed through as-is.
 *  • Each `runs` entry [y, xStart, xEnd] becomes a 1-tall rect [xStart, y, xEnd-xStart, 1].
 *  • Each `points` entry [x, y] becomes [x, y, 1, 1].
 */
export function expandLayerToRects(layer: SavedSolidLayer): SavedRect[] {
  const out: SavedRect[] = [];
  if (layer.rects) {
    for (const r of layer.rects) out.push(r);
  }
  if (layer.runs) {
    for (const [y, xStart, xEnd] of layer.runs) {
      out.push([xStart, y, xEnd - xStart, 1]);
    }
  }
  if (layer.points) {
    for (const [x, y] of layer.points) {
      out.push([x, y, 1, 1]);
    }
  }
  return out;
}

/**
 * Expand a Saved1x1Layer back to an array of [x, y] cell coordinates.
 *
 * Used by the hydrator to convert compressed ambient-blocker layers back to
 * the per-cell list the lighting system expects.
 *
 *  • Each `runs` entry [y, xStart, xEnd] expands to individual cells [x, y].
 *  • Each `points` entry [x, y] is passed through as-is.
 */
export function expandBlockerLayerToCells(layer: { runs?: ReadonlyArray<readonly [number, number, number]>; points?: ReadonlyArray<readonly [number, number]> }): Array<readonly [number, number]> {
  const out: Array<readonly [number, number]> = [];
  if (layer.runs) {
    for (const [y, xStart, xEnd] of layer.runs) {
      for (let x = xStart; x < xEnd; x++) out.push([x, y]);
    }
  }
  if (layer.points) {
    for (const pt of layer.points) out.push(pt);
  }
  return out;
}

/**
 * One-pass 1×1-safe layer extraction: horizontal runs + points ONLY.
 *
 * Used for walls that were originally authored as 1×1 (or hBlock=1) tiles to
 * ensure they **never** get promoted to 2D rectangles.  Any 2D rect hydrated
 * back as a RoomJsonWall with hBlock > 1 would be tiled into 2×2 sub-blocks by
 * `_buildSolid2x2Map`, changing the visual grain from 1×1 to 2×2.
 *
 * By emitting only runs (hBlock = 1 after hydration) and points (1×1), we
 * guarantee the runtime renderer keeps the 1×1 visual intent.
 *
 * The grid is read but NOT modified.
 */
export function extract1x1LayerFromGrid(grid: TileGrid): { runs?: SavedRun[]; points?: SavedPoint[] } {
  const runs: SavedRun[] = [];
  const points: SavedPoint[] = [];

  for (let y = 0; y < grid.heightBlocks; y++) {
    let x = 0;
    while (x < grid.widthBlocks) {
      if (grid.cells[gridIndex(grid, x, y)] !== 1) { x += 1; continue; }
      let end = x + 1;
      while (end < grid.widthBlocks && grid.cells[gridIndex(grid, end, y)] === 1) end += 1;
      const len = end - x;
      if (len >= RUN_MIN_LENGTH) {
        runs.push([y, x, end]);
      } else {
        points.push([x, y]);
      }
      x = end;
    }
  }

  // Deterministic sort: runs by (y, xStart); points by (y, x).
  runs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  points.sort((a, b) => a[1] - b[1] || a[0] - b[0]);

  const out: { runs?: SavedRun[]; points?: SavedPoint[] } = {};
  if (runs.length > 0) out.runs = runs;
  if (points.length > 0) out.points = points;
  return out;
}

/**
 * Three-pass deterministic tile cover:
 *   1. Rectangles (min 2×2, min area RECT_MIN_AREA).
 *   2. Horizontal runs (length ≥ RUN_MIN_LENGTH).
 *   3. Points (length 1 leftovers).
 */
export function extractLayerFromGrid(grid: TileGrid): SavedSolidLayer {
  const rects: SavedRect[] = [];
  const runs: SavedRun[] = [];
  const points: SavedPoint[] = [];

  // Pass 1 — rectangles.  Scan row-major; first seed found is the top-left
  // corner of the next rectangle.
  for (let y = 0; y < grid.heightBlocks; y++) {
    for (let x = 0; x < grid.widthBlocks; x++) {
      if (grid.cells[gridIndex(grid, x, y)] !== 1) continue;
      const { w, h } = maximalRectAt(grid, x, y);
      if (w >= RECT_MIN_SIDE && h >= RECT_MIN_SIDE && w * h >= RECT_MIN_AREA) {
        rects.push([x, y, w, h]);
        clearRect(grid, x, y, w, h);
      }
      // Otherwise leave the cell alone for run/point extraction.
    }
  }

  // Pass 2 — horizontal runs (length ≥ RUN_MIN_LENGTH).
  for (let y = 0; y < grid.heightBlocks; y++) {
    let x = 0;
    while (x < grid.widthBlocks) {
      if (grid.cells[gridIndex(grid, x, y)] !== 1) { x += 1; continue; }
      let end = x + 1;
      while (end < grid.widthBlocks && grid.cells[gridIndex(grid, end, y)] === 1) end += 1;
      const len = end - x;
      if (len >= RUN_MIN_LENGTH) {
        runs.push([y, x, end]);
        for (let i = x; i < end; i++) grid.cells[gridIndex(grid, i, y)] = 0;
      }
      x = end;
    }
  }

  // Pass 3 — remaining single cells.
  for (let y = 0; y < grid.heightBlocks; y++) {
    for (let x = 0; x < grid.widthBlocks; x++) {
      if (grid.cells[gridIndex(grid, x, y)] === 1) {
        points.push([x, y]);
        grid.cells[gridIndex(grid, x, y)] = 0;
      }
    }
  }

  // Deterministic sort: rects by (y, x, w, h); runs by (y, xStart); points by (y, x).
  rects.sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2] - b[2] || a[3] - b[3]);
  runs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  points.sort((a, b) => a[1] - b[1] || a[0] - b[0]);

  const layer: SavedSolidLayer = {};
  if (rects.length > 0) layer.rects = rects;
  if (runs.length > 0) layer.runs = runs;
  if (points.length > 0) layer.points = points;
  return layer;
}
