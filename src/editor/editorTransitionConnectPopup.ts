/**
 * editorTransitionConnectPopup.ts — "Create connected room" popup and dialog.
 *
 * After a room transition is placed on a valid room edge, the editor shows a
 * short-lived popup prompting the user to create a connected room directly
 * from that transition.  If the user accepts, a standard room-creation form
 * is shown.  On confirmation the new room is:
 *   • Registered in ROOM_REGISTRY
 *   • Placed adjacent to the current room on the visual map
 *   • Given a reciprocal transition pointing back to the source room
 *   • The source transition is updated to point at the new room
 */

import type { RoomDef, TransitionDirection } from '../levels/roomDef';
import type { RoomJsonTransition } from './roomJsonSchema';
import type { EditorTransition, EditorRoomData } from './editorState';
import {
  ROOM_REGISTRY,
  WORLD_NAMES,
  ROOM_WORLD_OVERRIDES,
  registerRoom,
  setRoomNameOverride,
  setRoomWorldOverride,
  setRoomMapPosition,
  WORLD_MAP_POSITIONS,
} from '../levels/rooms';
import { roomJsonDefToRoomDef } from '../levels/roomJsonLoader';
import { effectiveRoomName, worldDisplayName, getOppositeDirection, getAdjacentRoomMapPosition } from './editorVisualMapHelpers';
import { computeSpawnBlockForMapLink } from './editorVisualMapLinkPrompt';
import { makeHeaderBtn, createModal } from './editorVisualMapDialogs';

// ── Constants ─────────────────────────────────────────────────────────────────

/** How long the "Create connected room?" popup stays visible before dismissing. */
const POPUP_AUTO_DISMISS_MS = 6000;

// ── Edge detection ────────────────────────────────────────────────────────────

/**
 * Returns true when the given transition is positioned against a valid room
 * boundary wall (i.e. it is flush with the corresponding room edge).
 *
 * Matches the same logic used in editorRoomBuilder.ts to decide which
 * transitions create a gap in the boundary wall.
 */
export function isTransitionAtRoomEdge(t: EditorTransition, room: EditorRoomData): boolean {
  const gw = t.gradientWidthBlocks ?? 0;
  switch (t.direction) {
    case 'left':  return t.xBlock === 0;
    case 'right': return t.xBlock + gw >= room.widthBlocks;
    case 'up':    return t.yBlock === 0;
    case 'down':  return t.yBlock + gw >= room.heightBlocks;
  }
}

// ── Reciprocal transition placement ──────────────────────────────────────────

/**
 * Computes where the reciprocal transition should be placed in the new room
 * so that it faces the source transition from the opposite wall, as closely
 * matching the along-wall position as possible.
 */
function computeReciprocalTransitionPlacement(
  sourceTrans: EditorTransition,
  newRoomWidthBlocks: number,
  newRoomHeightBlocks: number,
): { direction: TransitionDirection; xBlock: number; yBlock: number; openingSizeBlocks: number } {
  const dir = getOppositeDirection(sourceTrans.direction);
  // The reciprocal transition mirrors the source gradient width so that both
  // sides of the doorway look visually identical.
  const reciprocalGw = sourceTrans.gradientWidthBlocks ?? 0;
  const isNewHoriz = dir === 'left' || dir === 'right';

  const openingSize = Math.min(
    sourceTrans.openingSizeBlocks,
    isNewHoriz ? Math.max(1, newRoomHeightBlocks - 2) : Math.max(1, newRoomWidthBlocks - 2),
  );

  let xBlock: number;
  let yBlock: number;

  switch (dir) {
    case 'left':
      xBlock = 0;
      yBlock = Math.max(1, Math.min(sourceTrans.yBlock, newRoomHeightBlocks - openingSize - 1));
      break;
    case 'right':
      xBlock = newRoomWidthBlocks - reciprocalGw;  // gw=0 → widthBlocks; gw>0 → widthBlocks-gw
      yBlock = Math.max(1, Math.min(sourceTrans.yBlock, newRoomHeightBlocks - openingSize - 1));
      break;
    case 'up':
      xBlock = Math.max(1, Math.min(sourceTrans.xBlock, newRoomWidthBlocks - openingSize - 1));
      yBlock = 0;
      break;
    case 'down':
      xBlock = Math.max(1, Math.min(sourceTrans.xBlock, newRoomWidthBlocks - openingSize - 1));
      yBlock = newRoomHeightBlocks - reciprocalGw;  // gw=0 → heightBlocks; gw>0 → heightBlocks-gw
      break;
  }

  return { direction: dir, xBlock, yBlock, openingSizeBlocks: openingSize };
}

