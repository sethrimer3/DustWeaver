/**
 * Editor undo/redo history system.
 * Stores snapshots of EditorRoomData for undo/redo operations.
 */

import type { EditorRoomData } from './editorState';

const MAX_HISTORY_SIZE = 50;

export interface EditorHistory {
  undoStack: EditorRoomData[];
  redoStack: EditorRoomData[];
}

export function createEditorHistory(): EditorHistory {
  return { undoStack: [], redoStack: [] };
}

export function pushSnapshot(history: EditorHistory, data: EditorRoomData): void {
  const t0 = import.meta.env.DEV ? performance.now() : 0;
  history.undoStack.push(structuredClone(data) as EditorRoomData);
  if (import.meta.env.DEV) {
    const elapsedMs = performance.now() - t0;
    const wallCount = data.interiorWalls.length;
    if (elapsedMs > 50) {
      console.error(`[editor-perf] ⛔ pushSnapshot: ${elapsedMs.toFixed(2)}ms (>50ms blocking!) walls=${wallCount} strategy=structuredClone`);
    } else if (elapsedMs > 16) {
      console.warn(`[editor-perf] ⚠️ pushSnapshot: ${elapsedMs.toFixed(2)}ms (>16ms slow) walls=${wallCount} strategy=structuredClone`);
    } else {
      console.log(`[editor-perf] pushSnapshot: ${elapsedMs.toFixed(2)}ms walls=${wallCount} strategy=structuredClone`);
    }
  }
  if (history.undoStack.length > MAX_HISTORY_SIZE) {
    history.undoStack.shift();
  }
  // Any new action clears redo stack
  history.redoStack.length = 0;
}

export function undo(history: EditorHistory, currentData: EditorRoomData): EditorRoomData | null {
  if (history.undoStack.length === 0) return null;
  const snapshot = history.undoStack.pop();
  if (snapshot === undefined) return null;
  history.redoStack.push(structuredClone(currentData) as EditorRoomData);
  return structuredClone(snapshot) as EditorRoomData;
}

export function redo(history: EditorHistory, currentData: EditorRoomData): EditorRoomData | null {
  if (history.redoStack.length === 0) return null;
  const snapshot = history.redoStack.pop();
  if (snapshot === undefined) return null;
  history.undoStack.push(structuredClone(currentData) as EditorRoomData);
  return structuredClone(snapshot) as EditorRoomData;
}

export function clearHistory(history: EditorHistory): void {
  history.undoStack.length = 0;
  history.redoStack.length = 0;
}
