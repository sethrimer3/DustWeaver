/**
 * Visual World Map Editor — a canvas-based overlay for arranging rooms and
 * linking transitions visually.
 *
 * Opens via the "N" key in editor mode. Rooms are displayed as rectangles
 * proportional to their block dimensions. Doors (transitions) appear as
 * small colored squares on the edges. Rooms can be dragged to rearrange.
 * Doors can be clicked to initiate or complete a link.
 *
 * Room positions, world names, and room name/world overrides are persisted
 * via the "Export World Map" button, which downloads world-map.json.
 *
 * Selecting a room (single click) and pressing arrow keys nudges it by
 * 1 map world unit per keypress.
 */

import { ROOM_REGISTRY } from '../levels/rooms';
import {
  WORLD_NAMES,
  WORLD_MAP_POSITIONS,
  ROOM_NAME_OVERRIDES,
  ROOM_WORLD_OVERRIDES,
  setWorldName,
  setRoomMapPosition,
  setRoomNameOverride,
  setRoomWorldOverride,
  registerRoom,
} from '../levels/rooms';
import type { RoomDef, RoomTransitionDef, TransitionDirection } from '../levels/roomDef';
import { roomJsonDefToRoomDef } from '../levels/roomJsonLoader';
import { exportWorldMapJson } from './editorExport';
import { createSubstrateEffect } from '../render/effects/substrateEffect';

// ── Constants ────────────────────────────────────────────────────────────────

const PANEL_BG = '#0a0a0f';
const ROOM_FILL = 'rgba(30,40,55,0.9)';
const ROOM_STROKE = 'rgba(0,200,100,0.6)';
const ROOM_CURRENT_FILL = 'rgba(0,80,40,0.5)';
const ROOM_CURRENT_STROKE = '#00c864';
const ROOM_SELECTED_STROKE = '#ffffff';
const DOOR_SIZE = 8;
const DOOR_FILL_LINKED = '#44aaff';
const DOOR_FILL_UNLINKED = '#ff8844';
const DOOR_FILL_HOVER = '#ffff44';
const LINK_LINE_COLOR = 'rgba(100,200,255,0.6)';
const LINK_LINE_ACTIVE = 'rgba(255,255,100,0.8)';
const TEXT_COLOR = '#c0ffd0';
const GREEN = '#00c864';

/** Screen-pixel distance within which two facing doorways snap together. */
const SNAP_THRESHOLD_PX = 40;
/** Highlight color for doorways that are about to snap together. */
const DOOR_SNAP_COLOR = '#ffe840';
/** Preset palette offered in the room color picker. */
const COLOR_PRESETS = [
  '#1e2837', '#1a3020', '#2a1a20', '#2a2010', '#18202a',
  '#004080', '#006040', '#602000', '#400060', '#604010',
  '#0050a0', '#00884c', '#c84000', '#8800c8', '#c8a000',
];
/** Outline used for the currently selected colour swatch in the picker. */
const SWATCH_SELECTED_OUTLINE = '2px solid #fff';
/** Default outline for unselected colour swatches in the picker. */
const SWATCH_DEFAULT_OUTLINE = '1px solid rgba(255,255,255,0.2)';
/** Fallback dark-blue fill colour used by hexToRgba when hex parsing fails. */
const HEX_TO_RGBA_FALLBACK_RGB = '30,40,55';

/** Scale factor: screen pixels per map world unit at default zoom. */
const DEFAULT_ZOOM_SCALE = 4;

// ── Types ────────────────────────────────────────────────────────────────────

interface MapRoomPlacement {
  room: RoomDef;
  mapXWorld: number;
  mapYWorld: number;
}

interface DoorHitArea {
  roomId: string;
  transitionIndex: number;
  xPx: number;
  yPx: number;
  wPx: number;
  hPx: number;
}

/** Tracks which two doorways are about to snap together during a room drag. */
interface SnapIndicator {
  srcRoomId: string;
  srcTransIdx: number;
  tgtRoomId: string;
  tgtTransIdx: number;
}

// ── Callbacks ────────────────────────────────────────────────────────────────

