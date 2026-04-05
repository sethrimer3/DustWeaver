/**
 * Editor world map — shows a list of all rooms in the game.
 * In editor mode, pressing M opens this overlay.
 * Clicking a room jumps the editor to that room.
 *
 * When in transition-linking mode, clicking a room shows its transitions;
 * clicking a transition completes the link.
 */

import { ROOM_REGISTRY } from '../levels/rooms';
import type { RoomDef } from '../levels/roomDef';

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
  title.textContent = isLinkMode ? '🔗 Link Transition — Select Room & Door' : '🗺 Editor World Map';
  title.style.cssText = `color: ${isLinkMode ? '#4488ff' : GREEN}; font-family: 'Cinzel', serif; margin: 0 0 16px 0; font-size: 1.2rem;`;
  panel.appendChild(title);

  const hint = document.createElement('p');
  hint.textContent = isLinkMode
    ? 'Click a room to see its doors, then click a door to link.'
    : 'Click a room to jump to it. Press M or ESC to close.';
  hint.style.cssText = `color: rgba(200,255,200,0.5); font-size: 11px; margin: 0 0 12px 0;`;
  panel.appendChild(hint);

  // Group rooms by world number
  const roomsByWorld = new Map<number, RoomDef[]>();
  for (const [, room] of ROOM_REGISTRY) {
    const list = roomsByWorld.get(room.worldNumber) ?? [];
    list.push(room);
    roomsByWorld.set(room.worldNumber, list);
  }

  // Track the expanded room in link mode (shows transitions)
  let expandedRoomElement: HTMLElement | null = null;

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

      // Room container (button + optional transition list)
      const roomContainer = document.createElement('div');
      roomContainer.style.cssText = 'margin-bottom: 4px;';

      const btn = document.createElement('button');
      const transCount = room.transitions.length;
      const transLabel = isLinkMode ? ` [${transCount} door${transCount !== 1 ? 's' : ''}]` : '';
      btn.textContent = `${room.name} (${room.id})${transLabel}${isCurrent ? ' ◀' : ''}`;
      btn.style.cssText = `
        display: block; width: 100%; text-align: left;
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
        // In link mode: clicking room expands to show transitions
        btn.addEventListener('click', () => {
          // Collapse any previously expanded room
          if (expandedRoomElement && expandedRoomElement !== roomContainer) {
            const prevList = expandedRoomElement.querySelector('.transition-list');
            if (prevList) prevList.remove();
          }

          // Toggle expansion
          const existingList = roomContainer.querySelector('.transition-list');
          if (existingList) {
            existingList.remove();
            expandedRoomElement = null;
            return;
          }

          expandedRoomElement = roomContainer;

          // Build transition list
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
                transition: background 0.1s;
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
        // Normal mode: clicking room navigates
        btn.addEventListener('click', () => {
          destroy();
          callbacks.onSelectRoom(room);
        });
      }

      roomContainer.appendChild(btn);
      panel.appendChild(roomContainer);
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
