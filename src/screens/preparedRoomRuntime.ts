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
 * BUILD 388
 */

import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { buildRoomWallTemplate } from './gameRoomWalls';
import { buildRoomDecorations } from '../render/effects/wallDecorations';
import type { RoomRuntimeEntry } from './roomRuntimeCache';
import type { RoomRuntimeCache } from './roomRuntimeCache';
import { ROOM_REGISTRY } from '../levels/rooms';

// ── PreparedRoomResult ────────────────────────────────────────────────────────

/**
 * Result of `buildPreparedRoomRuntime`, bundling the entry with per-step
 * timing data so callers can log structured performance reports.
 */
export interface PreparedRoomResult {
  runtimeEntry: RoomRuntimeEntry;
  /** Wall template (O(n²) merge pass) build time in ms. */
  wallMs: number;
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
 *  - `wallTemplate`      — merged wall geometry (O(n²) merge pass)
 *  - `blockerKeys`       — ambient-light blocker `Set<string>`
 *  - `darkBlockerKeys`   — dark-ambient blocker `Set<string>`
 *  - `wallDecorations`   — static decoration geometry array
 *
 * Edge-extension cache is not built here (legacy feature, disabled).
 * Safe to call from any context (no DOM, no mutable world state, no RNG).
 */
export function buildPreparedRoomRuntime(room: RoomDef): PreparedRoomResult {
  // ── Wall template (O(n²) merge pass) ─────────────────────────────────────
  const t0Wall = performance.now();
  const wallTemplate = buildRoomWallTemplate(room);
  const wallMs = performance.now() - t0Wall;

  // ── Ambient light blocker sets ────────────────────────────────────────────
  const t0Blocker = performance.now();
  let blockerKeys: Set<string> | undefined;
  let darkBlockerKeys: Set<string> | undefined;

  if (room.ambientLightBlockers && room.ambientLightBlockers.length > 0) {
    blockerKeys = new Set<string>();
    for (const b of room.ambientLightBlockers) {
      const key = `${b.xBlock},${b.yBlock}`;
      blockerKeys.add(key);
      if (b.isDark) {
        if (!darkBlockerKeys) darkBlockerKeys = new Set<string>();
        darkBlockerKeys.add(key);
      }
    }
  }
  if (room.backgroundBlocks) {
    for (const b of room.backgroundBlocks) {
      if (b.isLightBlockingFlag !== 1) continue;
      if (!blockerKeys) blockerKeys = new Set<string>();
      for (let dy = 0; dy < b.hBlock; dy++) {
        for (let dx = 0; dx < b.wBlock; dx++) {
          blockerKeys.add(`${b.xBlock + dx},${b.yBlock + dy}`);
        }
      }
    }
  }
  const blockerMs = performance.now() - t0Blocker;

  // ── Wall decorations (pure geometry, no mutable state) ────────────────────
  const t0Decor = performance.now();
  const wallDecorations = buildRoomDecorations(room.decorations ?? [], BLOCK_SIZE_SMALL);
  const decorMs = performance.now() - t0Decor;

  const totalMs = wallMs + blockerMs + decorMs;

  return {
    runtimeEntry: {
      wallTemplate,
      edgeExtension: null,
      blockerKeys,
      darkBlockerKeys,
      wallDecorations,
    },
    wallMs,
    blockerMs,
    decorMs,
    totalMs,
  };
}

// ── ensureRoomPrepared ────────────────────────────────────────────────────────

/**
 * Immediately builds and caches a `PreparedRoomRuntime` for `roomId` if it is
 * not already in the cache.  Called as an urgent fallback when the player is
 * close to a transition and the preload scheduler has not yet processed that
 * room.
 *
 * Idempotent: a no-op if the room is already cached.
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
