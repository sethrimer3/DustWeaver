/**
 * Regression tests for the export-progress "stuck modal" bug: the renderer
 * removed the progress listener immediately after `exportCampaignWithProgress()`
 * resolved, and main sends the final 'complete' progress event shortly before
 * returning the IPC result — so if the invoke result arrived first, the
 * listener cleanup discarded the final event and the modal was stuck showing
 * the last 'exporting-room' state (observed as "room 19 / 20 — crimson_throne").
 *
 * `resolveExportOutcomeEvent()` (src/editor/editorExport.ts) is the pure
 * function that makes the resolved IPC result authoritative regardless of
 * event ordering. These tests exercise both orderings directly.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveExportOutcomeEvent } from '../editor/exportOutcome';

test('invoke result arrives before the final progress event: result drives completion', () => {
  const event = resolveExportOutcomeEvent(false, {
    ok: true,
    writtenRooms: 20,
    skippedRooms: 0,
    removedCount: 0,
  });

  assert.notEqual(event, null);
  assert.equal(event?.step, 'complete');
  assert.equal(event?.writtenRooms, 20);
  assert.equal(event?.skippedRooms, 0);
  assert.match(event?.message ?? '', /20 room\(s\) written/);
});

test('final progress event arrives before the invoke result: result is a no-op', () => {
  // The live 'complete' progress event already settled the modal.
  const event = resolveExportOutcomeEvent(true, {
    ok: true,
    writtenRooms: 20,
    skippedRooms: 0,
    removedCount: 0,
  });

  assert.equal(event, null, 'must not re-apply or duplicate the completion state');
});

test('failed export always exposes the error when no progress event settled it', () => {
  const event = resolveExportOutcomeEvent(false, {
    ok: false,
    error: 'disk full',
  });

  assert.notEqual(event, null);
  assert.equal(event?.step, 'error');
  assert.match(event?.message ?? '', /disk full/);
});

test('failed export is a no-op when the error progress event already settled it', () => {
  const event = resolveExportOutcomeEvent(true, {
    ok: false,
    error: 'disk full',
  });

  assert.equal(event, null);
});

test('successful export always reports a terminal event when nothing settled it first', () => {
  // Simulates a delayed/missed final progress event: no live 'complete' was
  // observed, so the resolved result alone must still complete the modal.
  const event = resolveExportOutcomeEvent(false, { ok: true, writtenRooms: 1, skippedRooms: 19, removedCount: 0 });
  assert.notEqual(event, null);
  assert.equal(event?.step, 'complete');
});

test('stale file removal is reflected in the completion message', () => {
  const event = resolveExportOutcomeEvent(false, {
    ok: true,
    writtenRooms: 2,
    skippedRooms: 18,
    removedCount: 3,
  });
  assert.match(event?.message ?? '', /3 stale file\(s\) removed/);
});
