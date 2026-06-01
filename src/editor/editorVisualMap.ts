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

import { ROOM_REGISTRY, setRoomMapPosition, setRoomNameOverride } from '../levels/rooms';
import { exportWorldMapJson } from './editorExport';
import { createSubstrateEffect } from '../render/effects/substrateEffect';
import { GREEN } from './editorStyles';
import {
  MapRoomPlacement,
  SnapIndicator,
  VisualMapCallbacks,
  effectiveRoomName,
  effectiveWorldId,
  worldDisplayName,
  computeAutoLayout,
  applyDoorSnap,
} from './editorVisualMapHelpers';
import {
  type VisualMapDrawCtx,
  DOOR_SNAP_COLOR,
  drawRoom,
  drawConnectionLines,
  drawActiveLinkLine,
  drawSnapIndicator,
} from './editorVisualMapRenderer';
import {
  VisualMapDialogContext,
  makeHeaderBtn,
  showMoveToWorldDialog,
  showAddRoomDialog,
  showAddWorldDialog,
  showColorPickerDialog,
} from './editorVisualMapDialogs';
import {
  type DoorHitArea,
  type PendingDoorLink,
  type VisualMapLinkContext,
  showLinkRoomsPrompt,
  dismissLinkRoomsPrompt,
  completeDoorLink,
  cancelDoorLink,
} from './editorVisualMapLinkPrompt';

// ── Constants ────────────────────────────────────────────────────────────────

const PANEL_BG = '#0a0a0f';

/** Screen-pixel distance within which two facing doorways snap together. */
const SNAP_THRESHOLD_PX = 40;

/** Scale factor: screen pixels per map world unit at default zoom. */
const DEFAULT_ZOOM_SCALE = 4;

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
  titleEl.textContent = '🗺 Visual Zone Map Editor';
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

  const addWorldBtn = makeHeaderBtn('+ Add Zone', '#6688cc');
  addWorldBtn.title = 'Create a new zone group';
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
  statusBar.textContent = 'Ready \u2014 right-click a room to rename or move it between zones';
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

  // ── Link context ────────────────────────────────────────────────────────
  // Bundles mutable link state behind getter/setter closures so the
  // door-link functions in editorVisualMapLinkPrompt.ts can access it.
  const linkCtx: VisualMapLinkContext = {
    overlay,
    statusBar,
    render: () => render(),
    onWorldMapDataChanged: callbacks.onWorldMapDataChanged,
    getPendingLink:          () => pendingDoorLink,
    setPendingLink:          (link) => { pendingDoorLink = link; },
    getLinkSourceRoomId:     () => linkSourceRoomId,
    getLinkSourceTransIndex: () => linkSourceTransIndex,
    setLinkSource: (roomId, transIndex) => {
      linkSourceRoomId = roomId;
      linkSourceTransIndex = transIndex;
    },
    clearLinkSource: () => {
      linkSourceRoomId = '';
      linkSourceTransIndex = -1;
    },
  };

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

    const canvasRect = canvas.getBoundingClientRect();
    const drawCtx: VisualMapDrawCtx = {
      worldToScreen,
      zoom,
      roomColorOverrides,
      hoveredDoor,
      linkSourceRoomId,
      linkSourceTransIndex,
      doorHitAreas,
      snapIndicator,
      adjustedMouseXPx: lastMouseXPx - canvasRect.left,
      adjustedMouseYPx: lastMouseYPx - canvasRect.top,
    };

    drawConnectionLines(ctx, drawCtx, placements);

    for (const [roomId, placement] of placements) {
      drawRoom(ctx, drawCtx, placement, roomId === currentRoomId, roomId === selectedRoomId);
    }

    if (snapIndicator) {
      drawSnapIndicator(ctx, drawCtx);
    }

    if (linkSourceRoomId && linkSourceTransIndex >= 0) {
      drawActiveLinkLine(ctx, drawCtx);
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
        snapIndicator = applyDoorSnap(dragRoomId, placement, placements, SNAP_THRESHOLD_PX / zoom);
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
        completeDoorLink_impl(door);
      } else {
        linkCtx.setLinkSource(door.roomId, door.transitionIndex);
        isDraggingDoorLink = true;
        statusBar.textContent = `Linking: ${door.roomId} Door #${door.transitionIndex + 1} \u2014 click another door to link, or ESC to cancel`;
        render();
      }
      return;
    }

    if (linkSourceRoomId) {
      cancelDoorLink_impl();
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
          completeDoorLink_impl(door);
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
              linkCtx,
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

  function completeDoorLink_impl(targetDoor: DoorHitArea): void {
    completeDoorLink(linkCtx, targetDoor);
  }

  function cancelDoorLink_impl(): void {
    isDraggingDoorLink = false;
    cancelDoorLink(linkCtx);
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

    addMenuItem(`\ud83c\udf10 Move to Zone\u2026 (now: ${worldDisplayName(wId)})`, () => {
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
        cancelDoorLink_impl();
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
    dismissLinkRoomsPrompt(linkCtx, false);
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
