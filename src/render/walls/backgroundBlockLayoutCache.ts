/**
 * backgroundBlockLayoutCache.ts — Per-chunk cell buckets for background blocks.
 *
 * Background blocks are rectangular regions of RoomBackgroundBlockDef entries.
 * When rendering a chunk, `backgroundBlockRenderer` previously iterated all
 * block definitions and AABB-culled per chunk build.  For large rooms this
 * causes O(#blocks) work per chunk.
 *
 * This module pre-buckets every expanded cell into its owning chunk so each
 * chunk build only touches the cells it needs.  The bucket map is rebuilt
 * lazily when the room's background blocks change (detected via a simple
 * content signature).
 *
 * Design deliberately mirrors `blockWallLayoutCache.ts` but is simpler:
 * no ramps, no 2×2 tiles — background blocks expand to plain 1×1 cells only.
 */

import type { RoomBackgroundBlockDef } from '../../levels/roomElementDefs';
import { CHUNK_SIZE_BLOCKS } from './chunkRenderCache';

// ─── Public types ─────────────────────────────────────────────────────────────

/** A single expanded background block cell. */
export interface BackgroundBlockCell {
  col:     number;
  row:     number;
  themeId: string | null;
}

/** Precomputed, bucketed layout for a room's background blocks. */
export interface CachedBackgroundBlockLayout {
  /** Content hash used for cache validation. */
  signature: string;
  /**
   * Map from chunk key (`"cx,cy"`) to the list of cells that fall inside it.
   * Only chunk keys with at least one cell are present.
   */
  cellsByChunkKey: Map<string, BackgroundBlockCell[]>;
}

// ─── Internal state ──────────────────────────────────────────────────────────

/** The currently cached layout (or null if no layout has been built yet). */
let _cachedLayout: CachedBackgroundBlockLayout | null = null;

// ─── Signature ───────────────────────────────────────────────────────────────

/**
 * Computes a lightweight, order-sensitive signature string for an array of
 * background block definitions.  Cells are compared by position, size, and
 * theme.  The signature is intentionally cheap — no cryptographic hash.
 */
function _computeSignature(
  blocks:          readonly RoomBackgroundBlockDef[],
  roomBlockTheme:  string | null,
): string {
  if (blocks.length === 0) return `0:${roomBlockTheme ?? ''}`;
  let sig = `${blocks.length}:${roomBlockTheme ?? ''}`;
  for (const b of blocks) {
    sig += `:${b.xBlock},${b.yBlock},${b.wBlock},${b.hBlock},${b.blockTheme ?? ''}`;
  }
  return sig;
}

// ─── Build ────────────────────────────────────────────────────────────────────

/**
 * Expands `blocks` into per-cell records and distributes them into a
 * `Map<chunkKey, cells[]>` map keyed by `"cx,cy"` chunk coordinates.
 */
function _buildCellBuckets(
  blocks:         readonly RoomBackgroundBlockDef[],
  roomBlockTheme: string | null,
): Map<string, BackgroundBlockCell[]> {
  const cellsByChunkKey = new Map<string, BackgroundBlockCell[]>();

  for (const b of blocks) {
    const themeId = b.blockTheme ?? roomBlockTheme;

    for (let dy = 0; dy < b.hBlock; dy++) {
      const row = b.yBlock + dy;
      const cy  = Math.floor(row / CHUNK_SIZE_BLOCKS);

      for (let dx = 0; dx < b.wBlock; dx++) {
        const col = b.xBlock + dx;
        const cx  = Math.floor(col / CHUNK_SIZE_BLOCKS);

        const key = `${cx},${cy}`;
        let bucket = cellsByChunkKey.get(key);
        if (bucket === undefined) {
          bucket = [];
          cellsByChunkKey.set(key, bucket);
        }
        bucket.push({ col, row, themeId });
      }
    }
  }

  return cellsByChunkKey;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns (and caches) the per-chunk cell layout for the given background
 * block definitions.
 *
 * The result is reused as long as the `signature` matches.  Call this once per
 * chunk-build pass and keep the return value in a local variable.
 *
 * @param blocks         The room's `backgroundBlocks` array (may be empty/undefined).
 * @param roomBlockTheme The room-level fallback block theme (or null).
 */
export function getBgBlockLayout(
  blocks:          readonly RoomBackgroundBlockDef[] | undefined,
  roomBlockTheme:  string | null,
): CachedBackgroundBlockLayout {
  const safeBlocks = blocks ?? [];
  const sig = _computeSignature(safeBlocks, roomBlockTheme);

  if (_cachedLayout !== null && _cachedLayout.signature === sig) {
    return _cachedLayout;
  }

  const cellsByChunkKey = _buildCellBuckets(safeBlocks, roomBlockTheme);
  _cachedLayout = { signature: sig, cellsByChunkKey };
  return _cachedLayout;
}

/**
 * Returns the list of pre-bucketed background block cells for a specific
 * chunk, or an empty array if the chunk contains no background blocks.
 *
 * @param layout  The result of `getBgBlockLayout()`.
 * @param cx      Chunk X coordinate.
 * @param cy      Chunk Y coordinate.
 */
export function getCellsForChunk(
  layout: CachedBackgroundBlockLayout,
  cx:     number,
  cy:     number,
): BackgroundBlockCell[] {
  return layout.cellsByChunkKey.get(`${cx},${cy}`) ?? [];
}

/**
 * Discards the cached layout.  Call this when the active room changes to
 * avoid serving a stale layout for a different room's block data.
 */
export function invalidateBgBlockLayout(): void {
  _cachedLayout = null;
}
