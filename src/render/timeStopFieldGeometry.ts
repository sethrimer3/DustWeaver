/**
 * timeStopFieldGeometry.ts — Neighbor-aware rounded region path builder.
 *
 * Shared by the editor preview (editorZoneDrawers.ts) and the gameplay
 * TimeStop Field renderer. Builds a single Path2D covering a set of
 * grid-aligned tiles where only true exterior (convex) corners are rounded —
 * a corner is rounded only when BOTH orthogonal neighbours sharing that
 * corner are absent. Interior and concave corners stay square, which keeps
 * concave notches readable without producing broken/self-intersecting
 * geometry.
 *
 * Because every tile's subpath is added to the SAME Path2D and filled with a
 * single fill() call, adjacent/touching tiles never show a seam — there is
 * no per-tile alpha blending, just one union fill of the whole region. This
 * is the "simplest robust solution" chosen over marching squares or an SDF
 * mask: O(tileCount) to build, no per-frame allocation once cached, and no
 * pixel readback.
 */

/** A single grid-aligned tile coordinate. */
export interface TileCell {
  gx: number;
  gy: number;
}

/** Returns true if the tile at (gx, gy) is part of the region (for neighbour tests). */
export type OccupiedCellQuery = (gx: number, gy: number) => boolean;

/**
 * Builds a Path2D covering `cells`, in pixel space, rounding only true
 * exterior convex corners.
 *
 * @param cells           Tiles to render (grid coordinates, not pixels).
 * @param isOccupied      Neighbour-membership test for the same region.
 * @param originXPx       Screen/canvas X of grid cell (0,0)'s top-left corner.
 * @param originYPx       Screen/canvas Y of grid cell (0,0)'s top-left corner.
 * @param cellSizePx      Size of one grid cell in pixels (already zoom-scaled).
 * @param cornerRadiusPx  Desired exterior corner radius in pixels; clamped to
 *                        half the cell size so it never overshoots a 1×1 tile.
 */
export function buildRoundedRegionPath(
  cells: readonly TileCell[],
  isOccupied: OccupiedCellQuery,
  originXPx: number,
  originYPx: number,
  cellSizePx: number,
  cornerRadiusPx: number,
): Path2D {
  const path = new Path2D();
  const r = Math.max(0, Math.min(cornerRadiusPx, cellSizePx * 0.5));

  for (const { gx, gy } of cells) {
    const hasAbove = isOccupied(gx, gy - 1);
    const hasBelow = isOccupied(gx, gy + 1);
    const hasLeft  = isOccupied(gx - 1, gy);
    const hasRight = isOccupied(gx + 1, gy);

    const rTL = (!hasAbove && !hasLeft)  ? r : 0;
    const rTR = (!hasAbove && !hasRight) ? r : 0;
    const rBR = (!hasBelow && !hasRight) ? r : 0;
    const rBL = (!hasBelow && !hasLeft)  ? r : 0;

    const x = gx * cellSizePx + originXPx;
    const y = gy * cellSizePx + originYPx;
    const w = cellSizePx;
    const h = cellSizePx;

    if (rTL === 0 && rTR === 0 && rBR === 0 && rBL === 0) {
      path.rect(x, y, w, h);
      continue;
    }

    path.moveTo(x + rTL, y);
    path.lineTo(x + w - rTR, y);
    if (rTR > 0) path.arcTo(x + w, y, x + w, y + rTR, rTR);
    else path.lineTo(x + w, y);
    path.lineTo(x + w, y + h - rBR);
    if (rBR > 0) path.arcTo(x + w, y + h, x + w - rBR, y + h, rBR);
    else path.lineTo(x + w, y + h);
    path.lineTo(x + rBL, y + h);
    if (rBL > 0) path.arcTo(x, y + h, x, y + h - rBL, rBL);
    else path.lineTo(x, y + h);
    path.lineTo(x, y + rTL);
    if (rTL > 0) path.arcTo(x, y, x + rTL, y, rTL);
    else path.lineTo(x, y);
    path.closePath();
  }

  return path;
}

/** Builds an `isOccupied` query closure backed by a `Set<string>` of "gx,gy" keys. */
export function occupiedQueryFromCellList(cells: readonly TileCell[]): OccupiedCellQuery {
  const set = new Set<string>();
  for (const c of cells) set.add(`${c.gx},${c.gy}`);
  return (gx: number, gy: number) => set.has(`${gx},${gy}`);
}
