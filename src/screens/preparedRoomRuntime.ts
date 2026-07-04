/**
 * preparedRoomRuntime.ts — Builds all static/pure per-room data that can be
 * computed once and cached, enabling instant (or fast-async) room transitions.
 *
 * All data produced here is referentially transparent with respect to the room
 * definition: same `RoomDef` → same output.  Nothing here touches mutable
 * world state (enemies, hazards, particles, falling blocks) — those are reset
 * per-visit in `_makeLoadRoomPhases()` phases B-E and are never cached.
 *
 * Edge-extension cache building is intentionally excluded — that feature is
 * legacy-only.  See src/render/transitions/legacy/README.md for details.
 *
 * BUILD 420
 */

import type { RoomDef, RoomWallTemplate } from '../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { buildRoomWallTemplate } from './gameRoomWalls';
import { buildRoomAmbientBlockerKeys } from '../levels/roomAmbientBlockers';
import { buildRoomDecorations } from '../render/effects/wallDecorations';
import type { RoomRuntimeEntry } from './roomRuntimeCache';
import type { RoomRuntimeCache } from './roomRuntimeCache';
import { ROOM_REGISTRY } from '../levels/rooms';

// ── WallTemplateResolution ────────────────────────────────────────────────────

/** Source of a resolved wall template. */
export type WallTemplateSource = 'cache' | 'baked' | 'fallback';

/**
 * Result of `resolveRoomWallTemplate`, bundling the template with its source
 * and the time taken.  Source helps diagnostics distinguish cheap baked/cache
 * paths from expensive fallback builds.
 */
export interface WallTemplateResolution {
  template: RoomWallTemplate;
  /** Where the template came from: runtime cache, pre-baked JSON data, or runtime build. */
  source: WallTemplateSource;
  /** Time in ms.  Near-zero for cache/baked; actual build time for fallback. */
  buildMs: number;
}

// ── DEV aggregate diagnostics ─────────────────────────────────────────────────

/** Counters tracking wall-template source distribution across all resolution calls. */
interface _WallDiagState {
  cacheHits: number;
  bakedHits: number;
  fallbackBuilds: number;
  totalFallbackMs: number;
  slowestFallbacks: Array<{ roomId: string; ms: number }>;
}

const _MAX_SLOWEST = 5;

const _diag: _WallDiagState = {
  cacheHits:       0,
  bakedHits:       0,
  fallbackBuilds:  0,
  totalFallbackMs: 0,
  slowestFallbacks: [],
};

function _recordFallback(roomId: string, ms: number): void {
  _diag.fallbackBuilds++;
  _diag.totalFallbackMs += ms;
  _diag.slowestFallbacks.push({ roomId, ms });
  _diag.slowestFallbacks.sort((a, b) => b.ms - a.ms);
  if (_diag.slowestFallbacks.length > _MAX_SLOWEST) {
    _diag.slowestFallbacks.length = _MAX_SLOWEST;
  }
}

/**
 * Returns a snapshot of aggregate wall-template resolution diagnostics.
 * Includes baked hits, cache hits, fallback builds, and timing.
 * Only meaningful in DEV; in production all counters remain 0.
 */
export function getWallTemplateDiagnostics(): Readonly<_WallDiagState> {
  return { ..._diag, slowestFallbacks: [..._diag.slowestFallbacks] };
}

/** Resets the aggregate counters (e.g. after logging a startup summary). */
export function resetWallTemplateDiagnostics(): void {
  _diag.cacheHits       = 0;
  _diag.bakedHits       = 0;
  _diag.fallbackBuilds  = 0;
  _diag.totalFallbackMs = 0;
  _diag.slowestFallbacks.length = 0;
}

/**
 * Logs a one-line DEV aggregate of wall-template resolution stats to the
 * console.  Call after initial resident builds complete to see how many rooms
 * used baked data vs. required a full merge pass.
 */
export function logWallTemplateDiagnosticsSummary(label = 'startup'): void {
  if (!import.meta.env.DEV) return;
  const d = _diag;
  const total = d.cacheHits + d.bakedHits + d.fallbackBuilds;
  const slowStr = d.slowestFallbacks
    .map(r => `${r.roomId}(${r.ms.toFixed(0)}ms)`)
    .join(', ');
  console.log(
    `[wallTemplate:${label}] total=${total}` +
    ` cache=${d.cacheHits} baked=${d.bakedHits} fallback=${d.fallbackBuilds}` +
    ` fallbackMs=${d.totalFallbackMs.toFixed(1)}` +
    (slowStr ? ` slowest=[${slowStr}]` : ''),
  );
}

// ── resolveRoomWallTemplate ───────────────────────────────────────────────────

/**
 * Central wall-template resolution helper.  Used by all main-thread paths so
 * they stay in sync and diagnostics are aggregated in one place.
 *
 * Priority:
 *  1. `cache`  — if provided and the room is already prepared (fastest path).
 *  2. `baked`  — if `room.bakedWallTemplate` is present (skip merge pass).
 *  3. fallback — calls `buildRoomWallTemplate(room)` (O(n²) merge pass).
 *
 * When a baked or fallback template is resolved and `cache` is provided, the
 * template is stored in the cache so subsequent callers get a cache hit.
 *
 * @param room   The room definition.
 * @param cache  Optional runtime cache.  Pass `undefined` when unavailable.
 * @returns      Resolution result including the template, its source, and timing.
 */
