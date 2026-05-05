/**
 * dialogueTypes.ts — Dialogue and conversation data model.
 *
 * WHY HIGH-RESOLUTION: DustWeaver's game world renders at a fixed 480×270
 * virtual pixel canvas upscaled with nearest-neighbour sampling for a
 * pixelated retro look. Rendering dialogue text into that virtual canvas
 * would make it blurry and pixelated. The dialogue overlay is instead drawn
 * at full device resolution via a DOM layer positioned over the game canvas.
 */

/** Maximum number of entries allowed per conversation (inclusive). */
export const MAX_DIALOGUE_ENTRIES = 99;

/**
 * Stub portrait IDs available before final portrait assets are ready.
 *
 * TODO: Replace stub portraits with real portrait assets. Each ID should
 * eventually map to a sprite sheet slice or a pre-loaded image element
 * loaded through the asset pipeline (e.g., SPRITES/portraits/{id}.png).
 */
export const STUB_PORTRAIT_IDS = [
  'none',
  'narrator',
  'hero',
  'elder',
  'merchant',
  'enemy',
] as const;

/** A single dialogue text box shown to the player. */
export interface DialogueEntry {
  /** The text displayed in the dialogue box. */
  text: string;
  /** ID of the character portrait to display. Use 'none' for no portrait. */
  portraitId: string;
  /** Which side of the dialogue panel the portrait appears on. */
  portraitSide: 'left' | 'right';
}

/**
 * A conversation — an ordered sequence of dialogue entries shown one at a time.
 * Maximum MAX_DIALOGUE_ENTRIES (99) entries per conversation.
 */
export interface Conversation {
  /** Stable unique identifier for this conversation. */
  id: string;
  /** Optional display name shown above the dialogue text (e.g. "Elder Vasha"). */
  title?: string;
  /**
   * Dialogue entries in display order. Clamped to MAX_DIALOGUE_ENTRIES on creation.
   * The editor prevents adding beyond MAX_DIALOGUE_ENTRIES entries.
   */
  entries: DialogueEntry[];
}

/** Creates a new empty conversation with the given ID. */
export function createEmptyConversation(id: string): Conversation {
  return {
    id,
    title: '',
    entries: [],
  };
}

/** Creates a new dialogue entry with default placeholder values. */
export function createDefaultDialogueEntry(): DialogueEntry {
  return {
    text: 'Enter dialogue text here.',
    portraitId: 'none',
    portraitSide: 'left',
  };
}
