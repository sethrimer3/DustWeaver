/**
 * Campaign spawn management helpers for the editor.
 *
 * Extracted from editorController.ts. Provides functions for reading,
 * writing, and UI confirmation of the campaign spawn point placement.
 *
 * The CampaignSpawnContext bundles the dependencies (EditorState,
 * EditableCampaignSession, and uiRoot) that all four helpers share.
 */

import type { EditorState } from './editorState';
import type { EditableCampaignSession } from './editableCampaignSession';
import type { EditorHistory, PendingSnapshot } from './editorHistory';
import { pushSnapshot, capturePendingSnapshot } from './editorHistory';

/** Shared dependencies injected into all campaign-spawn helpers. */
export interface CampaignSpawnContext {
  state: EditorState;
  campaignSession: EditableCampaignSession | null | undefined;
  uiRoot: HTMLElement;
}

/**
 * Pushes an undo/redo snapshot that captures both the current room data AND
 * the current campaign spawn metadata (campaignSpawn + initialRoomId), so
 * that undo/redo correctly round-trips campaign-spawn placement, movement,
 * deletion, and starting-option edits. Call this immediately before any
 * mutation that may affect campaign spawn state.
 */
export function pushCampaignSpawnSnapshot(ctx: CampaignSpawnContext, history: EditorHistory): void {
  const { state, campaignSession } = ctx;
  if (!state.roomData) return;
  const spawn = campaignSession?.campaign.campaign.campaignSpawn;
  const initialRoomId = campaignSession?.campaign.campaign.initialRoomId;
  pushSnapshot(history, state.roomData, spawn, initialRoomId, true);
}

/**
 * Lazy-capture counterpart to `pushCampaignSpawnSnapshot`: clones the
 * current room + campaign-spawn state WITHOUT touching undoStack/redoStack.
 * Callers whose mutation may turn out to be a no-op should capture with
 * this, then only call `commitPendingSnapshot` (from editorHistory) if the
 * mutation actually changed something — leaving history completely
 * untouched otherwise. Returns `null` if there's no room to snapshot (mirrors
 * `pushCampaignSpawnSnapshot`'s early return).
 */
export function captureCampaignSpawnPendingSnapshot(ctx: CampaignSpawnContext): PendingSnapshot | null {
  const { state, campaignSession } = ctx;
  if (!state.roomData) return null;
  const spawn = campaignSession?.campaign.campaign.campaignSpawn;
  const initialRoomId = campaignSession?.campaign.campaign.initialRoomId;
  return capturePendingSnapshot(state.roomData, spawn, initialRoomId, true);
}

/**
 * Reads campaign.campaignSpawn from the session and sets
 * state.campaignSpawnBlock and state.campaignSpawnStartingOptions if the
 * current room is the campaign spawn room, otherwise sets both to null.
 */
export function syncCampaignSpawnBlockFromSession(ctx: CampaignSpawnContext): void {
  const { state, campaignSession } = ctx;
  const spawn = campaignSession?.campaign.campaign.campaignSpawn ?? null;
  if (spawn !== null && state.roomData !== null && spawn.roomId === state.roomData.id) {
    state.campaignSpawnBlock = [spawn.xBlock, spawn.yBlock];
    state.campaignSpawnStartingOptions = {
      startingHealth: spawn.startingHealth,
      startingDustContainerCount: spawn.startingDustContainerCount,
      startingDustTypes: spawn.startingDustTypes,
      startingWeaves: spawn.startingWeaves,
      startingPassives: spawn.startingPassives,
    };
  } else {
    state.campaignSpawnBlock = null;
    state.campaignSpawnStartingOptions = null;
  }
}

/**
 * After a delete action, syncs state.campaignSpawnBlock = null back to the
 * campaign session (clears campaignSpawn if it was in the current room).
 * Note: `campaign.initialRoomId` is intentionally NOT reset on deletion —
 * it serves as a fallback room when no campaignSpawn is present, so it should
 * continue pointing at the last known spawn room for backward-compat exports.
 */
export function syncCampaignSpawnToSessionAfterDelete(ctx: CampaignSpawnContext): void {
  const { state, campaignSession } = ctx;
  if (!campaignSession || !state.roomData) return;
  const spawn = campaignSession.campaign.campaign.campaignSpawn;
  if (spawn && spawn.roomId === state.roomData?.id && state.campaignSpawnBlock === null) {
    delete campaignSession.campaign.campaign.campaignSpawn;
    state.campaignSpawnStartingOptions = null;
  }
}

/**
 * Places the campaign spawn at (newXBlock, newYBlock) in the current room,
 * clearing any old campaign spawn from other rooms, and updates the session.
 * Preserves any existing starting options (startingHealth, startingDustContainerCount,
 * startingDustTypes, startingWeaves) from a previously placed spawn.
 * Does NOT push a history snapshot — the caller must call
 * pushCampaignSpawnSnapshot(ctx, history) before invoking this.
 */
