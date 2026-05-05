/**
 * dialogueRuntime.ts — Start/advance/close logic for active dialogues.
 *
 * Pure logic with no DOM or rendering dependencies.  The game screen calls
 * these functions and then tells the overlay renderer to update its display.
 */

import type { Conversation } from './dialogueTypes';
import type { DialogueState } from './dialogueState';

/**
 * Starts a new dialogue conversation, replacing any currently active one.
 * The overlay renderer should be notified to show the first entry after this call.
 */
export function startDialogue(state: DialogueState, conversation: Conversation): void {
  state.activeConversation = conversation;
  state.activeEntryIndex = 0;
  state.isDialogueActiveFlag = conversation.entries.length > 0;
}

/**
 * Advances to the next dialogue entry, or closes the dialogue if at the last entry.
 *
 * Returns true if the call was handled (dialogue was active).
 * Returns false if no dialogue was active (call was a no-op).
 *
 * After this call, check isDialogueActiveFlag to determine whether to show the
 * next entry or hide the overlay.
 */
export function advanceDialogue(state: DialogueState): boolean {
  if (!state.isDialogueActiveFlag || state.activeConversation === null) return false;
  const nextIndex = state.activeEntryIndex + 1;
  if (nextIndex >= state.activeConversation.entries.length) {
    closeDialogue(state);
  } else {
    state.activeEntryIndex = nextIndex;
  }
  return true;
}

/**
 * Immediately closes the dialogue without advancing.
 * The overlay renderer should be notified to hide after this call.
 */
export function closeDialogue(state: DialogueState): void {
  state.isDialogueActiveFlag = false;
  state.activeConversation = null;
  state.activeEntryIndex = 0;
}
