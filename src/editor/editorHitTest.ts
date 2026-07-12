/**
 * Editor hit-test and geometry helpers.
 *
 * Pure functions that test spatial relationships between cursor positions and
 * editor objects.  Extracted from editorTools.ts so the select, place, and
 * delete tools can each import only what they need without pulling in the full
 * tools module.
 */

import type { EditorRoomData, EditorWall, EditorTransition } from './editorState';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { isStairsSolidAtLocalPx } from '../levels/stairsGeometry';
import { getMaterialFootprintSize, MATERIAL_SAND } from '../sim/pixelMaterials/pixelMaterialTypes';

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
  _roomData: EditorRoomData,
): boolean {
  const hb = getTransitionEditorHitbox(t);
  if (hb.wBlock <= 0 || hb.hBlock <= 0) {
    // Zero-size zone: extend cursor tolerance by 1 in each axis
    return Math.abs(bx - hb.xBlock) <= 1 && Math.abs(by - hb.yBlock) <= 1;
  }
  return bx >= hb.xBlock && bx < hb.xBlock + hb.wBlock
      && by >= hb.yBlock && by < hb.yBlock + hb.hBlock;
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
  // Kinetic blocks
  if ((room.kineticBlocks ?? []).some(kb =>
    xBlock < kb.xBlock + kb.wBlock && xBlock + wBlock > kb.xBlock &&
    yBlock < kb.yBlock + kb.hBlock && yBlock + hBlock > kb.yBlock,
  )) return true;
  return false;
}

export function cellOverlapsSolidWall(room: EditorRoomData, bx: number, by: number): boolean {
  return room.interiorWalls.some(w =>
    w.isPlatformFlag !== 1 &&
    w.rampOrientation === undefined &&
    w.stairsOrientation === undefined &&
    wallsOverlap(w, bx, by, 1, 1),
  );
}

