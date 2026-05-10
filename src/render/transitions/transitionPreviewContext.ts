/**
 * transitionPreviewContext.ts — Transition preview abstraction.
 *
 * `TransitionPreviewContext` is the single data structure that knows:
 *  - which transition is currently being revealed (direction, index, connected room)
 *  - how far the reveal has progressed (0–1)
 *  - the 2-block-thick facing-edge tiles from the connected room, ready to render
 *
 * Future dual-room rendering will attach to this context: when a staging world
 * state is available for the connected room, its full snapshot can be stored here
 * and the renderer can draw both rooms simultaneously before the camera slides
 * across.  See nextSteps.md for the remaining work.
 *
 * Usage:
 *   const ctx = createTransitionPreviewContext();
 *   // Each frame, after updateTransitionReveal():
 *   updateTransitionPreviewContext(ctx, revealState, currentRoom);
 *   // Pass ctx to renderFrame() → renderNextRoomFacingEdge reads it.
 */

import type { RoomDef, TransitionDirection } from '../../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import { ROOM_REGISTRY } from '../../levels/rooms';
import type { TransitionRevealState } from './transitionCameraReveal';

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
}

/**
 * 2-block-thick strip of wall tiles from the connected room's facing edge,
 * expressed in connected-room local block coordinates along with the world-
 * space origin that maps connected local (0, 0) to current-room world space.
 *
 * Renderer usage:
 *   screenX = (nextRoomOriginXWorld + tile.colBlock * BLOCK_SIZE_SMALL) * zoom + ox
 *   screenY = (nextRoomOriginYWorld + tile.rowBlock * BLOCK_SIZE_SMALL) * zoom + oy
 */
export interface NextRoomFacingEdge {
  /** ID of the connected room this data was built from. */
  connectedRoomId: string;
  /**
   * Where the connected room's local origin (0, 0) sits in current-room world
   * space.  For a 'right' transition: originXWorld = currentRoom.widthBlocks *
   * BLOCK_SIZE_SMALL, originYWorld = 0.  Negative values are normal for 'left'
   * and 'up' transitions.
   */
  originXWorld: number;
  originYWorld: number;
  /** Flat list of tiles in the 2-block facing strip (pre-allocated, no gaps). */
  tiles: readonly FacingEdgeTile[];
  /**
   * "col,row" key set of every solid tile in the strip, plus the 3rd adjacent
   * column/row for neighbor-mask lookups during sprite auto-tiling.
   */
  occupancySet: ReadonlySet<string>;
}

// ── Main context type ─────────────────────────────────────────────────────────

/**
 * Full transition preview context for the current frame.
 *
 * Set `isActive = true` when either a NearTransition or PostTransition reveal
 * is in progress.  Future dual-room rendering will add a `stagingSnapshot` or
 * similar field here; for now the context provides the facing-edge strip only.
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
   * 2-block-thick facing-edge tile data from the connected room, if it could
   * be built.  Null when the connected room is unknown or empty.
   *
   * TODO (next step): When a staging WorldState for the connected room exists,
   * replace or supplement this with a full WorldSnapshot so the renderer can
   * draw both rooms simultaneously.  See nextSteps.md.
   */
  nextRoomFacingEdge: NextRoomFacingEdge | null;
}

// ── Internal cache ────────────────────────────────────────────────────────────

/** Cached facing-edge for the most recently resolved connected room. */
let _cachedEdge: NextRoomFacingEdge | null = null;
/** Key used to invalidate the cache: `${connectedRoomId}:${direction}:${currentW}x${currentH}` */
let _cacheKey = '';

// ── Public API ────────────────────────────────────────────────────────────────

/** Create the initial (inactive) preview context. */
export function createTransitionPreviewContext(): TransitionPreviewContext {
  return {
    isActive: false,
    direction: null,
    connectedRoomId: null,
    revealProgress: 0,
    nextRoomFacingEdge: null,
  };
}

/**
 * Update the preview context each frame, after `updateTransitionReveal`.
 *
 * Reads `revealState.activeTransitionIndex` and `revealState.revealProgress` to
 * determine whether a reveal is active and which transition it corresponds to.
 * Resolves the connected room and builds (or retrieves from cache) its facing-
 * edge tile strip.
 *
 * @param ctx         Mutable context (modified in-place).
 * @param revealState Latest transition reveal state (read-only after update).
 * @param currentRoom Current room definition.
 */
export function updateTransitionPreviewContext(
  ctx: TransitionPreviewContext,
  revealState: TransitionRevealState,
  currentRoom: RoomDef,
): void {
  const REVEAL_ACTIVE_THRESHOLD = 0.01;

  if (revealState.revealProgress < REVEAL_ACTIVE_THRESHOLD ||
      revealState.activeTransitionIndex < 0) {
    ctx.isActive = false;
    ctx.direction = null;
    ctx.connectedRoomId = null;
    ctx.revealProgress = 0;
    ctx.nextRoomFacingEdge = null;
    return;
  }

  const ti = revealState.activeTransitionIndex;
  const transition = currentRoom.transitions[ti];
  if (transition === undefined) {
    ctx.isActive = false;
    ctx.direction = null;
    ctx.connectedRoomId = null;
    ctx.revealProgress = 0;
    ctx.nextRoomFacingEdge = null;
    return;
  }

  ctx.isActive = true;
  ctx.direction = transition.direction;
  ctx.revealProgress = revealState.revealProgress;
  ctx.connectedRoomId = transition.targetRoomId;

  // Build or retrieve cached facing-edge for the connected room.
  const cacheKey = `${transition.targetRoomId}:${transition.direction}:${currentRoom.widthBlocks}x${currentRoom.heightBlocks}`;
  if (cacheKey !== _cacheKey) {
    _cacheKey = cacheKey;
    const connectedRoom = ROOM_REGISTRY.get(transition.targetRoomId);
    if (connectedRoom !== undefined) {
      _cachedEdge = _buildNextRoomFacingEdge(
        connectedRoom,
        transition.direction,
        currentRoom.widthBlocks,
        currentRoom.heightBlocks,
      );
    } else {
      _cachedEdge = null;
    }
  }

  ctx.nextRoomFacingEdge = _cachedEdge;
}

