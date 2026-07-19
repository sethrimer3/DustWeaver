/**
 * Editor undo/redo history system.
 * Stores snapshots of EditorRoomData (and, when relevant, campaign-spawn
 * metadata) for undo/redo operations.
 */

import type { EditorRoomData } from './editorState';
import type { CampaignSpawnData } from '../levels/campaignSchema';

const MAX_HISTORY_SIZE = 50;

/**
 * A single undo/redo snapshot. `campaignSpawn`/`initialRoomId` are only
 * populated when the mutation being snapshotted could affect campaign-spawn
 * placement; callers that don't touch campaign spawn state may omit them,
 * in which case undo/redo leaves the current campaign spawn untouched.
 */
export interface HistorySnapshot {
  roomData: EditorRoomData;
  /** Present only for snapshots that touch campaign spawn state. */
  campaignSpawn?: CampaignSpawnData;
  initialRoomId?: string;
  /** Distinguishes "no campaign spawn" (undefined campaignSpawn + tracked) from "untracked". */
  campaignSpawnTracked?: boolean;
}

export interface EditorHistory {
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];
}

export function createEditorHistory(): EditorHistory {
  return { undoStack: [], redoStack: [] };
}

export function pushSnapshot(
  history: EditorHistory,
  data: EditorRoomData,
  campaignSpawn?: CampaignSpawnData,
  initialRoomId?: string,
  campaignSpawnTracked?: boolean,
): void {
  const t0 = import.meta.env?.DEV ? performance.now() : 0;
  const snapshot: HistorySnapshot = {
    roomData: structuredClone(data) as EditorRoomData,
  };
  if (campaignSpawnTracked) {
    snapshot.campaignSpawnTracked = true;
    snapshot.campaignSpawn = campaignSpawn !== undefined
      ? (structuredClone(campaignSpawn) as CampaignSpawnData)
      : undefined;
    snapshot.initialRoomId = initialRoomId;
  }
  history.undoStack.push(snapshot);
  if (import.meta.env?.DEV) {
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

function cloneCurrent(
  currentData: EditorRoomData,
  currentCampaignSpawn: CampaignSpawnData | undefined,
  currentInitialRoomId: string | undefined,
  currentCampaignSpawnTracked: boolean | undefined,
): HistorySnapshot {
  const snapshot: HistorySnapshot = { roomData: structuredClone(currentData) as EditorRoomData };
  if (currentCampaignSpawnTracked) {
    snapshot.campaignSpawnTracked = true;
    snapshot.campaignSpawn = currentCampaignSpawn !== undefined
      ? (structuredClone(currentCampaignSpawn) as CampaignSpawnData)
      : undefined;
    snapshot.initialRoomId = currentInitialRoomId;
  }
  return snapshot;
}

function materialize(snapshot: HistorySnapshot): HistorySnapshot {
  return {
    roomData: structuredClone(snapshot.roomData) as EditorRoomData,
    campaignSpawnTracked: snapshot.campaignSpawnTracked,
    campaignSpawn: snapshot.campaignSpawn !== undefined
      ? (structuredClone(snapshot.campaignSpawn) as CampaignSpawnData)
      : undefined,
    initialRoomId: snapshot.initialRoomId,
  };
}

export function undo(
  history: EditorHistory,
  currentData: EditorRoomData,
  currentCampaignSpawn?: CampaignSpawnData,
  currentInitialRoomId?: string,
  currentCampaignSpawnTracked?: boolean,
): HistorySnapshot | null {
  if (history.undoStack.length === 0) return null;
  const snapshot = history.undoStack.pop();
  if (snapshot === undefined) return null;
  history.redoStack.push(cloneCurrent(currentData, currentCampaignSpawn, currentInitialRoomId, currentCampaignSpawnTracked));
  return materialize(snapshot);
}

export function redo(
  history: EditorHistory,
  currentData: EditorRoomData,
  currentCampaignSpawn?: CampaignSpawnData,
  currentInitialRoomId?: string,
  currentCampaignSpawnTracked?: boolean,
): HistorySnapshot | null {
  if (history.redoStack.length === 0) return null;
  const snapshot = history.redoStack.pop();
  if (snapshot === undefined) return null;
  history.undoStack.push(cloneCurrent(currentData, currentCampaignSpawn, currentInitialRoomId, currentCampaignSpawnTracked));
  return materialize(snapshot);
}

export function clearHistory(history: EditorHistory): void {
  history.undoStack.length = 0;
  history.redoStack.length = 0;
}
