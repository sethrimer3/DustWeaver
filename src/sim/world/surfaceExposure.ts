/**
 * surfaceExposure.ts — authoritative tile-level open-air surface map.
 *
 * This module is the single source of truth for "which sides of a solid
 * tile are exposed to open air". It intentionally knows nothing about
 * grouped/merged block rectangles (see blockWallLayoutCache.ts /
 * gameRoomWalls.ts) — those are load-time or render-time optimizations and
 * must never be used to define surface truth. Anything that needs to know
 * "is this tile side a valid open-air surface" (grapple targeting, edge
 * shading, etc.) should eventually be able to query this module instead of
 * re-deriving exposure from its own local neighbour checks.
 *
 * Two layers are provided on purpose:
 *   - Base geometric exposure (this module): solid tile + in-bounds air
 *     neighbour, nothing else. No darkness/visibility/gameplay state.
 *   - Active/visible eligibility: a thin filter on top (see
 *     `filterVisibleSurfaceSegments`) that callers can use to add
 *     darkness/fog/editor-visibility rules without touching the base map.
 *
 * TODO(surface-exposure): grapple targeting (src/sim/clusters/grappleShared.ts
 * `raycastWalls`) currently derives valid surfaces purely from merged wall
 * rectangles via AABB raycasts. Once this module is proven out, grapple hit
 * results should be cross-checked against `getSurfaceMaskAtTile` (or a
 * `queryNearestSurfaceSegment` lookup) so grapples can't anchor to a side
 * that is actually buried inside a grouped block.
 *
 * TODO(surface-exposure): the edge-shading open-air mask computed inline in
 * `src/render/walls/wallTilePassRenderers.ts` (`render1x1Pass` /
 * `render2x2Pass`) duplicates a subset of this module's logic using the
 * render-time `CachedWallLayout.occupied` set, which has no room-bounds
 * awareness (out-of-bounds neighbours are treated as open air there). That
 * renderer is a hot per-frame path, so it should not be rewritten to call
 * into this module without profiling — but new debug/inspection tooling
 * should prefer this module so discrepancies are easy to spot.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type SurfaceSide = 'top' | 'right' | 'bottom' | 'left';

export const SURFACE_SIDES: readonly SurfaceSide[] = ['top', 'right', 'bottom', 'left'];

export interface SurfaceMask {
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
}

export const EMPTY_SURFACE_MASK: SurfaceMask = { top: false, right: false, bottom: false, left: false };

function surfaceMaskHasAnySide(mask: SurfaceMask): boolean {
  return mask.top || mask.right || mask.bottom || mask.left;
}

/**
 * Diagonal corner directions, distinct from the cardinal `SurfaceSide`s.
 * Used for *concave* (inner) corner detection: a tile whose two adjacent
 * cardinal neighbours are both solid (so it has no exposed cardinal side on
 * either of them) but whose diagonal neighbour is open air — the classic
 * "inner corner" / notch pattern in auto-tiling, e.g. a staircase step.
 */
export type CornerSide = 'nw' | 'ne' | 'sw' | 'se';

export const CORNER_SIDES: readonly CornerSide[] = ['nw', 'ne', 'sw', 'se'];

export interface CornerMask {
  readonly nw: boolean;
  readonly ne: boolean;
  readonly sw: boolean;
  readonly se: boolean;
}

export const EMPTY_CORNER_MASK: CornerMask = { nw: false, ne: false, sw: false, se: false };

function cornerMaskHasAnyCorner(mask: CornerMask): boolean {
  return mask.nw || mask.ne || mask.sw || mask.se;
}

/** A tile with at least one concave (inner) corner exposed, in tile-grid coordinates. */
export interface ConcaveCornerTile {
  readonly col: number;
  readonly row: number;
  readonly corners: CornerMask;
}

/** A single exposed tile-side, in both tile-grid and pixel-space coordinates. */
export interface SurfaceSegment {
  readonly col: number;
  readonly row: number;
  readonly side: SurfaceSide;
  /** Outward-facing unit normal, in the same space as pixel coordinates (+x right, +y down). */
  readonly normalX: number;
  readonly normalY: number;
  /** Pixel-space endpoints of the exposed edge segment. */
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Tile coordinate of the adjacent open-air cell this side is exposed to. */
  readonly airCol: number;
  readonly airRow: number;
}

