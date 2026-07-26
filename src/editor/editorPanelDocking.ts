/**
 * DOM docking/drag coordinator for the editor's dockable panel system.
 *
 * Owns the imperative half of the feature: wrapping each registered panel in
 * a movable host with a drag grip, reflecting an `EditorPanelLayout` into the
 * DOM, and running the Pointer Events drag that produces the next layout.
 * Every layout *decision* lives in the pure modules (editorPanelLayout.ts,
 * editorFloatingGeometry.ts); this file only reads the pointer, computes a
 * drop target, and applies the result.
 *
 * Design notes:
 *  - A panel's original wrapper element is never destroyed or recreated. It
 *    is adopted into a host `<div>` once at registration and thereafter only
 *    re-parented, so focused inputs, scroll positions, animated preview
 *    canvases, palette cards, and event listeners all survive any number of
 *    reorders, cross-sidebar moves, floats, and redocks.
 *  - Dragging starts only from the explicit grip button, so the collapsible
 *    header's click/keyboard activation and every control inside a panel keep
 *    working untouched.
 *  - Floating panels live in their own layer at z-index 950: above the
 *    sidebars (900) so they visually float over the workspace, but below the
 *    editor's modal dialogs and confirmations (1100+) so a blocking overlay
 *    is never obscured by a panel.
 *  - The drag owns the pointer via setPointerCapture, and the controller
 *    treats floating panel rectangles as UI, so a drag can never leak into a
 *    canvas paint/select gesture underneath.
 */

import {
  EDITOR_PANEL_IDS, getEditorPanelDef,
  type EditorPanelId, type EditorSidebarSide,
} from './editorPanelRegistry';
import {
  dockPanel, floatPanel, moveFloatingPanel, bringFloatingPanelToFront,
  getFloatingPanelIdsByZ, getSidebarPanelIds, getPanelLocation,
  type EditorPanelLayout,
} from './editorPanelLayout';
import {
  clampFloatingPanelPosition, clampAllFloatingPanels,
  FLOATING_PANEL_WIDTH_CSS_PX,
  type EditorUIRect,
} from './editorFloatingGeometry';
import { PANEL_BG, PANEL_BORDER, BTN_BG, TEXT_COLOR, ACCENT_GOLD } from './editorStyles';

/**
 * Floating panel layer z-index. Strictly between the sidebars (900) and the
 * lowest modal/dialog layer (1100) — see the z-index survey in the module
 * docblock. Individual panels stack *within* this layer, so no number of
 * floating panels can ever climb over a modal.
 */
const FLOATING_LAYER_Z_INDEX = 950;

/** Pointer travel (px) before a grip press is treated as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

/** Distance (px) from a sidebar's top/bottom edge that triggers auto-scroll while dragging. */
const AUTO_SCROLL_EDGE_PX = 36;
/** Auto-scroll speed in px per animation frame. */
const AUTO_SCROLL_SPEED_PX = 12;

export interface EditorDockablePanelRegistration {
  readonly id: EditorPanelId;
  /** The panel's existing root element (e.g. a CollapsibleSection wrapper). Adopted, never rebuilt. */
  readonly element: HTMLElement;
}

export interface EditorPanelDockingCallbacks {
  /** Fired after any completed layout change (reorder, move, float, redock, floating move). */
  onLayoutChanged: (layout: EditorPanelLayout) => void;
  /** Asked to reveal a hidden sidebar when a panel is dropped on its edge. */
  onRequestRevealSidebar: (side: EditorSidebarSide) => void;
  /** Whether a sidebar is currently visible — drop targeting must respect hidden sidebars. */
  isSidebarVisible: (side: EditorSidebarSide) => boolean;
}

export interface EditorPanelDockingController {
  /** Re-parents/repositions every panel to match `layout`, and stores it as current. */
  applyLayout: (layout: EditorPanelLayout) => void;
  getLayout: () => EditorPanelLayout;
  /**
   * Screen-space rectangles of currently visible floating panels, for the
   * controller's canvas hit-region test. Measured on demand (once per frame
   * by the caller), not per editor operation.
   */
  getFloatingPanelRects: () => EditorUIRect[];
  /** True while a panel drag is in progress — canvas gestures must stand down. */
  isDragging: () => boolean;
  destroy: () => void;
}