export function placeCampaignSpawn(ctx: CampaignSpawnContext, newXBlock: number, newYBlock: number): void {
  const { state, campaignSession } = ctx;
  if (!state.roomData || !campaignSession) return;
  const roomId = state.roomData.id;
  // Preserve existing starting options when moving or replacing the spawn.
  const prevSpawn = campaignSession.campaign.campaign.campaignSpawn;
  const prevOptions = prevSpawn !== undefined ? {
    startingHealth: prevSpawn.startingHealth,
    startingDustContainerCount: prevSpawn.startingDustContainerCount,
    startingDustTypes: prevSpawn.startingDustTypes,
    startingWeaves: prevSpawn.startingWeaves,
    startingPassives: prevSpawn.startingPassives,
  } : {};
  state.campaignSpawnBlock = [newXBlock, newYBlock];
  state.campaignSpawnStartingOptions = {
    startingHealth: prevOptions.startingHealth,
    startingDustContainerCount: prevOptions.startingDustContainerCount,
    startingDustTypes: prevOptions.startingDustTypes,
    startingWeaves: prevOptions.startingWeaves,
    startingPassives: prevOptions.startingPassives,
  };
  campaignSession.campaign.campaign.campaignSpawn = {
    roomId,
    xBlock: newXBlock,
    yBlock: newYBlock,
    ...prevOptions,
  };
  // Keep initialRoomId in sync with the campaign spawn room.
  campaignSession.campaign.campaign.initialRoomId = roomId;
}

/**
 * Shows the "This will remove the current campaign spawn, proceed?" confirmation
 * modal and then places the new campaign spawn when the user clicks Yes.
 */
export function showCampaignSpawnReplaceModal(
  ctx: CampaignSpawnContext,
  newXBlock: number,
  newYBlock: number,
  history: EditorHistory,
): void {
  const { uiRoot, state } = ctx;
  const backdrop = document.createElement('div');
  backdrop.style.cssText = [
    'position:absolute', 'top:0', 'left:0', 'width:100%', 'height:100%',
    'background:rgba(0,0,0,0.75)', 'z-index:2000',
    'display:flex', 'align-items:center', 'justify-content:center',
    'pointer-events:auto',
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'background:rgba(10,12,20,0.97)',
    'border:1px solid rgba(255,200,30,0.6)',
    'border-radius:8px', 'padding:24px 32px',
    'display:flex', 'flex-direction:column', 'align-items:center', 'gap:20px',
    "font-family:'Cinzel',monospace",
    'min-width:300px', 'box-shadow:0 0 30px rgba(0,0,0,0.8)',
  ].join(';');

  const oldRoomId = ctx.campaignSession?.campaign.campaign.campaignSpawn?.roomId ?? 'another room';
  const newRoomId = state.roomData?.id ?? 'this room';
  const msg = document.createElement('div');
  msg.textContent = `Move the campaign spawn from "${oldRoomId}" to "${newRoomId}"?`;
  msg.style.cssText = [
    'font-size:15px', 'font-weight:bold', 'color:#ffe060',
    'letter-spacing:0.04em', 'text-align:center', 'max-width:280px',
  ].join(';');
  panel.appendChild(msg);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:16px;';

  function makeBtn(label: string, bg: string, color: string, border: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = [
      'min-width:90px', 'padding:10px 20px', 'font-size:14px', 'font-weight:bold',
      "font-family:'Cinzel',monospace", 'cursor:pointer', 'border-radius:4px',
      `background:${bg}`, `color:${color}`, `border:2px solid ${border}`,
    ].join(';');
    return b;
  }

  const yesBtn = makeBtn('Yes', 'rgba(180,100,0,0.6)', '#ffe060', '#ffe060');
  const noBtn  = makeBtn('No',  'rgba(40,40,60,0.6)',  '#c0d0e0', '#4a5a6a');

  function dismiss(): void { backdrop.remove(); }

  yesBtn.addEventListener('click', () => {
    dismiss();
    pushCampaignSpawnSnapshot(ctx, history);
    placeCampaignSpawn(ctx, newXBlock, newYBlock);
    // Auto-select the marker so the inspector shows it immediately.
    state.selectedElements = [{ type: 'campaignSpawn', uid: 0 }];
  });
  noBtn.addEventListener('click', () => { dismiss(); });

  btnRow.appendChild(yesBtn);
  btnRow.appendChild(noBtn);
  panel.appendChild(btnRow);
  backdrop.appendChild(panel);
  uiRoot.appendChild(backdrop);
}
