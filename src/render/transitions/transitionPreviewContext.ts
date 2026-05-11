/**
 * transitionPreviewContext.ts — Transition preview abstraction.
 *
 * `TransitionPreviewContext` is the single data structure that knows:
 *  - which transition is currently being revealed (direction, index, connected room)
 *  - how far the reveal has progressed (0–1)
 *  - the 2-block-thick facing-edge tiles from the connected room, ready to render
 *  - the full `TwoRoomTransitionSnapshot` staging state (BUILD 276+)
 *
 * BUILD 276 improvements:
 *  - Connected-room origin now uses matched transition positions so offset door
 *    openings align correctly (fixes 1-to-1 row/column assumption).
 *  - Seam auto-tiling uses a 4th reference column/row and populates the seam
 *    face from current-room edge data so inner-face neighbor masks are accurate.
 *  - `TwoRoomTransitionSnapshot` is the staging data structure for future
 *    dual-room rendering.  See nextSteps.md for remaining work.
 *
 * Future dual-room rendering will attach to `TwoRoomTransitionSnapshot`: when a
 * staging WorldState is available for the connected room, its WorldSnapshot can
 * be stored there and StagingRoomRenderer reads it.
 *
 * Usage:
 *   const ctx = createTransitionPreviewContext();
 *   // Each frame, after updateTransitionReveal():
 *   updateTransitionPreviewContext(ctx, revealState, currentRoom);
 *   // Pass ctx to renderFrame() → renderNextRoomFacingEdge reads it.
 */

import type { RoomDef, RoomTransitionDef, TransitionDirection } from '../../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import { ROOM_REGISTRY } from '../../levels/rooms';
import type { TransitionRevealState } from './transitionCameraReveal';
import { buildAmbientDepths } from '../walls/ambientLightDepths';

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

// ── Internal cache ────────────────────────────────────────────────────────────

/** Cached facing-edge for the most recently resolved transition. */
let _cachedEdge: NextRoomFacingEdge | null = null;
/**
 * Pre-allocated staging snapshot object.  Mutated in-place when the cache
 * key is stable; rebuilt when the transition or room changes.
 */
let _cachedStagingSnapshot: TwoRoomTransitionSnapshot | null = null;
/**
 * Cache key: `${currentRoom.id}:${transitionIndex}:${targetRoomId}`.
 * Includes the transition index (not just the target room) so two different
 * transitions in the same room with different yBlock positions cache separately.
 */
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
    stagingSnapshot: null,
  };
}

/**
 * Update the preview context each frame, after `updateTransitionReveal`.
 *
 * Reads `revealState.activeTransitionIndex` and `revealState.revealProgress` to
 * determine whether a reveal is active and which transition it corresponds to.
 * Resolves the connected room and builds (or retrieves from cache) its facing-
 * edge tile strip with correctly aligned origin offsets.
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
    ctx.stagingSnapshot = null;
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
    ctx.stagingSnapshot = null;
    return;
  }

  ctx.isActive = true;
  ctx.direction = transition.direction;
  ctx.revealProgress = revealState.revealProgress;
  ctx.connectedRoomId = transition.targetRoomId;

  // Cache key includes the room ID and transition index so two different transitions
  // pointing to the same target room (but with different yBlock/xBlock positions)
  // are cached separately and produce correctly offset origins.
  const cacheKey = `${currentRoom.id}:${ti}:${transition.targetRoomId}`;
  if (cacheKey !== _cacheKey) {
    _cacheKey = cacheKey;
    const connectedRoom = ROOM_REGISTRY.get(transition.targetRoomId);
    if (connectedRoom !== undefined) {
      _cachedEdge = _buildNextRoomFacingEdge(
        connectedRoom,
        transition.direction,
        currentRoom,
        transition,
      );
      _cachedStagingSnapshot = {
        activeTransitionIndex: ti,
        exitDirection: transition.direction,
        currentRoomId: currentRoom.id,
        connectedRoomId: transition.targetRoomId,
        currentRoomOriginXWorld: 0,
        currentRoomOriginYWorld: 0,
        nextRoomOriginXWorld: _cachedEdge.originXWorld,
        nextRoomOriginYWorld: _cachedEdge.originYWorld,
        nextRoomFacingEdge: _cachedEdge,
        revealProgress: revealState.revealProgress,
      };
    } else {
      // Connected room not found — degrade gracefully.
      console.warn(`[transitionPreviewContext] Connected room '${transition.targetRoomId}' not found in ROOM_REGISTRY.`);
      _cachedEdge = null;
      _cachedStagingSnapshot = null;
    }
  }

  // Update revealProgress in-place (cheap, avoids rebuilding the snapshot object).
  if (_cachedStagingSnapshot !== null) {
    _cachedStagingSnapshot.revealProgress = revealState.revealProgress;
  }

  ctx.nextRoomFacingEdge = _cachedEdge;
  ctx.stagingSnapshot = _cachedStagingSnapshot;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns the opposite direction (used to find the matching transition in the
 * connected room).
 */
