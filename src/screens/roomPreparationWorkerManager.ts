/**
 * roomPreparationWorkerManager.ts — Web Worker management for async room preparation.
 *
 * A single worker instance is created lazily on the first heavy room dispatch
 * and reused for the lifetime of the game session.  Each room posts one message
 * and receives one reply; there is no per-room worker lifecycle.
 *
 * Pending callbacks are stored by roomId so multiple schedules can coexist:
 * when the worker replies, the result is written to the same shared
 * `RoomRuntimeCache` regardless of which schedule originally dispatched it.
 */

import type { RoomDef } from '../levels/roomDef';
import type { RoomRuntimeCache, RoomRuntimeEntry } from './roomRuntimeCache';
import type { RoomWallTemplate } from './gameRoomWalls';
import type { WallDecoration } from '../render/effects/decorationWaveState';
import type { WorkerOutboundMessage, WorkerSuccessMessage, SerializedWallTemplate } from './roomPreparationWorkerProtocol';

/** Lazily-initialised room preparation worker.  `null` after init failure. */
let _worker: Worker | null | undefined;
/** roomId → callback to call when the worker delivers a result. */
const _workerCallbacks = new Map<string, (entry: RoomRuntimeEntry) => void>();
/** roomIds currently pending with the worker (prevents double-dispatch). */
const _pendingWorkerRoomIds = new Set<string>();

/**
 * Returns the shared worker instance, creating it on first call.
 * Returns `null` if the environment does not support Workers or the worker
 * failed to start.
 */
function _getOrCreateWorker(): Worker | null {
  if (_worker !== undefined) return _worker;
  try {
    _worker = new Worker(
      new URL('./roomPreparationWorker.ts', import.meta.url),
      { type: 'module' },
    );
    _worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data;
      const callback = _workerCallbacks.get(msg.roomId);
      _workerCallbacks.delete(msg.roomId);
      _pendingWorkerRoomIds.delete(msg.roomId);

      if (!callback) return;

      if (msg.error !== undefined) {
        // Build failed — fall back by letting the cold-miss synchronous path
        // handle it when the room is needed.  Log in dev so it is visible.
        if (import.meta.env.DEV) {
          console.error(`[preload worker] ${msg.roomId} build failed:`, msg.error);
        }
        return;
      }

      callback(_reconstructRoomRuntimeEntry(msg));

      if (import.meta.env.DEV) {
        console.log(`[wallTemplate] roomId=${msg.roomId} source=worker:${msg.wallSource}` +
          ` wallCount=${msg.wallTemplate.wallCount} wallMs=${msg.wallMs.toFixed(1)}ms`);
      }
    };
    _worker.onerror = (err) => {
      if (import.meta.env.DEV) {
        console.error('[preload worker] fatal error:', err);
      }
      // Nullify so subsequent calls create a fresh worker (one retry).
      _worker = null;
    };
  } catch {
    _worker = null;
  }
  return _worker;
}

/**
 * Reconstructs a `RoomRuntimeEntry` from a successful worker reply.
 * Typed arrays are wrapped around the transferred ArrayBuffers (zero-copy).
 * Sets are reconstructed from the serialised key arrays.
 */
function _reconstructRoomRuntimeEntry(msg: WorkerSuccessMessage): RoomRuntimeEntry {
  const sw = msg.wallTemplate as SerializedWallTemplate;
  const wallTemplate: RoomWallTemplate = {
    wallCount:            sw.wallCount,
    xWorld:               new Float32Array(sw.xWorld),
    yWorld:               new Float32Array(sw.yWorld),
    wWorld:               new Float32Array(sw.wWorld),
    hWorld:               new Float32Array(sw.hWorld),
    isPlatformFlag:       new Uint8Array(sw.isPlatformFlag),
    platformEdge:         new Uint8Array(sw.platformEdge),
    themeIndex:           new Uint8Array(sw.themeIndex),
    soundHardnessIndex:   new Uint8Array(sw.soundHardnessIndex),
    isInvisibleFlag:      new Uint8Array(sw.isInvisibleFlag),
    rampOrientationIndex: new Uint8Array(sw.rampOrientationIndex),
    isPillarHalfWidthFlag: new Uint8Array(sw.isPillarHalfWidthFlag),
    isIceFlag:            new Uint8Array(sw.isIceFlag),
    isUltraIceFlag:       new Uint8Array(sw.isUltraIceFlag),
  };

  // Wire: null  = "built; no blockers"  → RoomRuntimeEntry: undefined
  //       array = "has blockers"         → RoomRuntimeEntry: Set<string>
  const blockerKeys: Set<string> | undefined =
    msg.blockerKeys !== null ? new Set(msg.blockerKeys) : undefined;
  const darkBlockerKeys: Set<string> | undefined =
    msg.darkBlockerKeys !== null ? new Set(msg.darkBlockerKeys) : undefined;

  return {
    wallTemplate,
    edgeExtension: null,
    blockerKeys,
    darkBlockerKeys,
    wallDecorations: msg.wallDecorations as WallDecoration[],
  };
}

/** Returns `true` if a room is currently being processed by the worker. */
export function isRoomPendingWithWorker(roomId: string): boolean {
  return _pendingWorkerRoomIds.has(roomId);
}

/**
 * Dispatches `room` to the background worker for preparation.
 * On success the result is stored in `cache` via `cache.set(roomId, entry)`.
 *
 * Returns `true` when the room was accepted by the worker (it may already be
 * pending, in which case the existing dispatch is reused).
 * Returns `false` when the worker is unavailable.
 */
export function dispatchRoomToWorker(
  roomId: string,
  room: RoomDef,
  cache: RoomRuntimeCache,
  isDebugMode: boolean,
): boolean {
  const worker = _getOrCreateWorker();
  if (worker === null) return false;

  // Avoid double-dispatching the same room.
  if (_pendingWorkerRoomIds.has(roomId)) return true;

  _pendingWorkerRoomIds.add(roomId);
  _workerCallbacks.set(roomId, (entry) => {
    cache.set(roomId, entry);
    if (isDebugMode) {
      console.log(`[preload worker] ${roomId} cached from worker`);
    }
  });

  // `room` is a plain-object `RoomDef` produced by JSON hydration — all fields
  // are primitive values, plain arrays, or plain sub-objects.  The structured
  // clone algorithm copies it cleanly without requiring any special handling.
  worker.postMessage({ roomId, room });
  return true;
}
