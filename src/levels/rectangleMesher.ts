/**
 * rectangleMesher.ts — Shared deterministic occupancy-to-rectangle meshing utility.
 *
 * Pure, Node-safe helper that turns a sparse set of occupied grid cells (each
 * tagged with a "behavior key") into a deterministic, compact, non-overlapping
 * set of axis-aligned rectangles — one rectangle set per behavior key. Cells
 * with different behavior keys are never merged into the same rectangle.
 *
 * ── Contract ─────────────────────────────────────────────────────────────
 *  - A coordinate may have only one behavior key within a single call.
 *  - Duplicate input entries with the same (x, y) AND the same key are
 *    deduplicated (treated as one occupied cell).
 *  - Conflicting duplicates — the same (x, y) with two *different* keys — are
 *    REJECTED: the function throws a descriptive error rather than silently
 *    keeping one, keeping both (which would force overlapping rectangles), or
 *    picking a winner. Callers with a legitimate reason for the same
 *    coordinate to carry different keys must resolve that upstream (e.g. by
 *    picking one key per coordinate) before calling this module.
 *  - Output rectangles never overlap, including across different keys.
 *  - Output is deterministic and compact, but it is NOT guaranteed to be the
 *    theoretical minimum rectangle count (that is NP-hard in general).
 *  - Every accepted input cell is covered by exactly one output rectangle.
 *  - No output rectangle contains a cell absent from the accepted input for
 *    that key.
 *
 * This module has NO editor/runtime/schema coupling. Phase 1 wires it into
 * the dark ambient-light blocker overlay renderer only (see
 * `src/render/walls/darkBlockerOverlay.ts`); it is intentionally NOT wired
 * into the editor's authoritative per-cell `EditorAmbientLightBlocker` model,
 * paint/erase tools, undo/redo history, selection, or save schema in this
 * phase — see the "Phase 1 scope" note below and `nextSteps.md`.
 *
 * ── Algorithm ────────────────────────────────────────────────────────────
 * Greedy uppermost-leftmost rectangle growth, documented and deterministic:
 *
 *  1. Group input cells by behavior key.
 *  2. Within each behavior-key group, sort cells by (row, col) ascending.
 *  3. Repeatedly take the uppermost-leftmost unconsumed cell as a seed.
 *  4. Expand the seed rightward across contiguous unconsumed cells in the
 *     same row (same behavior key, by construction of the group) to find the
 *     maximal starting width.
 *  5. Expand downward one row at a time, only while the *entire* width found
 *     in step 4 is present and unconsumed in the next row. Stop at the first
 *     row that doesn't fully match.
 *  6. Emit the resulting rectangle, mark every covered cell consumed, and
 *     repeat from step 3 until no unconsumed cells remain in the group.
 *  7. Concatenate all groups' rectangles; sort the final list by
 *     (behaviorKey, y, x) for stable, deterministic output ordering
 *     regardless of input iteration order.
 *
 * This is a standard greedy maximal-horizontal-strip meshing policy. It does
 * not guarantee the theoretical minimum rectangle count (that is NP-hard in
 * general), but it is deterministic, cheap (O(n log n)), and gives very large
 * reductions for filled/near-filled regions (e.g. a 100x100 filled region
 * meshes to a single rectangle).
 */

/** A single occupied cell with an associated behavior key. */
export interface MeshCell {
  x: number;
  y: number;
  /** Behavior key — cells with different keys are never merged together. */
  key: string;
}

/** A meshed axis-aligned rectangle, in cell (grid) coordinates. */
export interface MeshRect {
  x: number;
  y: number;
  w: number;
  h: number;
  key: string;
}

