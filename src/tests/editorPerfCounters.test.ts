import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEditorState } from '../editor/editorState';
import { editorPerfCounters, resetEditorPerfCounters } from '../editor/editorPerfCounters';

// ── editorPerfCounters: plain DEV instrumentation, no production behavior ──

test('editorPerfCounters: resetEditorPerfCounters zeroes every counter', () => {
  editorPerfCounters.roomDefConversions = 3;
  editorPerfCounters.complexityAnalyses = 5;
  editorPerfCounters.uiUpdates = 7;
  editorPerfCounters.selectionCacheRebuilds = 2;
  editorPerfCounters.dragDeltaNoops = 9;
  editorPerfCounters.dragDeltaApplied = 1;
  editorPerfCounters.wallTopologyRebuilds = 4;
  editorPerfCounters.wallTopologyCellsScanned = 100;
  editorPerfCounters.overlayElementsVisited = 50;
  editorPerfCounters.overlayElementsDrawn = 20;
  editorPerfCounters.surfaceRimLayoutRebuilds = 3;
  editorPerfCounters.hoverScans = 4;
  resetEditorPerfCounters();
  assert.deepEqual(editorPerfCounters, {
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
  });
});

// ── roomContentRevision: fresh state starts at 0, and is the mechanism
// applyEdits()/loadRoomForEditing() use to invalidate revision-gated caches
// (see editorUI.ts's lastComplexityRevision cache). ──────────────────────

test('createEditorState: roomContentRevision starts at 0', () => {
  const state = createEditorState();
  assert.equal(state.roomContentRevision, 0);
});

// ── Mirrors the cache-gate condition in editorUI.ts's update(): a cached
// complexity report is reused unless the room id or roomContentRevision
// changed. This is a logic-level regression guard (editorUI.ts itself
// builds real DOM and isn't unit-testable without a DOM environment); it
// pins the exact semantics so a future edit to that gate is deliberate. ──

interface ComplexityCache {
  roomId: string;
  revision: number;
  report: { totalPlacedCount: number } | null;
}

function resolveComplexityReport(
  cache: ComplexityCache,
  roomId: string,
  revision: number,
  compute: () => { totalPlacedCount: number },
): { totalPlacedCount: number } {
  if (cache.report === null || roomId !== cache.roomId || revision !== cache.revision) {
    cache.report = compute();
    cache.roomId = roomId;
    cache.revision = revision;
  }
  return cache.report;
}

test('complexity cache gate: unchanged (roomId, revision) reuses cached report (no recompute)', () => {
  const cache: ComplexityCache = { roomId: '', revision: -1, report: null };
  let computeCount = 0;
  const compute = () => { computeCount++; return { totalPlacedCount: 42 }; };

  resolveComplexityReport(cache, 'room-a', 0, compute);
  resolveComplexityReport(cache, 'room-a', 0, compute);
  resolveComplexityReport(cache, 'room-a', 0, compute);

  assert.equal(computeCount, 1, 'idle frames with no revision change must not recompute');
});

test('complexity cache gate: a bumped revision (completed edit) forces recompute', () => {
  const cache: ComplexityCache = { roomId: '', revision: -1, report: null };
  let computeCount = 0;
  const compute = () => { computeCount++; return { totalPlacedCount: computeCount }; };

  resolveComplexityReport(cache, 'room-a', 0, compute);
  resolveComplexityReport(cache, 'room-a', 1, compute); // one placement completed
  resolveComplexityReport(cache, 'room-a', 1, compute); // idle again
  resolveComplexityReport(cache, 'room-a', 2, compute); // another completed edit

  assert.equal(computeCount, 3);
});

test('complexity cache gate: switching rooms forces recompute even at the same revision counter value', () => {
  const cache: ComplexityCache = { roomId: '', revision: -1, report: null };
  let computeCount = 0;
  const compute = () => { computeCount++; return { totalPlacedCount: computeCount }; };

  resolveComplexityReport(cache, 'room-a', 5, compute);
  resolveComplexityReport(cache, 'room-b', 5, compute); // different room, same numeric revision
  assert.equal(computeCount, 2);
});
