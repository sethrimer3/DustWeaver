/**
 * editorBrush.ts — Brush footprint calculation for the editor Place tool.
 *
 * Centralizes all brush size/shape logic so single, 3×3, 5×5, and rectangle
 * brushes all go through one place.  The controller and placement tool call
 * getBrushCells() to determine which grid cells to affect.
 */

import type { BrushMode, EditorRoomData } from './editorState';
import {
  isCellOccupiedByTile,
  isCellCoveredByWaterZone,
  isCellCoveredByLavaZone,
  isInsideRoom,
} from './editorHitTest';

/**
 * Fill traversal policy for the Fill brush. `'tile'` is the original
 * occupied/empty tile semantics (blocks, special blocks, ambient-light
 * blockers). `'water'`/`'lava'` are editor fill-occupancy semantics for
 * liquid painting: existing water AND existing lava both act as flood-fill
 * boundaries, matching neither runtime solidity nor `isCellOccupiedByTile`.
 */
export type FillKind = 'tile' | 'water' | 'lava';

export interface BrushCell {
  x: number;
  y: number;
}

/** Half-extent (in item-footprint steps) of each square brush mode, e.g. '3x3' → 1 means offsets -1..1. */
const SQUARE_BRUSH_HALF_EXTENT: Partial<Record<BrushMode, number>> = {
  '3x3': 1,
  '5x5': 2,
};

/**
 * Returns all grid cells that should be painted/deleted for the current brush.
 *
 * For the square brushes ('3x3'/'5x5'), cells are stepped by the placed
 * item's own footprint (`itemWBlock`/`itemHBlock`) rather than by a single
 * block, so a 3x3 brush always paints a 3x3 grid of *items* — e.g. a 2x2
 * block on a 3x3 brush tiles a 6x6 area of nine non-overlapping 2x2 blocks,
 * not nine overlapping single-cell-offset copies.
 *
 * @param mode        Active brush mode.
 * @param cursorX     Current cursor block X.
 * @param cursorY     Current cursor block Y.
 * @param rectStartX  Rect-brush drag start X (only used when mode === 'rect').
 * @param rectStartY  Rect-brush drag start Y (only used when mode === 'rect').
 * @param itemWBlock  Footprint width of the item being painted (default 1).
 * @param itemHBlock  Footprint height of the item being painted (default 1).
 */
export function getBrushCells(
  mode: BrushMode,
  cursorX: number,
  cursorY: number,
  rectStartX?: number | null,
  rectStartY?: number | null,
  itemWBlock = 1,
  itemHBlock = 1,
): BrushCell[] {
  const squareHalfExtent = SQUARE_BRUSH_HALF_EXTENT[mode];
  if (squareHalfExtent !== undefined) {
    const cells: BrushCell[] = [];
    for (let dy = -squareHalfExtent; dy <= squareHalfExtent; dy++) {
      for (let dx = -squareHalfExtent; dx <= squareHalfExtent; dx++) {
        cells.push({ x: cursorX + dx * itemWBlock, y: cursorY + dy * itemHBlock });
      }
    }
    return cells;
  }

  switch (mode) {
    case 'single':
      return [{ x: cursorX, y: cursorY }];

    case 'fill':
      // Fill brush requires room data to flood-fill — see getFillBrushCells().
      return [{ x: cursorX, y: cursorY }];

    case 'rect': {
      if (rectStartX == null || rectStartY == null) {
        // No drag in progress — treat as single cell.
        return [{ x: cursorX, y: cursorY }];
      }
      const x0 = Math.min(rectStartX, cursorX);
      const x1 = Math.max(rectStartX, cursorX);
      const y0 = Math.min(rectStartY, cursorY);
      const y1 = Math.max(rectStartY, cursorY);
      const cells: BrushCell[] = [];
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          cells.push({ x, y });
        }
      }
      return cells;
    }
  }
}

