/**
 * editorKeyboardShortcuts.ts — Keyboard shortcut handling for the editor.
 *
 * Extracted from editorController.ts (update() function) so tool-key
 * shortcuts, rotation / flip keys, map-open keys, ESC, undo/redo, and
 * copy/paste all live in a focused module rather than inline in the
 * large update() closure.
 *
 * The function is pure relative to the editor state bag — it mutates
 * `state` via the EditorState / EditorHistory APIs and calls the
 * provided callbacks when navigation or room edits are needed.
 */

import { EditorState, EditorTool } from './editorState';
import type { EditorInputState } from './editorInput';
import { EditorHistory, undo, redo, pushSnapshot } from './editorHistory';
import { cancelTransitionLink } from './transitionLinker';
import { rotateSelectedElement, flipSelectedTransition } from './editorTools';
import { serializeSelectedElements, pasteFromClipboard } from './editorDragCopyPaste';

/**
 * Process all keyboard shortcut inputs for one editor frame.
 *
 * Call this at the top of the editor update loop, after cursor position has
 * been computed, so that tool-key presses and undo/redo act on the current
 * cursor state.
 *
 * @param state         Mutable editor state.
 * @param inputState    One-shot and held input flags for this frame.
 * @param history       Undo/redo history stack.
 * @param openWorldMap  Callback to open the text world-map overlay (N key).
 * @param openVisualMap Callback to open the visual world-map editor (M key).
 * @param applyEdits    Callback to rebuild and reload the room after a mutation.
 */
export function handleEditorKeyboardShortcuts(
  state: EditorState,
  inputState: EditorInputState,
  history: EditorHistory,
  openWorldMap: () => void | Promise<void>,
  openVisualMap: () => void | Promise<void>,
  applyEdits: () => void,
): void {
  // Tool key shortcuts (1 = Select, 2 = Place, 3 = Delete)
  if (inputState.toolKeyPressed === 1) state.activeTool = EditorTool.Select;
  if (inputState.toolKeyPressed === 2) state.activeTool = EditorTool.Place;
  if (inputState.toolKeyPressed === 3) state.activeTool = EditorTool.Delete;

  // Mouse wheel → rotation (Place mode) or element rotation (Select mode)
  if (inputState.wheelDelta !== 0) {
    if (state.activeTool === EditorTool.Place) {
      state.placementRotationSteps = (state.placementRotationSteps + (inputState.wheelDelta > 0 ? 1 : 3)) % 4;
    } else if (state.activeTool === EditorTool.Select && state.selectedElements.length > 0) {
      rotateSelectedElement(state);
    }
  }

  // Q/E keys → rotate placement (Q = counter-clockwise, E = clockwise)
  if (inputState.isRotateLeftPressed && state.activeTool === EditorTool.Place) {
    state.placementRotationSteps = (state.placementRotationSteps + 3) % 4;
  }
  if (inputState.isRotateRightPressed && state.activeTool === EditorTool.Place) {
    state.placementRotationSteps = (state.placementRotationSteps + 1) % 4;
  }
  // Q/E in Select mode → rotate the selected transition
  if (state.activeTool === EditorTool.Select && state.selectedElements.length > 0 && state.roomData) {
    const selType = state.selectedElements[0]?.type;
    if (selType === 'transition') {
      if (inputState.isRotateRightPressed || inputState.isRotateLeftPressed) {
        pushSnapshot(history, state.roomData);
        rotateSelectedElement(state);
        applyEdits();
      }
    }
  }

  // F key → flip placement horizontally (Place mode) or flip selected transition (Select mode)
  if (inputState.isFlipPressed) {
    if (state.activeTool === EditorTool.Place) {
      state.placementFlipH = !state.placementFlipH;
    } else if (state.activeTool === EditorTool.Select && state.roomData &&
               state.selectedElements.length > 0 && state.selectedElements[0]?.type === 'transition') {
      pushSnapshot(history, state.roomData);
      flipSelectedTransition(state);
      applyEdits();
    }
  }

  // N key → world map list
  if (inputState.isMapToggled) {
    openWorldMap();
  }

  // M key → visual world map editor
  if (inputState.isVisualMapToggled) {
    openVisualMap();
  }

  // ESC → cancel transition linking or clear selection / rect brush
  if (inputState.isEscapePressed) {
    if (state.isLinkingTransition) {
      cancelTransitionLink(state);
    } else {
      state.selectedElements = [];
      state.brushRectStartBlockX = null;
      state.brushRectStartBlockY = null;
    }
  }

  // Undo (Ctrl+Z)
  if (inputState.isUndoPressed && state.roomData) {
    const restored = undo(history, state.roomData);
    if (restored) {
      state.roomData = restored;
      state.selectedElements = [];
      applyEdits();
    }
  }
  // Redo (Ctrl+Y)
  if (inputState.isRedoPressed && state.roomData) {
    const restored = redo(history, state.roomData);
    if (restored) {
      state.roomData = restored;
      state.selectedElements = [];
      applyEdits();
    }
  }

  // Copy (Ctrl+C)
  if (inputState.isCopyPressed && state.roomData && state.selectedElements.length > 0) {
    const clipData = serializeSelectedElements(state.roomData, state.selectedElements);
    state.clipboard = clipData;
  }

  // Paste (Ctrl+V)
  if (inputState.isPastePressed && state.roomData && state.clipboard) {
    pushSnapshot(history, state.roomData);
    pasteFromClipboard(state);
    applyEdits();
  }
}
