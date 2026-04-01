/**
 * TetrisBlockEffect
 *
 * Ported from Thero_Idle_TD TetrisBlockEffect.js.
 * A slowly "walking" cluster of grid-aligned square blocks that fade in/out.
 * New blocks appear at the drift frontier while old trailing blocks fade out,
 * creating an organic wandering polyomino on the 480×270 virtual canvas.
 *
 * Cell size scaled down from 48px (large CSS viewport) to 24px for 480×270.
 */

import { TheroBackgroundEffect } from './theroBackgroundEffect';

// ─── Tuning constants ─────────────────────────────────────────────────────────

const CELL_SIZE_PX           = 24;
const TARGET_CLUSTER         = 42;
const MIN_CLUSTER            = 24;
const FADE_DURATION_MS       = 1600;
const STEP_INTERVAL_MS       = 520;
const DRIFT_CHANGE_INTERVAL_MS = 3800;
const FRONTIER_TOP_FRACTION  = 0.35;
const BLOCK_FILL_ALPHA       = 0.13;
const BLOCK_STROKE_ALPHA     = 0.07;
const BLOCK_COLOR_R          = 168;
const BLOCK_COLOR_G          = 22;
const BLOCK_COLOR_B          = 22;

// ─── Types ────────────────────────────────────────────────────────────────────

type CellState = 'fadingIn' | 'visible' | 'fadingOut';

