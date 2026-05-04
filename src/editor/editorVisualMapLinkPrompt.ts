/**
 * Door-link management for the visual world map editor.
 *
 * Extracted from editorVisualMap.ts.  Handles the full door-link workflow:
 *   • Initiating a link (completeDoorLink / cancelDoorLink)
 *   • Showing the confirmation prompt (showLinkRoomsPrompt)
 *   • Confirming or auto-dismissing the prompt (confirmPendingDoorLink / dismissLinkRoomsPrompt)
 *   • Persisting the link (applyPendingDoorLink)
 *   • Computing spawn blocks for newly-linked transitions (computeSpawnBlockForMapLink)
 *
 * All stateful access to editorVisualMap.ts closure variables goes through
 * the VisualMapLinkContext interface.
 */

import type { RoomDef, RoomTransitionDef } from '../levels/roomDef';
import { ROOM_REGISTRY, setRoomTransitionLink } from '../levels/rooms';
import { effectiveRoomName } from './editorVisualMapHelpers';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Highlight color for doorways that are about to snap or have been linked. */
const DOOR_SNAP_COLOR = '#ffe840';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Screen-space hit area for a single room doorway. */
export interface DoorHitArea {
  roomId: string;
  transitionIndex: number;
  xPx: number;
  yPx: number;
  wPx: number;
  hPx: number;
}

/** State for a pending (awaiting user confirmation) door-link operation. */
export interface PendingDoorLink {
  sourceRoomId: string;
  sourceTransIndex: number;
  targetRoomId: string;
  targetTransIndex: number;
  promptEl: HTMLDivElement;
  timeoutId: number;
  removeTimeoutId: number;
  hasResolved: boolean;
}

/**
 * Minimal context that links the door-link functions back to the shared
 * mutable state kept inside the editorVisualMap.ts closure.  All mutable
 * fields are exposed as getter / setter pairs so closures remain correct
 * even as the underlying variables change after context construction.
 */
