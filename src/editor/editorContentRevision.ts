/**
 * Room-content revision cadence + the revision-gated room-complexity gate.
 *
 * Two distinct notions are deliberately separated here:
 *
 *  - "a mutation happened" — cheap, per-block. Working data and the live
 *    preview must update on every painted block of a drag-paint stroke, and
 *    the campaign store must be marked dirty each time.
 *  - "an operation completed" — this is what bumps `roomContentRevision`,
 *    and therefore what invalidates expensive whole-room derived summaries
 *    (room-complexity analysis for the sidebar density readout).
 *
 * Before this split, every painted block of a drag-paint stroke went through
 * `applyEdits('placement')` and bumped the revision, so a 60-block stroke ran
 * 60 whole-room complexity analyses mid-gesture. Continuous strokes now defer
 * the bump: the stroke marks the revision dirty, and a single bump is flushed
 * on release. Discrete operations (click placement, drag-delete-on-release,
 * multi-select move, undo/redo, paste, fill, rect brush, room load) bump
 * exactly once per completed operation, as before.
 *
 * Both pieces live outside editorController.ts / editorUI.ts (which build real
 * DOM and are not unit-testable) so the cadence itself can be tested directly.
 */

import type { EditorRoomData } from './editorElementTypes';
import type { RoomComplexityReport } from '../levels/roomComplexity';
import { analyzeEditorRoomComplexity } from './editorRoomComplexity';
import { editorPerfCounters } from './editorPerfCounters';

// ── Revision cadence ───────────────────────────────────────────────────────

/** Minimal slice of EditorState the cadence helpers touch. */
export interface ContentRevisionHolder {
  roomContentRevision: number;
}

/** Per-editor deferral state for an in-progress continuous stroke. */
export interface StrokeRevisionState {
  /** A continuous stroke mutated content but has not bumped the revision yet. */
  pendingStrokeBump: boolean;
  /**
   * Bumped by EVERY mutation, continuous ones included — the cheap "content
   * changed at all" signal. Consumers whose derived value is cheap to rebuild
   * and must stay visually live mid-stroke (the editor backdrop room view)
   * key on this instead of `roomContentRevision`.
   */
  mutationSerial: number;
}

export function createStrokeRevisionState(): StrokeRevisionState {
  return { pendingStrokeBump: false, mutationSerial: 0 };
}

/**
 * Records that room content changed.
 *
 * @param continuous  True for a single step of an in-progress continuous
 *   stroke (drag-paint / drag-erase / pixel-material line). The revision bump
 *   is deferred to `flushStrokeRevision()` on release. False (default) for a
 *   completed discrete operation, which bumps immediately.
 */
export function noteContentMutation(
  holder: ContentRevisionHolder,
  stroke: StrokeRevisionState,
  continuous = false,
): void {
  stroke.mutationSerial++;
  if (continuous) {
    stroke.pendingStrokeBump = true;
    return;
  }
  // A discrete operation supersedes any deferred stroke bump — one bump total.
  stroke.pendingStrokeBump = false;
  holder.roomContentRevision++;
}

/**
 * Flushes a deferred stroke bump — call once when the pointer is released
 * (stroke complete). No-op when no stroke bump is pending, so calling it on
 * every idle frame is free.
 */
export function flushStrokeRevision(
  holder: ContentRevisionHolder,
  stroke: StrokeRevisionState,
): boolean {
  if (!stroke.pendingStrokeBump) return false;
  stroke.pendingStrokeBump = false;
  holder.roomContentRevision++;
  return true;
}

/**
 * Drops a pending stroke bump without applying it — used when the room is
 * being replaced or the editor closed, since those invalidate unconditionally.
 */
export function discardPendingStrokeRevision(stroke: StrokeRevisionState): void {
  stroke.pendingStrokeBump = false;
}

// ── Revision-gated complexity analysis ─────────────────────────────────────

export interface ComplexityGate {
  /**
   * Returns the room-complexity report, recomputing it only when the room id
   * or the content revision changed since the last analysis. Increments
   * `editorPerfCounters.complexityAnalyses` on an actual recompute.
   */
  resolve(room: EditorRoomData, roomId: string, revision: number): RoomComplexityReport;
  /** Forgets the cached report (room closed). */
  reset(): void;
}

export function createComplexityGate(
  analyze: (room: EditorRoomData) => RoomComplexityReport = analyzeEditorRoomComplexity,
): ComplexityGate {
  let report: RoomComplexityReport | null = null;
  let cachedRoomId = '';
  let cachedRevision = -1;
  return {
    resolve(room, roomId, revision) {
      if (report === null || roomId !== cachedRoomId || revision !== cachedRevision) {
        report = analyze(room);
        editorPerfCounters.complexityAnalyses++;
        cachedRoomId = roomId;
        cachedRevision = revision;
      }
      return report;
    },
    reset() {
      report = null;
      cachedRoomId = '';
      cachedRevision = -1;
    },
  };
}
