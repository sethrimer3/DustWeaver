/**
 * Pre-warm chunk store for wall rendering.
 *
 * Holds pre-built RoomChunkCache and CachedWallLayout objects for rooms that
 * have not yet been entered.  The store is populated by the idle-time warm
 * scheduler (roomRenderChunkWarmScheduler.ts) and consumed when the player
 * actually enters a room (adoptPrewarmedWallChunks in blockSpriteRenderer.ts).
 *
 * Internal accessor helpers are exported so blockSpriteRenderer.ts can
 * manipulate the store without importing the Map instances directly.
 */

import { RoomChunkCache } from './chunkRenderCache';
import type { CachedWallLayout } from './blockWallLayoutCache';

// THREAD SAFETY: JavaScript is single-threaded; idle callbacks never run
// concurrently with animation frames.  No locking is needed.

const _prewarmWallCaches  = new Map<string, RoomChunkCache>();
const _prewarmWallLayouts = new Map<string, CachedWallLayout>();

/** Dummy 1×1 canvas used as a throw-away blit target during prewarming. */
let _prewarmDummyCtx: CanvasRenderingContext2D | null = null;

// ── Internal accessors (used only by blockSpriteRenderer.ts) ──────────────

export function getPrewarmWallLayout(roomId: string): CachedWallLayout | undefined {
  return _prewarmWallLayouts.get(roomId);
}

export function setPrewarmWallLayout(roomId: string, layout: CachedWallLayout): void {
  _prewarmWallLayouts.set(roomId, layout);
}

export function getPrewarmWallCache(roomId: string): RoomChunkCache | undefined {
  return _prewarmWallCaches.get(roomId);
}

/** Returns the existing prewarm cache for `roomId`, or creates and stores a new one. */
export function getOrCreatePrewarmWallCache(roomId: string): RoomChunkCache {
  let cache = _prewarmWallCaches.get(roomId);
  if (cache === undefined) {
    cache = new RoomChunkCache();
    _prewarmWallCaches.set(roomId, cache);
  }
  return cache;
}

/** Deletes the prewarm cache and layout for `roomId`. */
export function deletePrewarmEntry(roomId: string): void {
  _prewarmWallCaches.delete(roomId);
  _prewarmWallLayouts.delete(roomId);
}

/** Returns the shared dummy 1×1 canvas context used as a blit target during prewarming. */
export function getPrewarmDummyCtx(): CanvasRenderingContext2D {
  if (_prewarmDummyCtx === null) {
    const c = document.createElement('canvas');
    c.width  = 1;
    c.height = 1;
    _prewarmDummyCtx = c.getContext('2d') as CanvasRenderingContext2D;
  }
  return _prewarmDummyCtx;
}

// ── Public management API (re-exported from blockSpriteRenderer.ts) ────────

/** Discards pre-warmed wall chunks for `roomId` without adopting them. */
export function evictPrewarmedWallChunks(roomId: string): void {
  _prewarmWallCaches.delete(roomId);
  _prewarmWallLayouts.delete(roomId);
}

/** Returns `true` when pre-warmed wall data exists for `roomId`. */
export function hasPrewarmedWallChunks(roomId: string): boolean {
  return _prewarmWallCaches.has(roomId);
}

/** Returns the list of room IDs that currently have pre-warmed wall chunks. */
export function listPrewarmedWallRoomIds(): string[] {
  return Array.from(_prewarmWallCaches.keys());
}

/**
 * Returns per-room prewarm wall stats for `roomId`, or `null` when not held.
 * Used by the eviction pass to compute per-room memory.
 */
export function getPrewarmWallRoomStats(roomId: string): { chunks: number; memoryKB: number } | null {
  const cache = _prewarmWallCaches.get(roomId);
  if (cache === undefined) return null;
  return { chunks: cache.stats.totalChunkCount, memoryKB: cache.stats.memoryEstimateKB };
}

/**
 * Returns aggregate stats across all currently-held prewarm caches.
 * Used by the debug overlay.
 */
export function getPrewarmWallStats(): { roomCount: number; totalChunks: number; memoryEstimateKB: number } {
  let totalChunks = 0;
  let memoryEstimateKB = 0;
  for (const cache of _prewarmWallCaches.values()) {
    totalChunks      += cache.stats.totalChunkCount;
    memoryEstimateKB += cache.stats.memoryEstimateKB;
  }
  return { roomCount: _prewarmWallCaches.size, totalChunks, memoryEstimateKB };
}