export interface SurfaceExposureMap {
  readonly widthBlocks: number;
  readonly heightBlocks: number;
  readonly blockSizePx: number;
  /** Per-solid-tile exposure masks, keyed by `"col,row"`. Tiles with no exposed side are omitted. */
  readonly masks: ReadonlyMap<string, SurfaceMask>;
  /** Flat list of exposed segments, in no particular order. */
  readonly segments: readonly SurfaceSegment[];
  /**
   * Per-solid-tile *concave* (inner) corner masks, keyed by `"col,row"`.
   * Tiles with no concave corner are omitted — this is deliberately separate
   * from `masks` because a tile can have a concave corner with ZERO exposed
   * cardinal sides (both neighbours adjacent to the corner are solid; only
   * the diagonal neighbour is open air), so it would otherwise never appear
   * anywhere in this map. Convex (outer) corners are NOT tracked here — they
   * are fully derivable from `masks` alone (both adjacent cardinal sides
   * exposed on the same tile), so callers needing convex-corner info should
   * derive it from `masks` rather than looking for it in this map.
   */
  readonly concaveCornerMasks: ReadonlyMap<string, CornerMask>;
  /** Flat list of tiles with at least one concave corner, in no particular order. */
  readonly concaveCorners: readonly ConcaveCornerTile[];
}

/**
 * Minimal read-only view of tile solidity that `buildSurfaceExposureMap`
 * consumes. Deliberately independent of any particular room/wall data
 * structure — see `buildTileSolidityGridFromRoomWalls` below for the
 * DustWeaver-specific adapter.
 */
export interface TileSolidityGrid {
  readonly widthBlocks: number;
  readonly heightBlocks: number;
  readonly blockSizePx: number;
  isSolidAt(col: number, row: number): boolean;
}

export interface BuildSurfaceExposureOptions {
  /**
   * When true, a side is only exposed if the adjacent air cell is part of
   * the connected-open-air region reachable from `openAirSeeds` (flood
   * fill), rather than merely "any in-bounds non-solid cell". Use this to
   * exclude sealed internal cavities that happen to be non-solid but are
   * not actually reachable play space.
   */
  readonly connectedOpenAirOnly?: boolean;
  /**
   * Seed cells for the connected-open-air flood fill. Required when
   * `connectedOpenAirOnly` is true. Typically the room's known playable
   * air cells (e.g. spawn point, or all border-adjacent air cells).
   */
  readonly openAirSeeds?: readonly { col: number; row: number }[];
}

const NEIGHBOR_OFFSETS: Record<SurfaceSide, { dCol: number; dRow: number; normalX: number; normalY: number }> = {
  top:    { dCol: 0,  dRow: -1, normalX: 0,  normalY: -1 },
  right:  { dCol: 1,  dRow: 0,  normalX: 1,  normalY: 0 },
  bottom: { dCol: 0,  dRow: 1,  normalX: 0,  normalY: 1 },
  left:   { dCol: -1, dRow: 0,  normalX: -1, normalY: 0 },
};

function tileKey(col: number, row: number): string {
  return `${col},${row}`;
}

function inBounds(grid: TileSolidityGrid, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < grid.widthBlocks && row < grid.heightBlocks;
}

/**
 * Flood-fills connected open-air cells starting from `seeds`. Out-of-bounds
 * cells are never included. Returns a set of `"col,row"` keys.
 */
function computeConnectedOpenAir(
  grid: TileSolidityGrid,
  seeds: readonly { col: number; row: number }[],
): Set<string> {
  const visited = new Set<string>();
  const queue: { col: number; row: number }[] = [];

  for (const seed of seeds) {
    if (!inBounds(grid, seed.col, seed.row)) continue;
    if (grid.isSolidAt(seed.col, seed.row)) continue;
    const key = tileKey(seed.col, seed.row);
    if (visited.has(key)) continue;
    visited.add(key);
    queue.push(seed);
  }

  let head = 0;
  while (head < queue.length) {
    const { col, row } = queue[head++];
    for (const side of SURFACE_SIDES) {
      const off = NEIGHBOR_OFFSETS[side];
      const nCol = col + off.dCol;
      const nRow = row + off.dRow;
      if (!inBounds(grid, nCol, nRow)) continue;
      if (grid.isSolidAt(nCol, nRow)) continue;
      const key = tileKey(nCol, nRow);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ col: nCol, row: nRow });
    }
  }

  return visited;
}

