/**
 * Editor world map — shows a list of all rooms in the game.
 * In editor mode, pressing M opens this overlay.
 * Clicking a room jumps the editor to that room.
 */

import { ROOM_REGISTRY } from '../levels/rooms';
import type { RoomDef } from '../levels/roomDef';

const PANEL_BG = 'rgba(10,10,15,0.95)';
const PANEL_BORDER = 'rgba(0,200,100,0.4)';
const GREEN = '#00c864';
const TEXT_COLOR = '#c0ffd0';

export interface EditorWorldMapCallbacks {
  onSelectRoom: (room: RoomDef) => void;
  onClose: () => void;
}

/**
 * Shows the editor world map overlay. Returns a cleanup function.
 */
export function showEditorWorldMap(
  root: HTMLElement,
  currentRoomId: string,
  callbacks: EditorWorldMapCallbacks,
): () => void {
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
    border-radius: 8px; padding: 24px; min-width: 320px; max-width: 500px;
    max-height: 80vh; overflow-y: auto;
  `;

  const title = document.createElement('h3');
  title.textContent = '🗺 Editor World Map';
  title.style.cssText = `color: ${GREEN}; font-family: 'Cinzel', serif; margin: 0 0 16px 0; font-size: 1.2rem;`;
  panel.appendChild(title);

  const hint = document.createElement('p');
  hint.textContent = 'Click a room to jump to it. Press M or ESC to close.';
  hint.style.cssText = `color: rgba(200,255,200,0.5); font-size: 11px; margin: 0 0 12px 0;`;
  panel.appendChild(hint);

  // Group rooms by world number
  const roomsByWorld = new Map<number, RoomDef[]>();
  for (const [, room] of ROOM_REGISTRY) {
    const list = roomsByWorld.get(room.worldNumber) ?? [];
    list.push(room);
    roomsByWorld.set(room.worldNumber, list);
  }

  const sortedWorlds = [...roomsByWorld.keys()].sort((a, b) => a - b);
  for (const worldNum of sortedWorlds) {
    const worldLabel = document.createElement('div');
    worldLabel.textContent = `World ${worldNum}`;
    worldLabel.style.cssText = `
      color: ${GREEN}; font-size: 13px; margin: 12px 0 6px 0;
      font-family: 'Cinzel', serif; border-bottom: 1px solid ${PANEL_BORDER};
      padding-bottom: 4px;
    `;
    panel.appendChild(worldLabel);

    const rooms = roomsByWorld.get(worldNum)!;
    for (const room of rooms) {
      const isCurrent = room.id === currentRoomId;
      const btn = document.createElement('button');
      btn.textContent = `${room.name} (${room.id})${isCurrent ? ' ◀' : ''}`;
      btn.style.cssText = `
        display: block; width: 100%; text-align: left;
        background: ${isCurrent ? 'rgba(0,200,100,0.15)' : 'rgba(30,30,40,0.7)'};
        color: ${isCurrent ? GREEN : TEXT_COLOR}; border: 1px solid ${PANEL_BORDER};
        padding: 8px 10px; margin-bottom: 4px; font-size: 12px;
        font-family: monospace; cursor: pointer; border-radius: 3px;
        transition: background 0.1s;
      `;
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(0,200,100,0.25)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = isCurrent ? 'rgba(0,200,100,0.15)' : 'rgba(30,30,40,0.7)';
      });
      btn.addEventListener('click', () => {
        destroy();
        callbacks.onSelectRoom(room);
      });
      panel.appendChild(btn);
    }
  }

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Close';
  closeBtn.style.cssText = `
    display: block; width: 100%; margin-top: 16px; padding: 10px;
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

  // ESC / M to close
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key.toLowerCase() === 'm') {
      e.preventDefault();
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
