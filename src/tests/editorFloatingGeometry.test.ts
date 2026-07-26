import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampFloatingPanelPosition, clampAllFloatingPanels,
  isPointInRect, isPointInAnyRect,
  FLOATING_PANEL_WIDTH_CSS_PX, FLOATING_PANEL_HEADER_HEIGHT_CSS_PX,
  type EditorUIRect,
} from '../editor/editorFloatingGeometry';
import { defaultPanelLayout, floatPanel } from '../editor/editorPanelLayout';

const VIEWPORT_W = 1400;
const VIEWPORT_H = 900;

// ── Clamping: the reachability guarantee ────────────────────────────────────

test('a position already fully inside the viewport is left untouched', () => {
  const p = clampFloatingPanelPosition(300, 200, VIEWPORT_W, VIEWPORT_H);
  assert.deepEqual(p, { xPx: 300, yPx: 200 });
});

test('negative coordinates clamp to the top-left corner so the grip stays reachable', () => {
  assert.deepEqual(clampFloatingPanelPosition(-500, -500, VIEWPORT_W, VIEWPORT_H), { xPx: 0, yPx: 0 });
});

test('a panel dragged past the right edge keeps its full width on-screen', () => {
  const p = clampFloatingPanelPosition(99999, 100, VIEWPORT_W, VIEWPORT_H);
  assert.equal(p.xPx, VIEWPORT_W - FLOATING_PANEL_WIDTH_CSS_PX);
  assert.equal(p.xPx + FLOATING_PANEL_WIDTH_CSS_PX, VIEWPORT_W);
});

test('a panel dragged past the bottom edge keeps its entire header on-screen', () => {
  const p = clampFloatingPanelPosition(100, 99999, VIEWPORT_W, VIEWPORT_H);
  assert.equal(p.yPx, VIEWPORT_H - FLOATING_PANEL_HEADER_HEIGHT_CSS_PX);
  // The complete header band is within the viewport.
  assert.ok(p.yPx + FLOATING_PANEL_HEADER_HEIGHT_CSS_PX <= VIEWPORT_H);
});

test('a viewport narrower than the panel pins x to 0 rather than going negative', () => {
  const narrow = FLOATING_PANEL_WIDTH_CSS_PX - 80;
  const p = clampFloatingPanelPosition(50, 10, narrow, VIEWPORT_H);
  assert.equal(p.xPx, 0, 'grip must not be pushed off the left edge');
});

test('a viewport shorter than the header pins y to 0', () => {
  const p = clampFloatingPanelPosition(10, 50, VIEWPORT_W, FLOATING_PANEL_HEADER_HEIGHT_CSS_PX - 10);
  assert.equal(p.yPx, 0);
});

test('non-finite inputs and degenerate viewports never produce NaN', () => {
  for (const [x, y, w, h] of [
    [NaN, NaN, VIEWPORT_W, VIEWPORT_H],
    [Infinity, -Infinity, VIEWPORT_W, VIEWPORT_H],
    [10, 10, NaN, NaN],
    [10, 10, 0, 0],
    [10, 10, -100, -100],
  ] as const) {
    const p = clampFloatingPanelPosition(x, y, w, h);
    assert.ok(Number.isFinite(p.xPx) && Number.isFinite(p.yPx), `${x},${y},${w},${h}`);
    assert.ok(p.xPx >= 0 && p.yPx >= 0);
  }
});

// ── Whole-layout re-clamping (restore + window resize) ──────────────────────

test('shrinking the viewport pulls every stranded floating header back into view', () => {
  let layout = defaultPanelLayout();
  layout = floatPanel(layout, 'tools', 1300, 850);
  layout = floatPanel(layout, 'palette', 40, 40);

  const result = clampAllFloatingPanels(layout, 800, 600);
  assert.equal(result.changed, true);
  const tools = result.layout.floating.tools!;
  assert.ok(tools.xPx + FLOATING_PANEL_WIDTH_CSS_PX <= 800);
  assert.ok(tools.yPx + FLOATING_PANEL_HEADER_HEIGHT_CSS_PX <= 600);
  // An already-safe panel is not moved.
  assert.deepEqual(
    { xPx: result.layout.floating.palette!.xPx, yPx: result.layout.floating.palette!.yPx },
    { xPx: 40, yPx: 40 },
  );
});

test('re-clamping preserves stacking order and sidebar contents', () => {
  let layout = defaultPanelLayout();
  layout = floatPanel(layout, 'tools', 5000, 5000);
  layout = floatPanel(layout, 'palette', 5000, 5000);
  const result = clampAllFloatingPanels(layout, 800, 600);
  assert.equal(result.layout.floating.tools!.z, layout.floating.tools!.z);
  assert.equal(result.layout.floating.palette!.z, layout.floating.palette!.z);
  assert.deepEqual(result.layout.left, layout.left);
  assert.deepEqual(result.layout.right, layout.right);
});

test('clampAllFloatingPanels returns the original object when nothing moved', () => {
  const layout = floatPanel(defaultPanelLayout(), 'tools', 100, 100);
  const result = clampAllFloatingPanels(layout, VIEWPORT_W, VIEWPORT_H);
  assert.equal(result.changed, false);
  assert.equal(result.layout, layout, 'same reference, so callers can skip a redundant persist');
});

test('a layout with no floating panels is a no-op', () => {
  const layout = defaultPanelLayout();
  const result = clampAllFloatingPanels(layout, 100, 100);
  assert.equal(result.changed, false);
  assert.equal(result.layout, layout);
});

// ── Rectangle hit testing ───────────────────────────────────────────────────

const RECT: EditorUIRect = { xPx: 100, yPx: 200, widthPx: 260, heightPx: 400 };

test('isPointInRect covers interior, edges, and exterior', () => {
  assert.equal(isPointInRect(200, 300, RECT), true, 'interior');
  assert.equal(isPointInRect(100, 200, RECT), true, 'top-left corner');
  assert.equal(isPointInRect(360, 600, RECT), true, 'bottom-right corner');
  assert.equal(isPointInRect(99, 300, RECT), false, 'just left');
  assert.equal(isPointInRect(361, 300, RECT), false, 'just right');
  assert.equal(isPointInRect(200, 199, RECT), false, 'just above');
  assert.equal(isPointInRect(200, 601, RECT), false, 'just below');
});

test('isPointInAnyRect is false for an empty list and true for any member', () => {
  assert.equal(isPointInAnyRect(200, 300, []), false);
  const rects: EditorUIRect[] = [RECT, { xPx: 700, yPx: 50, widthPx: 260, heightPx: 100 }];
  assert.equal(isPointInAnyRect(200, 300, rects), true);
  assert.equal(isPointInAnyRect(800, 100, rects), true);
  assert.equal(isPointInAnyRect(500, 700, rects), false);
});
