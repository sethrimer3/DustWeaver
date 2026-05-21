/**
 * LEGACY: edgeExtensionCache.ts — Cached visual tiles beyond the room boundary.
 *
 * NOT imported by active gameplay. Retained for historical/reference purposes.
 * See src/render/transitions/legacy/README.md for re-enablement instructions.
 * NOTE: This file is still used by the editor (editorController.ts, editorRenderer.ts).
 *
 * edgeExtensionCache.ts — Cached visual tiles beyond the room boundary.
 *
 * At room load time, `buildEdgeExtensionCache()` inspects the outermost
 * row/column of each room edge and produces a flat array of `EdgeExtensionTile`
 * records describing what to draw in the 6-block strip beyond the room.
 *
 * Rules:
 *  - If the edge cell is a solid rectangular wall, extend it outward with the
 *    same theme (so the wall appears to continue naturally).
 *  - If the edge cell is empty/air, the extension cell is empty (caller draws
 *    darkness or background depending on lighting mode).
 *  - Transition-opening cells are never extended (the opening is the passage
 *    to the next room; covering it would break the visual).
 *  - Invisible walls and ramps are excluded from the extension.
 *
 * The cache is rebuilt once per `loadRoom()` call via `buildEdgeExtensionCache()`.
 * It is invalidated when room tiles change (editor edits); invalidation is
 * signalled by calling `buildEdgeExtensionCache()` again.
 */

import type { RoomDef, AmbientLightDirection } from '../../levels/roomDef';
import { EDGE_EXTENSION_EXTRA_BLOCKS } from './transitionConfig';
import { buildAmbientDepths } from '../walls/ambientLightDepths';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single tile slot in the edge extension region. */
export interface EdgeExtensionTile {
  /** Block column — may be negative (left ext.) or >= widthBlocks (right ext.). */
  colBlock: number;
  /** Block row — may be negative (top ext.) or >= heightBlocks (bottom ext.). */
  rowBlock: number;
  /** True if a solid wall should be drawn here. False = render darkness. */
  isSolid: boolean;
  /** Per-wall theme override (null = use room default). */
  theme: string | null;
  /**
   * Per-tile ambient-light depth computed from a full BFS over an expanded
   * occupancy grid that includes both in-room tiles and this extension tile.
   * Transition openings count as open air, so solid tiles adjacent to an
   * opening get depth 0 (fully exposed).  Drives `getDarknessAlphaFromAirDepth`
   * in the renderer so shading matches the rest of the room seamlessly.
   */
  ambientDepth: number;
}

