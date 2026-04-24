/**
 * World Map tab for the Skill Tomb menu.
 *
 * Renders a canvas-based world map with BFS-placed rooms, zoom / pan,
 * and mouse interaction.  Returns a cleanup function that removes
 * window-level event listeners.
 */

import { ROOM_REGISTRY } from '../levels/rooms';
import type { RoomDef } from '../levels/roomDef';
import { GOLD } from './skillTombShared';
import { drawRoomSketch, smoothstep, ZOOM_SKETCH_FULL, ZOOM_DETAIL_FULL } from './mapSketchRenderer';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RoomPlacement {
  room: RoomDef;
  mapXBlock: number;
  mapYBlock: number;
}

// ── Public entry point ────────────────────────────────────────────────────────

export function buildMapTab(
  contentArea: HTMLElement,
  currentRoomId: string,
  exploredRoomIds: ReadonlyArray<string>,
): () => void {
  const mapContainer = document.createElement('div');
  mapContainer.style.cssText = `
    position: relative; width: 100%; height: 100%;
    overflow: hidden; min-height: 400px;
  `;
  contentArea.appendChild(mapContainer);

  const mapCanvas = document.createElement('canvas');
  mapCanvas.style.cssText = 'width:100%; height:100%; cursor:grab;';
  mapContainer.appendChild(mapCanvas);

  const mapCtx = mapCanvas.getContext('2d')!;

  // Gather explored rooms
  const exploredRooms: RoomDef[] = [];
  const exploredSet = new Set(exploredRoomIds);
  ROOM_REGISTRY.forEach((room) => {
    if (exploredSet.has(room.id)) {
      exploredRooms.push(room);
    }
  });

  // Compute room positions via BFS from lobby
  const placements = new Map<string, RoomPlacement>();

  if (exploredRooms.length > 0) {
    const startRoom = exploredRooms.find(r => r.id === 'lobby') ?? exploredRooms[0];
    placements.set(startRoom.id, { room: startRoom, mapXBlock: 0, mapYBlock: 0 });

    const queue = [startRoom];
    const visited = new Set<string>([startRoom.id]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentPlacement = placements.get(current.id)!;

      for (const transition of current.transitions) {
        if (visited.has(transition.targetRoomId)) continue;
        const targetRoom = ROOM_REGISTRY.get(transition.targetRoomId);
        if (!targetRoom || !exploredSet.has(targetRoom.id)) continue;

        let offsetX = 0;
        let offsetY = 0;
        if (transition.direction === 'right') {
          offsetX = current.widthBlocks + 4;
        } else if (transition.direction === 'left') {
          offsetX = -(targetRoom.widthBlocks + 4);
        } else if (transition.direction === 'down') {
          offsetY = current.heightBlocks + 4;
        } else if (transition.direction === 'up') {
          offsetY = -(targetRoom.heightBlocks + 4);
        }

        placements.set(targetRoom.id, {
          room: targetRoom,
          mapXBlock: currentPlacement.mapXBlock + offsetX,
          mapYBlock: currentPlacement.mapYBlock + offsetY,
        });
        visited.add(targetRoom.id);
        queue.push(targetRoom);
      }
    }
  }

  // ── Map view state ──────────────────────────────────────────────────────
  let mapZoom = 3;
  let panXPx = 0;
  let panYPx = 0;
  let isDragging = false;
  let dragStartXPx = 0;
  let dragStartYPx = 0;
  let dragStartPanXPx = 0;
  let dragStartPanYPx = 0;

  function resizeMapCanvas(): void {
    const rect = mapContainer.getBoundingClientRect();
    mapCanvas.width = rect.width;
    mapCanvas.height = rect.height;
    renderMap();
  }

  function renderMap(): void {
    const cw = mapCanvas.width;
    const ch = mapCanvas.height;
    mapCtx.clearRect(0, 0, cw, ch);
    mapCtx.fillStyle = 'rgba(5,5,15,0.95)';
    mapCtx.fillRect(0, 0, cw, ch);

    const centerX = cw / 2 + panXPx;
    const centerY = ch / 2 + panYPx;
    const cellSize = mapZoom;

    // LOD blend: smoothly transition between detail blocks and sketch silhouettes.
    // detailAlpha = 1 when zoomed in (≥ ZOOM_DETAIL_FULL), 0 when zoomed out (≤ ZOOM_SKETCH_FULL).
    const detailAlpha = smoothstep(ZOOM_SKETCH_FULL, ZOOM_DETAIL_FULL, mapZoom);
    const sketchAlpha = 1 - detailAlpha;
    const showDetail = detailAlpha > 0.01;
    const showSketch = sketchAlpha > 0.01;

    // Draw each explored room
    placements.forEach((placement) => {
      const { room, mapXBlock, mapYBlock } = placement;
      const isCurrentRoom = room.id === currentRoomId;

      // ── Sketch layer: silhouette with organic jitter ──────────────────────
      if (showSketch) {
        drawRoomSketch(
          mapCtx, room, mapXBlock, mapYBlock,
          centerX, centerY, cellSize,
          sketchAlpha, isCurrentRoom,
        );
      }

      // ── Detail layer: individual block tiles ──────────────────────────────
      if (showDetail) {
        mapCtx.save();
        mapCtx.globalAlpha = detailAlpha;
        for (const wall of room.walls) {
          for (let bx = 0; bx < wall.wBlock; bx++) {
            for (let by = 0; by < wall.hBlock; by++) {
              const worldBx = mapXBlock + wall.xBlock + bx;
              const worldBy = mapYBlock + wall.yBlock + by;
              const screenX = centerX + worldBx * cellSize;
              const screenY = centerY + worldBy * cellSize;

              mapCtx.fillStyle = isCurrentRoom ? 'rgba(212,168,75,0.6)' : 'rgba(150,140,120,0.4)';
              mapCtx.fillRect(screenX, screenY, cellSize, cellSize);
            }
          }
        }
        mapCtx.restore();
      }

      // ── Markers: always at full opacity (doors, tombs, labels) ───────────
      // Doorways — shown in both modes so connections remain readable.
      for (const t of room.transitions) {
        const openTop = t.positionBlock;
        const openSize = t.openingSizeBlocks;

        mapCtx.fillStyle = 'rgba(100,200,255,0.5)';
        for (let d = 0; d < openSize; d++) {
          let bx = 0;
          const by = openTop + d;
          if (t.direction === 'left') {
            bx = 0;
          } else if (t.direction === 'right') {
            bx = room.widthBlocks - 1;
          }
          const screenX = centerX + (mapXBlock + bx) * cellSize;
          const screenY = centerY + (mapYBlock + by) * cellSize;
          mapCtx.fillRect(screenX, screenY, cellSize, cellSize);
        }
      }

      // Save tombs — diamond markers remain crisp at all zoom levels.
      for (const tomb of room.saveTombs) {
        const screenX = centerX + (mapXBlock + tomb.xBlock) * cellSize;
        const screenY = centerY + (mapYBlock + tomb.yBlock) * cellSize;
        mapCtx.fillStyle = '#d4a84b';
        mapCtx.fillRect(screenX - cellSize * 0.5, screenY - cellSize * 0.5, cellSize * 2, cellSize * 2);

        // Small diamond marker
        mapCtx.beginPath();
        const mx = screenX + cellSize * 0.5;
        const my = screenY + cellSize * 0.5;
        const ms = cellSize * 1.2;
        mapCtx.moveTo(mx, my - ms);
        mapCtx.lineTo(mx + ms, my);
        mapCtx.lineTo(mx, my + ms);
        mapCtx.lineTo(mx - ms, my);
        mapCtx.closePath();
        mapCtx.fillStyle = 'rgba(212,168,75,0.8)';
        mapCtx.fill();
      }

      // Room name label.
      const roomCenterX = centerX + (mapXBlock + room.widthBlocks / 2) * cellSize;
      const roomTopY = centerY + mapYBlock * cellSize;
      mapCtx.fillStyle = isCurrentRoom ? GOLD : 'rgba(200,190,170,0.6)';
      mapCtx.font = `${Math.max(10, cellSize * 2.5)}px 'Cinzel', serif`;
      mapCtx.textAlign = 'center';
      mapCtx.fillText(room.name, roomCenterX, roomTopY - cellSize * 1.5);
    });

    // Legend
    mapCtx.textAlign = 'left';
    mapCtx.font = "12px 'Cinzel', serif";
    const legendY = ch - 60;
    const legendX = 16;
    mapCtx.fillStyle = 'rgba(212,168,75,0.6)';
    mapCtx.fillRect(legendX, legendY, 10, 10);
    mapCtx.fillStyle = '#aaa';
    mapCtx.fillText('= Blocks', legendX + 16, legendY + 9);

    mapCtx.fillStyle = 'rgba(100,200,255,0.5)';
    mapCtx.fillRect(legendX, legendY + 18, 10, 10);
    mapCtx.fillStyle = '#aaa';
    mapCtx.fillText('= Doorways', legendX + 16, legendY + 27);

    mapCtx.fillStyle = 'rgba(212,168,75,0.8)';
    mapCtx.fillRect(legendX, legendY + 36, 10, 10);
    mapCtx.fillStyle = '#aaa';
    mapCtx.fillText('= Skill Tomb', legendX + 16, legendY + 45);
  }

  // ── Zoom (mouse wheel) ──────────────────────────────────────────────────
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.5 : 0.5;
    mapZoom = Math.max(1, Math.min(12, mapZoom + delta));
    renderMap();
  }

  // ── Pan (mouse drag) ────────────────────────────────────────────────────
  function onMouseDown(e: MouseEvent): void {
    isDragging = true;
    dragStartXPx = e.clientX;
    dragStartYPx = e.clientY;
    dragStartPanXPx = panXPx;
    dragStartPanYPx = panYPx;
    mapCanvas.style.cursor = 'grabbing';
  }

  function onMouseMove(e: MouseEvent): void {
    if (!isDragging) return;
    panXPx = dragStartPanXPx + (e.clientX - dragStartXPx);
    panYPx = dragStartPanYPx + (e.clientY - dragStartYPx);
    renderMap();
  }

  function onMouseUp(): void {
    isDragging = false;
    mapCanvas.style.cursor = 'grab';
  }

  mapCanvas.addEventListener('wheel', onWheel, { passive: false });
  mapCanvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  // Center on current room
  const currentPlacement = placements.get(currentRoomId);
  if (currentPlacement) {
    const cx = (currentPlacement.mapXBlock + currentPlacement.room.widthBlocks / 2) * mapZoom;
    const cy = (currentPlacement.mapYBlock + currentPlacement.room.heightBlocks / 2) * mapZoom;
    panXPx = -cx;
    panYPx = -cy;
  }

  resizeMapCanvas();

  // Return cleanup that removes window-level listeners
  return () => {
    mapCanvas.removeEventListener('wheel', onWheel);
    mapCanvas.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };
}
