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
  getOrCreateBundle,
  getCacheBundle,
  getPrewarmDummyCtx,
  listWallPrewarmRoomIds,
  hasWallPrewarmData,
} from './roomRenderCacheStore';

// Re-export the shared dummy ctx so blockSpriteRenderer.ts keeps its import path.
export { getPrewarmDummyCtx };

// ── Internal accessors (used only by blockSpriteRenderer.ts) ──────────────

export function getPrewarmWallLayout(roomId: string): CachedWallLayout | undefined {
  return getCacheBundle(roomId)?.wallLayout ?? undefined;
}

export function setPrewarmWallLayout(roomId: string, layout: CachedWallLayout): void {
  const snap = getCacheBundle(roomId);
  if (snap !== undefined) {
    snap.wallLayout = layout;
  }
}

export function getPrewarmWallCache(roomId: string): RoomChunkCache | undefined {
  return getCacheBundle(roomId)?.wallCache ?? undefined;
}

export function getPrewarmSnapshotRenderStateKey(roomId: string): string | undefined {
  return getCacheBundle(roomId)?.renderStateKey;
}

export function getOrCreatePrewarmWallCache(roomId: string, renderStateKey: string, renderRevision: number, scalePx: number): RoomChunkCache {
  const snap = getOrCreateBundle(roomId, renderStateKey, renderRevision, scalePx);
  if (snap.wallCache === null) {
    snap.wallCache = new RoomChunkCache();
  }
  return snap.wallCache;
}

export function deletePrewarmEntry(roomId: string): void {
  const snap = getCacheBundle(roomId);
  if (snap) {
    snap.wallCache = null;
    snap.wallLayout = null;
  }
}

export function evictPrewarmedWallChunks(roomId: string): void {
  deletePrewarmEntry(roomId);
}

/** Returns `true` when pre-warmed wall data exists for `roomId`. */
export function hasPrewarmedWallChunks(roomId: string): boolean {
  return hasWallPrewarmData(roomId);
}

/** Returns the list of room IDs that currently have pre-warmed wall chunks. */
export function listPrewarmedWallRoomIds(): string[] {
  return listWallPrewarmRoomIds();
}

export function getPrewarmWallRoomStats(roomId: string): { chunks: number; memoryKB: number } | null {
  const cache = getCacheBundle(roomId)?.wallCache;
  if (!cache) return null;
  return { chunks: cache.stats.totalChunkCount, memoryKB: cache.stats.memoryEstimateKB };
}

export function getPrewarmWallStats(): { roomCount: number; totalChunks: number; memoryEstimateKB: number } {
  let roomCount = 0;
  let totalChunks = 0;
  let memoryEstimateKB = 0;
  for (const id of listWallPrewarmRoomIds()) {
    const stats = getPrewarmWallRoomStats(id);
    if (stats) {
      roomCount++;
      totalChunks += stats.chunks;
      memoryEstimateKB += stats.memoryKB;
    }
  }
  return { roomCount, totalChunks, memoryEstimateKB };
}