/**
 * Classifies a single cell for fill-traversal purposes under the given
 * policy. For `'tile'` this is the original occupied/empty boolean state.
 * For `'water'`/`'lava'` it additionally treats BOTH existing water and
 * existing lava as "blocked" (a flood-fill boundary), since one liquid must
 * not flood through a pocket of the other liquid or through itself.
 */
export function getFillCellClass(room: EditorRoomData, x: number, y: number, fillKind: FillKind): boolean {
  if (fillKind === 'tile') return isCellOccupiedByTile(room, x, y);
  return isCellOccupiedByTile(room, x, y)
    || isCellCoveredByWaterZone(room, x, y)
    || isCellCoveredByLavaZone(room, x, y);
}

/**
 * Flood-fills the contiguous region of cells (4-directionally connected —
 * never diagonally) that share the same class as the clicked cell, under the
 * given fill policy.  Used by the "fill" brush to paint an entire empty area
 * or replace an entire mass of placed tiles in one click.
 *
 * For `fillKind` `'water'`/`'lava'`: if the start cell is itself blocked
 * (solid tile, existing water, or existing lava) the fill is a no-op — an
 * empty array is returned rather than flooding through the clicked liquid or
 * geometry, since a Fill click is only meaningful from empty space for those
 * kinds. Passing no `fillKind` (or `'tile'`) preserves the original
 * behavior: fills painted or empty tile regions alike, starting from either.
 */
export function getFillBrushCells(
  room: EditorRoomData,
  startX: number,
  startY: number,
  fillKind: FillKind = 'tile',
): BrushCell[] {
  if (!isInsideRoom(room, startX, startY)) return [];
  const targetClass = getFillCellClass(room, startX, startY, fillKind);
  if (fillKind !== 'tile' && targetClass) return [];

  const visited = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;
  const cells: BrushCell[] = [];
  const stack: BrushCell[] = [{ x: startX, y: startY }];
  visited.add(key(startX, startY));

  while (stack.length > 0) {
    const { x, y } = stack.pop()!;
    cells.push({ x, y });
    const neighbors: BrushCell[] = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ];
    for (const n of neighbors) {
      const k = key(n.x, n.y);
      if (visited.has(k)) continue;
      if (!isInsideRoom(room, n.x, n.y)) continue;
      if (getFillCellClass(room, n.x, n.y, fillKind) !== targetClass) continue;
      visited.add(k);
      stack.push(n);
    }
  }

  return cells;
}

/**
 * Returns the bounding box of a rect brush drag for preview rendering.
 * Returns null when no drag is active.
 */
export function getRectBrushPreview(
  cursorX: number,
  cursorY: number,
  rectStartX: number | null,
  rectStartY: number | null,
): { x: number; y: number; w: number; h: number } | null {
  if (rectStartX == null || rectStartY == null) return null;
  const x0 = Math.min(rectStartX, cursorX);
  const x1 = Math.max(rectStartX, cursorX);
  const y0 = Math.min(rectStartY, cursorY);
  const y1 = Math.max(rectStartY, cursorY);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Returns the bounding box of a square brush ('3x3'/'5x5') for preview
 * outline rendering, in block units. Scales with the placed item's own
 * footprint — e.g. a 2x2 item on a 3x3 brush yields a 6x6 box — since the
 * brush paints a NxN grid of items, not an NxN grid of single cells.
 * Returns null for non-square brush modes.
 */
export function getSquareBrushPreview(
  mode: BrushMode,
  cursorX: number,
  cursorY: number,
  itemWBlock = 1,
  itemHBlock = 1,
): { x: number; y: number; w: number; h: number } | null {
  const halfExtent = SQUARE_BRUSH_HALF_EXTENT[mode];
  if (halfExtent === undefined) return null;
  const span = halfExtent * 2 + 1;
  return {
    x: cursorX - halfExtent * itemWBlock,
    y: cursorY - halfExtent * itemHBlock,
    w: span * itemWBlock,
    h: span * itemHBlock,
  };
}