/** Cached edge extension data for a single room. */
export interface EdgeExtensionCache {
  /** The room ID this cache was built for. */
  roomId: string;
  /** Flat tile list.  All entries are pre-allocated; no sparse gaps. */
  tiles: readonly EdgeExtensionTile[];
  /**
   * "col,row" key set of every solid position in the extension region plus the
   * room's outermost edge cells.  Used by the renderer to compute per-tile
   * neighbor masks for sprite auto-tiling without needing the full WallSnapshot.
   *
   * Included positions:
   *  - Every extension tile where `isSolid === true`.
   *  - Room edge cells (col=0, col=W-1, row=0, row=H-1) that are occupied,
   *    so extension tiles adjacent to the room interior can look up their
   *    inner-facing neighbor correctly.
   */
  occupancySet: ReadonlySet<string>;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Build an expanded ambient-depth map for the edge extension zone.
 *
 * Constructs an occupancy grid that covers `[-N, W+N) × [-N, H+N)` (room
 * coords), coordinates are shifted by N so all indices are non-negative.
 * Solid tiles from the in-room occupancy map and from the mirrored extension
 * zone are included; transition opening cells remain air throughout.
 *
 * Running `buildAmbientDepths` over this expanded grid means:
 *  - In-room depths are consistent with the standard room BFS.
 *  - Extension solid tiles adjacent to transition openings (air) receive depth 0.
 *  - Extension solid tiles buried behind other solid extension tiles receive
 *    progressively higher depth, giving a natural darkening effect.
 *
 * @returns Map keyed by expanded "col,row" (i.e. room col+N, room row+N).
 */
function _buildExpandedAmbientDepths(
  occupied: Map<string, string | null>,
  openings: Set<string>,
  blockerKeys: Set<string>,
  ambientDirection: AmbientLightDirection,
  W: number,
  H: number,
  N: number,
): Map<string, number> {
  const EW = W + 2 * N;
  const EH = H + 2 * N;

  const isSolid = (col: number, row: number): boolean =>
    occupied.has(`${col},${row}`) && !openings.has(`${col},${row}`);

  // Build expanded occupancy with coordinates shifted by N.
  const expandedOccupied = new Set<string>();

  // In-room solid tiles
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      if (isSolid(col, row)) expandedOccupied.add(`${col + N},${row + N}`);
    }
  }

  // Left extension: col -d (d=1..N) → expanded col N-d
  for (let row = 0; row < H; row++) {
    if (!isSolid(0, row)) continue;
    for (let d = 1; d <= N; d++) expandedOccupied.add(`${N - d},${row + N}`);
  }
  // Right extension: col W+d-1 (d=1..N) → expanded col N+W+d-1
  for (let row = 0; row < H; row++) {
    if (!isSolid(W - 1, row)) continue;
    for (let d = 0; d < N; d++) expandedOccupied.add(`${N + W + d},${row + N}`);
  }
  // Top extension: row -d (d=1..N) → expanded row N-d
  for (let col = 0; col < W; col++) {
    if (!isSolid(col, 0)) continue;
    for (let d = 1; d <= N; d++) expandedOccupied.add(`${col + N},${N - d}`);
  }
  // Bottom extension: row H+d-1 (d=1..N) → expanded row N+H+d-1
  for (let col = 0; col < W; col++) {
    if (!isSolid(col, H - 1)) continue;
    for (let d = 0; d < N; d++) expandedOccupied.add(`${col + N},${N + H + d}`);
  }

  // Corner extensions — each corner cell inherits solid status from its
  // corresponding room-corner cell.
  // Top-left corner: col -dc (dc=1..N), row -dr (dr=1..N)
  if (isSolid(0, 0)) {
    for (let dc = 1; dc <= N; dc++) for (let dr = 1; dr <= N; dr++) expandedOccupied.add(`${N - dc},${N - dr}`);
  }
  // Top-right corner
  if (isSolid(W - 1, 0)) {
    for (let dc = 0; dc < N; dc++) for (let dr = 1; dr <= N; dr++) expandedOccupied.add(`${N + W + dc},${N - dr}`);
  }
  // Bottom-left corner
  if (isSolid(0, H - 1)) {
    for (let dc = 1; dc <= N; dc++) for (let dr = 0; dr < N; dr++) expandedOccupied.add(`${N - dc},${N + H + dr}`);
  }
  // Bottom-right corner
  if (isSolid(W - 1, H - 1)) {
    for (let dc = 0; dc < N; dc++) for (let dr = 0; dr < N; dr++) expandedOccupied.add(`${N + W + dc},${N + H + dr}`);
  }

  // Shift blockers into expanded coords (extension zone has no blockers).
  const expandedBlockers = new Set<string>();
  for (const key of blockerKeys) {
    const ci = key.indexOf(',');
    const col = parseInt(key.slice(0, ci), 10);
    const row = parseInt(key.slice(ci + 1), 10);
    expandedBlockers.add(`${col + N},${row + N}`);
  }

  return buildAmbientDepths(expandedOccupied, expandedBlockers, ambientDirection, EW, EH);
}

/**
 * Build an occupancy map: "col,row" → theme-or-null.
 * Only solid, visible, non-ramp walls are included.
 */
function _buildOccupancyMap(room: RoomDef): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (let wi = 0; wi < room.walls.length; wi++) {
    const w = room.walls[wi];
    // Exclude invisible boundary walls, ramps, and platforms
    // (they don't produce solid tiles that look continuous when extended)
    if (w.isInvisibleFlag === 1) continue;
    if (w.rampOrientation !== undefined) continue;
    const theme: string | null = w.blockTheme ?? null;
    for (let col = w.xBlock; col < w.xBlock + w.wBlock; col++) {
      for (let row = w.yBlock; row < w.yBlock + w.hBlock; row++) {
        const key = `${col},${row}`;
        // Per-wall theme beats room-default (null); once set, don't overwrite
        // with null from a later wall at the same cell.
        if (!map.has(key) || theme !== null) {
          map.set(key, theme);
        }
      }
    }
  }
  return map;
}