function rectOverlapsEditorZones(
  zones: readonly { xBlock: number; yBlock: number; wBlock: number; hBlock: number }[] | undefined,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean {
  return (zones ?? []).some(z =>
    bx < z.xBlock + z.wBlock && bx + bw > z.xBlock &&
    by < z.yBlock + z.hBlock && by + bh > z.yBlock,
  );
}

function cellOverlapsEditorPoints(
  points: readonly { xBlock: number; yBlock: number }[] | undefined,
  bx: number,
  by: number,
): boolean {
  return (points ?? []).some(p => p.xBlock === bx && p.yBlock === by);
}

/**
 * Returns true if the given NATIVE-PIXEL cell is occupied by any editor-
 * authored object that becomes SOLID, NON-PLATFORM runtime wall geometry —
 * i.e. the same policy `buildSolidMaskFromWorld`
 * (sim/pixelMaterials/pixelMaterialSolid.ts) uses when it scans
 * `WorldState.wallXWorld/Y/W/H` to build the pixel-material solid mask. This
 * is the single shared source of truth for "is this cell solid for
 * pixel-material purposes" on the editor side — do not duplicate these
 * per-object-type checks elsewhere; extend this function instead.
 *
 * Deliberately DIFFERENT from `cellOverlapsSolidWall` (which excludes shaped walls,
 * works at whole-block granularity, and is used by grapple-carry/phantasmal-
 * tile placement — those have their own, older, coarser policy). Pixel
 * materials need native-PIXEL precision, not block-cell precision, because
 * some runtime wall geometry is narrower than a full 8x8 block:
 *
 *   - Half-width pillars (`EditorWall.isPillarHalfWidthFlag === 1`): the
 *     runtime wall rect is only 4px wide (see `gameRoomWalls.ts`:
 *     `rawWWorld = Math.max(BLOCK_SIZE_MEDIUM / 2, wBlock * (BLOCK_SIZE_MEDIUM / 2))`
 *     when the flag is set), always anchored at the wall's left edge
 *     (`xBlock * BLOCK_SIZE_SMALL`). A block-cell-granularity check would
 *     treat the ENTIRE 8x8 block as solid and incorrectly reject placement
 *     in the empty right half — this function tests the real 4px-wide AABB
 *     instead, matching runtime exactly.
 *   - Stairs (`EditorWall.stairsOrientation !== undefined`): solid only where
 *     the stair template mask is, matching `buildSolidMaskFromWorld`'s
 *     step-rectangle expansion at runtime. Sand may be placed in a stair's
 *     empty upper region, exactly as it may settle there in game.
 *   - Legacy ramps: still full-rect (matches how they're stored in the wall
 *     array — `rampOrientationIndex` 0-3 only affects rendering/movement-
 *     surface logic elsewhere, the base AABB rect is always solid unless it's
 *     a platform).
 *
 * Runtime wall-geometry sources covered (see gameRoomWalls.ts / gameRoomHazards.ts
 * / gameRoomFallingBlocks.ts, which all push full-rect entries into the wall
 * arrays for these object types):
 *   - interior walls, INCLUDING stairs, ramps and half-width pillars (excluded only
 *     when isPlatformFlag === 1, matching the one-way-platform skip in
 *     `buildSolidMaskFromWorld`).
 *   - crumble blocks, bounce pads, kinetic blocks, falling block tiles — none
 *     of these have a sub-block-width concept, so they're still checked at
 *     block-cell granularity (equivalent to native-pixel precision for them).
 *
 * Deliberately EXCLUDED (these do NOT become wall-array entries at runtime,
 * per gameRoomHazards.ts): grapple-carry blocks, phantasmal tiles. Sand may
 * be placed through/inside them because runtime sand can too.
 *
 * NOTE: "breakable blocks" also become wall entries at runtime, but are not
 * currently authorable through the editor (no `EditorRoomData.breakableBlocks`
 * field exists), so there is nothing to check here yet — add a branch if that
 * ever becomes editor-authorable.
 */
export function isPixelMaterialSolidAtPixel(room: EditorRoomData, xPixel: number, yPixel: number): boolean {
  for (const w of room.interiorWalls) {
    if (w.isPlatformFlag === 1) continue;
    const x0 = w.xBlock * BLOCK_SIZE_SMALL;
    const y0 = w.yBlock * BLOCK_SIZE_SMALL;
    const wPx = w.isPillarHalfWidthFlag === 1
      ? Math.max(BLOCK_SIZE_SMALL / 2, w.wBlock * (BLOCK_SIZE_SMALL / 2))
      : Math.max(BLOCK_SIZE_SMALL, w.wBlock * BLOCK_SIZE_SMALL);
    const hPx = Math.max(BLOCK_SIZE_SMALL, w.hBlock * BLOCK_SIZE_SMALL);
    if (!(xPixel >= x0 && xPixel < x0 + wPx && yPixel >= y0 && yPixel < y0 + hPx)) continue;
    // Stairs are only solid where the template mask is — mirrors the runtime
    // `buildSolidMaskFromWorld` expansion so the editor and the sand sim agree.
    if (w.stairsOrientation !== undefined
        && !isStairsSolidAtLocalPx(w.stairsOrientation, wPx, hPx, xPixel - x0, yPixel - y0)) {
      continue;
    }
    return true;
  }

  const bx = Math.floor(xPixel / BLOCK_SIZE_SMALL);
  const by = Math.floor(yPixel / BLOCK_SIZE_SMALL);
  if ((room.crumbleBlocks ?? []).some(b => {
    const bw = b.wBlock ?? 1;
    const bh = b.hBlock ?? 1;
    return bx < b.xBlock + bw && bx + 1 > b.xBlock && by < b.yBlock + bh && by + 1 > b.yBlock;
  })) return true;
  if ((room.bouncePads ?? []).some(b =>
    bx < b.xBlock + b.wBlock && bx + 1 > b.xBlock && by < b.yBlock + b.hBlock && by + 1 > b.yBlock,
  )) return true;
  if ((room.kineticBlocks ?? []).some(kb =>
    bx < kb.xBlock + kb.wBlock && bx + 1 > kb.xBlock && by < kb.yBlock + kb.hBlock && by + 1 > kb.yBlock,
  )) return true;
  if (isFallingBlockAt(room, bx, by)) return true;
  return false;
}

/** @deprecated Kept only as a thin block-granularity wrapper for callers/tests
 *  that don't need pixel precision. New pixel-material code should call
 *  `isPixelMaterialSolidAtPixel` directly — block-cell granularity misses the
 *  half-width-pillar distinction it exists to fix. */
export function isPixelMaterialSolidAtBlockCell(room: EditorRoomData, bx: number, by: number): boolean {
  return isPixelMaterialSolidAtPixel(room, bx * BLOCK_SIZE_SMALL, by * BLOCK_SIZE_SMALL);
}

function pixelMaterialRectsOverlap(
  ax: number, ay: number, aSize: number,
  bx: number, by: number, bSize: number,
): boolean {
  return ax < bx + bSize && ax + aSize > bx && ay < by + bSize && ay + aSize > by;
}

/**
 * Returns true if a pixel-material particle of the given `material` may be
 * placed with its anchor at the given NATIVE-PIXEL coordinate — every cell of
 * its `getMaterialFootprintSize(material)` footprint must be: inside room
 * bounds, not solid (`isPixelMaterialSolidAtPixel`), and not overlapping any
 * other already-placed particle's footprint (1x1 or 2x2 alike). Material-
 * aware and footprint-aware by construction — callers never need their own
 * multi-cell overlap special-casing.
 */
export function canPlacePixelMaterialAt(
  room: EditorRoomData,
  xPixel: number,
  yPixel: number,
  material: number = MATERIAL_SAND,
): boolean {
  const widthPx = room.widthBlocks * BLOCK_SIZE_SMALL;
  const heightPx = room.heightBlocks * BLOCK_SIZE_SMALL;
  const size = getMaterialFootprintSize(material);

  if (xPixel < 0 || yPixel < 0 || xPixel + size > widthPx || yPixel + size > heightPx) return false;

  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if (isPixelMaterialSolidAtPixel(room, xPixel + dx, yPixel + dy)) return false;
    }
  }

  for (const p of (room.pixelMaterials ?? [])) {
    const pSize = getMaterialFootprintSize(p.material);
    if (pixelMaterialRectsOverlap(xPixel, yPixel, size, p.xPixel, p.yPixel, pSize)) return false;
  }
  return true;
}

