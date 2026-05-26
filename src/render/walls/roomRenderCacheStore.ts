/**
 * roomRenderCacheStore.ts — Isolated per-room render-state snapshot store.
 *
 * Holds wall and background pre-warm data for rooms that have not yet been
 * entered, keyed by roomId.  Each snapshot carries a `renderStateKey` that
 * encodes the rendering configuration (theme, lighting, blocker set) used when
 * the snapshot was built.  When the idle-time prewarm scheduler attempts to
 * build chunks for a room and finds a stale key, it evicts the old snapshot
 * and starts a fresh one — providing automatic invalidation on theme or
 * lighting changes.
 *
 * Wall and background caches are stored together in one `RoomRenderSnapshot`
 * object, enabling a clean atomic handoff on room entry.
 *
 * Individual cache types (wall vs bg) can be cleared independently: wall data
 * is cleared after `adoptPrewarmedWallChunks`, and bg data after
 * `adoptPrewarmedBgChunks`.  The snapshot is removed from the store once all
 * three fields (wallCache, wallLayout, bgCache) are null.
 *
 * BUILD 411
 */

import { RoomChunkCache } from './chunkRenderCache';
import type { CachedWallLayout } from './blockWallLayoutCache';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RoomRenderSnapshot {
  readonly roomId: string;
  /** Opaque key encoding theme + lighting + blocker set at build time. */
  renderStateKey: string;
  /** Pre-built wall chunk canvases; null until wall prewarm runs. */
  wallCache: RoomChunkCache | null;
  /** Pre-built wall layout (shared identity object); null until wall prewarm runs. */
  wallLayout: CachedWallLayout | null;
  /** Pre-built background chunk canvases; null until bg prewarm runs. */
  bgCache: RoomChunkCache | null;
}

// ── Store ─────────────────────────────────────────────────────────────────────

/** One snapshot per room (keyed by roomId). */
const _snapshots = new Map<string, RoomRenderSnapshot>();

// ── Key computation ───────────────────────────────────────────────────────────

/**
 * Computes a stable render-state key from the fields that affect wall rendering.
 *
 * Called both at prewarm time (from `WallPrewarmContext`) and at adoption time
 * so that stale snapshots can be detected.
 */
export function computeRenderStateKey(
  blockTheme: string | null,
  worldNumber: number,
  lightingEffect: string,
  ambientDirection: string,
  seamBlending: string,
  blockerKeys: ReadonlySet<string>,
): string {
  const themeOrWorld = blockTheme !== null ? blockTheme : `w${worldNumber}`;
  let blockerSig: string;
  if (blockerKeys.size === 0) {
    blockerSig = '';
  } else {
    const arr: string[] = [];
    for (const k of blockerKeys) arr.push(k);
    arr.sort();
    blockerSig = arr.join(';');
  }
  return `${themeOrWorld}|${lightingEffect}|${ambientDirection}|${seamBlending}|${blockerSig}`;
}

// ── Snapshot lifecycle ────────────────────────────────────────────────────────

/**
 * Returns the existing snapshot for `roomId` if it matches `renderStateKey`,
 * or creates a new empty snapshot (evicting any stale one).
 */
export function getOrCreateSnapshot(roomId: string, renderStateKey: string): RoomRenderSnapshot {
  const existing = _snapshots.get(roomId);
  if (existing !== undefined) {
    if (existing.renderStateKey === renderStateKey) {
      return existing;
    }
    // Key changed (e.g. theme/lighting edit) — discard stale snapshot.
    _snapshots.delete(roomId);
  }
  const snap: RoomRenderSnapshot = {
    roomId,
    renderStateKey,
    wallCache:  null,
    wallLayout: null,
    bgCache:    null,
  };
  _snapshots.set(roomId, snap);
  return snap;
}

/** Returns the snapshot for `roomId`, or `undefined` if not held. */
export function getSnapshot(roomId: string): RoomRenderSnapshot | undefined {
  return _snapshots.get(roomId);
}

/**
 * Clears wall cache and layout for `roomId`, leaving the bg cache intact.
 * Called after wall-chunk adoption so the bg can still be found and adopted.
 * Removes the snapshot from the store once all fields are null.
 */
export function clearSnapshotWallData(roomId: string): void {
  const snap = _snapshots.get(roomId);
  if (snap === undefined) return;
  snap.wallCache  = null;
  snap.wallLayout = null;
  _cleanupIfEmpty(snap, roomId);
}

/**
 * Clears the bg cache for `roomId`, leaving wall data intact.
 * Called after bg-chunk adoption (or bg eviction).
 * Removes the snapshot from the store once all fields are null.
 */
