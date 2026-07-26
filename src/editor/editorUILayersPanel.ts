/**
 * Editor layers panel — per-layer visibility/lock/solo/select-only controls
 * plus an active-layer highlight driven by the current tool/palette
 * selection. See editorLayers.ts for the underlying layer model.
 *
 * Always visible (not gated by palette category), placed above the category
 * tabs so it reads as a persistent editing-mode control rather than a
 * palette sub-panel.
 */

import type { EditorState, EditorUICallbacks } from './editorState';
import {
  LAYER_IDS, LAYER_LABELS, getPlacementTargetLayer, getSelectedElementLayers,
  getPlacementStatus, describePlacementBlockReason, getLayerForElementType,
  type LayerId, type EditorLayerState, type PlacementStatus,
} from './editorLayers';
import { PANEL_BORDER, TEXT_COLOR } from './editorStyles';
import { LAYER_PRESETS } from './editorWorkspacePreferences';
import { createCollapsibleSection } from './editorUIHelpers';

/**
 * Pure computation of one layer row's combined presentation state — split out
 * from `sync()` so it's independently testable without a DOM. A layer can
 * simultaneously be the placement TARGET, contain part of the current
 * SELECTION, and be RESTRICTED (locked/hidden) — all three markers combine
 * instead of one hiding the others (the bug this replaced: an `if` / `else
 * if` chain that only ever showed a single state at a time).
 */
export interface LayerRowPresentation {
  isTarget: boolean;
  isRestrictedTarget: boolean;
  markerText: string;
  title: string;
}

const LAYER_RESTRICTED_REASONS = new Set(['hidden', 'locked', 'solo-excluded', 'select-only-excluded']);

export function computeLayerRowPresentation(
  id: LayerId,
  targetLayer: LayerId | null,
  status: PlacementStatus,
  layer: EditorLayerState,
  containsSelection: boolean,
  selCount: number,
): LayerRowPresentation {
  const isTarget = id === targetLayer;
  const targetIsRestricted = targetLayer !== null && LAYER_RESTRICTED_REASONS.has(status.reason ?? '');
  const isRestrictedTarget = isTarget && targetIsRestricted;

  const markerParts: string[] = [];
  const titleParts: string[] = [];
  if (isTarget) {
    markerParts.push(isRestrictedTarget ? '⛔ target' : '▶ target');
    titleParts.push(isRestrictedTarget
      ? `Placement target — blocked: ${describePlacementBlockReason(status.reason, targetLayer)}`
      : 'Placement target for the active tool');
  }
  if (containsSelection) {
    markerParts.push(`● sel${selCount > 1 ? ` (${selCount})` : ''}`);
    titleParts.push('Contains part of the current selection');
  }
  if (!isTarget && (layer.locked || !layer.visible)) {
    markerParts.push(layer.locked ? '🔒' : '🚫');
    titleParts.push(layer.locked ? 'Layer is locked' : 'Layer is hidden');
  }

  return {
    isTarget,
    isRestrictedTarget,
    markerText: markerParts.join('  '),
    title: titleParts.join(' — '),
  };
}

export interface EditorLayersPanel {
  readonly div: HTMLDivElement;
  /** Refresh toggle states and the active-layer highlight from current EditorState. */
  sync(state: EditorState): void;
  /** Applies a collapsed/expanded state without a user click — used to restore Phase 6 workspace preferences on load. */
  setCollapsed(value: boolean): void;
  /** Current collapsed state — read when saving workspace preferences. */
  isCollapsed(): boolean;
}

const TOGGLE_ON_BG = 'rgba(212,168,75,0.35)';
const TOGGLE_OFF_BG = 'rgba(255,255,255,0.06)';
const LOCK_ON_BG = 'rgba(220,80,60,0.4)';
const SOLO_ON_BG = 'rgba(230,190,40,0.4)';
const SELECT_ONLY_ON_BG = 'rgba(80,150,230,0.4)';

/** Compact but usable touch/click target (WCAG 2.5.5 recommends >=24px; the
 *  original 18px was below that). */
const TOGGLE_SIZE_PX = 22;