// ── Internal: build facing-edge strip ────────────────────────────────────────

/**
 * Build the 2-block-thick facing-edge tile strip from `connectedRoom`.
 *
 * `exitDir` is the direction the player travels (from the current room's POV).
 * The connected room's *entry* edge is the opposite side.
 *
 * Origin computation:
 *  - 'right': connected room left edge is at x = currentW * BS in current-room space
 *  - 'left':  connected room right edge is at x = 0, so origin at x = -connectedW * BS
 *  - 'down':  connected room top edge is at y = currentH * BS
 *  - 'up':    connected room bottom edge is at y = 0, so origin at y = -connectedH * BS
 */
function _buildNextRoomFacingEdge(
  connectedRoom: RoomDef,
  exitDir: TransitionDirection,
  currentWidthBlocks: number,
  currentHeightBlocks: number,
): NextRoomFacingEdge {
  const BS = BLOCK_SIZE_SMALL;
  const CW = connectedRoom.widthBlocks;
  const CH = connectedRoom.heightBlocks;

  // World-space origin of the connected room relative to the current room.
  let originXWorld: number;
  let originYWorld: number;
  switch (exitDir) {
    case 'right': originXWorld = currentWidthBlocks  * BS; originYWorld = 0; break;
    case 'left':  originXWorld = -CW * BS;                 originYWorld = 0; break;
    case 'down':  originXWorld = 0; originYWorld = currentHeightBlocks * BS; break;
    case 'up':    originXWorld = 0; originYWorld = -CH * BS;                 break;
  }

  // Build occupancy map for solid non-ramp non-invisible walls.
  const solidMap = new Map<string, string | null>();
  for (let wi = 0; wi < connectedRoom.walls.length; wi++) {
    const w = connectedRoom.walls[wi];
    if (w.isInvisibleFlag === 1) continue;
    if (w.rampOrientation !== undefined) continue;
    const theme: string | null = w.blockTheme ?? null;
    for (let col = w.xBlock; col < w.xBlock + w.wBlock; col++) {
      for (let row = w.yBlock; row < w.yBlock + w.hBlock; row++) {
        const k = `${col},${row}`;
        if (!solidMap.has(k) || theme !== null) solidMap.set(k, theme);
      }
    }
  }

  const isSolid = (col: number, row: number): boolean => solidMap.has(`${col},${row}`);
  const themeAt = (col: number, row: number): string | null => solidMap.get(`${col},${row}`) ?? null;

  // Determine which columns/rows to extract (2-block strip + 1 for neighbor mask).
  // The facing strip is the 2 columns/rows of the connected room closest to the
  // current room.
  const tiles: FacingEdgeTile[] = [];
  const occupancySet = new Set<string>();

  if (exitDir === 'right' || exitDir === 'left') {
    // Horizontal transition — extract 2 facing columns + 1 inner column for neighbor masks.
    // 'right': connected room's leftmost 2 cols face the transition.  col0 = 0, col1 = 1.
    // 'left':  connected room's rightmost 2 cols face the transition.  col0 = CW-1, col1 = CW-2.
    const [col0, col1, refCol] =
      exitDir === 'right'
        ? [0,    1,    2]
        : [CW-1, CW-2, CW-3];

    for (let row = 0; row < CH; row++) {
      const s0 = isSolid(col0, row);
      const s1 = isSolid(col1, row);

      tiles.push({ colBlock: col0, rowBlock: row, isSolid: s0, theme: s0 ? themeAt(col0, row) : null });
      tiles.push({ colBlock: col1, rowBlock: row, isSolid: s1, theme: s1 ? themeAt(col1, row) : null });

      if (s0) occupancySet.add(`${col0},${row}`);
      if (s1) occupancySet.add(`${col1},${row}`);
      // Include 3rd column in occupancy only (not rendered) so auto-tiling knows
      // the facing tile's inner neighbor.
      if (refCol >= 0 && refCol < CW && isSolid(refCol, row)) {
        occupancySet.add(`${refCol},${row}`);
      }
    }
  } else {
    // Vertical transition — extract 2 facing rows + 1 inner row for neighbor masks.
    // 'down': connected room's topmost 2 rows face the transition.  row0 = 0, row1 = 1.
    // 'up':   connected room's bottommost 2 rows face the transition.  row0 = CH-1, row1 = CH-2.
    const [row0, row1, refRow] =
      exitDir === 'down'
        ? [0,    1,    2]
        : [CH-1, CH-2, CH-3];

    for (let col = 0; col < CW; col++) {
      const s0 = isSolid(col, row0);
      const s1 = isSolid(col, row1);

      tiles.push({ colBlock: col, rowBlock: row0, isSolid: s0, theme: s0 ? themeAt(col, row0) : null });
      tiles.push({ colBlock: col, rowBlock: row1, isSolid: s1, theme: s1 ? themeAt(col, row1) : null });

      if (s0) occupancySet.add(`${col},${row0}`);
      if (s1) occupancySet.add(`${col},${row1}`);
      if (refRow >= 0 && refRow < CH && isSolid(col, refRow)) {
        occupancySet.add(`${col},${refRow}`);
      }
    }
  }

  return { connectedRoomId: connectedRoom.id, originXWorld, originYWorld, tiles, occupancySet };
}
