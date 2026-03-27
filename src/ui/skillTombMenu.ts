/**
 * Skill Tomb menu — opened when the player interacts with a skill tomb.
 *
 * Two tabs:
 *   1. Loadout — particle kind selection (same content as the old loadout screen)
 *   2. World Map — room-based map showing explored rooms with zoom/pan
 *
 * Has an "X" button in the top-right corner and ESC closes the menu
 * without opening the pause menu.
 *
 * All text: Cinzel, Regular 400.
 */

import { ParticleKind, EQUIPPABLE_KINDS } from '../sim/particles/kinds';
import { getSlotCost, totalSlotCost } from '../sim/particles/slotCost';
import { PlayerProgress } from '../progression/playerProgress';
import { ROOM_REGISTRY } from '../levels/rooms';
import type { RoomDef } from '../levels/roomDef';

export interface SkillTombMenuCallbacks {
  onClose: (updatedLoadout: ParticleKind[]) => void;
}

// ── Display metadata per kind ─────────────────────────────────────────────────

interface KindMeta {
  name: string;
  description: string;
  colorHex: string;
}

const KIND_META: KindMeta[] = [
  { name: 'Physical',  colorHex: '#7799aa', description: 'Dense, grounded particles. Steady and reliable.' },
  { name: 'Fire',      colorHex: '#ff5500', description: 'Flickering flames. Chaotic and short-lived.' },
  { name: 'Ice',       colorHex: '#88ddff', description: 'Crystalline frost. Structured and long-lived.' },
  { name: 'Lightning', colorHex: '#ffff44', description: 'Electric sparks. Explosive and volatile.' },
  { name: 'Poison',    colorHex: '#44ff44', description: 'Toxic cloud. Sticky and diffuse.' },
  { name: 'Arcane',    colorHex: '#cc44ff', description: 'Mystic spiral. Strange turbulence.' },
  { name: 'Wind',      colorHex: '#88ffee', description: 'Rushing gusts. Fast and highly aligned.' },
  { name: 'Holy',      colorHex: '#ffeeaa', description: 'Sacred light. Rising and orderly.' },
  { name: 'Shadow',    colorHex: '#9966ff', description: 'Dark tendrils. Sinking and unstable.' },
  { name: 'Metal',     colorHex: '#aabbcc', description: 'Iron shards. Dense, durable. Reflects damage when blocking.' },
  { name: 'Earth',     colorHex: '#aa8833', description: 'Stone fragments. Grounded and steady.' },
  { name: 'Nature',    colorHex: '#44cc44', description: 'Living vines. Organic and gentle.' },
  { name: 'Crystal',   colorHex: '#aaeeff', description: 'Prismatic shards. Precise and brilliant.' },
  { name: 'Void',      colorHex: '#9933cc', description: 'Dark matter rings. Exotic and powerful.' },
  { name: 'Water',     colorHex: '#2299ee', description: 'Flowing currents. Fluid and persistent.' },
  { name: 'Lava',      colorHex: '#ff2200', description: 'Molten rock. Slow, devastating, burns everything near it.' },
  { name: 'Stone',     colorHex: '#888899', description: 'Rock fragments. Shatters into smaller pieces on impact.' },
];

// ── Shape preview ─────────────────────────────────────────────────────────────

