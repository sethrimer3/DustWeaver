/**
 * editorVisualMapRenderer.ts — Pure canvas drawing helpers for the visual
 * world-map editor overlay.
 *
 * All functions accept an explicit {@link VisualMapDrawCtx} so they are
 * stateless and can be tested or reused without needing the full
 * `showVisualWorldMap` closure environment.
 *
 * Extracted from editorVisualMap.ts (BUILD 311).
 */

import type { RoomTransitionDef } from '../levels/roomDef';
import type { DoorHitArea } from './editorVisualMapLinkPrompt';
import type { MapRoomPlacement, SnapIndicator } from './editorVisualMapHelpers';
import {
  effectiveRoomName,
  effectiveWorldId,
  worldDisplayName,
  hexToRgba,
  getDoorCenterWorld,
} from './editorVisualMapHelpers';

// ── Draw-call constants ───────────────────────────────────────────────────────

const ROOM_FILL           = 'rgba(30,40,55,0.9)';
const ROOM_STROKE         = 'rgba(0,200,100,0.6)';
const ROOM_CURRENT_FILL   = 'rgba(0,80,40,0.5)';
const ROOM_CURRENT_STROKE = '#00c864';
const ROOM_SELECTED_STROKE = '#ffffff';
const DOOR_SIZE           = 16;
const DOOR_FILL_LINKED    = '#44aaff';
const DOOR_FILL_UNLINKED  = '#ff8844';
const DOOR_FILL_HOVER     = '#ffff44';
const LINK_LINE_COLOR     = 'rgba(100,200,255,0.6)';
const LINK_LINE_ACTIVE    = 'rgba(255,255,100,0.8)';
const TEXT_COLOR          = '#c0ffd0';

/** Highlight color for doorways that are about to snap together. */
export const DOOR_SNAP_COLOR = '#ffe840';

// ── Draw context ─────────────────────────────────────────────────────────────

/**
 * All mutable state from `showVisualWorldMap` that the draw functions need.
 * Built once per `render()` call and passed down to avoid closure coupling.
 */