// ── Timed popup ───────────────────────────────────────────────────────────────

/**
 * Shows a short-lived "Create connected room?" popup over `uiRoot`.
 * Calls `onConfirm` if the user clicks Yes, or disappears automatically after
 * POPUP_AUTO_DISMISS_MS milliseconds.
 *
 * Returns a cleanup function that hides the popup immediately.
 */
export function showTransitionConnectPopup(
  uiRoot: HTMLElement,
  sourceTransition: EditorTransition,
  onConfirm: () => void,
): () => void {
  const promptEl = document.createElement('div');
  promptEl.style.cssText = `
    position: absolute; bottom: 64px; left: 50%; z-index: 2000;
    transform: translateX(-50%) translateY(12px);
    width: 260px; overflow: hidden; border-radius: 5px;
    background: rgba(8,12,22,0.97); border: 1px solid rgba(80,200,255,0.7);
    box-shadow: 0 8px 24px rgba(0,0,0,0.6);
    color: #c8eeff; font-family: monospace; cursor: pointer;
    opacity: 0; transition: opacity 180ms ease, transform 180ms ease;
    pointer-events: auto;
  `;

  const contentEl = document.createElement('div');
  contentEl.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px 9px;';

  const labelEl = document.createElement('div');
  labelEl.textContent = `Create connected room? (${sourceTransition.direction})`;
  labelEl.style.cssText = 'font-size:12px; font-weight:bold; flex:1;';
  contentEl.appendChild(labelEl);

  const yesBtn = document.createElement('button');
  yesBtn.type = 'button';
  yesBtn.textContent = 'Yes';
  yesBtn.style.cssText = `
    padding: 4px 10px; border-radius: 3px; border: 1px solid rgba(80,200,255,0.8);
    background: rgba(20,80,120,0.8); color: #c8eeff; font-family: monospace;
    font-size: 12px; cursor: pointer; white-space: nowrap;
  `;
  contentEl.appendChild(yesBtn);
  promptEl.appendChild(contentEl);

  const timerBar = document.createElement('div');
  timerBar.style.cssText = `
    height: 3px; width: 100%; background: #55bbff;
    transition: width ${POPUP_AUTO_DISMISS_MS}ms linear;
  `;
  promptEl.appendChild(timerBar);
  uiRoot.appendChild(promptEl);

  let dismissed = false;
  let timeoutId = 0;
  let removeId = 0;

  const dismiss = (animate: boolean): void => {
    if (dismissed) return;
    dismissed = true;
    window.clearTimeout(timeoutId);
    window.clearTimeout(removeId);
    if (animate) {
      promptEl.style.opacity = '0';
      promptEl.style.transform = 'translateX(-50%) translateY(12px)';
      removeId = window.setTimeout(() => {
        if (promptEl.parentElement) promptEl.parentElement.removeChild(promptEl);
      }, 220);
    } else {
      if (promptEl.parentElement) promptEl.parentElement.removeChild(promptEl);
    }
  };

  const handleYes = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    dismiss(false);
    onConfirm();
  };

  yesBtn.addEventListener('click', handleYes);
  promptEl.addEventListener('click', handleYes);

  // Auto-dismiss after timeout
  timeoutId = window.setTimeout(() => dismiss(true), POPUP_AUTO_DISMISS_MS);

  // Fade in on next frame
  requestAnimationFrame(() => {
    promptEl.style.opacity = '1';
    promptEl.style.transform = 'translateX(-50%) translateY(0)';
    timerBar.style.width = '0%';
  });

  return () => dismiss(false);
}