/**
 * Builds the authoritative tile-level open-air surface exposure map.
 *
 * A tile side is exposed iff:
 *   1. The tile itself is solid.
 *   2. The neighbour cell in that direction is in-bounds.
 *   3. The neighbour cell is non-solid.
 *   4. (optional) The neighbour cell is part of the connected-open-air
 *      region, when `options.connectedOpenAirOnly` is set.
 *
 * Out-of-bounds neighbours never count as open air, and internal sides
 * between two solid tiles are never exposed.
 */
export function buildSurfaceExposureMap(
  grid: TileSolidityGrid,
  options?: BuildSurfaceExposureOptions,
): SurfaceExposureMap {
  const connectedOpenAirOnly = options?.connectedOpenAirOnly === true;
  const openAir: Set<string> | null = connectedOpenAirOnly
    ? computeConnectedOpenAir(grid, options?.openAirSeeds ?? [])
    : null;

  const isOpenAir = (col: number, row: number): boolean => {
    if (!inBounds(grid, col, row)) return false;
    if (grid.isSolidAt(col, row)) return false;
    if (openAir !== null && !openAir.has(tileKey(col, row))) return false;
    return true;
  };

  const masks = new Map<string, SurfaceMask>();
  const segments: SurfaceSegment[] = [];
  const concaveCornerMasks = new Map<string, CornerMask>();
  const concaveCorners: ConcaveCornerTile[] = [];
  const blockSizePx = grid.blockSizePx;

  for (let row = 0; row < grid.heightBlocks; row++) {
    for (let col = 0; col < grid.widthBlocks; col++) {
      if (!grid.isSolidAt(col, row)) continue;

      const top    = isOpenAir(col, row - 1);
      const right  = isOpenAir(col + 1, row);
      const bottom = isOpenAir(col, row + 1);
      const left   = isOpenAir(col - 1, row);
      const mask: SurfaceMask = { top, right, bottom, left };

      // Concave (inner) corner: both cardinal neighbours adjacent to the
      // corner are NOT open air (so neither contributes an exposed cardinal
      // side of its own — they may be solid, or out of bounds), yet the
      // diagonal neighbour IS open air. This is the classic auto-tiling
      // "inner corner" / staircase-notch pattern, and is intentionally
      // independent of `mask` above: a tile can have a concave corner with
      // zero exposed cardinal sides at all.
      const nw = !top && !left   && isOpenAir(col - 1, row - 1);
      const ne = !top && !right  && isOpenAir(col + 1, row - 1);
      const sw = !bottom && !left  && isOpenAir(col - 1, row + 1);
      const se = !bottom && !right && isOpenAir(col + 1, row + 1);
      const cornerMask: CornerMask = { nw, ne, sw, se };

      if (cornerMaskHasAnyCorner(cornerMask)) {
        concaveCornerMasks.set(tileKey(col, row), cornerMask);
        concaveCorners.push({ col, row, corners: cornerMask });
      }

      if (!surfaceMaskHasAnySide(mask)) continue;

      masks.set(tileKey(col, row), mask);

      const px = col * blockSizePx;
      const py = row * blockSizePx;

      if (top) {
        segments.push({
          col, row, side: 'top', normalX: 0, normalY: -1,
          x0: px, y0: py, x1: px + blockSizePx, y1: py,
          airCol: col, airRow: row - 1,
        });
      }
      if (right) {
        segments.push({
          col, row, side: 'right', normalX: 1, normalY: 0,
          x0: px + blockSizePx, y0: py, x1: px + blockSizePx, y1: py + blockSizePx,
          airCol: col + 1, airRow: row,
        });
      }
      if (bottom) {
        segments.push({
          col, row, side: 'bottom', normalX: 0, normalY: 1,
          x0: px, y0: py + blockSizePx, x1: px + blockSizePx, y1: py + blockSizePx,
          airCol: col, airRow: row + 1,
        });
      }
      if (left) {
        segments.push({
          col, row, side: 'left', normalX: -1, normalY: 0,
          x0: px, y0: py, x1: px, y1: py + blockSizePx,
          airCol: col - 1, airRow: row,
        });
      }
    }
  }

  return {
    widthBlocks: grid.widthBlocks, heightBlocks: grid.heightBlocks, blockSizePx,
    masks, segments, concaveCornerMasks, concaveCorners,
  };
}