export function resolveRoomWallTemplate(
  room: RoomDef,
  cache?: RoomRuntimeCache,
): WallTemplateResolution {
  // 1. Runtime cache (fastest — already merged and stored).
  if (cache !== undefined) {
    const cacheEntry = cache.get(room.id);
    if (cacheEntry !== undefined) {
      if (import.meta.env.DEV) _diag.cacheHits++;
      return { template: cacheEntry.wallTemplate, source: 'cache', buildMs: 0 };
    }
  }

  // 2. Pre-baked template from JSON (skip the O(n²) merge pass entirely).
  if (room.bakedWallTemplate !== undefined) {
    if (cache !== undefined) {
      cache.set(room.id, {
        wallTemplate: room.bakedWallTemplate,
        edgeExtension:   null,
        blockerKeys:     null,
        darkBlockerKeys: null,
        wallDecorations: null,
      });
    }
    if (import.meta.env.DEV) _diag.bakedHits++;
    return { template: room.bakedWallTemplate, source: 'baked', buildMs: 0 };
  }

  // 3. Fallback: run the full O(n²) merge pass.
  const t0 = performance.now();
  const template = buildRoomWallTemplate(room);
  const buildMs = performance.now() - t0;
  if (cache !== undefined) {
    cache.set(room.id, {
      wallTemplate: template,
      edgeExtension:   null,
      blockerKeys:     null,
      darkBlockerKeys: null,
      wallDecorations: null,
    });
  }
  if (import.meta.env.DEV) _recordFallback(room.id, buildMs);
  return { template, source: 'fallback', buildMs };
}

// ── PreparedRoomResult ────────────────────────────────────────────────────────

/**
 * Result of `buildPreparedRoomRuntime`, bundling the entry with per-step
 * timing data so callers can log structured performance reports.
 */
export interface PreparedRoomResult {
  runtimeEntry: RoomRuntimeEntry;
  /** Wall template resolution time in ms (near-zero for baked; merge time for fallback). */
  wallMs: number;
  /** Where the wall template came from: 'baked' or 'fallback'.
   *  'cache' is never returned here — this function IS the cache population path. */
  wallSource: 'baked' | 'fallback';
  /** Ambient blocker set construction time in ms. */
  blockerMs: number;
  /** Wall decoration geometry build time in ms. */
  decorMs: number;
  /** Total time in ms (sum of all sub-steps). */
  totalMs: number;
}

// ── buildPreparedRoomRuntime ──────────────────────────────────────────────────

/**
 * Builds a fully prepared `RoomRuntimeEntry` for the given room, returning
 * it alongside per-step timing data for performance diagnostics.
 *
 * Includes:
 *  - `wallTemplate`      — merged wall geometry (uses baked template when present)
 *  - `blockerKeys`       — ambient-light blocker `Set<string>`
 *  - `darkBlockerKeys`   — dark-ambient blocker `Set<string>`
 *  - `wallDecorations`   — static decoration geometry array
 *
 * Wall template priority: baked JSON template → `buildRoomWallTemplate` fallback.
 * (Cache is not consulted here since this function IS the cache population path.)
 *
 * Edge-extension cache is not built here (legacy feature, disabled).
 * Safe to call from any context (no DOM, no mutable world state, no RNG).
 */
export function buildPreparedRoomRuntime(room: RoomDef): PreparedRoomResult {
  // ── Wall template — baked → fallback (cache not consulted; this is cache population) ─
  const wallResolution = resolveRoomWallTemplate(room);
  const wallTemplate = wallResolution.template;

  // ── Ambient light blocker sets ────────────────────────────────────────────
  // Shared builder (see roomAmbientBlockers.ts) so this cache-population path
  // produces byte-identical sets to the room-entry paths in gameLoadRoomPhases.
  // Identical sets → identical render-state key → prewarmed chunks are adopted
  // on entry instead of being discarded as stale and rebuilt.
  const t0Blocker = performance.now();
  const { blockerKeys, darkBlockerKeys } = buildRoomAmbientBlockerKeys(room);
  const blockerMs = performance.now() - t0Blocker;

  // ── Wall decorations (pure geometry, no mutable state) ────────────────────
  const t0Decor = performance.now();
  const wallDecorations = buildRoomDecorations(room.decorations ?? [], BLOCK_SIZE_SMALL);
  const decorMs = performance.now() - t0Decor;

  const totalMs = wallResolution.buildMs + blockerMs + decorMs;

  return {
    runtimeEntry: {
      wallTemplate,
      edgeExtension: null,
      blockerKeys,
      darkBlockerKeys,
      wallDecorations,
    },
    wallMs: wallResolution.buildMs,
    wallSource: wallResolution.source as 'baked' | 'fallback',
    blockerMs,
    decorMs,
    totalMs,
  };
}

