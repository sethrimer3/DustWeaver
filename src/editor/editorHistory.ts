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
  // Save current state to redo stack
  history.redoStack.push(JSON.stringify(currentData));
  const snapshot = history.undoStack.pop()!;
  return JSON.parse(snapshot) as EditorRoomData;
}

export function redo(history: EditorHistory, currentData: EditorRoomData): EditorRoomData | null {
  if (history.redoStack.length === 0) return null;
  // Save current state to undo stack
  history.undoStack.push(JSON.stringify(currentData));
  const snapshot = history.redoStack.pop()!;
  return JSON.parse(snapshot) as EditorRoomData;
}

export function clearHistory(history: EditorHistory): void {
  history.undoStack.length = 0;
  history.redoStack.length = 0;
}