export interface VisualMapDrawCtx {
  /** World → CSS-pixel converter valid for the current frame. */
  worldToScreen: (xWorld: number, yWorld: number) => [number, number];
  zoom: number;
  roomColorOverrides: Map<string, string>;
  hoveredDoor: DoorHitArea | null;
  linkSourceRoomId: string;
  linkSourceTransIndex: number;
  /** Accumulated door hit-areas for the current frame (mutated by drawDoor). */
  doorHitAreas: DoorHitArea[];
  snapIndicator: SnapIndicator | null;
  /** Mouse X in CSS pixels relative to the canvas top-left corner. */
  adjustedMouseXPx: number;
  /** Mouse Y in CSS pixels relative to the canvas top-left corner. */
  adjustedMouseYPx: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function findDoorHitAreaIn(
  doorHitAreas: DoorHitArea[],
  roomId: string,
  transIndex: number,
): DoorHitArea | null {
  for (const d of doorHitAreas) {
    if (d.roomId === roomId && d.transitionIndex === transIndex) return d;
  }
  return null;
}

/**
 * Screen-space door center, derived from the single shared
 * `getDoorCenterWorld` helper (the same one used for snapping and link
 * lines) so the visual-map square, hitbox, link lines, and snapping can
 * never disagree on where a door is anchored — independent of transition
 * depth.
 */
function getDoorCenterPx(
  trans: RoomTransitionDef,
  placement: MapRoomPlacement,
  worldToScreen: (xWorld: number, yWorld: number) => [number, number],
): [number, number] {
  const [wx, wy] = getDoorCenterWorld(trans, placement);
  return worldToScreen(wx, wy);
}

// ── Exported draw functions ───────────────────────────────────────────────────

/** Draws the rectangle, labels, and door squares for one room. */
export function drawRoom(
  ctx2d: CanvasRenderingContext2D,
  drawCtx: VisualMapDrawCtx,
  placement: MapRoomPlacement,
  isCurrent: boolean,
  isSelected: boolean,
): void {
  const room = placement.room;
  const [sx, sy] = drawCtx.worldToScreen(placement.mapXWorld, placement.mapYWorld);
  const rw = room.widthBlocks * drawCtx.zoom;
  const rh = room.heightBlocks * drawCtx.zoom;

  const customColor = drawCtx.roomColorOverrides.get(room.id);

  // Selection highlight (behind room fill)
  if (isSelected) {
    ctx2d.strokeStyle = customColor ?? ROOM_SELECTED_STROKE;
    ctx2d.lineWidth = 3;
    ctx2d.strokeRect(sx - 3, sy - 3, rw + 6, rh + 6);
  }

  // Room rectangle
  if (customColor) {
    ctx2d.fillStyle = hexToRgba(customColor, isCurrent ? 0.55 : 0.35);
    ctx2d.strokeStyle = customColor;
  } else {
    ctx2d.fillStyle = isCurrent ? ROOM_CURRENT_FILL : ROOM_FILL;
    ctx2d.strokeStyle = isCurrent ? ROOM_CURRENT_STROKE : ROOM_STROKE;
  }
  ctx2d.fillRect(sx, sy, rw, rh);
  ctx2d.lineWidth = isCurrent ? 2 : 1;
  ctx2d.strokeRect(sx, sy, rw, rh);

  // Room name
  const fontSize = Math.max(8, Math.min(12, drawCtx.zoom * 2));
  ctx2d.fillStyle = TEXT_COLOR;
  ctx2d.font = `${fontSize}px monospace`;
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';
  const label = effectiveRoomName(room.id);
  ctx2d.fillText(label, sx + rw / 2, sy + rh / 2 - fontSize * 0.9, rw - 4);

  // Room ID
  ctx2d.fillStyle = 'rgba(200,255,200,0.35)';
  ctx2d.font = `${Math.max(7, fontSize - 2)}px monospace`;
  ctx2d.fillText(room.id, sx + rw / 2, sy + rh / 2 + fontSize * 0.1, rw - 4);

  // World label
  const wId = effectiveWorldId(room.id);
  ctx2d.fillStyle = 'rgba(150,200,255,0.4)';
  ctx2d.font = `${Math.max(6, fontSize - 3)}px monospace`;
  ctx2d.fillText(worldDisplayName(wId), sx + rw / 2, sy + rh / 2 + fontSize * 0.9, rw - 4);

  // Draw doors (transitions)
  for (let i = 0; i < room.transitions.length; i++) {
    drawDoor(ctx2d, drawCtx, placement, i);
  }
}

/** Draws a single door square and pushes its hit-area into `drawCtx.doorHitAreas`. */
export function drawDoor(
  ctx2d: CanvasRenderingContext2D,
  drawCtx: VisualMapDrawCtx,
  placement: MapRoomPlacement,
  transIndex: number,
): void {
  const room = placement.room;
  const trans = room.transitions[transIndex];
  const ds = Math.max(4, Math.min(DOOR_SIZE, drawCtx.zoom * 1.5));

  const [zoneCxPx, zoneCyPx] = getDoorCenterPx(trans, placement, drawCtx.worldToScreen);

  const dx = zoneCxPx - ds / 2;
  const dy = zoneCyPx - ds / 2;

  const isHovered    = drawCtx.hoveredDoor?.roomId === room.id && drawCtx.hoveredDoor?.transitionIndex === transIndex;
  const isLinkSource = drawCtx.linkSourceRoomId === room.id && drawCtx.linkSourceTransIndex === transIndex;
  const hasTarget    = trans.targetRoomId !== '';

  let fill: string;
  if (isLinkSource)   fill = LINK_LINE_ACTIVE;
  else if (isHovered) fill = DOOR_FILL_HOVER;
  else if (hasTarget) fill = DOOR_FILL_LINKED;
  else                fill = DOOR_FILL_UNLINKED;

  ctx2d.fillStyle = fill;
  ctx2d.fillRect(dx, dy, ds, ds);
  ctx2d.strokeStyle = '#fff';
  ctx2d.lineWidth = 1;
  ctx2d.strokeRect(dx, dy, ds, ds);

  const numSize = Math.max(6, ds - 1);
  ctx2d.fillStyle = '#000';
  ctx2d.font = `bold ${numSize}px monospace`;
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';
  ctx2d.fillText(String(transIndex + 1), dx + ds / 2, dy + ds / 2);

  drawCtx.doorHitAreas.push({
    roomId: room.id,
    transitionIndex: transIndex,
    xPx: dx,
    yPx: dy,
    wPx: ds,
    hPx: ds,
  });
}

/** Draws dashed lines between all paired transitions across placements. */
export function drawConnectionLines(
  ctx2d: CanvasRenderingContext2D,
  drawCtx: VisualMapDrawCtx,
  allPlacements: Map<string, MapRoomPlacement>,
): void {
  ctx2d.strokeStyle = LINK_LINE_COLOR;
  ctx2d.lineWidth = 1.5;
  ctx2d.setLineDash([4, 4]);

  const drawn = new Set<string>();

  for (const [roomId, placement] of allPlacements) {
    const room = placement.room;
    for (let i = 0; i < room.transitions.length; i++) {
      const trans = room.transitions[i];
      if (!trans.targetRoomId) continue;

      const targetPlacement = allPlacements.get(trans.targetRoomId);
      if (!targetPlacement) continue;

      const pairKey = [roomId, trans.targetRoomId].sort().join('|');
      if (drawn.has(pairKey)) continue;
      drawn.add(pairKey);

      const srcPos = getDoorCenterPx(trans, placement, drawCtx.worldToScreen);

      const targetRoom = targetPlacement.room;
      const reverseTrans = targetRoom.transitions.find(t => t.targetRoomId === roomId);
      const [tsx, tsy] = drawCtx.worldToScreen(targetPlacement.mapXWorld, targetPlacement.mapYWorld);
      const trw = targetRoom.widthBlocks * drawCtx.zoom;

      let tgtPos: [number, number];
      if (reverseTrans) {
        tgtPos = getDoorCenterPx(reverseTrans, targetPlacement, drawCtx.worldToScreen);
      } else {
        tgtPos = [tsx + trw / 2, tsy + (targetRoom.heightBlocks * drawCtx.zoom) / 2];
      }

      ctx2d.beginPath();
      ctx2d.moveTo(srcPos[0], srcPos[1]);
      ctx2d.lineTo(tgtPos[0], tgtPos[1]);
      ctx2d.stroke();
    }
  }

  ctx2d.setLineDash([]);
}

/** Draws the animated dashed line from the selected door to the current mouse position. */
export function drawActiveLinkLine(
  ctx2d: CanvasRenderingContext2D,
  drawCtx: VisualMapDrawCtx,
): void {
  const sourceDoor = findDoorHitAreaIn(
    drawCtx.doorHitAreas,
    drawCtx.linkSourceRoomId,
    drawCtx.linkSourceTransIndex,
  );
  if (!sourceDoor) return;

  const srcCx = sourceDoor.xPx + sourceDoor.wPx / 2;
  const srcCy = sourceDoor.yPx + sourceDoor.hPx / 2;

  ctx2d.strokeStyle = LINK_LINE_ACTIVE;
  ctx2d.lineWidth = 2;
  ctx2d.setLineDash([6, 3]);
  ctx2d.beginPath();
  ctx2d.moveTo(srcCx, srcCy);
  ctx2d.lineTo(drawCtx.adjustedMouseXPx, drawCtx.adjustedMouseYPx);
  ctx2d.stroke();
  ctx2d.setLineDash([]);
}

/** Draws a visual snap indicator for the two doorways about to be aligned. */
export function drawSnapIndicator(
  ctx2d: CanvasRenderingContext2D,
  drawCtx: VisualMapDrawCtx,
): void {
  const snap = drawCtx.snapIndicator;
  if (!snap) return;

  const srcDoor = findDoorHitAreaIn(drawCtx.doorHitAreas, snap.srcRoomId, snap.srcTransIdx);
  const tgtDoor = findDoorHitAreaIn(drawCtx.doorHitAreas, snap.tgtRoomId, snap.tgtTransIdx);
  if (!srcDoor || !tgtDoor) return;

  const srcCx = srcDoor.xPx + srcDoor.wPx / 2;
  const srcCy = srcDoor.yPx + srcDoor.hPx / 2;
  const tgtCx = tgtDoor.xPx + tgtDoor.wPx / 2;
  const tgtCy = tgtDoor.yPx + tgtDoor.hPx / 2;

  // Highlight glow around both snapping doors
  for (const door of [srcDoor, tgtDoor]) {
    ctx2d.save();
    ctx2d.globalAlpha = 0.55;
    ctx2d.fillStyle = DOOR_SNAP_COLOR;
    ctx2d.fillRect(door.xPx - 3, door.yPx - 3, door.wPx + 6, door.hPx + 6);
    ctx2d.restore();
  }

  // Solid snap-line between the two door centers
  ctx2d.save();
  ctx2d.strokeStyle = DOOR_SNAP_COLOR;
  ctx2d.lineWidth = 2;
  ctx2d.setLineDash([]);
  ctx2d.beginPath();
  ctx2d.moveTo(srcCx, srcCy);
  ctx2d.lineTo(tgtCx, tgtCy);
  ctx2d.stroke();
  ctx2d.restore();

  // "SNAP" label at midpoint
  const midX = (srcCx + tgtCx) / 2;
  const midY = (srcCy + tgtCy) / 2;
  ctx2d.save();
  ctx2d.fillStyle = DOOR_SNAP_COLOR;
  ctx2d.font = 'bold 9px monospace';
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';
  ctx2d.fillText('SNAP', midX, midY - 8);
  ctx2d.restore();
}
