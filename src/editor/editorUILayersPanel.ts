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
  type LayerId, type EditorLayerState,
} from './editorLayers';
import { PANEL_BORDER, TEXT_COLOR, GREEN } from './editorStyles';

export interface EditorLayersPanel {
  readonly div: HTMLDivElement;
  /** Refresh toggle states and the active-layer highlight from current EditorState. */
  sync(state: EditorState): void;
}

const TOGGLE_ON_BG = 'rgba(0,200,100,0.35)';
const TOGGLE_OFF_BG = 'rgba(255,255,255,0.06)';
const LOCK_ON_BG = 'rgba(220,80,60,0.4)';
const SOLO_ON_BG = 'rgba(230,190,40,0.4)';
const SELECT_ONLY_ON_BG = 'rgba(80,150,230,0.4)';

function makeToggle(icon: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = icon;
  btn.title = title;
  btn.style.cssText = `
    width: 18px; height: 18px; line-height: 16px; padding: 0; font-size: 10px;
    border: 1px solid ${PANEL_BORDER}; border-radius: 2px; cursor: pointer;
    background: ${TOGGLE_OFF_BG}; color: ${TEXT_COLOR};
  `;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

export function createEditorLayersPanel(
  getCallbacks: () => EditorUICallbacks | null,
): EditorLayersPanel {
  const div = document.createElement('div');
  div.style.cssText = `
    border: 1px solid ${PANEL_BORDER}; border-radius: 3px;
    padding: 6px 8px; margin-bottom: 8px; background: rgba(0,0,0,0.2);
  `;

  const header = document.createElement('div');
  header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none;';
  const title = document.createElement('div');
  title.textContent = 'Layers';
  title.style.cssText = `font-size: 11px; color: ${GREEN}; font-weight: bold;`;
  const collapseIndicator = document.createElement('div');
  collapseIndicator.textContent = '▾';
  collapseIndicator.style.cssText = 'font-size: 10px; color: rgba(200,255,200,0.6);';
  header.appendChild(title);
  header.appendChild(collapseIndicator);
  div.appendChild(header);

  const rowsContainer = document.createElement('div');
  rowsContainer.style.cssText = 'margin-top: 6px;';
  div.appendChild(rowsContainer);

  let collapsed = false;
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    rowsContainer.style.display = collapsed ? 'none' : 'block';
    collapseIndicator.textContent = collapsed ? '▸' : '▾';
  });

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

    const visibleBtn = makeToggle('👁', 'Toggle visibility', () => {
      const current = rows.get(id)!;
      patchLayer(id, { visible: current.visibleBtn.dataset.on !== '1' });
    });
    const lockBtn = makeToggle('🔒', 'Toggle lock (prevents select/move/delete/edit)', () => {
      const current = rows.get(id)!;
      patchLayer(id, { locked: current.lockBtn.dataset.on !== '1' });
    });
    const soloBtn = makeToggle('S', 'Solo (isolate this layer\'s visibility)', () => {
      const current = rows.get(id)!;
      patchLayer(id, { solo: current.soloBtn.dataset.on !== '1' });
    });
    const selectOnlyBtn = makeToggle('T', 'Select-only / target-only (restrict selection & placement to select-only layers)', () => {
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

  function toggleSig(l: EditorLayerState): string {
    return `${l.visible ? 1 : 0}${l.locked ? 1 : 0}${l.solo ? 1 : 0}${l.selectOnly ? 1 : 0}`;
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

    const status = getPlacementStatus(state);
    const restrictedReasons = new Set(['hidden', 'locked', 'solo-excluded', 'select-only-excluded']);
    const targetIsRestricted = targetLayer !== null && restrictedReasons.has(status.reason ?? '');

    for (const id of LAYER_IDS) {
      const r = rows.get(id)!;
      const layer = state.layers[id];
      const sig = toggleSig(layer);
      if (sig !== r.lastSig) {
        r.lastSig = sig;
        r.visibleBtn.dataset.on = layer.visible ? '1' : '0';
        r.visibleBtn.style.background = layer.visible ? TOGGLE_ON_BG : TOGGLE_OFF_BG;
        r.visibleBtn.style.opacity = layer.visible ? '1' : '0.55';

        r.lockBtn.dataset.on = layer.locked ? '1' : '0';
        r.lockBtn.style.background = layer.locked ? LOCK_ON_BG : TOGGLE_OFF_BG;

        r.soloBtn.dataset.on = layer.solo ? '1' : '0';
        r.soloBtn.style.background = layer.solo ? SOLO_ON_BG : TOGGLE_OFF_BG;

        r.selectOnlyBtn.dataset.on = layer.selectOnly ? '1' : '0';
        r.selectOnlyBtn.style.background = layer.selectOnly ? SELECT_ONLY_ON_BG : TOGGLE_OFF_BG;
      }

      const isTarget = id === targetLayer;
      const isRestrictedTarget = isTarget && targetIsRestricted;
      const containsSelection = selectedLayers.has(id);
      const selCount = selectionCountByLayer.get(id) ?? 0;

      let markerText = '';
      let title = '';
      if (isTarget) {
        markerText = isRestrictedTarget ? '⛔ target' : '▶ target';
        title = isRestrictedTarget
          ? `Placement target — blocked: ${describePlacementBlockReason(status.reason, targetLayer)}`
          : 'Placement target for the active tool';
      } else if (containsSelection) {
        markerText = `● sel${selCount > 1 ? ` (${selCount})` : ''}`;
        title = 'Contains part of the current selection';
      }

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
        r.marker.style.color = isRestrictedTarget ? '#ffb08a' : isTarget ? '#9fd8ff' : '#e0c96a';
        r.row.setAttribute('aria-current', isTarget ? 'true' : 'false');
        r.row.setAttribute(
          'aria-label',
          `${LAYER_LABELS[id]}${isTarget ? ', placement target' : ''}${isRestrictedTarget ? ', blocked: ' + describePlacementBlockReason(status.reason, targetLayer) : ''}${containsSelection ? ', contains selection' : ''}`,
        );
      }
    }
  }

  return { div, sync };
}
