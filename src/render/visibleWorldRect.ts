/**
 * visibleWorldRect.ts — Single source of truth for the camera-visible
 * world-space rectangle and its tile/chunk index range.
 *
 * Every world-space layer (background, tiles, entities, particles, lighting,
 * shadows, fog, overlays) should derive its visible bounds from the current
 * camera (offset + zoom) and viewport size — never from a room's declared
 * width/height, a fixed/native resolution, or any other precomputed
 * room-size assumption.  Room size only bounds *content* (what exists),
 * never the *viewport* (what is currently visible).
 *
 * All functions here are pure and allocation-free (callers pass an `out`
 * object) so they are safe to call every frame from hot render paths.
 */

/** Axis-aligned world-space rectangle, as left/top/right/bottom bounds. */
export interface WorldRect {
  leftWorld: number;
  topWorld: number;
  rightWorld: number;
  bottomWorld: number;
}

/** Inclusive tile/chunk index range on both axes. */
export interface IndexRange {
  colMin: number;
  rowMin: number;
  colMax: number;
  rowMax: number;
}

/**
 * Returns `true` when a value is safe to use in bounds math: finite and not
 * NaN.  `zoom`/`sizeUnit` additionally must be strictly positive (callers
 * check that separately since the safe fallback differs).
 */
function isFiniteNumber(n: number): boolean {
  return Number.isFinite(n);
}

/**
 * Computes the camera-visible world-space rectangle, expanded by `marginWorld`
 * world units on every side (a safety margin so fast camera motion or culling
 * approximations don't pop content in/out at the exact edge).
 *
 * Derived purely from the camera transform (offset + zoom) and the viewport
 * size in virtual pixels — independent of room dimensions.  Callers that also
 * want to clip to room content should intersect the result with the room's
 * own extents separately; this function never assumes a room size.
 *
 * Defensive: if any input is non-finite (NaN/±Infinity) or `zoom` is not
 * strictly positive, returns a zero-area rect at the world origin rather than
 * propagating garbage bounds into culling/draw calls.
 */
export function getVisibleWorldRect(
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  vpWPx: number,
  vpHPx: number,
  marginWorld: number,
  out: WorldRect,
): WorldRect {
  if (
    !isFiniteNumber(offsetXPx) || !isFiniteNumber(offsetYPx) ||
    !isFiniteNumber(zoom) || zoom <= 0 ||
    !isFiniteNumber(vpWPx) || !isFiniteNumber(vpHPx)
  ) {
    out.leftWorld = 0;
    out.topWorld = 0;
    out.rightWorld = 0;
    out.bottomWorld = 0;
    return out;
  }

  const safeMargin = isFiniteNumber(marginWorld) ? marginWorld : 0;

  out.leftWorld = (-offsetXPx) / zoom - safeMargin;
  out.topWorld = (-offsetYPx) / zoom - safeMargin;
  out.rightWorld = (vpWPx - offsetXPx) / zoom + safeMargin;
  out.bottomWorld = (vpHPx - offsetYPx) / zoom + safeMargin;
  return out;
}

/**
 * Converts a world-space rectangle into an inclusive tile/chunk index range
 * using `floor(left / sizeUnit)` .. `ceil(right / sizeUnit)`, per axis.
 *
 * `sizeUnit` is the world-unit size of one tile/chunk (e.g. block size, or
 * block size × chunk-size-in-blocks).  `marginCells` adds extra index cells
 * on every side (on top of any world-space margin already baked into `rect`).
 *
 * Defensive: non-finite or non-positive `sizeUnit`, or a non-finite rect,
 * yields an empty range (`colMax < colMin`) rather than NaN/Infinity indices
 * that would blow up a render loop.  Callers should treat an empty range
 * (colMax < colMin || rowMax < rowMin) as "nothing visible" and skip drawing
 * rather than iterating it.
 */
export function worldRectToIndexRange(
  rect: WorldRect,
  sizeUnit: number,
  marginCells: number,
  out: IndexRange,
): IndexRange {
  if (
    !isFiniteNumber(sizeUnit) || sizeUnit <= 0 ||
    !isFiniteNumber(rect.leftWorld) || !isFiniteNumber(rect.topWorld) ||
    !isFiniteNumber(rect.rightWorld) || !isFiniteNumber(rect.bottomWorld)
  ) {
    // Empty range: caller's loop `for (i = min; i <= max; i++)` never executes.
    out.colMin = 0;
    out.rowMin = 0;
    out.colMax = -1;
    out.rowMax = -1;
    return out;
  }

  const margin = isFiniteNumber(marginCells) ? Math.trunc(marginCells) : 0;

  out.colMin = Math.floor(rect.leftWorld / sizeUnit) - margin;
  out.rowMin = Math.floor(rect.topWorld / sizeUnit) - margin;
  out.colMax = Math.ceil(rect.rightWorld / sizeUnit) + margin;
  out.rowMax = Math.ceil(rect.bottomWorld / sizeUnit) + margin;

  // Guard against an inverted range (can only happen from pathological
  // margins) so callers never iterate backwards.
  if (out.colMax < out.colMin) out.colMax = out.colMin - 1;
  if (out.rowMax < out.rowMin) out.rowMax = out.rowMin - 1;

  return out;
}

/**
 * Clamps the minimum indices of a range to `>= 0`.  Many callers (chunk
 * caches keyed by non-negative grid coordinates) want the lower bound
 * clamped to the room/content origin while leaving the upper bound
 * unclamped so it naturally extends to cover tall/wide content.
 *
 * Mutates and returns `range` for convenient chaining.
 */
export function clampIndexRangeMinToZero(range: IndexRange): IndexRange {
  if (range.colMin < 0) range.colMin = 0;
  if (range.rowMin < 0) range.rowMin = 0;
  return range;
}
