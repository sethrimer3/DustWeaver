/**
 * DEV-only counters for editor hot-path work. These exist purely to let us
 * (and tests) verify that ordinary editing does not repeatedly do expensive
 * whole-room work — full EditorRoomData -> RoomDef conversion, room-
 * complexity analysis, etc. They are plain in-memory counters with no
 * production behavior impact; call sites increment them only, and only from
 * paths already gated by `import.meta.env.DEV` in the caller (or directly,
 * since incrementing a counter is cheap enough to leave unconditional here —
 * see individual call sites for why each one is safe to leave ungated).
 *
 * Read via editorPerfCounters, reset via resetEditorPerfCounters() (tests
 * call this between cases so counts don't leak across assertions).
 */
export interface EditorPerfCounters {
  /** Number of times editorRoomDataToRoomDef() ran to rebuild the cached liveEditorRoomDef. */
  roomDefConversions: number;
  /** Number of times analyzeEditorRoomComplexity() actually ran (not served from cache). */
  complexityAnalyses: number;
  /** Number of times the editor UI sidebar ran its full update() pass. */
  uiUpdates: number;
  /** Number of times selection-key cache was rebuilt (selection changed). */
  selectionCacheRebuilds: number;
  /** Number of drag-move frames where the snapped delta was unchanged from the previous frame (skipped). */
  dragDeltaNoops: number;
  /** Number of drag-move frames that actually applied a movement. */
  dragDeltaApplied: number;
}

export const editorPerfCounters: EditorPerfCounters = {
  roomDefConversions: 0,
  complexityAnalyses: 0,
  uiUpdates: 0,
  selectionCacheRebuilds: 0,
  dragDeltaNoops: 0,
  dragDeltaApplied: 0,
};

export function resetEditorPerfCounters(): void {
  editorPerfCounters.roomDefConversions = 0;
  editorPerfCounters.complexityAnalyses = 0;
  editorPerfCounters.uiUpdates = 0;
  editorPerfCounters.selectionCacheRebuilds = 0;
  editorPerfCounters.dragDeltaNoops = 0;
  editorPerfCounters.dragDeltaApplied = 0;
}
