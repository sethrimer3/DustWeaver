/**
 * gameSeamlessStaging.ts — Seamless two-room staging state and helpers.
 *
 * BUILD 284 introduced seamless room crossings where, after the player crosses
 * from one room to the next, the previous room's walls are kept in world.walls
 * as a "staged" adjacent room.  This allows both rooms to share world space so
 * the player never sees a teleport.
 *
 * BUILD 286: Extracted from gameScreen.ts into this module.
 *
 * This module owns:
 *   - StagedRoomInstance — one record per staged (adjacent) room.
 *   - SeamlessStagingState — mutable container for currentRoomOriginXWorld/Y
 *     and the stagedRooms array.
 *   - createSeamlessStagingState / resetSeamlessStagingState — lifecycle.
 *   - clearStagedRoomsAndNormalize — removes staged walls and shifts the world
 *     back to the active-room-at-origin convention before starting a new crossing.
 *   - finalizeCrossingSeamless — loads the next room and re-appends the previous
 *     room's walls at the correct offset.
 *   - computeStagingUnionBounds — returns the AABB covering the active room and
 *     all staged rooms, used for camera clamping and clip-rect expansion.
 */

import type { WorldState } from '../sim/world';
import type { CameraState } from '../render/camera';
import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { TwoRoomCrossingState } from './twoRoomCrossing';
import { appendRoomWallsAtOffset } from './twoRoomCrossing';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StagedRoomInstance {
  room: RoomDef;
  /** Origin of this room in current world-space coordinates. */
  originXWorld: number;
  originYWorld: number;
  /**
   * First index in world.walls[] that belongs to this staged room.
   * Removing it is as simple as setting world.wallCount = wallStartIndex.
   */
  wallStartIndex: number;
}