interface Cell {
  col: number;
  row: number;
  state: CellState;
  alpha: number;
  addedAtMs: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

function neighbours(col: number, row: number): { col: number; row: number }[] {
  return [
    { col: col + 1, row },
    { col: col - 1, row },
    { col, row: row + 1 },
    { col, row: row - 1 },
  ];
}

function buildSeedCluster(
  centerCol: number,
  centerRow: number,
  targetSize: number,
  gridCols: number,
  gridRows: number,
): { col: number; row: number }[] {
  const result: { col: number; row: number }[] = [];
  const visited = new Set<string>();
  const queue   = [{ col: centerCol, row: centerRow }];
  visited.add(cellKey(centerCol, centerRow));

  while (result.length < targetSize && queue.length > 0) {
    const idx          = Math.floor(Math.random() * queue.length);
    const { col, row } = queue.splice(idx, 1)[0];
    if (col < 0 || row < 0 || col >= gridCols || row >= gridRows) continue;
    result.push({ col, row });
    for (const nb of neighbours(col, row)) {
      const k = cellKey(nb.col, nb.row);
      if (!visited.has(k) && nb.col >= 0 && nb.col < gridCols && nb.row >= 0 && nb.row < gridRows) {
        visited.add(k);
        queue.push(nb);
      }
    }
  }

  return result;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createTetrisBlockEffect(): TheroBackgroundEffect {
  const cells = new Map<string, Cell>();

  let driftAngle        = Math.random() * Math.PI * 2;
  let lastStepMs        = -1;
  let lastDriftChangeMs = -1;
  let lastTimestampMs   = -1;
  let gridCols          = 0;
  let gridRows          = 0;
  let initW             = 0;
  let initH             = 0;

  function computeGrid(widthPx: number, heightPx: number): void {
    gridCols = Math.ceil(widthPx  / CELL_SIZE_PX) + 2;
    gridRows = Math.ceil(heightPx / CELL_SIZE_PX) + 2;
  }

  function isInBounds(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < gridCols && row < gridRows;
  }

  function getFrontier(): { col: number; row: number }[] {
    const frontier:     { col: number; row: number }[] = [];
    const occupiedKeys = new Set(cells.keys());
    for (const [, cell] of cells) {
      if (cell.state === 'fadingOut') continue;
      for (const nb of neighbours(cell.col, cell.row)) {
        const k = cellKey(nb.col, nb.row);
        if (!occupiedKeys.has(k) && isInBounds(nb.col, nb.row)) frontier.push(nb);
      }
    }
    return frontier;
  }

  function liveCount(): number {
    let n = 0;
    for (const cell of cells.values()) { if (cell.state !== 'fadingOut') n++; }
    return n;
  }

  function driftScore(col: number, row: number): number {
    return col * Math.cos(driftAngle) + row * Math.sin(driftAngle);
  }

  function initialize(widthPx: number, heightPx: number, nowMs: number): void {
    cells.clear();
    computeGrid(widthPx, heightPx);

    const margin   = 3;
    const startCol = margin + Math.floor(Math.random() * Math.max(1, gridCols - 2 * margin));
    const startRow = margin + Math.floor(Math.random() * Math.max(1, gridRows - 2 * margin));

    const seed = buildSeedCluster(startCol, startRow, TARGET_CLUSTER, gridCols, gridRows);
    for (const { col, row } of seed) {
      cells.set(cellKey(col, row), { col, row, state: 'visible', alpha: 1, addedAtMs: nowMs });
    }

    lastStepMs        = nowMs;
    lastDriftChangeMs = nowMs;
    lastTimestampMs   = nowMs;
  }

  function step(nowMs: number): void {
    if (nowMs - lastDriftChangeMs >= DRIFT_CHANGE_INTERVAL_MS) {
      driftAngle        += (Math.random() - 0.5) * Math.PI * 0.55;
      lastDriftChangeMs  = nowMs;
    }

    const frontier = getFrontier();
    if (frontier.length > 0) {
      frontier.sort((a, b) => driftScore(b.col, b.row) - driftScore(a.col, a.row));
      const topN = Math.max(1, Math.floor(frontier.length * FRONTIER_TOP_FRACTION));
      const pick = frontier[Math.floor(Math.random() * topN)];
      const k    = cellKey(pick.col, pick.row);
      if (!cells.has(k)) {
        cells.set(k, { col: pick.col, row: pick.row, state: 'fadingIn', alpha: 0, addedAtMs: nowMs });
      }
    }

    if (liveCount() >= MIN_CLUSTER) {
      const removable: Cell[] = [];
      for (const cell of cells.values()) { if (cell.state === 'visible') removable.push(cell); }
      if (removable.length > 0) {
        removable.sort((a, b) => driftScore(a.col, a.row) - driftScore(b.col, b.row));
        const topN = Math.max(1, Math.floor(removable.length * FRONTIER_TOP_FRACTION));
        removable[Math.floor(Math.random() * topN)].state = 'fadingOut';
      }
    }

    lastStepMs = nowMs;
  }

  function update(nowMs: number, widthPx: number, heightPx: number): void {
    if (cells.size === 0 || Math.abs(widthPx - initW) > 50 || Math.abs(heightPx - initH) > 50) {
      initW = widthPx;
      initH = heightPx;
      initialize(widthPx, heightPx, nowMs);
    }
    computeGrid(widthPx, heightPx);

    const dtSec    = lastTimestampMs < 0 ? 0 : Math.min((nowMs - lastTimestampMs) / 1000, 0.2);
    lastTimestampMs = nowMs;

    const fadeRatePerSec = 1 / (FADE_DURATION_MS / 1000);

    for (const [key, cell] of cells) {
      if (cell.state === 'fadingIn') {
        cell.alpha = Math.min(1, cell.alpha + fadeRatePerSec * dtSec);
        if (cell.alpha >= 1) { cell.state = 'visible'; cell.alpha = 1; }
      } else if (cell.state === 'fadingOut') {
        cell.alpha = Math.max(0, cell.alpha - fadeRatePerSec * dtSec);
        if (cell.alpha <= 0) cells.delete(key);
      }
    }

    if (lastStepMs < 0 || nowMs - lastStepMs >= STEP_INTERVAL_MS) step(nowMs);
  }

  function draw(ctx: CanvasRenderingContext2D): void {
    if (!ctx || cells.size === 0) return;

    ctx.save();

    for (const cell of cells.values()) {
      if (cell.alpha <= 0.004) continue;
      const x     = cell.col * CELL_SIZE_PX;
      const y     = cell.row * CELL_SIZE_PX;
      const inner = CELL_SIZE_PX - 1;

      ctx.globalAlpha = cell.alpha * BLOCK_FILL_ALPHA;
      ctx.fillStyle   = `rgb(${BLOCK_COLOR_R},${BLOCK_COLOR_G},${BLOCK_COLOR_B})`;
      ctx.fillRect(x, y, inner, inner);

      ctx.globalAlpha = cell.alpha * BLOCK_STROKE_ALPHA;
      ctx.strokeStyle = `rgb(${BLOCK_COLOR_R + 40},${BLOCK_COLOR_G + 20},${BLOCK_COLOR_B + 20})`;
      ctx.lineWidth   = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, inner - 1, inner - 1);
    }

    ctx.restore();
  }

  function reset(): void {
    cells.clear();
    initW             = 0;
    initH             = 0;
    lastStepMs        = -1;
    lastDriftChangeMs = -1;
    lastTimestampMs   = -1;
  }

  return { update, draw, reset };
}