export function canPlaceGrappleCarryBlockAt(room: EditorRoomData, bx: number, by: number): boolean {
  if (!rectFitsInsideRoom(room, bx, by, 1, 1)) return false;
  if (cellOverlapsSolidWall(room, bx, by)) return false;
  if (rectOverlapsEditorZones(room.bouncePads, bx, by, 1, 1)) return false;
  if (rectOverlapsEditorZones(room.kineticBlocks, bx, by, 1, 1)) return false;
  if (rectOverlapsFallingBlocks(room, bx, by, 1, 1)) return false;
  if (cellOverlapsEditorPoints(room.phantasmalTiles, bx, by)) return false;
  if (cellOverlapsEditorPoints(room.grappleCarryBlocks, bx, by)) return false;
  return true;
}

export function canPlacePhantasmalTileAt(room: EditorRoomData, bx: number, by: number): boolean {
  if (!rectFitsInsideRoom(room, bx, by, 1, 1)) return false;
  if (cellOverlapsSolidWall(room, bx, by)) return false;
  if (rectOverlapsFallingBlocks(room, bx, by, 1, 1)) return false;
  if (cellOverlapsEditorPoints(room.grappleCarryBlocks, bx, by)) return false;
  if (cellOverlapsEditorPoints(room.phantasmalTiles, bx, by)) return false;
  return true;
}

/**
 * Returns true if the given block cell is covered by any placed tile-like
 * solid object (interior wall, crumble block, or falling block tile).
 *
 * Used by the fill brush to determine the "occupied"/"empty" state a flood
 * fill should match, since those are the object types the fill brush paints
 * over with tile items.
 */
export function isCellOccupiedByTile(room: EditorRoomData, xBlock: number, yBlock: number): boolean {
  if (room.interiorWalls.some(w => hitTestWall(w, xBlock, yBlock))) return true;
  if ((room.crumbleBlocks ?? []).some(b => hitTestZone(
    { xBlock: b.xBlock, yBlock: b.yBlock, wBlock: b.wBlock ?? 1, hBlock: b.hBlock ?? 1 }, xBlock, yBlock,
  ))) return true;
  if (isFallingBlockAt(room, xBlock, yBlock)) return true;
  return false;
}

