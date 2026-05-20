/**
 * preparedRoomRuntime.ts — Builds all static/pure per-room data that can be
 * computed once and cached, enabling instant (or fast-async) room transitions.
 *
 * All data produced here is referentially transparent with respect to the room
 * definition: same `RoomDef` → same output.  Nothing here touches mutable
 * world state (enemies, hazards, particles, falling blocks) — those are reset
 * per-visit in `_makeLoadRoomPhases()` phases B-E and are never cached.
 *
 * BUILD 368
 */

import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { buildRoomWallTemplate } from './gameRoomWalls';
import { buildEdgeExtensionCache } from '../render/transitions/edgeExtensionCache';
import { buildRoomDecorations } from '../render/effects/wallDecorations';
import type { RoomRuntimeEntry } from './roomRuntimeCache';
import type { RoomRuntimeCache } from './roomRuntimeCache';
import { ROOM_REGISTRY } from '../levels/rooms';

// ── buildPreparedRoomRuntime ──────────────────────────────────────────────────

/**
 * Builds a fully prepared `RoomRuntimeEntry` for the given room.
 *
 * Includes:
 *  - `wallTemplate`      — merged wall geometry (O(n²) merge pass)
 *  - `edgeExtension`     — edge-strip tile cache (BFS over expanded grid)
 *  - `blockerKeys`       — ambient-light blocker `Set<string>`
 *  - `darkBlockerKeys`   — dark-ambient blocker `Set<string>`
 *  - `wallDecorations`   — static decoration geometry array
 *
 * Safe to call from any context (no DOM, no mutable world state, no RNG).
 */
export function buildPreparedRoomRuntime(room: RoomDef): RoomRuntimeEntry {
  // ── Wall template (O(n²) merge pass) ─────────────────────────────────────
  const wallTemplate = buildRoomWallTemplate(room);

  // ── Edge extension (BFS over expanded grid) ───────────────────────────────
  const edgeExtension = buildEdgeExtensionCache(room);

  // ── Ambient light blocker sets ────────────────────────────────────────────
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

  // ── Wall decorations (pure geometry, no mutable state) ────────────────────
  const wallDecorations = buildRoomDecorations(room.decorations ?? [], BLOCK_SIZE_SMALL);

  return {
    wallTemplate,
    edgeExtension,
    blockerKeys,
    darkBlockerKeys,
    wallDecorations,
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
  const prepared = buildPreparedRoomRuntime(room);
  cache.set(roomId, prepared);

  if (isDebugMode) {
    console.log(
      `[preload:urgent] ${roomId} prepared in ${(performance.now() - t0).toFixed(1)}ms`,
    );
  }
}