// ── ensureRoomPrepared ────────────────────────────────────────────────────────

/**
 * Lightweight room-build cost heuristic, mirroring the one in
 * `roomPreloadScheduler.ts`.  Kept local to avoid circular imports.
 *
 * Returns an estimated main-thread build time in ms.  Used to guard against
 * synchronously building obviously expensive rooms during active gameplay.
 *
 * Rooms with a valid baked wall template skip the O(n²) merge pass, so their
 * wall cost is treated as zero for scheduling purposes.
 */
function _estimateRoomBuildCostMs(room: RoomDef): number {
  // Baked rooms skip the wall-merge pass entirely — treat wall cost as zero.
  let wallCost = 0;
  if (room.bakedWallTemplate === undefined) {
    const wallCount = room.walls?.length ?? 0;
    wallCost = wallCount * 0.04 + wallCount * wallCount * 0.002;
  }
  let bgBlockCount = 0;
  if (room.backgroundBlocks !== undefined) {
    for (let i = 0; i < room.backgroundBlocks.length; i++) {
      const b = room.backgroundBlocks[i];
      bgBlockCount += b.wBlock * b.hBlock;
    }
  }
  const bgCost = bgBlockCount * 0.008;
  const decorCount = room.decorations?.length ?? 0;
  const decorCost = decorCount * 0.3;
  return wallCost + bgCost + decorCost;
}

/**
 * Estimated-cost threshold (ms) above which a room is considered too expensive
 * to build synchronously during active gameplay.  Mirrors `MAX_R1_COST_SYNC_MS`
 * in `roomPreloadScheduler.ts`.
 *
 * Exported so call sites can apply the same threshold consistently without
 * duplicating the constant.
 */
export const SAFE_SYNC_BUILD_COST_MS = 8;

/**
 * Immediately builds and caches a `PreparedRoomRuntime` for `roomId` if it is
 * not already in the cache.  Called as an urgent fallback when the player is
 * close to a transition and the preload scheduler has not yet processed that
 * room.
 *
 * Idempotent: a no-op if the room is already cached.
 *
 * ⚠️  SYNCHRONOUS — this function always builds on the main thread.  Callers
 * must ensure the room is cheap enough to build synchronously.  Use
 * `tryEnsureRoomPreparedIfCheap` when the build cost is unknown.
 */
export function ensureRoomPrepared(
  roomId: string,
  cache: RoomRuntimeCache,
  isDebugMode = false,
): void {
  if (cache.has(roomId)) {
    // Already in cache (possibly partial). If partial, the preloader will fill
    // missing fields in the next idle slot; we do not re-build here to avoid
    // duplicate work in the common path.
    return;
  }
  const room = ROOM_REGISTRY.get(roomId);
  if (room === undefined) return;

  const t0 = isDebugMode ? performance.now() : 0;
  const result = buildPreparedRoomRuntime(room);
  cache.set(roomId, result.runtimeEntry);

  if (isDebugMode) {
    console.log(
      `[preload:urgent] ${roomId} prepared in ${(performance.now() - t0).toFixed(1)}ms`,
    );
  }
}

/**
 * Builds and caches a `PreparedRoomRuntime` for `roomId` only when the
 * estimated main-thread build cost is at or below `maxCostMs`.
 *
 * Use this variant instead of `ensureRoomPrepared` when calling from active
 * gameplay paths where a long synchronous build would freeze the frame.
 *
 * Returns `true` if the room was (or already was) in the cache after the call.
 * Returns `false` if the room was skipped because the estimated cost exceeded
 * `maxCostMs` — the caller should rely on the async loading overlay to cover
 * any resulting cache miss.
 *
 * Idempotent: always returns `true` (without rebuilding) when the room is
 * already in the cache.
 */
export function tryEnsureRoomPreparedIfCheap(
  roomId: string,
  cache: RoomRuntimeCache,
  maxCostMs = SAFE_SYNC_BUILD_COST_MS,
  isDebugMode = false,
): boolean {
  if (cache.has(roomId)) return true;

  const room = ROOM_REGISTRY.get(roomId);
  if (room === undefined) return false;

  const estimatedCostMs = _estimateRoomBuildCostMs(room);
  if (estimatedCostMs > maxCostMs) {
    if (isDebugMode) {
      console.log(
        `[preload:urgent] ${roomId} skipped — estimated ${estimatedCostMs.toFixed(0)}ms ` +
        `exceeds safe threshold (${maxCostMs}ms). Async overlay will cover any cache miss.`,
      );
    }
    return false;
  }

  const t0 = isDebugMode ? performance.now() : 0;
  const result = buildPreparedRoomRuntime(room);
  cache.set(roomId, result.runtimeEntry);

  if (isDebugMode) {
    console.log(
      `[preload:urgent] ${roomId} prepared in ${(performance.now() - t0).toFixed(1)}ms ` +
      `(estimated ${estimatedCostMs.toFixed(0)}ms)`,
    );
  }
  return true;
}
