/**
 * Editor hit-test and geometry helpers.
 *
 * Pure functions that test spatial relationships between cursor positions and
 * editor objects.  Extracted from editorTools.ts so the select, place, and
 * delete tools can each import only what they need without pulling in the full
 * tools module.
 */

import type { EditorRoomData, EditorWall, EditorTransition } from './editorState';

// ── Basic hit-test primitives ────────────────────────────────────────────────

export function hitTestZone(
  zone: { xBlock: number; yBlock: number; wBlock: number; hBlock: number },
  bx: number,
  by: number,
): boolean {
  return bx >= zone.xBlock && bx < zone.xBlock + zone.wBlock
      && by >= zone.yBlock && by < zone.yBlock + zone.hBlock;
}

export function hitTestWall(w: EditorWall, bx: number, by: number): boolean {
  return bx >= w.xBlock && bx < w.xBlock + w.wBlock
      && by >= w.yBlock && by < w.yBlock + w.hBlock;
}

export function hitTestPoint(xBlock: number, yBlock: number, bx: number, by: number): boolean {
  return Math.abs(bx - xBlock) < 1.5 && Math.abs(by - yBlock) < 1.5;
}

/**
 * Returns true if the straight line from (ax, ay) to (bx, by) in block
 * coordinates intersects any solid interior wall in the room.
 *
 * Uses a segment-vs-AABB test: project the segment onto each wall's bounding
 * box using the separating-axis theorem in 2D.
 */
export function ropeLineCrossesWall(
  room: EditorRoomData,
  axBlock: number,
  ayBlock: number,
  bxBlock: number,
  byBlock: number,
): boolean {
  for (const w of room.interiorWalls) {
    // Wall AABB in block space
    const wl = w.xBlock;
    const wr = w.xBlock + w.wBlock;
    const wt = w.yBlock;
    const wb = w.yBlock + w.hBlock;

    // Segment direction
    const sdx = bxBlock - axBlock;
    const sdy = byBlock - ayBlock;

    // We use the parametric clipping approach (Liang-Barsky for AABB).
    // Segment: P = A + t*(B-A),  t in [0,1].
    // For AABB [wl,wr] x [wt,wb]: find t intervals where P is inside.
    let t0 = 0.0;
    let t1 = 1.0;

    // X axis
    if (Math.abs(sdx) < 1e-9) {
      // Parallel to X — outside if start X is outside wall X range
      if (axBlock < wl || axBlock > wr) continue;
    } else {
      const invDx = 1.0 / sdx;
      let tNear = (wl - axBlock) * invDx;
      let tFar  = (wr - axBlock) * invDx;
      if (tNear > tFar) { const tmp = tNear; tNear = tFar; tFar = tmp; }
      t0 = Math.max(t0, tNear);
      t1 = Math.min(t1, tFar);
      if (t0 > t1) continue;
    }

    // Y axis
    if (Math.abs(sdy) < 1e-9) {
      if (ayBlock < wt || ayBlock > wb) continue;
    } else {
      const invDy = 1.0 / sdy;
      let tNear = (wt - ayBlock) * invDy;
      let tFar  = (wb - ayBlock) * invDy;
      if (tNear > tFar) { const tmp = tNear; tNear = tFar; tFar = tmp; }
      t0 = Math.max(t0, tNear);
      t1 = Math.min(t1, tFar);
      if (t0 > t1) continue;
    }

    // Overlap found in [t0, t1] — segment crosses this wall
    return true;
  }

  // Also check room boundary: rope cannot extend outside the room
  const roomLeft  = 0;
  const roomRight = room.widthBlocks;
  const roomTop   = 0;
  const roomBot   = room.heightBlocks;
  if (
    axBlock < roomLeft || axBlock > roomRight || ayBlock < roomTop || ayBlock > roomBot ||
    bxBlock < roomLeft || bxBlock > roomRight || byBlock < roomTop || byBlock > roomBot
  ) {
    return true;
  }

  return false;
}

export function hitTestTransition(
  t: EditorTransition,
  bx: number,
  by: number,
  roomData: EditorRoomData,
): boolean {
  const DEPTH = 6;
  if (t.direction === 'left' || t.direction === 'right') {
    const zoneX = t.depthBlock !== undefined
      ? t.depthBlock
      : (t.direction === 'left' ? 0 : roomData.widthBlocks - DEPTH);
    return bx >= zoneX && bx < zoneX + DEPTH
      && by >= t.positionBlock && by < t.positionBlock + t.openingSizeBlocks;
  } else {
    const zoneY = t.depthBlock !== undefined
      ? t.depthBlock
      : (t.direction === 'up' ? 0 : roomData.heightBlocks - DEPTH);
    return by >= zoneY && by < zoneY + DEPTH
      && bx >= t.positionBlock && bx < t.positionBlock + t.openingSizeBlocks;
  }
}

/** Returns true if two wall rectangles (in block coordinates) overlap. */
export function wallsOverlap(
  a: EditorWall,
  bx: number, by: number,
  bw: number, bh: number,
): boolean {
  return a.xBlock < bx + bw &&
         a.xBlock + a.wBlock > bx &&
         a.yBlock < by + bh &&
         a.yBlock + a.hBlock > by;
}

// ── Falling block overlap helpers ─────────────────────────────────────────────

/**
 * Returns true if a falling block tile already occupies the given block cell.
 */