/**
 * Meshes a sparse set of occupied cells into a minimal, deterministic,
 * non-overlapping set of rectangles per behavior key.
 *
 * Guarantees:
 *  - Every accepted input cell is covered by exactly one output rectangle.
 *  - No output rectangle contains a cell not present in the accepted input
 *    with the same key.
 *  - No two output rectangles (regardless of key) overlap.
 *  - Output rectangle order is stable and independent of input order.
 *  - Duplicate input cells (same x, y, key) are treated as one occupied cell.
 *
 * If the same (x, y) coordinate appears with two *different* keys, this is a
 * conflicting duplicate and is rejected with a thrown error — see the module
 * doc comment's Contract section. It is never silently resolved, because
 * keeping both would force two rectangles (one per key) to overlap at that
 * coordinate, violating the no-overlap guarantee.
 *
 * @param cells Sparse occupied cells; any iteration order.
 * @returns Deterministic rectangle list, sorted by (key, y, x).
 * @throws {Error} If the same (x, y) coordinate appears with two different keys.
 */
export function meshCellsToRectangles(cells: readonly MeshCell[]): MeshRect[] {
  // Group by key, deduping (x,y) within each key. Track which key first
  // claimed each coordinate so conflicting duplicates can be detected and
  // rejected deterministically (in input order).
  const byKey = new Map<string, Set<string>>();
  const coordOwner = new Map<string, string>();
  for (const cell of cells) {
    const coord = `${cell.x},${cell.y}`;
    const owner = coordOwner.get(coord);
    if (owner === undefined) {
      coordOwner.set(coord, cell.key);
    } else if (owner !== cell.key) {
      throw new Error(
        `meshCellsToRectangles: conflicting duplicate coordinate (${cell.x}, ${cell.y}) ` +
          `has both key "${owner}" and key "${cell.key}". A coordinate may have only one ` +
          `behavior key per call — resolve the conflict upstream before calling this module.`,
      );
    }
    let set = byKey.get(cell.key);
    if (set === undefined) {
      set = new Set<string>();
      byKey.set(cell.key, set);
    }
    set.add(coord);
  }

  const result: MeshRect[] = [];

  // Sort keys for deterministic group-processing order (also affects nothing
  // observable since we re-sort the final result, but keeps intermediate
  // behavior deterministic/debuggable too).
  const keys = Array.from(byKey.keys()).sort();

  for (const key of keys) {
    const coordSet = byKey.get(key)!;
    const occupied = new Set(coordSet); // consumable copy

    // Parse to numeric cells and sort by (row=y, col=x).
    const parsed: Array<{ x: number; y: number }> = [];
    for (const coord of coordSet) {
      const ci = coord.indexOf(',');
      parsed.push({ x: parseInt(coord.slice(0, ci), 10), y: parseInt(coord.slice(ci + 1), 10) });
    }
    parsed.sort((a, b) => (a.y - b.y) || (a.x - b.x));

    for (const seed of parsed) {
      const seedKey = `${seed.x},${seed.y}`;
      if (!occupied.has(seedKey)) continue; // already consumed by an earlier rect

      // Step 4: expand rightward in the seed row.
      let width = 1;
      while (occupied.has(`${seed.x + width},${seed.y}`)) width++;

      // Step 5: expand downward while the full width matches.
      let height = 1;
      outer: for (;;) {
        const rowY = seed.y + height;
        for (let dx = 0; dx < width; dx++) {
          if (!occupied.has(`${seed.x + dx},${rowY}`)) break outer;
        }
        height++;
      }

      // Step 6: emit + consume.
      for (let dy = 0; dy < height; dy++) {
        for (let dx = 0; dx < width; dx++) {
          occupied.delete(`${seed.x + dx},${seed.y + dy}`);
        }
      }
      result.push({ x: seed.x, y: seed.y, w: width, h: height, key });
    }
  }

  // Step 7: stable deterministic final ordering, independent of input order.
  result.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) || (a.y - b.y) || (a.x - b.x));
  return result;
}

/**
 * Expands a rectangle list back into the flat set of individual occupied
 * cells it covers. Useful for round-trip/parity tests against the original
 * cell input.
 */
export function expandRectanglesToCells(rects: readonly MeshRect[]): MeshCell[] {
  const cells: MeshCell[] = [];
  for (const rect of rects) {
    for (let dy = 0; dy < rect.h; dy++) {
      for (let dx = 0; dx < rect.w; dx++) {
        cells.push({ x: rect.x + dx, y: rect.y + dy, key: rect.key });
      }
    }
  }
  return cells;
}
