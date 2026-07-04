/**
 * editorBrush.ts — Brush footprint calculation for the editor Place tool.
 *
 * Centralizes all brush size/shape logic so single, 3×3, 5×5, and rectangle
 * brushes all go through one place.  The controller and placement tool call
 * getBrushCells() to determine which grid cells to affect.
 */

import type { BrushMode, EditorRoomData } from './editorState';
import { isCellOccupiedByTile, isInsideRoom } from './editorHitTest';

export interface BrushCell {
  x: number;
  y: number;
}

/**
 * Returns all grid cells that should be painted/deleted for the current brush.
 *
 * @param mode        Active brush mode.
 * @param cursorX     Current cursor block X.
 * @param cursorY     Current cursor block Y.
 * @param rectStartX  Rect-brush drag start X (only used when mode === 'rect').
 * @param rectStartY  Rect-brush drag start Y (only used when mode === 'rect').
 */
export function getBrushCells(
  mode: BrushMode,
  cursorX: number,
  cursorY: number,
  rectStartX?: number | null,
  rectStartY?: number | null,
): BrushCell[] {
  switch (mode) {
    case 'single':
      return [{ x: cursorX, y: cursorY }];

    case '3x3': {
      const cells: BrushCell[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          cells.push({ x: cursorX + dx, y: cursorY + dy });
        }
      }
      return cells;
    }

    case '5x5': {
      const cells: BrushCell[] = [];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          cells.push({ x: cursorX + dx, y: cursorY + dy });
        }
      }
      return cells;
    }

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
 * Flood-fills the contiguous region of cells (4-directionally connected —
 * never diagonally) that share the same occupied/empty state as the clicked
 * cell.  Used by the "fill" brush to paint an entire empty area or replace an
 * entire mass of placed tiles in one click.
 */
export function getFillBrushCells(
  room: EditorRoomData,
  startX: number,
  startY: number,
): BrushCell[] {
  if (!isInsideRoom(room, startX, startY)) return [];
  const targetOccupied = isCellOccupiedByTile(room, startX, startY);

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
      if (isCellOccupiedByTile(room, n.x, n.y) !== targetOccupied) continue;
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
