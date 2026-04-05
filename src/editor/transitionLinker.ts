/**
 * Transition linker — handles the cross-room linking workflow.
 *
 * Flow:
 * 1. User selects a transition and clicks "Link Transition"
 * 2. Editor opens the world map to pick a destination room
 * 3. After entering the destination room, user clicks a transition to complete the link
 * 4. Source transition's targetRoomId and targetSpawnBlock are updated
 */

import type { EditorState, EditorTransition } from './editorState';

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
 * and transition. Called after the user clicks a transition in the destination room.
 */
export function completeTransitionLink(
  state: EditorState,
  sourceRoomTransitions: EditorTransition[],
  targetRoomId: string,
  targetTransition: EditorTransition,
  targetRoomWidthBlocks?: number,
): void {
  const sourceTrans = sourceRoomTransitions.find(t => t.uid === state.linkSourceTransitionUid);
  if (sourceTrans) {
    sourceTrans.targetRoomId = targetRoomId;
    // Spawn 3 blocks inside the target room from the transition edge.
    // For right transitions, use the target room width if available.
    const SPAWN_INSET_BLOCKS = 3;
    const spawnOffset = Math.floor(targetTransition.openingSizeBlocks / 2);
    if (targetTransition.direction === 'left') {
      sourceTrans.targetSpawnBlock = [SPAWN_INSET_BLOCKS, targetTransition.positionBlock + spawnOffset];
    } else if (targetTransition.direction === 'right') {
      const rightX = (targetRoomWidthBlocks ?? 40) - SPAWN_INSET_BLOCKS - 1;
      sourceTrans.targetSpawnBlock = [rightX, targetTransition.positionBlock + spawnOffset];
    } else if (targetTransition.direction === 'up') {
      sourceTrans.targetSpawnBlock = [targetTransition.positionBlock + spawnOffset, SPAWN_INSET_BLOCKS];
    } else {
      // down
      sourceTrans.targetSpawnBlock = [targetTransition.positionBlock + spawnOffset, SPAWN_INSET_BLOCKS];
    }
  }

  state.isLinkingTransition = false;
  state.linkSourceTransitionUid = -1;
}

/**
 * Cancels the linking workflow.
 */
export function cancelTransitionLink(state: EditorState): void {
  state.isLinkingTransition = false;
  state.linkSourceTransitionUid = -1;
}
