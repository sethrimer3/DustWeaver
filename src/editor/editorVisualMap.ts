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
 * directly into room JSON files.
 *
 * Selecting a room (single click) and pressing arrow keys nudges it by
 * 1 map world unit per keypress.
 */

import { ROOM_REGISTRY, setRoomMapPosition, setRoomNameOverride, setRoomTransitionLink } from '../levels/rooms';
import type { RoomDef, RoomTransitionDef, TransitionDirection } from '../levels/roomDef';
import { exportWorldMapJson } from './editorExport';
import { createSubstrateEffect } from '../render/effects/substrateEffect';
import {
  MapRoomPlacement,
  VisualMapCallbacks,
  effectiveRoomName,
  effectiveWorldId,
  worldDisplayName,
  hexToRgba,
  computeAutoLayout,
} from './editorVisualMapHelpers';
import {
  VisualMapDialogContext,
  makeHeaderBtn,
  showMoveToWorldDialog,
  showAddRoomDialog,
  showAddWorldDialog,
  showColorPickerDialog,
} from './editorVisualMapDialogs';

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


/** Scale factor: screen pixels per map world unit at default zoom. */
const DEFAULT_ZOOM_SCALE = 4;

// ── Types ────────────────────────────────────────────────────────────────────

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

interface PendingDoorLink {
  sourceRoomId: string;
  sourceTransIndex: number;
  targetRoomId: string;
  targetTransIndex: number;
  promptEl: HTMLDivElement;
  timeoutId: number;
  removeTimeoutId: number;
  hasResolved: boolean;
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

  // ── Dialog context ─────────────────────────────────────────────────────
  // Created early; all getter fields are closures that read the current
  // outer-scope values at call time — all variables are fully initialised
  // before any user interaction fires these callbacks.
  const dialogCtx: VisualMapDialogContext = {
    get overlay()            { return overlay; },
    get statusBar()          { return statusBar; },
    get canvas()             { return canvas; },
    get placements()         { return placements; },
    get roomColorOverrides() { return roomColorOverrides; },
    get callbacks()          { return callbacks; },
    getPanX:           () => panXPx,
    getPanY:           () => panYPx,
    getZoom:           () => zoom,
    render:            () => render(),
    setSelectedRoomId: (id) => { selectedRoomId = id; },
  };

  const addRoomBtn = makeHeaderBtn('+ Add Room', '#44cc88');
  addRoomBtn.title = 'Create a new blank room';
  addRoomBtn.addEventListener('click', () => showAddRoomDialog(dialogCtx));
  header.appendChild(addRoomBtn);

  const addWorldBtn = makeHeaderBtn('+ Add World', '#6688cc');
  addWorldBtn.title = 'Create a new world group';
  addWorldBtn.addEventListener('click', () => showAddWorldDialog(dialogCtx));
  header.appendChild(addWorldBtn);

