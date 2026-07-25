/**
 * editorBrush.ts — Brush footprint calculation for the editor Place tool.
 *
 * Centralizes all brush size/shape logic so single, 3×3, 5×5, and rectangle
 * brushes all go through one place.  The controller and placement tool call
 * getBrushCells() to determine which grid cells to affect.
 */

import type { BrushMode, EditorRoomData } from './editorState';
import type { TransitionDirection } from '../levels/roomDef';
import {
  isCellOccupiedByTile,
  isCellCoveredByWaterZone,
  isCellCoveredByLavaZone,
  isCellCoveredByTimeStopField,
  isInsideRoom,
} from './editorHitTest';

/**
 * Fill traversal policy for the Fill brush. `'tile'` is the original
 * occupied/empty tile semantics (blocks, special blocks, ambient-light
 * blockers). `'water'`/`'lava'` are editor fill-occupancy semantics for
 * liquid painting: existing water AND existing lava both act as flood-fill
 * boundaries, matching neither runtime solidity nor `isCellOccupiedByTile`.
 * `'timeStop'` is the analogous policy for the independent TimeStop Field
 * layer: existing TimeStop tiles (and solid tiles) act as flood-fill
 * boundaries.
 */
export type FillKind = 'tile' | 'water' | 'lava' | 'timeStop';

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
      // Tile by the item's own footprint from the rect's top-left corner
      // (matching the top-left placement anchor) so a 2x2 item fills the
      // dragged area with non-overlapping 2x2 copies instead of an
      // overlapping copy anchored at every single cell.
      const cells: BrushCell[] = [];
      for (let y = y0; y + itemHBlock - 1 <= y1; y += itemHBlock) {
        for (let x = x0; x + itemWBlock - 1 <= x1; x += itemWBlock) {
          cells.push({ x, y });
        }
      }
      return cells;
    }

    default:
      // '3x3'/'5x5' are handled above via SQUARE_BRUSH_HALF_EXTENT.
      return [{ x: cursorX, y: cursorY }];
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
  if (fillKind === 'timeStop') {
    return isCellOccupiedByTile(room, x, y) || isCellCoveredByTimeStopField(room, x, y);
  }
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
 *
 * `itemWBlock`/`itemHBlock` (default 1) snap the box down to the true
 * tiled placement area — e.g. dragging a 5-cell-wide box with a 2x2 item
 * only fits two 2x2 copies (4 cells), so the box shows 4 wide, not 5. This
 * matches `getBrushCells`'s 'rect' tiling exactly, so the preview never
 * overstates the area that will actually be filled.
 */
export function getRectBrushPreview(
  cursorX: number,
  cursorY: number,
  rectStartX: number | null,
  rectStartY: number | null,
  itemWBlock = 1,
  itemHBlock = 1,
): { x: number; y: number; w: number; h: number } | null {
  if (rectStartX == null || rectStartY == null) return null;
  const x0 = Math.min(rectStartX, cursorX);
  const x1 = Math.max(rectStartX, cursorX);
  const y0 = Math.min(rectStartY, cursorY);
  const y1 = Math.max(rectStartY, cursorY);
  const rawW = x1 - x0 + 1;
  const rawH = y1 - y0 + 1;
  const w = Math.floor(rawW / itemWBlock) * itemWBlock;
  const h = Math.floor(rawH / itemHBlock) * itemHBlock;
  return { x: x0, y: y0, w, h };
}

/**
 * Returns the bounding box of a square brush ('3x3'/'5x5') for preview
 * outline rendering, in block units. Scales with the placed item's own
 * footprint — e.g. a 2x2 item on a 3x3 brush yields a 6x6 box — since the
 * brush paints a NxN grid of items, not an NxN grid of single cells.
 * Returns null for non-square brush modes.
 */
// ── Room-transition geometry (pure, edge-based — NOT the 2D flood-fill above) ──
//
// Transitions are edge-anchored trigger strips layered on top of complete
// boundary walls (see AGENTS.md: "Do not reintroduce boundary holes"). These
// helpers compute the geometry for a transition placement but never mutate
// room data or touch wall arrays — they are pure functions shared by
// editorPlaceTool.ts (actual placement) and editorPlacementPreviewDrawer.ts
// (live preview), so the two can never drift apart.

/** Default depth (into-the-wall gradient span) for a newly placed transition. */
export const DEFAULT_TRANSITION_GRADIENT_BLOCKS = 2;

/** Default edge-parallel opening length for a newly placed transition. */
const DEFAULT_TRANSITION_OPENING_BLOCKS = 6;

export interface TransitionPlacement {
  direction: TransitionDirection;
  xBlock: number;
  yBlock: number;
  openingSizeBlocks: number;
  gradientWidthBlocks: number;
  positionBlock: number;
}

/**
 * Single-click (or fill-tool, once its span is known) transition placement:
 * anchors the zone at the clicked cell, clamped so it fits inside the room.
 * `gradientWidthBlocks` is clamped to a minimum of 2 regardless of what's
 * passed in — depth 0/negative is never permitted for a newly placed zone.
 */
