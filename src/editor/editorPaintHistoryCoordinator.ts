import type { CampaignSpawnData } from '../levels/campaignSchema';
import type { EditorRoomData } from './editorState';
import {
  capturePendingSnapshot,
  commitPendingSnapshot,
  type CampaignSpawnHistoryState,
  type EditorHistory,
  type HistoryCommitResult,
  type PendingSnapshot,
} from './editorHistory';

export interface PaintHistoryTransaction {
  readonly pending: PendingSnapshot;
  readonly tracksCampaignSpawn: boolean;
}

export function beginPaintTransaction(
  room: EditorRoomData,
  campaignSpawn?: CampaignSpawnData,
  initialRoomId?: string,
  tracksCampaignSpawn = false,
): PaintHistoryTransaction {
  return {
    pending: capturePendingSnapshot(
      room, campaignSpawn, initialRoomId, tracksCampaignSpawn, 'Paint stroke',
    ),
    tracksCampaignSpawn,
  };
}

export function finishPaintTransaction(
  history: EditorHistory,
  transaction: PaintHistoryTransaction,
  campaignSpawnAfter?: CampaignSpawnData,
  initialRoomIdAfter?: string,
): HistoryCommitResult {
  return commitPendingSnapshot(
    history, transaction.pending, campaignSpawnAfter, initialRoomIdAfter,
  );
}

export function cancelPaintTransaction(transaction: PaintHistoryTransaction): {
  room: EditorRoomData;
  campaign?: CampaignSpawnHistoryState;
} {
  return {
    room: structuredClone(transaction.pending.before) as EditorRoomData,
    campaign: transaction.pending.campaignSpawnBefore === undefined
      ? undefined
      : structuredClone(transaction.pending.campaignSpawnBefore),
  };
}
