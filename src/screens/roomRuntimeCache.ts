/**
 * roomRuntimeCache.ts — Bounded LRU cache for per-room static runtime data.
 *
 * Caches:
 *  - `RoomWallTemplate` — result of the expensive O(n²) wall-merge pass.
 *  - Ambient-light blocker key sets — built inline on cache miss.
 *  - Wall decorations — pure geometry, no mutable state.
 *
 * EdgeExtensionCache is no longer built during normal gameplay (legacy feature).
 * The `edgeExtension` field is kept in `RoomRuntimeEntry` for legacy compatibility
 * but is always `null` in normal gameplay.  See src/render/transitions/legacy/README.md.
 *
 * Both wall templates and blocker sets can be built ahead of time for rooms near
 * the player via `roomPreloadScheduler.ts`, so that when the player crosses a
 * transition the expensive work is already done and `_makeLoadRoomPhases` only
 * copies data rather than recomputing it.
 *
 * Cache invalidation:
 *  - Call `invalidate(roomId)` when a room is edited (editor reload callback).
 *  - Call `invalidateAll()` to reset for save/load round-trips.
 *
 * BUILD 388
 */

import type { RoomWallTemplate } from './gameRoomWalls';
import type { EdgeExtensionCache } from '../render/transitions/edgeExtensionCache';
import type { WallDecoration } from '../render/effects/wallDecorations';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RoomRuntimeEntry {
  /** The live render revision for dynamic invalidation tracking. */
  renderRevision: number;
  /** Merged wall geometry snapshot — apply with `applyRoomWallTemplate`. */
  wallTemplate: RoomWallTemplate;
  /**
   * Edge-extension tile strip — used by the editor renderer.
   * Legacy: not built during normal gameplay (edge-extension rendering disabled).
   * `null` = not built; non-null = ready (editor-only).
   */
  edgeExtension: EdgeExtensionCache | null;
  /**
   * Precomputed ambient-light blocker key set.
   *  - `null`      = not yet built (computed inline during Phase A on cache miss).
   *  - `undefined` = built; this room has no ambient light blockers.
   *  - `Set`       = built and populated.
   */
  blockerKeys: Set<string> | null | undefined;
  /**
   * Precomputed dark-ambient (shadow) blocker key set.
   * Same `null` / `undefined` / `Set` sentinel semantics as `blockerKeys`.
   */
  darkBlockerKeys: Set<string> | null | undefined;
  /**
   * Precomputed wall decorations (pure geometry, no mutable state).
   *  - `null`  = not yet built.
   *  - array   = built (may be empty for rooms without decorations).
   */
  wallDecorations: WallDecoration[] | null;
}

// ── isEntryFullyPrepared ──────────────────────────────────────────────────────

/**
 * Returns `true` when all static fields in the entry have been computed.
 * A "fully prepared" entry can be applied instantly during a room transition
 * without any build passes.
 *
 * Note: `edgeExtension` is intentionally excluded — edge-extension cache
 * building is no longer part of normal gameplay (legacy feature, disabled).
 * An entry is considered fully prepared as soon as walls, blockers, and
 * decorations are ready.
 */
export function isEntryFullyPrepared(entry: RoomRuntimeEntry): boolean {
  return (
    entry.blockerKeys !== null &&
    entry.darkBlockerKeys !== null &&
    entry.wallDecorations !== null
  );
}

// ── RoomRuntimeCache ──────────────────────────────────────────────────────────

/**
 * LRU-evicting cache for `RoomRuntimeEntry` objects.
 *
 * Uses ES6 `Map` insertion-order semantics for O(1) LRU eviction:
 *  - On each `get()` the entry is moved to the end (most-recently-used).
 *  - When `set()` would exceed capacity, the first (oldest) entry is removed.
 *
 * Default capacity is 16 rooms, which covers the current player room, all
 * directly adjacent rooms (~5), one hop further (~8), and leaves headroom
 * for rapid backtracking between recently visited rooms without evicting
 * adjacent rooms that are still needed.
 */
export class RoomRuntimeCache {
  private readonly _map = new Map<string, RoomRuntimeEntry>();
  private readonly _capacity: number;
  private readonly _pinnedRooms = new Set<string>();

  constructor(capacity = 16) {
    this._capacity = capacity;
  }

  /**
   * Pins rooms that should never be evicted (e.g. all rooms in the active zone).
   */
  setPinnedRooms(roomIds: Iterable<string>): void {
    this._pinnedRooms.clear();
    for (const id of roomIds) {
      this._pinnedRooms.add(id);
    }
  }

  /** Number of rooms currently protected from eviction (diagnostics). */
  get pinnedRoomCount(): number {
    return this._pinnedRooms.size;
  }

  /** True when `roomId` is protected from eviction (diagnostics/tests). */
  isRoomPinned(roomId: string): boolean {
    return this._pinnedRooms.has(roomId);
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
   * When size would exceed capacity, the least-recently-used unpinned entry is evicted.
   */
  set(roomId: string, entry: RoomRuntimeEntry): void {
    if (this._map.has(roomId)) {
      this._map.delete(roomId);
    } else {
      this._evictUntilCapacity();
    }
    this._map.set(roomId, entry);
  }
  
  private _evictUntilCapacity(): void {
    while (this._map.size >= this._capacity) {
      let evictedAny = false;
      for (const key of this._map.keys()) {
        if (!this._pinnedRooms.has(key)) {
          this._map.delete(key);
          evictedAny = true;
          break;
        }
      }
      if (!evictedAny) {
        // All rooms in cache are pinned. We must exceed capacity.
        break;
      }
    }
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
