/**
 * Editor world map — shows a list of all rooms in the game.
 * In editor mode, pressing M opens this overlay.
 * Clicking a room jumps the editor to that room.
 *
 * When in transition-linking mode, clicking a room shows its transitions;
 * clicking a transition completes the link.
 *
 * Management features: rename rooms/worlds, move rooms between worlds,
 * add rooms, add worlds, and export world-map.json.
 */

import { ROOM_REGISTRY } from '../levels/rooms';
import {
  WORLD_NAMES,
  ROOM_NAME_OVERRIDES,
  ROOM_WORLD_OVERRIDES,
  setWorldName,
  setRoomNameOverride,
  setRoomWorldOverride,
  registerRoom,
  setRoomMapPosition,
} from '../levels/rooms';
import type { RoomDef } from '../levels/roomDef';
import { roomJsonDefToRoomDef } from '../levels/roomJsonLoader';
import { exportWorldMapJson } from './editorExport';

const PANEL_BG = 'rgba(10,10,15,0.95)';
const PANEL_BORDER = 'rgba(0,200,100,0.4)';
const GREEN = '#00c864';
const TEXT_COLOR = '#c0ffd0';
const LINK_BLUE = 'rgba(0,150,255,0.5)';

export interface EditorWorldMapCallbacks {
  onSelectRoom: (room: RoomDef) => void;
  /** Called when a transition is selected in link mode.  */
  onLinkTransition: (room: RoomDef, transitionIndex: number) => void;
  onClose: () => void;
  /** Called whenever world-map metadata is mutated (rename, move, add room/world). */
  onWorldMapDataChanged?: () => void;
}

/**
 * Shows the editor world map overlay. Returns a cleanup function.
 * @param isLinkMode When true, rooms expand to show transitions for linking.
 */
