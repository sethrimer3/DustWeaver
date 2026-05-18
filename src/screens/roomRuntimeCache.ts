/**
 * roomRuntimeCache.ts — Bounded LRU cache for per-room static runtime data.
 *
 * Caches:
 *  - `RoomWallTemplate` — result of the expensive O(n²) wall-merge pass.
 *  - `EdgeExtensionCache` — precomputed edge-extension tile strip.
 *
 * Both can be built ahead of time for rooms near the player via
 * `roomPreloadScheduler.ts`, so that when the player crosses a transition the
 * expensive work is already done and `_makeLoadRoomPhases` only copies data
 * rather than recomputing it.
 *
 * Cache invalidation:
 *  - Call `invalidate(roomId)` when a room is edited (editor reload callback).
 *  - Call `invalidateAll()` to reset for save/load round-trips.
 *
 * BUILD 357
 */

import type { RoomWallTemplate } from './gameRoomWalls';
import type { EdgeExtensionCache } from '../render/transitions/edgeExtensionCache';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RoomRuntimeEntry {
  /** Merged wall geometry snapshot — apply with `applyRoomWallTemplate`. */
  wallTemplate: RoomWallTemplate;
  /**
   * Edge-extension tile strip — used directly by the renderer.
   * May be `null` if the entry was created in Phase D before Phase F ran
   * (the cache will be updated with the built value in Phase F).
   */
  edgeExtension: EdgeExtensionCache | null;
}

// ── RoomRuntimeCache ──────────────────────────────────────────────────────────

/**
 * LRU-evicting cache for `RoomRuntimeEntry` objects.
 *
 * Uses ES6 `Map` insertion-order semantics for O(1) LRU eviction:
 *  - On each `get()` the entry is moved to the end (most-recently-used).
 *  - When `set()` would exceed capacity, the first (oldest) entry is removed.
 *
 * Default capacity is 10 rooms, which covers the current player room plus
 * 2-hop radius and leaves headroom for non-linear traversal.
 */
export class RoomRuntimeCache {
  private readonly _map = new Map<string, RoomRuntimeEntry>();
  private readonly _capacity: number;

  constructor(capacity = 10) {
    this._capacity = capacity;
  }

  /**
   * Returns the cached entry for `roomId`, promoting it to most-recently-used.
   * Returns `undefined` when the room is not cached.
   */
  get(roomId: string): RoomRuntimeEntry | undefined {
    const entry = this._map.get(roomId);
    if (entry !== undefined) {
      // Move to end = most-recently-used position.
      this._map.delete(roomId);
      this._map.set(roomId, entry);
    }
    return entry;
  }

  /**
   * Stores `entry` for `roomId`.
   * If an entry already exists it is replaced in-place (no eviction needed).
   * When size would exceed capacity, the least-recently-used entry is evicted.
   */
  set(roomId: string, entry: RoomRuntimeEntry): void {
    if (this._map.has(roomId)) {
      this._map.delete(roomId);
    } else if (this._map.size >= this._capacity) {
      // Evict LRU (first key in insertion order).
      const firstKey = this._map.keys().next().value;
      if (firstKey !== undefined) this._map.delete(firstKey);
    }
    this._map.set(roomId, entry);
  }

  /** Returns true when the room already has a cached entry. */
  has(roomId: string): boolean {
    return this._map.has(roomId);
  }

  /**
   * Removes the cached entry for `roomId`.
   * Called by the editor reload callback whenever a room's geometry changes.
   */
  invalidate(roomId: string): void {
    this._map.delete(roomId);
  }

  /** Removes all cached entries (e.g. on save/load round-trip). */
  invalidateAll(): void {
    this._map.clear();
  }

  /** Number of entries currently in the cache. */
  get size(): number {
    return this._map.size;
  }
}
