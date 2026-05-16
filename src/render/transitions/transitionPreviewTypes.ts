/**
 * transitionPreviewTypes.ts — Type definitions and pure helpers for the
 * transition preview system.
 *
 * Extracted from transitionPreviewContext.ts (BUILD 327) to keep the main
 * context module focused on the cache/update logic.
 *
 * Exports:
 *  - `FacingEdgeTile`            — single tile from a connected room's facing-edge strip.
 *  - `NextRoomFacingEdge`        — full 2-block facing-edge strip with origin offsets.
 *  - `TwoRoomTransitionSnapshot` — staging data for a two-room transition view.
 *  - `TransitionPreviewContext`  — full context object passed to renderFrame.
 *  - `computeTransitionOpeningOffset` — delta between matched transition openings.
 *  - `computeConnectedRoomOrigin`     — world-space origin of the connected room.
 */

import type { RoomTransitionDef, TransitionDirection } from '../../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';

// ── Next-room facing-edge types ───────────────────────────────────────────────

/** A single tile from the connected room's facing-edge strip. */
export interface FacingEdgeTile {
  /** Column in connected-room local block coordinates. */
  colBlock: number;
  /** Row in connected-room local block coordinates. */
  rowBlock: number;
  /** True if this tile is solid and should be drawn as a wall. */
  isSolid: boolean;
  /** Per-wall theme override (null = use connected room default). */
  theme: string | null;
  /**
   * Per-tile ambient-light depth from a `buildAmbientDepths` solve on the
   * connected room.  Used by `nextRoomEdgeRenderer` instead of a fixed tint
   * so facing-edge shading is consistent with the current-room edge tiles.
   * 0 = directly exposed to open air; higher = darker.
   */
  ambientDepth: number;
}

/**
 * 2-block-thick strip of wall tiles from the connected room's facing edge,
 * expressed in connected-room local block coordinates along with the world-
 * space origin that maps connected local (0, 0) to current-room world space.
 *
 * As of BUILD 276 the origin correctly accounts for offset door openings —
 * `originYWorld` (for horizontal transitions) and `originXWorld` (for vertical
 * transitions) are derived from the matched transition positions so openings
 * at different row/column numbers align at the seam.
 *
 * Renderer usage:
 *   screenX = (originXWorld + tile.colBlock * BLOCK_SIZE_SMALL) * zoom + ox
 *   screenY = (originYWorld + tile.rowBlock * BLOCK_SIZE_SMALL) * zoom + oy
 */
export interface NextRoomFacingEdge {
  /** ID of the connected room this data was built from. */
  connectedRoomId: string;
  /**
   * Where the connected room's local origin (0, 0) sits in current-room world
   * space.  Negative values are normal for 'left' and 'up' transitions.
   *
   * For aligned openings the Y (horizontal transitions) or X (vertical
   * transitions) component is non-zero when the two transition openings are
   * not at the same row/column.  See computeConnectedRoomOrigin().
   */
  originXWorld: number;
  originYWorld: number;
  /** Flat list of tiles in the 2-block facing strip (pre-allocated, no gaps). */
  tiles: readonly FacingEdgeTile[];
  /**
   * "col,row" key set of every solid tile in the strip, plus reference
   * columns/rows for neighbor-mask lookups during sprite auto-tiling.
   *
   * As of BUILD 276 this includes:
   *  - tiles in the 2-block rendered strip
   *  - a 3rd inner column/row (for col1/row1 neighbor masks)
   *  - a 4th deeper inner column/row (for col1/row1 deeper masks)
   *  - seam-face entries: current-room edge occupancy mapped to connected-room
   *    coordinates so col0/row0 tiles do not appear incorrectly open at the seam
   */
  occupancySet: ReadonlySet<string>;
}

// ── Staging snapshot type ─────────────────────────────────────────────────────

/**
 * Staging data for a two-room transition view.
 *
 * This is the primary attachment point for future dual-room rendering.
 *
 * Currently provides:
 *  - origins for both rooms in world space
 *  - the connected room's 2-block facing-edge tile data
 *  - reveal progress for fade/alpha control
 *
 * Future work (see nextSteps.md):
 *  - nextRoomWorldSnapshot: WorldSnapshot — full connected-room snapshot for
 *    drawing enemies, particles, and all walls during crossing
 *  - nextRoomEdgeExtensionCache: EdgeExtensionCache — edge extension tiles for
 *    the connected room when it becomes the active room
 *  - isNextRoomStaged: boolean — true once the connected-room WorldState is ready
 */
export interface TwoRoomTransitionSnapshot {
  /** Index of the transition driving this staging snapshot (into currentRoom.transitions). */
  activeTransitionIndex: number;
  /** Direction of player travel through this transition. */
  exitDirection: TransitionDirection;
  /** ID of the current room. */
  currentRoomId: string;
  /** ID of the connected (next) room. */
  connectedRoomId: string;
  /**
   * World-space origin of the current room.  Always (0, 0) by convention —
   * the current room IS the world-space reference frame.
   */
  currentRoomOriginXWorld: number;
  currentRoomOriginYWorld: number;
  /**
   * World-space origin of the connected room in current-room coordinates.
   * Derived from matched transition positions so offset openings are correctly
   * aligned.  See computeConnectedRoomOrigin().
   */
  nextRoomOriginXWorld: number;
  nextRoomOriginYWorld: number;
  /**
   * 2-block facing-edge tile strip from the connected room.
   * Null if the connected room could not be resolved.
   */
  nextRoomFacingEdge: NextRoomFacingEdge | null;
  /**
   * Current reveal progress [0, 1] driving this snapshot's visibility.
   * 0 = no reveal (snapshot is inactive); 1 = full camera shift.
   * Updated in-place each frame without rebuilding the snapshot object.
   */
  revealProgress: number;
}

