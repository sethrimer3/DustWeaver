/**
 * gameRenderAdjacentRooms.ts — Render-only draw pass for the radius-1
 * "Render Adjacent Rooms" view.
 *
 * Draws each ready adjacent-room instance (background colour, background blocks,
 * and wall/structural geometry) clipped to its own screen rectangle, positioned
 * from the SINGLE active-room camera offset so every room origin is integer and
 * seam-free. Adjacent rooms are drawn BEFORE the active room's clipped pass (in
 * gameRender) and in deterministic order, so a malformed overlapping layout can
 * never cover the player's active room.
 *
 * Terrain only — no entities, particles, HUD, lighting effects, or simulation.
 * The frozen neighbour worlds never tick.
 *
 * This module contains only orchestration and imports NO canvas/renderer code,
 * so it stays Node-testable. The actual non-destructive per-room chunk drawing
 * is injected as an `AdjacentRoomDrawImpl` (see `gameRenderAdjacentRoomsImpl.ts`
 * for the production binding).
 */

import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import type { WallSnapshot } from '../render/snapshot';
import {
  isInstanceVisible,
  type ConnectedRoomInstance,
  type WorldRect,
} from '../render/adjacent/connectedRoomLayout';
import type { ConnectedRoomRenderState } from '../render/adjacent/adjacentRoomView';

/** Environment access for resolving each neighbour's render inputs. */
export interface AdjacentRoomDrawPorts {
  /** Resolve a room definition by id (null if unknown/unloaded). */
  resolveRoomDef: (roomId: string) => RoomDef | null;
  /**
   * Resolve the wall snapshot to draw for a neighbour — preferring a valid
   * frozen resident world (dynamic structural state) then the baked wall
   * template. Null when no safe render data exists (keep void/transition).
   */
  resolveWallSnapshot: (roomId: string, roomDef: RoomDef) => WallSnapshot | null;
  /** Authored background colour for a room's clipped fill (null → skip fill). */
  resolveBgColor: (roomDef: RoomDef) => string | null;
}

/**
 * Injected canvas primitives. Kept as an explicit interface (not `typeof`) so
 * this module never imports the renderer graph. `drawWall` builds its own
 * WallPrewarmContext internally from the room + snapshot.
 */
export interface AdjacentRoomDrawImpl {
  drawBg: (
    ctx: CanvasRenderingContext2D, room: RoomDef, zoom: number,
    offXPx: number, offYPx: number,
    clipXPx: number, clipYPx: number, clipWPx: number, clipHPx: number,
    vpWPx: number, vpHPx: number, maxChunks: number,
  ) => void;
  drawWall: (
    ctx: CanvasRenderingContext2D, roomId: string, room: RoomDef, wallSnapshot: WallSnapshot,
    offXPx: number, offYPx: number,
    clipXPx: number, clipYPx: number, clipWPx: number, clipHPx: number,
    vpWPx: number, vpHPx: number, zoom: number, blockSizePx: number, maxChunks: number,
  ) => void;
}

export interface AdjacentRoomDrawParams {
  ctx: CanvasRenderingContext2D;
  state: ConnectedRoomRenderState;
  /** Active-room camera offset (screen px) and zoom. */
  ox: number;
  oy: number;
  zoom: number;
  vpWPx: number;
  vpHPx: number;
  /** Per-room per-frame chunk build budget (keeps transitions hitch-free). */
  maxChunksPerRoom: number;
  ports: AdjacentRoomDrawPorts;
  impl: AdjacentRoomDrawImpl;
  /** Viewport cull safety margin in world units (default 1 block). */
  cullMarginWorld?: number;
}

export interface AdjacentRoomDrawStats {
  drawn: number;
  culled: number;
  skippedNoData: number;
}

/** World-space camera view rectangle derived from the active-room offset. */
function cameraViewWorldRect(ox: number, oy: number, zoom: number, vpWPx: number, vpHPx: number): WorldRect {
  return { x: -ox / zoom, y: -oy / zoom, width: vpWPx / zoom, height: vpHPx / zoom };
}

/** Deterministic draw order so overlapping malformed layouts are stable. */
function orderedViews(state: ConnectedRoomRenderState): ConnectedRoomInstance[] {
  const instances = state.views.filter((v) => v.ready).map((v) => v.instance);
  instances.sort((a, b) => (a.instanceKey < b.instanceKey ? -1 : a.instanceKey > b.instanceKey ? 1 : 0));
  return instances;
}

/**
 * Draw every visible, ready adjacent-room instance. Returns per-frame stats for
 * DEV diagnostics. No-ops cheaply when the render state is empty.
 */
export function renderAdjacentRoomsPass(params: AdjacentRoomDrawParams): AdjacentRoomDrawStats {
  const { ctx, state, ox, oy, zoom, vpWPx, vpHPx, maxChunksPerRoom, ports, impl } = params;
  const cullMarginWorld = params.cullMarginWorld ?? BLOCK_SIZE_SMALL;
  const stats: AdjacentRoomDrawStats = { drawn: 0, culled: 0, skippedNoData: 0 };
  if (state.views.length === 0) return stats;

  const view = cameraViewWorldRect(ox, oy, zoom, vpWPx, vpHPx);
  const bs = BLOCK_SIZE_SMALL;

  for (const instance of orderedViews(state)) {
    if (!isInstanceVisible(instance, view, cullMarginWorld)) {
      stats.culled++;
      continue;
    }
    const roomDef = ports.resolveRoomDef(instance.targetRoomId);
    if (roomDef === null) { stats.skippedNoData++; continue; }
    const wallSnapshot = ports.resolveWallSnapshot(instance.targetRoomId, roomDef);
    if (wallSnapshot === null) { stats.skippedNoData++; continue; }

    // All offsets derive from the single camera offset + integer world origin.
    const roomOffsetXPx = ox + instance.originXWorld * zoom;
    const roomOffsetYPx = oy + instance.originYWorld * zoom;
    const clipXPx = roomOffsetXPx;
    const clipYPx = roomOffsetYPx;
    const clipWPx = instance.targetWidthBlocks * bs * zoom;
    const clipHPx = instance.targetHeightBlocks * bs * zoom;

    // 1. Authored background colour, clipped to this room.
    const bgColor = ports.resolveBgColor(roomDef);
    if (bgColor !== null && bgColor !== '#000000') {
      ctx.save();
      try {
        ctx.beginPath();
        ctx.rect(clipXPx, clipYPx, clipWPx, clipHPx);
        ctx.clip();
        ctx.fillStyle = bgColor;
        ctx.fillRect(clipXPx, clipYPx, clipWPx, clipHPx);
      } finally {
        ctx.restore();
      }
    }

    // 2. Background blocks (visual-only, behind walls).
    impl.drawBg(
      ctx, roomDef, zoom, roomOffsetXPx, roomOffsetYPx,
      clipXPx, clipYPx, clipWPx, clipHPx, vpWPx, vpHPx, maxChunksPerRoom,
    );

    // 3. Wall / structural geometry.
    impl.drawWall(
      ctx, instance.targetRoomId, roomDef, wallSnapshot, roomOffsetXPx, roomOffsetYPx,
      clipXPx, clipYPx, clipWPx, clipHPx, vpWPx, vpHPx, zoom, bs, maxChunksPerRoom,
    );

    stats.drawn++;
  }

  return stats;
}
