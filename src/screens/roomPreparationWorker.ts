/**
 * roomPreparationWorker.ts — Off-main-thread room preparation worker.
 *
 * Receives a plain-object RoomDef via `postMessage`, runs the three expensive
 * build passes on a background thread, and posts back a serialised result
 * whose typed-array fields are **transferred** (zero-copy) rather than copied.
 *
 * Build passes executed here (same as `buildPreparedRoomRuntime` on main thread):
 *  1. `buildRoomWallTemplate`    — iterative O(n²) wall-merge pass
 *  2. `buildEdgeExtensionCache`  — BFS over expanded occupancy grid
 *  3. ambient-light blocker sets — two Set<string> from room metadata
 *  4. `buildRoomDecorations`     — pure geometry conversion
 *
 * This worker is created lazily in `roomPreloadScheduler.ts` and reused for
 * the lifetime of the game session.  Communication is strictly request/response:
 * one inbound message per room → one outbound message per room.
 *
 * No DOM APIs are called.  `performance.now()` is available in all worker
 * environments and is used only for per-step timing diagnostics.
 *
 * BUILD 387
 */

// Minimal interface for the dedicated-worker global scope.
// The project's tsconfig includes DOM (not webworker) libs, so we cast `self`
// to avoid a missing-type error while still getting correct postMessage
// signatures for the two-argument (message, transfer) overload.
interface _WorkerCtx {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
  postMessage(message: unknown): void;
}
const _self = self as unknown as _WorkerCtx;

import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import { buildRoomWallTemplate } from './gameRoomWalls';
import { buildEdgeExtensionCache } from '../render/transitions/edgeExtensionCache';
import { buildRoomDecorations } from '../render/effects/decorationWaveState';
import type {
  SerializedWallTemplate,
  SerializedEdgeExtension,
  WorkerOutboundMessage,
} from './roomPreparationWorkerProtocol';

// ── Message handler ───────────────────────────────────────────────────────────

_self.onmessage = (event: MessageEvent<unknown>) => {
  const { roomId, room } = event.data as { roomId: string; room: RoomDef };

  try {
    // ── 1. Wall template (O(n²) merge pass) ──────────────────────────────
    const t0Wall = performance.now();
    const wt = buildRoomWallTemplate(room);
    const wallMs = performance.now() - t0Wall;

    // ── 2. Edge extension (BFS over expanded grid) ────────────────────────
    const t0Edge = performance.now();
    const ee = buildEdgeExtensionCache(room);
    const edgeMs = performance.now() - t0Edge;

    // ── 3. Ambient-light blocker sets ─────────────────────────────────────
    // Mirrors the logic in buildPreparedRoomRuntime exactly.
    const t0Blocker = performance.now();
    let blockerSet: Set<string> | undefined;
    let darkBlockerSet: Set<string> | undefined;

    if (room.ambientLightBlockers && room.ambientLightBlockers.length > 0) {
      blockerSet = new Set<string>();
      for (const b of room.ambientLightBlockers) {
        const key = `${b.xBlock},${b.yBlock}`;
        blockerSet.add(key);
        if (b.isDark) {
          if (!darkBlockerSet) darkBlockerSet = new Set<string>();
          darkBlockerSet.add(key);
        }
      }
    }
    if (room.backgroundBlocks) {
      for (const b of room.backgroundBlocks) {
        if (b.isLightBlockingFlag !== 1) continue;
        if (!blockerSet) blockerSet = new Set<string>();
        for (let dy = 0; dy < b.hBlock; dy++) {
          for (let dx = 0; dx < b.wBlock; dx++) {
            blockerSet.add(`${b.xBlock + dx},${b.yBlock + dy}`);
          }
        }
      }
    }
    const blockerMs = performance.now() - t0Blocker;

    // ── 4. Wall decorations (pure geometry) ───────────────────────────────
    const t0Decor = performance.now();
    const wallDecorations = buildRoomDecorations(room.decorations ?? [], BLOCK_SIZE_SMALL);
    const decorMs = performance.now() - t0Decor;

    // ── Serialise wall template — transfer typed-array ArrayBuffers ───────
    // Each typed array in RoomWallTemplate has its own backing ArrayBuffer
    // (created independently in buildRoomWallTemplate).  Listing them in the
    // transfer list means the main thread receives the data without a copy.
    // Cast to ArrayBuffer: typed arrays created with `new Float32Array(n)`
    // always back onto an ArrayBuffer (never SharedArrayBuffer).
    const serialisedWt: SerializedWallTemplate = {
      wallCount: wt.wallCount,
      xWorld: wt.xWorld.buffer as ArrayBuffer,
      yWorld: wt.yWorld.buffer as ArrayBuffer,
      wWorld: wt.wWorld.buffer as ArrayBuffer,
      hWorld: wt.hWorld.buffer as ArrayBuffer,
      isPlatformFlag: wt.isPlatformFlag.buffer as ArrayBuffer,
      platformEdge: wt.platformEdge.buffer as ArrayBuffer,
      themeIndex: wt.themeIndex.buffer as ArrayBuffer,
      soundHardnessIndex: wt.soundHardnessIndex.buffer as ArrayBuffer,
      isInvisibleFlag: wt.isInvisibleFlag.buffer as ArrayBuffer,
      rampOrientationIndex: wt.rampOrientationIndex.buffer as ArrayBuffer,
      isPillarHalfWidthFlag: wt.isPillarHalfWidthFlag.buffer as ArrayBuffer,
      isIceFlag: wt.isIceFlag.buffer as ArrayBuffer,
    };

    // ── Serialise edge extension ──────────────────────────────────────────
    const serialisedEe: SerializedEdgeExtension = {
      roomId: ee.roomId,
      // tiles is readonly EdgeExtensionTile[] — plain objects, clone cleanly.
      tiles: ee.tiles as SerializedEdgeExtension['tiles'],
      occupancyKeys: Array.from(ee.occupancySet),
    };

    // ── Wire encoding for blocker sets ─────────────────────────────────────
    // null  = "built; room has no blockers"  (main thread stores as undefined)
    // array = "built; these are the blocker keys"
    const blockerKeys: string[] | null =
      blockerSet !== undefined ? Array.from(blockerSet) : null;
    const darkBlockerKeys: string[] | null =
      darkBlockerSet !== undefined ? Array.from(darkBlockerSet) : null;

    const msg: WorkerOutboundMessage = {
      roomId,
      wallTemplate: serialisedWt,
      edgeExtension: serialisedEe,
      blockerKeys,
      darkBlockerKeys,
      wallDecorations,
      wallMs,
      edgeMs,
      blockerMs,
      decorMs,
      totalMs: wallMs + edgeMs + blockerMs + decorMs,
    };

    // Transfer all typed-array backing buffers (zero-copy).
    const transfer: Transferable[] = [
      serialisedWt.xWorld,
      serialisedWt.yWorld,
      serialisedWt.wWorld,
      serialisedWt.hWorld,
      serialisedWt.isPlatformFlag,
      serialisedWt.platformEdge,
      serialisedWt.themeIndex,
      serialisedWt.soundHardnessIndex,
      serialisedWt.isInvisibleFlag,
      serialisedWt.rampOrientationIndex,
      serialisedWt.isPillarHalfWidthFlag,
      serialisedWt.isIceFlag,
    ];

    _self.postMessage(msg, transfer);

  } catch (err) {
    // Post an error message so the main thread can fall back to synchronous build.
    const errorMsg: WorkerOutboundMessage = { roomId, error: String(err) };
    _self.postMessage(errorMsg);
  }
};
