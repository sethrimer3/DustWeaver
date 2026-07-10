/**
 * LEGACY: twoRoomCrossing.ts — Two-room smooth camera crossing state machine.
 *
 * NOT imported by active gameplay. Retained for historical/reference purposes.
 * See src/render/transitions/legacy/README.md for re-enablement instructions.
 *
 * twoRoomCrossing.ts — Two-room smooth camera crossing state machine.
 *
 * BUILD 279: Replaces the edge-extension reveal system for transition crossings.
 * Two connected rooms are placed in a shared "crossing world space" so the
 * camera can slide naturally across the seam instead of snapping.
 *
 * Architecture
 * ────────────
 * - `startCrossing` is called when `checkRoomTransitions` fires.  It:
 *     1. Computes the next room's origin in current-room space using the
 *        matched transition opening-delta so offset doors line up.
 *     2. Shifts everything (current room walls, player, camera) by a
 *        non-negative offset when the next room is to the left/above, so all
 *        crossing-world-space coordinates stay positive.
 *     3. Appends the next room's walls to world.walls at the adjusted origin.
 *     4. Expands world.worldWidthWorld/worldHeightWorld to the union bounds.
 * - `isCrossingComplete` returns true once the player's centre has clearly
 *   entered the next room (2 blocks past the seam).
 * - `getCrossingUnionBounds` returns the camera clamp bounds during crossing.
 *
 * On finalisation (in gameScreen.ts):
 *   1. Player is converted to next-room-local block coords.
 *   2. Camera is shifted to next-room-local coords.
 *   3. loadRoom(nextRoom, ..., preserveCamera=true) is called to reset world.
 *   4. Camera is restored from the saved next-room-local value.
 *
 * Limitations (first pass — see nextSteps.md):
 *   - Enemy/particle/hazard simulation from the next room is not staged.
 *   - Wall auto-tiling sprites may have incorrect neighbour masks at the seam.
 *   - Rooms narrower than the viewport will cause a brief camera snap when
 *     the crossing finalises and the camera is forced to centre on the room.
 */

import type { WorldState } from '../sim/world';
import { wallShapeOrientationIndex } from '../levels/stairsGeometry';
import { MAX_WALLS } from '../sim/world';
import type { RoomDef, TransitionDirection } from '../levels/roomDef';
import {
  BLOCK_SIZE_MEDIUM,
  blockThemeToIndex,
  blockSoundHardnessToIndex,
  blockThemeToSoundHardness,
  WALL_THEME_DEFAULT_INDEX,
} from '../levels/roomDef';
import type { CameraState } from '../render/camera';
import {
  computeConnectedRoomOrigin,
  computeTransitionOpeningOffset,
} from '../render/transitions/transitionPreviewContext';
import { getOppositeTransitionDirection } from './gameTransitions';

// ── Types ──────────────────────────────────────────────────────────────────────

export type CrossingPhase = 'inactive' | 'crossing';

