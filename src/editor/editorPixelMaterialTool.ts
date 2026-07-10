/**
 * Editor pixel-material tool — places/erases individual 1x1 pixel-material
 * particles at native-pixel granularity (not the 8x8 block grid used by
 * every other placement tool).
 *
 * Kept as its own module (rather than folded into editorPlaceTool.ts /
 * editorDeleteTool.ts) because it operates at a different coordinate
 * granularity and needs gap-free line painting during drag — both are
 * specific enough to this one tool that mixing them into the block-grid
 * tools would complicate those hot paths for every other placement kind.
 */

import type { EditorState, EditorPixelMaterial } from './editorState';
import { canPlacePixelMaterialAt } from './editorHitTest';

/** Converts the editor's world-space cursor position (already in native
 *  pixels — 1 world unit = 1 native px) to an integer pixel cell. */
export function pixelFromCursor(state: EditorState): { x: number; y: number } {
  return { x: Math.floor(state.cursorWorldX), y: Math.floor(state.cursorWorldY) };
}

export function placePixelMaterialAt(state: EditorState, xPixel: number, yPixel: number, material: number): boolean {
  const room = state.roomData;
  if (room === null) return false;
  if (!canPlacePixelMaterialAt(room, xPixel, yPixel)) return false;
  if (!room.pixelMaterials) room.pixelMaterials = [];
  const entry: EditorPixelMaterial = { uid: state.nextUid++, xPixel, yPixel, material };
  room.pixelMaterials.push(entry);
  return true;
}

export function erasePixelMaterialAt(state: EditorState, xPixel: number, yPixel: number): boolean {
  const room = state.roomData;
  if (room === null || !room.pixelMaterials) return false;
  const i = room.pixelMaterials.findIndex(p => p.xPixel === xPixel && p.yPixel === yPixel);
  if (i < 0) return false;
  const removedUid = room.pixelMaterials[i].uid;
  room.pixelMaterials.splice(i, 1);
  state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
  return true;
}

/**
 * Paints (or erases) every native pixel along the line from (x0,y0) to
 * (x1,y1) using Bresenham's algorithm, so fast mouse movement during a drag
 * cannot skip cells — a straight per-frame single-cell placement would leave
 * gaps whenever the cursor moves more than one native pixel between frames.
 */
export function paintPixelMaterialLine(
  state: EditorState,
  x0: number, y0: number,
  x1: number, y1: number,
  material: number,
  erase: boolean,
): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  for (;;) {
    if (erase) erasePixelMaterialAt(state, x, y);
    else placePixelMaterialAt(state, x, y, material);

    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}
