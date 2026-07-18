/**
 * roomPreparationWorkerProtocol.ts — Shared message-protocol types for the
 * room preparation Web Worker.
 *
 * This file contains only type definitions.  It has zero runtime imports so
 * it can be safely imported by both the main thread and the worker without
 * pulling in any DOM-adjacent code.
 *
 * Wire format summary
 * ───────────────────
 *  Main → Worker   { roomId, room: RoomDef }  (structured clone)
 *  Worker → Main   WorkerOutboundMessage      (typed-array fields transferred)
 *
 * ArrayBuffer fields in SerializedWallTemplate are **transferred** (zero-copy)
 * via the `transfer` list of `postMessage`.  All other fields are structured-
 * cloned.
 *
 * blockerKeys / darkBlockerKeys wire encoding
 * ─────────────────────────────────────────────
 *  null      → room has no ambient-light blockers  (RoomRuntimeEntry gets `undefined`)
 *  string[]  → room has blockers                   (RoomRuntimeEntry gets `new Set(arr)`)
 *
 * Edge-extension cache has been removed from this protocol — that feature is
 * legacy-only.  See src/render/transitions/legacy/README.md for details.
 *
 * BUILD 388
 */

// ── Serialised wall template ──────────────────────────────────────────────────

/**
 * Wire representation of `RoomWallTemplate`.
 * Every typed-array field is expressed as its underlying `ArrayBuffer` so it
 * can be transferred zero-copy across the worker boundary.
 *
 * Float32 arrays: xWorld / yWorld / wWorld / hWorld  (4 bytes × wallCount)
 * Uint8  arrays:  everything else                    (1 byte  × wallCount)
 */
export interface SerializedWallTemplate {
  wallCount: number;
  xWorld: ArrayBuffer;
  yWorld: ArrayBuffer;
  wWorld: ArrayBuffer;
  hWorld: ArrayBuffer;
  isPlatformFlag: ArrayBuffer;
  platformEdge: ArrayBuffer;
  themeIndex: ArrayBuffer;
  soundHardnessIndex: ArrayBuffer;
  isInvisibleFlag: ArrayBuffer;
  rampOrientationIndex: ArrayBuffer;
  isPillarHalfWidthFlag: ArrayBuffer;
  isIceFlag: ArrayBuffer;
  isUltraIceFlag: ArrayBuffer;
  isRocketBlockFlag: ArrayBuffer;
}

// ── Worker outbound messages ──────────────────────────────────────────────────

/** Successful room-preparation result posted from worker to main thread. */
export interface WorkerSuccessMessage {
  /** Discriminant — absent on success messages. */
  error?: undefined;
  roomId: string;
  wallTemplate: SerializedWallTemplate;
  /**
   * `null`     → room has no ambient-light blockers.
   * `string[]` → `"xBlock,yBlock"` keys for every blocker tile.
   */
  blockerKeys: string[] | null;
  /** Same encoding as `blockerKeys` but for dark-ambient blockers only. */
  darkBlockerKeys: string[] | null;
  /** Plain `WallDecoration` objects — structured-cloned cleanly. */
  wallDecorations: {
    worldLeftPx: number;
    worldAnchorYPx: number;
    kind: string;
    seed: number;
  }[];
  /** Where the wall template came from: pre-baked JSON data or runtime merge. */
  wallSource: 'baked' | 'fallback';
  /** Per-step timing (ms) for performance diagnostics. */
  wallMs: number;
  blockerMs: number;
  decorMs: number;
  totalMs: number;
}

/** Error posted from worker to main thread when the build pass throws. */
export interface WorkerErrorMessage {
  roomId: string;
  error: string;
}

/** Union of all messages the worker can post back to the main thread. */
export type WorkerOutboundMessage = WorkerSuccessMessage | WorkerErrorMessage;
