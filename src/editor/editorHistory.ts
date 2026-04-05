/**
 * Editor undo/redo history system.
 * Stores snapshots of EditorRoomData for undo/redo operations.
 */

import type { EditorRoomData } from './editorState';

const MAX_HISTORY_SIZE = 50;

export interface EditorHistory {
  undoStack: string[];
  redoStack: string[];
}

export function createEditorHistory(): EditorHistory {
  return { undoStack: [], redoStack: [] };
}

export function pushSnapshot(history: EditorHistory, data: EditorRoomData): void {
  history.undoStack.push(JSON.stringify(data));
  if (history.undoStack.length > MAX_HISTORY_SIZE) {
    history.undoStack.shift();
  }
  // Any new action clears redo stack
  history.redoStack.length = 0;
}

export function undo(history: EditorHistory, currentData: EditorRoomData): EditorRoomData | null {
  if (history.undoStack.length === 0) return null;
  const snapshot = history.undoStack.pop()!;
  try {
    const restored = JSON.parse(snapshot) as EditorRoomData;
    // Save current state to redo stack only after successful parse
    history.redoStack.push(JSON.stringify(currentData));
    return restored;
  } catch {
    return null;
  }
}

export function redo(history: EditorHistory, currentData: EditorRoomData): EditorRoomData | null {
  if (history.redoStack.length === 0) return null;
  const snapshot = history.redoStack.pop()!;
  try {
    const restored = JSON.parse(snapshot) as EditorRoomData;
    // Save current state to undo stack only after successful parse
    history.undoStack.push(JSON.stringify(currentData));
    return restored;
  } catch {
    return null;
  }
}

export function clearHistory(history: EditorHistory): void {
  history.undoStack.length = 0;
  history.redoStack.length = 0;
}