export interface VisualMapCallbacks {
  /** Called when the user wants to jump to a room (double-click). */
  onJumpToRoom: (room: RoomDef) => void;
  /** Called when the visual map closes. */
  onClose: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function effectiveRoomName(roomId: string): string {
  return ROOM_NAME_OVERRIDES.get(roomId) ?? (ROOM_REGISTRY.get(roomId)?.name ?? roomId);
}

function effectiveWorldId(roomId: string): number {
  return ROOM_WORLD_OVERRIDES.get(roomId) ?? (ROOM_REGISTRY.get(roomId)?.worldNumber ?? 0);
}

function worldDisplayName(worldId: number): string {
  return WORLD_NAMES.get(worldId) ?? `World ${worldId}`;
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Creates and shows the visual world map editor overlay.
 * Returns a cleanup function.
 */
export function showVisualWorldMap(
  root: HTMLElement,
  currentRoomId: string,
  callbacks: VisualMapCallbacks,
): () => void {
  // ── Create overlay ─────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: ${PANEL_BG};
    z-index: 1100;
    display: flex; flex-direction: column;
  `;

  // ── Header bar ─────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 8px 16px; background: rgba(0,0,0,0.5);
    border-bottom: 1px solid rgba(0,200,100,0.3);
  `;

  const titleEl = document.createElement('span');
  titleEl.textContent = '🗺 Visual World Map Editor';
  titleEl.style.cssText = `color: ${GREEN}; font-family: 'Cinzel', serif; font-size: 14px; font-weight: bold; margin-right: 8px;`;
  header.appendChild(titleEl);

  function makeHeaderBtn(label: string, color: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      background: rgba(0,0,0,0.4); color: ${color}; border: 1px solid ${color};
      font-family: monospace; font-size: 11px; cursor: pointer; border-radius: 3px;
      padding: 3px 8px; white-space: nowrap;
    `;
    return btn;
  }

  const addRoomBtn = makeHeaderBtn('+ Add Room', '#44cc88');
  addRoomBtn.title = 'Create a new blank room';
  addRoomBtn.addEventListener('click', () => showAddRoomDialog());
  header.appendChild(addRoomBtn);

  const addWorldBtn = makeHeaderBtn('+ Add World', '#6688cc');
  addWorldBtn.title = 'Create a new world group';
  addWorldBtn.addEventListener('click', () => showAddWorldDialog());
  header.appendChild(addWorldBtn);

  const exportBtn = makeHeaderBtn('\u2b07 Export World Map', '#cccc44');
  exportBtn.title = 'Download world-map.json — place it in ASSETS/ROOMS/ to persist changes';
  exportBtn.addEventListener('click', () => {
    // Flush current placement positions before export
    for (const [roomId, placement] of placements) {
      setRoomMapPosition(roomId, placement.mapXWorld, placement.mapYWorld);
    }
    exportWorldMapJson();
    statusBar.textContent = 'world-map.json downloaded — save it to ASSETS/ROOMS/ to persist.';
    statusBar.style.color = '#cccc44';
  });
  header.appendChild(exportBtn);

  const hintEl = document.createElement('span');
  hintEl.textContent = 'Drag rooms \u2022 Doors snap when close \u2022 Click door to link \u2022 Double-click to jump \u2022 Right-click room for options \u2022 Arrow keys nudge selected \u2022 N/ESC to close';
  hintEl.style.cssText = `color: rgba(200,255,200,0.4); font-size: 10px; font-family: monospace; margin-left: auto;`;
  header.appendChild(hintEl);

  const closeBtn = makeHeaderBtn('\u2715 Close', '#ff8888');
  closeBtn.addEventListener('click', () => {
    destroy();
    callbacks.onClose();
  });
  header.appendChild(closeBtn);

  overlay.appendChild(header);

  // ── Status bar (below header) ──────────────────────────────────────────
  const statusBar = document.createElement('div');
  statusBar.style.cssText = `
    padding: 4px 16px; background: rgba(0,0,0,0.3);
    border-bottom: 1px solid rgba(0,200,100,0.15);
    color: rgba(200,255,200,0.6); font-size: 11px; font-family: monospace;
    min-height: 20px;
  `;
  statusBar.textContent = 'Ready \u2014 right-click a room to rename or move it between worlds';
  overlay.appendChild(statusBar);

  // ── Canvas ─────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'flex: 1; cursor: grab;';
  overlay.appendChild(canvas);

  root.appendChild(overlay);

  const ctx = canvas.getContext('2d')!;

  // ── Substrate background effect ────────────────────────────────────────
  const substrateEffect = createSubstrateEffect();

  // ── Per-room color overrides (in-session, not persisted) ──────────────
  const roomColorOverrides = new Map<string, string>();

  // ── Compute room placements ────────────────────────────────────────────
  const placements = new Map<string, MapRoomPlacement>();
  computeAutoLayout(placements, currentRoomId);

  // ── View state ─────────────────────────────────────────────────────────
  let zoom = DEFAULT_ZOOM_SCALE;
  let panXPx = 0;
  let panYPx = 0;
  let isDraggingRoom = false;
  let dragRoomId = '';
  let isDraggingPan = false;
  let dragStartXPx = 0;
  let dragStartYPx = 0;
  let dragStartPanXPx = 0;
  let dragStartPanYPx = 0;
  let dragRoomStartXPx = 0;
  let dragRoomStartYPx = 0;

  // Selection
  let selectedRoomId = '';

  // Door linking state
  let linkSourceRoomId = '';
  let linkSourceTransIndex = -1;
  let hoveredDoor: DoorHitArea | null = null;

  // Active door snap indicator (shown while dragging near a compatible doorway)
  let snapIndicator: SnapIndicator | null = null;

  // Door hit areas (rebuilt every frame)
  let doorHitAreas: DoorHitArea[] = [];

  // Center on current room
  centerOnRoom(currentRoomId);

  // ── Resize handler ─────────────────────────────────────────────────────
  function resizeCanvas(): void {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    render();
  }
  const resizeObserver = new ResizeObserver(() => resizeCanvas());
  resizeObserver.observe(canvas);
  requestAnimationFrame(resizeCanvas);

  // ── Rendering ──────────────────────────────────────────────────────────
  function render(): void {
    const w = canvas.width;
    const h = canvas.height;
    const dpr = window.devicePixelRatio;
    const cssW = w / dpr;
    const cssH = h / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // ── Substrate background ────────────────────────────────────────────
    substrateEffect.update(performance.now(), cssW, cssH);
    substrateEffect.draw(ctx);

    doorHitAreas = [];

    drawConnectionLines(ctx, placements);

    for (const [roomId, placement] of placements) {
      drawRoom(ctx, placement, roomId === currentRoomId, roomId === selectedRoomId);
    }

    if (snapIndicator) {
      drawSnapIndicator(ctx);
    }

    if (linkSourceRoomId && linkSourceTransIndex >= 0) {
      drawActiveLinkLine(ctx);
    }
  }

  function worldToScreen(xWorld: number, yWorld: number): [number, number] {
    const canvasWCss = canvas.width / window.devicePixelRatio;
    const canvasHCss = canvas.height / window.devicePixelRatio;
    return [
      canvasWCss / 2 + panXPx + xWorld * zoom,
      canvasHCss / 2 + panYPx + yWorld * zoom,
    ];
  }

  function drawRoom(
    ctx2d: CanvasRenderingContext2D,
    placement: MapRoomPlacement,
    isCurrent: boolean,
    isSelected: boolean,
  ): void {
    const room = placement.room;
    const [sx, sy] = worldToScreen(placement.mapXWorld, placement.mapYWorld);
    const rw = room.widthBlocks * zoom;
    const rh = room.heightBlocks * zoom;

    const customColor = roomColorOverrides.get(room.id);

    // Selection highlight (behind room fill)
    if (isSelected) {
      ctx2d.strokeStyle = customColor ?? ROOM_SELECTED_STROKE;
      ctx2d.lineWidth = 3;
      ctx2d.strokeRect(sx - 3, sy - 3, rw + 6, rh + 6);
    }

    // Room rectangle
    if (customColor) {
      // Parse hex into rgba for fill (semi-transparent) and stroke (solid)
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
    const fontSize = Math.max(8, Math.min(12, zoom * 2));
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
      drawDoor(ctx2d, room, i, sx, sy, rw, rh);
    }
  }

  function drawDoor(
    ctx2d: CanvasRenderingContext2D,
    room: RoomDef,
    transIndex: number,
    roomSx: number,
    roomSy: number,
    roomW: number,
    roomH: number,
  ): void {
    const trans = room.transitions[transIndex];
    const ds = Math.max(4, Math.min(DOOR_SIZE, zoom * 1.5));

    let dx: number, dy: number;
    if (trans.direction === 'left') {
      dx = roomSx - ds / 2;
      dy = roomSy + (trans.positionBlock + trans.openingSizeBlocks / 2) * zoom - ds / 2;
    } else if (trans.direction === 'right') {
      dx = roomSx + roomW - ds / 2;
      dy = roomSy + (trans.positionBlock + trans.openingSizeBlocks / 2) * zoom - ds / 2;
    } else if (trans.direction === 'up') {
      dx = roomSx + (trans.positionBlock + trans.openingSizeBlocks / 2) * zoom - ds / 2;
      dy = roomSy - ds / 2;
    } else {
      dx = roomSx + (trans.positionBlock + trans.openingSizeBlocks / 2) * zoom - ds / 2;
      dy = roomSy + roomH - ds / 2;
    }

    const isHovered = hoveredDoor?.roomId === room.id && hoveredDoor?.transitionIndex === transIndex;
    const isLinkSource = linkSourceRoomId === room.id && linkSourceTransIndex === transIndex;
    const hasTarget = trans.targetRoomId !== '';

    let fill: string;
    if (isLinkSource) fill = LINK_LINE_ACTIVE;
    else if (isHovered) fill = DOOR_FILL_HOVER;
    else if (hasTarget) fill = DOOR_FILL_LINKED;
    else fill = DOOR_FILL_UNLINKED;

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

    doorHitAreas.push({
      roomId: room.id,
      transitionIndex: transIndex,
      xPx: dx,
      yPx: dy,
      wPx: ds,
      hPx: ds,
    });
  }

  function drawConnectionLines(
    ctx2d: CanvasRenderingContext2D,
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

        const [sx, sy] = worldToScreen(placement.mapXWorld, placement.mapYWorld);
        const rw = room.widthBlocks * zoom;
        const rh = room.heightBlocks * zoom;
        const srcPos = getDoorCenter(trans, sx, sy, rw, rh);

        const targetRoom = targetPlacement.room;
        const reverseTrans = targetRoom.transitions.find(t => t.targetRoomId === roomId);
        const [tsx, tsy] = worldToScreen(targetPlacement.mapXWorld, targetPlacement.mapYWorld);
        const trw = targetRoom.widthBlocks * zoom;
        const trh = targetRoom.heightBlocks * zoom;

        let tgtPos: [number, number];
        if (reverseTrans) {
          tgtPos = getDoorCenter(reverseTrans, tsx, tsy, trw, trh);
        } else {
          tgtPos = [tsx + trw / 2, tsy + trh / 2];
        }

        ctx2d.beginPath();
        ctx2d.moveTo(srcPos[0], srcPos[1]);
        ctx2d.lineTo(tgtPos[0], tgtPos[1]);
        ctx2d.stroke();
      }
    }

    ctx2d.setLineDash([]);
  }

  function getDoorCenter(
    trans: RoomTransitionDef,
    roomSx: number,
    roomSy: number,
    roomW: number,
    roomH: number,
  ): [number, number] {
    if (trans.direction === 'left') {
      return [roomSx, roomSy + (trans.positionBlock + trans.openingSizeBlocks / 2) * zoom];
    } else if (trans.direction === 'right') {
      return [roomSx + roomW, roomSy + (trans.positionBlock + trans.openingSizeBlocks / 2) * zoom];
    } else if (trans.direction === 'up') {
      return [roomSx + (trans.positionBlock + trans.openingSizeBlocks / 2) * zoom, roomSy];
    } else {
      return [roomSx + (trans.positionBlock + trans.openingSizeBlocks / 2) * zoom, roomSy + roomH];
    }
  }

  function drawActiveLinkLine(ctx2d: CanvasRenderingContext2D): void {
    const sourceDoor = findDoorHitArea(linkSourceRoomId, linkSourceTransIndex);
    if (!sourceDoor) return;

    const srcCx = sourceDoor.xPx + sourceDoor.wPx / 2;
    const srcCy = sourceDoor.yPx + sourceDoor.hPx / 2;

    const rect = canvas.getBoundingClientRect();
    const mx = lastMouseXPx - rect.left;
    const my = lastMouseYPx - rect.top;

    ctx2d.strokeStyle = LINK_LINE_ACTIVE;
    ctx2d.lineWidth = 2;
    ctx2d.setLineDash([6, 3]);
    ctx2d.beginPath();
    ctx2d.moveTo(srcCx, srcCy);
    ctx2d.lineTo(mx, my);
    ctx2d.stroke();
    ctx2d.setLineDash([]);
  }

  function findDoorHitArea(roomId: string, transIndex: number): DoorHitArea | null {
    for (const d of doorHitAreas) {
      if (d.roomId === roomId && d.transitionIndex === transIndex) return d;
    }
    return null;
  }

  /** Draws a visual snap indicator for the two doorways about to be aligned. */
  function drawSnapIndicator(ctx2d: CanvasRenderingContext2D): void {
    if (!snapIndicator) return;

    const srcDoor = findDoorHitArea(snapIndicator.srcRoomId, snapIndicator.srcTransIdx);
    const tgtDoor = findDoorHitArea(snapIndicator.tgtRoomId, snapIndicator.tgtTransIdx);
    if (!srcDoor || !tgtDoor) return;

    const srcCx = srcDoor.xPx + srcDoor.wPx / 2;
    const srcCy = srcDoor.yPx + srcDoor.hPx / 2;
    const tgtCx = tgtDoor.xPx + tgtDoor.wPx / 2;
    const tgtCy = tgtDoor.yPx + tgtDoor.hPx / 2;

    // Highlight glow around both snapping doors
    for (const door of [srcDoor, tgtDoor]) {
      const glowW = door.wPx + 6;
      const glowH = door.hPx + 6;
      ctx2d.save();
      ctx2d.globalAlpha = 0.55;
      ctx2d.fillStyle = DOOR_SNAP_COLOR;
      ctx2d.fillRect(door.xPx - 3, door.yPx - 3, glowW, glowH);
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

  // ── Center view on a room ──────────────────────────────────────────────
  function centerOnRoom(roomId: string): void {
    const placement = placements.get(roomId);
    if (!placement) return;
    const room = placement.room;
    panXPx = -(placement.mapXWorld + room.widthBlocks / 2) * zoom;
    panYPx = -(placement.mapYWorld + room.heightBlocks / 2) * zoom;
  }

  // ── Hit testing ────────────────────────────────────────────────────────
  function hitTestDoor(sxPx: number, syPx: number): DoorHitArea | null {
    for (const d of doorHitAreas) {
      if (sxPx >= d.xPx && sxPx <= d.xPx + d.wPx && syPx >= d.yPx && syPx <= d.yPx + d.hPx) {
        return d;
      }
    }
    return null;
  }

  function hitTestRoom(sxPx: number, syPx: number): string | null {
    for (const [roomId, placement] of placements) {
      const [sx, sy] = worldToScreen(placement.mapXWorld, placement.mapYWorld);
      const rw = placement.room.widthBlocks * zoom;
      const rh = placement.room.heightBlocks * zoom;
      if (sxPx >= sx && sxPx <= sx + rw && syPx >= sy && syPx <= sy + rh) {
        return roomId;
      }
    }
    return null;
  }

  // ── Mouse tracking ─────────────────────────────────────────────────────
  let lastMouseXPx = 0;
  let lastMouseYPx = 0;

  function onMouseMove(e: MouseEvent): void {
    lastMouseXPx = e.clientX;
    lastMouseYPx = e.clientY;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    hoveredDoor = hitTestDoor(mx, my);

    if (isDraggingRoom && dragRoomId) {
      const dx = e.clientX - dragStartXPx;
      const dy = e.clientY - dragStartYPx;
      const placement = placements.get(dragRoomId);
      if (placement) {
        // Free drag position
        placement.mapXWorld = dragRoomStartXPx + dx / zoom;
        placement.mapYWorld = dragRoomStartYPx + dy / zoom;
        // Doorway snap: adjust position if a compatible door pair is close enough
        snapIndicator = applyDoorSnap(dragRoomId, placement);
      }
      render();
    } else if (isDraggingPan) {
      panXPx = dragStartPanXPx + (e.clientX - dragStartXPx);
      panYPx = dragStartPanYPx + (e.clientY - dragStartYPx);
      render();
    } else {
      render();
    }

    if (hoveredDoor) {
      canvas.style.cursor = 'pointer';
    } else if (hitTestRoom(mx, my)) {
      canvas.style.cursor = isDraggingRoom ? 'grabbing' : 'grab';
    } else {
      canvas.style.cursor = isDraggingPan ? 'grabbing' : 'grab';
    }
  }

  function onMouseDown(e: MouseEvent): void {
    dismissContextMenu();

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Right-click: context menu on room
    if (e.button === 2) {
      const roomId = hitTestRoom(mx, my);
      if (roomId) {
        selectedRoomId = roomId;
        render();
        showContextMenu(e.clientX, e.clientY, roomId);
      }
      return;
    }

    if (e.button !== 0) return;

    // Door click
    const door = hitTestDoor(mx, my);
    if (door) {
      if (linkSourceRoomId) {
        completeDoorLink(door);
      } else {
        linkSourceRoomId = door.roomId;
        linkSourceTransIndex = door.transitionIndex;
        statusBar.textContent = `Linking: ${door.roomId} Door #${door.transitionIndex + 1} \u2014 click another door to link, or ESC to cancel`;
        render();
      }
      return;
    }

    if (linkSourceRoomId) {
      cancelDoorLink();
      return;
    }

    // Room click: select + start drag
    const roomId = hitTestRoom(mx, my);
    if (roomId) {
      selectedRoomId = roomId;
      isDraggingRoom = true;
      dragRoomId = roomId;
      dragStartXPx = e.clientX;
      dragStartYPx = e.clientY;
      const placement = placements.get(roomId);
      if (placement) {
        dragRoomStartXPx = placement.mapXWorld;
        dragRoomStartYPx = placement.mapYWorld;
      }
      canvas.style.cursor = 'grabbing';
      statusBar.textContent = `Selected: ${effectiveRoomName(roomId)} (${roomId}) \u2014 ${worldDisplayName(effectiveWorldId(roomId))} \u2014 arrow keys to nudge`;
      statusBar.style.color = 'rgba(200,255,200,0.6)';
      render();
      return;
    }

    // Deselect + pan
    selectedRoomId = '';
    isDraggingPan = true;
    dragStartXPx = e.clientX;
    dragStartYPx = e.clientY;
    dragStartPanXPx = panXPx;
    dragStartPanYPx = panYPx;
    canvas.style.cursor = 'grabbing';
    render();
  }

