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
import { drawRoomSketch, drawRoomSketchOpenAir, smoothstep, ZOOM_SKETCH_FULL, ZOOM_DETAIL_FULL } from './mapSketchRenderer';
import { isDevModeEnabled } from './devMode';
import { isLegacyMapSketchEnabled, setLegacyMapSketchEnabled } from './mapSketchPreference';

/**
 * Set to true to draw a debug overlay on the world map showing each room's
 * computed map bounds (blue), padded sketch bounds (orange), and tile
 * dimensions (label).  Disable before shipping.
 */
const shouldDebugMapBounds = false;

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

  // ── Dev-only "Legacy Map Sketch" checkbox ────────────────────────────────
  // Total vertical space (in canvas px) reserved for the legend, measured
  // from the canvas bottom. Kept large enough that the "= You" row's marker
  // and label never get clipped by the canvas edge.
  const LEGEND_RESERVED_HEIGHT_PX = 80;
  const showLegacySketchToggle = isDevModeEnabled();
  let useLegacySketch = isLegacyMapSketchEnabled();

  if (showLegacySketchToggle) {
    const toggleLabel = document.createElement('label');
    toggleLabel.style.cssText = `
      position: absolute; left: 16px; display: flex; align-items: center; gap: 6px;
      bottom: ${LEGEND_RESERVED_HEIGHT_PX + 8}px;
      font-family: 'Cinzel', serif; font-size: 11px; color: #aaa;
      user-select: none; cursor: pointer; z-index: 1;
    `;
    const toggleInput = document.createElement('input');
    toggleInput.type = 'checkbox';
    toggleInput.checked = useLegacySketch;
    toggleInput.addEventListener('change', () => {
      useLegacySketch = toggleInput.checked;
      setLegacyMapSketchEnabled(useLegacySketch);
      renderMap();
    });
    toggleLabel.appendChild(toggleInput);
    toggleLabel.appendChild(document.createTextNode('Legacy Map Sketch'));
    mapContainer.appendChild(toggleLabel);
  }

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
        const drawSketch = useLegacySketch ? drawRoomSketch : drawRoomSketchOpenAir;
        drawSketch(
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
        // Dark ambient light blockers — treated as solid on the map to conceal secrets.
        for (const blocker of (room.ambientLightBlockers ?? [])) {
          if (!blocker.isDark) continue;
          const worldBx = mapXBlock + blocker.xBlock;
          const worldBy = mapYBlock + blocker.yBlock;
          const screenX = centerX + worldBx * cellSize;
          const screenY = centerY + worldBy * cellSize;
          mapCtx.fillStyle = isCurrentRoom ? 'rgba(212,168,75,0.6)' : 'rgba(150,140,120,0.4)';
          mapCtx.fillRect(screenX, screenY, cellSize, cellSize);
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
          const isHoriz = t.direction === 'left' || t.direction === 'right';
          const xB = t.xBlock !== undefined ? t.xBlock : (isHoriz ? 0 : t.positionBlock);
          const yB = t.yBlock !== undefined ? t.yBlock : (isHoriz ? t.positionBlock : 0);
          if (t.direction === 'left') {
            bx = xB;
            by = yB + d;
          } else if (t.direction === 'right') {
            bx = xB;
            by = yB + d;
          } else if (t.direction === 'up') {
            bx = xB + d;
            by = yB;
          } else if (t.direction === 'down') {
            bx = xB + d;
            by = yB;
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

    // ── Debug overlay: map bounds per room ────────────────────────────────
    // Enable by setting DEBUG_MAP_BOUNDS = true at the top of this file.
    if (shouldDebugMapBounds) {
      // Max sketch jitter in canvas pixels (mirrors JITTER_PX in mapSketchRenderer).
      const SKETCH_JITTER_CANVAS_PX = 3.5;
      placements.forEach(({ room, mapXBlock, mapYBlock }) => {
        // Map bounds: the tight tile-grid rectangle for this room.
        const mapLeft   = centerX + mapXBlock * cellSize;
        const mapTop    = centerY + mapYBlock * cellSize;
        const mapRight  = mapLeft  + room.widthBlocks  * cellSize;
        const mapBottom = mapTop   + room.heightBlocks * cellSize;

        // Padded sketch bounds: map bounds expanded by max jitter.
        const padPx     = SKETCH_JITTER_CANVAS_PX;
        const padLeft   = mapLeft   - padPx;
        const padTop    = mapTop    - padPx;
        const padRight  = mapRight  + padPx;
        const padBottom = mapBottom + padPx;

        // Draw padded bounds in orange (dashed).
        mapCtx.save();
        mapCtx.strokeStyle = 'rgba(255,140,0,0.7)';
        mapCtx.lineWidth = 1;
        mapCtx.setLineDash([4, 3]);
        mapCtx.strokeRect(padLeft, padTop, padRight - padLeft, padBottom - padTop);

        // Draw tight map bounds in blue (solid).
        mapCtx.strokeStyle = 'rgba(80,160,255,0.8)';
        mapCtx.setLineDash([]);
        mapCtx.strokeRect(mapLeft, mapTop, mapRight - mapLeft, mapBottom - mapTop);

        // Label: room id + block dimensions.
        mapCtx.fillStyle = 'rgba(80,200,255,0.9)';
        mapCtx.font = '9px monospace';
        mapCtx.textAlign = 'left';
        mapCtx.fillText(
          `${room.id} ${room.widthBlocks}×${room.heightBlocks}`,
          mapLeft + 2,
          mapTop + 10,
        );
        mapCtx.restore();
      });
    }

    // Legend
    mapCtx.textAlign = 'left';
    mapCtx.font = "12px 'Cinzel', serif";
    const legendY = ch - LEGEND_RESERVED_HEIGHT_PX;
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
