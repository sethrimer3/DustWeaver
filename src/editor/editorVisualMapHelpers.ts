/**
 * Shared helpers for the visual world map editor.
 *
 * Pure utility functions and types extracted from editorVisualMap.ts to
 * keep that file focused on interaction and rendering.
 */

import type { RoomDef, RoomTransitionDef, TransitionDirection } from '../levels/roomDef';
import {
  ROOM_REGISTRY,
  WORLD_NAMES,
  WORLD_MAP_POSITIONS,
  ROOM_NAME_OVERRIDES,
  ROOM_WORLD_OVERRIDES,
} from '../levels/rooms';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MapRoomPlacement {
  room: RoomDef;
  mapXWorld: number;
  mapYWorld: number;
}

export interface VisualMapCallbacks {
  /** Called when the user wants to jump to a room (double-click). */
  onJumpToRoom: (room: RoomDef) => void;
  /** Called when the visual map closes. */
  onClose: () => void;
  /** Called whenever world-map metadata is mutated (rename, move, add room/world, door link). */
  onWorldMapDataChanged?: () => void;
}

// ── Room name / world lookup helpers ─────────────────────────────────────────

export function effectiveRoomName(roomId: string): string {
  return ROOM_NAME_OVERRIDES.get(roomId) ?? (ROOM_REGISTRY.get(roomId)?.name ?? roomId);
}

export function effectiveWorldId(roomId: string): number {
  return ROOM_WORLD_OVERRIDES.get(roomId) ?? (ROOM_REGISTRY.get(roomId)?.worldNumber ?? 0);
}

export function worldDisplayName(worldId: number): string {
  return WORLD_NAMES.get(worldId) ?? `World ${worldId}`;
}

// ── Color utilities ───────────────────────────────────────────────────────────

/** Fallback dark-blue fill colour used by hexToRgba when hex parsing fails. */
const HEX_TO_RGBA_FALLBACK_RGB = '30,40,55';