  function onMouseUp(e: MouseEvent): void {
    if (e.button === 0) {
      if (isDraggingRoom && dragRoomId) {
        const placement = placements.get(dragRoomId);
        if (placement) {
          setRoomMapPosition(dragRoomId, placement.mapXWorld, placement.mapYWorld);
          if (snapIndicator) {
            statusBar.textContent =
              `Snapped: ${effectiveRoomName(dragRoomId)} door #${snapIndicator.srcTransIdx + 1}` +
              ` aligned with ${effectiveRoomName(snapIndicator.tgtRoomId)} door #${snapIndicator.tgtTransIdx + 1}` +
              ' \u2014 open rooms in editor to link the transitions';
            statusBar.style.color = DOOR_SNAP_COLOR;
          }
        }
      }
      snapIndicator = null;
      isDraggingRoom = false;
      dragRoomId = '';
      isDraggingPan = false;
      canvas.style.cursor = 'grab';
    }
  }

  function onDblClick(e: MouseEvent): void {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const roomId = hitTestRoom(mx, my);
    if (roomId) {
      const room = ROOM_REGISTRY.get(roomId);
      if (room) {
        destroy();
        callbacks.onJumpToRoom(room);
      }
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const oldZoom = zoom;
    if (e.deltaY < 0) {
      zoom = Math.min(20, zoom * 1.15);
    } else {
      zoom = Math.max(0.5, zoom / 1.15);
    }

    const canvasWCss = canvas.width / window.devicePixelRatio;
    const canvasHCss = canvas.height / window.devicePixelRatio;
    const worldX = (mx - canvasWCss / 2 - panXPx) / oldZoom;
    const worldY = (my - canvasHCss / 2 - panYPx) / oldZoom;
    panXPx = mx - canvasWCss / 2 - worldX * zoom;
    panYPx = my - canvasHCss / 2 - worldY * zoom;

    render();
  }

  function completeDoorLink(targetDoor: DoorHitArea): void {
    const sourceRoom = ROOM_REGISTRY.get(linkSourceRoomId);
    const targetRoom = ROOM_REGISTRY.get(targetDoor.roomId);
    if (sourceRoom && targetRoom) {
      statusBar.textContent =
        `Linked: ${linkSourceRoomId} Door #${linkSourceTransIndex + 1} \u2192 ${targetDoor.roomId} Door #${targetDoor.transitionIndex + 1}` +
        ' (open rooms in editor to save changes)';
      statusBar.style.color = '#88ff88';
    }
    linkSourceRoomId = '';
    linkSourceTransIndex = -1;
    render();
  }

  function cancelDoorLink(): void {
    linkSourceRoomId = '';
    linkSourceTransIndex = -1;
    statusBar.textContent = 'Link cancelled';
    statusBar.style.color = 'rgba(200,255,200,0.6)';
    render();
  }

  // ── Context menu ───────────────────────────────────────────────────────
  let contextMenuEl: HTMLElement | null = null;

  function dismissContextMenu(): void {
    if (contextMenuEl?.parentElement) {
      contextMenuEl.parentElement.removeChild(contextMenuEl);
    }
    contextMenuEl = null;
  }

  function showContextMenu(clientX: number, clientY: number, roomId: string): void {
    dismissContextMenu();

    const menu = document.createElement('div');
    menu.style.cssText = `
      position: absolute; z-index: 1200;
      background: rgba(10,10,20,0.97); border: 1px solid rgba(0,200,100,0.5);
      border-radius: 4px; padding: 4px 0; min-width: 200px;
      font-family: monospace; font-size: 12px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.6);
    `;

    const overlayRect = overlay.getBoundingClientRect();
    menu.style.left = `${clientX - overlayRect.left + 2}px`;
    menu.style.top = `${clientY - overlayRect.top + 2}px`;

    const roomName = effectiveRoomName(roomId);
    const wId = effectiveWorldId(roomId);

    const menuHeader = document.createElement('div');
    menuHeader.textContent = `${roomName} (${roomId})`;
    menuHeader.style.cssText = `padding: 5px 12px 4px; color: ${GREEN}; font-size: 11px; border-bottom: 1px solid rgba(0,200,100,0.3);`;
    menu.appendChild(menuHeader);

    function addMenuItem(label: string, onClick: () => void): void {
      const item = document.createElement('div');
      item.textContent = label;
      item.style.cssText = `padding: 6px 12px; color: #c0ffd0; cursor: pointer;`;
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(0,200,100,0.15)'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
      item.addEventListener('click', () => {
        dismissContextMenu();
        onClick();
      });
      menu.appendChild(item);
    }

    function addMenuSep(): void {
      const sep = document.createElement('div');
      sep.style.cssText = `height: 1px; background: rgba(0,200,100,0.2); margin: 2px 0;`;
      menu.appendChild(sep);
    }

    addMenuItem('\u270f Rename Room\u2026', () => {
      const newName = window.prompt('New name for room:', roomName);
      if (newName !== null && newName.trim() !== '') {
        setRoomNameOverride(roomId, newName.trim());
        statusBar.textContent = `Renamed "${roomId}" \u2192 "${newName.trim()}"`;
        statusBar.style.color = '#88ff88';
        render();
      }
    });

    addMenuItem(`\ud83c\udf10 Move to World\u2026 (now: ${worldDisplayName(wId)})`, () => {
      showMoveToWorldDialog(roomId, wId);
    });

    addMenuItem('\ud83c\udfa8 Change Color\u2026', () => {
      showColorPickerDialog(roomId);
    });

    addMenuSep();

    addMenuItem('\u2715 Cancel', () => { /* auto-dismissed */ });

    overlay.appendChild(menu);
    contextMenuEl = menu;
  }

  // ── Move to World dialog ───────────────────────────────────────────────
  function showMoveToWorldDialog(roomId: string, currentWorldId: number): void {
    const worldIdSet = new Set<number>();
    for (const [id] of WORLD_NAMES) worldIdSet.add(id);
    for (const [, room] of ROOM_REGISTRY) {
      worldIdSet.add(ROOM_WORLD_OVERRIDES.get(room.id) ?? room.worldNumber);
    }
    const sorted = [...worldIdSet].sort((a, b) => a - b);

    const modal = createModal();

    const title = document.createElement('h3');
    title.textContent = `Move "${effectiveRoomName(roomId)}" to World`;
    title.style.cssText = `color: ${GREEN}; margin: 0 0 16px; font-family: 'Cinzel', serif; font-size: 13px;`;
    modal.panel.appendChild(title);

    const sel = document.createElement('select');
    sel.style.cssText = `
      width: 100%; padding: 6px; background: rgba(20,20,30,0.9);
      color: #c0ffd0; border: 1px solid rgba(0,200,100,0.4);
      border-radius: 3px; font-family: monospace; font-size: 12px; margin-bottom: 12px;
    `;
    for (const id of sorted) {
      const opt = document.createElement('option');
      opt.value = String(id);
      opt.textContent = `${worldDisplayName(id)} (id: ${id})`;
      if (id === currentWorldId) opt.selected = true;
      sel.appendChild(opt);
    }
    modal.panel.appendChild(sel);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 8px;';

    const okBtn = makeHeaderBtn('Move', '#44cc88');
    okBtn.style.cssText += ' flex: 1;';
    okBtn.addEventListener('click', () => {
      const newWorldId = parseInt(sel.value, 10);
      setRoomWorldOverride(roomId, newWorldId);
      statusBar.textContent = `Moved "${effectiveRoomName(roomId)}" to ${worldDisplayName(newWorldId)}`;
      statusBar.style.color = '#88ff88';
      modal.destroy();
      render();
    });

    const cancelBtn = makeHeaderBtn('Cancel', '#888888');
    cancelBtn.style.cssText += ' flex: 1;';
    cancelBtn.addEventListener('click', () => modal.destroy());

    btnRow.appendChild(okBtn);
    btnRow.appendChild(cancelBtn);
    modal.panel.appendChild(btnRow);
  }

  // ── Add Room dialog ────────────────────────────────────────────────────
  function showAddRoomDialog(): void {
    const modal = createModal();

    const title = document.createElement('h3');
    title.textContent = '+ Add New Room';
    title.style.cssText = `color: ${GREEN}; margin: 0 0 16px; font-family: 'Cinzel', serif; font-size: 13px;`;
    modal.panel.appendChild(title);

    function makeField(labelText: string, input: HTMLInputElement | HTMLSelectElement): void {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom: 10px;';
      const lbl = document.createElement('label');
      lbl.textContent = labelText;
      lbl.style.cssText = 'display: block; color: rgba(200,255,200,0.6); font-size: 11px; margin-bottom: 3px; font-family: monospace;';
      input.style.cssText = (input.style.cssText || '') + `
        width: 100%; box-sizing: border-box; padding: 5px 8px;
        background: rgba(20,20,30,0.9); color: #c0ffd0;
        border: 1px solid rgba(0,200,100,0.4); border-radius: 3px;
        font-family: monospace; font-size: 12px;
      `;
      row.appendChild(lbl);
      row.appendChild(input);
      modal.panel.appendChild(row);
    }

    const idInput = document.createElement('input');
    idInput.type = 'text';
    idInput.placeholder = 'e.g. my_new_room';
    makeField('Room ID (unique, no spaces)', idInput);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'e.g. My New Room';
    makeField('Room Name', nameInput);

    const worldSel = document.createElement('select');
    const worldIdSet = new Set<number>();
    for (const [id] of WORLD_NAMES) worldIdSet.add(id);
    for (const [, room] of ROOM_REGISTRY) {
      worldIdSet.add(ROOM_WORLD_OVERRIDES.get(room.id) ?? room.worldNumber);
    }
    const sortedWorlds = [...worldIdSet].sort((a, b) => a - b);
    for (const id of sortedWorlds) {
      const opt = document.createElement('option');
      opt.value = String(id);
      opt.textContent = `${worldDisplayName(id)} (id: ${id})`;
      worldSel.appendChild(opt);
    }
    makeField('World', worldSel);

    const wInput = document.createElement('input');
    wInput.type = 'number';
    wInput.value = '40';
    wInput.min = '10';
    makeField('Width (blocks)', wInput);

    const hInput = document.createElement('input');
    hInput.type = 'number';
    hInput.value = '30';
    hInput.min = '10';
    makeField('Height (blocks)', hInput);

    const errEl = document.createElement('div');
    errEl.style.cssText = 'color: #ff8888; font-size: 11px; min-height: 16px; font-family: monospace; margin-bottom: 8px;';
    modal.panel.appendChild(errEl);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 8px;';

    const createBtn = makeHeaderBtn('Create Room', '#44cc88');
    createBtn.style.cssText += ' flex: 1;';
    createBtn.addEventListener('click', () => {
      const id = idInput.value.trim().replace(/\s+/g, '_').replace(/_+/g, '_');
      const name = nameInput.value.trim() || id;
      const worldId = parseInt(worldSel.value, 10);
      const w = Math.max(10, parseInt(wInput.value, 10) || 40);
      const h = Math.max(10, parseInt(hInput.value, 10) || 30);

      if (!id) { errEl.textContent = 'Room ID is required.'; return; }
      if (ROOM_REGISTRY.has(id)) { errEl.textContent = `Room ID "${id}" already exists.`; return; }

      // Creates a blank room (perimeter walls only, no interior content).
      // Double-click it in the visual map to open it in the room editor.
      const roomDef = roomJsonDefToRoomDef({
        id,
        name,
        worldNumber: worldId,
        widthBlocks: w,
        heightBlocks: h,
        playerSpawnBlock: [Math.floor(w / 2), Math.floor(h / 2)],
        interiorWalls: [],
        enemies: [],
        transitions: [],
        skillTombs: [],
      });

      registerRoom(roomDef);
      setRoomNameOverride(id, name);
      setRoomWorldOverride(id, worldId);

      const canvasWCss = canvas.width / window.devicePixelRatio;
      const canvasHCss = canvas.height / window.devicePixelRatio;
      const centerWorldX = (canvasWCss / 2 - panXPx) / zoom;
      const centerWorldY = (canvasHCss / 2 - panYPx) / zoom;
      const mapX = centerWorldX + 10;
      const mapY = centerWorldY + 10;
      placements.set(id, { room: roomDef, mapXWorld: mapX, mapYWorld: mapY });
      setRoomMapPosition(id, mapX, mapY);

      selectedRoomId = id;
      modal.destroy();
      render();
      statusBar.textContent = `Room "${name}" created \u2014 double-click to edit it, export room JSON to save gameplay content.`;
      statusBar.style.color = '#88ff88';
    });

    const cancelBtn = makeHeaderBtn('Cancel', '#888888');
    cancelBtn.style.cssText += ' flex: 1;';
    cancelBtn.addEventListener('click', () => modal.destroy());

    btnRow.appendChild(createBtn);
    btnRow.appendChild(cancelBtn);
    modal.panel.appendChild(btnRow);

    idInput.focus();
  }

  // ── Add World dialog ───────────────────────────────────────────────────
  function showAddWorldDialog(): void {
    const modal = createModal();

    const title = document.createElement('h3');
    title.textContent = '+ Add New World';
    title.style.cssText = `color: ${GREEN}; margin: 0 0 16px; font-family: 'Cinzel', serif; font-size: 13px;`;
    modal.panel.appendChild(title);

    let maxId = 0;
    for (const [id] of WORLD_NAMES) maxId = Math.max(maxId, id);
    for (const [, room] of ROOM_REGISTRY) {
      maxId = Math.max(maxId, ROOM_WORLD_OVERRIDES.get(room.id) ?? room.worldNumber);
    }
    const nextId = maxId + 1;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = `World ${nextId}`;
    nameInput.style.cssText = `
      width: 100%; box-sizing: border-box; padding: 6px 8px;
      background: rgba(20,20,30,0.9); color: #c0ffd0;
      border: 1px solid rgba(0,200,100,0.4); border-radius: 3px;
      font-family: monospace; font-size: 12px; margin-bottom: 12px;
    `;

    const lbl = document.createElement('label');
    lbl.textContent = `World Name (will be assigned id: ${nextId})`;
    lbl.style.cssText = 'display: block; color: rgba(200,255,200,0.6); font-size: 11px; margin-bottom: 3px; font-family: monospace;';
    modal.panel.appendChild(lbl);
    modal.panel.appendChild(nameInput);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 8px;';

    const createBtn = makeHeaderBtn('Create World', '#6688cc');
    createBtn.style.cssText += ' flex: 1;';
    createBtn.addEventListener('click', () => {
      const name = nameInput.value.trim() || `World ${nextId}`;
      setWorldName(nextId, name);
      modal.destroy();
      statusBar.textContent = `World "${name}" (id: ${nextId}) created \u2014 right-click rooms to move them into it.`;
      statusBar.style.color = '#88ff88';
      render();
    });

    const cancelBtn = makeHeaderBtn('Cancel', '#888888');
    cancelBtn.style.cssText += ' flex: 1;';
    cancelBtn.addEventListener('click', () => modal.destroy());

    btnRow.appendChild(createBtn);
    btnRow.appendChild(cancelBtn);
    modal.panel.appendChild(btnRow);

    nameInput.focus();
  }

  // ── Color picker dialog ────────────────────────────────────────────────
  function showColorPickerDialog(roomId: string): void {
    const modal = createModal();
    const roomName = effectiveRoomName(roomId);
    const currentColor = roomColorOverrides.get(roomId) ?? '';

    const title = document.createElement('h3');
    title.textContent = `\ud83c\udfa8 Room Color: "${roomName}"`;
    title.style.cssText = `color: ${GREEN}; margin: 0 0 12px; font-family: 'Cinzel', serif; font-size: 13px;`;
    modal.panel.appendChild(title);

    // Preset swatch grid
    const swatchLbl = document.createElement('div');
    swatchLbl.textContent = 'Preset colors:';
    swatchLbl.style.cssText = 'color: rgba(200,255,200,0.6); font-size: 11px; font-family: monospace; margin-bottom: 6px;';
    modal.panel.appendChild(swatchLbl);

    const swatchGrid = document.createElement('div');
    swatchGrid.style.cssText = 'display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 12px;';

    let selectedHex = currentColor;

    const swatchBtns: HTMLButtonElement[] = [];

    function refreshSwatches(): void {
      for (const btn of swatchBtns) {
        btn.style.outline = btn.dataset['color'] === selectedHex
          ? SWATCH_SELECTED_OUTLINE
          : SWATCH_DEFAULT_OUTLINE;
      }
    }

    for (const hex of COLOR_PRESETS) {
      const btn = document.createElement('button');
      btn.dataset['color'] = hex;
      btn.style.cssText = `
        width: 24px; height: 24px; background: ${hex};
        border: none; border-radius: 3px; cursor: pointer;
        outline: ${SWATCH_DEFAULT_OUTLINE};
      `;
      btn.title = hex;
      btn.addEventListener('click', () => {
        selectedHex = hex;
        nativeInput.value = hex;
        refreshSwatches();
      });
      swatchBtns.push(btn);
      swatchGrid.appendChild(btn);
    }

    modal.panel.appendChild(swatchGrid);

    // Native color input for full freedom
    const nativeRow = document.createElement('div');
    nativeRow.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 12px;';

    const nativeLbl = document.createElement('label');
    nativeLbl.textContent = 'Custom:';
    nativeLbl.style.cssText = 'color: rgba(200,255,200,0.6); font-size: 11px; font-family: monospace; white-space: nowrap;';

    const nativeInput = document.createElement('input');
    nativeInput.type = 'color';
    nativeInput.value = currentColor || '#1e2837';
    nativeInput.style.cssText = 'width: 40px; height: 24px; border: none; background: transparent; cursor: pointer;';
    nativeInput.addEventListener('input', () => {
      selectedHex = nativeInput.value;
      refreshSwatches();
    });

    nativeRow.appendChild(nativeLbl);
    nativeRow.appendChild(nativeInput);
    modal.panel.appendChild(nativeRow);

    refreshSwatches();

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display: flex; gap: 8px;';

    const applyBtn = makeHeaderBtn('Apply', '#44cc88');
    applyBtn.style.cssText += ' flex: 1;';
    applyBtn.addEventListener('click', () => {
      if (selectedHex) {
        roomColorOverrides.set(roomId, selectedHex);
        statusBar.textContent = `Color set for "${roomName}": ${selectedHex}`;
        statusBar.style.color = selectedHex;
      } else {
        roomColorOverrides.delete(roomId);
        statusBar.textContent = `Color reset for "${roomName}"`;
        statusBar.style.color = 'rgba(200,255,200,0.6)';
      }
      modal.destroy();
      render();
    });

    const clearBtn = makeHeaderBtn('Reset', '#888888');
    clearBtn.style.cssText += ' flex: 1;';
    clearBtn.addEventListener('click', () => {
      roomColorOverrides.delete(roomId);
      statusBar.textContent = `Color reset for "${roomName}"`;
      statusBar.style.color = 'rgba(200,255,200,0.6)';
      modal.destroy();
      render();
    });

    const cancelBtn = makeHeaderBtn('Cancel', '#555555');
    cancelBtn.style.cssText += ' flex: 1;';
    cancelBtn.addEventListener('click', () => modal.destroy());

    btnRow.appendChild(applyBtn);
    btnRow.appendChild(clearBtn);
    btnRow.appendChild(cancelBtn);
    modal.panel.appendChild(btnRow);
  }
  function createModal(): { panel: HTMLElement; destroy: () => void } {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.6); z-index: 1150;
      display: flex; align-items: center; justify-content: center;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
      background: rgba(10,10,20,0.98); border: 1px solid rgba(0,200,100,0.5);
      border-radius: 6px; padding: 20px; min-width: 280px; max-width: 400px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.7);
    `;

    backdrop.appendChild(panel);
    overlay.appendChild(backdrop);

    const destroyFn = (): void => {
      if (backdrop.parentElement) backdrop.parentElement.removeChild(backdrop);
    };

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) destroyFn();
    });

    return { panel, destroy: destroyFn };
  }

  // ── Door snap helpers ─────────────────────────────────────────────────

  /**
   * Returns the door's centre in map-world coordinates given its containing
   * room's current placement.
   */
  function getDoorCenterWorld(
    trans: RoomTransitionDef,
    placement: MapRoomPlacement,
  ): [number, number] {
    const room = placement.room;
    const cx = placement.mapXWorld;
    const cy = placement.mapYWorld;
    const mid = trans.positionBlock + trans.openingSizeBlocks / 2;
    if (trans.direction === 'left')  return [cx,                   cy + mid];
    if (trans.direction === 'right') return [cx + room.widthBlocks, cy + mid];
    if (trans.direction === 'up')    return [cx + mid,              cy];
    if (trans.direction === 'down')  return [cx + mid,              cy + room.heightBlocks];
    // Exhaustive check for TransitionDirection — should never reach here
    throw new Error(`Unknown transition direction: ${(trans as RoomTransitionDef).direction}`);
  }

  /** True when direction `a` and `b` face each other (and can be aligned). */
  function isOppositeDoor(a: TransitionDirection, b: TransitionDirection): boolean {
    return (a === 'left'  && b === 'right') ||
           (a === 'right' && b === 'left')  ||
           (a === 'up'    && b === 'down')  ||
           (a === 'down'  && b === 'up');
  }

  /**
   * Checks all pairs of (dragged-room door, other-room door) for compatible
   * facing pairs within SNAP_THRESHOLD_PX on screen.  When found, the
   * dragged room's placement is moved so the door centres coincide (seamless
   * wall-to-wall alignment).  Returns a SnapIndicator when snapping occurred.
   */
  function applyDoorSnap(
    draggingRoomId: string,
    draggingPlacement: MapRoomPlacement,
  ): SnapIndicator | null {
    const draggingRoom = draggingPlacement.room;

    let bestDistPx = SNAP_THRESHOLD_PX;
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
      const [srcSx, srcSy] = worldToScreen(srcWx, srcWy);

      for (const [otherId, otherPlacement] of placements) {
        if (otherId === draggingRoomId) continue;
        for (let ti = 0; ti < otherPlacement.room.transitions.length; ti++) {
          const tgtTrans = otherPlacement.room.transitions[ti];
          if (!isOppositeDoor(srcTrans.direction, tgtTrans.direction)) continue;

          const [tgtWx, tgtWy] = getDoorCenterWorld(tgtTrans, otherPlacement);
          const [tgtSx, tgtSy] = worldToScreen(tgtWx, tgtWy);
          const distPx = Math.hypot(srcSx - tgtSx, srcSy - tgtSy);

          if (distPx < bestDistPx) {
            bestDistPx = distPx;
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

  // ── Keyboard ───────────────────────────────────────────────────────────
  function onKey(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();

    // Arrow key nudge for selected room (1 map world unit = 1 virtual pixel at zoom 1)
    if (selectedRoomId && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const placement = placements.get(selectedRoomId);
      if (placement) {
        if (e.key === 'ArrowLeft')  placement.mapXWorld -= 1;
        if (e.key === 'ArrowRight') placement.mapXWorld += 1;
        if (e.key === 'ArrowUp')    placement.mapYWorld -= 1;
        if (e.key === 'ArrowDown')  placement.mapYWorld += 1;
        setRoomMapPosition(selectedRoomId, placement.mapXWorld, placement.mapYWorld);
        render();
      }
      return;
    }

    if (key === 'escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      dismissContextMenu();
      if (linkSourceRoomId) {
        cancelDoorLink();
      } else {
        destroy();
        callbacks.onClose();
      }
    } else if (key === 'n') {
      e.preventDefault();
      e.stopImmediatePropagation();
      destroy();
      callbacks.onClose();
    }
  }

  // ── Attach listeners ───────────────────────────────────────────────────
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', onKey);

  function destroy(): void {
    dismissContextMenu();
    substrateEffect.reset();
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mousedown', onMouseDown);
    canvas.removeEventListener('mouseup', onMouseUp);
    canvas.removeEventListener('dblclick', onDblClick);
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKey);
    resizeObserver.disconnect();
    if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
  }

  return destroy;
}

// ── Auto-layout via BFS ──────────────────────────────────────────────────────

/**
 * Converts a CSS hex colour (#rrggbb or #rgb) to an rgba() string with the
 * given alpha.  Falls back to a dark default when the input is malformed.
 */
function hexToRgba(hex: string, alpha: number): string {
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

function computeAutoLayout(
  placements: Map<string, MapRoomPlacement>,
  startRoomId: string,
): void {
  const allRooms: RoomDef[] = [];
  ROOM_REGISTRY.forEach((room) => allRooms.push(room));

  if (allRooms.length === 0) return;

  // Use stored positions from world-map.json for rooms that have them
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
