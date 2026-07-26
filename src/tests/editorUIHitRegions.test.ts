import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPointOverEditorUI,
  isPointOverEditorCanvas,
  EDITOR_SIDEBAR_WIDTH_CSS_PX,
  EDITOR_REVEAL_TAB_WIDTH_CSS_PX,
  type EditorUIHitRegionParams,
  type EditorUIRect,
} from '../editor/editorUIHitRegions';

const VIEWPORT_WIDTH = 1200;
/**
 * Sidebars and reveal tabs span the full viewport height, so every
 * sidebar-only assertion below is Y-independent; this is just an arbitrary
 * mid-viewport Y. Floating-panel coverage (which IS Y-dependent) lives in the
 * dedicated section at the end of this file.
 */
const MID_Y = 400;

function params(overrides: Partial<EditorUIHitRegionParams> = {}): EditorUIHitRegionParams {
  return {
    viewportWidthPx: VIEWPORT_WIDTH,
    isLeftSidebarVisible: true,
    isRightSidebarVisible: true,
    ...overrides,
  };
}

test('both sidebars visible: left region, right region, and the middle canvas gap', () => {
  const p = params();
  assert.equal(isPointOverEditorUI(0, MID_Y, p), true);
  assert.equal(isPointOverEditorUI(EDITOR_SIDEBAR_WIDTH_CSS_PX, MID_Y, p), true);
  assert.equal(isPointOverEditorUI(EDITOR_SIDEBAR_WIDTH_CSS_PX + 1, MID_Y, p), false);
  assert.equal(isPointOverEditorUI(VIEWPORT_WIDTH - EDITOR_SIDEBAR_WIDTH_CSS_PX - 1, MID_Y, p), false);
  assert.equal(isPointOverEditorUI(VIEWPORT_WIDTH - EDITOR_SIDEBAR_WIDTH_CSS_PX, MID_Y, p), true);
  assert.equal(isPointOverEditorUI(VIEWPORT_WIDTH, MID_Y, p), true);
});

test('left hidden, right visible: old left 260px region is now canvas, minus the reveal tab', () => {
  const p = params({ isLeftSidebarVisible: false });
  // Just inside the reveal tab -> still UI.
  assert.equal(isPointOverEditorUI(EDITOR_REVEAL_TAB_WIDTH_CSS_PX - 1, MID_Y, p), true);
  // Just outside the reveal tab, still well within the old 260px sidebar region -> now canvas.
  assert.equal(isPointOverEditorUI(EDITOR_REVEAL_TAB_WIDTH_CSS_PX + 1, MID_Y, p), false);
  assert.equal(isPointOverCanvasCheck(EDITOR_SIDEBAR_WIDTH_CSS_PX - 1, p), true);
  // Right sidebar unaffected.
  assert.equal(isPointOverEditorUI(VIEWPORT_WIDTH - 1, MID_Y, p), true);
});

test('right hidden, left visible: old right 260px region is now canvas, minus the reveal tab', () => {
  const p = params({ isRightSidebarVisible: false });
  const rightRevealStart = VIEWPORT_WIDTH - EDITOR_REVEAL_TAB_WIDTH_CSS_PX;
  assert.equal(isPointOverEditorUI(rightRevealStart, MID_Y, p), true);
  assert.equal(isPointOverEditorUI(rightRevealStart - 1, MID_Y, p), false);
  // Left sidebar unaffected.
  assert.equal(isPointOverEditorUI(0, MID_Y, p), true);
});

test('both sidebars hidden: only the two small reveal tabs are UI, everything else is canvas', () => {
  const p = params({ isLeftSidebarVisible: false, isRightSidebarVisible: false });
  assert.equal(isPointOverEditorUI(0, MID_Y, p), true);
  assert.equal(isPointOverEditorUI(EDITOR_REVEAL_TAB_WIDTH_CSS_PX + 1, MID_Y, p), false);
  assert.equal(isPointOverEditorUI(VIEWPORT_WIDTH - EDITOR_REVEAL_TAB_WIDTH_CSS_PX, MID_Y, p), true);
  assert.equal(isPointOverEditorUI(VIEWPORT_WIDTH - EDITOR_REVEAL_TAB_WIDTH_CSS_PX - 1, MID_Y, p), false);
  // Middle of the viewport is canvas either way.
  assert.equal(isPointOverEditorUI(VIEWPORT_WIDTH / 2, MID_Y, p), false);
});

