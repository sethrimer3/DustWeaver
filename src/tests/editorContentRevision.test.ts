/**
 * Item C regression guards: room-complexity analysis cadence.
 *
 * A completed drag-paint stroke must bump `roomContentRevision` exactly once
 * (on release), not once per painted block — so the sidebar's revision-gated
 * whole-room complexity analysis runs once per stroke, not once per block.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStrokeRevisionState, noteContentMutation, flushStrokeRevision,
  discardPendingStrokeRevision, createComplexityGate,
  type ContentRevisionHolder,
} from '../editor/editorContentRevision';
import { editorPerfCounters, resetEditorPerfCounters } from '../editor/editorPerfCounters';
import type { EditorRoomData } from '../editor/editorElementTypes';

// The gate never inspects the room when it's served from cache, and the
// injected analyzer below never reads it either — a stub id-holder is enough.
const ROOM = { id: 'room-a' } as unknown as EditorRoomData;
const REPORT = { totalPlacedCount: 0 } as never;

function harness() {
  const holder: ContentRevisionHolder = { roomContentRevision: 0 };
  const stroke = createStrokeRevisionState();
  let analyses = 0;
  const gate = createComplexityGate(() => { analyses++; return REPORT; });
  /** One editor frame: the sidebar's update() pass consults the gate. */
  const uiFrame = (roomId = 'room-a') => gate.resolve(ROOM, roomId, holder.roomContentRevision);
  return { holder, stroke, gate, uiFrame, analyses: () => analyses };
}

test('drag-paint stroke: 40 painted blocks produce exactly ONE complexity analysis', () => {
  const h = harness();
  h.uiFrame();                    // baseline analysis before the stroke
  resetEditorPerfCounters();
  const baselineAnalyses = h.analyses();

  // Stroke: each painted block mutates content (continuous) and the editor
  // renders a frame; the revision must not move mid-stroke.
  const revisionAtStrokeStart = h.holder.roomContentRevision;
  for (let block = 0; block < 40; block++) {
    noteContentMutation(h.holder, h.stroke, true);
    h.uiFrame();
  }
  assert.equal(
    h.holder.roomContentRevision, revisionAtStrokeStart,
    'revision must not advance mid-stroke',
  );
  assert.equal(editorPerfCounters.complexityAnalyses, 0, 'zero analyses during the stroke');

  // Release: single flush, then the next frame re-analyses once.
  assert.equal(flushStrokeRevision(h.holder, h.stroke), true);
  h.uiFrame();
  h.uiFrame();  // idle frames after release must not re-analyse
  h.uiFrame();

  assert.equal(h.holder.roomContentRevision, revisionAtStrokeStart + 1);
  assert.equal(
    editorPerfCounters.complexityAnalyses, 1,
    'exactly one analysis for the whole stroke, not one per block',
  );
  assert.equal(h.analyses() - baselineAnalyses, 1);
});

test('flushStrokeRevision is a no-op when no stroke bump is pending', () => {
  const h = harness();
  assert.equal(flushStrokeRevision(h.holder, h.stroke), false);
  assert.equal(h.holder.roomContentRevision, 0);
  // Called on every idle frame in the controller — must stay free.
  for (let i = 0; i < 100; i++) flushStrokeRevision(h.holder, h.stroke);
  assert.equal(h.holder.roomContentRevision, 0);
});

test('discrete operations each bump exactly once per completed operation', () => {
  const h = harness();
  // click placement, drag-delete, multi-select move, undo, redo, paste, fill, rect
  for (let i = 0; i < 8; i++) noteContentMutation(h.holder, h.stroke);
  assert.equal(h.holder.roomContentRevision, 8);

  resetEditorPerfCounters();
  h.uiFrame();
  h.uiFrame();
  assert.equal(editorPerfCounters.complexityAnalyses, 1, 'idle frames reuse the cached report');
});

test('a discrete operation on stroke release supersedes the deferred bump (no double bump)', () => {
  const h = harness();
  for (let i = 0; i < 12; i++) noteContentMutation(h.holder, h.stroke, true);
  assert.equal(h.holder.roomContentRevision, 0);

  // On release the controller commits the paint snapshot, which calls
  // applyEdits('placement') discretely; the later flush must then be a no-op.
  noteContentMutation(h.holder, h.stroke);
  assert.equal(flushStrokeRevision(h.holder, h.stroke), false);
  assert.equal(h.holder.roomContentRevision, 1, 'one bump total for the whole stroke');
});

test('room load invalidates once and discards a deferred bump from the outgoing room', () => {
  const h = harness();
  noteContentMutation(h.holder, h.stroke, true);
  noteContentMutation(h.holder, h.stroke);   // loadRoomForEditing()
  assert.equal(h.holder.roomContentRevision, 1);
  assert.equal(flushStrokeRevision(h.holder, h.stroke), false);
  assert.equal(h.holder.roomContentRevision, 1);
});

test('editor close discards a deferred bump without applying it', () => {
  const h = harness();
  noteContentMutation(h.holder, h.stroke, true);
  discardPendingStrokeRevision(h.stroke);
  assert.equal(flushStrokeRevision(h.holder, h.stroke), false);
  assert.equal(h.holder.roomContentRevision, 0);
});

test('complexity gate: switching rooms re-analyses even at the same revision', () => {
  const h = harness();
  resetEditorPerfCounters();
  h.uiFrame('room-a');
  h.uiFrame('room-b');
  h.uiFrame('room-b');
  assert.equal(editorPerfCounters.complexityAnalyses, 2);
});

test('complexity gate: reset() forces the next resolve to re-analyse', () => {
  const h = harness();
  resetEditorPerfCounters();
  h.uiFrame();
  h.gate.reset();
  h.uiFrame();
  assert.equal(editorPerfCounters.complexityAnalyses, 2);
});
