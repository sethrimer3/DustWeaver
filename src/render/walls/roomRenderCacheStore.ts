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
 * object.  Note: adoption is staged (wall then bg) in two separate calls — it
 * is NOT truly atomic.  A torn read is unlikely in practice because both calls
 * occur in the same synchronous transition sequence, but callers should treat
 * wall and background availability independently.
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

/**
 * Structured result returned by `adoptPrewarmedWallChunks` and
 * `adoptPrewarmedBgChunks`.  Callers that only need a boolean can check
 * `result.status === 'adopted'`; diagnostic paths can inspect the full reason.
 *
 *  - `adopted`           — snapshot found, key matched, chunks injected.
 *  - `empty`             — snapshot found, key matched, but zero clean chunks were extracted.
 *  - `missing`           — no prewarm snapshot/cache existed for this room.
 *  - `staleRenderState`  — snapshot existed but its key did not match the current render state.
 */
export type PrewarmAdoptResult =
  | { status: 'adopted';          chunks: number }
  | { status: 'empty' }
  | { status: 'missing' }
  | { status: 'staleRenderState'; snapshotKey: string; currentKey: string };

// ── Store ─────────────────────────────────────────────────────────────────────

/** One snapshot per room (keyed by roomId). */
const _snapshots = new Map<string, RoomRenderSnapshot>();

// ── Key computation ───────────────────────────────────────────────────────────

/**
 * Computes a stable render-state key from all fields that affect baked wall
 * and background chunk visuals.
 *
 * Called both at prewarm time (from `WallPrewarmContext`) and at adoption time
 * so that stale snapshots can be detected.
 *
 * Numbers are rounded to 4 decimal places before stringification so that
 * floating-point noise from independent re-computations produces identical keys.
 */
/**
 * Computes a stable render-state key from all fields that affect baked wall
 * and background chunk visuals.
 *
 * Called both at prewarm time (from `WallPrewarmContext`) and at adoption time
 * so that stale snapshots can be detected.
 *
 * Numbers are rounded to 4 decimal places before stringification so that
 * floating-point noise from independent re-computations produces identical keys.
 *
 * Memoization (BUILD 428): the result is cached on the `blockerKeys` Set
 * identity via a `WeakMap`.  When the same `blockerKeys` Set is passed in
 * with identical primitive parameters, the cached string is returned without
 * re-sorting/re-joining the Set entries.  `RoomDef.ambientLightBlockers` is
 * rebuilt only when the room is reloaded, so the Set identity is stable across
 * the many per-tick callers (entry-warm probes, render passes) that ask for the
 * current key on the same room.
 */
interface _RenderKeyCacheEntry {
  paramsSig: string;
  key:       string;
}
const _renderKeyCache = new WeakMap<ReadonlySet<string>, _RenderKeyCacheEntry>();
// Distinct empty-set sentinel so callers that pass `new Set()` each call still
// benefit from the cache (their args still match the empty paramsSig).
const _EMPTY_BLOCKER_SET: ReadonlySet<string> = new Set();

export function computeRenderStateKey(
  blockTheme: string | null,
  worldNumber: number,
  lightingEffect: string,
  ambientDirection: string,
  seamBlending: string,
  blockerKeys: ReadonlySet<string>,
  roomWidthBlocks: number,
  roomHeightBlocks: number,
  directionalBias: number,
  sideExposureStrength: number,
  minimumWallLight: number,
  falloffPower: number,
  backgroundLightSpill: number,
  solidLightSoftness: number,
): string {
  const themeOrWorld = blockTheme !== null ? blockTheme : `w${worldNumber}`;
  // Normalise floats to 4 dp so independent re-computations produce identical keys.
  const n = (v: number) => v.toFixed(4);
  // Build the param-only signature first so we can use it as the cache discriminator.
  const paramsSig =
    `${themeOrWorld}|${lightingEffect}|${ambientDirection}|${seamBlending}` +
    `|${roomWidthBlocks}x${roomHeightBlocks}` +
    `|db${n(directionalBias)}_se${n(sideExposureStrength)}_ml${n(minimumWallLight)}` +
    `_fp${n(falloffPower)}_bs${n(backgroundLightSpill)}_ss${n(solidLightSoftness)}`;

  // Empty-blocker fast path: stable cache key independent of Set identity.
  const cacheKey: ReadonlySet<string> = blockerKeys.size === 0 ? _EMPTY_BLOCKER_SET : blockerKeys;
  const cached = _renderKeyCache.get(cacheKey);
  if (cached !== undefined && cached.paramsSig === paramsSig) {
    return cached.key;
  }

  let blockerSig: string;
  if (blockerKeys.size === 0) {
    blockerSig = '';
  } else {
    const arr: string[] = [];
    for (const k of blockerKeys) arr.push(k);
    arr.sort();
    blockerSig = arr.join(';');
  }
  const key =
    `${themeOrWorld}|${lightingEffect}|${ambientDirection}|${seamBlending}|${blockerSig}` +
    `|${roomWidthBlocks}x${roomHeightBlocks}` +
    `|db${n(directionalBias)}_se${n(sideExposureStrength)}_ml${n(minimumWallLight)}` +
    `_fp${n(falloffPower)}_bs${n(backgroundLightSpill)}_ss${n(solidLightSoftness)}`;
  _renderKeyCache.set(cacheKey, { paramsSig, key });
  return key;
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
  if (cache == null) return null;
  return { chunks: cache.stats.totalChunkCount, memoryKB: cache.stats.memoryEstimateKB };
}

/** Per-room bg prewarm stats, or `null` when not held. */
export function getSnapshotBgRoomStats(roomId: string): { chunks: number; memoryKB: number } | null {
  const cache = _snapshots.get(roomId)?.bgCache;
  if (cache == null) return null;
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