// ── Connected room creation dialog ────────────────────────────────────────────

/** Callbacks provided by the editor controller to handle post-creation wiring. */
export interface ConnectedRoomCreationCallbacks {
  /**
   * Called after the new room is registered and the source transition has been
   * updated.  The controller should save the new room to pendingRoomEdits and
   * trigger applyEdits().
   */
  onRoomCreated: (newRoomDef: RoomDef) => void;
  /** Called when world-map metadata changes (the controller marks map as dirty). */
  onWorldMapDataChanged: () => void;
}

/**
 * Shows a room-creation form dialog attached to `uiRoot`.
 *
 * On confirmation:
 *   1. Registers the new room.
 *   2. Places it adjacent to the source room on the visual map.
 *   3. Creates a reciprocal transition in the new room that links back to
 *      the source room.
 *   4. Updates `sourceTrans.targetRoomId` and `sourceTrans.targetSpawnBlock`
 *      to point at the new room's reciprocal transition.
 *   5. Calls `callbacks.onRoomCreated` so the editor controller can persist
 *      and rebuild the game state.
 */
export function showConnectedRoomCreationDialog(
  uiRoot: HTMLElement,
  sourceTrans: EditorTransition,
  sourceRoom: EditorRoomData,
  callbacks: ConnectedRoomCreationCallbacks,
): void {
  const modal = createModal(uiRoot);

  const GREEN = '#44bbff';
  const title = document.createElement('h3');
  title.textContent = '+ Create Connected Room';
  title.style.cssText = `color: ${GREEN}; margin: 0 0 6px; font-family: 'Cinzel', serif; font-size: 13px;`;
  modal.panel.appendChild(title);

  const subtitleEl = document.createElement('div');
  subtitleEl.textContent = `Will be placed ${sourceTrans.direction} of "${effectiveRoomName(sourceRoom.id)}" with a reciprocal transition.`;
  subtitleEl.style.cssText = 'color: rgba(180,230,255,0.7); font-size:11px; font-family:monospace; margin-bottom:14px;';
  modal.panel.appendChild(subtitleEl);

  function makeField(labelText: string, input: HTMLInputElement | HTMLSelectElement): void {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom: 10px;';
    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    lbl.style.cssText = 'display: block; color: rgba(180,230,255,0.6); font-size: 11px; margin-bottom: 3px; font-family: monospace;';
    input.style.cssText = (input.style.cssText || '') + `
      width: 100%; box-sizing: border-box; padding: 5px 8px;
      background: rgba(10,15,30,0.9); color: #c0e8ff;
      border: 1px solid rgba(60,160,220,0.45); border-radius: 3px;
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
  for (const wid of sortedWorlds) {
    const opt = document.createElement('option');
    opt.value = String(wid);
    opt.textContent = `${worldDisplayName(wid)} (id: ${wid})`;
    // Default to the source room's world
    const sourceWorldId = ROOM_WORLD_OVERRIDES.get(sourceRoom.id) ?? sourceRoom.worldNumber;
    if (wid === sourceWorldId) opt.selected = true;
    worldSel.appendChild(opt);
  }
  makeField('World', worldSel);

  const wInput = document.createElement('input');
  wInput.type = 'number';
  wInput.value = String(sourceRoom.widthBlocks);
  wInput.min = '10';
  makeField('Width (blocks)', wInput);

  const hInput = document.createElement('input');
  hInput.type = 'number';
  hInput.value = String(sourceRoom.heightBlocks);
  hInput.min = '10';
  makeField('Height (blocks)', hInput);

  const errEl = document.createElement('div');
  errEl.style.cssText = 'color: #ff8888; font-size: 11px; min-height: 16px; font-family: monospace; margin-bottom: 8px;';
  modal.panel.appendChild(errEl);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display: flex; gap: 8px;';

  const createBtn = makeHeaderBtn('Create Room', GREEN);
  createBtn.style.cssText += ' flex: 1;';
  createBtn.addEventListener('click', () => {
    const id = idInput.value.trim().replace(/\s+/g, '_').replace(/_+/g, '_');
    const name = nameInput.value.trim() || id;
    const worldId = parseInt(worldSel.value, 10);
    const w = Math.max(10, parseInt(wInput.value, 10) || 40);
    const h = Math.max(10, parseInt(hInput.value, 10) || 30);

    if (!id) { errEl.textContent = 'Room ID is required.'; return; }
    if (ROOM_REGISTRY.has(id)) { errEl.textContent = `Room ID "${id}" already exists.`; return; }

    // ── Build reciprocal transition ────────────────────────────────────────
    const recipPlacement = computeReciprocalTransitionPlacement(sourceTrans, w, h);
    const recipLegacyPos = (recipPlacement.direction === 'left' || recipPlacement.direction === 'right')
      ? recipPlacement.yBlock
      : recipPlacement.xBlock;

    const recipJsonTrans: RoomJsonTransition = {
      direction: recipPlacement.direction,
      positionBlock: recipLegacyPos,
      openingSizeBlocks: recipPlacement.openingSizeBlocks,
      targetRoomId: sourceRoom.id,
      targetSpawnBlock: [sourceRoom.playerSpawnBlock[0], sourceRoom.playerSpawnBlock[1]],
      xBlock: recipPlacement.xBlock,
      yBlock: recipPlacement.yBlock,
      gradientWidthBlocks: sourceTrans.gradientWidthBlocks ?? 0,
      longTransition: sourceTrans.longTransition,
    };

    // ── Create new room with the reciprocal transition ─────────────────────
    const newRoomDef = roomJsonDefToRoomDef({
      id,
      name,
      worldNumber: worldId,
      widthBlocks: w,
      heightBlocks: h,
      playerSpawnBlock: [Math.floor(w / 2), Math.floor(h / 2)],
      interiorWalls: [],
      enemies: [],
      transitions: [recipJsonTrans],
      skillTombs: [],
    });

    // Compute reciprocal spawn block (entering new room from source side)
    const recipSpawn = computeSpawnBlockForMapLink(newRoomDef, newRoomDef.transitions[0]);

    // Update source transition to point to the new room
    sourceTrans.targetRoomId = id;
    sourceTrans.targetSpawnBlock = [recipSpawn[0], recipSpawn[1]];

    // Compute spawn block for the reciprocal transition pointing back (entering source room)
    const sourceRoomDef = ROOM_REGISTRY.get(sourceRoom.id);
    const backSpawn = sourceRoomDef
      ? computeSpawnBlockForMapLink(sourceRoomDef, sourceTrans)
      : [sourceTrans.xBlock ?? 1, sourceTrans.yBlock ?? 1] as const;

    // Update reciprocal transition spawn block in the new room def
    // (newRoomDef.transitions is readonly so we mutate via setRoomTransitionLink later)
    newRoomDef.transitions[0].targetSpawnBlock = [backSpawn[0], backSpawn[1]];

    // ── Register and position the new room ────────────────────────────────
    registerRoom(newRoomDef);
    setRoomNameOverride(id, name);
    setRoomWorldOverride(id, worldId);

    // Place adjacent to the source room on the visual map
    const adjacentPos = getAdjacentRoomMapPosition(sourceRoom.id, sourceTrans.direction, w, h);
    const sourcePos = WORLD_MAP_POSITIONS.get(sourceRoom.id);
    const fallbackPos = sourcePos
      ? { mapX: sourcePos.mapX + 60, mapY: sourcePos.mapY }
      : { mapX: 60, mapY: 0 };
    const { mapX, mapY } = adjacentPos ?? fallbackPos;
    setRoomMapPosition(id, mapX, mapY);

    callbacks.onWorldMapDataChanged();
    modal.destroy();
    callbacks.onRoomCreated(newRoomDef);
  });

  const cancelBtn = makeHeaderBtn('Cancel', '#888888');
  cancelBtn.style.cssText += ' flex: 1;';
  cancelBtn.addEventListener('click', () => modal.destroy());

  btnRow.appendChild(createBtn);
  btnRow.appendChild(cancelBtn);
  modal.panel.appendChild(btnRow);

  idInput.focus();
}
