/**
 * gameDialogueHandler.ts — Dialogue advance and trigger-zone helpers.
 *
 * Extracted from gameScreen.ts to isolate the two dialogue-related
 * operations that run every frame:
 *
 *   handleDialogueAdvance  — drives the active conversation forward or
 *                            closes it when the player presses the confirm
 *                            button.
 *
 *   checkDialogueTriggers  — tests whether the player has stepped into any
 *                            trigger zone in the current room and opens the
 *                            associated conversation if so.  Each trigger
 *                            fires only once per room visit.
 *
 * Both functions have no return value and mutate only the shared dialogue
 * state + renderer they receive; they do not touch world physics state.
 */

import type { RoomDef } from '../levels/roomDef';
import type { Conversation } from '../dialogue/dialogueTypes';
import type { DialogueState } from '../dialogue/dialogueState';
import { closeDialogue, startDialogue, advanceDialogue } from '../dialogue/dialogueRuntime';
import type { DialogueOverlayRenderer } from '../render/ui/dialogueOverlayRenderer';

/**
 * Advances or closes the active dialogue when the player requests it.
 *
 * When a dialogue is in progress and `advanceRequested` is true, the next
 * entry is shown.  If the conversation ends the overlay is hidden.  Has no
 * effect when no dialogue is active.
 */
export function handleDialogueAdvance(
  advanceRequested: boolean,
  dialogueState: DialogueState,
  dialogueRenderer: DialogueOverlayRenderer,
): void {
  if (!advanceRequested || !dialogueState.isDialogueActiveFlag) return;

  advanceDialogue(dialogueState);
  if (dialogueState.isDialogueActiveFlag && dialogueState.activeConversation !== null) {
    const entry = dialogueState.activeConversation.entries[dialogueState.activeEntryIndex];
    const isLast = dialogueState.activeEntryIndex === dialogueState.activeConversation.entries.length - 1;
    dialogueRenderer.show(entry, dialogueState.activeConversation.title, isLast);
  } else {
    dialogueRenderer.hide();
  }
}

/**
 * Checks whether the player has entered any dialogue trigger zone in the
 * current room and starts the appropriate conversation when they do.
 *
 * Rules:
 *  - Does nothing while a dialogue is already active.
 *  - Each trigger fires at most once per room visit; `firedDialogueTriggerUids`
 *    is a Set of trigger indices that have already fired this visit.  It is
 *    reset to empty on every room load by the caller.
 *  - Triggers are indexed by position in `currentRoom.dialogueTriggers`; the
 *    matching `cachedRoomConversations[index]` holds the pre-converted
 *    runtime Conversation so no allocation happens in this hot path.
 *
 * @param playerXBlock         Room-local block X of the player (-1 if absent).
 * @param playerYBlock         Room-local block Y of the player (-1 if absent).
 * @param currentRoom          The room whose triggers are being tested.
 * @param firedDialogueTriggerUids  Trigger indices that have already fired.
 * @param cachedRoomConversations   Pre-converted Conversation objects (1:1 with triggers).
 * @param dialogueState        Mutable dialogue session state.
 * @param dialogueRenderer     Overlay renderer to show/update the dialogue UI.
 */
export function checkDialogueTriggers(
  playerXBlock: number,
  playerYBlock: number,
  currentRoom: RoomDef,
  firedDialogueTriggerUids: Set<number>,
  cachedRoomConversations: Conversation[],
  dialogueState: DialogueState,
  dialogueRenderer: DialogueOverlayRenderer,
): void {
  if (dialogueState.isDialogueActiveFlag) return;
  if (playerXBlock < 0 || playerYBlock < 0) return;

  const triggers = currentRoom.dialogueTriggers ?? [];
  for (let triggerIndex = 0; triggerIndex < triggers.length; triggerIndex++) {
    if (firedDialogueTriggerUids.has(triggerIndex)) continue;
    const trig = triggers[triggerIndex];
    const inZone = playerXBlock >= trig.xBlock && playerXBlock < trig.xBlock + trig.wBlock &&
                   playerYBlock >= trig.yBlock && playerYBlock < trig.yBlock + trig.hBlock;
    if (!inZone) continue;

    firedDialogueTriggerUids.add(triggerIndex);
    // Use the pre-converted runtime Conversation (no allocation in hot path).
    const conv = cachedRoomConversations[triggerIndex];
    if (conv && conv.entries.length > 0) {
      startDialogue(dialogueState, conv);
      const firstEntry = conv.entries[0];
      const isLast = conv.entries.length === 1;
      dialogueRenderer.show(firstEntry, conv.title, isLast);
    }
    break;
  }
}

/**
 * Resets per-room dialogue visit state and pre-converts trigger conversations.
 *
 * Called during room load (not per-frame) so trigger checks can reuse immutable
 * runtime Conversation data without allocations in the frame hot path.
 */
export function prepareRoomDialogueVisitState(
  room: RoomDef,
  dialogueState: DialogueState,
  dialogueRenderer: DialogueOverlayRenderer,
): { firedDialogueTriggerUids: Set<number>; cachedRoomConversations: Conversation[] } {
  closeDialogue(dialogueState);
  dialogueRenderer.hide();
  const firedDialogueTriggerUids = new Set<number>();
  const roomTriggers = room.dialogueTriggers ?? [];
  const cachedRoomConversations = new Array<Conversation>(roomTriggers.length);
  for (let triggerIndex = 0; triggerIndex < roomTriggers.length; triggerIndex++) {
    const sourceConversation = roomTriggers[triggerIndex].conversation;
    cachedRoomConversations[triggerIndex] = {
      id: sourceConversation.id,
      title: sourceConversation.title,
      entries: sourceConversation.entries.map(entry => ({
        text: entry.text,
        portraitId: entry.portraitId,
        portraitSide: entry.portraitSide,
      })),
    };
  }
  return { firedDialogueTriggerUids, cachedRoomConversations };
}
