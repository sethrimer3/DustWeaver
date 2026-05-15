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

/** Shared dependencies injected into all campaign-spawn helpers. */
export interface CampaignSpawnContext {
  state: EditorState;
  campaignSession: EditableCampaignSession | null | undefined;
  uiRoot: HTMLElement;
}

/**
 * Reads campaign.campaignSpawn from the session and sets
 * state.campaignSpawnBlock if the current room is the campaign spawn room,
 * otherwise sets it to null.
 */
export function syncCampaignSpawnBlockFromSession(ctx: CampaignSpawnContext): void {
  const { state, campaignSession } = ctx;
  const spawn = campaignSession?.campaign.campaign.campaignSpawn ?? null;
  if (spawn !== null && state.roomData !== null && spawn.roomId === state.roomData.id) {
    state.campaignSpawnBlock = [spawn.xBlock, spawn.yBlock];
  } else {
    state.campaignSpawnBlock = null;
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
  }
}

/**
 * Places the campaign spawn at (newXBlock, newYBlock) in the current room,
 * clearing any old campaign spawn from other rooms, and updates the session.
 * Does NOT push a history snapshot (the caller's Place tool branch does that).
 */
export function placeCampaignSpawn(ctx: CampaignSpawnContext, newXBlock: number, newYBlock: number): void {
  const { state, campaignSession } = ctx;
  if (!state.roomData || !campaignSession) return;
  const roomId = state.roomData.id;
  state.campaignSpawnBlock = [newXBlock, newYBlock];
  campaignSession.campaign.campaign.campaignSpawn = { roomId, xBlock: newXBlock, yBlock: newYBlock };
  // Keep initialRoomId in sync with the campaign spawn room.
  campaignSession.campaign.campaign.initialRoomId = roomId;
}

/**
 * Shows the "This will remove the current campaign spawn, proceed?" confirmation
 * modal and then places the new campaign spawn when the user clicks Yes.
 */
export function showCampaignSpawnReplaceModal(ctx: CampaignSpawnContext, newXBlock: number, newYBlock: number): void {
  const { uiRoot } = ctx;
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

  const msg = document.createElement('div');
  msg.textContent = 'This will remove the current campaign spawn, proceed?';
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
    placeCampaignSpawn(ctx, newXBlock, newYBlock);
  });
  noBtn.addEventListener('click', () => { dismiss(); });

  btnRow.appendChild(yesBtn);
  btnRow.appendChild(noBtn);
  panel.appendChild(btnRow);
  backdrop.appendChild(panel);
  uiRoot.appendChild(backdrop);
}
