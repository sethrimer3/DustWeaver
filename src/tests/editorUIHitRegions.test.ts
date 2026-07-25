import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPointOverEditorUI,
  isPointOverEditorCanvas,
  EDITOR_SIDEBAR_WIDTH_CSS_PX,
  EDITOR_REVEAL_TAB_WIDTH_CSS_PX,
  type EditorUIHitRegionParams,
} from '../editor/editorUIHitRegions';

const VIEWPORT_WIDTH = 1200;

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
  assert.equal(isPointOverEditorUI(0, p), true);
  assert.equal(isPointOverEditorUI(EDITOR_SIDEBAR_WIDTH_CSS_PX, p), true);
  assert.equal(isPointOverEditorUI(EDITOR_SIDEBAR_WIDTH_CSS_PX + 1, p), false);
  assert.equal(isPointOverEditorUI(VIEWPORT_WIDTH - EDITOR_SIDEBAR_WIDTH_CSS_PX - 1, p), false);
  assert.equal(isPointOverEditorUI(VIEWPORT_WIDTH - EDITOR_SIDEBAR_WIDTH_CSS_PX, p), true);
  assert.equal(isPointOverEditorUI(VIEWPORT_WIDTH, p), true);
});

test('left hidden, right visible: old left 260px region is now canvas, minus the reveal tab', () => {
  const p = params({ isLeftSidebarVisible: false });
  // Just inside the reveal tab -> still UI.
  assert.equal(isPointOverEditorUI(EDITOR_REVEAL_TAB_WIDTH_CSS_PX - 1, p), true);
  // Just outside the reveal tab, still well within the old 260px sidebar region -> now canvas.
  assert.equal(isPointOverEditorUI(EDITOR_REVEAL_TAB_WIDTH_CSS_PX + 1, p), false);
  assert.equal(isPointOverCanvasCheck(EDITOR_SIDEBAR_WIDTH_CSS_PX - 1, p), true);
  // Right sidebar unaffected.
  assert.equal(isPointOverEditorUI(VIEWPORT_WIDTH - 1, p), true);
});

test('right hidden, left visible: old right 260px region is now canvas, minus the reveal tab', () => {
  const p = params({ isRightSidebarVisible: false });
  const rightRevealStart = VIEWPORT_WIDTH - EDITOR_REVEAL_TAB_WIDTH_CSS_PX;
  assert.equal(isPointOverEditorUI(rightRevealStart, p), true);
  assert.equal(isPointOverEditorUI(rightRevealStart - 1, p), false);
  // Left sidebar unaffected.
  assert.equal(isPointOverEditorUI(0, p), true);
});

test('both sidebars hidden: only the two small reveal tabs are UI, everything else is canvas', () => {
  const p = params({ isLeftSidebarVisible: false, isRightSidebarVisible: false });
  assert.equal(isPointOverEditorUI(0, p), true);
  assert.equal(isPointOverEditorUI(EDITOR_REVEAL_TAB_WIDTH_CSS_PX + 1, p), false);
  assert.equal(isPointOverEditorUI(VIEWPORT_WIDTH - EDITOR_REVEAL_TAB_WIDTH_CSS_PX, p), true);
  assert.equal(isPointOverEditorUI(VIEWPORT_WIDTH - EDITOR_REVEAL_TAB_WIDTH_CSS_PX - 1, p), false);
  // Middle of the viewport is canvas either way.
  assert.equal(isPointOverEditorUI(VIEWPORT_WIDTH / 2, p), false);
});

test('isPointOverEditorCanvas is the exact negation of isPointOverEditorUI', () => {
  const p = params({ isLeftSidebarVisible: false, isRightSidebarVisible: true });
  for (const x of [0, 10, 21, 22, 23, 500, VIEWPORT_WIDTH - 300, VIEWPORT_WIDTH]) {
    assert.equal(isPointOverEditorCanvas(x, p), !isPointOverEditorUI(x, p));
  }
});

function isPointOverCanvasCheck(x: number, p: EditorUIHitRegionParams): boolean {
  return isPointOverEditorCanvas(x, p);
}