export function getSurfaceMaskAtTile(map: SurfaceExposureMap, col: number, row: number): SurfaceMask {
  return map.masks.get(tileKey(col, row)) ?? EMPTY_SURFACE_MASK;
}

export function getSurfaceSegments(map: SurfaceExposureMap): readonly SurfaceSegment[] {
  return map.segments;
}

/** Returns the concave (inner) corner mask for a tile, or all-false if it has none. */
export function getConcaveCornerMaskAtTile(map: SurfaceExposureMap, col: number, row: number): CornerMask {
  return map.concaveCornerMasks.get(tileKey(col, row)) ?? EMPTY_CORNER_MASK;
}

/**
 * Finds the nearest exposed surface segment to a pixel-space point, up to
 * `maxDistancePx` away. Uses a straightforward linear scan — fine for
 * debug tooling and occasional queries; if this is ever called every frame
 * for many entities, add a spatial index instead of optimizing this scan.
 */
export function queryNearestSurfaceSegment(
  map: SurfaceExposureMap,
  pointPx: { x: number; y: number },
  options?: { maxDistancePx?: number },
): SurfaceSegment | null {
  const maxDistancePx = options?.maxDistancePx ?? Infinity;
  let best: SurfaceSegment | null = null;
  let bestDistSq = maxDistancePx * maxDistancePx;

  for (const seg of map.segments) {
    const midX = (seg.x0 + seg.x1) / 2;
    const midY = (seg.y0 + seg.y1) / 2;
    const dx = midX - pointPx.x;
    const dy = midY - pointPx.y;
    const distSq = dx * dx + dy * dy;
    if (distSq <= bestDistSq) {
      bestDistSq = distSq;
      best = seg;
    }
  }

  return best;
}

// ── Active/visible surface eligibility layer ──────────────────────────────────

/**
 * Geometry-only exposure is never sufficient on its own for gameplay
 * eligibility (grapple targeting, interaction prompts, etc.) — those also
 * need to account for darkness, fog-of-war, editor-only visibility, or
 * other dynamic state. This helper keeps that filtering decoupled from the
 * base map: callers supply a predicate and get back only the segments that
 * pass it, without the base map ever needing to know what "visible" means.
 *
 * TODO(surface-exposure): once darkness/ambient-depth data is available in
 * a form indexed by tile coordinate (see `ambientDepthsByKey` in
 * blockWallLayoutCache.ts), a `isTileDark(col, row)` predicate can be
 * plugged straight in here for gameplay-eligible grapple targeting.
 */
export function filterVisibleSurfaceSegments(
  map: SurfaceExposureMap,
  isEligible: (segment: SurfaceSegment) => boolean,
): readonly SurfaceSegment[] {
  return map.segments.filter(isEligible);
}

// ── DustWeaver room-data adapter ───────────────────────────────────────────────

/** Minimal shape of wall rectangle data this adapter needs — matches `RoomWallDef` / `WallSnapshot` fields. */
export interface SurfaceExposureWallLike {
  readonly xBlock: number;
  readonly yBlock: number;
  readonly wBlock: number;
  readonly hBlock: number;
  readonly isPlatformFlag?: 0 | 1;
  readonly isInvisibleFlag?: 0 | 1;
  readonly rampOrientation?: 0 | 1 | 2 | 3;
}