function drawShapePreview(canvas: HTMLCanvasElement, kind: ParticleKind, colorHex: string): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.35;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = colorHex;
  ctx.strokeStyle = colorHex;
  ctx.lineWidth = 1.5;

  switch (kind) {
    case ParticleKind.Physical:
    case ParticleKind.Nature:
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    case ParticleKind.Lightning:
    case ParticleKind.Wind:
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
      break;
    case ParticleKind.Shadow:
    case ParticleKind.Metal:
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      break;
    case ParticleKind.Fire:
    case ParticleKind.Earth:
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy + r * 0.5);
      ctx.lineTo(cx - r, cy + r * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    case ParticleKind.Ice:
    case ParticleKind.Crystal: {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
        const vx = cx + Math.cos(a) * r;
        const vy = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case ParticleKind.Holy:
      ctx.fillRect(cx - r, cy - r * 0.4, r * 2, r * 0.8);
      ctx.fillRect(cx - r * 0.4, cy - r, r * 0.8, r * 2);
      break;
    case ParticleKind.Poison:
    case ParticleKind.Arcane: {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rad = i % 2 === 0 ? r : r * 0.4;
        const vx = cx + Math.cos(a) * rad;
        const vy = cy + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case ParticleKind.Void:
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      break;
    default:
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const GOLD = '#d4a84b';
const GOLD_DIM = 'rgba(212,168,75,0.4)';
const PANEL_BG = 'rgba(10,8,6,0.95)';

// ── Public entry point ────────────────────────────────────────────────────────

export function showSkillTombMenu(
  root: HTMLElement,
  progress: PlayerProgress,
  currentRoomId: string,
  callbacks: SkillTombMenuCallbacks,
): () => void {
  let loadout: ParticleKind[] = progress.loadout.slice();
  const { dustSlots } = progress;
  let activeTab: 'loadout' | 'map' = 'loadout';

  // ── Overlay ──────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: ${PANEL_BG};
    z-index: 1500;
    display: flex; flex-direction: column;
    font-family: 'Cinzel', serif; font-weight: 400; color: #eee;
  `;

  // ── Top bar ──────────────────────────────────────────────────────────────
  const topBar = document.createElement('div');
  topBar.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 20px; border-bottom: 1px solid rgba(212,168,75,0.25);
    flex-shrink: 0;
  `;

  // Tab buttons
  const tabRow = document.createElement('div');
  tabRow.style.cssText = 'display: flex; gap: 0;';

  function createTabBtn(label: string, tabId: 'loadout' | 'map'): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset.tabId = tabId;
    btn.style.cssText = `
      padding: 8px 24px; font-family: 'Cinzel', serif; font-weight: 400;
      font-size: 1rem; cursor: pointer; border: none;
      border-bottom: 2px solid transparent;
      transition: all 0.15s;
    `;
    btn.addEventListener('click', () => {
      activeTab = tabId;
      updateTabs();
    });
    return btn;
  }

  const loadoutTabBtn = createTabBtn('Loadout', 'loadout');
  const mapTabBtn = createTabBtn('World Map', 'map');
  tabRow.appendChild(loadoutTabBtn);
  tabRow.appendChild(mapTabBtn);
  topBar.appendChild(tabRow);

  // X close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = `
    background: transparent; border: 1px solid ${GOLD_DIM};
    color: ${GOLD}; font-size: 1.3rem; width: 36px; height: 36px;
    cursor: pointer; border-radius: 4px; font-family: 'Cinzel', serif;
    font-weight: 400; line-height: 1;
    transition: all 0.15s;
  `;
  closeBtn.addEventListener('mouseenter', () => {
    closeBtn.style.background = 'rgba(212,168,75,0.15)';
    closeBtn.style.borderColor = GOLD;
  });
  closeBtn.addEventListener('mouseleave', () => {
    closeBtn.style.background = 'transparent';
    closeBtn.style.borderColor = GOLD_DIM;
  });
  closeBtn.addEventListener('click', () => {
    destroy();
    callbacks.onClose(loadout.slice());
  });
  topBar.appendChild(closeBtn);
  overlay.appendChild(topBar);

  // ── Content area ─────────────────────────────────────────────────────────
  const contentArea = document.createElement('div');
  contentArea.style.cssText = `
    flex: 1; overflow-y: auto; overflow-x: hidden;
    padding: 16px 20px;
  `;
  overlay.appendChild(contentArea);

  // ── Tab update ───────────────────────────────────────────────────────────
  function updateTabs(): void {
    // Update tab button styles
    const isLoadout = activeTab === 'loadout';
    loadoutTabBtn.style.color = isLoadout ? '#fff' : GOLD;
    loadoutTabBtn.style.background = isLoadout ? 'rgba(212,168,75,0.2)' : 'transparent';
    loadoutTabBtn.style.borderBottomColor = isLoadout ? GOLD : 'transparent';
    mapTabBtn.style.color = !isLoadout ? '#fff' : GOLD;
    mapTabBtn.style.background = !isLoadout ? 'rgba(212,168,75,0.2)' : 'transparent';
    mapTabBtn.style.borderBottomColor = !isLoadout ? GOLD : 'transparent';

    contentArea.innerHTML = '';
    if (activeTab === 'loadout') {
      buildLoadoutTab();
    } else {
      buildMapTab();
    }
  }

  // ── Loadout Tab ──────────────────────────────────────────────────────────
  function buildLoadoutTab(): void {
    // Slot meter
    const meterContainer = document.createElement('div');
    meterContainer.style.cssText = `
      width: 100%; max-width: 640px; margin: 0 auto 16px;
      background: #111; border: 1px solid #333; border-radius: 6px;
      padding: 10px 14px; box-sizing: border-box;
    `;
    contentArea.appendChild(meterContainer);

    function renderMeter(): void {
      const used = totalSlotCost(loadout);
      const pct = Math.min(100, (used / dustSlots) * 100);
      const isOverBudget = used > dustSlots;
      const barColor = isOverBudget ? '#ff4444' : used >= dustSlots ? '#00ff88' : GOLD;
      meterContainer.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="color:#aaa; font-size:0.85rem; font-family:'Cinzel',serif; font-weight:400;">DUST SLOTS</span>
          <span style="color:${isOverBudget ? '#ff4444' : '#eee'}; font-size:0.9rem; font-family:'Cinzel',serif; font-weight:400;">
            ${used} / ${dustSlots}
          </span>
        </div>
        <div style="height:8px; background:#222; border-radius:4px; overflow:hidden;">
          <div style="height:100%; width:${pct}%; background:${barColor}; border-radius:4px; transition:width 0.2s, background 0.2s;"></div>
        </div>
        ${isOverBudget ? '<p style="color:#ff4444; font-size:0.75rem; margin:6px 0 0; font-family:\'Cinzel\',serif; font-weight:400;">Over slot limit — remove a particle type.</p>' : ''}
      `;
    }

    // Particle cards grid
    const grid = document.createElement('div');
    grid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
      gap: 10px; width: 100%; max-width: 720px; margin: 0 auto;
    `;
    contentArea.appendChild(grid);

    const cardEls: HTMLDivElement[] = [];

    for (let k = 0; k < EQUIPPABLE_KINDS.length; k++) {
      const kind = EQUIPPABLE_KINDS[k];
      const meta = KIND_META[k];
      const cost = getSlotCost(kind);

      const card = document.createElement('div');
      card.style.cssText = `
        border: 2px solid #333; border-radius: 8px;
        padding: 10px; cursor: pointer; transition: border-color 0.15s, background 0.15s;
        background: #0d0d1a; user-select: none;
        display: flex; flex-direction: column; gap: 6px;
      `;

      const previewCanvas = document.createElement('canvas');
      previewCanvas.width = 40;
      previewCanvas.height = 40;
      previewCanvas.style.cssText = 'align-self:center;';
      card.appendChild(previewCanvas);

      const nameRow = document.createElement('div');
      nameRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center;';
      nameRow.innerHTML = `
        <span style="color:${meta.colorHex}; font-size:0.85rem; font-family:'Cinzel',serif; font-weight:400;">${meta.name}</span>
        <span style="background:#1a1a2e; border:1px solid #444; border-radius:4px;
          padding:1px 6px; font-size:0.75rem; color:#ccc; font-family:'Cinzel',serif; font-weight:400;">${cost} slot${cost !== 1 ? 's' : ''}</span>
      `;
      card.appendChild(nameRow);

      const desc = document.createElement('p');
      desc.style.cssText = 'color:#888; font-size:0.72rem; margin:0; line-height:1.3; font-family:\'Cinzel\',serif; font-weight:400;';
      desc.textContent = meta.description;
      card.appendChild(desc);

      drawShapePreview(previewCanvas, kind, meta.colorHex);

      card.addEventListener('click', () => {
        const isSelected = loadout.includes(kind);
        if (isSelected) {
          loadout = loadout.filter(k2 => k2 !== kind);
        } else {
          const newCost = totalSlotCost(loadout) + cost;
          if (newCost > dustSlots) return;
          loadout = [...loadout, kind];
        }
        updateCardState(kind, card, previewCanvas, meta);
        renderMeter();
      });

      grid.appendChild(card);
      cardEls.push(card);
      updateCardState(kind, card, previewCanvas, meta);
    }

    function updateCardState(
      kind: ParticleKind,
      card: HTMLDivElement,
      previewCanvas: HTMLCanvasElement,
      meta: KindMeta,
    ): void {
      const isSelected = loadout.includes(kind);
      const cost = getSlotCost(kind);
      const wouldFit = totalSlotCost(loadout) + cost <= dustSlots;

      if (isSelected) {
        card.style.borderColor = meta.colorHex;
        card.style.background = '#111128';
        drawShapePreview(previewCanvas, kind, meta.colorHex);
      } else if (!wouldFit) {
        card.style.borderColor = '#333';
        card.style.background = '#0a0a12';
        drawShapePreview(previewCanvas, kind, '#555');
      } else {
        card.style.borderColor = '#444';
        card.style.background = '#0d0d1a';
        drawShapePreview(previewCanvas, kind, meta.colorHex);
      }
    }

    renderMeter();
  }

  // ── World Map Tab ────────────────────────────────────────────────────────
  function buildMapTab(): void {
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
    const exploredSet = new Set(progress.exploredRoomIds);
    ROOM_REGISTRY.forEach((room) => {
      if (exploredSet.has(room.id)) {
        exploredRooms.push(room);
      }
    });

    // Compute room positions for the map based on transitions
    // Use a BFS from lobby to compute relative grid positions
    interface RoomPlacement {
      room: RoomDef;
      mapXBlock: number;
      mapYBlock: number;
    }

    const placements = new Map<string, RoomPlacement>();

    // Place all explored rooms relative to each other
    if (exploredRooms.length > 0) {
      // Start with lobby at origin, or first explored room
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

    // Map view state
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

      // Draw each explored room
      placements.forEach((placement) => {
        const { room, mapXBlock, mapYBlock } = placement;
        const isCurrentRoom = room.id === currentRoomId;

        // Draw blocks (walls)
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

        // Draw doorways (transitions)
        for (const t of room.transitions) {
          const openTop = t.positionBlock;
          const openSize = t.openingSizeBlocks;

          mapCtx.fillStyle = 'rgba(100,200,255,0.5)';
          for (let d = 0; d < openSize; d++) {
            let bx = 0;
            let by = openTop + d;
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

        // Draw skill tombs
        for (const tomb of room.skillTombs) {
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

        // Draw room name label
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

    // ── Zoom (mouse wheel) ────────────────────────────────────────────────
    function onWheel(e: WheelEvent): void {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.5 : 0.5;
      mapZoom = Math.max(1, Math.min(12, mapZoom + delta));
      renderMap();
    }

    // ── Pan (mouse drag) ──────────────────────────────────────────────────
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

    // Store cleanup for listeners
    const prevCleanup = mapCleanup;
    mapCleanup = () => {
      mapCanvas.removeEventListener('wheel', onWheel);
      mapCanvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      if (prevCleanup) prevCleanup();
    };
  }

  let mapCleanup: (() => void) | null = null;

  // ── ESC key handler (close without opening pause menu) ──────────────────
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      destroy();
      callbacks.onClose(loadout.slice());
    }
  }
  window.addEventListener('keydown', onKey, true);

  // ── Mount and initial render ────────────────────────────────────────────
  root.appendChild(overlay);
  updateTabs();

  // ── Cleanup ─────────────────────────────────────────────────────────────
  function destroy(): void {
    window.removeEventListener('keydown', onKey, true);
    if (mapCleanup) mapCleanup();
    if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
  }

  return destroy;
}