  const exportBtn = makeHeaderBtn('\u2b07 Export Rooms', '#cccc44');
  exportBtn.title = 'Download all room JSON files with updated map metadata';
  exportBtn.addEventListener('click', () => {
    // Flush current placement positions before export
    for (const [roomId, placement] of placements) {
      setRoomMapPosition(roomId, placement.mapXWorld, placement.mapYWorld);
    }
    exportWorldMapJson();
    statusBar.textContent = 'Room JSON files downloaded with updated map metadata.';
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
  let isDraggingDoorLink = false;

  // Active door snap indicator (shown while dragging near a compatible doorway)
  let snapIndicator: SnapIndicator | null = null;

  // Door hit areas (rebuilt every frame)
  let doorHitAreas: DoorHitArea[] = [];

  let pendingDoorLink: PendingDoorLink | null = null;

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
    const DEPTH = 6;
    if (trans.depthBlock !== undefined) {
      // Interior transition: show door at center of the zone
      const depthMid = (trans.depthBlock + DEPTH / 2) * zoom;
      const posMid   = (trans.positionBlock + trans.openingSizeBlocks / 2) * zoom;
      if (trans.direction === 'left' || trans.direction === 'right') {
        dx = roomSx + depthMid - ds / 2;
        dy = roomSy + posMid   - ds / 2;
      } else {
        dx = roomSx + posMid   - ds / 2;
        dy = roomSy + depthMid - ds / 2;
      }
    } else if (trans.direction === 'left') {
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
    const DEPTH = 6;
    const posMid = (trans.positionBlock + trans.openingSizeBlocks / 2) * zoom;
    if (trans.depthBlock !== undefined) {
      const depthMid = (trans.depthBlock + DEPTH / 2) * zoom;
      if (trans.direction === 'left' || trans.direction === 'right') {
        return [roomSx + depthMid, roomSy + posMid];
      } else {
        return [roomSx + posMid, roomSy + depthMid];
      }
    }
    if (trans.direction === 'left') {
      return [roomSx, roomSy + posMid];
    } else if (trans.direction === 'right') {
      return [roomSx + roomW, roomSy + posMid];
    } else if (trans.direction === 'up') {
      return [roomSx + posMid, roomSy];
    } else {
      return [roomSx + posMid, roomSy + roomH];
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
        // Snap dragged position to integer block grid
        placement.mapXWorld = Math.round(dragRoomStartXPx + dx / zoom);
        placement.mapYWorld = Math.round(dragRoomStartYPx + dy / zoom);
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
        isDraggingDoorLink = false;
        completeDoorLink(door);
      } else {
        linkSourceRoomId = door.roomId;
        linkSourceTransIndex = door.transitionIndex;
        isDraggingDoorLink = true;
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
      if (isDraggingDoorLink && linkSourceRoomId) {
        const rect = canvas.getBoundingClientRect();
        const door = hitTestDoor(e.clientX - rect.left, e.clientY - rect.top);
        if (door && (door.roomId !== linkSourceRoomId || door.transitionIndex !== linkSourceTransIndex)) {
          completeDoorLink(door);
        }
        isDraggingDoorLink = false;
      }
      if (isDraggingRoom && dragRoomId) {
        const placement = placements.get(dragRoomId);
        if (placement) {
          setRoomMapPosition(dragRoomId, placement.mapXWorld, placement.mapYWorld);
          callbacks.onWorldMapDataChanged?.();
          if (snapIndicator) {
            statusBar.textContent =
              `Snapped: ${effectiveRoomName(dragRoomId)} door #${snapIndicator.srcTransIdx + 1}` +
              ` aligned with ${effectiveRoomName(snapIndicator.tgtRoomId)} door #${snapIndicator.tgtTransIdx + 1}` +
              ' — confirm to link the transitions';
            statusBar.style.color = DOOR_SNAP_COLOR;
            showLinkRoomsPrompt(
              snapIndicator.srcRoomId,
              snapIndicator.srcTransIdx,
              snapIndicator.tgtRoomId,
              snapIndicator.tgtTransIdx,
            );
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
        ' — confirm to update the room files';
      statusBar.style.color = DOOR_SNAP_COLOR;
      showLinkRoomsPrompt(
        linkSourceRoomId,
        linkSourceTransIndex,
        targetDoor.roomId,
        targetDoor.transitionIndex,
      );
    }
    linkSourceRoomId = '';
    linkSourceTransIndex = -1;
    render();
  }

  function cancelDoorLink(): void {
    linkSourceRoomId = '';
    linkSourceTransIndex = -1;
    isDraggingDoorLink = false;
    statusBar.textContent = 'Link cancelled';
    statusBar.style.color = 'rgba(200,255,200,0.6)';
    render();
  }

  function computeSpawnBlockForMapLink(
    room: RoomDef,
    transition: RoomTransitionDef,
  ): readonly [number, number] {
    const SPAWN_INSET_BLOCKS = 3;
    const spawnOffset = Math.floor(transition.openingSizeBlocks / 2);
    if (transition.direction === 'left') {
      return [SPAWN_INSET_BLOCKS, transition.positionBlock + spawnOffset];
    }
    if (transition.direction === 'right') {
      return [room.widthBlocks - SPAWN_INSET_BLOCKS - 1, transition.positionBlock + spawnOffset];
    }
    if (transition.direction === 'up') {
      return [transition.positionBlock + spawnOffset, SPAWN_INSET_BLOCKS];
    }
    return [transition.positionBlock + spawnOffset, room.heightBlocks - SPAWN_INSET_BLOCKS - 1];
  }

  function applyPendingDoorLink(link: PendingDoorLink): void {
    const sourceRoom = ROOM_REGISTRY.get(link.sourceRoomId);
    const targetRoom = ROOM_REGISTRY.get(link.targetRoomId);
    const sourceTransition = sourceRoom?.transitions[link.sourceTransIndex];
    const targetTransition = targetRoom?.transitions[link.targetTransIndex];
    if (!sourceRoom || !targetRoom || !sourceTransition || !targetTransition) return;

    const sourceSpawn = computeSpawnBlockForMapLink(sourceRoom, sourceTransition);
    const targetSpawn = computeSpawnBlockForMapLink(targetRoom, targetTransition);
    const didLinkSource = setRoomTransitionLink(
      link.sourceRoomId,
      link.sourceTransIndex,
      link.targetRoomId,
      targetSpawn,
    );
    const didLinkTarget = setRoomTransitionLink(
      link.targetRoomId,
      link.targetTransIndex,
      link.sourceRoomId,
      sourceSpawn,
    );

    if (didLinkSource && didLinkTarget) {
      callbacks.onWorldMapDataChanged?.();
      statusBar.textContent =
        `Linked: ${effectiveRoomName(link.sourceRoomId)} door #${link.sourceTransIndex + 1}` +
        ` <-> ${effectiveRoomName(link.targetRoomId)} door #${link.targetTransIndex + 1}`;
      statusBar.style.color = '#88ff88';
    }
  }

  function dismissLinkRoomsPrompt(shouldAnimate: boolean): void {
    const link = pendingDoorLink;
    if (!link) return;
    pendingDoorLink = null;
    window.clearTimeout(link.timeoutId);
    window.clearTimeout(link.removeTimeoutId);

    if (shouldAnimate) {
      link.promptEl.style.opacity = '0';
      link.promptEl.style.transform = 'translateY(16px)';
      link.removeTimeoutId = window.setTimeout(() => {
        if (link.promptEl.parentElement) link.promptEl.parentElement.removeChild(link.promptEl);
      }, 240);
      return;
    }

    if (link.promptEl.parentElement) link.promptEl.parentElement.removeChild(link.promptEl);
  }

  function confirmPendingDoorLink(): void {
    const link = pendingDoorLink;
    if (!link || link.hasResolved) return;
    link.hasResolved = true;
    applyPendingDoorLink(link);
    dismissLinkRoomsPrompt(false);
    render();
  }

  function showLinkRoomsPrompt(
    sourceRoomId: string,
    sourceTransIndex: number,
    targetRoomId: string,
    targetTransIndex: number,
  ): void {
    dismissLinkRoomsPrompt(false);

    const promptEl = document.createElement('div');
    promptEl.style.cssText = `
      position: absolute; top: 64px; left: 16px; z-index: 1300;
      width: 210px; overflow: hidden; border-radius: 4px;
      background: rgba(8,12,18,0.96); border: 1px solid rgba(80,255,160,0.75);
      box-shadow: 0 8px 24px rgba(0,0,0,0.55);
      color: #d8ffe8; font-family: monospace; cursor: pointer;
      opacity: 0; transform: translateY(-12px);
      transition: opacity 180ms ease, transform 180ms ease;
    `;

    const contentEl = document.createElement('div');
    contentEl.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 10px 9px;';

    const labelEl = document.createElement('div');
    labelEl.textContent = 'Link rooms?';
    labelEl.style.cssText = 'font-size:13px; font-weight:bold;';
    contentEl.appendChild(labelEl);

    const yesBtn = document.createElement('button');
    yesBtn.type = 'button';
    yesBtn.textContent = 'Yes';
    yesBtn.style.cssText = `
      padding: 4px 10px; border-radius: 3px; border: 1px solid rgba(120,255,180,0.8);
      background: rgba(30,120,70,0.75); color: #ecfff4; font-family: monospace;
      font-size: 12px; cursor: pointer;
    `;
    contentEl.appendChild(yesBtn);
    promptEl.appendChild(contentEl);

    const timerBar = document.createElement('div');
    timerBar.style.cssText = `
      height: 3px; width: 100%; background: #66ffaa;
      transition: width 5000ms linear;
    `;
    promptEl.appendChild(timerBar);
    overlay.appendChild(promptEl);

    const pending: PendingDoorLink = {
      sourceRoomId,
      sourceTransIndex,
      targetRoomId,
      targetTransIndex,
      promptEl,
      timeoutId: 0,
      removeTimeoutId: 0,
      hasResolved: false,
    };
    pendingDoorLink = pending;

    promptEl.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      confirmPendingDoorLink();
    });
    yesBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      confirmPendingDoorLink();
    });

    requestAnimationFrame(() => {
      promptEl.style.opacity = '1';
      promptEl.style.transform = 'translateY(0)';
      timerBar.style.width = '0%';
    });

    pending.timeoutId = window.setTimeout(() => {
      if (pendingDoorLink === pending && !pending.hasResolved) {
        dismissLinkRoomsPrompt(true);
      }
    }, 5000);
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
        callbacks.onWorldMapDataChanged?.();
        statusBar.textContent = `Renamed "${roomId}" \u2192 "${newName.trim()}"`;
        statusBar.style.color = '#88ff88';
        render();
      }
    });

    addMenuItem(`\ud83c\udf10 Move to World\u2026 (now: ${worldDisplayName(wId)})`, () => {
      showMoveToWorldDialog(dialogCtx, roomId, wId);
    });

    addMenuItem('\ud83c\udfa8 Change Color\u2026', () => {
      showColorPickerDialog(dialogCtx, roomId);
    });

    addMenuSep();

    addMenuItem('\u2715 Cancel', () => { /* auto-dismissed */ });

    overlay.appendChild(menu);
    contextMenuEl = menu;
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
    const DEPTH = 6;
    if (trans.depthBlock !== undefined) {
      // Interior transition: report center of the zone
      const depthMid = trans.depthBlock + DEPTH / 2;
      if (trans.direction === 'left' || trans.direction === 'right') {
        return [cx + depthMid, cy + mid];
      } else {
        return [cx + mid, cy + depthMid];
      }
    }
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
  function isTypingIntoField(e: KeyboardEvent): boolean {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return false;
    const tagName = target.tagName;
    return target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
  }

  function onKey(e: KeyboardEvent): void {
    if (isTypingIntoField(e)) return;
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
        callbacks.onWorldMapDataChanged?.();
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
    dismissLinkRoomsPrompt(false);
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