export function isFallingBlockAt(room: EditorRoomData, xBlock: number, yBlock: number): boolean {
  return (room.fallingBlocks ?? []).some(fb => fb.xBlock === xBlock && fb.yBlock === yBlock);
}

/**
 * Returns true if any falling block tile overlaps the given block rectangle
 * (xBlock, yBlock, wBlock × hBlock).
 */
export function rectOverlapsFallingBlocks(
  room: EditorRoomData,
  xBlock: number, yBlock: number,
  wBlock: number, hBlock: number,
): boolean {
  return (room.fallingBlocks ?? []).some(fb =>
    fb.xBlock >= xBlock && fb.xBlock < xBlock + wBlock &&
    fb.yBlock >= yBlock && fb.yBlock < yBlock + hBlock,
  );
}

/**
 * Returns true if any solid editor object (interior wall, crumble block, bounce
 * pad) overlaps the given block rectangle.
 *
 * Used when placing falling block tiles to prevent overlap with solid geometry.
 */
export function rectOverlapsSolidEditorObject(
  room: EditorRoomData,
  xBlock: number, yBlock: number,
  wBlock: number, hBlock: number,
): boolean {
  // Interior walls
  if (room.interiorWalls.some(w => wallsOverlap(w, xBlock, yBlock, wBlock, hBlock))) return true;
  // Crumble blocks
  if ((room.crumbleBlocks ?? []).some(b => {
    const bw = b.wBlock ?? 1;
    const bh = b.hBlock ?? 1;
    return xBlock < b.xBlock + bw && xBlock + wBlock > b.xBlock &&
           yBlock < b.yBlock + bh && yBlock + hBlock > b.yBlock;
  })) return true;
  // Bounce pads
  if ((room.bouncePads ?? []).some(b =>
    xBlock < b.xBlock + b.wBlock && xBlock + wBlock > b.xBlock &&
    yBlock < b.yBlock + b.hBlock && yBlock + hBlock > b.yBlock,
  )) return true;
  return false;
}

// ── Bounds helpers ───────────────────────────────────────────────────────────

export function isInsideRoom(room: EditorRoomData, xBlock: number, yBlock: number): boolean {
  return xBlock >= 0 && yBlock >= 0 && xBlock < room.widthBlocks && yBlock < room.heightBlocks;
}

export function rectFitsInsideRoom(
  room: EditorRoomData,
  xBlock: number, yBlock: number,
  wBlock: number, hBlock: number,
): boolean {
  return xBlock >= 0 && yBlock >= 0 &&
    xBlock + wBlock <= room.widthBlocks &&
    yBlock + hBlock <= room.heightBlocks;
}

// ── Surface scan helpers ─────────────────────────────────────────────────────

/**
 * Returns true if any solid interior wall (non-platform, non-ramp) occupies
 * the grid cell at (col, row).
 */
function isSolidWallAt(room: EditorRoomData, col: number, row: number): boolean {
  for (const w of room.interiorWalls) {
    if (w.isPlatformFlag === 1) continue;
    if (w.rampOrientation !== undefined) continue;
    if (col >= w.xBlock && col < w.xBlock + w.wBlock &&
        row >= w.yBlock && row < w.yBlock + w.hBlock) {
      return true;
    }
  }
  return false;
}

/**
 * Starting at (col, startRow) and searching DOWNWARD (increasing row),
 * returns the row of the first solid interior wall block, or null if none found.
 *
 * Used for placing floor decorations (mushrooms, glowGrass) that sit on the
 * TOP surface of the first solid ground block below the cursor.
 */
export function findFloorBlockRow(room: EditorRoomData, col: number, startRow: number): number | null {
  for (let row = startRow; row < room.heightBlocks; row++) {
    if (isSolidWallAt(room, col, row)) return row;
  }
  return null;
}

/**
 * Starting at (col, startRow) and searching UPWARD (decreasing row),
 * returns the row of the first solid interior wall block, or null if none found.
 *
 * Used for placing vines that hang from the BOTTOM surface of the first solid
 * ceiling block above the cursor.
 */
export function findCeilingBlockRow(room: EditorRoomData, col: number, startRow: number): number | null {
  for (let row = startRow; row >= 0; row--) {
    if (isSolidWallAt(room, col, row)) return row;
  }
  return null;
}

// ── Rect hit-test for transition zones ──────────────────────────────────────

export function hitTestTransitionRect(
  t: EditorTransition, minX: number, minY: number, maxX: number, maxY: number,
  room: EditorRoomData,
): boolean {
  const DEPTH = 6;
  let tx: number, ty: number, tw: number, th: number;
  if (t.direction === 'left' || t.direction === 'right') {
    const zoneX = t.depthBlock !== undefined
      ? t.depthBlock
      : (t.direction === 'left' ? 0 : room.widthBlocks - DEPTH);
    tx = zoneX; ty = t.positionBlock; tw = DEPTH; th = t.openingSizeBlocks;
  } else {
    const zoneY = t.depthBlock !== undefined
      ? t.depthBlock
      : (t.direction === 'up' ? 0 : room.heightBlocks - DEPTH);
    tx = t.positionBlock; ty = zoneY; tw = t.openingSizeBlocks; th = DEPTH;
  }
  return tx + tw > minX && tx < maxX + 1 && ty + th > minY && ty < maxY + 1;
}
