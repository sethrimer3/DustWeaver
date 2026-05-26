/**
 * Pre-warm chunk store for wall rendering.
 *
 * Thin adapter over `roomRenderCacheStore.ts`.  Wall and bg caches share one
 * `RoomRenderSnapshot` per room so that a single renderStateKey can gate both.
 * Adoption is staged (wall then bg) in two separate calls — it is NOT atomic.
 * Both calls occur in the same synchronous transition sequence so a torn read
 * is unlikely in practice, but callers should treat wall and bg availability
 * independently.  This module re-exports the public management API consumed by
 * `blockSpriteRenderer.ts` and (via re-export) by the scheduler.
 *
 * BUILD 411
 */

import { RoomChunkCache } from './chunkRenderCache';
import type { CachedWallLayout } from './blockWallLayoutCache';
import {
  getOrCreateSnapshot,
  getSnapshot,
  clearSnapshotWallData,
  hasWallPrewarmData,
  listWallPrewarmRoomIds,
  getSnapshotWallRoomStats,
  getAggregateWallStats,
  getPrewarmDummyCtx,
} from './roomRenderCacheStore';

// Re-export the shared dummy ctx so blockSpriteRenderer.ts keeps its import path.
export { getPrewarmDummyCtx };

// ── Internal accessors (used only by blockSpriteRenderer.ts) ──────────────

export function getPrewarmWallLayout(roomId: string): CachedWallLayout | undefined {
  return getSnapshot(roomId)?.wallLayout ?? undefined;
}

export function setPrewarmWallLayout(roomId: string, layout: CachedWallLayout): void {
  const snap = getSnapshot(roomId);
  if (snap !== undefined) {
    snap.wallLayout = layout;
  }
}

export function getPrewarmWallCache(roomId: string): RoomChunkCache | undefined {
  return getSnapshot(roomId)?.wallCache ?? undefined;
}

/**
 * Returns the `renderStateKey` stored in the snapshot for `roomId`, or
 * `undefined` when no snapshot is held.  Used by the adoption path to
 * detect stale snapshots whose key no longer matches the active room state.
 */
export function getPrewarmSnapshotRenderStateKey(roomId: string): string | undefined {
  return getSnapshot(roomId)?.renderStateKey;
}

/**
 * Returns the existing prewarm wall cache for `roomId`, or creates a new one.
 * `renderStateKey` is forwarded to `getOrCreateSnapshot` so that a stale
 * snapshot (built with a different theme/lighting) is evicted automatically.
 */
export function getOrCreatePrewarmWallCache(roomId: string, renderStateKey: string): RoomChunkCache {
  const snap = getOrCreateSnapshot(roomId, renderStateKey);
  if (snap.wallCache === null) {
    snap.wallCache = new RoomChunkCache();
  }
  return snap.wallCache;
}

/**
 * Clears the wall cache and layout for `roomId`, leaving the bg cache intact
 * so bg adoption can proceed independently.
 */
export function deletePrewarmEntry(roomId: string): void {
  clearSnapshotWallData(roomId);
}

// ── Public management API (re-exported from blockSpriteRenderer.ts) ────────

/** Discards pre-warmed wall chunks for `roomId` without adopting them. */
export function evictPrewarmedWallChunks(roomId: string): void {
  clearSnapshotWallData(roomId);
}

/** Returns `true` when pre-warmed wall data exists for `roomId`. */
export function hasPrewarmedWallChunks(roomId: string): boolean {
  return hasWallPrewarmData(roomId);
}

/** Returns the list of room IDs that currently have pre-warmed wall chunks. */
export function listPrewarmedWallRoomIds(): string[] {
  return listWallPrewarmRoomIds();
}

/**
 * Returns per-room prewarm wall stats for `roomId`, or `null` when not held.
 * Used by the eviction pass to compute per-room memory.
 */
export function getPrewarmWallRoomStats(roomId: string): { chunks: number; memoryKB: number } | null {
  return getSnapshotWallRoomStats(roomId);
}

/**
 * Returns aggregate stats across all currently-held prewarm wall caches.
 * Used by the debug overlay.
 */
export function getPrewarmWallStats(): { roomCount: number; totalChunks: number; memoryEstimateKB: number } {
  return getAggregateWallStats();
}
