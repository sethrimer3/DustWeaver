/**
 * Editor UI — toolbar, palette panel, and export controls.
 * All DOM elements are created dynamically and removed on cleanup.
 *
 * The per-element property inspector panel is delegated to editorInspector.ts.
 */

import {
  EditorState, EditorTool, PaletteCategory, PALETTE_ITEMS,
  PALETTE_CATEGORIES, PALETTE_CATEGORY_LABELS,
  BLOCK_THEMES, BACKGROUND_OPTIONS,
  BlockTheme, SONG_OPTIONS, RoomSongId,
  RoomEdge, EditorUICallbacks, BrushMode, BlockPlacementModifier,
  CRUMBLE_VARIANT_OPTIONS, CrumbleVariant, PaletteItem,
} from './editorState';
import {
  addDimField,
} from './editorFormWidgets';
import { PANEL_BG, PANEL_BORDER, ACTIVE_BG, BTN_BG, TEXT_COLOR, ACCENT_GOLD } from './editorStyles';
import {
  makeBtn, makeEdgeBtn, makeThemeChip, makeThemeSlot,
  makeBlockPreviewCard, createCollapsibleSection,
  type CollapsibleSection,
} from './editorUIHelpers';
import { makePalettePreviewCard, auditPalettePreviews } from './editorPalettePreview';
import { updateInspector } from './editorInspector';
import { createEditorSpecialItemPickers } from './editorSpecialItemPickers';
import { createEditorLightingPanel } from './editorUILightingPanel';
import { createEditorLayersPanel } from './editorUILayersPanel';
import { editorPerfCounters } from './editorPerfCounters';
import type { TheroBackgroundEffect } from '../render/effects/theroBackgroundEffect';
import { createPrologueShapeEffect } from '../render/effects/prologueShapeEffect';
import { createVermiculateEffect } from '../render/effects/vermiculateEffect';
import { createGravityGridEffect } from '../render/effects/gravityGridEffect';
import { createEulerFluidEffect } from '../render/effects/eulerFluidEffect';
import { createFloaterLatticeEffect } from '../render/effects/floaterLatticeEffect';
import { createTetrisBlockEffect } from '../render/effects/tetrisBlockEffect';
import { createSubstrateEffect } from '../render/effects/substrateEffect';
import type { BackgroundId } from '../levels/roomDef';
import { createComplexityGate } from './editorContentRevision';
import { dominantCategory, ROOM_COMPLEXITY_CATEGORY_LABELS, type RoomComplexitySeverity } from '../levels/roomComplexity';
import {
  computeDensityDisplaySignature, capitalizeSeverity, formatDensityTotalLine, formatDensitySuffixLine,
} from './editorDensityIndicatorFormat';
import {
  computeToolSig, computeBrushSig, computeCategorySig, computePaletteSelectionSig,
  computeBlockModifierSig, computePaletteStructureSig,
  computeInspectorIdentitySig, inspectorIdentitySigEquals, type InspectorIdentitySig,
} from './editorUISignatures';
import {
  createEditorPanelDocking, type EditorDockablePanelRegistration,
} from './editorPanelDocking';
import { defaultPanelLayout, type EditorPanelLayout } from './editorPanelLayout';
import { clampAllFloatingPanels, type EditorUIRect } from './editorFloatingGeometry';

// ── UI container ─────────────────────────────────────────────────────────────

export interface EditorWorkspaceUIPrefs {
  layerPanelCollapsed: boolean;
  /** Left sidebar shell's scrollTop. */
  leftSidebarScrollTop: number;
  /** Right sidebar shell's scrollTop. */
  rightSidebarScrollTop: number;
  /** Dockable panel arrangement (sidebar membership/order + floating windows). */
  panelLayout: EditorPanelLayout;
  /** Whether the two content groups are swapped between left/right physical shells. */
  sidebarsSwapped: boolean;
  sectionExpanded: Record<string, boolean>;
  leftSidebarVisible: boolean;
  rightSidebarVisible: boolean;
}

/**
 * In-memory, controller-owned snapshot of UI state used for an immediate
 * close/reopen within the same app session:
 * every collapsible section's expanded/collapsed state (keyed by the stable
 * `key` passed to createCollapsibleSection) plus each sidebar's
 * visible/hidden state. Survives editor close/reopen within the same
 * running app session. The same durable subset is also written to the separate,
 * per-campaign `EditorWorkspaceUIPrefs` above so it survives a full app restart;
 * neither representation enters room JSON or undo history.
 */
export interface EditorSessionUIState {
  sectionExpanded: Record<string, boolean>;
  leftSidebarVisible: boolean;
  rightSidebarVisible: boolean;
  /** Optional for backward compatibility with snapshots captured before the
   * Swap Menu Sides control existed; missing = unswapped default. */
  sidebarsSwapped?: boolean;
}

export interface EditorUI {
  container: HTMLDivElement;
  /** Update UI to reflect current editor state. */
  update: (state: EditorState) => void;
  /** Set callbacks. */
  setCallbacks: (cbs: EditorUICallbacks) => void;
  destroy: () => void;
  /** Applies restored Phase 6 workspace UI preferences (layer-panel collapse, sidebar scroll). */
  applyWorkspaceUIPrefs: (prefs: EditorWorkspaceUIPrefs) => void;
  /** Reads the current live collapse/scroll state, for saving workspace preferences. */
  getWorkspaceUIPrefsSnapshot: () => EditorWorkspaceUIPrefs;
  /** Current sidebar visibility, read once per frame by the controller to build hit-region params. */
  getSidebarVisibility: () => { left: boolean; right: boolean };
  /**
   * Screen-space rectangles of visible floating panel windows, read once per
   * frame by the controller and passed through the pure hit-region functions
   * so every canvas gesture is blocked beneath a floating panel. Deliberately
   * a per-frame snapshot rather than a per-operation DOM query.
   */
  getFloatingPanelRects: () => EditorUIRect[];
  /** True while a panel is being dragged — the controller must not start/continue a canvas gesture. */
  isPanelDragActive: () => boolean;
  /** Notified after any completed panel layout change so the controller can persist it. */
  setPanelLayoutChangeHandler: (handler: (layout: EditorPanelLayout) => void) => void;
  /** Reads the current live section-collapse + sidebar-visibility state, for the controller's in-memory session snapshot. */
  getSessionUIStateSnapshot: () => EditorSessionUIState;
  /** Applies a restored in-memory session snapshot (no-op for keys not present, e.g. first-ever open). */
  applySessionUIState: (snapshot: EditorSessionUIState) => void;
}

// Re-export shared types so consumers that already import from editorUI.ts
// continue to work without change.
export type { RoomEdge, EditorUICallbacks } from './editorState';
import { t } from '../i18n';