/**
 * Build a set of "col,row" keys for cells that sit on a transition opening
 * edge.  These cells must not be extended outward (the opening is a passage).
 */
function _buildTransitionOpeningSet(room: RoomDef): Set<string> {
  const W = room.widthBlocks;
  const H = room.heightBlocks;
  const openings = new Set<string>();
  for (const t of room.transitions) {
    const isHoriz = t.direction === 'left' || t.direction === 'right';
    if (isHoriz) {
      // Opening spans rows at the left or right edge column
      const edgeCol = t.direction === 'left' ? 0 : W - 1;
      for (let row = t.yBlock; row < t.yBlock + t.openingSizeBlocks; row++) {
        openings.add(`${edgeCol},${row}`);
      }
    } else {
      // Opening spans columns at the top or bottom edge row
      const edgeRow = t.direction === 'up' ? 0 : H - 1;
      for (let col = t.xBlock; col < t.xBlock + t.openingSizeBlocks; col++) {
        openings.add(`${col},${edgeRow}`);
      }
    }
  }
  return openings;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the edge extension tile cache for `room`.
 *
 * Call once per `loadRoom()`.  The returned object is immutable; rebuild it
 * whenever the room definition changes (editor session).
 */
export function buildEdgeExtensionCache(room: RoomDef): EdgeExtensionCache {
  const N = EDGE_EXTENSION_EXTRA_BLOCKS;
  const W = room.widthBlocks;
  const H = room.heightBlocks;

  const occupied = _buildOccupancyMap(room);
  const openings = _buildTransitionOpeningSet(room);

  const isSolid = (col: number, row: number): boolean =>
    occupied.has(`${col},${row}`) && !openings.has(`${col},${row}`);
  const themeAt = (col: number, row: number): string | null =>
    occupied.get(`${col},${row}`) ?? null;

  // ── Expanded ambient-depth map ────────────────────────────────────────────
  // Run a BFS over an expanded grid that includes the full extension zone so
  // each extension tile gets a real per-tile depth (not just edgeDepth+step).
  // Transition openings are air in the expanded grid, so solid tiles around
  // passages shade correctly as if the passage is exposed to open air.
  const effect = room.lightingEffect ?? 'Ambient';
  const ambientDirection: AmbientLightDirection =
    room.ambientLightDirection !== undefined ? room.ambientLightDirection :
    effect === 'Above' ? 'down' : 'omni';

  const blockerKeys = new Set<string>();
  for (const b of (room.ambientLightBlockers ?? [])) {
    blockerKeys.add(`${b.xBlock},${b.yBlock}`);
  }

  // Expanded depth map; keys are in EXPANDED coordinates (room coord + N).
  const expandedDepths = _buildExpandedAmbientDepths(
    occupied, openings, blockerKeys, ambientDirection, W, H, N,
  );
  const expandedFallback = Math.max(W + 2 * N, H + 2 * N);

  // Look up a depth using ROOM coordinates (handles in-room and extension tiles).
  const depthAt = (col: number, row: number): number =>
    expandedDepths.get(`${col + N},${row + N}`) ?? expandedFallback;

  const tiles: EdgeExtensionTile[] = [];

  // ── Left extension  (col: -N .. -1) ─────────────────────────────────────
  for (let row = 0; row < H; row++) {
    const solid = isSolid(0, row);
    const theme = solid ? themeAt(0, row) : null;
    for (let d = 1; d <= N; d++) {
      tiles.push({ colBlock: -d, rowBlock: row, isSolid: solid, theme, ambientDepth: depthAt(-d, row) });
    }
  }

  // ── Right extension (col: W .. W+N-1) ────────────────────────────────────
  for (let row = 0; row < H; row++) {
    const solid = isSolid(W - 1, row);
    const theme = solid ? themeAt(W - 1, row) : null;
    for (let d = 0; d < N; d++) {
      tiles.push({ colBlock: W + d, rowBlock: row, isSolid: solid, theme, ambientDepth: depthAt(W + d, row) });
    }
  }

  // ── Top extension    (row: -N .. -1) ─────────────────────────────────────
  for (let col = 0; col < W; col++) {
    const solid = isSolid(col, 0);
    const theme = solid ? themeAt(col, 0) : null;
    for (let d = 1; d <= N; d++) {
      tiles.push({ colBlock: col, rowBlock: -d, isSolid: solid, theme, ambientDepth: depthAt(col, -d) });
    }
  }

  // ── Bottom extension (row: H .. H+N-1) ───────────────────────────────────
  for (let col = 0; col < W; col++) {
    const solid = isSolid(col, H - 1);
    const theme = solid ? themeAt(col, H - 1) : null;
    for (let d = 0; d < N; d++) {
      tiles.push({ colBlock: col, rowBlock: H + d, isSolid: solid, theme, ambientDepth: depthAt(col, H + d) });
    }
  }

  // ── Corner extensions ─────────────────────────────────────────────────────
  // Each corner cell borrows solid/theme from the nearest room corner cell.
  // Top-left
  {
    const solid = isSolid(0, 0);
    const theme = solid ? themeAt(0, 0) : null;
    for (let dc = 1; dc <= N; dc++) {
      for (let dr = 1; dr <= N; dr++) {
        tiles.push({ colBlock: -dc, rowBlock: -dr, isSolid: solid, theme, ambientDepth: depthAt(-dc, -dr) });
      }
    }
  }
  // Top-right
  {
    const solid = isSolid(W - 1, 0);
    const theme = solid ? themeAt(W - 1, 0) : null;
    for (let dc = 0; dc < N; dc++) {
      for (let dr = 1; dr <= N; dr++) {
        tiles.push({ colBlock: W + dc, rowBlock: -dr, isSolid: solid, theme, ambientDepth: depthAt(W + dc, -dr) });
      }
    }
  }
  // Bottom-left
  {
    const solid = isSolid(0, H - 1);
    const theme = solid ? themeAt(0, H - 1) : null;
    for (let dc = 1; dc <= N; dc++) {
      for (let dr = 0; dr < N; dr++) {
        tiles.push({ colBlock: -dc, rowBlock: H + dr, isSolid: solid, theme, ambientDepth: depthAt(-dc, H + dr) });
      }
    }
  }
  // Bottom-right
  {
    const solid = isSolid(W - 1, H - 1);
    const theme = solid ? themeAt(W - 1, H - 1) : null;
    for (let dc = 0; dc < N; dc++) {
      for (let dr = 0; dr < N; dr++) {
        tiles.push({ colBlock: W + dc, rowBlock: H + dr, isSolid: solid, theme, ambientDepth: depthAt(W + dc, H + dr) });
      }
    }
  }

  // ── Occupancy set for sprite neighbor-mask lookups ────────────────────────
  // Includes every solid extension tile plus the room's outermost edge cells.
  // The room-edge entries allow extension tiles adjacent to the room boundary
  // to see their inner-facing neighbour as occupied without scanning the full
  // WallSnapshot.
  const occupancySet = new Set<string>();

  for (let ti = 0; ti < tiles.length; ti++) {
    const t = tiles[ti];
    if (t.isSolid) occupancySet.add(`${t.colBlock},${t.rowBlock}`);
  }

  // Room left edge (col = 0)
  for (let row = 0; row < H; row++) {
    if (isSolid(0, row)) occupancySet.add(`0,${row}`);
  }
  // Room right edge (col = W-1)
  for (let row = 0; row < H; row++) {
    if (isSolid(W - 1, row)) occupancySet.add(`${W - 1},${row}`);
  }
  // Room top edge (row = 0)
  for (let col = 0; col < W; col++) {
    if (isSolid(col, 0)) occupancySet.add(`${col},0`);
  }
  // Room bottom edge (row = H-1)
  for (let col = 0; col < W; col++) {
    if (isSolid(col, H - 1)) occupancySet.add(`${col},${H - 1}`);
  }

  return { roomId: room.id, tiles, occupancySet };
}
