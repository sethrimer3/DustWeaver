/**
 * Pure signature computations backing editorUI.ts's per-section "only touch
 * the DOM when something actually changed" gating (Phase 5).
 *
 * Each function reduces a slice of EditorState (plus, where noted, some
 * editor-UI-local state) to a small string/tuple that's cheap to compare with
 * `===`. editorUI.ts caches the last-seen signature per section and only
 * rebuilds/patches DOM when it differs — never deep-diffing the whole state
 * tree. Split into its own module (no DOM, no Vite import.meta) so it's
 * importable and testable under plain Node (editorUI.ts itself cannot be,
 * since it uses `import.meta.env`).
 */

import type { EditorState } from './editorState';
import type { CustomBlockDef } from '../levels/customBlocks';

export function computeToolSig(state: EditorState): string {
  return state.activeTool;
}

export function computeBrushSig(state: EditorState): string {
  return state.brushMode;
}

export function computeCategorySig(state: EditorState): string {
  return state.activeCategory;
}

export function computePaletteSelectionSig(state: EditorState): string {
  return state.selectedPaletteItem?.id ?? '';
}

export function computeBlockModifierSig(state: EditorState): string {
  return `${state.pendingBlockPlacementModifier}|${state.pendingCrumbleVariant}|${state.pendingBackgroundBlocksLight ? 1 : 0}`;
}

export function computeRoomMetadataSig(state: EditorState): string {
  const room = state.roomData;
  if (room === null) return '';
  return `${room.id}|${room.widthBlocks}|${room.heightBlocks}|${room.backgroundId}|${room.songId}`;
}

/** Includes the open/replace-picker slot since that's presentation state the theme section must react to. */
export function computeBlockThemeSig(state: EditorState, themePaletteOpenForSlot: number | null): string {
  return `${state.selectedBlockTheme}|${state.recentBlockThemes.join(',')}|${state.blockThemeSlots.join(',')}|${state.activeBlockThemeSlotIndex}|open:${themePaletteOpenForSlot ?? '-'}`;
}

/**
 * Custom-block registry signature — definitions, names, properties,
 * ordering, sprite pixels (via spriteRevision — see CustomBlockDef), and
 * usage counts all fold in, so any of those changing while the Custom
 * Blocks category stays open triggers a rebuild (this was previously
 * missed: the palette only rebuilt on category change).
 *
 * Deliberately EXCLUDES the selected custom block: selection is patched via
 * computePaletteSelectionSig without a structural rebuild (custom-block
 * cards are keyed by block id and their active/inactive styling is patched
 * in place, same as ordinary palette items).
 */
export function computeCustomBlockRegistrySig(state: EditorState): string {
  const parts: string[] = [];
  for (const [id, def] of state.customBlockRegistry) {
    const usage = state.customBlockUsage.get(id) ?? 0;
    parts.push(customBlockDefSig(id, def, usage));
  }
  return parts.join(';');
}

function customBlockDefSig(id: string, def: CustomBlockDef, usageCount: number): string {
  return `${id}:${def.name}:${def.tileWidth}x${def.tileHeight}:${JSON.stringify(def.properties)}:rev${def.spriteRevision ?? 0}:u${usageCount}`;
}

/**
 * Full palette-structure signature — the single source of truth for "does
 * the palette section need a structural rebuild right now". Combines
 * category with whichever category-specific slice can change the DOM shape:
 * block themes for `blocks`, the registry for `customBlocks`. Palette
 * *selection* highlighting is intentionally excluded — that's patched
 * separately by computePaletteSelectionSig without a structural rebuild.
 */
export function computePaletteStructureSig(state: EditorState, themePaletteOpenForSlot: number | null): string {
  const category = computeCategorySig(state);
  if (category === 'blocks') {
    return `blocks|${computeBlockThemeSig(state, themePaletteOpenForSlot)}`;
  }
  if (category === 'customBlocks') {
    return `customBlocks|${computeCustomBlockRegistrySig(state)}`;
  }
  return category;
}

export interface InspectorIdentitySig {
  uid: number;
  type: string;
  count: number;
  dialogueEntryCount: number;
}

export function computeInspectorIdentitySig(state: EditorState): InspectorIdentitySig {
  const first = state.selectedElements.length > 0 ? state.selectedElements[0] : null;
  const uid = first?.uid ?? -1;
  const type = first?.type ?? '';
  const count = state.selectedElements.length;
  let dialogueEntryCount = -1;
  if (type === 'dialogueTrigger' && state.roomData) {
    const dt = (state.roomData.dialogueTriggers ?? []).find(t => t.uid === uid);
    dialogueEntryCount = dt ? dt.entries.length : -1;
  }
  return { uid, type, count, dialogueEntryCount };
}

export function inspectorIdentitySigEquals(a: InspectorIdentitySig, b: InspectorIdentitySig): boolean {
  return a.uid === b.uid && a.type === b.type && a.count === b.count && a.dialogueEntryCount === b.dialogueEntryCount;
}