// ── Main context type ─────────────────────────────────────────────────────────

/**
 * Full transition preview context for the current frame.
 *
 * Set `isActive = true` when either a NearTransition or PostTransition reveal
 * is in progress.  The `stagingSnapshot` field is the BUILD 276+ attachment
 * point for full dual-room rendering.
 */
export interface TransitionPreviewContext {
  /** True when a transition reveal is currently active (reveal > near-zero). */
  isActive: boolean;
  /**
   * Direction of the active transition in the current room (the exit side
   * the player is approaching or just crossed).  Null when not active.
   */
  direction: TransitionDirection | null;
  /** ID of the connected (next) room.  Null if unresolvable. */
  connectedRoomId: string | null;
  /**
   * Reveal progress [0, 1]: 0 = no reveal, 1 = full TRANSITION_REVEAL_MAX_BLOCKS
   * shift.  Mirrors `TransitionRevealState.revealProgress`.
   */
  revealProgress: number;
  /**
   * 2-block-thick facing-edge tile data from the connected room.
   * Null when the connected room is unknown or when not active.
   *
   * Shortcut alias for `stagingSnapshot?.nextRoomFacingEdge`.
   * Retained for backward-compatibility with `renderNextRoomFacingEdge`.
   */
  nextRoomFacingEdge: NextRoomFacingEdge | null;
  /**
   * Full staging snapshot for this transition frame.  Null when not active.
   *
   * This is the hook for future dual-room rendering:
   *   - nextRoomFacingEdge is already populated (BUILD 275+)
   *   - origin offset alignment is correct for offset openings (BUILD 276+)
   *   - full WorldSnapshot for connected room goes here when ready (future)
   *
   * See nextSteps.md for remaining work.
   */
  stagingSnapshot: TwoRoomTransitionSnapshot | null;
}

// ── Exported helper functions ─────────────────────────────────────────────────

/**
 * Compute the opening-position delta (in blocks) between two matched transitions.
 *
 * For horizontal transitions (left/right): returns the Y delta (row offset).
 * For vertical transitions (up/down): returns the X delta (column offset).
 *
 * A positive result means the current room's opening starts `delta` rows/cols
 * BELOW/RIGHT of the connected room's opening at the seam.
 *
 * @param currentTransition  The transition the player is approaching/crossing.
 * @param connectedTransition The matched transition in the connected room.
 * @param exitDir             Direction of player travel.
 * @returns Signed delta in blocks (current – connected opening start).
 */
export function computeTransitionOpeningOffset(
  currentTransition: RoomTransitionDef,
  connectedTransition: RoomTransitionDef,
  exitDir: TransitionDirection,
): number {
  const isHoriz = exitDir === 'left' || exitDir === 'right';
  if (isHoriz) {
    return currentTransition.yBlock - connectedTransition.yBlock;
  } else {
    return currentTransition.xBlock - connectedTransition.xBlock;
  }
}

/**
 * Compute the world-space origin of the connected room in current-room space.
 *
 * Uses the matched transition positions (opening deltas) so that an offset
 * door opening in the connected room aligns correctly with the current room's
 * opening at the seam.
 *
 * For a right-exit: the connected room's left edge is at x = currentW * BS.
 *   Y is shifted by `seamDeltaRowBlocks * BS` so the openings line up.
 * For a left-exit:  the connected room's right edge is at x = 0.
 *   Origin X = -connectedW * BS; same Y alignment.
 * For down-exit:    the connected room's top edge is at y = currentH * BS.
 *   X is shifted by `seamDeltaColBlocks * BS`.
 * For up-exit:      the connected room's bottom edge is at y = 0.
 *   Origin Y = -connectedH * BS; same X alignment.
 *
 * @param exitDir             Direction the player is travelling.
 * @param currentW            Current room width in blocks.
 * @param currentH            Current room height in blocks.
 * @param connectedW          Connected room width in blocks.
 * @param connectedH          Connected room height in blocks.
 * @param seamDeltaRowBlocks  Y-delta for horizontal transitions (currentYBlock − connectedYBlock).
 * @param seamDeltaColBlocks  X-delta for vertical transitions (currentXBlock − connectedXBlock).
 */
export function computeConnectedRoomOrigin(
  exitDir: TransitionDirection,
  currentW: number,
  currentH: number,
  connectedW: number,
  connectedH: number,
  seamDeltaRowBlocks: number,
  seamDeltaColBlocks: number,
): { originXWorld: number; originYWorld: number } {
  const BS = BLOCK_SIZE_SMALL;
  switch (exitDir) {
    case 'right':
      return { originXWorld: currentW * BS, originYWorld: seamDeltaRowBlocks * BS };
    case 'left':
      return { originXWorld: -connectedW * BS, originYWorld: seamDeltaRowBlocks * BS };
    case 'down':
      return { originXWorld: seamDeltaColBlocks * BS, originYWorld: currentH * BS };
    case 'up':
      return { originXWorld: seamDeltaColBlocks * BS, originYWorld: -connectedH * BS };
  }
}