/**
 * Returns true if the given block cell is geometrically covered by any
 * existing water zone — including a merged/hydrated rectangle larger than
 * 1×1, not just a zone that exactly matches this cell's position and size.
 *
 * This is editor fill-occupancy, not runtime solidity: water never becomes
 * solid for gameplay collision. It exists so the Fill brush (and liquid
 * placement dedup) can treat existing water as a boundary/already-covered
 * region without touching `isCellOccupiedByTile` or any simulation code.
 */
export function isCellCoveredByWaterZone(room: EditorRoomData, xBlock: number, yBlock: number): boolean {
  return (room.waterZones ?? []).some(z => hitTestZone(z, xBlock, yBlock));
}

/**
 * Same as `isCellCoveredByWaterZone` but for lava zones.
 */
export function isCellCoveredByLavaZone(room: EditorRoomData, xBlock: number, yBlock: number): boolean {
  return (room.lavaZones ?? []).some(z => hitTestZone(z, xBlock, yBlock));
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
 * Returns true if any solid interior wall — non-platform, and not a shaped
 * wall (stairs or legacy ramp), whose solid area is not its bounding rect —
 * occupies the grid cell at (col, row).
 */
function isSolidWallAt(room: EditorRoomData, col: number, row: number): boolean {
  for (const w of room.interiorWalls) {
    if (w.isPlatformFlag === 1) continue;
    if (w.rampOrientation !== undefined) continue;
    if (w.stairsOrientation !== undefined) continue;
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
  _room: EditorRoomData,
): boolean {
  const hb = getTransitionEditorHitbox(t);
  return hb.xBlock + hb.wBlock > minX && hb.xBlock < maxX + 1
      && hb.yBlock + hb.hBlock > minY && hb.yBlock < maxY + 1;
}

// ── Editor hitbox for transitions ───────────────────────────────────────────

/**
 * Returns the editor-interaction bounding box for a transition.
 *
 * For transitions with gradientWidthBlocks > 0 this is the normal zone
 * rectangle.  For zero-gradient transitions (gw === 0) the zone is a
 * zero-width/height line that cannot be reliably grabbed, so the hitbox is
 * expanded by 1 block *behind* the transition (away from its facing
 * direction) to give the editor a usable click target.
 *
 * This expansion is purely an editor affordance — it has no effect on
 * gameplay, rendering, collision, or the actual gradientWidthBlocks value.
 */
export function getTransitionEditorHitbox(t: EditorTransition): {
  xBlock: number; yBlock: number; wBlock: number; hBlock: number;
} {
  const gw = t.gradientWidthBlocks ?? 3;
  const isHoriz = t.direction === 'left' || t.direction === 'right';
  if (gw === 0) {
    // Expand by 1 block behind the transition (away from facing direction).
    switch (t.direction) {
      case 'right':
        // Trigger is at x = t.xBlock; behind (left) = [t.xBlock - 1, t.xBlock)
        return { xBlock: t.xBlock - 1, yBlock: t.yBlock, wBlock: 1, hBlock: t.openingSizeBlocks };
      case 'left':
        // Trigger is at x = t.xBlock; behind (right) = [t.xBlock, t.xBlock + 1)
        return { xBlock: t.xBlock, yBlock: t.yBlock, wBlock: 1, hBlock: t.openingSizeBlocks };
      case 'down':
        // Trigger is at y = t.yBlock; behind (up) = [t.yBlock - 1, t.yBlock)
        return { xBlock: t.xBlock, yBlock: t.yBlock - 1, wBlock: t.openingSizeBlocks, hBlock: 1 };
      case 'up':
        // Trigger is at y = t.yBlock; behind (down) = [t.yBlock, t.yBlock + 1)
        return { xBlock: t.xBlock, yBlock: t.yBlock, wBlock: t.openingSizeBlocks, hBlock: 1 };
    }
  }
  const wBlock = isHoriz ? gw : t.openingSizeBlocks;
  const hBlock = isHoriz ? t.openingSizeBlocks : gw;
  return { xBlock: t.xBlock, yBlock: t.yBlock, wBlock, hBlock };
}