export function clearSnapshotBgData(roomId: string): void {
  const snap = _snapshots.get(roomId);
  if (snap === undefined) return;
  snap.bgCache = null;
  _cleanupIfEmpty(snap, roomId);
}

function _cleanupIfEmpty(snap: RoomRenderSnapshot, roomId: string): void {
  if (snap.wallCache === null && snap.wallLayout === null && snap.bgCache === null) {
    _snapshots.delete(roomId);
  }
}

// ── Predicate helpers ─────────────────────────────────────────────────────────

export function hasWallPrewarmData(roomId: string): boolean {
  return (_snapshots.get(roomId)?.wallCache ?? null) !== null;
}

export function hasBgPrewarmData(roomId: string): boolean {
  return (_snapshots.get(roomId)?.bgCache ?? null) !== null;
}

export function listWallPrewarmRoomIds(): string[] {
  const ids: string[] = [];
  for (const [id, snap] of _snapshots) {
    if (snap.wallCache !== null) ids.push(id);
  }
  return ids;
}

export function listBgPrewarmRoomIds(): string[] {
  const ids: string[] = [];
  for (const [id, snap] of _snapshots) {
    if (snap.bgCache !== null) ids.push(id);
  }
  return ids;
}

// ── Stats ─────────────────────────────────────────────────────────────────────

/** Per-room wall prewarm stats, or `null` when not held. */
export function getSnapshotWallRoomStats(roomId: string): { chunks: number; memoryKB: number } | null {
  const cache = _snapshots.get(roomId)?.wallCache;
  if (cache === undefined || cache === null) return null;
  return { chunks: cache.stats.totalChunkCount, memoryKB: cache.stats.memoryEstimateKB };
}

/** Per-room bg prewarm stats, or `null` when not held. */
export function getSnapshotBgRoomStats(roomId: string): { chunks: number; memoryKB: number } | null {
  const cache = _snapshots.get(roomId)?.bgCache;
  if (cache === undefined || cache === null) return null;
  return { chunks: cache.stats.totalChunkCount, memoryKB: cache.stats.memoryEstimateKB };
}

/** Aggregate wall prewarm stats across all held snapshots. */
export function getAggregateWallStats(): { roomCount: number; totalChunks: number; memoryEstimateKB: number } {
  let totalChunks = 0;
  let memoryEstimateKB = 0;
  let roomCount = 0;
  for (const snap of _snapshots.values()) {
    if (snap.wallCache !== null) {
      roomCount++;
      totalChunks      += snap.wallCache.stats.totalChunkCount;
      memoryEstimateKB += snap.wallCache.stats.memoryEstimateKB;
    }
  }
  return { roomCount, totalChunks, memoryEstimateKB };
}

/** Aggregate bg prewarm stats across all held snapshots. */
export function getAggregateBgStats(): { roomCount: number; totalChunks: number; memoryEstimateKB: number } {
  let totalChunks = 0;
  let memoryEstimateKB = 0;
  let roomCount = 0;
  for (const snap of _snapshots.values()) {
    if (snap.bgCache !== null) {
      roomCount++;
      totalChunks      += snap.bgCache.stats.totalChunkCount;
      memoryEstimateKB += snap.bgCache.stats.memoryEstimateKB;
    }
  }
  return { roomCount, totalChunks, memoryEstimateKB };
}

// ── Dummy canvas contexts ─────────────────────────────────────────────────────

/** Shared 1×1 canvas used as a throw-away blit target during wall prewarming. */
let _wallPrewarmDummyCtx: CanvasRenderingContext2D | null = null;

export function getPrewarmDummyCtx(): CanvasRenderingContext2D {
  if (_wallPrewarmDummyCtx === null) {
    const c = document.createElement('canvas');
    c.width  = 1;
    c.height = 1;
    _wallPrewarmDummyCtx = c.getContext('2d') as CanvasRenderingContext2D;
  }
  return _wallPrewarmDummyCtx;
}

/** Shared 1×1 canvas used as a throw-away blit target during bg prewarming. */
let _bgPrewarmDummyCtx: CanvasRenderingContext2D | null = null;

export function getBgPrewarmDummyCtx(): CanvasRenderingContext2D {
  if (_bgPrewarmDummyCtx === null) {
    const c = document.createElement('canvas');
    c.width  = 1;
    c.height = 1;
    _bgPrewarmDummyCtx = c.getContext('2d') as CanvasRenderingContext2D;
  }
  return _bgPrewarmDummyCtx;
}
