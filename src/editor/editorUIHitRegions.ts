/**
 * Shared hit-region logic for the editor's two independent 260px sidebars
 * (`#editor-ui` left, `#editor-ui-right` right) and their hide/reveal tabs.
 *
 * Replaces the old hardcoded `clickScreenXPx > 260`-style check in
 * editorController.ts, which only ever accounted for a fixed-visible left
 * sidebar and never excluded the right sidebar at all. Every canvas pointer
 * gesture (click, right-click delete, drag-paint, hover-scan, etc.) should
 * route its "is this pointer over the UI, not the canvas" question through
 * `isPointOverEditorUI` below instead of a hardcoded constant, so hiding a
 * sidebar immediately frees its old screen region for canvas interaction
 * (minus only the small reveal tab that remains in its place).
 *
 * Pure functions — no DOM access — so this is unit-testable without a
 * canvas/editor harness.
 */

/** CSS-pixel width of each sidebar when visible. Matches editorUI.ts. */
export const EDITOR_SIDEBAR_WIDTH_CSS_PX = 260;

/** CSS-pixel width of the small reveal tab left behind at a hidden sidebar's edge. */
export const EDITOR_REVEAL_TAB_WIDTH_CSS_PX = 22;

export interface EditorUIHitRegionParams {
  /** Current CSS viewport width (needed to place the right sidebar/tab). */
  viewportWidthPx: number;
  /** Whether the left sidebar (`#editor-ui`) is currently visible. */
  isLeftSidebarVisible: boolean;
  /** Whether the right sidebar (`#editor-ui-right`) is currently visible. */
  isRightSidebarVisible: boolean;
}

/**
 * True when the given CSS-pixel screen X coordinate falls under editor UI
 * chrome: the visible left sidebar's region, the visible right sidebar's
 * region, or either sidebar's reveal tab when that sidebar is hidden.
 *
 * Only the X axis matters — both sidebars and both reveal tabs span the full
 * viewport height.
 */
export function isPointOverEditorUI(xPx: number, params: EditorUIHitRegionParams): boolean {
  if (params.isLeftSidebarVisible) {
    if (xPx <= EDITOR_SIDEBAR_WIDTH_CSS_PX) return true;
  } else if (xPx <= EDITOR_REVEAL_TAB_WIDTH_CSS_PX) {
    return true;
  }

  const rightSidebarStartPx = params.viewportWidthPx - EDITOR_SIDEBAR_WIDTH_CSS_PX;
  const rightRevealTabStartPx = params.viewportWidthPx - EDITOR_REVEAL_TAB_WIDTH_CSS_PX;
  if (params.isRightSidebarVisible) {
    if (xPx >= rightSidebarStartPx) return true;
  } else if (xPx >= rightRevealTabStartPx) {
    return true;
  }

  return false;
}

/** Convenience negation — true when the point is over the canvas (not UI). */
export function isPointOverEditorCanvas(xPx: number, params: EditorUIHitRegionParams): boolean {
  return !isPointOverEditorUI(xPx, params);
}