interface PanelHost {
  readonly id: EditorPanelId;
  /** Movable wrapper: grip bar + the panel's original element. */
  readonly host: HTMLDivElement;
  readonly grip: HTMLButtonElement;
  readonly dockLeftBtn: HTMLButtonElement;
  readonly dockRightBtn: HTMLButtonElement;
  readonly floatBtn: HTMLButtonElement;
}

const DOCKED_HOST_CSS = 'position: static; width: auto; left: auto; top: auto; z-index: auto; max-height: none; box-shadow: none; border: none; background: none; padding: 0; margin: 0;';

export function createEditorPanelDocking(
  root: HTMLElement,
  leftContainer: HTMLElement,
  rightContainer: HTMLElement,
  registrations: readonly EditorDockablePanelRegistration[],
  callbacks: EditorPanelDockingCallbacks,
  initialLayout: EditorPanelLayout,
): EditorPanelDockingController {
  let layout = initialLayout;
  const hosts = new Map<EditorPanelId, PanelHost>();

  // ── Floating layer ────────────────────────────────────────────────────────
  // pointer-events:none so the empty areas of the layer never swallow canvas
  // input; each floating host re-enables pointer events for itself.
  const floatingLayer = document.createElement('div');
  floatingLayer.id = 'editor-floating-panels';
  floatingLayer.style.cssText = `
    position: absolute; inset: 0; pointer-events: none; z-index: ${FLOATING_LAYER_Z_INDEX};
  `;
  root.appendChild(floatingLayer);

  // ── Drop placeholder / insertion indicator ────────────────────────────────
  const placeholder = document.createElement('div');
  placeholder.style.cssText = `
    height: 3px; margin: 4px 0; border-radius: 2px; background: ${ACCENT_GOLD};
    box-shadow: 0 0 6px rgba(240,199,94,0.8); pointer-events: none; display: none;
  `;

  // ── Empty-sidebar drop hints ──────────────────────────────────────────────
  function makeEmptyHint(): HTMLDivElement {
    const hint = document.createElement('div');
    hint.textContent = 'Drop panels here';
    hint.style.cssText = `
      display: none; padding: 14px 8px; margin: 6px 0; text-align: center;
      border: 1px dashed ${PANEL_BORDER}; border-radius: 4px;
      color: rgba(241,231,203,0.45); font-size: 10px; font-style: italic;
      pointer-events: none;
    `;
    return hint;
  }
  const leftEmptyHint = makeEmptyHint();
  const rightEmptyHint = makeEmptyHint();
  leftContainer.appendChild(leftEmptyHint);
  rightContainer.appendChild(rightEmptyHint);

  function updateEmptyHints(): void {
    leftEmptyHint.style.display = layout.left.length === 0 ? 'block' : 'none';
    rightEmptyHint.style.display = layout.right.length === 0 ? 'block' : 'none';
  }

  // ── Panel host construction ───────────────────────────────────────────────
  function makeMiniBtn(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.style.cssText = `
      width: 18px; height: 16px; padding: 0; line-height: 1; flex: none;
      background: ${BTN_BG}; border: 1px solid ${PANEL_BORDER}; border-radius: 2px;
      color: ${TEXT_COLOR}; font-size: 9px; cursor: pointer;
    `;
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return btn;
  }

  function createHost(reg: EditorDockablePanelRegistration): PanelHost {
    const def = getEditorPanelDef(reg.id);

    const host = document.createElement('div');
    host.dataset.panelId = reg.id;
    host.style.cssText = DOCKED_HOST_CSS;

    const gripBar = document.createElement('div');
    gripBar.style.cssText = `
      display: flex; align-items: center; gap: 3px; margin-bottom: 2px;
    `;

    const grip = document.createElement('button');
    grip.type = 'button';
    grip.textContent = '⠿';
    grip.title = `Drag to move the ${def.title} panel`;
    grip.setAttribute('aria-label', `Drag to move the ${def.title} panel`);
    grip.style.cssText = `
      flex: 1 1 auto; min-width: 0; text-align: left; padding: 1px 4px;
      background: transparent; border: 1px solid transparent; border-radius: 2px;
      color: rgba(241,231,203,0.45); font-size: 10px; cursor: grab;
      touch-action: none; user-select: none;
    `;
    grip.addEventListener('pointerenter', () => {
      grip.style.background = 'rgba(255,255,255,0.06)';
      grip.style.borderColor = PANEL_BORDER;
    });
    grip.addEventListener('pointerleave', () => {
      grip.style.background = 'transparent';
      grip.style.borderColor = 'transparent';
    });

    // Non-drag fallbacks, for keyboard/accessibility and for users who'd
    // rather not drag. Kept to three tiny icon buttons so the header stays
    // uncluttered.
    const dockLeftBtn = makeMiniBtn('◧', `Dock ${def.title} to the left sidebar`, () => {
      applyAndCommit(dockPanel(layout, reg.id, 'left', getSidebarPanelIds(layout, 'left').length));
      if (!callbacks.isSidebarVisible('left')) callbacks.onRequestRevealSidebar('left');
    });
    const dockRightBtn = makeMiniBtn('◨', `Dock ${def.title} to the right sidebar`, () => {
      applyAndCommit(dockPanel(layout, reg.id, 'right', getSidebarPanelIds(layout, 'right').length));
      if (!callbacks.isSidebarVisible('right')) callbacks.onRequestRevealSidebar('right');
    });
    const floatBtn = makeMiniBtn('⧉', `Float the ${def.title} panel`, () => {
      const rect = host.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const pos = clampFloatingPanelPosition(
        rect.left - rootRect.left,
        rect.top - rootRect.top,
        rootRect.width,
        rootRect.height,
      );
      applyAndCommit(floatPanel(layout, reg.id, pos.xPx, pos.yPx));
    });

    gripBar.appendChild(grip);
    gripBar.appendChild(dockLeftBtn);
    gripBar.appendChild(dockRightBtn);
    gripBar.appendChild(floatBtn);

    host.appendChild(gripBar);
    host.appendChild(reg.element);

    const panelHost: PanelHost = { id: reg.id, host, grip, dockLeftBtn, dockRightBtn, floatBtn };
    grip.addEventListener('pointerdown', (e) => onGripPointerDown(e, panelHost));
    // Any interaction with a floating panel raises it, so a buried window can
    // always be brought forward by clicking it.
    host.addEventListener('pointerdown', () => {
      if (layout.floating[reg.id] === undefined) return;
      const next = bringFloatingPanelToFront(layout, reg.id);
      if (next !== layout) applyAndCommit(next);
    }, true);

    return panelHost;
  }

  for (const reg of registrations) {
    hosts.set(reg.id, createHost(reg));
  }

  // ── Layout → DOM ──────────────────────────────────────────────────────────
  function styleHostAsDocked(panelHost: PanelHost): void {
    panelHost.host.style.cssText = DOCKED_HOST_CSS;
    panelHost.grip.style.cursor = 'grab';
  }

  function styleHostAsFloating(panelHost: PanelHost, xPx: number, yPx: number, z: number): void {
    panelHost.host.style.cssText = `
      position: absolute; left: ${xPx}px; top: ${yPx}px;
      width: ${FLOATING_PANEL_WIDTH_CSS_PX}px; z-index: ${z};
      max-height: calc(100% - 20px); overflow-y: auto; overflow-x: hidden;
      box-sizing: border-box; padding: 6px; border-radius: 4px;
      background: ${PANEL_BG}; border: 1px solid ${PANEL_BORDER};
      box-shadow: 0 6px 20px rgba(0,0,0,0.55);
      color: ${TEXT_COLOR}; font-family: 'Cinzel', monospace; font-size: 12px;
      pointer-events: auto;
    `;
    panelHost.grip.style.cursor = 'grab';
  }

  function applyLayout(next: EditorPanelLayout): void {
    layout = next;

    // Docked panels: append in layout order. appendChild on an already-parented
    // node moves it, so this both re-parents cross-sidebar moves and reorders
    // within a sidebar without recreating anything.
    for (const side of ['left', 'right'] as const) {
      const container = side === 'left' ? leftContainer : rightContainer;
      for (const id of getSidebarPanelIds(layout, side)) {
        const panelHost = hosts.get(id);
        if (panelHost === undefined) continue;
        styleHostAsDocked(panelHost);
        container.appendChild(panelHost.host);
      }
    }
    // Keep the empty-state hints last in their containers.
    leftContainer.appendChild(leftEmptyHint);
    rightContainer.appendChild(rightEmptyHint);

    // Floating panels, appended back-to-front so DOM order matches stacking.
    for (const id of getFloatingPanelIdsByZ(layout)) {
      const panelHost = hosts.get(id);
      const f = layout.floating[id];
      if (panelHost === undefined || f === undefined) continue;
      styleHostAsFloating(panelHost, f.xPx, f.yPx, f.z);
      floatingLayer.appendChild(panelHost.host);
    }

    updateEmptyHints();
  }

  /** Applies a new layout to the DOM and notifies the owner (which persists it). */
  function applyAndCommit(next: EditorPanelLayout): void {
    applyLayout(next);
    callbacks.onLayoutChanged(layout);
  }

  // ── Drag state ────────────────────────────────────────────────────────────
  interface DragState {
    panelHost: PanelHost;
    pointerId: number;
    /** Pointer offset within the host at grab time, so the panel doesn't jump. */
    grabOffsetXPx: number;
    grabOffsetYPx: number;
    startClientXPx: number;
    startClientYPx: number;
    latestClientXPx: number;
    latestClientYPx: number;
    /** False until the pointer passes DRAG_THRESHOLD_PX — a tap must not reorder anything. */
    exceededThreshold: boolean;
    /** Where the panel would land if released now. */
    dropTarget: { kind: 'dock'; side: EditorSidebarSide; index: number } | { kind: 'float' } | null;
    autoScrollFrame: number | null;
    autoScrollSide: EditorSidebarSide | null;
    autoScrollDir: number;
  }
  let drag: DragState | null = null;

  function highlightSidebar(side: EditorSidebarSide | null): void {
    leftContainer.style.outline = side === 'left' ? `2px dashed ${ACCENT_GOLD}` : '';
    leftContainer.style.outlineOffset = side === 'left' ? '-3px' : '';
    rightContainer.style.outline = side === 'right' ? `2px dashed ${ACCENT_GOLD}` : '';
    rightContainer.style.outlineOffset = side === 'right' ? '-3px' : '';
  }

  /** Which sidebar (if any) the pointer is currently over, respecting hidden sidebars. */
  function sidebarUnderPointer(clientXPx: number, clientYPx: number): EditorSidebarSide | null {
    for (const side of ['left', 'right'] as const) {
      const el = side === 'left' ? leftContainer : rightContainer;
      // A hidden sidebar's shell has display:none, so its own rect is empty.
      // Fall back to the fixed screen-edge band so dropping on a hidden
      // sidebar's edge can still dock (and reveal) it.
      const shell = el.parentElement;
      if (shell !== null && callbacks.isSidebarVisible(side)) {
        const r = shell.getBoundingClientRect();
        if (clientXPx >= r.left && clientXPx <= r.right && clientYPx >= r.top && clientYPx <= r.bottom) {
          return side;
        }
      } else {
        const rootRect = root.getBoundingClientRect();
        const edgeBand = 28;
        if (side === 'left' && clientXPx - rootRect.left <= edgeBand) return 'left';
        if (side === 'right' && rootRect.right - clientXPx <= edgeBand) return 'right';
      }
    }
    return null;
  }

  /**
   * Insertion index for a drop into `side` at `clientYPx`. Computed against
   * the docked hosts currently in that container excluding the dragged one,
   * which matches `dockPanel`'s "index applies after removal" contract.
   */
  function computeDropIndex(side: EditorSidebarSide, clientYPx: number, draggedId: EditorPanelId): number {
    const ids = getSidebarPanelIds(layout, side).filter(id => id !== draggedId);
    let index = ids.length;
    for (let i = 0; i < ids.length; i++) {
      const panelHost = hosts.get(ids[i]);
      if (panelHost === undefined) continue;
      const r = panelHost.host.getBoundingClientRect();
      if (r.height === 0) continue;
      if (clientYPx < r.top + r.height / 2) { index = i; break; }
    }
    return index;
  }

  function showPlaceholderAt(side: EditorSidebarSide, index: number, draggedId: EditorPanelId): void {
    const container = side === 'left' ? leftContainer : rightContainer;
    const ids = getSidebarPanelIds(layout, side).filter(id => id !== draggedId);
    placeholder.style.display = 'block';
    if (index >= ids.length) {
      container.insertBefore(placeholder, side === 'left' ? leftEmptyHint : rightEmptyHint);
    } else {
      const refHost = hosts.get(ids[index]);
      if (refHost !== undefined) container.insertBefore(placeholder, refHost.host);
      else container.appendChild(placeholder);
    }
  }

  function hidePlaceholder(): void {
    placeholder.style.display = 'none';
    if (placeholder.parentElement !== null) placeholder.parentElement.removeChild(placeholder);
  }

  function stopAutoScroll(): void {
    if (drag === null) return;
    if (drag.autoScrollFrame !== null) {
      cancelAnimationFrame(drag.autoScrollFrame);
      drag.autoScrollFrame = null;
    }
    drag.autoScrollSide = null;
    drag.autoScrollDir = 0;
  }

  function tickAutoScroll(): void {
    if (drag === null || drag.autoScrollSide === null) return;
    drag.autoScrollFrame = null;
    
    const shell = (drag.autoScrollSide === 'left' ? leftContainer : rightContainer).parentElement;
    if (shell !== null) shell.scrollTop += drag.autoScrollDir * AUTO_SCROLL_SPEED_PX;

    const side = sidebarUnderPointer(drag.latestClientXPx, drag.latestClientYPx);
    highlightSidebar(side);

    if (side !== null) {
      const index = computeDropIndex(side, drag.latestClientYPx, drag.panelHost.id);
      drag.dropTarget = { kind: 'dock', side, index };
      showPlaceholderAt(side, index, drag.panelHost.id);
    } else {
      drag.dropTarget = { kind: 'float' };
      hidePlaceholder();
    }

    updateAutoScroll(side, drag.latestClientYPx);
  }

  function updateAutoScroll(side: EditorSidebarSide | null, clientYPx: number): void {
    if (drag === null) return;
    if (side === null) { stopAutoScroll(); return; }
    const shell = (side === 'left' ? leftContainer : rightContainer).parentElement;
    if (shell === null) { stopAutoScroll(); return; }
    const r = shell.getBoundingClientRect();
    let dir = 0;
    if (clientYPx - r.top < AUTO_SCROLL_EDGE_PX) dir = -1;
    else if (r.bottom - clientYPx < AUTO_SCROLL_EDGE_PX) dir = 1;

    if (dir === 0) { stopAutoScroll(); return; }
    if (drag.autoScrollSide === side && drag.autoScrollDir === dir) {
      if (drag.autoScrollFrame === null) {
        drag.autoScrollFrame = requestAnimationFrame(tickAutoScroll);
      }
      return;
    }
    stopAutoScroll();
    drag.autoScrollSide = side;
    drag.autoScrollDir = dir;
    drag.autoScrollFrame = requestAnimationFrame(tickAutoScroll);
  }

  function onGripPointerDown(e: PointerEvent, panelHost: PanelHost): void {
    if (e.button !== 0) return;
    // The grip owns this pointer from here on: no canvas gesture, text
    // selection, or native drag may start from it.
    e.preventDefault();
    e.stopPropagation();

    const hostRect = panelHost.host.getBoundingClientRect();
    drag = {
      panelHost,
      pointerId: e.pointerId,
      grabOffsetXPx: e.clientX - hostRect.left,
      grabOffsetYPx: e.clientY - hostRect.top,
      startClientXPx: e.clientX,
      startClientYPx: e.clientY,
      latestClientXPx: e.clientX,
      latestClientYPx: e.clientY,
      exceededThreshold: false,
      dropTarget: null,
      autoScrollFrame: null,
      autoScrollSide: null,
      autoScrollDir: 0,
    };
    try { panelHost.grip.setPointerCapture(e.pointerId); } catch { /* capture unsupported — move/up still fire */ }
    panelHost.grip.style.cursor = 'grabbing';
  }

  function beginVisualDrag(): void {
    if (drag === null) return;
    const panelHost = drag.panelHost;
    // Lift the panel out of the document flow so the placeholder can show the
    // real insertion point. The node itself is only re-parented, never rebuilt.
    const rect = panelHost.host.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    styleHostAsFloating(
      panelHost,
      rect.left - rootRect.left,
      rect.top - rootRect.top,
      1000,
    );
    panelHost.host.style.opacity = '0.85';
    panelHost.host.style.pointerEvents = 'none';
    floatingLayer.appendChild(panelHost.host);
    updateEmptyHints();
  }

  function onPointerMove(e: PointerEvent): void {
    if (drag === null || e.pointerId !== drag.pointerId) return;
    
    drag.latestClientXPx = e.clientX;
    drag.latestClientYPx = e.clientY;

    if (!drag.exceededThreshold) {
      const dx = e.clientX - drag.startClientXPx;
      const dy = e.clientY - drag.startClientYPx;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.exceededThreshold = true;
      beginVisualDrag();
    }

    const rootRect = root.getBoundingClientRect();
    const host = drag.panelHost.host;
    host.style.left = `${e.clientX - rootRect.left - drag.grabOffsetXPx}px`;
    host.style.top = `${e.clientY - rootRect.top - drag.grabOffsetYPx}px`;

    const side = sidebarUnderPointer(e.clientX, e.clientY);
    highlightSidebar(side);
    updateAutoScroll(side, e.clientY);

    if (side !== null) {
      const index = computeDropIndex(side, e.clientY, drag.panelHost.id);
      drag.dropTarget = { kind: 'dock', side, index };
      showPlaceholderAt(side, index, drag.panelHost.id);
    } else {
      drag.dropTarget = { kind: 'float' };
      hidePlaceholder();
    }
  }

  function finishDrag(e: PointerEvent, cancelled: boolean): void {
    if (drag === null || e.pointerId !== drag.pointerId) return;
    const { panelHost, exceededThreshold, dropTarget, grabOffsetXPx, grabOffsetYPx } = drag;

    stopAutoScroll();
    try { panelHost.grip.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    panelHost.grip.style.cursor = 'grab';
    hidePlaceholder();
    highlightSidebar(null);
    panelHost.host.style.opacity = '';
    panelHost.host.style.pointerEvents = '';

    const wasDragging = exceededThreshold;
    const target = dropTarget;
    const rootRect = root.getBoundingClientRect();
    const dropX = e.clientX - rootRect.left - grabOffsetXPx;
    const dropY = e.clientY - rootRect.top - grabOffsetYPx;
    drag = null;

    if (!wasDragging) {
      // A click on the grip that never moved: restore the original layout
      // (nothing was lifted) and deliberately do nothing else — in particular
      // it must not toggle the panel's collapse state.
      applyLayout(layout);
      return;
    }

    if (cancelled || target === null) {
      applyLayout(layout);
      return;
    }

    if (target.kind === 'dock') {
      if (!callbacks.isSidebarVisible(target.side)) callbacks.onRequestRevealSidebar(target.side);
      applyAndCommit(dockPanel(layout, panelHost.id, target.side, target.index));
      return;
    }

    const pos = clampFloatingPanelPosition(dropX, dropY, rootRect.width, rootRect.height);
    const wasFloating = getPanelLocation(layout, panelHost.id)?.kind === 'floating';
    applyAndCommit(wasFloating
      ? moveFloatingPanel(layout, panelHost.id, pos.xPx, pos.yPx)
      : floatPanel(layout, panelHost.id, pos.xPx, pos.yPx));
  }

  function onPointerUp(e: PointerEvent): void { finishDrag(e, false); }
  function onPointerCancel(e: PointerEvent): void { finishDrag(e, true); }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);

  // ── Viewport resize re-clamp ──────────────────────────────────────────────
  function onResize(): void {
    const rootRect = root.getBoundingClientRect();
    const result = clampAllFloatingPanels(layout, rootRect.width, rootRect.height);
    if (result.changed) applyAndCommit(result.layout);
  }
  window.addEventListener('resize', onResize);

  applyLayout(layout);

  return {
    applyLayout,
    getLayout: () => layout,
    getFloatingPanelRects: (): EditorUIRect[] => {
      const rects: EditorUIRect[] = [];
      for (const id of EDITOR_PANEL_IDS) {
        if (layout.floating[id] === undefined) continue;
        const panelHost = hosts.get(id);
        if (panelHost === undefined) continue;
        const r = panelHost.host.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        rects.push({ xPx: r.left, yPx: r.top, widthPx: r.width, heightPx: r.height });
      }
      return rects;
    },
    isDragging: () => drag !== null && drag.exceededThreshold,
    destroy: () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('resize', onResize);
      if (drag !== null) {
        stopAutoScroll();
        drag = null;
      }
      hidePlaceholder();
      hosts.clear();
      if (floatingLayer.parentElement !== null) floatingLayer.parentElement.removeChild(floatingLayer);
    },
  };
}