export interface VisualMapLinkContext {
  readonly overlay: HTMLElement;
  readonly statusBar: HTMLElement;
  readonly render: () => void;
  /** Called when a successful link mutates room data. */
  readonly onWorldMapDataChanged: (() => void) | undefined;
  getPendingLink(): PendingDoorLink | null;
  setPendingLink(link: PendingDoorLink | null): void;
  getLinkSourceRoomId(): string;
  getLinkSourceTransIndex(): number;
  setLinkSource(roomId: string, transIndex: number): void;
  clearLinkSource(): void;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the [xBlock, yBlock] spawn position for a player entering a room
 * through the given transition, inset from the door edge.
 */
export function computeSpawnBlockForMapLink(
  room: RoomDef,
  transition: RoomTransitionDef,
): readonly [number, number] {
  const SPAWN_INSET_BLOCKS = 3;
  const spawnOffset = Math.floor(transition.openingSizeBlocks / 2);
  if (transition.direction === 'left') {
    return [SPAWN_INSET_BLOCKS, transition.positionBlock + spawnOffset];
  }
  if (transition.direction === 'right') {
    return [room.widthBlocks - SPAWN_INSET_BLOCKS - 1, transition.positionBlock + spawnOffset];
  }
  if (transition.direction === 'up') {
    return [transition.positionBlock + spawnOffset, SPAWN_INSET_BLOCKS];
  }
  return [transition.positionBlock + spawnOffset, room.heightBlocks - SPAWN_INSET_BLOCKS - 1];
}

// ── Link persistence ──────────────────────────────────────────────────────────

/**
 * Persists a confirmed door-link pair into the room registry, updating both
 * directions.  Updates the status bar with the result.
 */
export function applyPendingDoorLink(link: PendingDoorLink, ctx: VisualMapLinkContext): void {
  const sourceRoom = ROOM_REGISTRY.get(link.sourceRoomId);
  const targetRoom = ROOM_REGISTRY.get(link.targetRoomId);
  const sourceTransition = sourceRoom?.transitions[link.sourceTransIndex];
  const targetTransition = targetRoom?.transitions[link.targetTransIndex];
  if (!sourceRoom || !targetRoom || !sourceTransition || !targetTransition) return;

  const sourceSpawn = computeSpawnBlockForMapLink(sourceRoom, sourceTransition);
  const targetSpawn = computeSpawnBlockForMapLink(targetRoom, targetTransition);
  const didLinkSource = setRoomTransitionLink(
    link.sourceRoomId,
    link.sourceTransIndex,
    link.targetRoomId,
    targetSpawn,
  );
  const didLinkTarget = setRoomTransitionLink(
    link.targetRoomId,
    link.targetTransIndex,
    link.sourceRoomId,
    sourceSpawn,
  );

  if (didLinkSource && didLinkTarget) {
    ctx.onWorldMapDataChanged?.();
    ctx.statusBar.textContent =
      `Linked: ${effectiveRoomName(link.sourceRoomId)} door #${link.sourceTransIndex + 1}` +
      ` <-> ${effectiveRoomName(link.targetRoomId)} door #${link.targetTransIndex + 1}`;
    ctx.statusBar.style.color = '#88ff88';
  }
}

// ── Prompt lifecycle ──────────────────────────────────────────────────────────

/**
 * Removes the pending-link confirmation prompt, optionally with a fade-out.
 */
export function dismissLinkRoomsPrompt(ctx: VisualMapLinkContext, shouldAnimate: boolean): void {
  const link = ctx.getPendingLink();
  if (!link) return;
  ctx.setPendingLink(null);
  window.clearTimeout(link.timeoutId);
  window.clearTimeout(link.removeTimeoutId);

  if (shouldAnimate) {
    link.promptEl.style.opacity = '0';
    link.promptEl.style.transform = 'translateY(16px)';
    link.removeTimeoutId = window.setTimeout(() => {
      if (link.promptEl.parentElement) link.promptEl.parentElement.removeChild(link.promptEl);
    }, 240);
    return;
  }

  if (link.promptEl.parentElement) link.promptEl.parentElement.removeChild(link.promptEl);
}

/**
 * Applies the pending door link and dismisses the confirmation prompt.
 */
export function confirmPendingDoorLink(ctx: VisualMapLinkContext): void {
  const link = ctx.getPendingLink();
  if (!link || link.hasResolved) return;
  link.hasResolved = true;
  applyPendingDoorLink(link, ctx);
  dismissLinkRoomsPrompt(ctx, false);
  ctx.render();
}

/**
 * Shows the "Link rooms?" confirmation prompt as a floating overlay element.
 * Auto-dismisses after 5 seconds if the user takes no action.
 */
export function showLinkRoomsPrompt(
  ctx: VisualMapLinkContext,
  sourceRoomId: string,
  sourceTransIndex: number,
  targetRoomId: string,
  targetTransIndex: number,
): void {
  dismissLinkRoomsPrompt(ctx, false);

  const promptEl = document.createElement('div');
  promptEl.style.cssText = `
    position: absolute; top: 64px; left: 16px; z-index: 1300;
    width: 210px; overflow: hidden; border-radius: 4px;
    background: rgba(8,12,18,0.96); border: 1px solid rgba(80,255,160,0.75);
    box-shadow: 0 8px 24px rgba(0,0,0,0.55);
    color: #d8ffe8; font-family: monospace; cursor: pointer;
    opacity: 0; transform: translateY(-12px);
    transition: opacity 180ms ease, transform 180ms ease;
  `;

  const contentEl = document.createElement('div');
  contentEl.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 10px 9px;';

  const labelEl = document.createElement('div');
  labelEl.textContent = 'Link rooms?';
  labelEl.style.cssText = 'font-size:13px; font-weight:bold;';
  contentEl.appendChild(labelEl);

  const yesBtn = document.createElement('button');
  yesBtn.type = 'button';
  yesBtn.textContent = 'Yes';
  yesBtn.style.cssText = `
    padding: 4px 10px; border-radius: 3px; border: 1px solid rgba(120,255,180,0.8);
    background: rgba(30,120,70,0.75); color: #ecfff4; font-family: monospace;
    font-size: 12px; cursor: pointer;
  `;
  contentEl.appendChild(yesBtn);
  promptEl.appendChild(contentEl);

  const timerBar = document.createElement('div');
  timerBar.style.cssText = `
    height: 3px; width: 100%; background: #66ffaa;
    transition: width 5000ms linear;
  `;
  promptEl.appendChild(timerBar);
  ctx.overlay.appendChild(promptEl);

  const pending: PendingDoorLink = {
    sourceRoomId,
    sourceTransIndex,
    targetRoomId,
    targetTransIndex,
    promptEl,
    timeoutId: 0,
    removeTimeoutId: 0,
    hasResolved: false,
  };
  ctx.setPendingLink(pending);

  promptEl.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    confirmPendingDoorLink(ctx);
  });
  yesBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    confirmPendingDoorLink(ctx);
  });

  requestAnimationFrame(() => {
    promptEl.style.opacity = '1';
    promptEl.style.transform = 'translateY(0)';
    timerBar.style.width = '0%';
  });

  pending.timeoutId = window.setTimeout(() => {
    if (ctx.getPendingLink() === pending && !pending.hasResolved) {
      dismissLinkRoomsPrompt(ctx, true);
    }
  }, 5000);
}

// ── Link initiation / cancellation ───────────────────────────────────────────

/**
 * Completes an in-progress door link by showing the confirmation prompt.
 * Clears the link source after recording the target.
 */
export function completeDoorLink(ctx: VisualMapLinkContext, targetDoor: DoorHitArea): void {
  const sourceRoom = ROOM_REGISTRY.get(ctx.getLinkSourceRoomId());
  const targetRoom = ROOM_REGISTRY.get(targetDoor.roomId);
  const srcRoomId = ctx.getLinkSourceRoomId();
  const srcTransIndex = ctx.getLinkSourceTransIndex();
  if (sourceRoom && targetRoom) {
    ctx.statusBar.textContent =
      `Linked: ${srcRoomId} Door #${srcTransIndex + 1} \u2192 ${targetDoor.roomId} Door #${targetDoor.transitionIndex + 1}` +
      ' — confirm to update the room files';
    ctx.statusBar.style.color = DOOR_SNAP_COLOR;
    showLinkRoomsPrompt(
      ctx,
      srcRoomId,
      srcTransIndex,
      targetDoor.roomId,
      targetDoor.transitionIndex,
    );
  }
  ctx.clearLinkSource();
  ctx.render();
}

/**
 * Cancels an in-progress door link and resets the link source state.
 */
export function cancelDoorLink(ctx: VisualMapLinkContext): void {
  ctx.clearLinkSource();
  ctx.statusBar.textContent = 'Link cancelled';
  ctx.statusBar.style.color = 'rgba(200,255,200,0.6)';
  ctx.render();
}