export interface SeamlessStagingState {
  /**
   * World-space X origin of the active room.  Non-zero after a right/down
   * crossing where the world was shifted to keep coordinates positive.
   * Reset to 0 on every full room load.
   */
  currentRoomOriginXWorld: number;
  /**
   * World-space Y origin of the active room.  See currentRoomOriginXWorld.
   */
  currentRoomOriginYWorld: number;
  /**
   * Staged adjacent rooms whose walls remain in world.walls.
   * At most one entry is maintained at any time (one adjacent room per crossing).
   */
  stagedRooms: StagedRoomInstance[];
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

/** Creates a zeroed-out SeamlessStagingState for use at game start. */
export function createSeamlessStagingState(): SeamlessStagingState {
  return {
    currentRoomOriginXWorld: 0,
    currentRoomOriginYWorld: 0,
    stagedRooms: [],
  };
}

/**
 * Resets staging state to the at-origin convention used after a full room load.
 * Called from the room-load generator (Phase A) and on any hard reset.
 */
export function resetSeamlessStagingState(state: SeamlessStagingState): void {
  state.currentRoomOriginXWorld = 0;
  state.currentRoomOriginYWorld = 0;
  state.stagedRooms = [];
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Shifts every wall position, the player cluster, and the camera by
 * (dxWorld, dyWorld).  Called after loadRoom to make room for the staged
 * previous room when it would otherwise have negative coordinates (right/down
 * exits where the old room is now "behind" the new room in world space).
 */
function shiftWorldCoords(
  world: WorldState,
  camera: CameraState,
  prevClusterPosX: Float32Array,
  prevClusterPosY: Float32Array,
  dxWorld: number,
  dyWorld: number,
): void {
  const player = world.clusters[0];
  if (player !== undefined) {
    player.positionXWorld += dxWorld;
    player.positionYWorld += dyWorld;
    // Also shift any accumulated previous-position for interpolation.
    if (prevClusterPosX[0] !== undefined) prevClusterPosX[0] += dxWorld;
    if (prevClusterPosY[0] !== undefined) prevClusterPosY[0] += dyWorld;
  }
  for (let i = 0; i < world.wallCount; i++) {
    world.wallXWorld[i] += dxWorld;
    world.wallYWorld[i] += dyWorld;
  }
  camera.centerXWorld += dxWorld;
  camera.centerYWorld += dyWorld;
}

// ── Public helpers ─────────────────────────────────────────────────────────────

/**
 * Remove staged room walls and normalise world coordinates so the active room
 * starts at (0, 0).  Must be called before startCrossing() whenever staged
 * rooms are present or currentRoomOriginXWorld/Y is non-zero, so that the
 * crossing helpers see a clean world with the active room at the origin.
 *
 * Invariant: only ONE staged room is ever present at a time (one ring of
 * adjacent rooms), so `stagedRooms[0].wallStartIndex` is always the first
 * staged wall.  Multiple staged rooms in one pass are not supported.
 */
export function clearStagedRoomsAndNormalize(
  state: SeamlessStagingState,
  world: WorldState,
  camera: CameraState,
  prevClusterPosX: Float32Array,
  prevClusterPosY: Float32Array,
): void {
  // Remove staged walls (they are always appended at the end; only one
  // staged room is maintained so stagedRooms[0] has the earliest index).
  if (state.stagedRooms.length > 0) {
    world.wallCount = state.stagedRooms[0].wallStartIndex;
  }
  state.stagedRooms = [];

  // Shift world back so active room starts at (0, 0).
  if (state.currentRoomOriginXWorld !== 0 || state.currentRoomOriginYWorld !== 0) {
    shiftWorldCoords(world, camera, prevClusterPosX, prevClusterPosY, -state.currentRoomOriginXWorld, -state.currentRoomOriginYWorld);
    state.currentRoomOriginXWorld = 0;
    state.currentRoomOriginYWorld = 0;
  }
}

/**
 * Finalise a seamless crossing: calls loadRoom for the next room, then
 * re-appends the previous room's walls at the correct offset so it remains
 * visible (and collidable) behind the player.
 *
 * For right/down exits the world is shifted after loadRoom so the previous
 * room occupies positive coordinates.
 */
export function finalizeCrossingSeamless(
  state: SeamlessStagingState,
  world: WorldState,
  camera: CameraState,
  prevClusterPosX: Float32Array,
  prevClusterPosY: Float32Array,
  crossingState: TwoRoomCrossingState,
  loadRoom: (room: RoomDef, spawnXBlock: number, spawnYBlock: number, preserveCamera: boolean) => void,
): void {
  const player = world.clusters[0];
  if (player === undefined) return;

  const BS = BLOCK_SIZE_MEDIUM;
  const prevRoom   = crossingState.currentRoom!;
  const nextRoom_  = crossingState.nextRoom!;
  const nextOriginX = crossingState.nextRoomOriginXWorld;
  const nextOriginY = crossingState.nextRoomOriginYWorld;

  // Save velocity.
  const savedVelX = player.velocityXWorld;
  const savedVelY = player.velocityYWorld;

  // Convert player to next-room local block coords.
  const nextLocalX = player.positionXWorld - nextOriginX;
  const nextLocalY = player.positionYWorld - nextOriginY;
  const spawnXBlock = Math.max(0, Math.floor(nextLocalX / BS));
  const spawnYBlock = Math.max(0, Math.floor(nextLocalY / BS));

  // Save camera in next-room local coords.
  const savedCamX = camera.centerXWorld - nextOriginX;
  const savedCamY = camera.centerYWorld - nextOriginY;

  // loadRoom resets world, spawns player at spawnBlock, clears crossingState
  // and stagedRooms (via Phase A).
  loadRoom(nextRoom_, spawnXBlock, spawnYBlock, /* preserveCamera */ true);

  // Restore camera (prevents snap).
  camera.centerXWorld = savedCamX;
  camera.centerYWorld = savedCamY;

  // Restore player velocity.
  const newPlayer = world.clusters[0];
  if (newPlayer !== undefined && newPlayer.isPlayerFlag === 1) {
    newPlayer.velocityXWorld = savedVelX;
    newPlayer.velocityYWorld = savedVelY;
  }

  // ── Post-loadRoom: place the prev room as a staged room ────────────────
  // After loadRoom the active (next) room is at local [0, nextW] × [0, nextH].
  // We derive the previous room's origin from the crossing-state geometry so
  // offset door openings remain aligned — the direction-only approach used
  // before this fix ignored the row/column delta between the two transition
  // openings, causing visual misalignment.
  //
  // In crossing-world-space:
  //   prev room origin  = (shiftXWorld, shiftYWorld)
  //   next room origin  = (nextRoomOriginXWorld, nextRoomOriginYWorld)
  //
  // After loadRoom, "crossing-world-space" maps to next-room-local-space as:
  //   localX = crossingX - nextRoomOriginXWorld
  //   localY = crossingY - nextRoomOriginYWorld
  //
  // So the prev room origin in next-room-local space is:
  const prevOriginNextLocalX =
    crossingState.shiftXWorld - crossingState.nextRoomOriginXWorld;
  const prevOriginNextLocalY =
    crossingState.shiftYWorld - crossingState.nextRoomOriginYWorld;

  // Normalise so no room has negative world coordinates (physics invariant).
  const normalizeShiftX = Math.max(0, -prevOriginNextLocalX);
  const normalizeShiftY = Math.max(0, -prevOriginNextLocalY);

  if (normalizeShiftX !== 0 || normalizeShiftY !== 0) {
    shiftWorldCoords(
      world,
      camera,
      prevClusterPosX,
      prevClusterPosY,
      normalizeShiftX,
      normalizeShiftY,
    );
  }

  state.currentRoomOriginXWorld = normalizeShiftX;
  state.currentRoomOriginYWorld = normalizeShiftY;

  const prevOriginXWorld = prevOriginNextLocalX + normalizeShiftX;
  const prevOriginYWorld = prevOriginNextLocalY + normalizeShiftY;

  const prevRoomW = prevRoom.widthBlocks  * BS;
  const prevRoomH = prevRoom.heightBlocks * BS;
  const nextRoomW = nextRoom_.widthBlocks  * BS;
  const nextRoomH = nextRoom_.heightBlocks * BS;

  // Append prev room walls at the computed offset.
  const wallStartIndex = world.wallCount;
  appendRoomWallsAtOffset(world, prevRoom, prevOriginXWorld, prevOriginYWorld);

  // Expand world bounds to the AABB union of both rooms.
  world.worldWidthWorld  = Math.max(
    state.currentRoomOriginXWorld + nextRoomW,
    prevOriginXWorld + prevRoomW,
  );
  world.worldHeightWorld = Math.max(
    state.currentRoomOriginYWorld + nextRoomH,
    prevOriginYWorld + prevRoomH,
  );

  // Record the staged room.
  state.stagedRooms = [{
    room: prevRoom,
    originXWorld: prevOriginXWorld,
    originYWorld: prevOriginYWorld,
    wallStartIndex,
  }];
}

// ── Camera bounds helper ───────────────────────────────────────────────────────

/**
 * Returns the AABB union of the active room and all staged rooms, or null if
 * no staged rooms are present.  Used for camera clamping and the crossing clip
 * rect during the post-crossing staging window.
 */
export function computeStagingUnionBounds(
  state: SeamlessStagingState,
  currentRoom: RoomDef,
): { minXWorld: number; minYWorld: number; maxXWorld: number; maxYWorld: number } | null {
  if (state.stagedRooms.length === 0) return null;

  const BS = BLOCK_SIZE_MEDIUM;
  let minX = state.currentRoomOriginXWorld;
  let minY = state.currentRoomOriginYWorld;
  let maxX = state.currentRoomOriginXWorld + currentRoom.widthBlocks  * BS;
  let maxY = state.currentRoomOriginYWorld + currentRoom.heightBlocks * BS;

  for (const sr of state.stagedRooms) {
    if (sr.originXWorld < minX) minX = sr.originXWorld;
    if (sr.originYWorld < minY) minY = sr.originYWorld;
    const srMaxX = sr.originXWorld + sr.room.widthBlocks  * BS;
    const srMaxY = sr.originYWorld + sr.room.heightBlocks * BS;
    if (srMaxX > maxX) maxX = srMaxX;
    if (srMaxY > maxY) maxY = srMaxY;
  }

  return { minXWorld: minX, minYWorld: minY, maxXWorld: maxX, maxYWorld: maxY };
}
