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

/**
 * A snapshot that has been captured (cloned from current room data) but not
 * yet committed to the undo stack. Capturing is side-effect-free — it does
 * NOT touch undoStack/redoStack — so a caller that ends up discovering its
 * operation was a no-op can simply drop the `PendingSnapshot` on the floor
 * without any history/redo state ever having been disturbed. This replaces
 * the old "push then pop if no-op" pattern, which cleared the redo stack as
 * a side effect of pushSnapshot() and could NOT be undone by popping the
 * undo entry back off afterward.
 */
export interface PendingSnapshot {
  snapshot: HistorySnapshot;
}

function cloneSnapshot(
  data: EditorRoomData,
  campaignSpawn?: CampaignSpawnData,
  initialRoomId?: string,
  campaignSpawnTracked?: boolean,
): HistorySnapshot {
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
  return snapshot;
}

/**
 * Captures a snapshot of the current room (and, when tracked, campaign
 * spawn) state WITHOUT touching undoStack/redoStack. Call this immediately
 * before performing a mutation whose success is not yet known; if the
 * mutation turns out to be a no-op, simply discard the returned
 * PendingSnapshot — history is left completely untouched. If the mutation
 * did change something, pass it to `commitPendingSnapshot`.
 */
export function capturePendingSnapshot(
  data: EditorRoomData,
  campaignSpawn?: CampaignSpawnData,
  initialRoomId?: string,
  campaignSpawnTracked?: boolean,
): PendingSnapshot {
  return { snapshot: cloneSnapshot(data, campaignSpawn, initialRoomId, campaignSpawnTracked) };
}

/**
 * Commits a previously-captured PendingSnapshot: pushes it onto the undo
 * stack, trims to MAX_HISTORY_SIZE, and clears the redo stack. Only call
 * this once a mutation is known to have actually changed something.
 */
export function commitPendingSnapshot(history: EditorHistory, pending: PendingSnapshot): void {
  history.undoStack.push(pending.snapshot);
  if (history.undoStack.length > MAX_HISTORY_SIZE) {
    history.undoStack.shift();
  }
  // Any new action clears redo stack
  history.redoStack.length = 0;
}

export function pushSnapshot(
  history: EditorHistory,
  data: EditorRoomData,
  campaignSpawn?: CampaignSpawnData,
  initialRoomId?: string,
  campaignSpawnTracked?: boolean,
): void {
  commitPendingSnapshot(history, capturePendingSnapshot(data, campaignSpawn, initialRoomId, campaignSpawnTracked));
}

/**
 * Runs a mutation that may or may not actually change anything, capturing
 * history lazily: the pre-mutation snapshot is captured up front (it has to
 * be, since `mutate` may mutate `data` in place), but it is only committed
 * to the undo stack (and the redo stack only cleared) if `mutate` reports a
 * real change. A no-op `mutate` — including one that throws — leaves
 * undoStack/redoStack completely unchanged; the try/finally ensures a
 * thrown exception can never leave history half-updated (e.g. redo cleared
 * but no undo entry recorded, or vice versa).
 */
export function runLazyMutation(
  history: EditorHistory,
  data: EditorRoomData,
  mutate: () => boolean,
  campaignSpawn?: CampaignSpawnData,
  initialRoomId?: string,
  campaignSpawnTracked?: boolean,
): boolean {
  const pending = capturePendingSnapshot(data, campaignSpawn, initialRoomId, campaignSpawnTracked);
  let changed = false;
  try {
    changed = mutate();
    return changed;
  } finally {
    if (changed) {
      commitPendingSnapshot(history, pending);
    }
  }
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