export interface TwoRoomCrossingState {
  phase: CrossingPhase;
  /** Direction of player travel (from current room to next). */
  exitDirection: TransitionDirection | null;
  /** The room the player is crossing FROM (null when inactive). */
  currentRoom: RoomDef | null;
  /** The room the player is crossing INTO (null when inactive). */
  nextRoom: RoomDef | null;
  /**
   * World-space origin of the next room in crossing-world-space.
   * Always non-negative after the coordinate-system shift applied by
   * `startCrossing`.
   */
  nextRoomOriginXWorld: number;
  nextRoomOriginYWorld: number;
  /**
   * Coordinate-system shift applied to the current room's walls, the player,
   * and the camera at the start of crossing.  Non-zero only for left/up exits
   * (or down/right exits with a negative alignment offset).
   * Must be subtracted from all world-space values to restore the original
   * current-room coordinate space if crossing is aborted.
   */
  shiftXWorld: number;
  shiftYWorld: number;
  /** world.wallCount saved before next-room walls were appended. */
  savedWallCount: number;
  /** world.worldWidthWorld saved before crossing started. */
  savedWorldWidthWorld: number;
  /** world.worldHeightWorld saved before crossing started. */
  savedWorldHeightWorld: number;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createTwoRoomCrossingState(): TwoRoomCrossingState {
  return {
    phase: 'inactive',
    exitDirection: null,
    currentRoom: null,
    nextRoom: null,
    nextRoomOriginXWorld: 0,
    nextRoomOriginYWorld: 0,
    shiftXWorld: 0,
    shiftYWorld: 0,
    savedWallCount: 0,
    savedWorldWidthWorld: 0,
    savedWorldHeightWorld: 0,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start a two-room crossing transition.
 *
 * Appends the next room's walls to the world at the correct crossing-world-
 * space origin, expands the world physics bounds to the union, and sets
 * `state.phase = 'crossing'`.
 *
 * When the next room's origin would be negative (left/up exits), the CURRENT
 * room's walls, player, and camera are shifted right/down so all crossing-
 * world-space coordinates remain positive (required by the physics system).
 *
 * @returns true on success, false if the transition definition is missing.
 */
export function startCrossing(
  state: TwoRoomCrossingState,
  world: WorldState,
  currentRoom: RoomDef,
  transitionIndex: number,
  direction: TransitionDirection,
  nextRoom: RoomDef,
  camera: CameraState,
): boolean {
  const transition = currentRoom.transitions[transitionIndex];
  if (transition === undefined) return false;

  const BS = BLOCK_SIZE_MEDIUM;

  // ── Find matched return transition for opening-offset alignment ───────────
  const oppositeDir = getOppositeTransitionDirection(direction);
  const connectedTransition = nextRoom.transitions.find(
    t => t.targetRoomId === currentRoom.id && t.direction === oppositeDir,
  );

  let seamDeltaRowBlocks = 0;
  let seamDeltaColBlocks = 0;
  if (connectedTransition !== undefined) {
    const delta = computeTransitionOpeningOffset(transition, connectedTransition, direction);
    if (direction === 'left' || direction === 'right') {
      seamDeltaRowBlocks = delta;
    } else {
      seamDeltaColBlocks = delta;
    }
  }

  // ── Compute next room origin in current-room space (may be negative) ──────
  const { originXWorld, originYWorld } = computeConnectedRoomOrigin(
    direction,
    currentRoom.widthBlocks,
    currentRoom.heightBlocks,
    nextRoom.widthBlocks,
    nextRoom.heightBlocks,
    seamDeltaRowBlocks,
    seamDeltaColBlocks,
  );

  // ── Coordinate-system shift to keep everything in positive space ──────────
  // For left/up exits the next room origin is negative.  Shift the current
  // room, player, and camera so the minimum crossing-world coordinate is 0.
  const shiftX = Math.max(0, -originXWorld);
  const shiftY = Math.max(0, -originYWorld);

  if (shiftX !== 0 || shiftY !== 0) {
    // Shift all current-room wall positions
    for (let wi = 0; wi < world.wallCount; wi++) {
      world.wallXWorld[wi] += shiftX;
      world.wallYWorld[wi] += shiftY;
    }
    // Shift player cluster
    const player = world.clusters[0];
    if (player !== undefined) {
      player.positionXWorld += shiftX;
      player.positionYWorld += shiftY;
    }
    // Shift camera
    camera.centerXWorld += shiftX;
    camera.centerYWorld += shiftY;
  }

  const adjustedOriginX = originXWorld + shiftX;
  const adjustedOriginY = originYWorld + shiftY;

  // ── Append next room walls at adjusted origin ─────────────────────────────
  const savedWallCount = world.wallCount;
  appendRoomWallsAtOffset(world, nextRoom, adjustedOriginX, adjustedOriginY);

  // ── Expand world physics bounds to the union ──────────────────────────────
  const savedWorldWidth  = world.worldWidthWorld;
  const savedWorldHeight = world.worldHeightWorld;
  const currentW = currentRoom.widthBlocks * BS + shiftX;
  const currentH = currentRoom.heightBlocks * BS + shiftY;
  world.worldWidthWorld  = Math.max(currentW, adjustedOriginX + nextRoom.widthBlocks  * BS);
  world.worldHeightWorld = Math.max(currentH, adjustedOriginY + nextRoom.heightBlocks * BS);

  // ── Save state ────────────────────────────────────────────────────────────
  state.phase                 = 'crossing';
  state.exitDirection         = direction;
  state.currentRoom           = currentRoom;
  state.nextRoom              = nextRoom;
  state.nextRoomOriginXWorld  = adjustedOriginX;
  state.nextRoomOriginYWorld  = adjustedOriginY;
  state.shiftXWorld           = shiftX;
  state.shiftYWorld           = shiftY;
  state.savedWallCount        = savedWallCount;
  state.savedWorldWidthWorld  = savedWorldWidth;
  state.savedWorldHeightWorld = savedWorldHeight;

  return true;
}

/**
 * Returns true when the player's centre has moved clearly past the seam
 * into the next room (at least 2 blocks from the seam, inside next room).
 */
export function isCrossingComplete(
  state: TwoRoomCrossingState,
  playerXWorld: number,
  playerYWorld: number,
): boolean {
  if (state.phase !== 'crossing' || state.nextRoom === null) return false;

  const BS = BLOCK_SIZE_MEDIUM;
  const SETTLE_INSET_WORLD = 2 * BS;
  const ox = state.nextRoomOriginXWorld;
  const oy = state.nextRoomOriginYWorld;
  const nw = state.nextRoom.widthBlocks  * BS;
  const nh = state.nextRoom.heightBlocks * BS;

  switch (state.exitDirection) {
    case 'right': return playerXWorld > ox + SETTLE_INSET_WORLD;
    case 'left':  return playerXWorld < ox + nw - SETTLE_INSET_WORLD;
    case 'down':  return playerYWorld > oy + SETTLE_INSET_WORLD;
    case 'up':    return playerYWorld < oy + nh - SETTLE_INSET_WORLD;
    default:      return false;
  }
}

/**
 * Returns the camera clamp bounds (crossing-world-space) that cover both rooms
 * during an active crossing.  Throws if called while `phase !== 'crossing'`.
 */
export function getCrossingUnionBounds(state: TwoRoomCrossingState): {
  minXWorld: number;
  minYWorld: number;
  maxXWorld: number;
  maxYWorld: number;
} {
  if (state.phase !== 'crossing' || state.currentRoom === null || state.nextRoom === null) {
    throw new Error('[twoRoomCrossing] getCrossingUnionBounds called outside of active crossing');
  }
  const currentRoom = state.currentRoom;
  const nextRoom    = state.nextRoom;
  const BS = BLOCK_SIZE_MEDIUM;

  const curW = currentRoom.widthBlocks  * BS + state.shiftXWorld;
  const curH = currentRoom.heightBlocks * BS + state.shiftYWorld;
  const nxtW = nextRoom.widthBlocks  * BS;
  const nxtH = nextRoom.heightBlocks * BS;
  const ox   = state.nextRoomOriginXWorld;
  const oy   = state.nextRoomOriginYWorld;

  return {
    minXWorld: 0,
    minYWorld: 0,
    maxXWorld: Math.max(curW, ox + nxtW),
    maxYWorld: Math.max(curH, oy + nxtH),
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Append wall rectangles from `room` to the world's wall buffers at the given
 * world-space offset.  No merge pass is performed — acceptable for first pass
 * since the next room's walls are only temporary (replaced by loadRoom() on
 * finalisation).
 *
 * Stops appending when MAX_WALLS is reached.
 *
 * Exported as `appendRoomWallsAtOffset` for use in seamless room staging.
 */
export function appendRoomWallsAtOffset(
  world: WorldState,
  room: RoomDef,
  offsetXWorld: number,
  offsetYWorld: number,
): void {
  for (let wi = 0; wi < room.walls.length; wi++) {
    if (world.wallCount >= MAX_WALLS) break;

    const def = room.walls[wi];
    const idx = world.wallCount++;
    const isHalfWidth = def.isPillarHalfWidthFlag === 1;

    world.wallXWorld[idx] = def.xBlock * BLOCK_SIZE_MEDIUM + offsetXWorld;
    world.wallYWorld[idx] = def.yBlock * BLOCK_SIZE_MEDIUM + offsetYWorld;
    world.wallWWorld[idx] = isHalfWidth
      ? Math.max(BLOCK_SIZE_MEDIUM / 2, def.wBlock * (BLOCK_SIZE_MEDIUM / 2))
      : Math.max(BLOCK_SIZE_MEDIUM,     def.wBlock * BLOCK_SIZE_MEDIUM);
    world.wallHWorld[idx] = Math.max(BLOCK_SIZE_MEDIUM, def.hBlock * BLOCK_SIZE_MEDIUM);

    world.wallIsPlatformFlag[idx]        = def.isPlatformFlag === 1 ? 1 : 0;
    world.wallPlatformEdge[idx]          = def.platformEdge ?? 0;
    world.wallThemeIndex[idx]            = def.blockTheme !== undefined
      ? blockThemeToIndex(def.blockTheme)
      : WALL_THEME_DEFAULT_INDEX;
    world.wallSoundHardnessIndex[idx]    = blockSoundHardnessToIndex(
      room.soundHardness ?? blockThemeToSoundHardness(def.blockTheme ?? room.blockTheme),
    );
    world.wallIsInvisibleFlag[idx]       = def.isInvisibleFlag === 1 ? 1 : 0;
    world.wallRampOrientationIndex[idx]  = wallShapeOrientationIndex(def);
    world.wallIsPillarHalfWidthFlag[idx] = isHalfWidth ? 1 : 0;
    world.wallIsBouncePadFlag[idx]       = 0;
    world.wallBouncePadSpeedFactorIndex[idx] = 0;
  }
}