export function createEditorUI(
  root: HTMLElement,
  campaignTitle?: string | null,
  initialAutosaveWork = false,
): EditorUI {
  let callbacks: EditorUICallbacks | null = null;
  let animatedBackgroundPreviewCanvases: HTMLCanvasElement[] = [];
  const animatedBackgroundPreviewEffects = new WeakMap<HTMLCanvasElement, TheroBackgroundEffect>();
  let animatedBackgroundPreviewFrame: number | null = null;

  // Two independent 260px sidebars. `container` (left) carries title/save
  // controls, the Zone Map / Itemized Map row, room/global settings, layers,
  // inspector, and export. `rightSidebar` carries tools, brush controls,
  // category tabs, the active palette, and placement-specific pickers/modifiers.
  const container = document.createElement('div');
  container.id = 'editor-ui';
  container.style.cssText = `
    position: absolute; top: 0; left: 0; width: 260px; height: 100%;
    background: ${PANEL_BG}; border-right: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; font-family: 'Cinzel', monospace; font-size: 12px;
    overflow-y: auto; z-index: 900; padding: 10px; box-sizing: border-box;
    pointer-events: auto;
  `;

  const rightSidebar = document.createElement('div');
  rightSidebar.id = 'editor-ui-right';
  rightSidebar.style.cssText = `
    position: absolute; top: 0; right: 0; width: 260px; height: 100%;
    background: ${PANEL_BG}; border-left: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; font-family: 'Cinzel', monospace; font-size: 12px;
    overflow-y: auto; z-index: 900; padding: 10px; box-sizing: border-box;
    pointer-events: auto;
  `;

  // Prevent UI interaction from leaking to global window/canvas listeners
  function isolateUIEvents(el: HTMLElement): void {
    el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: false });
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 1) e.preventDefault(); // block browser auto-scroll
      e.stopPropagation();
    });
  }
  isolateUIEvents(container);
  isolateUIEvents(rightSidebar);


  // ── Sidebar hide/reveal — each sidebar operates fully independently ────────
  // Hiding a sidebar leaves a small reveal tab at that screen edge (its arrow
  // pointing inward, toward the canvas) which re-shows it when clicked.
  // Visibility itself is read by the controller once per frame
  // (getSidebarVisibility) to build the shared editorUIHitRegions params, so
  // a hidden sidebar's old screen region becomes fully interactive again.
  let leftSidebarVisible = true;
  let rightSidebarVisible = true;

  function makeRevealTab(side: 'left' | 'right', arrow: string, onClick: () => void): HTMLButtonElement {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.textContent = arrow;
    tab.title = `Show ${side} panel`;
    tab.setAttribute('aria-label', `Show ${side} panel`);
    tab.style.cssText = `
      position: absolute; top: 10px; ${side}: 0; ${side === 'left' ? 'border-left: none;' : 'border-right: none;'}
      width: 22px; height: 34px; display: none; z-index: 900;
      background: ${PANEL_BG}; border: 1px solid ${PANEL_BORDER}; border-radius: ${side === 'left' ? '0 4px 4px 0' : '4px 0 0 4px'};
      color: ${TEXT_COLOR}; font-size: 12px; cursor: pointer; padding: 0;
      pointer-events: auto;
    `;
    tab.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return tab;
  }
  const leftRevealTab = makeRevealTab('left', '▸', () => setLeftSidebarVisible(true));
  const rightRevealTab = makeRevealTab('right', '◂', () => setRightSidebarVisible(true));

  function makeHideArrow(arrow: string, title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = arrow;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.style.cssText = `
      width: 22px; height: 20px; padding: 0; margin-bottom: 4px;
      background: ${BTN_BG}; border: 1px solid ${PANEL_BORDER}; border-radius: 3px;
      color: ${TEXT_COLOR}; font-size: 11px; cursor: pointer; float: right;
    `;
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return btn;
  }
  const leftHideArrow = makeHideArrow('◂', 'Hide left panel', () => setLeftSidebarVisible(false));
  const rightHideArrow = makeHideArrow('▸', 'Hide right panel', () => setRightSidebarVisible(false));

  // ── Swap Menu Sides ────────────────────────────────────────────────────────
  // Two stable content-group wrappers hold everything except the physical
  // hide-arrow/reveal-tab chrome above. Swapping moves these wrapper elements
  // (not their children) between the fixed left/right shells, so DOM
  // identity, focus, scroll position, and any per-node state survive.
  const leftContentGroup = document.createElement('div');
  const rightContentGroup = document.createElement('div');
  let sidebarsSwapped = false;

  function makeSwapBtn(title: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '⇄';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.style.cssText = `
      width: 22px; height: 20px; padding: 0; margin-bottom: 4px; margin-right: 4px;
      background: ${BTN_BG}; border: 1px solid ${PANEL_BORDER}; border-radius: 3px;
      color: ${TEXT_COLOR}; font-size: 11px; cursor: pointer; float: right;
    `;
    btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return btn;
  }
  function swapMenuSides(): void {
    sidebarsSwapped = !sidebarsSwapped;
    const leftHost = sidebarsSwapped ? rightSidebar : container;
    const rightHost = sidebarsSwapped ? container : rightSidebar;
    // Insert after the hide arrow / swap button chrome already in each shell.
    leftHost.appendChild(leftContentGroup);
    rightHost.appendChild(rightContentGroup);
    callbacks?.onWorkspaceUIChange?.();
  }
  const leftSwapBtn = makeSwapBtn('Swap Menus', swapMenuSides);
  const rightSwapBtn = makeSwapBtn('Swap Menus', swapMenuSides);
  container.appendChild(leftHideArrow);
  container.appendChild(leftSwapBtn);
  rightSidebar.appendChild(rightHideArrow);
  rightSidebar.appendChild(rightSwapBtn);
  // Default (unswapped) arrangement: left group in the left shell, right
  // group in the right shell. All later `leftContentGroup`/
  // `rightContentGroup` appendChild calls below populate these wrappers
  // while they're already attached here.
  container.appendChild(leftContentGroup);
  rightSidebar.appendChild(rightContentGroup);

  function setLeftSidebarVisible(visible: boolean): void {
    if (leftSidebarVisible === visible) return;
    leftSidebarVisible = visible;
    container.style.display = visible ? '' : 'none';
    leftRevealTab.style.display = visible ? 'none' : 'block';
    callbacks?.onWorkspaceUIChange?.();
  }
  function setRightSidebarVisible(visible: boolean): void {
    if (rightSidebarVisible === visible) return;
    rightSidebarVisible = visible;
    rightSidebar.style.display = visible ? '' : 'none';
    rightRevealTab.style.display = visible ? 'none' : 'block';
    callbacks?.onWorkspaceUIChange?.();
  }

  // ── Title ────────────────────────────────────────────────────────────────
  // Built from DOM nodes (not innerHTML) so an authored campaign title can
  // never be interpreted as markup.
  const title = document.createElement('div');
  if (campaignTitle) {
    title.appendChild(document.createTextNode(t('editor.customCampaignTitle')));
    title.appendChild(document.createElement('br'));
    const subtitle = document.createElement('span');
    subtitle.style.cssText = 'font-size: 11px; color: #ffcc66; font-weight: normal;';
    subtitle.textContent = campaignTitle;
    title.appendChild(subtitle);
  } else {
    title.textContent = t('editor.zoneEditorTitle');
  }
  title.style.cssText = `font-size: 15px; color: ${ACCENT_GOLD}; margin-bottom: 7px; font-weight: bold;`;
  leftContentGroup.appendChild(title);

  // ── Autosave Work ───────────────────────────────────────────────────────
  // This is working-session persistence only. It commits rooms as the author
  // leaves them, but deliberately does not export the campaign.
  const autosaveLabel = document.createElement('label');
  autosaveLabel.style.cssText = `
    display: flex; align-items: center; gap: 7px; margin-bottom: 10px;
    color: #f1e7cb; font-size: 11px; cursor: pointer; user-select: none;
  `;
  const autosaveCheckbox = document.createElement('input');
  autosaveCheckbox.type = 'checkbox';
  autosaveCheckbox.checked = initialAutosaveWork;
  autosaveCheckbox.style.cssText = `accent-color: ${ACCENT_GOLD}; cursor: pointer;`;
  autosaveLabel.appendChild(autosaveCheckbox);
  autosaveLabel.appendChild(document.createTextNode(t('editor.autosaveWork')));
  leftContentGroup.appendChild(autosaveLabel);

  // ── Confirm / Cancel bar ─────────────────────────────────────────────────
  const confirmCancelBar = document.createElement('div');
  confirmCancelBar.style.cssText = 'display: flex; gap: 4px; margin-bottom: 10px;';

  const confirmBtn = makeBtn(t('editor.saveAndTest'), () => callbacks?.onConfirm());
  confirmBtn.style.cssText += `
    flex: 1.35; padding: 8px 4px; font-size: 11px;
    background: rgba(212,168,75,0.4); border-color: ${ACCENT_GOLD}; color: ${ACCENT_GOLD};
  `;
  confirmCancelBar.appendChild(confirmBtn);

  let isCancelConfirmationPending = false;
  const saveBtn = makeBtn(t('editor.save'), () => {
    isCancelConfirmationPending = false;
    cancelBtn.textContent = t('editor.cancel');
    callbacks?.onSave();
  });
  saveBtn.style.cssText += `
    flex: 0.85; padding: 8px 4px; font-size: 11px;
    background: rgba(30,70,120,0.5); border-color: #55aaff; color: #55aaff;
  `;
  confirmCancelBar.appendChild(saveBtn);

  function applyAutosaveWorkVisualState(enabled: boolean): void {
    confirmBtn.textContent = enabled ? t('editor.test') : t('editor.saveAndTest');
    saveBtn.disabled = enabled;
    saveBtn.style.background = enabled ? 'rgba(70,70,70,0.45)' : 'rgba(30,70,120,0.5)';
    saveBtn.style.borderColor = enabled ? '#777' : '#55aaff';
    saveBtn.style.color = enabled ? '#888' : '#55aaff';
    saveBtn.style.cursor = enabled ? 'not-allowed' : 'pointer';
    saveBtn.setAttribute('aria-disabled', String(enabled));
  }
  autosaveCheckbox.addEventListener('change', () => {
    applyAutosaveWorkVisualState(autosaveCheckbox.checked);
    callbacks?.onAutosaveWorkChange(autosaveCheckbox.checked);
  });
  applyAutosaveWorkVisualState(initialAutosaveWork);

  const cancelBtn = makeBtn(t('editor.cancel'), () => {
    if (!isCancelConfirmationPending) {
      isCancelConfirmationPending = true;
      cancelBtn.textContent = t('editor.confirmQuestion');
      return;
    }
    callbacks?.onCancel();
  });
  cancelBtn.style.cssText += `
    flex: 0.85; padding: 8px 4px; font-size: 11px;
    background: rgba(100,30,20,0.4); border-color: #ff6644; color: #ff6644;
  `;
  confirmCancelBar.appendChild(cancelBtn);
  leftContentGroup.appendChild(confirmCancelBar);

  // ── Save and Export Campaign button ──────────────────────────────────────
  // Always shows "Save and Export Campaign" regardless of whether this is a custom
  // campaign session or the main DustWeaver campaign.
  const exportAllBtn = makeBtn('📦 Save and Export Campaign', () => callbacks?.onExportCampaignJson?.());
  exportAllBtn.style.cssText += `
    width: 100%; padding: 8px; font-size: 12px; margin-bottom: 10px;
    background: rgba(30,70,120,0.5); border-color: #55aaff; color: #55aaff;
  `;
  leftContentGroup.appendChild(exportAllBtn);

  // ── Zone Map / Itemized Map row ──────────────────────────────────────────
  // Replaces the old detached top-right "Zone Map" bar — reuses the same
  // existing callbacks (onOpenVisualMap / onOpenWorldMap), which are also
  // bound to the M / N keyboard shortcuts (see editorKeyboardShortcuts.ts).
  const mapButtonRow = document.createElement('div');
  mapButtonRow.style.cssText = 'display: flex; gap: 4px; margin-bottom: 10px;';
  const zoneMapBtn = makeBtn('🗺 Zone Map (M)', () => callbacks?.onOpenVisualMap());
  zoneMapBtn.style.cssText += `
    flex: 1; padding: 7px 4px; font-size: 11px;
    background: rgba(212,168,75,0.6); border-color: rgba(212,168,75,0.6); color: ${ACCENT_GOLD};
  `;
  mapButtonRow.appendChild(zoneMapBtn);
  const itemizedMapBtn = makeBtn('📋 Itemized Map (N)', () => callbacks?.onOpenWorldMap());
  itemizedMapBtn.style.cssText += `
    flex: 1; padding: 7px 4px; font-size: 11px;
    background: rgba(212,168,75,0.6); border-color: rgba(212,168,75,0.6); color: ${ACCENT_GOLD};
  `;
  mapButtonRow.appendChild(itemizedMapBtn);
  leftContentGroup.appendChild(mapButtonRow);

  // ── Room density indicator ───────────────────────────────────────────────
  // Lightweight, non-modal readout of the current room's estimated
  // performance cost (see levels/roomComplexity.ts for the analyzer).
  const DENSITY_SEVERITY_COLORS: Record<RoomComplexitySeverity, string> = {
    normal: '#88cc88',
    elevated: '#ffcc66',
    high: '#ff9944',
    extreme: '#ff5544',
  };
  const densityIndicator = document.createElement('div');
  densityIndicator.style.cssText = `
    font-size: 10.5px; color: #aaaaaa; margin-bottom: 10px; line-height: 1.5;
    padding: 4px 6px; border: 1px solid rgba(255,255,255,0.08); border-radius: 3px;
  `;
  // Built once as static DOM nodes (no innerHTML) — update() only patches
  // .textContent/.style.color on these when the underlying values change
  // (see lastDensitySig below), instead of rebuilding every frame.
  const densityTotalLine = document.createTextNode('');
  const densitySeverityLabelLine = document.createTextNode('Severity: ');
  const densitySeveritySpan = document.createElement('span');
  densitySeveritySpan.style.fontWeight = 'bold';
  const densitySuffixLine = document.createTextNode('');
  densityIndicator.appendChild(densityTotalLine);
  densityIndicator.appendChild(document.createElement('br'));
  densityIndicator.appendChild(densitySeverityLabelLine);
  densityIndicator.appendChild(densitySeveritySpan);
  densityIndicator.appendChild(densitySuffixLine);
  leftContentGroup.appendChild(densityIndicator);
  let lastDensitySig = '';
  // Cache the last room-complexity analysis, keyed on room identity + the
  // controller's roomContentRevision counter, so an idle editor (no
  // structural change since the last completed edit) doesn't re-run
  // analyzeEditorRoomComplexity every single frame.
  // The gate itself lives in editorContentRevision.ts so its cadence is
  // unit-testable without building this panel's DOM.
  const complexityGate = createComplexityGate();

  if (import.meta.env.DEV) {
    const devToolsDiv = document.createElement('div');
    devToolsDiv.style.cssText = `
      border: 1px solid rgba(255,204,102,0.45); border-radius: 3px;
      padding: 6px 8px; margin-bottom: 10px; background: rgba(35,25,0,0.3);
    `;
    const devToolsTitle = document.createElement('div');
    devToolsTitle.textContent = t('editor.devRoomChecks');
    devToolsTitle.style.cssText = 'font-size: 11px; color: #ffcc66; margin-bottom: 6px; font-weight: bold;';
    devToolsDiv.appendChild(devToolsTitle);

    const auditBtn = makeBtn('Room Audit', () => callbacks?.onRunRoomAudit?.());
    auditBtn.style.cssText += `
      width: 100%; padding: 6px 8px; font-size: 11px; margin-bottom: 4px;
      background: rgba(90,65,0,0.45); border-color: #ffcc66; color: #ffdd88;
    `;
    devToolsDiv.appendChild(auditBtn);

    const roundTripBtn = makeBtn('Round-trip Validate Rooms', () => callbacks?.onRunRoomRoundTripValidation?.());
    roundTripBtn.style.cssText += `
      width: 100%; padding: 6px 8px; font-size: 11px;
      background: rgba(90,65,0,0.45); border-color: #ffcc66; color: #ffdd88;
    `;
    devToolsDiv.appendChild(roundTripBtn);

    leftContentGroup.appendChild(devToolsDiv);
  }

  // Run the one-time palette-preview audit at editor init time.
  // auditPalettePreviews is a no-op in production builds (internal DEV guard).
  auditPalettePreviews(PALETTE_ITEMS);

  // ── Tool buttons ─────────────────────────────────────────────────────────
  const toolBar = document.createElement('div');
  toolBar.style.cssText = 'display: flex; gap: 4px; margin-bottom: 10px;';

  const tools: { tool: EditorTool; label: string; key: string }[] = [
    { tool: EditorTool.Select, label: '↖ Select', key: '1' },
    { tool: EditorTool.Place, label: '+ Place', key: '2' },
    { tool: EditorTool.Delete, label: '✕ Delete', key: '3' },
  ];
  const toolBtns: HTMLButtonElement[] = [];
  for (const t of tools) {
    const btn = makeBtn(`${t.label} (${t.key})`, () => callbacks?.onToolChange(t.tool));
    btn.dataset.tool = t.tool;
    toolBtns.push(btn);
    toolBar.appendChild(btn);
  }
  const sectionOptions = (key: string, defaultExpanded = false) => ({
    key,
    defaultExpanded,
    onExpandedChange: () => callbacks?.onWorkspaceUIChange?.(),
  });
  const toolsSection = createCollapsibleSection('Tools', sectionOptions('tools', true));
  toolsSection.body.appendChild(toolBar);

  // ── Brush mode selector ──────────────────────────────────────────────────
  const brushRow = document.createElement('div');
  brushRow.style.cssText = `
    display: flex; gap: 4px; margin-bottom: 10px; align-items: center;
  `;
  const brushLabel = document.createElement('span');
  brushLabel.textContent = t('editor.brushLabel');
  brushLabel.style.cssText = `font-size: 11px; color: rgba(241,231,203,0.7); min-width: 38px;`;
  brushRow.appendChild(brushLabel);

  const brushModes: { mode: BrushMode; label: string }[] = [
    { mode: 'single', label: '1' },
    { mode: '3x3',   label: '3×3' },
    { mode: '5x5',   label: '5×5' },
    { mode: 'rect',  label: '▭' },
    { mode: 'fill',  label: '⛃' },
  ];
  const brushBtns: HTMLButtonElement[] = [];
  for (const { mode, label } of brushModes) {
    const btn = makeBtn(label, () => callbacks?.onBrushModeChange(mode));
    btn.dataset.brushMode = mode;
    btn.style.cssText += `flex: 1; font-size: 11px; padding: 3px 4px;`;
    brushBtns.push(btn);
    brushRow.appendChild(btn);
  }
  const brushSection = createCollapsibleSection('Brush', sectionOptions('brush', true));
  brushSection.body.appendChild(brushRow);
  const roomDimDiv = document.createElement('div');

  // Edge resize buttons (add/remove row/column from each edge)
  const edgeResizeDiv = document.createElement('div');
  edgeResizeDiv.style.cssText = `margin-top: 6px;`;

  const edgeResizeTitle = document.createElement('div');
  edgeResizeTitle.textContent = t('editor.edgeResizeTitle');
  edgeResizeTitle.style.cssText = `font-size: 10px; color: rgba(241,231,203,0.5); margin-bottom: 4px;`;
  edgeResizeDiv.appendChild(edgeResizeTitle);

  const edges: { edge: RoomEdge; label: string }[] = [
    { edge: 'top', label: 'Top' },
    { edge: 'bottom', label: 'Bottom' },
    { edge: 'left', label: 'Left' },
    { edge: 'right', label: 'Right' },
  ];
  for (const { edge, label } of edges) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; gap: 4px; margin-bottom: 2px;';

    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = `min-width: 50px; font-size: 11px; color: rgba(241,231,203,0.7);`;
    row.appendChild(lbl);

    const addBigBtn = makeEdgeBtn('+5', () => callbacks?.onEdgeResize(edge, 5));
    const addBtn = makeEdgeBtn('+', () => callbacks?.onEdgeResize(edge, 1));
    const removeBtn = makeEdgeBtn('−', () => callbacks?.onEdgeResize(edge, -1));
    const removeBigBtn = makeEdgeBtn('−5', () => callbacks?.onEdgeResize(edge, -5));
    row.appendChild(addBigBtn);
    row.appendChild(addBtn);
    row.appendChild(removeBtn);
    row.appendChild(removeBigBtn);
    edgeResizeDiv.appendChild(row);
  }
  roomDimDiv.appendChild(edgeResizeDiv);

  const roomDimSection = createCollapsibleSection('Room Dimensions', sectionOptions('roomDimensions'));
  roomDimSection.body.appendChild(roomDimDiv);

  // ── Background picker ────────────────────────────────────────────────────
  const bgDiv = document.createElement('div');
  const bgCurrentBtn = document.createElement('button');
  bgCurrentBtn.type = 'button';
  bgCurrentBtn.style.cssText = `
    width: 100%; height: 58px; position: relative; overflow: hidden; cursor: pointer;
    border: 1px solid ${PANEL_BORDER}; border-radius: 3px; padding: 0;
    background: #000; color: #fff; font-family: 'Cinzel', monospace;
  `;
  const bgCurrentLabel = document.createElement('span');
  bgCurrentLabel.style.cssText = `
    position: absolute; left: 6px; right: 6px; bottom: 5px; text-align: center;
    color: #fff; font-size: 11px; font-weight: bold; pointer-events: none;
    text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 0 #000;
  `;
  bgCurrentBtn.appendChild(bgCurrentLabel);
  const bgPickerPanel = document.createElement('div');
  bgPickerPanel.style.cssText = `
    display: none; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 6px;
    max-height: 300px; overflow-y: auto; padding-right: 2px;
  `;
  function findBackgroundOption(id: string) {
    return BACKGROUND_OPTIONS.find(opt => opt.id === id) ?? null;
  }
  function backgroundPreviewCss(option: { previewUrl: string | null; isProcedural?: boolean }): string {
    if (option.previewUrl !== null) {
      return `center / cover repeat url("${option.previewUrl}")`;
    }
    if (option.isProcedural) {
      return 'radial-gradient(circle at 50% 45%, rgba(90,255,190,0.45), rgba(0,0,0,0.96) 48%), #000';
    }
    return '#000';
  }
  function createAnimatedBackgroundPreviewEffect(backgroundId: BackgroundId): TheroBackgroundEffect | null {
    switch (backgroundId) {
      case 'crystallineCracks':
      case 'thero_ch6':
        return createSubstrateEffect();
      case 'thero_prologue':
        return createPrologueShapeEffect();
      case 'thero_ch1':
        return createVermiculateEffect();
      case 'thero_ch2':
        return createGravityGridEffect();
      case 'thero_ch3':
        return createEulerFluidEffect();
      case 'thero_ch4':
        return createFloaterLatticeEffect();
      case 'thero_ch5':
        return createTetrisBlockEffect();
      default:
        return null;
    }
  }
  function drawAnimatedBackgroundPreview(canvas: HTMLCanvasElement, nowMs: number): void {
    const backgroundId = canvas.dataset.backgroundId as BackgroundId | undefined;
    if (backgroundId === undefined) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const effect = animatedBackgroundPreviewEffects.get(canvas);
    if (effect === undefined) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    effect.update(nowMs, canvas.width, canvas.height);
    effect.draw(ctx);
  }
  function drawAnimatedBackgroundPreviews(nowMs: number): void {
    animatedBackgroundPreviewCanvases = animatedBackgroundPreviewCanvases.filter(canvas => canvas.isConnected);
    for (const canvas of animatedBackgroundPreviewCanvases) {
      drawAnimatedBackgroundPreview(canvas, nowMs);
    }
    animatedBackgroundPreviewFrame = requestAnimationFrame(drawAnimatedBackgroundPreviews);
  }
  function ensureAnimatedBackgroundPreviewLoop(): void {
    if (animatedBackgroundPreviewFrame !== null) return;
    animatedBackgroundPreviewFrame = requestAnimationFrame(drawAnimatedBackgroundPreviews);
  }
  function makeAnimatedBackgroundPreviewCanvas(backgroundId: BackgroundId, width: number, height: number): HTMLCanvasElement {
    const effect = createAnimatedBackgroundPreviewEffect(backgroundId);
    if (effect === null) {
      throw new Error(`No animated background preview effect for ${backgroundId}`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.dataset.backgroundId = backgroundId;
    canvas.style.cssText = `
      position: absolute; inset: 0; width: 100%; height: 100%;
      display: block; pointer-events: none; background: #000;
    `;
    animatedBackgroundPreviewCanvases.push(canvas);
    animatedBackgroundPreviewEffects.set(canvas, effect);
    ensureAnimatedBackgroundPreviewLoop();
    return canvas;
  }
  function syncCurrentBackgroundButton(backgroundId: string): void {
    const option = findBackgroundOption(backgroundId);
    bgCurrentLabel.textContent = option?.label ?? backgroundId;
    bgCurrentBtn.style.background = backgroundPreviewCss(option ?? { previewUrl: null });
    const existingCanvas = bgCurrentBtn.querySelector<HTMLCanvasElement>('canvas[data-current-background-preview="1"]');
    if (existingCanvas !== null) {
      existingCanvas.remove();
      animatedBackgroundPreviewCanvases = animatedBackgroundPreviewCanvases.filter(canvas => canvas !== existingCanvas);
    }
    if (option?.isProcedural) {
      const canvas = makeAnimatedBackgroundPreviewCanvas(option.id, 148, 58);
      canvas.dataset.currentBackgroundPreview = '1';
      bgCurrentBtn.insertBefore(canvas, bgCurrentLabel);
    }
  }
  function makeBackgroundPreviewButton(option: (typeof BACKGROUND_OPTIONS)[number]): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.backgroundId = option.id;
    btn.title = option.label;
    btn.style.cssText = `
      height: 64px; position: relative; overflow: hidden; cursor: pointer;
      border: 1px solid ${PANEL_BORDER}; border-radius: 3px; padding: 0;
      background: ${backgroundPreviewCss(option)}; color: #fff; font-family: 'Cinzel', monospace;
    `;
    if (option.isProcedural) {
      btn.appendChild(makeAnimatedBackgroundPreviewCanvas(option.id, 120, 64));
    }
    const label = document.createElement('span');
    label.textContent = option.label;
    label.style.cssText = `
      position: absolute; left: 5px; right: 5px; bottom: 4px; text-align: center;
      color: #fff; font-size: 10px; line-height: 1.05; font-weight: bold; pointer-events: none;
      text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 0 #000;
    `;
    btn.appendChild(label);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks?.onBackgroundChange(option.id);
    });
    return btn;
  }
  bgCurrentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    bgPickerPanel.style.display = bgPickerPanel.style.display === 'grid' ? 'none' : 'grid';
  });
  for (const opt of BACKGROUND_OPTIONS) {
    bgPickerPanel.appendChild(makeBackgroundPreviewButton(opt));
  }
  bgDiv.appendChild(bgCurrentBtn);
  bgDiv.appendChild(bgPickerPanel);

  const bgBlurLabel = document.createElement('label');
  bgBlurLabel.style.cssText = `
    display: flex; align-items: center; gap: 6px; margin-top: 6px;
    font-size: 11px; color: rgba(241,231,203,0.8); cursor: pointer;
  `;
  const bgBlurCheckbox = document.createElement('input');
  bgBlurCheckbox.type = 'checkbox';
  bgBlurCheckbox.addEventListener('change', () => {
    callbacks?.onBackgroundBlurChange(bgBlurCheckbox.checked);
  });
  bgBlurLabel.appendChild(bgBlurCheckbox);
  bgBlurLabel.appendChild(document.createTextNode('Use blurred version'));
  bgDiv.appendChild(bgBlurLabel);

  const bgSection = createCollapsibleSection('Background', sectionOptions('background'));
  bgSection.body.appendChild(bgDiv);

  // ── Room Song dropdown ───────────────────────────────────────────────────
  const songDiv = document.createElement('div');
  const songSelect = document.createElement('select');
  songSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  for (const opt of SONG_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    songSelect.appendChild(o);
  }
  songSelect.addEventListener('change', () => {
    callbacks?.onRoomSongChange(songSelect.value as RoomSongId);
  });
  songSelect.addEventListener('click', (e) => e.stopPropagation());
  songDiv.appendChild(songSelect);
  const songSection = createCollapsibleSection('Room Song', sectionOptions('roomSong'));
  songSection.body.appendChild(songDiv);

  // ── Layers panel (always visible — editor-only visibility/lock/solo/target) ──
  const layersPanel = createEditorLayersPanel(() => callbacks);

  // ── Category tabs ────────────────────────────────────────────────────────
  let lastRenderedRoomId = '';
  let lastRenderedWidthBlocks = -1;
  let lastRenderedHeightBlocks = -1;
  let lastRenderedBackgroundId = '';
  let lastRenderedSongId = '';
  let dimWidthInput: HTMLInputElement | null = null;
  let dimHeightInput: HTMLInputElement | null = null;
  const catBar = document.createElement('div');
  catBar.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 8px;';
  const categories: readonly PaletteCategory[] = PALETTE_CATEGORIES;
  const catBtns: HTMLButtonElement[] = [];
  for (const cat of categories) {
    const btn = makeBtn(PALETTE_CATEGORY_LABELS[cat], () => callbacks?.onCategoryChange(cat));
    btn.dataset.category = cat;
    btn.style.fontFamily = "'Cinzel', serif";
    catBtns.push(btn);
    catBar.appendChild(btn);
  }
  const categoriesSection = createCollapsibleSection('Categories', sectionOptions('categories', true));
  categoriesSection.body.appendChild(catBar);

  // ── Palette items ────────────────────────────────────────────────────────
  const paletteDiv = document.createElement('div');
  paletteDiv.style.cssText = 'margin-bottom: 12px;';
  const paletteSection = createCollapsibleSection('Palette', sectionOptions('palette', true));
  paletteSection.body.appendChild(paletteDiv);

  // Track rendered palette state to avoid recreating buttons every frame.
  // Single structural signature (computePaletteStructureSig) replaces the old
  // 3-variable (category/theme/recentThemes) comparison — it also folds in
  // the Custom Blocks registry so renames/property/usage changes rebuild
  // while that category stays open, which the old comparison missed.
  let lastPaletteStructureSig = '';
  /** Which theme slot (0-3) currently has its replace palette open, or null. */
  let themePaletteOpenForSlot: number | null = null;
  let paletteItems: { btn: HTMLElement; itemId: string }[] = [];
  /** Custom-block cards, keyed by "custom:<id>" — patched separately since
   *  their active/inactive colors differ from the ordinary ACTIVE_BG/BTN_BG pair. */
  let customBlockCards: { btn: HTMLElement; itemId: string }[] = [];
  let lastPaletteSelectionSig = '';
  let lastToolSig = '';
  let lastBrushSig = '';
  let lastCategorySig = '';
  let lastBlockModifierSig = '';
  let lastModifierEligible: boolean | null = null;
  let lastInspectorIdentitySig: InspectorIdentitySig = { uid: -1, type: '', count: 0, dialogueEntryCount: -1 };

  const specialItemPickers = createEditorSpecialItemPickers(() => callbacks);
  const lightingPanel = createEditorLightingPanel(() => callbacks);
  const blockModifierDiv = document.createElement('div');
  blockModifierDiv.style.cssText = `
    border: 1px solid rgba(120,180,220,0.45); border-radius: 3px;
    padding: 6px 8px; margin-top: 8px; background: rgba(0,15,25,0.35); display: none;
  `;
  const blockModifierTitle = document.createElement('div');
  blockModifierTitle.textContent = 'Block Modifier';
  blockModifierTitle.style.cssText = 'font-size: 11px; color: #8fc8ff; margin-bottom: 6px; font-weight: bold;';
  blockModifierDiv.appendChild(blockModifierTitle);
  const modifierInputs: HTMLInputElement[] = [];
  const fallingModifierRows: HTMLLabelElement[] = [];
  const modifierOptions: { id: BlockPlacementModifier; label: string; help: string; isFalling?: boolean }[] = [
    { id: 'cracked', label: 'Cracked',
      help: 'Places a crumble block: cracks on the first hit, then breaks apart on the second.' },
    { id: 'secret', label: 'Secret Block',
      help: 'Acts like a Cracked block, but regenerates when the player saves or returns after death.' },
    { id: 'tough', label: 'Falling: Tough',
      help: 'Falling block that only drops when hit by a strong downward force or a downward grapple pull.', isFalling: true },
    { id: 'sensitive', label: 'Falling: Sensitive',
      help: 'Falling block that drops from almost any contact.', isFalling: true },
    { id: 'crumbling', label: 'Falling: Crumbling',
      help: 'Falling block that drops like Sensitive, then disappears once it reaches full fall speed.', isFalling: true },
  ];
  function makeModifierRow(id: BlockPlacementModifier, label: string, help: string, isFalling?: boolean): void {
    const row = document.createElement('label');
    row.style.cssText = 'display: flex; align-items: center; gap: 6px; margin: 3px 0; font-size: 11px; cursor: pointer;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = id;
    input.dataset.modifier = id;
    input.addEventListener('change', () => {
      callbacks?.onBlockPlacementModifierChange(input.checked ? id : 'none');
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    modifierInputs.push(input);
    row.appendChild(input);
    const text = document.createElement('span');
    text.textContent = label;
    row.appendChild(text);
    const helpIcon = document.createElement('span');
    helpIcon.textContent = '(?)';
    helpIcon.title = help;
    helpIcon.style.cssText = 'color: rgba(143,200,255,0.75); cursor: help; font-size: 10px;';
    helpIcon.addEventListener('click', (e) => e.preventDefault());
    row.appendChild(helpIcon);
    blockModifierDiv.appendChild(row);
    if (isFalling) fallingModifierRows.push(row);
  }
  for (const opt of modifierOptions) makeModifierRow(opt.id, opt.label, opt.help, opt.isFalling);

  // The Falling modifier only produces plain rectangular EditorFallingBlock
  // tiles (no ramp/stairs/pillar/spike shape fields exist on that type), so
  // it is hidden for any shaped block item — those items still support the
  // Cracked (crumble) modifier, which does carry ramp/stairs/pillar/spike
  // shape fields on EditorCrumbleBlock. Keep in sync with the placement-time
  // guard in editorPlaceTool.ts's falling-modifier branch.
  function supportsFallingModifier(item: PaletteItem): boolean {
    return item.isStairsItem !== 1 && item.isSmoothRampItem !== 1 &&
      item.isPillarHalfWidthItem !== 1 && item.isSpikeItem !== 1 && item.isLaserItem !== 1;
  }
  let lastFallingModifierSupported: boolean | null = null;

  // ── Background modifier + subordinate "Blocks Ambient Light" checkbox ─────
  // Background is mutually exclusive with Cracked/Falling: it must never
  // produce a cracked, falling, or collidable block. Since
  // pendingBlockPlacementModifier is a single field, checking Background
  // automatically clears whichever of Cracked/Falling was active (and vice
  // versa) — see makeModifierRow's change handler and the row below.
  const bgModifierRow = document.createElement('label');
  bgModifierRow.style.cssText = 'display: flex; align-items: center; gap: 6px; margin: 3px 0; font-size: 11px; cursor: pointer;';
  const bgModifierInput = document.createElement('input');
  bgModifierInput.type = 'checkbox';
  bgModifierInput.dataset.modifier = 'background';
  bgModifierInput.addEventListener('click', (e) => e.stopPropagation());
  bgModifierInput.addEventListener('change', () => {
    callbacks?.onBlockPlacementModifierChange(bgModifierInput.checked ? 'background' : 'none');
  });
  modifierInputs.push(bgModifierInput);
  bgModifierRow.appendChild(bgModifierInput);
  const bgModifierText = document.createElement('span');
  bgModifierText.textContent = 'Background';
  bgModifierRow.appendChild(bgModifierText);
  const bgModifierHelp = document.createElement('span');
  bgModifierHelp.textContent = '(?)';
  bgModifierHelp.title = 'Places a visual-only Background Block (no collision, drawn 40% darker '
    + 'behind foreground walls) using the current block type\'s footprint and the active block '
    + 'theme, instead of an ordinary wall. Incompatible with Cracked and Falling — enabling '
    + 'Background clears those, since a background block can never be cracked, falling, or solid.';
  bgModifierHelp.style.cssText = 'color: rgba(143,200,255,0.75); cursor: help; font-size: 10px;';
  bgModifierHelp.addEventListener('click', (e) => e.preventDefault());
  bgModifierRow.appendChild(bgModifierHelp);
  blockModifierDiv.appendChild(bgModifierRow);

  const bgLightRow = document.createElement('label');
  bgLightRow.style.cssText = 'display: none; align-items: center; gap: 6px; margin: 3px 0 3px 18px; font-size: 11px; cursor: pointer;';
  const bgLightInput = document.createElement('input');
  bgLightInput.type = 'checkbox';
  bgLightInput.addEventListener('click', (e) => e.stopPropagation());
  bgLightInput.addEventListener('change', () => {
    callbacks?.onBackgroundBlocksLightChange(bgLightInput.checked);
  });
  bgLightRow.appendChild(bgLightInput);
  const bgLightText = document.createElement('span');
  bgLightText.textContent = 'BLOCKS AMBIENT LIGHT';
  bgLightRow.appendChild(bgLightText);
  const bgLightHelp = document.createElement('span');
  bgLightHelp.textContent = '(?)';
  bgLightHelp.title = 'When enabled, this background block also blocks ambient light propagation, '
    + 'same as the legacy light-blocking background blocks. Off by default.';
  bgLightHelp.style.cssText = 'color: rgba(143,200,255,0.75); cursor: help; font-size: 10px;';
  bgLightHelp.addEventListener('click', (e) => e.preventDefault());
  bgLightRow.appendChild(bgLightHelp);
  blockModifierDiv.appendChild(bgLightRow);

  const modifierCrumbleSelect = document.createElement('select');
  modifierCrumbleSelect.style.cssText = `
    width: 100%; margin-top: 6px; background: rgba(0,0,0,0.6);
    border: 1px solid rgba(143,200,255,0.4); color: ${TEXT_COLOR};
    padding: 4px 6px; font-size: 11px; font-family: monospace; border-radius: 2px;
    display: none;
  `;
  for (const opt of CRUMBLE_VARIANT_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    modifierCrumbleSelect.appendChild(o);
  }
  modifierCrumbleSelect.addEventListener('change', () => {
    callbacks?.onCrumbleVariantChange(modifierCrumbleSelect.value as CrumbleVariant);
  });
  modifierCrumbleSelect.addEventListener('click', (e) => e.stopPropagation());
  blockModifierDiv.appendChild(modifierCrumbleSelect);

  // ── Inspector ────────────────────────────────────────────────────────────
  const inspectorDiv = document.createElement('div');
  inspectorDiv.style.cssText = `
    border-top: 1px solid ${PANEL_BORDER}; padding-top: 10px; margin-top: 8px;
  `;
  // Placement-specific pickers/modifiers live in the right sidebar, alongside
  // the palette they modify.
  paletteSection.body.appendChild(specialItemPickers.skillTombPickerDiv);
  paletteSection.body.appendChild(blockModifierDiv);
  paletteSection.body.appendChild(specialItemPickers.crumblePickerDiv);
  paletteSection.body.appendChild(specialItemPickers.dustJarPickerDiv);

  const inspectorSection = createCollapsibleSection('Inspector', sectionOptions('inspector', true));
  inspectorSection.body.appendChild(inspectorDiv);

  // ── Export button ────────────────────────────────────────────────────────
  const exportBtn = makeBtn('📥 Export Room JSON', () => callbacks?.onExport());
  exportBtn.style.cssText += `
    width: 100%; padding: 10px; font-size: 13px;
    background: rgba(212,168,75,0.4); border-color: ${ACCENT_GOLD};
  `;
  const exportSection = createCollapsibleSection('Export', sectionOptions('export'));
  exportSection.body.appendChild(exportBtn);

  root.appendChild(container);
  root.appendChild(rightSidebar);
  root.appendChild(leftRevealTab);
  root.appendChild(rightRevealTab);

  // ── Dockable panel system ────────────────────────────────────────────────
  // Every top-level menu above is registered here rather than being appended
  // to a hardcoded sidebar; the docking controller owns placement from now
  // on and reflects whatever layout the workspace preferences restored.
  // Fixed chrome (title, save/confirm bar, campaign export, map row, density
  // indicator, dev checks, hide arrows, reveal tabs) is deliberately NOT
  // registered — it stays put in the left shell.
  const dockablePanelRegistrations: EditorDockablePanelRegistration[] = [
    { id: 'tools', element: toolsSection.wrapper },
    { id: 'brush', element: brushSection.wrapper },
    { id: 'categories', element: categoriesSection.wrapper },
    { id: 'palette', element: paletteSection.wrapper },
    { id: 'roomDimensions', element: roomDimSection.wrapper },
    { id: 'background', element: bgSection.wrapper },
    { id: 'roomSong', element: songSection.wrapper },
    // The layers panel participates through the same registration path as
    // every other panel — it deliberately does not carry a second drag
    // implementation of its own.
    { id: 'layers', element: layersPanel.div },
    { id: 'inspector', element: inspectorSection.wrapper },
    { id: 'export', element: exportSection.wrapper },
  ];

  /** True when the named content group currently sits in the physical left shell. */
  function isGroupInLeftShell(group: 'left' | 'right'): boolean {
    return group === 'left' ? !sidebarsSwapped : sidebarsSwapped;
  }

  let onPanelLayoutChanged: ((layout: EditorPanelLayout) => void) | null = null;
  const docking = createEditorPanelDocking(
    root,
    leftContentGroup,
    rightContentGroup,
    dockablePanelRegistrations,
    {
      onLayoutChanged: (next) => { onPanelLayoutChanged?.(next); },
      // The docking system's 'left'/'right' name the two *content groups*,
      // while sidebar visibility is a property of the two *physical shells*.
      // Swap Menu Sides can put the left group in the right shell, so both
      // callbacks resolve the group to whichever shell currently hosts it
      // rather than assuming they line up.
      onRequestRevealSidebar: (side) => {
        if (isGroupInLeftShell(side)) setLeftSidebarVisible(true);
        else setRightSidebarVisible(true);
      },
      isSidebarVisible: (side) => (isGroupInLeftShell(side) ? leftSidebarVisible : rightSidebarVisible),
    },
    defaultPanelLayout(),
  );

  // ── Session UI state registry ───────────────────────────────────────────
  // Every top-level collapsible section built above, keyed by its stable
  // `key`, plus the layers panel (which owns its own collapse state via
  // setCollapsed/isCollapsed rather than exposing a CollapsibleSection).
  const collapsibleSections: CollapsibleSection[] = [
    toolsSection, brushSection, roomDimSection, bgSection, songSection,
    categoriesSection, paletteSection, inspectorSection, exportSection,
  ];
  const LAYERS_SESSION_KEY = 'layers';

  function update(state: EditorState): void {
    editorPerfCounters.uiUpdates++;
    layersPanel.sync(state);

    // Update room density indicator — only touch the DOM when the displayed
    // values actually change. analyzeEditorRoomComplexity() itself is now
    // also revision-gated: it only re-runs when state.roomContentRevision
    // (bumped once per completed edit/undo/redo/load, never mid-drag) has
    // advanced since the last analysis, instead of every frame.
    if (state.roomData) {
      const report = complexityGate.resolve(
        state.roomData, state.roomData.id, state.roomContentRevision,
      );
      const topCategory = ROOM_COMPLEXITY_CATEGORY_LABELS[dominantCategory(report.categoryCounts)];
      const sig = computeDensityDisplaySignature(true, report.totalPlacedCount, report.severity, topCategory);
      if (sig !== lastDensitySig) {
        lastDensitySig = sig;
        densityTotalLine.textContent = formatDensityTotalLine(report.totalPlacedCount);
        densitySeveritySpan.textContent = capitalizeSeverity(report.severity);
        densitySeveritySpan.style.color = DENSITY_SEVERITY_COLORS[report.severity];
        densitySuffixLine.textContent = formatDensitySuffixLine(topCategory);
      }
    } else if (lastDensitySig !== '') {
      lastDensitySig = '';
      densityTotalLine.textContent = '';
      densitySeveritySpan.textContent = '';
      densitySuffixLine.textContent = '';
    }

    // Update tool highlight — only touch button styles when the active tool changed.
    const toolSig = computeToolSig(state);
    if (toolSig !== lastToolSig) {
      lastToolSig = toolSig;
      for (const btn of toolBtns) {
        btn.style.background = btn.dataset.tool === state.activeTool ? ACTIVE_BG : BTN_BG;
      }
    }
    // Update brush mode highlight — only when the brush mode changed.
    const brushSig = computeBrushSig(state);
    if (brushSig !== lastBrushSig) {
      lastBrushSig = brushSig;
      for (const btn of brushBtns) {
        btn.style.background = btn.dataset.brushMode === state.brushMode ? ACTIVE_BG : BTN_BG;
      }
    }
    // Update category highlight — only when the active category changed.
    const categorySig = computeCategorySig(state);
    if (categorySig !== lastCategorySig) {
      lastCategorySig = categorySig;
      for (const btn of catBtns) {
        btn.style.background = btn.dataset.category === state.activeCategory ? ACTIVE_BG : BTN_BG;
      }
    }

    // Update room dimensions section: create inputs on first load, then update values in-place
    const roomId = state.roomData?.id ?? '';
    const widthBlocks = state.roomData?.widthBlocks ?? 0;
    const heightBlocks = state.roomData?.heightBlocks ?? 0;
    if (roomId !== lastRenderedRoomId) {
      // Different room loaded — recreate inputs with correct callbacks
      lastRenderedRoomId = roomId;
      lastRenderedWidthBlocks = widthBlocks;
      lastRenderedHeightBlocks = heightBlocks;
      if (dimWidthInput) dimWidthInput.parentElement?.remove();
      if (dimHeightInput) dimHeightInput.parentElement?.remove();
      dimWidthInput = null;
      dimHeightInput = null;
      if (state.roomData !== null) {
        dimWidthInput = addDimField(roomDimDiv, 'Width (blocks)', widthBlocks,
          v => callbacks?.onRoomDimensionsChange('widthBlocks', v));
        dimHeightInput = addDimField(roomDimDiv, 'Height (blocks)', heightBlocks,
          v => callbacks?.onRoomDimensionsChange('heightBlocks', v));
      }
    } else if (widthBlocks !== lastRenderedWidthBlocks || heightBlocks !== lastRenderedHeightBlocks) {
      // Same room, dimensions changed externally — update values in-place (only if not focused)
      lastRenderedWidthBlocks = widthBlocks;
      lastRenderedHeightBlocks = heightBlocks;
      if (dimWidthInput && document.activeElement !== dimWidthInput) {
        dimWidthInput.value = String(widthBlocks);
      }
      if (dimHeightInput && document.activeElement !== dimHeightInput) {
        dimHeightInput.value = String(heightBlocks);
      }
    }

    // Update background picker
    const currentBgId = state.roomData?.backgroundId ?? 'brownRock';
    if (currentBgId !== lastRenderedBackgroundId) {
      lastRenderedBackgroundId = currentBgId;
      syncCurrentBackgroundButton(currentBgId);
      for (const btn of bgPickerPanel.querySelectorAll<HTMLButtonElement>('button[data-background-id]')) {
        const isSelected = btn.dataset.backgroundId === currentBgId;
        btn.style.borderColor = isSelected ? ACCENT_GOLD : PANEL_BORDER;
        btn.style.boxShadow = isSelected ? `0 0 0 1px ${ACCENT_GOLD} inset` : 'none';
      }
    }
    {
      const hasBlurAsset = findBackgroundOption(currentBgId)?.blurUrl != null;
      bgBlurCheckbox.disabled = !hasBlurAsset;
      const desiredChecked = hasBlurAsset && state.roomData?.backgroundBlur === true;
      if (bgBlurCheckbox.checked !== desiredChecked) bgBlurCheckbox.checked = desiredChecked;
    }

    // Update song dropdown
    const currentSongId = state.roomData?.songId ?? '_continue';
    if (currentSongId !== lastRenderedSongId) {
      lastRenderedSongId = currentSongId;
      if (document.activeElement !== songSelect) {
        songSelect.value = currentSongId;
      }
    }

    // Update palette area — recreate only when the structural signature
    // changes (category, block theme/slots, or — for Custom Blocks — the
    // registry/usage signature; see computePaletteStructureSig).
    const currentTheme = state.selectedBlockTheme;
    const currentLighting = state.roomData?.lightingEffect ?? 'DEFAULT';
    const paletteStructureSig = computePaletteStructureSig(state, themePaletteOpenForSlot);
    const needsPaletteRebuild = paletteStructureSig !== lastPaletteStructureSig;

    if (needsPaletteRebuild) {
      lastPaletteStructureSig = paletteStructureSig;
      // Preserve scroll position across a rebuild — a rebuild can happen
      // while the user is scrolled partway down a long palette (e.g. a
      // custom-block usage count changing elsewhere shouldn't jump them
      // back to the top).
      const savedPaletteScrollTop = paletteDiv.scrollTop;
      paletteDiv.replaceChildren();
      paletteItems = [];
      customBlockCards = [];

      if (state.activeCategory === 'blocks') {
        // ── Block theme slots ────────────────────────────────────────────────
        // 4 compact theme slots replace the old "Block Theme: All" interface.
        // Clicking a slot's body activates its theme; the small "⇄" replace
        // icon in the slot's corner opens the full theme palette below,
        // scoped to that slot (picking a theme there assigns it to the slot,
        // activates the slot, updates selectedBlockTheme, and closes the
        // palette).
        const themeSection = document.createElement('div');
        themeSection.style.cssText = `margin-bottom: 8px;`;
        const themeTitle = document.createElement('div');
        themeTitle.textContent = 'Block Theme';
        themeTitle.style.cssText = `font-size: 11px; color: rgba(241,231,203,0.7); margin-bottom: 5px;`;
        themeSection.appendChild(themeTitle);

        const slotRow = document.createElement('div');
        slotRow.style.cssText = `display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px;`;
        state.blockThemeSlots.forEach((slotThemeId, slotIndex) => {
          const th = BLOCK_THEMES.find(t => t.id === slotThemeId);
          const label = th?.label ?? slotThemeId;
          const isActiveSlot = slotIndex === state.activeBlockThemeSlotIndex;
          const slot = makeThemeSlot(
            slotThemeId,
            label,
            isActiveSlot,
            () => callbacks?.onBlockThemeSlotActivate(slotIndex),
            () => {
              themePaletteOpenForSlot = themePaletteOpenForSlot === slotIndex ? null : slotIndex;
              lastPaletteStructureSig = '';
            },
          );
          slotRow.appendChild(slot);
        });
        themeSection.appendChild(slotRow);

        if (themePaletteOpenForSlot !== null) {
          const targetSlot = themePaletteOpenForSlot;
          const paletteHeader = document.createElement('div');
          paletteHeader.textContent = 'Choose a theme to replace this slot:';
          paletteHeader.style.cssText = `font-size: 10px; color: rgba(241,231,203,0.6); margin-top: 6px; margin-bottom: 4px;`;
          themeSection.appendChild(paletteHeader);
          const themePaletteGrid = document.createElement('div');
          themePaletteGrid.style.cssText = `display: grid; grid-template-columns: 1fr 1fr; gap: 4px;`;
          for (const th of BLOCK_THEMES) {
            const chip = makeThemeChip(th.id, th.label, th.shortId, th.id === state.blockThemeSlots[targetSlot], () => {
              callbacks?.onBlockThemeSlotAssign(targetSlot, th.id as BlockTheme);
              themePaletteOpenForSlot = null;
              lastPaletteStructureSig = '';
            });
            themePaletteGrid.appendChild(chip);
          }
          themeSection.appendChild(themePaletteGrid);
        }
        paletteDiv.appendChild(themeSection);

        // ── Block type preview grid ─────────────────────────────────────────
        const gridTitle = document.createElement('div');
        gridTitle.textContent = 'Block Types';
        gridTitle.style.cssText = `font-size: 11px; color: rgba(241,231,203,0.7); margin-top: 8px; margin-bottom: 5px;`;
        paletteDiv.appendChild(gridTitle);

        const grid = document.createElement('div');
        grid.style.cssText = `
          display: grid; grid-template-columns: 1fr 1fr; gap: 5px;
        `;
        const blockItems = PALETTE_ITEMS.filter(i => i.category === 'blocks');
        for (const item of blockItems) {
          const card = makeBlockPreviewCard(item, currentTheme, () => {
            callbacks?.onPaletteItemSelect(item);
          });
          paletteItems.push({ btn: card, itemId: item.id });
          grid.appendChild(card);
        }
        paletteDiv.appendChild(grid);

      } else {
        // Non-blocks categories
        if (state.activeCategory === 'lighting') {
          lightingPanel.syncOnRebuild(state, currentLighting, paletteDiv);
        }
        const items = PALETTE_ITEMS.filter(i => i.category === state.activeCategory);

        // Custom blocks panel — generated dynamically from registry
        if (state.activeCategory === 'customBlocks') {
          const newBlocksRow = document.createElement('div');
          newBlocksRow.style.cssText = 'display:flex;gap:6px;margin-bottom:8px;';

          const new1x1Btn = document.createElement('button');
          new1x1Btn.textContent = '+ 1×1';
          new1x1Btn.style.cssText = 'flex:1;padding:5px;font-size:11px;cursor:pointer;border-radius:3px;background:#1a2a1a;border:1px solid #7fda7f;color:#7fda7f;font-family:monospace;';
          new1x1Btn.addEventListener('click', () => callbacks?.onCreateCustomBlock?.(1));

          const new2x2Btn = document.createElement('button');
          new2x2Btn.textContent = '+ 2×2';
          new2x2Btn.style.cssText = 'flex:1;padding:5px;font-size:11px;cursor:pointer;border-radius:3px;background:#1a2a1a;border:1px solid #7fda7f;color:#7fda7f;font-family:monospace;';
          new2x2Btn.addEventListener('click', () => callbacks?.onCreateCustomBlock?.(2));

          newBlocksRow.appendChild(new1x1Btn);
          newBlocksRow.appendChild(new2x2Btn);
          paletteDiv.appendChild(newBlocksRow);

          const registry = state.customBlockRegistry;
          if (registry.size === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'No custom blocks yet. Click + to create one.';
            empty.style.cssText = 'font-size:10px;color:#888;padding:8px 0;';
            paletteDiv.appendChild(empty);
          } else {
            for (const [rawId, def] of registry) {
              const usageCount = state.customBlockUsage.get(rawId) ?? 0;

              const blockCard = document.createElement('div');
              blockCard.style.cssText = `display:flex;flex-direction:column;gap:4px;padding:6px;margin-bottom:4px;
                border-radius:3px;background:#151525;border:1px solid #444;cursor:pointer;`;

              // Top row: preview + name/info
              const topRow = document.createElement('div');
              topRow.style.cssText = 'display:flex;align-items:center;gap:8px;';

              // Tiny sprite preview
              const previewCanvas = document.createElement('canvas');
              const previewSize = 24;
              previewCanvas.width = previewCanvas.height = previewSize;
              previewCanvas.style.cssText = 'border:1px solid #555;image-rendering:pixelated;flex-shrink:0;';
              const pCtx = previewCanvas.getContext('2d');
              if (pCtx) {
                pCtx.imageSmoothingEnabled = false;
                const img = new ImageData(new Uint8ClampedArray(def.pixelData.buffer as ArrayBuffer), def.pixelWidth, def.pixelHeight);
                const tmpC = document.createElement('canvas');
                tmpC.width = def.pixelWidth;
                tmpC.height = def.pixelHeight;
                const tmpX = tmpC.getContext('2d')!;
                tmpX.putImageData(img, 0, 0);
                pCtx.drawImage(tmpC, 0, 0, previewSize, previewSize);
              }
              topRow.appendChild(previewCanvas);

              // Name + footprint/id + usage
              const info = document.createElement('div');
              info.style.cssText = 'flex:1;overflow:hidden;';
              const nameEl = document.createElement('div');
              nameEl.textContent = def.name;
              nameEl.style.cssText = 'font-size:11px;color:#eee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
              const sizeEl = document.createElement('div');
              sizeEl.textContent = `${def.tileWidth}×${def.tileHeight}  id:${def.id}`;
              sizeEl.style.cssText = 'font-size:9px;color:#888;margin-top:1px;';
              const usageEl = document.createElement('div');
              usageEl.textContent = usageCount === 0 ? 'unused' : `used in ${usageCount} room${usageCount !== 1 ? 's' : ''}`;
              usageEl.style.cssText = `font-size:9px;color:${usageCount === 0 ? '#664444' : '#448844'};margin-top:1px;`;

              // Property indicators (collision / friction / breakability), one-letter badges with a tooltip.
              const propsEl = document.createElement('div');
              propsEl.style.cssText = 'font-size:9px;color:#8ab;margin-top:1px;';
              const collisionBadge = { solid: 'Solid', oneWay: '1-Way', nonSolid: 'Non-solid' }[def.properties.collision];
              const frictionBadge = def.properties.friction === 'slippery' ? ' · Slippery' : '';
              const breakBadge = def.properties.breakability === 'fragile' ? ' · Fragile' : '';
              const materialBadge = { stone: ' · Stone', wood: ' · Wood', metal: ' · Metal' }[def.properties.materialResponse];
              const damageBadge = { none: '', low: ' · Dmg:Low', high: ' · Dmg:High' }[def.properties.contactDamage];
              // Resistance is only meaningful for fragile blocks, and 'standard' is the
              // silent default (matches pre-Phase-2E behavior) so it gets no badge.
              const resistanceBadge = def.properties.breakability === 'fragile'
                ? { weak: ' · Weak', standard: '', reinforced: ' · Reinforced' }[def.properties.breakResistance]
                : '';
              // 'passThrough' is the silent default (matches pre-Phase-2F behavior) so it gets no badge.
              const windBadge = { passThrough: '', dampen: ' · Dampens wind', block: ' · Windbreak' }[def.properties.windResponse];
              // 'none' is the silent default (matches pre-Phase-2G behavior) so it gets no badge.
              const liquidBadge = { none: '', seal: ' · Seals liquid', drain: ' · Drain' }[def.properties.liquidInteraction];
              // 'none' is the silent default (matches pre-Phase-2H behavior) so it gets no badge.
              const windEmissionBadge = { none: '', left: ' · Vent ←', right: ' · Vent →', up: ' · Vent ↑', down: ' · Vent ↓' }[def.properties.windEmission];
              propsEl.textContent = `${collisionBadge}${frictionBadge}${breakBadge}${materialBadge}${damageBadge}${resistanceBadge}${windBadge}${liquidBadge}${windEmissionBadge}`;
              propsEl.title = 'Collision/friction/breakability/material-response/contact-damage/break-resistance/wind-response/liquid-interaction/wind-emission properties for this block.';

              info.appendChild(nameEl);
              info.appendChild(sizeEl);
              info.appendChild(usageEl);
              info.appendChild(propsEl);
              topRow.appendChild(info);
              blockCard.appendChild(topRow);

              // Bottom row: action buttons
              const btnRow2 = document.createElement('div');
              btnRow2.style.cssText = 'display:flex;gap:4px;';

              const mkBtn = (label: string, title: string, css: string, cb: () => void): HTMLButtonElement => {
                const b = document.createElement('button');
                b.textContent = label;
                b.title = title;
                b.style.cssText = `padding:2px 5px;font-size:10px;cursor:pointer;border-radius:2px;font-family:monospace;${css}`;
                b.addEventListener('click', (e) => { e.stopPropagation(); cb(); });
                return b;
              };

              btnRow2.appendChild(mkBtn('✏ Edit', 'Edit sprite pixels', 'background:#1a1a2e;border:1px solid #555;color:#aaa;', () => callbacks?.onEditCustomBlock?.(rawId)));
              btnRow2.appendChild(mkBtn('✎ Rename', 'Rename display name', 'background:#1a1a2e;border:1px solid #556;color:#aac;', () => {
                const newName = window.prompt('New display name:', def.name)?.trim();
                if (newName && newName.length > 0) callbacks?.onRenameCustomBlock?.(rawId, newName);
              }));
              btnRow2.appendChild(mkBtn('⧉ Dup', 'Duplicate block', 'background:#1a1a2e;border:1px solid #565;color:#aca;', () => callbacks?.onDuplicateCustomBlock?.(rawId)));
              btnRow2.appendChild(mkBtn('🗑', 'Delete block', 'background:#1a0a0a;border:1px solid #884444;color:#cc6666;', () => callbacks?.onDeleteCustomBlock?.(rawId)));

              blockCard.appendChild(btnRow2);

              // Click card body = select for placement. Active/inactive
              // styling is NOT set here — selection is intentionally
              // excluded from the Custom Blocks structural signature (so
              // picking a different block doesn't rebuild this whole
              // section), and is instead patched by the shared palette
              // selection-highlight loop below via customBlockCards.
              const namespacedId = `custom:${rawId}`;
              customBlockCards.push({ btn: blockCard, itemId: namespacedId });
              blockCard.addEventListener('click', () => callbacks?.onSelectCustomBlockForPlacement?.(rawId));
              paletteDiv.appendChild(blockCard);
            }
          }
        }

        // Every non-'blocks' category (handled separately above via its own
        // `if` branch, so it never reaches this code) gets the generic
        // 2-column preview grid by default. 'customBlocks' is the only
        // opt-out: its cards come from the dynamic custom-block registry
        // (built above), not from a `PALETTE_ITEMS` filter, so there's
        // nothing in `items` for it to render here.
        //
        // This is deliberately a default-on/opt-out design (not an allowlist)
        // so a brand new category can never silently render an empty
        // palette just because it was left off a list — see
        // editorPaletteItems.test.ts's coverage assertion.
        const usePreviewGrid = state.activeCategory !== 'customBlocks';

        if (usePreviewGrid) {
          const grid = document.createElement('div');
          grid.style.cssText = `display: grid; grid-template-columns: 1fr 1fr; gap: 5px;`;
          for (const item of items) {
            const card = makePalettePreviewCard(item, currentTheme, () => {
              callbacks?.onPaletteItemSelect(item);
            });
            paletteItems.push({ btn: card, itemId: item.id });
            grid.appendChild(card);
          }
          paletteDiv.appendChild(grid);
        }
      }
      // Restore scroll position now that the rebuilt content is in place.
      paletteDiv.scrollTop = savedPaletteScrollTop;
    } else if (state.activeCategory === 'lighting') {
      lightingPanel.syncInPlace(state, currentLighting);
    }

    // Update palette selection highlight — only touch button styles when the
    // selected item actually changed (not on every frame, and not as part of
    // a structural rebuild check above).
    const paletteSelectionSig = computePaletteSelectionSig(state);
    if (paletteSelectionSig !== lastPaletteSelectionSig || needsPaletteRebuild) {
      lastPaletteSelectionSig = paletteSelectionSig;
      for (const { btn, itemId } of paletteItems) {
        const isSelected = state.selectedPaletteItem?.id === itemId;
        btn.style.background = isSelected ? ACTIVE_BG : BTN_BG;
        btn.style.borderColor = isSelected ? ACCENT_GOLD : PANEL_BORDER;
      }
      // Custom-block cards use their own active/inactive palette rather than
      // the generic ACTIVE_BG/BTN_BG pair, but are patched by this same
      // signature-gated pass — selecting a different custom block never
      // rebuilds the Custom Blocks section (see computePaletteStructureSig).
      for (const { btn, itemId } of customBlockCards) {
        const isSelected = state.selectedPaletteItem?.id === itemId;
        btn.style.background = isSelected ? '#1a2a1a' : '#151525';
        btn.style.borderColor = isSelected ? '#7fda7f' : '#444';
      }
    }

    specialItemPickers.update(state);
    const item = state.selectedPaletteItem;
    const isModifierEligible = state.activeCategory === 'blocks' &&
      item !== null &&
      item.category === 'blocks' &&
      item.isPlatformItem !== 1 &&
      item.isRampItem !== 1 &&
      item.isBackgroundBlockItem !== 1;
    if (isModifierEligible !== lastModifierEligible) {
      lastModifierEligible = isModifierEligible;
      blockModifierDiv.style.display = isModifierEligible ? '' : 'none';
    }
    if (isModifierEligible) {
      const fallingSupported = supportsFallingModifier(item as PaletteItem);
      if (fallingSupported !== lastFallingModifierSupported) {
        lastFallingModifierSupported = fallingSupported;
        for (const row of fallingModifierRows) row.style.display = fallingSupported ? '' : 'none';
        // A shaped item (stairs/smooth ramp/half-pillar/spike) can never
        // place a falling block — see editorPlaceTool.ts's matching guard.
        // Drop a stale falling selection back to 'none' rather than leaving
        // hidden UI silently armed for the next placement.
        if (!fallingSupported && (
          state.pendingBlockPlacementModifier === 'tough' ||
          state.pendingBlockPlacementModifier === 'sensitive' ||
          state.pendingBlockPlacementModifier === 'crumbling'
        )) {
          callbacks?.onBlockPlacementModifierChange('none');
        }
      }
      // Only touch modifier checkbox/select DOM when the modifier state
      // signature changed (not on every frame regardless of change).
      const blockModifierSig = computeBlockModifierSig(state);
      if (blockModifierSig !== lastBlockModifierSig) {
        lastBlockModifierSig = blockModifierSig;
        for (const input of modifierInputs) {
          input.checked = input.dataset.modifier === state.pendingBlockPlacementModifier;
        }
        modifierCrumbleSelect.style.display =
          state.pendingBlockPlacementModifier === 'cracked' ||
          state.pendingBlockPlacementModifier === 'secret' ? '' : 'none';
        if (document.activeElement !== modifierCrumbleSelect) {
          modifierCrumbleSelect.value = state.pendingCrumbleVariant;
        }
        const isBackgroundActive = state.pendingBlockPlacementModifier === 'background';
        bgLightRow.style.display = isBackgroundActive ? 'flex' : 'none';
        bgLightInput.checked = state.pendingBackgroundBlocksLight;
      }
    }

    // Update inspector (only recreate when the selected-element identity
    // changes). A focused inspector input is never replaced by unrelated
    // tool/layer/palette/lighting/density/room-state updates — this gate is
    // the reason: it only fires on an actual selection-identity change.
    const inspectorIdentitySig = computeInspectorIdentitySig(state);
    if (!inspectorIdentitySigEquals(inspectorIdentitySig, lastInspectorIdentitySig)) {
      lastInspectorIdentitySig = inspectorIdentitySig;
      updateInspector(inspectorDiv, state, callbacks);
    }
  }

  return {
    container,
    update,
    setCallbacks: (cbs: EditorUICallbacks) => { callbacks = cbs; },
    applyWorkspaceUIPrefs: (prefs: EditorWorkspaceUIPrefs) => {
      layersPanel.setCollapsed(prefs.layerPanelCollapsed);
      if (sidebarsSwapped !== prefs.sidebarsSwapped) {
        swapMenuSides();
      }
      // Restore the panel arrangement, re-clamped against the current
      // viewport so a layout saved on a larger window can never leave a
      // floating panel's header off-screen and unreachable.
      const rootRect = root.getBoundingClientRect();
      docking.applyLayout(
        clampAllFloatingPanels(prefs.panelLayout, rootRect.width, rootRect.height).layout,
      );
      container.scrollTop = prefs.leftSidebarScrollTop;
      rightSidebar.scrollTop = prefs.rightSidebarScrollTop;
      for (const section of collapsibleSections) {
        if (section.key !== null && section.key in prefs.sectionExpanded) {
          section.setExpanded(prefs.sectionExpanded[section.key]);
        }
      }
      if (LAYERS_SESSION_KEY in prefs.sectionExpanded) {
        layersPanel.setCollapsed(!prefs.sectionExpanded[LAYERS_SESSION_KEY]);
      }
      setLeftSidebarVisible(prefs.leftSidebarVisible);
      setRightSidebarVisible(prefs.rightSidebarVisible);
    },
    getWorkspaceUIPrefsSnapshot: () => {
      const sectionExpanded: Record<string, boolean> = {};
      for (const section of collapsibleSections) {
        if (section.key !== null) sectionExpanded[section.key] = section.isExpanded();
      }
      sectionExpanded[LAYERS_SESSION_KEY] = !layersPanel.isCollapsed();
      return {
        layerPanelCollapsed: layersPanel.isCollapsed(),
        leftSidebarScrollTop: container.scrollTop,
        rightSidebarScrollTop: rightSidebar.scrollTop,
        panelLayout: docking.getLayout(),
        sidebarsSwapped,
        sectionExpanded,
        leftSidebarVisible,
        rightSidebarVisible,
      };
    },
    getSidebarVisibility: () => ({ left: leftSidebarVisible, right: rightSidebarVisible }),
    getFloatingPanelRects: () => docking.getFloatingPanelRects(),
    isPanelDragActive: () => docking.isDragging(),
    setPanelLayoutChangeHandler: (handler) => { onPanelLayoutChanged = handler; },
    getSessionUIStateSnapshot: (): EditorSessionUIState => {
      const sectionExpanded: Record<string, boolean> = {};
      for (const section of collapsibleSections) {
        if (section.key !== null) sectionExpanded[section.key] = section.isExpanded();
      }
      sectionExpanded[LAYERS_SESSION_KEY] = !layersPanel.isCollapsed();
      return { sectionExpanded, leftSidebarVisible, rightSidebarVisible, sidebarsSwapped };
    },
    applySessionUIState: (snapshot: EditorSessionUIState): void => {
      for (const section of collapsibleSections) {
        if (section.key !== null && section.key in snapshot.sectionExpanded) {
          section.setExpanded(snapshot.sectionExpanded[section.key]);
        }
      }
      if (LAYERS_SESSION_KEY in snapshot.sectionExpanded) {
        layersPanel.setCollapsed(!snapshot.sectionExpanded[LAYERS_SESSION_KEY]);
      }
      setLeftSidebarVisible(snapshot.leftSidebarVisible);
      setRightSidebarVisible(snapshot.rightSidebarVisible);
      // Backward-compatible: older snapshots lack `sidebarsSwapped` and
      // should leave the default unswapped arrangement in place.
      const wantSwapped = snapshot.sidebarsSwapped === true;
      if (wantSwapped !== sidebarsSwapped) {
        swapMenuSides();
      }
    },
    destroy: () => {
      lastPaletteStructureSig = '';
      paletteItems = [];
      customBlockCards = [];
      lastPaletteSelectionSig = '';
      lastToolSig = '';
      lastBrushSig = '';
      lastCategorySig = '';
      lastBlockModifierSig = '';
      lastModifierEligible = null;
      lastFallingModifierSupported = null;
      lastInspectorIdentitySig = { uid: -1, type: '', count: 0, dialogueEntryCount: -1 };
      lastRenderedRoomId = '';
      lastRenderedWidthBlocks = -1;
      lastRenderedHeightBlocks = -1;
      lastRenderedBackgroundId = '';
      lastRenderedSongId = '';
      lightingPanel.resetState();
      dimWidthInput = null;
      dimHeightInput = null;
      if (animatedBackgroundPreviewFrame !== null) {
        cancelAnimationFrame(animatedBackgroundPreviewFrame);
        animatedBackgroundPreviewFrame = null;
      }
      animatedBackgroundPreviewCanvases = [];
      // Removes the floating layer plus every window/pointer listener and any
      // in-flight pointer capture the docking system installed.
      onPanelLayoutChanged = null;
      docking.destroy();
      if (container.parentElement) container.parentElement.removeChild(container);
      if (rightSidebar.parentElement) rightSidebar.parentElement.removeChild(rightSidebar);
      if (leftRevealTab.parentElement) leftRevealTab.parentElement.removeChild(leftRevealTab);
      if (rightRevealTab.parentElement) rightRevealTab.parentElement.removeChild(rightRevealTab);
    },
  };
}
