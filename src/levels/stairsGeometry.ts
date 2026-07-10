/**
 * stairsGeometry.ts — authoritative solidity definition for stair walls.
 *
 * A stair wall is a rectangular AABB whose interior is only partially solid.
 * Solidity is defined by a regular grid of `stepCount × stepCount` cells that
 * exactly reproduces the authored template masks under
 * `ASSETS/SPRITES/BLOCKS/block_templates/*  stairs/`:
 *
 *   1x1 stairs (8×8 px)   → 4 steps, cells 2×2 px
 *   1x2 stairs (16×8 px)  → 4 steps, cells 4×2 px
 *   2x2 stairs (16×16 px) → 8 steps, cells 2×2 px
 *
 * Every step therefore has a 2 px riser (`STAIRS_RISER_HEIGHT_PX`), and
 * `stepCount = heightPx / 2`.  In the base orientation (rises going right) a
 * cell is solid iff `col + row >= stepCount - 1`, which is the lower-right
 * staircase triangle. The other three orientations are axis mirrors of it, so
 * they share the ramp orientation convention exactly:
 *
 *   0 = rises right   (solid lower-right)   — template as authored
 *   1 = rises left    (solid lower-left)    — mirrored on X
 *   2 = ceiling stair (solid upper-right)   — mirrored on Y
 *   3 = ceiling stair (solid upper-left)    — mirrored on both axes
 *
 * This module is the single source of truth consulted by:
 *   • player/cluster collision  (movementStairsCollision.ts)
 *   • the falling-sand solid mask (pixelMaterialSolid.ts)
 *   • the grapple raycast        (grappleShared.ts)
 * so no consumer ever approximates a stair as its full bounding rectangle.
 * Rendering derives the same shape independently, from the template PNG's
 * alpha channel — `stairsMaskPatternRows()` exists so tests can assert the two
 * agree.
 *
 * ── Orientation index encoding ──────────────────────────────────────────────
 * Stairs reuse the wall array's existing `rampOrientationIndex` slot rather
 * than adding a parallel array, because every consumer that must not treat a
 * shaped wall as a plain rectangle already branches on `!== 255`. The value
 * space is partitioned:
 *
 *   0..3   → ramp orientation      (legacy shape, see movementRampCollision.ts)
 *   4..7   → stairs orientation - 4
 *   255    → no shape; the wall is a plain solid rectangle
 *
 * Always use `isRampOrientationIndex` / `isStairsOrientationIndex` to
 * discriminate; never compare against a bare literal.
 */

/** Sentinel stored in `rampOrientationIndex` for plain rectangular walls. */
export const SHAPE_ORIENTATION_NONE = 255;

/** Added to a stairs orientation (0-3) to encode it in `rampOrientationIndex`. */
export const STAIRS_ORIENTATION_ENCODING_OFFSET = 4;

/** Height of a single stair riser, in world pixels. Fixed by the template art. */
export const STAIRS_RISER_HEIGHT_PX = 2;

/**
 * Stair orientation, using the same convention as ramps:
 *   0 = rises right, 1 = rises left, 2 = ceiling (rises right), 3 = ceiling (rises left).
 */
export type StairsOrientation = 0 | 1 | 2 | 3;

/** True when `value` (from `rampOrientationIndex`) denotes a legacy ramp wall. */
export function isRampOrientationIndex(value: number): boolean {
  return value >= 0 && value <= 3;
}

/** True when `value` (from `rampOrientationIndex`) denotes a stair wall. */
export function isStairsOrientationIndex(value: number): boolean {
  return value >= STAIRS_ORIENTATION_ENCODING_OFFSET
      && value < STAIRS_ORIENTATION_ENCODING_OFFSET + 4;
}

/** True when the wall is a plain solid rectangle (neither ramp nor stairs). */
export function isPlainRectOrientationIndex(value: number): boolean {
  return !isRampOrientationIndex(value) && !isStairsOrientationIndex(value);
}

export function encodeStairsOrientationIndex(orientation: StairsOrientation): number {
  return orientation + STAIRS_ORIENTATION_ENCODING_OFFSET;
}

export function decodeStairsOrientationIndex(value: number): StairsOrientation {
  return (value - STAIRS_ORIENTATION_ENCODING_OFFSET) as StairsOrientation;
}

/** An axis-aligned solid rectangle, in pixels local to the stair's top-left corner. */
export interface StairsRect {
  readonly xPx: number;
  readonly yPx: number;
  readonly wPx: number;
  readonly hPx: number;
}

