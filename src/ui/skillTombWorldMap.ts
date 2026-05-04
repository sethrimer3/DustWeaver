/**
 * World Map tab for the Skill Tomb menu.
 *
 * Renders a canvas-based world map using the authored mapX/mapY positions
 * stored in each RoomDef (set via the visual map editor), zoom / pan,
 * and mouse interaction.  Returns a cleanup function that removes
 * window-level event listeners.
 */

import { ROOM_REGISTRY } from '../levels/rooms';
import type { RoomDef } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
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
  playerXWorld?: number,
  playerYWorld?: number,
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

  // Build room placements from the authored mapX/mapY positions stored in each RoomDef.
  // These are the same block-unit coordinates used by the visual map editor, so
  // dragging rooms in the editor directly controls where they appear here.
  const placements = new Map<string, RoomPlacement>();
  for (const room of exploredRooms) {
    placements.set(room.id, { room, mapXBlock: room.mapX, mapYBlock: room.mapY });
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
        const openSize = t.openingSizeBlocks;

        mapCtx.fillStyle = 'rgba(100,200,255,0.5)';
        for (let d = 0; d < openSize; d++) {
          let bx = 0;
          let by = 0;
          if (t.direction === 'left') {
            bx = 0;
            by = t.positionBlock + d;
          } else if (t.direction === 'right') {
            bx = room.widthBlocks - 1;
            by = t.positionBlock + d;
          } else if (t.direction === 'up') {
            bx = t.positionBlock + d;
            by = 0;
          } else if (t.direction === 'down') {
            bx = t.positionBlock + d;
            by = room.heightBlocks - 1;
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

      // Player position marker — shown only in the current room.
      if (isCurrentRoom && playerXWorld !== undefined && playerYWorld !== undefined) {
        const playerMapX = centerX + (mapXBlock + playerXWorld / BLOCK_SIZE_MEDIUM) * cellSize;
        const playerMapY = centerY + (mapYBlock + playerYWorld / BLOCK_SIZE_MEDIUM) * cellSize;
        const markerRadius = Math.max(3, cellSize * 1.0);
        mapCtx.save();
        mapCtx.beginPath();
        mapCtx.arc(playerMapX, playerMapY, markerRadius, 0, Math.PI * 2);
        mapCtx.fillStyle = '#00ffcc';
        mapCtx.shadowColor = '#00ffcc';
        mapCtx.shadowBlur = markerRadius * 2;
        mapCtx.fill();
        mapCtx.restore();
      }
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

    mapCtx.fillStyle = '#00ffcc';
    mapCtx.beginPath();
    mapCtx.arc(legendX + 5, legendY + 59, 5, 0, Math.PI * 2);
    mapCtx.fill();
    mapCtx.fillStyle = '#aaa';
    mapCtx.fillText('= You', legendX + 16, legendY + 63);
  }

  // ── Zoom (mouse wheel) ──────────────────────────────────────────────────
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = mapCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cw = mapCanvas.width;
    const ch = mapCanvas.height;

    // World coordinate under the mouse cursor before zoom changes.
    const worldX = (mx - cw / 2 - panXPx) / mapZoom;
    const worldY = (my - ch / 2 - panYPx) / mapZoom;

    const delta = e.deltaY > 0 ? -0.5 : 0.5;
    mapZoom = Math.max(1, Math.min(12, mapZoom + delta));

    // Adjust pan so the world point under the cursor stays fixed after zoom.
    panXPx = mx - cw / 2 - worldX * mapZoom;
    panYPx = my - ch / 2 - worldY * mapZoom;

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
