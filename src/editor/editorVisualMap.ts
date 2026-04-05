/**
 * Visual World Map Editor — a canvas-based overlay for arranging rooms and
 * linking transitions visually.
 *
 * Opens via the "N" key in editor mode. Rooms are displayed as rectangles
 * proportional to their block dimensions. Doors (transitions) appear as
 * small colored squares on the edges. Rooms can be dragged to rearrange.
 * Doors can be clicked to initiate or complete a link.
 *
 * Room positions are auto-laid-out via BFS on first open, and the user
 * can drag them to adjust.
 */

import { ROOM_REGISTRY } from '../levels/rooms';
import type { RoomDef, RoomTransitionDef } from '../levels/roomDef';

// ── Constants ────────────────────────────────────────────────────────────────

const PANEL_BG = '#0a0a0f';
const ROOM_FILL = 'rgba(30,40,55,0.9)';
const ROOM_STROKE = 'rgba(0,200,100,0.6)';
const ROOM_CURRENT_FILL = 'rgba(0,80,40,0.5)';
const ROOM_CURRENT_STROKE = '#00c864';
const DOOR_SIZE = 8;
const DOOR_FILL_LINKED = '#44aaff';
const DOOR_FILL_UNLINKED = '#ff8844';
const DOOR_FILL_HOVER = '#ffff44';
const LINK_LINE_COLOR = 'rgba(100,200,255,0.6)';
const LINK_LINE_ACTIVE = 'rgba(255,255,100,0.8)';
const TEXT_COLOR = '#c0ffd0';
const GREEN = '#00c864';

/** Scale factor: map units per block. Rooms are drawn at this scale. */
const DEFAULT_CELL_SIZE = 4;

// ── Types ────────────────────────────────────────────────────────────────────

interface MapRoomPlacement {
  room: RoomDef;
  mapXPx: number;
  mapYPx: number;
}

interface DoorHitArea {
  roomId: string;
  transitionIndex: number;
  xPx: number;
  yPx: number;
  wPx: number;
  hPx: number;
}

// ── Callbacks ────────────────────────────────────────────────────────────────

