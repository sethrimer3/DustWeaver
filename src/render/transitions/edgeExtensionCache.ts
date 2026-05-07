/**
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

import type { RoomDef } from '../../levels/roomDef';
import { EDGE_EXTENSION_EXTRA_BLOCKS } from './transitionConfig';

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
}

/** Cached edge extension data for a single room. */
export interface EdgeExtensionCache {
  /** The room ID this cache was built for. */
  roomId: string;
  /** Flat tile list.  All entries are pre-allocated; no sparse gaps. */
  tiles: readonly EdgeExtensionTile[];
}

// ── Internal helpers ──────────────────────────────────────────────────────────

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

  const tiles: EdgeExtensionTile[] = [];

  // ── Left extension  (col: -N .. -1) ─────────────────────────────────────
  for (let row = 0; row < H; row++) {
    const solid = isSolid(0, row);
    const theme = solid ? themeAt(0, row) : null;
    for (let d = 1; d <= N; d++) {
      tiles.push({ colBlock: -d, rowBlock: row, isSolid: solid, theme });
    }
  }

  // ── Right extension (col: W .. W+N-1) ────────────────────────────────────
  for (let row = 0; row < H; row++) {
    const solid = isSolid(W - 1, row);
    const theme = solid ? themeAt(W - 1, row) : null;
    for (let d = 0; d < N; d++) {
      tiles.push({ colBlock: W + d, rowBlock: row, isSolid: solid, theme });
    }
  }

  // ── Top extension    (row: -N .. -1) ─────────────────────────────────────
  for (let col = 0; col < W; col++) {
    const solid = isSolid(col, 0);
    const theme = solid ? themeAt(col, 0) : null;
    for (let d = 1; d <= N; d++) {
      tiles.push({ colBlock: col, rowBlock: -d, isSolid: solid, theme });
    }
  }

  // ── Bottom extension (row: H .. H+N-1) ───────────────────────────────────
  for (let col = 0; col < W; col++) {
    const solid = isSolid(col, H - 1);
    const theme = solid ? themeAt(col, H - 1) : null;
    for (let d = 0; d < N; d++) {
      tiles.push({ colBlock: col, rowBlock: H + d, isSolid: solid, theme });
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
        tiles.push({ colBlock: -dc, rowBlock: -dr, isSolid: solid, theme });
      }
    }
  }
  // Top-right
  {
    const solid = isSolid(W - 1, 0);
    const theme = solid ? themeAt(W - 1, 0) : null;
    for (let dc = 0; dc < N; dc++) {
      for (let dr = 1; dr <= N; dr++) {
        tiles.push({ colBlock: W + dc, rowBlock: -dr, isSolid: solid, theme });
      }
    }
  }
  // Bottom-left
  {
    const solid = isSolid(0, H - 1);
    const theme = solid ? themeAt(0, H - 1) : null;
    for (let dc = 1; dc <= N; dc++) {
      for (let dr = 0; dr < N; dr++) {
        tiles.push({ colBlock: -dc, rowBlock: H + dr, isSolid: solid, theme });
      }
    }
  }
  // Bottom-right
  {
    const solid = isSolid(W - 1, H - 1);
    const theme = solid ? themeAt(W - 1, H - 1) : null;
    for (let dc = 0; dc < N; dc++) {
      for (let dr = 0; dr < N; dr++) {
        tiles.push({ colBlock: W + dc, rowBlock: H + dr, isSolid: solid, theme });
      }
    }
  }

  return { roomId: room.id, tiles };
}
