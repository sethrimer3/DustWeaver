/**
 * Dialog builders for the visual world map editor.
 *
 * Extracted from editorVisualMap.ts to keep that file focused on canvas
 * rendering and interaction.  Each dialog function receives a
 * VisualMapDialogContext bundling the shared mutable closure state it needs.
 */

import {
  ROOM_REGISTRY,
  WORLD_NAMES,
  ROOM_WORLD_OVERRIDES,
  registerRoom,
  setRoomNameOverride,
  setRoomWorldOverride,
  setRoomMapPosition,
  setWorldName,
} from '../levels/rooms';
import { roomJsonDefToRoomDef } from '../levels/roomJsonLoader';
import type { MapRoomPlacement, VisualMapCallbacks } from './editorVisualMapHelpers';
import { effectiveRoomName, worldDisplayName } from './editorVisualMapHelpers';

// ── Shared constants ──────────────────────────────────────────────────────────

const GREEN = '#00c864';

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

// ── Button helper ─────────────────────────────────────────────────────────────

export function makeHeaderBtn(label: string, color: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = `
    background: rgba(0,0,0,0.4); color: ${color}; border: 1px solid ${color};
    font-family: monospace; font-size: 11px; cursor: pointer; border-radius: 3px;
    padding: 3px 8px; white-space: nowrap;
  `;
  return btn;
}

// ── Modal helper ──────────────────────────────────────────────────────────────

export function createModal(overlay: HTMLElement): { panel: HTMLElement; destroy: () => void } {
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

// ── Dialog context ────────────────────────────────────────────────────────────

/**
 * Shared state passed to all dialog functions.  Getter functions for
 * view-state fields (panX, panY, zoom) ensure dialogs read the current
 * values at button-click time rather than capturing snapshot values at
 * dialog-open time.
 */
export interface VisualMapDialogContext {
  readonly overlay: HTMLElement;
  readonly statusBar: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly placements: Map<string, MapRoomPlacement>;
  readonly roomColorOverrides: Map<string, string>;
  readonly callbacks: VisualMapCallbacks;
  /** Returns the current horizontal pan offset. */
  readonly getPanX: () => number;
  /** Returns the current vertical pan offset. */
  readonly getPanY: () => number;
  /** Returns the current zoom scale. */
  readonly getZoom: () => number;
  readonly render: () => void;
  readonly setSelectedRoomId: (id: string) => void;
}

// ── Dialogs ───────────────────────────────────────────────────────────────────

export function showMoveToWorldDialog(
  ctx: VisualMapDialogContext,
  roomId: string,
  currentWorldId: number,
): void {
  const worldIdSet = new Set<number>();
  for (const [id] of WORLD_NAMES) worldIdSet.add(id);
  for (const [, room] of ROOM_REGISTRY) {
    worldIdSet.add(ROOM_WORLD_OVERRIDES.get(room.id) ?? room.worldNumber);
  }
  const sorted = [...worldIdSet].sort((a, b) => a - b);

  const modal = createModal(ctx.overlay);

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
    ctx.callbacks.onWorldMapDataChanged?.();
    ctx.statusBar.textContent = `Moved "${effectiveRoomName(roomId)}" to ${worldDisplayName(newWorldId)}`;
    ctx.statusBar.style.color = '#88ff88';
    modal.destroy();
    ctx.render();
  });

  const cancelBtn = makeHeaderBtn('Cancel', '#888888');
  cancelBtn.style.cssText += ' flex: 1;';
  cancelBtn.addEventListener('click', () => modal.destroy());

  btnRow.appendChild(okBtn);
  btnRow.appendChild(cancelBtn);
  modal.panel.appendChild(btnRow);
}

export function showAddRoomDialog(ctx: VisualMapDialogContext): void {
  const modal = createModal(ctx.overlay);

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
    ctx.callbacks.onWorldMapDataChanged?.();

    const panXPx = ctx.getPanX();
    const panYPx = ctx.getPanY();
    const zoom = ctx.getZoom();
    const canvasWCss = ctx.canvas.width / window.devicePixelRatio;
    const canvasHCss = ctx.canvas.height / window.devicePixelRatio;
    const centerWorldX = (canvasWCss / 2 - panXPx) / zoom;
    const centerWorldY = (canvasHCss / 2 - panYPx) / zoom;
    const mapX = centerWorldX + 10;
    const mapY = centerWorldY + 10;
    ctx.placements.set(id, { room: roomDef, mapXWorld: mapX, mapYWorld: mapY });
    setRoomMapPosition(id, mapX, mapY);

    ctx.setSelectedRoomId(id);
    modal.destroy();
    ctx.render();
    ctx.statusBar.textContent = `Room "${name}" created \u2014 double-click to edit it, export room JSON to save gameplay content.`;
    ctx.statusBar.style.color = '#88ff88';
  });

  const cancelBtn = makeHeaderBtn('Cancel', '#888888');
  cancelBtn.style.cssText += ' flex: 1;';
  cancelBtn.addEventListener('click', () => modal.destroy());

  btnRow.appendChild(createBtn);
  btnRow.appendChild(cancelBtn);
  modal.panel.appendChild(btnRow);

  idInput.focus();
}

export function showAddWorldDialog(ctx: VisualMapDialogContext): void {
  const modal = createModal(ctx.overlay);

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
    ctx.callbacks.onWorldMapDataChanged?.();
    modal.destroy();
    ctx.statusBar.textContent = `World "${name}" (id: ${nextId}) created \u2014 right-click rooms to move them into it.`;
    ctx.statusBar.style.color = '#88ff88';
    ctx.render();
  });

  const cancelBtn = makeHeaderBtn('Cancel', '#888888');
  cancelBtn.style.cssText += ' flex: 1;';
  cancelBtn.addEventListener('click', () => modal.destroy());

  btnRow.appendChild(createBtn);
  btnRow.appendChild(cancelBtn);
  modal.panel.appendChild(btnRow);

  nameInput.focus();
}

export function showColorPickerDialog(
  ctx: VisualMapDialogContext,
  roomId: string,
): void {
  const modal = createModal(ctx.overlay);
  const roomName = effectiveRoomName(roomId);
  const currentColor = ctx.roomColorOverrides.get(roomId) ?? '';

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
      ctx.roomColorOverrides.set(roomId, selectedHex);
      ctx.statusBar.textContent = `Color set for "${roomName}": ${selectedHex}`;
      ctx.statusBar.style.color = selectedHex;
    } else {
      ctx.roomColorOverrides.delete(roomId);
      ctx.statusBar.textContent = `Color reset for "${roomName}"`;
      ctx.statusBar.style.color = 'rgba(200,255,200,0.6)';
    }
    modal.destroy();
    ctx.render();
  });

  const clearBtn = makeHeaderBtn('Reset', '#888888');
  clearBtn.style.cssText += ' flex: 1;';
  clearBtn.addEventListener('click', () => {
    ctx.roomColorOverrides.delete(roomId);
    ctx.statusBar.textContent = `Color reset for "${roomName}"`;
    ctx.statusBar.style.color = 'rgba(200,255,200,0.6)';
    modal.destroy();
    ctx.render();
  });

  const cancelBtn = makeHeaderBtn('Cancel', '#555555');
  cancelBtn.style.cssText += ' flex: 1;';
  cancelBtn.addEventListener('click', () => modal.destroy());

  btnRow.appendChild(applyBtn);
  btnRow.appendChild(clearBtn);
  btnRow.appendChild(cancelBtn);
  modal.panel.appendChild(btnRow);
}
