/**
 * Phase 2, Fix 2: layer panel combined state.
 *
 * A layer can simultaneously be the placement target, contain selected
 * elements, AND be restricted (locked/hidden). `computeLayerRowPresentation`
 * (editorUILayersPanel.ts) is the pure computation backing the panel's DOM
 * sync — tested directly here since it needs no DOM.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLayerRowPresentation } from '../editor/editorUILayersPanel';
import type { EditorLayerState } from '../editor/editorLayers';
import type { PlacementStatus } from '../editor/editorLayers';

function layer(overrides: Partial<EditorLayerState> = {}): EditorLayerState {
  return { visible: true, locked: false, solo: false, selectOnly: false, ...overrides };
}

function status(overrides: Partial<PlacementStatus> = {}): PlacementStatus {
  return { targetLayer: null, allowed: true, reason: null, ...overrides };
}

test('a plain, unremarkable layer has no marker', () => {
  const r = computeLayerRowPresentation('terrain', null, status(), layer(), false, 0);
  assert.equal(r.isTarget, false);
  assert.equal(r.markerText, '');
});

test('target-only layer shows just the target marker', () => {
  const r = computeLayerRowPresentation('terrain', 'terrain', status({ targetLayer: 'terrain' }), layer(), false, 0);
  assert.equal(r.isTarget, true);
  assert.equal(r.isRestrictedTarget, false);
  assert.equal(r.markerText, '▶ target');
});

test('selection-only layer shows just the selection marker', () => {
  const r = computeLayerRowPresentation('enemies', null, status(), layer(), true, 2);
  assert.equal(r.isTarget, false);
  assert.equal(r.markerText, '● sel (2)');
});

test('restricted (locked), non-target, non-selected layer shows just the lock marker', () => {
  const r = computeLayerRowPresentation('hazards', null, status(), layer({ locked: true }), false, 0);
  assert.equal(r.markerText, '🔒');
});

test('combined state: target AND contains selection AND restricted all render together', () => {
  const st = status({ targetLayer: 'terrain', allowed: false, reason: 'locked' });
  const r = computeLayerRowPresentation('terrain', 'terrain', st, layer({ locked: true }), true, 3);
  assert.equal(r.isTarget, true);
  assert.equal(r.isRestrictedTarget, true, 'target layer that is locked must be flagged restricted');
  assert.ok(r.markerText.includes('⛔ target'), `expected blocked-target marker, got: ${r.markerText}`);
  assert.ok(r.markerText.includes('● sel (3)'), `expected selection marker, got: ${r.markerText}`);
  // The target marker already communicates "blocked" — the panel does not
  // also render the generic lock glyph for the target row (that would be
  // redundant with "⛔ target"), so exactly two marker segments are expected.
  assert.equal(r.markerText.split('  ').length, 2);
  assert.ok(r.title.includes('blocked'));
  assert.ok(r.title.includes('selection'));
});

test('combined state: target AND selection, layer not restricted', () => {
  const st = status({ targetLayer: 'objects', allowed: true, reason: null });
  const r = computeLayerRowPresentation('objects', 'objects', st, layer(), true, 1);
  assert.equal(r.isRestrictedTarget, false);
  assert.ok(r.markerText.includes('▶ target'));
  assert.ok(r.markerText.includes('● sel'));
});

test('combined state: hidden layer that also contains selection shows both', () => {
  const r = computeLayerRowPresentation('lighting', null, status(), layer({ visible: false }), true, 1);
  assert.ok(r.markerText.includes('● sel'));
  assert.ok(r.markerText.includes('🚫'));
});

test('a restricted target reports the correct describePlacementBlockReason-derived title', () => {
  const st = status({ targetLayer: 'hazards', allowed: false, reason: 'hidden' });
  const r = computeLayerRowPresentation('hazards', 'hazards', st, layer({ visible: false }), false, 0);
  assert.ok(r.title.toLowerCase().includes('hidden'));
});