test('isPointOverEditorCanvas is the exact negation of isPointOverEditorUI', () => {
  const p = params({ isLeftSidebarVisible: false, isRightSidebarVisible: true });
  for (const x of [0, 10, 21, 22, 23, 500, VIEWPORT_WIDTH - 300, VIEWPORT_WIDTH]) {
    assert.equal(isPointOverEditorCanvas(x, MID_Y, p), !isPointOverEditorUI(x, MID_Y, p));
  }
});

function isPointOverCanvasCheck(x: number, p: EditorUIHitRegionParams): boolean {
  return isPointOverEditorCanvas(x, MID_Y, p);
}

// ── Floating panel windows ──────────────────────────────────────────────────
//
// Unlike the sidebars, floating panels are arbitrary rectangles in the middle
// of the workspace, so these are the cases where Y actually matters. Every
// canvas operation (selection, placement, deletion, drag-paint, right-click,
// hover scanning, rectangle tools, element drag/resize, wheel zoom) routes
// through isPointOverEditorCanvas, so a rectangle reported here blocks all of
// them uniformly.

/** A floating panel parked in the middle of the canvas gap. */
const FLOATING_PANEL: EditorUIRect = { xPx: 500, yPx: 300, widthPx: 260, heightPx: 400 };

test('a floating panel blocks canvas interaction inside its rectangle', () => {
  const p = params({ floatingPanelRects: [FLOATING_PANEL] });
  // Dead centre of the floating panel.
  assert.equal(isPointOverEditorUI(630, 500, p), true);
  assert.equal(isPointOverEditorCanvas(630, 500, p), false);
  // Its corners are UI too.
  assert.equal(isPointOverEditorUI(500, 300, p), true);
  assert.equal(isPointOverEditorUI(760, 700, p), true);
});

test('canvas points near a floating panel remain fully interactive', () => {
  const p = params({ floatingPanelRects: [FLOATING_PANEL] });
  assert.equal(isPointOverEditorCanvas(499, 500, p), true, 'just left of the panel');
  assert.equal(isPointOverEditorCanvas(761, 500, p), true, 'just right of the panel');
  assert.equal(isPointOverEditorCanvas(630, 299, p), true, 'just above the panel');
  assert.equal(isPointOverEditorCanvas(630, 701, p), true, 'just below the panel');
});

test('the same X is UI or canvas depending on Y once a panel is floating', () => {
  const p = params({ floatingPanelRects: [FLOATING_PANEL] });
  // This X sits in the canvas gap between the two sidebars...
  assert.equal(isPointOverEditorCanvas(630, 100, p), true, 'above the floating panel');
  // ...but the same X inside the panel's Y band is UI.
  assert.equal(isPointOverEditorCanvas(630, 500, p), false);
});

test('multiple floating panels are all honoured', () => {
  const second: EditorUIRect = { xPx: 300, yPx: 60, widthPx: 260, heightPx: 200 };
  const p = params({ floatingPanelRects: [FLOATING_PANEL, second] });
  assert.equal(isPointOverEditorUI(400, 150, p), true, 'inside the second panel');
  assert.equal(isPointOverEditorUI(630, 500, p), true, 'inside the first panel');
  assert.equal(isPointOverEditorCanvas(450, 800, p), true, 'inside neither');
});

test('floating panels remain blocking even when both sidebars are hidden', () => {
  const p = params({
    isLeftSidebarVisible: false,
    isRightSidebarVisible: false,
    floatingPanelRects: [FLOATING_PANEL],
  });
  assert.equal(isPointOverEditorUI(630, 500, p), true, 'panel still shields the room');
  assert.equal(isPointOverEditorCanvas(630, 100, p), true, 'freed sidebar space still usable');
});

test('an omitted or empty floatingPanelRects list changes nothing', () => {
  const omitted = params();
  const empty = params({ floatingPanelRects: [] });
  for (const [x, y] of [[0, 10], [630, 500], [VIEWPORT_WIDTH, 800]] as const) {
    assert.equal(isPointOverEditorUI(x, y, omitted), isPointOverEditorUI(x, y, empty));
  }
  // The middle of the canvas is interactive when nothing is floating.
  assert.equal(isPointOverEditorCanvas(630, 500, omitted), true);
});

test('a floating panel overlapping a sidebar does not make the sidebar interactive', () => {
  const overlapping: EditorUIRect = { xPx: 0, yPx: 0, widthPx: 300, heightPx: 100 };
  const p = params({ floatingPanelRects: [overlapping] });
  assert.equal(isPointOverEditorUI(10, 10, p), true);
  assert.equal(isPointOverEditorUI(10, 500, p), true, 'still the left sidebar below the panel');
});