/**
 * Converts a CSS hex colour (#rrggbb or #rgb) to an rgba() string with the
 * given alpha.  Falls back to a dark default when the input is malformed.
 */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  let r: number, g: number, b: number;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  }
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(${HEX_TO_RGBA_FALLBACK_RGB},${alpha})`;
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Auto-layout via BFS ───────────────────────────────────────────────────────

/**
 * Populates `placements` with map positions for all rooms via BFS from the
 * start room, preferring stored positions over BFS-computed ones.
 */
export function computeAutoLayout(
  placements: Map<string, MapRoomPlacement>,
  startRoomId: string,
): void {
  const allRooms: RoomDef[] = [];
  ROOM_REGISTRY.forEach((room) => allRooms.push(room));

  if (allRooms.length === 0) return;

  // Use stored positions from in-memory room metadata cache.
  for (const room of allRooms) {
    const stored = WORLD_MAP_POSITIONS.get(room.id);
    if (stored) {
      placements.set(room.id, { room, mapXWorld: stored.mapX, mapYWorld: stored.mapY });
    }
  }

  // BFS from start room only, for rooms not yet positioned via stored positions.
  // Stored positions take precedence; BFS only assigns positions to rooms
  // that have no stored position, expanding from the start room outward.
  const startRoom = ROOM_REGISTRY.get(startRoomId) ?? allRooms[0];
  if (!placements.has(startRoom.id)) {
    placements.set(startRoom.id, { room: startRoom, mapXWorld: 0, mapYWorld: 0 });
  }

  const queue: RoomDef[] = [startRoom];
  const visited = new Set<string>([...placements.keys()]);

  const GAP_BLOCKS = 6;

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentPlacement = placements.get(current.id)!;

    for (const transition of current.transitions) {
      if (visited.has(transition.targetRoomId)) continue;
      const targetRoom = ROOM_REGISTRY.get(transition.targetRoomId);
      if (!targetRoom) continue;

      let offsetX = 0;
      let offsetY = 0;
      if (transition.direction === 'right') {
        offsetX = current.widthBlocks + GAP_BLOCKS;
      } else if (transition.direction === 'left') {
        offsetX = -(targetRoom.widthBlocks + GAP_BLOCKS);
      } else if (transition.direction === 'down') {
        offsetY = current.heightBlocks + GAP_BLOCKS;
      } else if (transition.direction === 'up') {
        offsetY = -(targetRoom.heightBlocks + GAP_BLOCKS);
      }

      placements.set(targetRoom.id, {
        room: targetRoom,
        mapXWorld: currentPlacement.mapXWorld + offsetX,
        mapYWorld: currentPlacement.mapYWorld + offsetY,
      });
      visited.add(targetRoom.id);
      queue.push(targetRoom);
    }
  }

  // Place any unvisited rooms in a row below all currently placed rooms
  let unvisitedX = 0;
  let maxY = 0;
  for (const [, p] of placements) {
    maxY = Math.max(maxY, p.mapYWorld + p.room.heightBlocks);
  }

  for (const room of allRooms) {
    if (!visited.has(room.id)) {
      placements.set(room.id, {
        room,
        mapXWorld: unvisitedX,
        mapYWorld: maxY + 10,
      });
      unvisitedX += room.widthBlocks + 6;
      visited.add(room.id);
    }
  }
}

// ── Door-snap helpers ─────────────────────────────────────────────────────────

/** Tracks which two doorways are about to snap together during a room drag. */
export interface SnapIndicator {
  srcRoomId: string;
  srcTransIdx: number;
  tgtRoomId: string;
  tgtTransIdx: number;
}

/**
 * Returns the door's centre in map-world coordinates given its containing
 * room's current placement.
 */
export function getDoorCenterWorld(
  trans: RoomTransitionDef,
  placement: MapRoomPlacement,
): [number, number] {
  const room = placement.room;
  const cx = placement.mapXWorld;
  const cy = placement.mapYWorld;
  const mid = trans.positionBlock + trans.openingSizeBlocks / 2;
  const DEPTH = 6;
  if (trans.depthBlock !== undefined) {
    const depthMid = trans.depthBlock + DEPTH / 2;
    if (trans.direction === 'left' || trans.direction === 'right') {
      return [cx + depthMid, cy + mid];
    } else {
      return [cx + mid, cy + depthMid];
    }
  }
  if (trans.direction === 'left')  return [cx,                    cy + mid];
  if (trans.direction === 'right') return [cx + room.widthBlocks,  cy + mid];
  if (trans.direction === 'up')    return [cx + mid,               cy];
  if (trans.direction === 'down')  return [cx + mid,               cy + room.heightBlocks];
  // Exhaustive check for TransitionDirection — should never reach here
  throw new Error(`Unknown transition direction: ${(trans as RoomTransitionDef).direction}`);
}

/** True when direction `a` and `b` face each other (and can be aligned). */
export function isOppositeDoor(a: TransitionDirection, b: TransitionDirection): boolean {
  return (a === 'left'  && b === 'right') ||
         (a === 'right' && b === 'left')  ||
         (a === 'up'    && b === 'down')  ||
         (a === 'down'  && b === 'up');
}

/**
 * Checks all pairs of (dragged-room door, other-room door) for compatible
 * facing pairs within `snapThresholdWorld` world units.  When found, the
 * dragged room's placement is moved so the door centres coincide (seamless
 * wall-to-wall alignment).  Returns a SnapIndicator when snapping occurred.
 *
 * @param snapThresholdWorld  Maximum world-space distance to trigger snap
 *   (typically `SNAP_THRESHOLD_PX / zoom` so the pixel feel is consistent).
 */
export function applyDoorSnap(
  draggingRoomId: string,
  draggingPlacement: MapRoomPlacement,
  allPlacements: Map<string, MapRoomPlacement>,
  snapThresholdWorld: number,
): SnapIndicator | null {
  const draggingRoom = draggingPlacement.room;

  let bestDistWorld = snapThresholdWorld;
  let bestSnap: {
    worldDX: number;
    worldDY: number;
    srcTransIdx: number;
    tgtRoomId: string;
    tgtTransIdx: number;
  } | null = null;

  for (let si = 0; si < draggingRoom.transitions.length; si++) {
    const srcTrans = draggingRoom.transitions[si];
    const [srcWx, srcWy] = getDoorCenterWorld(srcTrans, draggingPlacement);

    for (const [otherId, otherPlacement] of allPlacements) {
      if (otherId === draggingRoomId) continue;
      for (let ti = 0; ti < otherPlacement.room.transitions.length; ti++) {
        const tgtTrans = otherPlacement.room.transitions[ti];
        if (!isOppositeDoor(srcTrans.direction, tgtTrans.direction)) continue;

        const [tgtWx, tgtWy] = getDoorCenterWorld(tgtTrans, otherPlacement);
        const distWorld = Math.hypot(srcWx - tgtWx, srcWy - tgtWy);

        if (distWorld < bestDistWorld) {
          bestDistWorld = distWorld;
          bestSnap = {
            worldDX: tgtWx - srcWx,
            worldDY: tgtWy - srcWy,
            srcTransIdx: si,
            tgtRoomId: otherId,
            tgtTransIdx: ti,
          };
        }
      }
    }
  }

  if (bestSnap) {
    draggingPlacement.mapXWorld += bestSnap.worldDX;
    draggingPlacement.mapYWorld += bestSnap.worldDY;
    return {
      srcRoomId: draggingRoomId,
      srcTransIdx: bestSnap.srcTransIdx,
      tgtRoomId: bestSnap.tgtRoomId,
      tgtTransIdx: bestSnap.tgtTransIdx,
    };
  }
  return null;
}
