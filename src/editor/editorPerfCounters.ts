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
  /** Number of times editorRoomDataToRoomDef() ran to rebuild the cached liveEditorRoomDef or in hidden conversion paths. */
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
  /** Number of times wall occupancy/ownership topology was rebuilt in the editor. */
  wallTopologyRebuilds: number;
  /** Number of cell candidates visited during wall seam/grid rendering. */
  wallTopologyCellsScanned: number;
  /** Total overlay elements iterated during editor overlay draw passes. */
  overlayElementsVisited: number;
  /** Total overlay elements that passed culling and were drawn in overlay draw passes. */
  overlayElementsDrawn: number;
  /** Number of times Surface Rim layout was rebuilt in the editor. */
  surfaceRimLayoutRebuilds: number;
  /** Number of times an idle hover hit-test actually scanned elements (not served from cache). */
  hoverScans: number;
}

export const editorPerfCounters: EditorPerfCounters = {
  roomDefConversions: 0,
  complexityAnalyses: 0,
  uiUpdates: 0,
  selectionCacheRebuilds: 0,
  dragDeltaNoops: 0,
  dragDeltaApplied: 0,
  wallTopologyRebuilds: 0,
  wallTopologyCellsScanned: 0,
  overlayElementsVisited: 0,
  overlayElementsDrawn: 0,
  surfaceRimLayoutRebuilds: 0,
  hoverScans: 0,
};

export function resetEditorPerfCounters(): void {
  editorPerfCounters.roomDefConversions = 0;
  editorPerfCounters.complexityAnalyses = 0;
  editorPerfCounters.uiUpdates = 0;
  editorPerfCounters.selectionCacheRebuilds = 0;
  editorPerfCounters.dragDeltaNoops = 0;
  editorPerfCounters.dragDeltaApplied = 0;
  editorPerfCounters.wallTopologyRebuilds = 0;
  editorPerfCounters.wallTopologyCellsScanned = 0;
  editorPerfCounters.overlayElementsVisited = 0;
  editorPerfCounters.overlayElementsDrawn = 0;
  editorPerfCounters.surfaceRimLayoutRebuilds = 0;
  editorPerfCounters.hoverScans = 0;
}
