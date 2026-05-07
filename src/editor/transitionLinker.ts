/**
 * Transition linker — handles the cross-room linking workflow.
 *
 * Flow:
 * 1. User selects a transition and clicks "Link Transition"
 * 2. Editor opens the world map to pick a destination room
 * 3. After entering the destination room, user clicks a transition to complete the link
 * 4. Source transition's targetRoomId and targetSpawnBlock are updated
 *
 * Before completing a link, direction and width are validated. Invalid links are
 * rejected and the state is left in the "linking" mode so the user can try again.
 */

import type { EditorState, EditorTransition } from './editorState';
import { validateTransitionLink, TransitionLinkResult } from './transitionValidation';

/**
 * Begins the transition linking workflow.
 * Sets state flags so the editor knows we're in linking mode.
 */
export function beginTransitionLink(state: EditorState): boolean {
  const sel = state.selectedElements[0] ?? null;
  if (sel === null || sel.type !== 'transition') return false;
  if (state.roomData === null) return false;

  const sourceTrans = state.roomData.transitions.find(t => t.uid === sel.uid);
  if (!sourceTrans) return false;

  state.isLinkingTransition = true;
  state.linkSourceTransitionUid = sourceTrans.uid;
  return true;
}

/**
 * Completes the link by setting the source transition's target to the given room
 * and transition. Validates direction and width compatibility before mutating state.
 *
 * Returns `{ ok: true }` on success, or `{ ok: false, reason }` if invalid.
 * On failure the linking state flags are NOT cleared — the user can try again.
 */
export function completeTransitionLink(
  state: EditorState,
  sourceRoomTransitions: EditorTransition[],
  targetRoomId: string,
  targetTransition: EditorTransition,
  targetRoomWidthBlocks?: number,
  targetRoomHeightBlocks?: number,
): TransitionLinkResult {
  const sourceTrans = sourceRoomTransitions.find(t => t.uid === state.linkSourceTransitionUid);
  if (!sourceTrans) {
    state.isLinkingTransition = false;
    state.linkSourceTransitionUid = -1;
    return { ok: true }; // nothing to do
  }

  // Validate compatibility
  const validation = validateTransitionLink(sourceTrans, targetTransition);
  if (!validation.ok) {
    // Do NOT mutate state — leave linking active so user can choose another target.
    // Cancel the linking mode so we don't get stuck.
    state.isLinkingTransition = false;
    state.linkSourceTransitionUid = -1;
    return validation;
  }

  // Spawn 3 blocks inside the target room from the trigger edge, centered on opening.
  const SPAWN_INSET_BLOCKS = 3;
  const openingCenterHoriz = targetTransition.yBlock + Math.floor(targetTransition.openingSizeBlocks / 2);
  const openingCenterVert  = targetTransition.xBlock + Math.floor(targetTransition.openingSizeBlocks / 2);

  if (targetTransition.direction === 'left') {
    sourceTrans.targetSpawnBlock = [SPAWN_INSET_BLOCKS, openingCenterHoriz];
  } else if (targetTransition.direction === 'right') {
    const rightX = (targetRoomWidthBlocks ?? 40) - SPAWN_INSET_BLOCKS - 1;
    sourceTrans.targetSpawnBlock = [rightX, openingCenterHoriz];
  } else if (targetTransition.direction === 'up') {
    sourceTrans.targetSpawnBlock = [openingCenterVert, SPAWN_INSET_BLOCKS];
  } else {
    const bottomY = (targetRoomHeightBlocks ?? 30) - SPAWN_INSET_BLOCKS - 1;
    sourceTrans.targetSpawnBlock = [openingCenterVert, bottomY];
  }
  sourceTrans.targetRoomId = targetRoomId;

  state.isLinkingTransition = false;
  state.linkSourceTransitionUid = -1;
  return { ok: true };
}

/**
 * Cancels the linking workflow.
 */
export function cancelTransitionLink(state: EditorState): void {
  state.isLinkingTransition = false;
  state.linkSourceTransitionUid = -1;
}