/** The cell decomposition of a stair AABB. */
export interface StairsCellGrid {
  /** Number of cells along each axis (also the number of steps). */
  readonly stepCount: number;
  readonly cellWidthPx: number;
  readonly cellHeightPx: number;
  isSolidCell(col: number, row: number): boolean;
}

function stepCountFor(heightPx: number): number {
  return Math.max(1, Math.round(heightPx / STAIRS_RISER_HEIGHT_PX));
}

/**
 * Returns the cell grid for a stair of the given orientation and pixel size.
 *
 * `widthPx` must divide evenly into `stepCount` cells; the three authored
 * stair sizes all satisfy this. Non-conforming sizes still produce a usable
 * grid (cells become fractional) rather than throwing, so a hand-edited room
 * with an odd stair size degrades instead of crashing.
 */
export function getStairsCellGrid(
  orientation: StairsOrientation,
  widthPx: number,
  heightPx: number,
): StairsCellGrid {
  const stepCount = stepCountFor(heightPx);
  const flipX = orientation === 1 || orientation === 3;
  const flipY = orientation === 2 || orientation === 3;

  return {
    stepCount,
    cellWidthPx: widthPx / stepCount,
    cellHeightPx: heightPx / stepCount,
    isSolidCell(col: number, row: number): boolean {
      if (col < 0 || row < 0 || col >= stepCount || row >= stepCount) return false;
      const c = flipX ? stepCount - 1 - col : col;
      const r = flipY ? stepCount - 1 - row : row;
      return c + r >= stepCount - 1;
    },
  };
}

// ── Solid rectangle decomposition ─────────────────────────────────────────────

const _rectCache = new Map<string, readonly StairsRect[]>();

/**
 * Decomposes a stair's solid cells into axis-aligned rectangles, merging each
 * column's contiguous vertical run into one rectangle.
 *
 * For all authored stair shapes every column is a single contiguous run, so
 * this yields exactly `stepCount` rectangles (4 for 1×1 and 1×2, 8 for 2×2).
 * Column-wise merging is deliberate: it makes each step's tread a rectangle
 * top face with no interior seam beneath it, which is what keeps the player's
 * step-up and the sand's settling stable.
 *
 * Coordinates are local to the stair AABB's top-left corner. The result is
 * cached and frozen — callers must not mutate it.
 */
export function getStairsSolidRects(
  orientation: StairsOrientation,
  widthPx: number,
  heightPx: number,
): readonly StairsRect[] {
  const key = `${orientation}|${widthPx}|${heightPx}`;
  const cached = _rectCache.get(key);
  if (cached !== undefined) return cached;

  const grid = getStairsCellGrid(orientation, widthPx, heightPx);
  const rects: StairsRect[] = [];

  for (let col = 0; col < grid.stepCount; col++) {
    let runStart = -1;
    for (let row = 0; row <= grid.stepCount; row++) {
      const solid = row < grid.stepCount && grid.isSolidCell(col, row);
      if (solid && runStart < 0) {
        runStart = row;
      } else if (!solid && runStart >= 0) {
        rects.push(Object.freeze({
          xPx: col * grid.cellWidthPx,
          yPx: runStart * grid.cellHeightPx,
          wPx: grid.cellWidthPx,
          hPx: (row - runStart) * grid.cellHeightPx,
        }));
        runStart = -1;
      }
    }
  }

  const frozen = Object.freeze(rects);
  _rectCache.set(key, frozen);
  return frozen;
}

/**
 * True when the point `(localXPx, localYPx)` — relative to the stair AABB's
 * top-left corner — lies inside a solid stair cell.
 */
export function isStairsSolidAtLocalPx(
  orientation: StairsOrientation,
  widthPx: number,
  heightPx: number,
  localXPx: number,
  localYPx: number,
): boolean {
  if (localXPx < 0 || localYPx < 0 || localXPx >= widthPx || localYPx >= heightPx) return false;
  const grid = getStairsCellGrid(orientation, widthPx, heightPx);
  return grid.isSolidCell(
    Math.floor(localXPx / grid.cellWidthPx),
    Math.floor(localYPx / grid.cellHeightPx),
  );
}

/**
 * Renders the stair mask as one string per pixel row (`'#'` solid, `'.'` empty).
 * Used by tests to assert this module agrees with the authored template PNGs.
 */
export function stairsMaskPatternRows(
  orientation: StairsOrientation,
  widthPx: number,
  heightPx: number,
): string[] {
  const rows: string[] = [];
  for (let y = 0; y < heightPx; y++) {
    let line = '';
    for (let x = 0; x < widthPx; x++) {
      line += isStairsSolidAtLocalPx(orientation, widthPx, heightPx, x, y) ? '#' : '.';
    }
    rows.push(line);
  }
  return rows;
}
