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
  /** Saves all editor/map changes and exports the complete active campaign. */
  onSaveAndExportCampaign?: () => void;
  /** Called whenever world-map metadata is mutated (rename, move, add room/world, door link). */
  onWorldMapDataChanged?: () => void;
  /**
   * Called when a brand-new room was registered and placed by the visual map
   * (header "+ Add Room", or double-click-unlinked-door "Create Linked Room").
   * The RoomDef reflects final state (including any reciprocal transition
   * link already applied) and must be persisted as a newly created room.
   */
  onRoomCreated?: (roomDef: RoomDef) => void;
  /**
   * Called when an existing (already-persisted) room's transition target was
   * mutated by the visual map — either as the reciprocal side of a newly
   * created linked room, or as one side of linking two existing doors.
   * Must be synchronized into persisted storage (or into the currently open
   * room's state if that room is the one affected) without discarding any
   * other unsaved content.
   */
  onRoomTransitionLinked?: (
    roomId: string,
    transitionIndex: number,
    targetRoomId: string,
    targetSpawnBlock: readonly [number, number],
  ) => void;
}

// ── Room name / world lookup helpers ─────────────────────────────────────────

export function effectiveRoomName(roomId: string): string {
  return ROOM_NAME_OVERRIDES.get(roomId) ?? (ROOM_REGISTRY.get(roomId)?.name ?? roomId);
}

export function effectiveWorldId(roomId: string): number {
  return ROOM_WORLD_OVERRIDES.get(roomId) ?? (ROOM_REGISTRY.get(roomId)?.worldNumber ?? 0);
}

export function worldDisplayName(worldId: number): string {
  return WORLD_NAMES.get(worldId) ?? `Zone ${worldId}`;
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
 * Returns the door's logical anchor in map-world coordinates given its containing
 * room's current placement.
 *
 * The anchor is placed exactly on the relevant room edge (left=cx, right=cx+roomW,
 * top=cy, bottom=cy+roomH) so that when two rooms snap together via opposite doors
 * the result is flush wall-to-wall placement with zero overlap and zero gap.
 *
 * The perpendicular coordinate is the centre of the opening along that edge.
 */
export function getDoorCenterWorld(
  trans: RoomTransitionDef,
  placement: MapRoomPlacement,
): [number, number] {
  const cx = placement.mapXWorld;
  const cy = placement.mapYWorld;
  const rw = placement.room.widthBlocks;
  const rh = placement.room.heightBlocks;
  const isHoriz = trans.direction === 'left' || trans.direction === 'right';
  const xB = trans.xBlock !== undefined ? trans.xBlock : (isHoriz ? 0 : trans.positionBlock);
  const yB = trans.yBlock !== undefined ? trans.yBlock : (isHoriz ? trans.positionBlock : 0);

  switch (trans.direction) {
    // Horizontal transitions: anchor is on the left or right room edge.
    case 'right': return [cx + rw, cy + yB + trans.openingSizeBlocks / 2];
    case 'left':  return [cx,      cy + yB + trans.openingSizeBlocks / 2];
    // Vertical transitions: anchor is on the top or bottom room edge.
    case 'down':  return [cx + xB + trans.openingSizeBlocks / 2, cy + rh];
    case 'up':    return [cx + xB + trans.openingSizeBlocks / 2, cy];
  }
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

// ── Direction / adjacency helpers ─────────────────────────────────────────────

/**
 * Returns the direction facing the opposite way.
 * right ↔ left, up ↔ down.
 */
export function getOppositeDirection(dir: TransitionDirection): TransitionDirection {
  switch (dir) {
    case 'right': return 'left';
    case 'left':  return 'right';
    case 'up':    return 'down';
    case 'down':  return 'up';
  }
}

/**
 * Computes the map-world position at which a newly created room should be
 * placed so that it sits directly adjacent to `sourceRoomId` on the side
 * indicated by `direction`.
 *
 * The gap between rooms defaults to 2 world units so the rooms appear
 * visually touching on the visual map.
 *
 * Returns `null` when the source room has no registered map position.
 */
export function getAdjacentRoomMapPosition(
  sourceRoomId: string,
  direction: TransitionDirection,
  newRoomWidthBlocks: number,
  newRoomHeightBlocks: number,
): { mapX: number; mapY: number } | null {
  const sourcePos = WORLD_MAP_POSITIONS.get(sourceRoomId);
  const sourceRoom = ROOM_REGISTRY.get(sourceRoomId);
  if (!sourcePos || !sourceRoom) return null;

  const GAP_WORLD = 2; // world units between adjacent rooms on the visual map
  switch (direction) {
    case 'right':
      return { mapX: sourcePos.mapX + sourceRoom.widthBlocks + GAP_WORLD, mapY: sourcePos.mapY };
    case 'left':
      return { mapX: sourcePos.mapX - newRoomWidthBlocks - GAP_WORLD, mapY: sourcePos.mapY };
    case 'down':
      return { mapX: sourcePos.mapX, mapY: sourcePos.mapY + sourceRoom.heightBlocks + GAP_WORLD };
    case 'up':
      return { mapX: sourcePos.mapX, mapY: sourcePos.mapY - newRoomHeightBlocks - GAP_WORLD };
  }
}

/**
 * Searches for the nearest map-world position to `idealPos` that does not
 * overlap any existing room in `placements`.  Searches in a small expanding
 * grid spiral up to `maxRadius` steps.
 *
 * Returns `idealPos` if no overlap is found there, otherwise the nearest free
 * position.  Falls back to `idealPos` if no free position is found within
 * the search radius.
 */
export function findNearestNonOverlappingRoomPlacement(
  idealPos: { mapX: number; mapY: number },
  placements: ReadonlyMap<string, MapRoomPlacement>,
  newRoomWidthBlocks: number,
  newRoomHeightBlocks: number,
): { mapX: number; mapY: number } {
  const STEP_WORLD = 10; // world units per spiral candidate step
  const MAX_RADIUS_RINGS = 6; // number of concentric rings to search

  const overlaps = (mx: number, my: number): boolean => {
    const r1x1 = mx;
    const r1y1 = my;
    const r1x2 = mx + newRoomWidthBlocks;
    const r1y2 = my + newRoomHeightBlocks;
    for (const [, p] of placements) {
      const r2x1 = p.mapXWorld;
      const r2y1 = p.mapYWorld;
      const r2x2 = p.mapXWorld + p.room.widthBlocks;
      const r2y2 = p.mapYWorld + p.room.heightBlocks;
      if (r1x1 < r2x2 && r1x2 > r2x1 && r1y1 < r2y2 && r1y2 > r2y1) return true;
    }
    return false;
  };

  if (!overlaps(idealPos.mapX, idealPos.mapY)) return idealPos;

  // Spiral outward in a grid pattern
  for (let radius = 1; radius <= MAX_RADIUS_RINGS; radius++) {
    const size = radius * 2 + 1;
    for (let di = 0; di < size * size; di++) {
      const col = (di % size) - radius;
      const row = Math.floor(di / size) - radius;
      // Only check the perimeter of each radius ring
      if (Math.abs(col) !== radius && Math.abs(row) !== radius) continue;
      const cx = idealPos.mapX + col * STEP_WORLD;
      const cy = idealPos.mapY + row * STEP_WORLD;
      if (!overlaps(cx, cy)) return { mapX: cx, mapY: cy };
    }
  }

  return idealPos;
}
