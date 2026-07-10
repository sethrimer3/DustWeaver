/**
 * Editor pixel-material tool — places/erases pixel-material particles
 * (1x1 or 2x2) at native-pixel granularity (not the 8x8 block grid used by
 * every other placement tool).
 *
 * Kept as its own module (rather than folded into editorPlaceTool.ts /
 * editorDeleteTool.ts) because it operates at a different coordinate
 * granularity and needs gap-free line painting during drag — both are
 * specific enough to this one tool that mixing them into the block-grid
 * tools would complicate those hot paths for every other placement kind.
 *
 * Material-aware by construction — every function here takes (or derives)
 * a footprint size from `getMaterialFootprintSize(material)`; there is no
 * caller-side 2x2 special case anywhere else in the editor.
 */

import type { EditorState, EditorPixelMaterial } from './editorState';
import { canPlacePixelMaterialAt } from './editorHitTest';
import { MATERIAL_SAND, getMaterialFootprintSize } from '../sim/pixelMaterials/pixelMaterialTypes';

/** Converts the editor's world-space cursor position (already in native
 *  pixels — 1 world unit = 1 native px) to an integer pixel cell. */
export function pixelFromCursor(state: EditorState): { x: number; y: number } {
  return { x: Math.floor(state.cursorWorldX), y: Math.floor(state.cursorWorldY) };
}

/**
 * Snaps a raw native-pixel coordinate down to the nearest multiple of `size`
 * — i.e. the nearest valid anchor for a `size x size` footprint. For
 * `size === 1` (1x1 sand) this is the identity function, so 1x1 placement
 * keeps its existing free native-pixel behavior. For `size === 2` (2x2 sand)
 * this snaps to an even-pixel grid so 2x2 particles always align to a stable
 * 2x2 grid rather than landing on arbitrary odd/even boundaries depending on
 * where the cursor happened to be.
 */
function snapToFootprintGrid(v: number, size: number): number {
  return size <= 1 ? v : Math.floor(v / size) * size;
}

/** Snaps a cursor pixel position to the placement anchor for `material`'s footprint. */
export function anchorForMaterial(xPixel: number, yPixel: number, material: number): { x: number; y: number } {
  const size = getMaterialFootprintSize(material);
  return { x: snapToFootprintGrid(xPixel, size), y: snapToFootprintGrid(yPixel, size) };
}

export function placePixelMaterialAt(
  state: EditorState,
  xPixel: number,
  yPixel: number,
  material: number = MATERIAL_SAND,
): boolean {
  const room = state.roomData;
  if (room === null) return false;
  const anchor = anchorForMaterial(xPixel, yPixel, material);
  if (!canPlacePixelMaterialAt(room, anchor.x, anchor.y, material)) return false;
  if (!room.pixelMaterials) room.pixelMaterials = [];
  const entry: EditorPixelMaterial = { uid: state.nextUid++, xPixel: anchor.x, yPixel: anchor.y, material };
  room.pixelMaterials.push(entry);
  return true;
}

/** Erases whichever placed particle (1x1 or 2x2) covers the given native-pixel cell, if any. */
export function erasePixelMaterialAt(state: EditorState, xPixel: number, yPixel: number): boolean {
  const room = state.roomData;
  if (room === null || !room.pixelMaterials) return false;
  const i = room.pixelMaterials.findIndex(p => {
    const size = getMaterialFootprintSize(p.material);
    return xPixel >= p.xPixel && xPixel < p.xPixel + size &&
           yPixel >= p.yPixel && yPixel < p.yPixel + size;
  });
  if (i < 0) return false;
  const removedUid = room.pixelMaterials[i].uid;
  room.pixelMaterials.splice(i, 1);
  state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
  return true;
}

/**
 * Paints (or erases) a gap-free line of pixel-material anchors from (x0,y0)
 * to (x1,y1) using Bresenham's algorithm, so fast mouse movement during a
 * drag cannot skip cells. For `footprintSize > 1` materials, the line is
 * walked in FOOTPRINT-GRID units (endpoints and the Bresenham step both
 * divide/multiply by `size`) rather than raw pixels — this keeps painted 2x2
 * particles edge-to-edge instead of every-other-pixel-overlapping-then-
 * rejected. For `size === 1` this is identical to the original per-pixel walk.
 */
export function paintPixelMaterialLine(
  state: EditorState,
  x0: number, y0: number,
  x1: number, y1: number,
  material: number,
  erase: boolean,
): void {
  const size = getMaterialFootprintSize(material);
  let gx = Math.floor(x0 / size);
  let gy = Math.floor(y0 / size);
  const gx1 = Math.floor(x1 / size);
  const gy1 = Math.floor(y1 / size);
  const dx = Math.abs(gx1 - gx);
  const dy = -Math.abs(gy1 - gy);
  const sx = gx < gx1 ? 1 : -1;
  const sy = gy < gy1 ? 1 : -1;
  let err = dx + dy;

  for (;;) {
    const px = gx * size;
    const py = gy * size;
    if (erase) erasePixelMaterialAt(state, px, py);
    else placePixelMaterialAt(state, px, py, material);

    if (gx === gx1 && gy === gy1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; gx += sx; }
    if (e2 <= dx) { err += dx; gy += sy; }
  }
}
