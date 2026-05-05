/**
 * dialogueState.ts — Mutable runtime state for the active dialogue session.
 *
 * This state is owned by the game screen and updated by dialogueRuntime.ts.
 * It tracks which conversation is active, the current entry index, and whether
 * the dialogue overlay is currently open.
 */

import type { Conversation } from './dialogueTypes';

/** Mutable runtime state for the active dialogue session. */
export interface DialogueState {
  /** The conversation currently being played, or null when no dialogue is active. */
  activeConversation: Conversation | null;
  /** Index of the currently displayed entry within activeConversation.entries. */
  activeEntryIndex: number;
  /** True while a dialogue overlay is visible to the player. */
  isDialogueActiveFlag: boolean;
}

/** Creates the initial (closed) dialogue state. */
export function createDialogueState(): DialogueState {
  return {
    activeConversation: null,
    activeEntryIndex: 0,
    isDialogueActiveFlag: false,
  };
}