function _oppositeDir(dir: TransitionDirection): TransitionDirection {
  if (dir === 'left') return 'right';
  if (dir === 'right') return 'left';
  if (dir === 'up') return 'down';
  return 'up';
}

/**
 * Build a set of row indices (for horizontal transitions) or column indices
 * (for vertical transitions) where the current room's boundary edge is solid.
 *
 * Used to populate seam-face occupancy entries in the connected-room
 * occupancy set so that facing tiles do not appear incorrectly open at the
 * seam where a solid current-room wall continues past the edge.
 *
 * @param currentRoom Room whose boundary edge is being inspected.
 * @param exitDir     Direction the player is exiting (determines which edge).
 * @returns Set of row or column indices that are solid at the boundary edge.
 */
function _buildCurrentRoomSeamSolid(
  currentRoom: RoomDef,
  exitDir: TransitionDirection,
): Set<number> {
  const W = currentRoom.widthBlocks;
  const H = currentRoom.heightBlocks;
  const solid = new Set<number>();

  for (let wi = 0; wi < currentRoom.walls.length; wi++) {
    const w = currentRoom.walls[wi];
    if (w.isInvisibleFlag === 1) continue;
    if (w.rampOrientation !== undefined) continue;

    if (exitDir === 'right') {
      // Seam at col W-1: include if wall extends to or past col W-1.
      if (w.xBlock + w.wBlock < W) continue;
      for (let row = w.yBlock; row < w.yBlock + w.hBlock; row++) solid.add(row);
    } else if (exitDir === 'left') {
      // Seam at col 0: include if wall starts at col 0.
      if (w.xBlock > 0) continue;
      for (let row = w.yBlock; row < w.yBlock + w.hBlock; row++) solid.add(row);
    } else if (exitDir === 'down') {
      // Seam at row H-1: include if wall extends to or past row H-1.
      if (w.yBlock + w.hBlock < H) continue;
      for (let col = w.xBlock; col < w.xBlock + w.wBlock; col++) solid.add(col);
    } else { // 'up'
      // Seam at row 0: include if wall starts at row 0.
      if (w.yBlock > 0) continue;
      for (let col = w.xBlock; col < w.xBlock + w.wBlock; col++) solid.add(col);
    }
  }

  return solid;
}

// ── Internal: build facing-edge strip ────────────────────────────────────────

/**
 * Build the 2-block-thick facing-edge tile strip from `connectedRoom`.
 *
 * `exitDir` is the direction the player travels (from the current room's POV).
 * The connected room's *entry* edge is the opposite side.
 *
 * Origin alignment (BUILD 276):
 *   Finds the matched transition in the connected room (targetRoomId === currentRoom.id,
 *   direction === opposite of exitDir) and uses the Y-delta (horizontal) or X-delta
 *   (vertical) between the two opening positions to compute a corrected origin offset.
 *   This ensures offset door openings align correctly at the seam.
 *
 * Seam auto-tiling (BUILD 276):
 *   - Includes a 4th reference column/row in occupancySet for deeper inner-face masks.
 *   - Populates seam-face entries (`seamCol`/`seamRow` coordinate) from current-room
 *     edge occupancy so facing tiles do not appear open where the current-room wall
 *     is solid at the seam boundary.
 *
 * @param connectedRoom   The connected room whose facing edge is being built.
 * @param exitDir         Direction the player exits the current room.
 * @param currentRoom     The current room (needed for origin offset and seam data).
 * @param currentTrans    The specific transition being used (for yBlock/xBlock).
 */