export function showEditorWorldMap(
  root: HTMLElement,
  currentRoomId: string,
  isLinkMode: boolean,
  callbacks: EditorWorldMapCallbacks,
): () => void {
  // ── Helpers ──────────────────────────────────────────────────────────────

  function effectiveRoomName(roomId: string): string {
    return ROOM_NAME_OVERRIDES.get(roomId) ?? (ROOM_REGISTRY.get(roomId)?.name ?? roomId);
  }

  function effectiveWorldId(roomId: string): number {
    return ROOM_WORLD_OVERRIDES.get(roomId) ?? (ROOM_REGISTRY.get(roomId)?.worldNumber ?? 0);
  }

  function worldDisplayName(worldId: number): string {
    return WORLD_NAMES.get(worldId) ?? `World ${worldId}`;
  }

  // ── Build overlay ─────────────────────────────────────────────────────────

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.7);
    display: flex; align-items: center; justify-content: center;
    z-index: 1100;
  `;

  const panel = document.createElement('div');
  panel.style.cssText = `
    background: ${PANEL_BG}; border: 1px solid ${PANEL_BORDER};
    border-radius: 8px; padding: 24px; min-width: 360px; max-width: 540px;
    max-height: 85vh; overflow-y: auto; display: flex; flex-direction: column;
  `;

  const title = document.createElement('h3');
  title.textContent = isLinkMode ? '\ud83d\udd17 Link Transition \u2014 Select Room & Door' : '\ud83d\uddfa Editor World Map';
  title.style.cssText = `color: ${isLinkMode ? '#4488ff' : GREEN}; font-family: 'Cinzel', serif; margin: 0 0 16px 0; font-size: 1.2rem;`;
  panel.appendChild(title);

  const hint = document.createElement('p');
  hint.textContent = isLinkMode
    ? 'Click a room to see its doors, then click a door to link.'
    : 'Click a room to jump to it. Right-click for options. Press M or ESC to close.';
  hint.style.cssText = `color: rgba(200,255,200,0.5); font-size: 11px; margin: 0 0 12px 0;`;
  panel.appendChild(hint);

  // ── Scrollable room list ───────────────────────────────────────────────────

  const listContainer = document.createElement('div');
  listContainer.style.cssText = 'flex: 1; overflow-y: auto;';
  panel.appendChild(listContainer);

  // Track the expanded room in link mode
  let expandedRoomElement: HTMLElement | null = null;

  function rebuildList(): void {
    listContainer.innerHTML = '';
    expandedRoomElement = null;

    // Group rooms by effective world id
    const roomsByWorld = new Map<number, RoomDef[]>();
    for (const [, room] of ROOM_REGISTRY) {
      const wId = effectiveWorldId(room.id);
      const list = roomsByWorld.get(wId) ?? [];
      list.push(room);
      roomsByWorld.set(wId, list);
    }

    const sortedWorlds = [...roomsByWorld.keys()].sort((a, b) => a - b);
    for (const worldNum of sortedWorlds) {
      // World header row
      const worldRow = document.createElement('div');
      worldRow.style.cssText = `
        display: flex; align-items: center; gap: 6px;
        margin: 12px 0 6px 0; border-bottom: 1px solid ${PANEL_BORDER}; padding-bottom: 4px;
      `;

      const worldLabelEl = document.createElement('span');
      worldLabelEl.textContent = worldDisplayName(worldNum);
      worldLabelEl.style.cssText = `color: ${GREEN}; font-size: 13px; font-family: 'Cinzel', serif; flex: 1;`;
      worldRow.appendChild(worldLabelEl);

      // Rename world button
      if (!isLinkMode) {
        const renameWorldBtn = document.createElement('button');
        renameWorldBtn.textContent = '\u270f';
        renameWorldBtn.title = 'Rename world';
        renameWorldBtn.style.cssText = `
          background: transparent; color: rgba(200,255,200,0.5);
          border: 1px solid rgba(0,200,100,0.3); border-radius: 3px;
          font-size: 10px; cursor: pointer; padding: 1px 5px;
        `;
        renameWorldBtn.addEventListener('click', () => {
          const newName = window.prompt(`Rename world "${worldDisplayName(worldNum)}":`, worldDisplayName(worldNum));
          if (newName !== null && newName.trim()) {
            setWorldName(worldNum, newName.trim());
            callbacks.onWorldMapDataChanged?.();
            rebuildList();
          }
        });
        worldRow.appendChild(renameWorldBtn);
      }

      listContainer.appendChild(worldRow);

      const rooms = roomsByWorld.get(worldNum)!;
      for (const room of rooms) {
        const isCurrent = room.id === currentRoomId;
        const roomContainer = document.createElement('div');
        roomContainer.style.cssText = 'margin-bottom: 4px;';

        // Room button row
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display: flex; align-items: center; gap: 4px;';

        const btn = document.createElement('button');
        const transCount = room.transitions.length;
        const transLabel = isLinkMode ? ` [${transCount} door${transCount !== 1 ? 's' : ''}]` : '';
        const displayName = effectiveRoomName(room.id);
        btn.textContent = `${displayName} (${room.id})${transLabel}${isCurrent ? ' \u25c4' : ''}`;
        btn.style.cssText = `
          flex: 1; text-align: left;
          background: ${isCurrent ? 'rgba(0,200,100,0.15)' : 'rgba(30,30,40,0.7)'};
          color: ${isCurrent ? GREEN : TEXT_COLOR}; border: 1px solid ${PANEL_BORDER};
          padding: 8px 10px; font-size: 12px;
          font-family: monospace; cursor: pointer; border-radius: 3px;
          transition: background 0.1s;
        `;
        btn.addEventListener('mouseenter', () => {
          btn.style.background = 'rgba(0,200,100,0.25)';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.background = isCurrent ? 'rgba(0,200,100,0.15)' : 'rgba(30,30,40,0.7)';
        });

        if (isLinkMode) {
          btn.addEventListener('click', () => {
            if (expandedRoomElement && expandedRoomElement !== roomContainer) {
              const prevList = expandedRoomElement.querySelector('.transition-list');
              if (prevList) prevList.remove();
            }
            const existingList = roomContainer.querySelector('.transition-list');
            if (existingList) {
              existingList.remove();
              expandedRoomElement = null;
              return;
            }
            expandedRoomElement = roomContainer;
            const transListDiv = document.createElement('div');
            transListDiv.className = 'transition-list';
            transListDiv.style.cssText = 'margin-left: 16px; margin-top: 2px;';

            if (room.transitions.length === 0) {
              const noTrans = document.createElement('div');
              noTrans.textContent = '(No doors in this room)';
              noTrans.style.cssText = 'color: rgba(200,200,200,0.4); font-size: 11px; padding: 4px 0;';
              transListDiv.appendChild(noTrans);
            } else {
              for (let i = 0; i < room.transitions.length; i++) {
                const trans = room.transitions[i];
                const transBtn = document.createElement('button');
                transBtn.textContent = `Door #${i + 1}: ${trans.direction} @ pos ${trans.positionBlock}, size ${trans.openingSizeBlocks}`;
                transBtn.style.cssText = `
                  display: block; width: 100%; text-align: left;
                  background: rgba(0,80,200,0.15);
                  color: #88bbff; border: 1px solid ${LINK_BLUE};
                  padding: 6px 8px; font-size: 11px; margin-bottom: 2px;
                  font-family: monospace; cursor: pointer; border-radius: 3px;
                `;
                transBtn.addEventListener('mouseenter', () => {
                  transBtn.style.background = 'rgba(0,120,255,0.3)';
                });
                transBtn.addEventListener('mouseleave', () => {
                  transBtn.style.background = 'rgba(0,80,200,0.15)';
                });
                transBtn.addEventListener('click', (e) => {
                  e.stopPropagation();
                  destroy();
                  callbacks.onLinkTransition(room, i);
                });
                transListDiv.appendChild(transBtn);
              }
            }
            roomContainer.appendChild(transListDiv);
          });
        } else {
          btn.addEventListener('click', () => {
            destroy();
            callbacks.onSelectRoom(room);
          });
        }

        btnRow.appendChild(btn);

        // Management buttons (non-link mode only)
        if (!isLinkMode) {
          const renameRoomBtn = document.createElement('button');
          renameRoomBtn.textContent = '\u270f';
          renameRoomBtn.title = 'Rename room';
          renameRoomBtn.style.cssText = `
            background: transparent; color: rgba(200,255,200,0.5);
            border: 1px solid rgba(0,200,100,0.3); border-radius: 3px;
            font-size: 10px; cursor: pointer; padding: 5px 6px; flex-shrink: 0;
          `;
          renameRoomBtn.addEventListener('click', () => {
            const newName = window.prompt(`Rename "${effectiveRoomName(room.id)}":`, effectiveRoomName(room.id));
            if (newName !== null && newName.trim()) {
              setRoomNameOverride(room.id, newName.trim());
              callbacks.onWorldMapDataChanged?.();
              rebuildList();
            }
          });
          btnRow.appendChild(renameRoomBtn);

          const moveBtn = document.createElement('button');
          moveBtn.textContent = '\u21c4 World';
          moveBtn.title = 'Move to a different world';
          moveBtn.style.cssText = `
            background: transparent; color: rgba(150,200,255,0.6);
            border: 1px solid rgba(100,150,255,0.3); border-radius: 3px;
            font-size: 10px; cursor: pointer; padding: 5px 6px; flex-shrink: 0;
            font-family: monospace; white-space: nowrap;
          `;
          moveBtn.addEventListener('click', () => showMoveToWorldInline(room.id, worldNum, roomContainer));
          btnRow.appendChild(moveBtn);
        }

        roomContainer.appendChild(btnRow);
        listContainer.appendChild(roomContainer);
      }
    }
  }

  // ── Inline "move to world" dropdown ───────────────────────────────────────

  let openMoveDropdown: HTMLElement | null = null;

  function showMoveToWorldInline(roomId: string, currentWorldId: number, anchor: HTMLElement): void {
    if (openMoveDropdown) {
      if (openMoveDropdown.parentElement) openMoveDropdown.parentElement.removeChild(openMoveDropdown);
      openMoveDropdown = null;
    }

    const worldIdSet = new Set<number>();
    for (const [id] of WORLD_NAMES) worldIdSet.add(id);
    for (const [, room] of ROOM_REGISTRY) {
      worldIdSet.add(ROOM_WORLD_OVERRIDES.get(room.id) ?? room.worldNumber);
    }
    const sorted = [...worldIdSet].sort((a, b) => a - b);

    const dropDiv = document.createElement('div');
    dropDiv.style.cssText = `
      margin-top: 4px; padding: 6px; background: rgba(15,15,25,0.97);
      border: 1px solid rgba(0,200,100,0.3); border-radius: 4px; display: flex; gap: 6px;
      flex-wrap: wrap;
    `;

    for (const wId of sorted) {
      const wBtn = document.createElement('button');
      wBtn.textContent = worldDisplayName(wId);
      const isActive = wId === currentWorldId;
      wBtn.style.cssText = `
        background: ${isActive ? 'rgba(0,200,100,0.2)' : 'rgba(30,30,40,0.8)'};
        color: ${isActive ? GREEN : TEXT_COLOR};
        border: 1px solid rgba(0,200,100,0.3); border-radius: 3px;
        font-family: monospace; font-size: 11px; cursor: pointer; padding: 3px 8px;
      `;
      wBtn.addEventListener('click', () => {
        setRoomWorldOverride(roomId, wId);
        callbacks.onWorldMapDataChanged?.();
        if (dropDiv.parentElement) dropDiv.parentElement.removeChild(dropDiv);
        openMoveDropdown = null;
        rebuildList();
      });
      dropDiv.appendChild(wBtn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '\u2715';
    cancelBtn.style.cssText = `
      background: transparent; color: rgba(255,100,100,0.6);
      border: 1px solid rgba(255,100,100,0.3); border-radius: 3px;
      font-family: monospace; font-size: 11px; cursor: pointer; padding: 3px 6px; margin-left: auto;
    `;
    cancelBtn.addEventListener('click', () => {
      if (dropDiv.parentElement) dropDiv.parentElement.removeChild(dropDiv);
      openMoveDropdown = null;
    });
    dropDiv.appendChild(cancelBtn);

    anchor.appendChild(dropDiv);
    openMoveDropdown = dropDiv;
  }

  rebuildList();

  // ── Footer buttons ────────────────────────────────────────────────────────

  if (!isLinkMode) {
    const footerSep = document.createElement('div');
    footerSep.style.cssText = `height: 1px; background: rgba(0,200,100,0.2); margin: 12px 0 10px;`;
    panel.appendChild(footerSep);

    const footerRow = document.createElement('div');
    footerRow.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap;';

    function makeFooterBtn(label: string, color: string): HTMLButtonElement {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = `
        background: rgba(0,0,0,0.3); color: ${color};
        border: 1px solid ${color}; border-radius: 3px;
        font-family: monospace; font-size: 11px; cursor: pointer;
        padding: 5px 10px; flex: 1; white-space: nowrap;
      `;
      return btn;
    }

    const addRoomBtn = makeFooterBtn('+ Add Room', '#44cc88');
    addRoomBtn.addEventListener('click', () => showAddRoomModal());
    footerRow.appendChild(addRoomBtn);

    const addWorldBtn = makeFooterBtn('+ Add World', '#6688cc');
    addWorldBtn.addEventListener('click', () => showAddWorldModal());
    footerRow.appendChild(addWorldBtn);

    const exportBtn = makeFooterBtn('\u2b07 Export World Map', '#cccc44');
    exportBtn.title = 'Download world-map.json — place in ASSETS/ROOMS/ to persist changes';
    exportBtn.addEventListener('click', () => {
      exportWorldMapJson();
    });
    footerRow.appendChild(exportBtn);

    panel.appendChild(footerRow);
  }

  // ── Close button ──────────────────────────────────────────────────────────

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u2715 Close';
  closeBtn.style.cssText = `
    display: block; width: 100%; margin-top: 12px; padding: 10px;
    background: rgba(100,0,0,0.3); color: #ff8888; border: 1px solid rgba(255,100,100,0.3);
    font-family: monospace; font-size: 12px; cursor: pointer; border-radius: 3px;
  `;
  closeBtn.addEventListener('click', () => {
    destroy();
    callbacks.onClose();
  });
  panel.appendChild(closeBtn);

  overlay.appendChild(panel);
  root.appendChild(overlay);

  // ── Add Room modal ────────────────────────────────────────────────────────

  function showAddRoomModal(): void {
    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.7); z-index: 1200;
      display: flex; align-items: center; justify-content: center;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: ${PANEL_BG}; border: 1px solid ${PANEL_BORDER};
      border-radius: 6px; padding: 20px; min-width: 280px; max-width: 380px;
    `;

    const title2 = document.createElement('h3');
    title2.textContent = '+ Add New Room';
    title2.style.cssText = `color: ${GREEN}; margin: 0 0 16px; font-family: 'Cinzel', serif; font-size: 13px;`;
    modal.appendChild(title2);

    function makeField2(labelText: string, input: HTMLInputElement | HTMLSelectElement): void {
      const row = document.createElement('div');
      row.style.cssText = 'margin-bottom: 10px;';
      const lbl = document.createElement('label');
      lbl.textContent = labelText;
      lbl.style.cssText = 'display: block; color: rgba(200,255,200,0.6); font-size: 11px; margin-bottom: 3px; font-family: monospace;';
      input.style.cssText = (input.style.cssText || '') + `
        width: 100%; box-sizing: border-box; padding: 5px 8px;
        background: rgba(20,20,30,0.9); color: ${TEXT_COLOR};
        border: 1px solid rgba(0,200,100,0.4); border-radius: 3px;
        font-family: monospace; font-size: 12px;
      `;
      row.appendChild(lbl);
      row.appendChild(input);
      modal.appendChild(row);
    }

    const idInput = document.createElement('input');
    idInput.type = 'text'; idInput.placeholder = 'e.g. my_room';
    makeField2('Room ID (unique)', idInput);

    const nameInput = document.createElement('input');
    nameInput.type = 'text'; nameInput.placeholder = 'e.g. My Room';
    makeField2('Room Name', nameInput);

    const worldSel = document.createElement('select');
    const worldIdSet = new Set<number>();
    for (const [id] of WORLD_NAMES) worldIdSet.add(id);
    for (const [, room] of ROOM_REGISTRY) {
      worldIdSet.add(ROOM_WORLD_OVERRIDES.get(room.id) ?? room.worldNumber);
    }
    for (const id of [...worldIdSet].sort((a, b) => a - b)) {
      const opt = document.createElement('option');
      opt.value = String(id);
      opt.textContent = `${worldDisplayName(id)} (id: ${id})`;
      worldSel.appendChild(opt);
    }
    makeField2('World', worldSel);

    const wInput = document.createElement('input');
    wInput.type = 'number'; wInput.value = '40'; wInput.min = '10';
    makeField2('Width (blocks)', wInput);

    const hInput = document.createElement('input');
    hInput.type = 'number'; hInput.value = '30'; hInput.min = '10';
    makeField2('Height (blocks)', hInput);

    const errEl = document.createElement('div');
    errEl.style.cssText = 'color: #ff8888; font-size: 11px; min-height: 16px; font-family: monospace; margin-bottom: 8px;';
    modal.appendChild(errEl);

    const btnRow2 = document.createElement('div');
    btnRow2.style.cssText = 'display: flex; gap: 8px;';

    const createBtn2 = document.createElement('button');
    createBtn2.textContent = 'Create Room';
    createBtn2.style.cssText = `
      flex: 1; padding: 8px; background: rgba(0,100,60,0.4); color: #44cc88;
      border: 1px solid #44cc88; border-radius: 3px; font-family: monospace;
      font-size: 11px; cursor: pointer;
    `;
    createBtn2.addEventListener('click', () => {
      const id = idInput.value.trim().replace(/\s+/g, '_').replace(/_+/g, '_');
      const name = nameInput.value.trim() || id;
      const worldId = parseInt(worldSel.value, 10);
      const w = Math.max(10, parseInt(wInput.value, 10) || 40);
      const h = Math.max(10, parseInt(hInput.value, 10) || 30);

      if (!id) { errEl.textContent = 'Room ID is required.'; return; }
      if (ROOM_REGISTRY.has(id)) { errEl.textContent = `Room ID "${id}" already exists.`; return; }

      // Creates a blank room (perimeter walls only, no interior content).
      // Double-click it in the visual map or select it from this list to
      // open it in the room editor and design its gameplay content.
      const roomDef = roomJsonDefToRoomDef({
        id, name, worldNumber: worldId,
        widthBlocks: w, heightBlocks: h,
        playerSpawnBlock: [Math.floor(w / 2), Math.floor(h / 2)],
        interiorWalls: [], enemies: [], transitions: [], skillTombs: [],
      });

      registerRoom(roomDef);
      setRoomNameOverride(id, name);
      setRoomWorldOverride(id, worldId);
      setRoomMapPosition(id, 0, 0);
      callbacks.onWorldMapDataChanged?.();

      if (backdrop.parentElement) backdrop.parentElement.removeChild(backdrop);
      rebuildList();
    });

    const cancelBtn2 = document.createElement('button');
    cancelBtn2.textContent = 'Cancel';
    cancelBtn2.style.cssText = `
      flex: 1; padding: 8px; background: rgba(0,0,0,0.3); color: #888;
      border: 1px solid #888; border-radius: 3px; font-family: monospace;
      font-size: 11px; cursor: pointer;
    `;
    cancelBtn2.addEventListener('click', () => {
      if (backdrop.parentElement) backdrop.parentElement.removeChild(backdrop);
    });

    btnRow2.appendChild(createBtn2);
    btnRow2.appendChild(cancelBtn2);
    modal.appendChild(btnRow2);
    backdrop.appendChild(modal);
    root.appendChild(backdrop);
    idInput.focus();
  }

  // ── Add World modal ────────────────────────────────────────────────────────

  function showAddWorldModal(): void {
    let maxId = 0;
    for (const [id] of WORLD_NAMES) maxId = Math.max(maxId, id);
    for (const [, room] of ROOM_REGISTRY) {
      maxId = Math.max(maxId, ROOM_WORLD_OVERRIDES.get(room.id) ?? room.worldNumber);
    }
    const nextId = maxId + 1;

    const backdrop = document.createElement('div');
    backdrop.style.cssText = `
      position: absolute; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.7); z-index: 1200;
      display: flex; align-items: center; justify-content: center;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: ${PANEL_BG}; border: 1px solid ${PANEL_BORDER};
      border-radius: 6px; padding: 20px; min-width: 260px;
    `;

    const title3 = document.createElement('h3');
    title3.textContent = '+ Add New World';
    title3.style.cssText = `color: ${GREEN}; margin: 0 0 12px; font-family: 'Cinzel', serif; font-size: 13px;`;
    modal.appendChild(title3);

    const lbl = document.createElement('label');
    lbl.textContent = `World Name (id will be: ${nextId})`;
    lbl.style.cssText = 'display: block; color: rgba(200,255,200,0.6); font-size: 11px; margin-bottom: 4px; font-family: monospace;';
    modal.appendChild(lbl);

    const nameInput2 = document.createElement('input');
    nameInput2.type = 'text';
    nameInput2.placeholder = `World ${nextId}`;
    nameInput2.style.cssText = `
      width: 100%; box-sizing: border-box; padding: 5px 8px;
      background: rgba(20,20,30,0.9); color: ${TEXT_COLOR};
      border: 1px solid rgba(0,200,100,0.4); border-radius: 3px;
      font-family: monospace; font-size: 12px; margin-bottom: 12px;
    `;
    modal.appendChild(nameInput2);

    const btnRow3 = document.createElement('div');
    btnRow3.style.cssText = 'display: flex; gap: 8px;';

    const createBtn3 = document.createElement('button');
    createBtn3.textContent = 'Create World';
    createBtn3.style.cssText = `
      flex: 1; padding: 8px; background: rgba(40,40,100,0.4); color: #6688cc;
      border: 1px solid #6688cc; border-radius: 3px; font-family: monospace;
      font-size: 11px; cursor: pointer;
    `;
    createBtn3.addEventListener('click', () => {
      const name = nameInput2.value.trim() || `World ${nextId}`;
      setWorldName(nextId, name);
      callbacks.onWorldMapDataChanged?.();
      if (backdrop.parentElement) backdrop.parentElement.removeChild(backdrop);
      rebuildList();
    });

    const cancelBtn3 = document.createElement('button');
    cancelBtn3.textContent = 'Cancel';
    cancelBtn3.style.cssText = `
      flex: 1; padding: 8px; background: rgba(0,0,0,0.3); color: #888;
      border: 1px solid #888; border-radius: 3px; font-family: monospace;
      font-size: 11px; cursor: pointer;
    `;
    cancelBtn3.addEventListener('click', () => {
      if (backdrop.parentElement) backdrop.parentElement.removeChild(backdrop);
    });

    btnRow3.appendChild(createBtn3);
    btnRow3.appendChild(cancelBtn3);
    modal.appendChild(btnRow3);
    backdrop.appendChild(modal);
    root.appendChild(backdrop);
    nameInput2.focus();
  }

  // ── ESC / M to close ──────────────────────────────────────────────────────

  function isTypingIntoField(e: KeyboardEvent): boolean {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return false;
    const tagName = target.tagName;
    return target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
  }

  function onKey(e: KeyboardEvent): void {
    if (isTypingIntoField(e)) return;
    if (e.key === 'Escape' || e.key.toLowerCase() === 'm') {
      e.preventDefault();
      e.stopImmediatePropagation();
      destroy();
      callbacks.onClose();
    }
  }
  window.addEventListener('keydown', onKey);

  function destroy(): void {
    window.removeEventListener('keydown', onKey);
    if (overlay.parentElement) overlay.parentElement.removeChild(overlay);
  }

  return destroy;
}