/** Injected once so focus-visible outlines don't rely on per-element inline styles. */
const FOCUS_STYLE_ID = 'dw-editor-layers-panel-focus-style';
function ensureFocusStyleInjected(): void {
  if (document.getElementById(FOCUS_STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = FOCUS_STYLE_ID;
  style.textContent = `
    .dw-layer-toggle-btn:focus-visible, .dw-layer-header-btn:focus-visible {
      outline: 2px solid #ffffff;
      outline-offset: 1px;
    }
  `;
  document.head.appendChild(style);
}

let uniqueIdCounter = 0;
function nextUniqueId(prefix: string): string {
  uniqueIdCounter += 1;
  return `${prefix}-${uniqueIdCounter}`;
}

function makeToggle(icon: string, accessibleName: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = icon;
  btn.title = accessibleName;
  btn.setAttribute('aria-label', accessibleName);
  btn.setAttribute('aria-pressed', 'false');
  btn.className = 'dw-layer-toggle-btn';
  btn.style.cssText = `
    width: ${TOGGLE_SIZE_PX}px; height: ${TOGGLE_SIZE_PX}px; line-height: ${TOGGLE_SIZE_PX - 2}px;
    padding: 0; font-size: 11px;
    border: 1px solid ${PANEL_BORDER}; border-radius: 2px; cursor: pointer;
    background: ${TOGGLE_OFF_BG}; color: ${TEXT_COLOR};
  `;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

/** Builds the accessible name for a toggle button, including its current on/off state so screen readers don't rely on color alone. */
export function toggleAccessibleName(action: string, layerName: string, isOn: boolean): string {
  return `${action} for ${layerName} layer, currently ${isOn ? 'on' : 'off'}`;
}

/** Pure signature of a layer's 4 toggle states — a row's toggle DOM is only touched when this changes. */
export function toggleSig(l: EditorLayerState): string {
  return `${l.visible ? 1 : 0}${l.locked ? 1 : 0}${l.solo ? 1 : 0}${l.selectOnly ? 1 : 0}`;
}

/** Pure presentation for the collapse header — split out from the click handler so it's testable without a DOM. */
export interface CollapseHeaderPresentation {
  ariaExpanded: 'true' | 'false';
  indicatorText: '▾' | '▸';
  rowsDisplay: 'block' | 'none';
}
export function computeCollapseHeaderPresentation(collapsed: boolean): CollapseHeaderPresentation {
  return {
    ariaExpanded: collapsed ? 'false' : 'true',
    indicatorText: collapsed ? '▸' : '▾',
    rowsDisplay: collapsed ? 'none' : 'block',
  };
}

export function createEditorLayersPanel(
  getCallbacks: () => EditorUICallbacks | null,
): EditorLayersPanel {
  ensureFocusStyleInjected();

  // Uses the shared, accessible collapsible-section component (real <button>
  // header, chevron, aria-expanded/aria-controls) instead of duplicating that
  // wiring here. `div` (this panel's public root) is the section's wrapper;
  // presets + layer rows go into the section's body.
  const section = createCollapsibleSection('Layers', {
    defaultExpanded: false,
    wrapperCss: `
      border: 1px solid ${PANEL_BORDER}; border-radius: 3px;
      padding: 6px 8px; margin-bottom: 8px; background: rgba(0,0,0,0.2);
    `,
  });
  const div = section.wrapper;

  // ── Built-in visibility presets + Reset Workspace (Phase 6) ───────────────
  const presetRow = document.createElement('div');
  presetRow.setAttribute('role', 'group');
  presetRow.setAttribute('aria-label', 'Layer visibility presets');
  presetRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px;';
  for (const preset of LAYER_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = preset.label;
    btn.title = `Show only: ${preset.visibleLayers.map(id => LAYER_LABELS[id]).join(', ')}`;
    btn.setAttribute('aria-label', `Apply "${preset.label}" layer visibility preset`);
    btn.className = 'dw-layer-toggle-btn';
    btn.style.cssText = `
      flex: 1 1 auto; padding: 3px 6px; font-size: 10px;
      border: 1px solid ${PANEL_BORDER}; border-radius: 2px; cursor: pointer;
      background: ${TOGGLE_OFF_BG}; color: ${TEXT_COLOR};
    `;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      getCallbacks()?.onApplyLayerPreset?.(preset.id);
    });
    presetRow.appendChild(btn);
  }
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = '↺ Reset Workspace';
  resetBtn.title = 'Restore all layer visibility/lock/select-only, category, brush mode, and panel layout to defaults';
  resetBtn.setAttribute('aria-label', 'Reset editor workspace to defaults');
  resetBtn.className = 'dw-layer-toggle-btn';
  resetBtn.style.cssText = `
    flex: 1 1 100%; margin-top: 4px; padding: 3px 6px; font-size: 10px;
    border: 1px solid ${PANEL_BORDER}; border-radius: 2px; cursor: pointer;
    background: ${TOGGLE_OFF_BG}; color: ${TEXT_COLOR};
  `;
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    getCallbacks()?.onResetWorkspace?.();
  });
  presetRow.appendChild(resetBtn);
  section.body.appendChild(presetRow);

  const rowsContainer = document.createElement('div');
  rowsContainer.id = nextUniqueId('dw-layers-panel-rows');
  rowsContainer.setAttribute('role', 'group');
  rowsContainer.setAttribute('aria-label', 'Layers');
  rowsContainer.style.cssText = 'margin-top: 6px;';
  section.body.appendChild(rowsContainer);

  interface RowRefs {
    row: HTMLDivElement;
    label: HTMLDivElement;
    marker: HTMLDivElement;
    visibleBtn: HTMLButtonElement;
    lockBtn: HTMLButtonElement;
    soloBtn: HTMLButtonElement;
    selectOnlyBtn: HTMLButtonElement;
    /** Cached signature of the last-applied presentation, to avoid redundant DOM writes. */
    lastSig: string;
  }
  const rows = new Map<LayerId, RowRefs>();

  function patchLayer(id: LayerId, patch: Partial<EditorLayerState>): void {
    getCallbacks()?.onLayerStateChange(id, patch);
  }

  for (const id of LAYER_IDS) {
    const row = document.createElement('div');
    row.style.cssText = `
      display: flex; align-items: center; gap: 4px; padding: 2px 3px;
      border-radius: 2px; margin-bottom: 1px;
    `;

    const layerName = LAYER_LABELS[id];
    const visibleBtn = makeToggle('👁', toggleAccessibleName('Toggle visibility', layerName, false), () => {
      const current = rows.get(id)!;
      patchLayer(id, { visible: current.visibleBtn.dataset.on !== '1' });
    });
    const lockBtn = makeToggle('🔒', toggleAccessibleName('Toggle lock (prevents select/move/delete/edit)', layerName, false), () => {
      const current = rows.get(id)!;
      patchLayer(id, { locked: current.lockBtn.dataset.on !== '1' });
    });
    const soloBtn = makeToggle('S', toggleAccessibleName('Solo (isolate this layer\'s visibility)', layerName, false), () => {
      const current = rows.get(id)!;
      patchLayer(id, { solo: current.soloBtn.dataset.on !== '1' });
    });
    const selectOnlyBtn = makeToggle('T', toggleAccessibleName('Select-only / target-only (restrict selection & placement to select-only layers)', layerName, false), () => {
      const current = rows.get(id)!;
      patchLayer(id, { selectOnly: current.selectOnlyBtn.dataset.on !== '1' });
    });

    const label = document.createElement('div');
    label.textContent = LAYER_LABELS[id];
    label.style.cssText = 'flex: 1; font-size: 10.5px; color: rgba(220,255,225,0.85); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

    // Status marker: shows target/selection/restricted state via icon + text
    // (never color alone). Kept as a distinct trailing element so target and
    // selection markers can combine (e.g. "target, also restricted").
    const marker = document.createElement('div');
    marker.style.cssText = 'font-size: 10px; min-width: 12px; text-align: right; white-space: nowrap;';
    marker.setAttribute('aria-hidden', 'false');

    row.appendChild(visibleBtn);
    row.appendChild(lockBtn);
    row.appendChild(soloBtn);
    row.appendChild(selectOnlyBtn);
    row.appendChild(label);
    row.appendChild(marker);
    rowsContainer.appendChild(row);

    rows.set(id, { row, label, marker, visibleBtn, lockBtn, soloBtn, selectOnlyBtn, lastSig: '' });
  }

  function sync(state: EditorState): void {
    const targetLayer = getPlacementTargetLayer(state);
    const selectedLayers = getSelectedElementLayers(state);
    // Count elements per selected layer, for the "N selected" marker.
    const selectionCountByLayer = new Map<LayerId, number>();
    for (const el of state.selectedElements) {
      const layerId = getLayerForElementType(el.type);
      selectionCountByLayer.set(layerId, (selectionCountByLayer.get(layerId) ?? 0) + 1);
    }

    // Deliberately NOT passing a location predicate here: the layers panel's
    // "target, blocked" marker communicates LAYER-level restrictions (hidden/
    // locked/solo/select-only), not moment-to-moment cursor validity — mixing
    // in occupied/out-of-bounds would make the panel flicker as the mouse
    // moves, which isn't what this indicator is for. The preview drawer and
    // controller toast are what surface cursor-position-specific reasons.
    const status = getPlacementStatus(state);

    for (const id of LAYER_IDS) {
      const r = rows.get(id)!;
      const layer = state.layers[id];
      const sig = toggleSig(layer);
      if (sig !== r.lastSig) {
        r.lastSig = sig;
        const layerName = LAYER_LABELS[id];

        r.visibleBtn.dataset.on = layer.visible ? '1' : '0';
        r.visibleBtn.style.background = layer.visible ? TOGGLE_ON_BG : TOGGLE_OFF_BG;
        r.visibleBtn.style.opacity = layer.visible ? '1' : '0.55';
        r.visibleBtn.setAttribute('aria-pressed', layer.visible ? 'true' : 'false');
        r.visibleBtn.setAttribute('aria-label', toggleAccessibleName('Toggle visibility', layerName, layer.visible));

        r.lockBtn.dataset.on = layer.locked ? '1' : '0';
        r.lockBtn.style.background = layer.locked ? LOCK_ON_BG : TOGGLE_OFF_BG;
        r.lockBtn.setAttribute('aria-pressed', layer.locked ? 'true' : 'false');
        r.lockBtn.setAttribute('aria-label', toggleAccessibleName('Toggle lock (prevents select/move/delete/edit)', layerName, layer.locked));

        r.soloBtn.dataset.on = layer.solo ? '1' : '0';
        r.soloBtn.style.background = layer.solo ? SOLO_ON_BG : TOGGLE_OFF_BG;
        r.soloBtn.setAttribute('aria-pressed', layer.solo ? 'true' : 'false');
        r.soloBtn.setAttribute('aria-label', toggleAccessibleName('Solo (isolate this layer\'s visibility)', layerName, layer.solo));

        r.selectOnlyBtn.dataset.on = layer.selectOnly ? '1' : '0';
        r.selectOnlyBtn.style.background = layer.selectOnly ? SELECT_ONLY_ON_BG : TOGGLE_OFF_BG;
        r.selectOnlyBtn.setAttribute('aria-pressed', layer.selectOnly ? 'true' : 'false');
        r.selectOnlyBtn.setAttribute('aria-label', toggleAccessibleName('Select-only / target-only (restrict selection & placement to select-only layers)', layerName, layer.selectOnly));
      }

      const selCount = selectionCountByLayer.get(id) ?? 0;
      const containsSelection = selectedLayers.has(id);
      const { isTarget, isRestrictedTarget, markerText, title } = computeLayerRowPresentation(
        id, targetLayer, status, layer, containsSelection, selCount,
      );

      const presentationSig = `${isTarget}|${isRestrictedTarget}|${containsSelection}|${markerText}|${selCount}`;
      if (presentationSig !== (r.row.dataset.presentationSig ?? '')) {
        r.row.dataset.presentationSig = presentationSig;
        r.row.style.background = isTarget
          ? (isRestrictedTarget ? 'rgba(255,120,80,0.12)' : 'rgba(120,200,255,0.14)')
          : containsSelection ? 'rgba(230,190,40,0.08)' : 'transparent';
        r.row.style.boxShadow = isTarget
          ? `inset 0 0 0 1px ${isRestrictedTarget ? 'rgba(255,120,80,0.7)' : 'rgba(120,200,255,0.55)'}`
          : containsSelection ? 'inset 0 0 0 1px rgba(230,190,40,0.4)' : 'none';
        r.label.style.color = isTarget ? '#eaf6ff' : 'rgba(220,255,225,0.85)';
        r.label.style.fontWeight = isTarget ? 'bold' : 'normal';
        r.marker.textContent = markerText;
        r.marker.title = title;
        r.marker.style.color = isRestrictedTarget ? '#ffb08a' : isTarget ? '#9fd8ff' : containsSelection ? '#e0c96a' : '#d0d0d0';
        r.row.setAttribute('aria-current', isTarget ? 'true' : 'false');
        r.row.setAttribute(
          'aria-label',
          `${LAYER_LABELS[id]}${isTarget ? ', placement target' : ''}${isRestrictedTarget ? ', blocked: ' + describePlacementBlockReason(status.reason, targetLayer) : ''}${containsSelection ? ', contains selection' : ''}`,
        );
      }
    }
  }

  function setCollapsed(value: boolean): void {
    // Delegates to the shared collapsible section for aria-expanded/chevron/
    // body display. Also explicitly (re)applies display on the two direct
    // body children — preserved from the pre-extraction implementation so a
    // collapsed panel hides them even in a fake/partial DOM shim that doesn't
    // cascade `display: none` from an ancestor onto children's own inline
    // styles (see editorUILayersPanelWorkspace.test.ts).
    section.setExpanded(!value);
    const presentation = computeCollapseHeaderPresentation(value);
    presetRow.style.display = presentation.rowsDisplay;
    rowsContainer.style.display = presentation.rowsDisplay;
  }

  function isCollapsed(): boolean {
    return !section.isExpanded();
  }

  // Sync the explicit preset/rows display with the section's default-collapsed
  // construction state (see createCollapsibleSection's "defaults to collapsed"
  // contract).
  setCollapsed(true);

  return { div, sync, setCollapsed, isCollapsed };
}