export interface VisualMapCallbacks {
  /** Called when the user wants to jump to a room (double-click). */
  onJumpToRoom: (room: RoomDef) => void;
  /** Called when the visual map closes. */
  onClose: () => void;
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
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 16px; background: rgba(0,0,0,0.5);
    border-bottom: 1px solid rgba(0,200,100,0.3);
  `;

  const titleEl = document.createElement('span');
  titleEl.textContent = '🗺 Visual World Map Editor';
  titleEl.style.cssText = `color: ${GREEN}; font-family: 'Cinzel', serif; font-size: 14px; font-weight: bold;`;
  header.appendChild(titleEl);

  const hintEl = document.createElement('span');
  hintEl.textContent = 'Drag rooms to arrange • Click door to start link • Double-click room to jump • N/ESC to close';
  hintEl.style.cssText = `color: rgba(200,255,200,0.5); font-size: 11px; font-family: monospace;`;
  header.appendChild(hintEl);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Close';
  closeBtn.style.cssText = `
    background: rgba(100,0,0,0.3); color: #ff8888; border: 1px solid rgba(255,100,100,0.3);
    font-family: monospace; font-size: 12px; cursor: pointer; border-radius: 3px; padding: 4px 10px;
  `;
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
  statusBar.textContent = 'Ready';
  overlay.appendChild(statusBar);

  // ── Canvas ─────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'flex: 1; cursor: grab;';
  overlay.appendChild(canvas);

  root.appendChild(overlay);

  const ctx = canvas.getContext('2d')!;

  // ── Compute room placements via BFS ────────────────────────────────────
  const placements = new Map<string, MapRoomPlacement>();
  computeAutoLayout(placements, currentRoomId);

  // ── View state ─────────────────────────────────────────────────────────
  let zoom = DEFAULT_CELL_SIZE;
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

  // Door linking state
  let linkSourceRoomId = '';
  let linkSourceTransIndex = -1;
  let hoveredDoor: DoorHitArea | null = null;

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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w / dpr, h / dpr);

    const canvasWCss = w / dpr;
    const canvasHCss = h / dpr;

    doorHitAreas = [];

    // Draw connection lines between linked rooms
    drawConnectionLines(ctx, placements, canvasWCss, canvasHCss);

    // Draw rooms
    for (const [roomId, placement] of placements) {
      drawRoom(ctx, placement, roomId === currentRoomId, canvasWCss, canvasHCss);
    }

    // Draw active link line (after rooms, so door hit areas are populated)
    if (linkSourceRoomId && linkSourceTransIndex >= 0) {
      drawActiveLinkLine(ctx, canvasWCss, canvasHCss);
    }
  }

  function worldToScreen(wxPx: number, wyPx: number): [number, number] {
    const canvasWCss = canvas.width / window.devicePixelRatio;
    const canvasHCss = canvas.height / window.devicePixelRatio;
    return [
      canvasWCss / 2 + panXPx + wxPx * zoom,
      canvasHCss / 2 + panYPx + wyPx * zoom,
    ];
  }

  function drawRoom(
    ctx2d: CanvasRenderingContext2D,
    placement: MapRoomPlacement,
    isCurrent: boolean,
    _canvasW: number,
    _canvasH: number,
  ): void {
    const room = placement.room;
    const [sx, sy] = worldToScreen(placement.mapXPx, placement.mapYPx);
    const rw = room.widthBlocks * zoom;
    const rh = room.heightBlocks * zoom;

    // Room rectangle
    ctx2d.fillStyle = isCurrent ? ROOM_CURRENT_FILL : ROOM_FILL;
    ctx2d.fillRect(sx, sy, rw, rh);
    ctx2d.strokeStyle = isCurrent ? ROOM_CURRENT_STROKE : ROOM_STROKE;
    ctx2d.lineWidth = isCurrent ? 2 : 1;
    ctx2d.strokeRect(sx, sy, rw, rh);

    // Room label
    const fontSize = Math.max(8, Math.min(12, zoom * 2));
    ctx2d.fillStyle = TEXT_COLOR;
    ctx2d.font = `${fontSize}px monospace`;
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    const label = room.name || room.id;
    ctx2d.fillText(label, sx + rw / 2, sy + rh / 2 - fontSize * 0.6, rw - 4);

    // Room ID below name
    ctx2d.fillStyle = 'rgba(200,255,200,0.4)';
    ctx2d.font = `${Math.max(7, fontSize - 2)}px monospace`;
    ctx2d.fillText(room.id, sx + rw / 2, sy + rh / 2 + fontSize * 0.5, rw - 4);

    // Draw doors (transitions)
    for (let i = 0; i < room.transitions.length; i++) {
      drawDoor(ctx2d, room, placement, i, sx, sy, rw, rh);
    }
  }

  function drawDoor(
    ctx2d: CanvasRenderingContext2D,
    room: RoomDef,
    _placement: MapRoomPlacement,
    transIndex: number,
    roomSx: number,
    roomSy: number,
    roomW: number,
    roomH: number,
  ): void {
    const trans = room.transitions[transIndex];
    const ds = Math.max(4, Math.min(DOOR_SIZE, zoom * 1.5));

    // Position the door on the edge of the room
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
      // down
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

    // Door number label
    const numSize = Math.max(6, ds - 1);
    ctx2d.fillStyle = '#000';
    ctx2d.font = `bold ${numSize}px monospace`;
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText(String(transIndex + 1), dx + ds / 2, dy + ds / 2);

    // Register hit area
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
    _canvasW: number,
    _canvasH: number,
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

        // Avoid drawing duplicate lines
        const pairKey = [roomId, trans.targetRoomId].sort().join('|');
        if (drawn.has(pairKey)) continue;
        drawn.add(pairKey);

        // Get door center positions
        const [sx, sy] = worldToScreen(placement.mapXPx, placement.mapYPx);
        const rw = room.widthBlocks * zoom;
        const rh = room.heightBlocks * zoom;
        const srcPos = getDoorCenter(trans, sx, sy, rw, rh);

        // Find reverse transition in target room
        const targetRoom = targetPlacement.room;
        const reverseTrans = targetRoom.transitions.find(t => t.targetRoomId === roomId);
        const [tsx, tsy] = worldToScreen(targetPlacement.mapXPx, targetPlacement.mapYPx);
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

  function drawActiveLinkLine(
    ctx2d: CanvasRenderingContext2D,
    _canvasW: number,
    _canvasH: number,
  ): void {
    const sourceDoor = findDoorHitArea(linkSourceRoomId, linkSourceTransIndex);
    if (!sourceDoor) return;

    const srcCx = sourceDoor.xPx + sourceDoor.wPx / 2;
    const srcCy = sourceDoor.yPx + sourceDoor.hPx / 2;

    // Draw line to mouse position
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

  // ── Center view on a room ──────────────────────────────────────────────
  function centerOnRoom(roomId: string): void {
    const placement = placements.get(roomId);
    if (!placement) return;
    const room = placement.room;
    panXPx = -(placement.mapXPx + room.widthBlocks / 2) * zoom;
    panYPx = -(placement.mapYPx + room.heightBlocks / 2) * zoom;
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
      const [sx, sy] = worldToScreen(placement.mapXPx, placement.mapYPx);
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

    // Update hovered door
    hoveredDoor = hitTestDoor(mx, my);

    if (isDraggingRoom && dragRoomId) {
      const dx = e.clientX - dragStartXPx;
      const dy = e.clientY - dragStartYPx;
      const placement = placements.get(dragRoomId);
      if (placement) {
        placement.mapXPx = dragRoomStartXPx + dx / zoom;
        placement.mapYPx = dragRoomStartYPx + dy / zoom;
      }
      render();
    } else if (isDraggingPan) {
      panXPx = dragStartPanXPx + (e.clientX - dragStartXPx);
      panYPx = dragStartPanYPx + (e.clientY - dragStartYPx);
      render();
    } else if (linkSourceRoomId) {
      // Redraw to update active link line
      render();
    } else {
      render();
    }

    // Update cursor
    if (hoveredDoor) {
      canvas.style.cursor = 'pointer';
    } else if (hitTestRoom(mx, my)) {
      canvas.style.cursor = isDraggingRoom ? 'grabbing' : 'grab';
    } else {
      canvas.style.cursor = isDraggingPan ? 'grabbing' : 'grab';
    }
  }

  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Check door click first
    const door = hitTestDoor(mx, my);
    if (door) {
      if (linkSourceRoomId) {
        // Complete the link
        completeDoorLink(door);
      } else {
        // Start a new link
        linkSourceRoomId = door.roomId;
        linkSourceTransIndex = door.transitionIndex;
        statusBar.textContent = `Linking: ${door.roomId} Door #${door.transitionIndex + 1} — click another door to link, or ESC to cancel`;
        render();
      }
      return;
    }

    // If clicking empty space while linking, cancel
    if (linkSourceRoomId) {
      cancelDoorLink();
      return;
    }

    // Check room drag
    const roomId = hitTestRoom(mx, my);
    if (roomId) {
      isDraggingRoom = true;
      dragRoomId = roomId;
      dragStartXPx = e.clientX;
      dragStartYPx = e.clientY;
      const placement = placements.get(roomId);
      if (placement) {
        dragRoomStartXPx = placement.mapXPx;
        dragRoomStartYPx = placement.mapYPx;
      }
      canvas.style.cursor = 'grabbing';
      return;
    }

    // Pan
    isDraggingPan = true;
    dragStartXPx = e.clientX;
    dragStartYPx = e.clientY;
    dragStartPanXPx = panXPx;
    dragStartPanYPx = panYPx;
    canvas.style.cursor = 'grabbing';
  }

  function onMouseUp(_e: MouseEvent): void {
    isDraggingRoom = false;
    dragRoomId = '';
    isDraggingPan = false;
    canvas.style.cursor = 'grab';
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

    // Zoom towards mouse position
    const canvasWCss = canvas.width / window.devicePixelRatio;
    const canvasHCss = canvas.height / window.devicePixelRatio;
    const worldX = (mx - canvasWCss / 2 - panXPx) / oldZoom;
    const worldY = (my - canvasHCss / 2 - panYPx) / oldZoom;
    panXPx = mx - canvasWCss / 2 - worldX * zoom;
    panYPx = my - canvasHCss / 2 - worldY * zoom;

    render();
  }

  function completeDoorLink(targetDoor: DoorHitArea): void {
    // We don't modify RoomDef directly (it's readonly). Instead, show a status message.
    // The actual link is done through the room editor's transition linker.
    const sourceRoom = ROOM_REGISTRY.get(linkSourceRoomId);
    const targetRoom = ROOM_REGISTRY.get(targetDoor.roomId);
    if (sourceRoom && targetRoom) {
      statusBar.textContent =
        `Linked: ${linkSourceRoomId} Door #${linkSourceTransIndex + 1} → ${targetDoor.roomId} Door #${targetDoor.transitionIndex + 1}` +
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

  // ── Keyboard ───────────────────────────────────────────────────────────
  function onKey(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
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
  window.addEventListener('keydown', onKey);

  function destroy(): void {
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

function computeAutoLayout(
  placements: Map<string, MapRoomPlacement>,
  startRoomId: string,
): void {
  const allRooms: RoomDef[] = [];
  ROOM_REGISTRY.forEach((room) => allRooms.push(room));

  if (allRooms.length === 0) return;

  const startRoom = ROOM_REGISTRY.get(startRoomId) ?? allRooms[0];
  placements.set(startRoom.id, { room: startRoom, mapXPx: 0, mapYPx: 0 });

  const queue = [startRoom];
  const visited = new Set<string>([startRoom.id]);

  const GAP = 6; // gap between rooms in blocks

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
        offsetX = current.widthBlocks + GAP;
      } else if (transition.direction === 'left') {
        offsetX = -(targetRoom.widthBlocks + GAP);
      } else if (transition.direction === 'down') {
        offsetY = current.heightBlocks + GAP;
      } else if (transition.direction === 'up') {
        offsetY = -(targetRoom.heightBlocks + GAP);
      }

      placements.set(targetRoom.id, {
        room: targetRoom,
        mapXPx: currentPlacement.mapXPx + offsetX,
        mapYPx: currentPlacement.mapYPx + offsetY,
      });
      visited.add(targetRoom.id);
      queue.push(targetRoom);
    }
  }

  // Place any unvisited rooms in a row below
  let unvisitedX = 0;
  let maxYPx = 0;
  for (const [, p] of placements) {
    maxYPx = Math.max(maxYPx, p.mapYPx + p.room.heightBlocks);
  }

  for (const room of allRooms) {
    if (!visited.has(room.id)) {
      placements.set(room.id, {
        room,
        mapXPx: unvisitedX,
        mapYPx: maxYPx + 10,
      });
      unvisitedX += room.widthBlocks + 6;
      visited.add(room.id);
    }
  }
}
