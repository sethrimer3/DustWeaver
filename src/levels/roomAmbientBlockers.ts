/**
 * roomAmbientBlockers.ts — Single source of truth for a room's ambient-light
 * blocker key sets.
 *
 * Why this exists
 * ───────────────
 * The `blockerKeys` / `darkBlockerKeys` `Set<string>` pair is consumed by the
 * ambient-light system AND folded into the render-state key
 * (`computeRenderStateKey`) that gates prewarmed-chunk *adoption*.  If two code
 * paths build these sets even slightly differently, their render-state keys
 * diverge and the entry-time `adoptPrewarmedChunksForRoom` call discards the
 * idle-built chunks as "stale" — silently reintroducing the very first-frame
 * wall-rebuild hitch the prewarm system exists to prevent.
 *
 * Before this module the identical construction was copy-pasted in four places:
 *   • gameLoadRoomPhases.ts   — Phase A (cache-miss path)
 *   • gameLoadRoomPhases.ts   — applyResidentRoomActivation (hot-swap path)
 *   • preparedRoomRuntime.ts  — buildPreparedRoomRuntime (cache-population path,
 *                               whose output the prewarm scheduler keys against)
 *
 * Consolidating them here guarantees the build-time key (prewarm) and the
 * adopt-time key (room entry) are computed from byte-identical sets, so
 * prewarmed chunks are reliably adopted rather than rebuilt.
 *
 * Referentially transparent: same `RoomDef` → same output.  No DOM, no world
 * state, no RNG — safe to call from the main thread, the preload worker, or a
 * unit test.
 */

import type { RoomDef } from './roomDef';

/** A room's ambient-light blocker key sets. */
export interface RoomAmbientBlockerKeys {
  /**
   * Every air cell that blocks ambient-light propagation, keyed `"x,y"`.
   * `undefined` when the room has no blockers (matches the historical sentinel
   * used throughout the load pipeline — see `RoomRuntimeEntry.blockerKeys`).
   */
  blockerKeys: Set<string> | undefined;
  /**
   * The subset of `blockerKeys` that ALSO draws a solid black overlay
   * (author-placed `isDark` blockers).  `undefined` when there are none.
   */
  darkBlockerKeys: Set<string> | undefined;
}

/**
 * Builds the ambient-light blocker key sets for `room`.
 *
 * The two contributing sources — mirroring the original inline logic exactly:
 *  1. `room.ambientLightBlockers` — one cell per entry; `isDark` entries are
 *     additionally added to `darkBlockerKeys`.
 *  2. `room.backgroundBlocks` with `isLightBlockingFlag === 1` — every cell of
 *     the block's `wBlock × hBlock` footprint is added to `blockerKeys`
 *     (light-blocking background never contributes dark keys).
 *
 * Sets are allocated lazily so rooms with no blockers return `undefined` for
 * both fields (no wasted empty-Set allocation on the common case).
 */
export function buildRoomAmbientBlockerKeys(room: RoomDef): RoomAmbientBlockerKeys {
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

  return { blockerKeys, darkBlockerKeys };
}