function _buildNextRoomFacingEdge(
  connectedRoom: RoomDef,
  exitDir: TransitionDirection,
  currentRoom: RoomDef,
  currentTrans: RoomTransitionDef,
): NextRoomFacingEdge {
  const CW = connectedRoom.widthBlocks;
  const CH = connectedRoom.heightBlocks;
  const W  = currentRoom.widthBlocks;
  const H  = currentRoom.heightBlocks;

  // ── Find the matched transition in the connected room ─────────────────────
  // The matching transition goes BACK to the current room from the opposite side.
  const oppositeDir = _oppositeDir(exitDir);
  const connectedTrans = connectedRoom.transitions.find(
    t => t.targetRoomId === currentRoom.id && t.direction === oppositeDir,
  ) ?? null;

  // ── Compute opening-position delta ────────────────────────────────────────
  // For horizontal exits: delta is how many rows the current opening is BELOW
  //   the connected room's opening (positive = current is lower).
  // For vertical exits: delta is how many cols the current opening is RIGHT OF
  //   the connected room's opening (positive = current is further right).
  let seamDeltaRowBlocks = 0;
  let seamDeltaColBlocks = 0;
  if (connectedTrans !== null) {
    if (exitDir === 'left' || exitDir === 'right') {
      seamDeltaRowBlocks = currentTrans.yBlock - connectedTrans.yBlock;
    } else {
      seamDeltaColBlocks = currentTrans.xBlock - connectedTrans.xBlock;
    }
  }
  // Log a warning if no matching transition was found (graceful degradation).
  if (connectedTrans === null) {
    console.warn(
      `[transitionPreviewContext] No matching '${oppositeDir}' transition found in ` +
      `room '${connectedRoom.id}' targeting '${currentRoom.id}'. ` +
      `Origin offset will default to 0.`,
    );
  }

  // ── Compute world-space origin ────────────────────────────────────────────
  const { originXWorld, originYWorld } = computeConnectedRoomOrigin(
    exitDir, W, H, CW, CH, seamDeltaRowBlocks, seamDeltaColBlocks,
  );

  // ── Build solid-wall occupancy map for the connected room ──────────────────
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

  const isSolidConn = (col: number, row: number): boolean => solidMap.has(`${col},${row}`);
  const themeAt     = (col: number, row: number): string | null => solidMap.get(`${col},${row}`) ?? null;

  // ── Compute per-tile ambient depth for the connected room ─────────────────
  // Run `buildAmbientDepths` on the full connected-room occupancy so facing-
  // edge tiles shade consistently with the connected room's own wall shading.
  // Transition opening cells are air (not in solidMap), so the passage area
  // counts as open air and the walls around it shade correctly.
  const connEffect = connectedRoom.lightingEffect ?? 'Ambient';
  const connAmbientDir = connectedRoom.ambientLightDirection !== undefined
    ? connectedRoom.ambientLightDirection
    : connEffect === 'Above' ? 'down' : 'omni';
  const connBlockers = new Set<string>();
  for (const b of (connectedRoom.ambientLightBlockers ?? [])) connBlockers.add(`${b.xBlock},${b.yBlock}`);
  const connDepths = buildAmbientDepths(new Set<string>(solidMap.keys()), connBlockers, connAmbientDir, CW, CH);
  const connDepthFallback = Math.max(CW, CH);
  const connDepthAt = (col: number, row: number): number =>
    connDepths.get(`${col},${row}`) ?? connDepthFallback;

  // ── Build seam-face solid set from the current room's boundary edge ───────
  // These rows (horizontal) or cols (vertical) are solid in the current room
  // at the seam boundary.  We map them to connected-room coordinates and add
  // them to the occupancy set so col0/row0 tiles don't appear open at the seam.
  const seamSolid = _buildCurrentRoomSeamSolid(currentRoom, exitDir);

  const tiles: FacingEdgeTile[] = [];
  const occupancySet = new Set<string>();

  if (exitDir === 'right' || exitDir === 'left') {
    // ── Horizontal transition ─────────────────────────────────────────────
    // 'right': connected room's leftmost 2 cols face the seam.  col0=0, col1=1.
    // 'left':  connected room's rightmost 2 cols face the seam.  col0=CW-1, col1=CW-2.
    const [col0, col1] = exitDir === 'right' ? [0, 1] : [CW - 1, CW - 2];
    // 3rd and 4th inner columns for neighbor-mask depth (not rendered).
    const refCol1 = exitDir === 'right' ? 2     : CW - 3;
    const refCol2 = exitDir === 'right' ? 3     : CW - 4;
    // Seam column: just outside col0 in the direction of the current room.
    // col0's neighbor facing the seam — this is where current-room data goes.
    const seamCol = exitDir === 'right' ? -1 : CW;

    for (let row = 0; row < CH; row++) {
      const s0 = isSolidConn(col0, row);
      const s1 = isSolidConn(col1, row);

      tiles.push({ colBlock: col0, rowBlock: row, isSolid: s0, theme: s0 ? themeAt(col0, row) : null, ambientDepth: connDepthAt(col0, row) });
      tiles.push({ colBlock: col1, rowBlock: row, isSolid: s1, theme: s1 ? themeAt(col1, row) : null, ambientDepth: connDepthAt(col1, row) });

      if (s0) occupancySet.add(`${col0},${row}`);
      if (s1) occupancySet.add(`${col1},${row}`);

      // 3rd inner column — gives col1's inner-facing neighbour for auto-tiling.
      if (refCol1 >= 0 && refCol1 < CW && isSolidConn(refCol1, row)) {
        occupancySet.add(`${refCol1},${row}`);
      }
      // 4th inner column — improves auto-tiling for deeper inner neighbours.
      if (refCol2 >= 0 && refCol2 < CW && isSolidConn(refCol2, row)) {
        occupancySet.add(`${refCol2},${row}`);
      }

      // Seam-face occupancy: map current room row (r) to connected room row.
      //   connected row `row` corresponds to current room row `row + seamDeltaRowBlocks`
      //   (because connected origin Y = seamDeltaRowBlocks * BS).
      const currentRoomRow = row + seamDeltaRowBlocks;
      if (currentRoomRow >= 0 && currentRoomRow < H && seamSolid.has(currentRoomRow)) {
        occupancySet.add(`${seamCol},${row}`);
      }
    }
  } else {
    // ── Vertical transition ───────────────────────────────────────────────
    // 'down': connected room's topmost 2 rows face the seam.  row0=0, row1=1.
    // 'up':   connected room's bottommost 2 rows face the seam.  row0=CH-1, row1=CH-2.
    const [row0, row1] = exitDir === 'down' ? [0, 1] : [CH - 1, CH - 2];
    // 3rd and 4th inner rows for neighbor-mask depth (not rendered).
    const refRow1 = exitDir === 'down' ? 2     : CH - 3;
    const refRow2 = exitDir === 'down' ? 3     : CH - 4;
    // Seam row: just outside row0 in the direction of the current room.
    const seamRow = exitDir === 'down' ? -1 : CH;

    for (let col = 0; col < CW; col++) {
      const s0 = isSolidConn(col, row0);
      const s1 = isSolidConn(col, row1);

      tiles.push({ colBlock: col, rowBlock: row0, isSolid: s0, theme: s0 ? themeAt(col, row0) : null, ambientDepth: connDepthAt(col, row0) });
      tiles.push({ colBlock: col, rowBlock: row1, isSolid: s1, theme: s1 ? themeAt(col, row1) : null, ambientDepth: connDepthAt(col, row1) });

      if (s0) occupancySet.add(`${col},${row0}`);
      if (s1) occupancySet.add(`${col},${row1}`);

      // 3rd inner row — gives row1's inner-facing neighbour for auto-tiling.
      if (refRow1 >= 0 && refRow1 < CH && isSolidConn(col, refRow1)) {
        occupancySet.add(`${col},${refRow1}`);
      }
      // 4th inner row — improves auto-tiling for deeper inner neighbours.
      if (refRow2 >= 0 && refRow2 < CH && isSolidConn(col, refRow2)) {
        occupancySet.add(`${col},${refRow2}`);
      }

      // Seam-face occupancy: map current room col to connected-room col.
      //   connected col `col` corresponds to current room col `col + seamDeltaColBlocks`.
      const currentRoomCol = col + seamDeltaColBlocks;
      if (currentRoomCol >= 0 && currentRoomCol < W && seamSolid.has(currentRoomCol)) {
        occupancySet.add(`${col},${seamRow}`);
      }
    }
  }

  return { connectedRoomId: connectedRoom.id, originXWorld, originYWorld, tiles, occupancySet };
}
