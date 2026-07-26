/**
 * Pure geometry for floating (undocked) editor panel windows: viewport
 * clamping and rectangle construction.
 *
 * The critical rule here is reachability. A floating panel whose header has
 * been pushed off-screen — by a restore from a larger monitor, or by dragging
 * to the far edge — can never be grabbed again, which would strand a panel
 * permanently until Reset Workspace. Every path that positions a floating
 * panel (drop, restore-from-preferences, and viewport resize) must route
 * through `clampFloatingPanelPosition` so the complete header/drag region
 * stays inside the viewport.
 *
 * DOM-free so it is unit-testable without a jsdom harness.
 */

import { EDITOR_PANEL_IDS, type EditorPanelId } from './editorPanelRegistry';
import type { EditorPanelLayout } from './editorPanelLayout';

/**
 * Width of a floating panel window, matching the docked sidebar width so a
 * panel looks the same docked or floating and its internal layout (palette
 * grids, inspector rows) doesn't reflow when it is undocked.
 */
export const FLOATING_PANEL_WIDTH_CSS_PX = 260;

/**
 * Height of the always-visible grip/title bar at the top of a floating
 * panel. Clamping guarantees at least this much of the panel remains
 * on-screen, so the drag region is always reachable.
 */
export const FLOATING_PANEL_HEADER_HEIGHT_CSS_PX = 26;

export interface EditorUIRect {
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
}

export interface FloatingPanelPosition {
  xPx: number;
  yPx: number;
}

/**
 * Clamps a floating panel's top-left so its entire header bar stays visible.
 *
 * Horizontally the whole panel width is kept on-screen when it fits; when the
 * viewport is narrower than the panel, x pins to 0 (left-aligned and
 * partially cut off on the right) rather than going negative, which would
 * hide the grip. Vertically the top edge is kept within
 * `[0, viewportHeight - headerHeight]`, so the grip bar is never scrolled
 * past the bottom edge.
 */
export function clampFloatingPanelPosition(
  xPx: number,
  yPx: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
): FloatingPanelPosition {
  const safeX = Number.isFinite(xPx) ? xPx : 0;
  const safeY = Number.isFinite(yPx) ? yPx : 0;
  const safeViewportW = Number.isFinite(viewportWidthPx) && viewportWidthPx > 0 ? viewportWidthPx : 0;
  const safeViewportH = Number.isFinite(viewportHeightPx) && viewportHeightPx > 0 ? viewportHeightPx : 0;

  const maxX = Math.max(0, safeViewportW - FLOATING_PANEL_WIDTH_CSS_PX);
  const maxY = Math.max(0, safeViewportH - FLOATING_PANEL_HEADER_HEIGHT_CSS_PX);

  return {
    xPx: Math.max(0, Math.min(maxX, safeX)),
    yPx: Math.max(0, Math.min(maxY, safeY)),
  };
}

/**
 * Re-clamps every floating panel in `layout` against the current viewport,
 * returning a new layout. Called on restore and on window resize so shrinking
 * the window can never strand a panel's header off-screen.
 *
 * Returns the original object when nothing moved, so callers can cheaply skip
 * a redundant persist/apply.
 */
export function clampAllFloatingPanels(
  layout: EditorPanelLayout,
  viewportWidthPx: number,
  viewportHeightPx: number,
): { layout: EditorPanelLayout; changed: boolean } {
  let changed = false;
  const floating: Partial<Record<EditorPanelId, { xPx: number; yPx: number; z: number }>> = {};
  for (const id of EDITOR_PANEL_IDS) {
    const f = layout.floating[id];
    if (f === undefined) continue;
    const clamped = clampFloatingPanelPosition(f.xPx, f.yPx, viewportWidthPx, viewportHeightPx);
    if (clamped.xPx !== f.xPx || clamped.yPx !== f.yPx) changed = true;
    floating[id] = { xPx: clamped.xPx, yPx: clamped.yPx, z: f.z };
  }
  if (!changed) return { layout, changed: false };
  return {
    layout: { left: layout.left.slice(), right: layout.right.slice(), floating },
    changed: true,
  };
}

/** True when (xPx, yPx) falls inside `rect` (inclusive of its edges). */
export function isPointInRect(xPx: number, yPx: number, rect: EditorUIRect): boolean {
  return xPx >= rect.xPx
    && xPx <= rect.xPx + rect.widthPx
    && yPx >= rect.yPx
    && yPx <= rect.yPx + rect.heightPx;
}

/** True when (xPx, yPx) falls inside any of `rects`. */
export function isPointInAnyRect(xPx: number, yPx: number, rects: readonly EditorUIRect[]): boolean {
  for (const rect of rects) {
    if (isPointInRect(xPx, yPx, rect)) return true;
  }
  return false;
}