export function computeSingleTransitionPlacement(
  room: EditorRoomData,
  bx: number,
  by: number,
  direction: TransitionDirection,
  openingSizeBlocks?: number,
  gradientWidthBlocks: number = DEFAULT_TRANSITION_GRADIENT_BLOCKS,
): TransitionPlacement {
  const isHoriz = direction === 'left' || direction === 'right';
  const opening = openingSizeBlocks ?? (isHoriz
    ? Math.max(1, Math.min(DEFAULT_TRANSITION_OPENING_BLOCKS, room.heightBlocks - 2))
    : Math.max(1, Math.min(DEFAULT_TRANSITION_OPENING_BLOCKS, room.widthBlocks - 2)));
  const gw = Math.max(2, gradientWidthBlocks);
  const zoneW = isHoriz ? gw : opening;
  const zoneH = isHoriz ? opening : gw;
  const xBlock = Math.min(Math.max(0, bx), Math.max(0, room.widthBlocks - zoneW));
  const yBlock = Math.min(Math.max(0, by), Math.max(0, room.heightBlocks - zoneH));
  const positionBlock = isHoriz ? yBlock : xBlock;
  return { direction, xBlock, yBlock, openingSizeBlocks: opening, gradientWidthBlocks: gw, positionBlock };
}

/**
 * Fill-tool transition placement: depth is fixed at
 * {@link DEFAULT_TRANSITION_GRADIENT_BLOCKS}. The opening expands along the
 * edge-parallel axis from the clicked cell in both directions through the
 * contiguous run of unobstructed in-bounds tiles, stopping at the room
 * boundary or the first occupied/wall tile — whichever comes first.
 *
 * Returns `null` when the clicked cell itself is out of bounds or already
 * obstructed (nothing to expand from).
 */
export function computeFillTransitionPlacement(
  room: EditorRoomData,
  bx: number,
  by: number,
  direction: TransitionDirection,
): TransitionPlacement | null {
  const isHoriz = direction === 'left' || direction === 'right';
  const gw = DEFAULT_TRANSITION_GRADIENT_BLOCKS;

  const maxAlong = isHoriz ? room.heightBlocks : room.widthBlocks;
  const clickAlong = isHoriz ? by : bx;
  if (clickAlong < 0 || clickAlong >= maxAlong) return null;

  // Fixed coordinate along the boundary wall this direction faces — the
  // opening always hugs that edge, regardless of exactly where inside the
  // room the click landed along the perpendicular axis.
  const edgeCoord =
    direction === 'right' ? room.widthBlocks - 1 :
    direction === 'down'  ? room.heightBlocks - 1 :
    0;

  const isBlocked = (along: number): boolean => {
    const x = isHoriz ? edgeCoord : along;
    const y = isHoriz ? along : edgeCoord;
    return isCellOccupiedByTile(room, x, y);
  };

  if (isBlocked(clickAlong)) return null;

  let lo = clickAlong;
  while (lo - 1 >= 0 && !isBlocked(lo - 1)) lo--;
  let hi = clickAlong;
  while (hi + 1 < maxAlong && !isBlocked(hi + 1)) hi++;

  const openingSizeBlocks = hi - lo + 1;
  const zoneW = isHoriz ? gw : openingSizeBlocks;
  const zoneH = isHoriz ? openingSizeBlocks : gw;
  const xBlock = isHoriz
    ? Math.min(Math.max(0, bx), Math.max(0, room.widthBlocks - zoneW))
    : lo;
  const yBlock = isHoriz
    ? lo
    : Math.min(Math.max(0, by), Math.max(0, room.heightBlocks - zoneH));
  const positionBlock = isHoriz ? yBlock : xBlock;
  return { direction, xBlock, yBlock, openingSizeBlocks, gradientWidthBlocks: gw, positionBlock };
}

/**
 * Rect-tool transition placement: derives direction/edge, opening length,
 * and depth from the inclusive bounding box between two clicked corners.
 * The box's proximity to each of the four room boundary edges decides which
 * edge/direction the transition attaches to (nearest edge wins); the box
 * dimension perpendicular to that edge becomes the depth (gradient width,
 * clamped to a minimum of 2), and the dimension parallel to it becomes the
 * opening length.
 */
export function computeRectTransitionPlacement(
  room: EditorRoomData,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): TransitionPlacement {
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);

  const distLeft = x0;
  const distRight = (room.widthBlocks - 1) - x1;
  const distTop = y0;
  const distBottom = (room.heightBlocks - 1) - y1;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);

  let direction: TransitionDirection;
  if (minDist === distLeft) direction = 'left';
  else if (minDist === distRight) direction = 'right';
  else if (minDist === distTop) direction = 'up';
  else direction = 'down';

  const isHoriz = direction === 'left' || direction === 'right';
  const boxW = x1 - x0 + 1;
  const boxH = y1 - y0 + 1;

  const gw = Math.max(2, isHoriz ? boxW : boxH);
  const openingSizeBlocks = Math.max(1, isHoriz ? boxH : boxW);

  const xBlock = isHoriz
    ? (direction === 'left' ? 0 : Math.max(0, room.widthBlocks - gw))
    : x0;
  const yBlock = isHoriz
    ? y0
    : (direction === 'up' ? 0 : Math.max(0, room.heightBlocks - gw));

  const positionBlock = isHoriz ? yBlock : xBlock;
  return { direction, xBlock, yBlock, openingSizeBlocks, gradientWidthBlocks: gw, positionBlock };
}

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
