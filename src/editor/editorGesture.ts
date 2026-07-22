/**
 * Editor gesture-transaction helpers — the continuous-interaction counterpart
 * to the lazy pending-snapshot model in editorHistory.ts.
 *
 * A "gesture" is any interaction that spans multiple input frames before it
 * is known to be a real edit: drag-to-move, rectangle-handle resize, and
 * transition edge-resize. Unlike the discrete mutations `runLazyMutation`
 * covers (one click, one result), gestures need three lifecycle points:
 *
 *   - begin  — capture a pending snapshot (side-effect-free) and start live-
 *              mutating the room for preview. Undo/redo untouched.
 *   - finish — on normal release, commit the pending snapshot exactly once
 *              IF the gesture actually changed geometry; otherwise discard it
 *              with undo/redo left completely untouched.
 *   - cancel — on a disqualifying event mid-gesture (layer hidden/locked/
 *              solo-excluded, tool/room switch, editor close, Escape),
 *              restore the live room data to the pre-gesture geometry and
 *              discard the pending snapshot. No history/dirty commit.
 *
 * This module intentionally knows nothing about drag/resize specifics —
 * callers supply `hasChanged`/`restore` closures over their own original-
 * geometry bookkeeping (e.g. `dragOriginalPositions`, a captured rect, or
 * captured transition geometry).
 */

import type { EditorRoomData } from './editorState';
import type { CampaignSpawnData } from '../levels/campaignSchema';
import { capturePendingSnapshot, commitPendingSnapshot, type EditorHistory, type PendingSnapshot } from './editorHistory';

export interface EditorGestureTransaction {
  readonly pending: PendingSnapshot;
  /** Reports whether the gesture's live geometry currently differs from the
   *  pre-gesture original. Call-time, not a cached flag, so it always
   *  reflects the current (possibly reverted-to-origin) live state. */
  readonly hasChanged: () => boolean;
  /** Restores all geometry this gesture touched back to its pre-gesture
   *  values. Must be idempotent and side-effect-free on history/dirty state. */
  readonly restore: () => void;
}

/**
 * Begins a gesture: captures a pending snapshot (does NOT touch undo/redo)
 * and packages the caller's change-detection/rollback closures. Live
 * mutation during the gesture is the caller's responsibility (e.g.
 * `moveSelectedElements`, `Object.assign(rect, ...)`).
 */
export function beginGesture(
  data: EditorRoomData,
  hasChanged: () => boolean,
  restore: () => void,
  campaignSpawn?: CampaignSpawnData,
  initialRoomId?: string,
  campaignSpawnTracked?: boolean,
): EditorGestureTransaction {
  return {
    pending: capturePendingSnapshot(data, campaignSpawn, initialRoomId, campaignSpawnTracked),
    hasChanged,
    restore,
  };
}

/**
 * Normal-release finalisation: commits the pending snapshot exactly once if
 * the gesture's geometry actually changed, otherwise leaves undo/redo
 * completely untouched. Returns whether a commit happened, so the caller
 * knows whether to call `applyEdits()`.
 */
export function finishGesture(history: EditorHistory, gesture: EditorGestureTransaction): boolean {
  if (!gesture.hasChanged()) return false;
  commitPendingSnapshot(history, gesture.pending);
  return true;
}

/**
 * Cancellation path: restores live room data to the pre-gesture state and
 * discards the pending snapshot. No history/dirty/rebuild work — room data
 * is back to exactly what it was before the gesture began, so there is
 * nothing new to persist.
 */
export function rollbackGesture(gesture: EditorGestureTransaction): void {
  gesture.restore();
}