/**
 * Builds a `TileSolidityGrid` from room wall rectangles (block-unit AABBs),
 * decomposing each rectangle into per-tile solidity rather than relying on
 * any merged/grouped representation.
 *
 * Assumptions (documented per the task's guidance to preserve existing
 * behaviour where the convention is ambiguous):
 *   - One-way platforms (`isPlatformFlag === 1`) are NOT solid for surface
 *     exposure purposes: they only collide from above, so they don't form
 *     a real "wall" side a grapple or edge-highlight should treat as solid.
 *   - Invisible collision boundaries (`isInvisibleFlag === 1`) ARE solid:
 *     they still block movement, even though they're never rendered. This
 *     differs from `blockWallLayoutCache.ts`'s render-time `occupied` set,
 *     which skips them because that set only tracks what needs a sprite
 *     drawn — not true collision solidity.
 *   - Ramps count as solid (they occupy their bounding tile for collision).
 *   - Decorations / non-colliding elements are out of scope here since
 *     they never appear in the wall array.
 */
export function buildTileSolidityGridFromRoomWalls(
  walls: readonly SurfaceExposureWallLike[],
  widthBlocks: number,
  heightBlocks: number,
  blockSizePx: number,
): TileSolidityGrid {
  const solid = new Set<string>();

  for (const wall of walls) {
    if (wall.isPlatformFlag === 1) continue;

    const colStart = Math.floor(wall.xBlock);
    const rowStart = Math.floor(wall.yBlock);
    const colCount = Math.max(0, Math.ceil(wall.xBlock + wall.wBlock) - colStart);
    const rowCount = Math.max(0, Math.ceil(wall.yBlock + wall.hBlock) - rowStart);

    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        solid.add(tileKey(colStart + c, rowStart + r));
      }
    }
  }

  return {
    widthBlocks,
    heightBlocks,
    blockSizePx,
    isSolidAt: (col: number, row: number): boolean => solid.has(tileKey(col, row)),
  };
}

// ── Debug helper ────────────────────────────────────────────────────────────

declare global {
  interface Window {
    __dwSurfaceExposureDebug?: (map: SurfaceExposureMap) => void;
  }
}

/**
 * Draws every exposed segment onto a 2D canvas context in room-pixel space,
 * colour-coded by side, so it's easy to spot surfaces marked inside blocks,
 * at room boundaries, or incorrectly along non-air-adjacent sides. Mirrors
 * the existing `window.__dwEdgeOverlay` debug convention in
 * wallTilePassRenderers.ts, but draws directly from this module's own
 * authoritative map rather than the render-time occupancy cache — useful
 * for diffing the two when hunting exposure bugs.
 *   top    → red
 *   right  → green
 *   bottom → cyan
 *   left   → magenta
 */
export function drawSurfaceExposureDebugOverlay(
  ctx: CanvasRenderingContext2D,
  map: SurfaceExposureMap,
  options?: { offsetXPx?: number; offsetYPx?: number; scale?: number; lineWidth?: number },
): void {
  const offsetXPx = options?.offsetXPx ?? 0;
  const offsetYPx = options?.offsetYPx ?? 0;
  const scale = options?.scale ?? 1;
  const colorForSide: Record<SurfaceSide, string> = {
    top: '#ff0000',
    right: '#00ff00',
    bottom: '#00ffff',
    left: '#ff00ff',
  };

  ctx.save();
  ctx.lineWidth = options?.lineWidth ?? 1;
  for (const seg of map.segments) {
    ctx.strokeStyle = colorForSide[seg.side];
    ctx.beginPath();
    ctx.moveTo(seg.x0 * scale + offsetXPx, seg.y0 * scale + offsetYPx);
    ctx.lineTo(seg.x1 * scale + offsetXPx, seg.y1 * scale + offsetYPx);
    ctx.stroke();
  }
  ctx.restore();
}

if (import.meta.env?.DEV && typeof window !== 'undefined') {
  window.__dwSurfaceExposureDebug = (map: SurfaceExposureMap): void => {
    console.log(
      `[surfaceExposure] ${map.widthBlocks}x${map.heightBlocks} blocks @ ${map.blockSizePx}px, ` +
      `${map.masks.size} solid tiles with exposure, ${map.segments.length} exposed segments`,
    );
    console.table(map.segments.slice(0, 200));
  };
}
