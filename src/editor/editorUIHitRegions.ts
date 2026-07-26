/**
 * Shared hit-region logic for the editor's two independent 260px sidebars
 * (`#editor-ui` left, `#editor-ui-right` right), their hide/reveal tabs, and
 * any floating (undocked) panel windows.
 *
 * Replaces the old hardcoded `clickScreenXPx > 260`-style check in
 * editorController.ts, which only ever accounted for a fixed-visible left
 * sidebar and never excluded the right sidebar at all. Every canvas pointer
 * gesture (click, right-click delete, drag-paint, hover-scan, wheel zoom,
 * element drag/resize) should route its "is this pointer over the UI, not the
 * canvas" question through `isPointOverEditorUI` below instead of a hardcoded
 * constant, so hiding a sidebar immediately frees its old screen region for
 * canvas interaction (minus only the small reveal tab that remains in its
 * place), and so a floating panel reliably shields the room underneath it.
 *
 * Sidebars and reveal tabs span the full viewport height, so they only need
 * an X test. Floating panels are arbitrary rectangles, so callers must pass
 * both X and Y. The floating rectangles come from a per-frame snapshot taken
 * by EditorUI (`getFloatingPanelRects`) rather than from per-operation DOM
 * queries — measuring layout once per frame instead of once per gesture keeps
 * this off the hot path.
 *
 * Pure functions — no DOM access — so this is unit-testable without a
 * canvas/editor harness.
 */

import { isPointInAnyRect, type EditorUIRect } from './editorFloatingGeometry';

export type { EditorUIRect } from './editorFloatingGeometry';

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
  /**
   * Screen-space rectangles of every visible floating panel window, in CSS
   * pixels. Optional so callers that have no floating panels (and the many
   * existing sidebar-only tests) can omit it entirely.
   */
  floatingPanelRects?: readonly EditorUIRect[];
}

/**
 * True when the given CSS-pixel screen point falls under editor UI chrome:
 * the visible left sidebar's region, the visible right sidebar's region,
 * either sidebar's reveal tab when that sidebar is hidden, or any floating
 * panel window.
 *
 * `yPx` only affects floating-panel testing — both sidebars and both reveal
 * tabs span the full viewport height.
 */
export function isPointOverEditorUI(xPx: number, yPx: number, params: EditorUIHitRegionParams): boolean {
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

  const floatingRects = params.floatingPanelRects;
  if (floatingRects !== undefined && floatingRects.length > 0) {
    if (isPointInAnyRect(xPx, yPx, floatingRects)) return true;
  }

  return false;
}

/** Convenience negation — true when the point is over the canvas (not UI). */
export function isPointOverEditorCanvas(xPx: number, yPx: number, params: EditorUIHitRegionParams): boolean {
  return !isPointOverEditorUI(xPx, yPx, params);
}
