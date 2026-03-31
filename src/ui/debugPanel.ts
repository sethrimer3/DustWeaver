/**
 * Debug speed panel — HTML overlay with editable textboxes for all player
 * speed constants.  Reads/writes the mutable debugSpeedOverrides object
 * in movement.ts for live playtesting.
 */

import { debugSpeedOverrides } from '../sim/clusters/movement';

const PANEL_BG = 'rgba(15,15,20,0.92)';
const PANEL_BORDER = 'rgba(0,200,100,0.4)';
const TEXT_COLOR = '#c0ffd0';
const LABEL_COLOR = 'rgba(200,255,200,0.7)';
const GREEN = '#00c864';

interface FieldDef {
  key: keyof typeof debugSpeedOverrides;
  label: string;
  defaultValue: number;
}

const FIELDS: readonly FieldDef[] = [
  { key: 'walkSpeedWorld',     label: 'Walk Speed',      defaultValue: 105.0 },
  { key: 'jumpSpeedWorld',     label: 'Jump Speed',      defaultValue: 300.0 },
  { key: 'gravityWorld',       label: 'Gravity',         defaultValue: 900.0 },
  { key: 'normalFallCapWorld', label: 'Normal Fall Cap',  defaultValue: 160.5 },
  { key: 'fastFallCapWorld',   label: 'Fast Fall Cap',    defaultValue: 240.0 },
  { key: 'sprintMultiplier',   label: 'Sprint Mult',     defaultValue: 1.5 },
  { key: 'groundAccelWorld',   label: 'Ground Accel',    defaultValue: 800.0 },
  { key: 'groundDecelWorld',   label: 'Ground Decel',    defaultValue: 1000.0 },
  { key: 'airAccelWorld',      label: 'Air Accel',       defaultValue: 520.0 },
  { key: 'airDecelWorld',      label: 'Air Decel',       defaultValue: 600.0 },
  { key: 'dashSpeedWorld',     label: 'Dash Speed',      defaultValue: 373.0 },
  { key: 'wallJumpXWorld',     label: 'Wall Jump X',     defaultValue: 147.0 },
  { key: 'wallJumpYWorld',     label: 'Wall Jump Y',     defaultValue: 147.0 },
];

export interface DebugPanel {
  container: HTMLDivElement;
  destroy: () => void;
}

export function createDebugPanel(root: HTMLElement): DebugPanel {
  const container = document.createElement('div');
  container.id = 'debug-speed-panel';
  container.style.cssText = `
    position: absolute; top: 8px; right: 8px; width: 200px;
    background: ${PANEL_BG}; border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; font-family: monospace; font-size: 10px;
    padding: 6px; box-sizing: border-box; z-index: 850;
    pointer-events: auto; max-height: 80%; overflow-y: auto;
  `;

  const title = document.createElement('div');
  title.textContent = '⚙ Speed Overrides';
  title.style.cssText = `font-size: 11px; color: ${GREEN}; margin-bottom: 6px; font-weight: bold;`;
  container.appendChild(title);

  for (const field of FIELDS) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; margin-bottom: 2px; gap: 4px;';

    const lbl = document.createElement('span');
    lbl.textContent = field.label;
    lbl.style.cssText = `min-width: 85px; font-size: 9px; color: ${LABEL_COLOR};`;

    const input = document.createElement('input');
    input.type = 'text';
    const currentVal = debugSpeedOverrides[field.key];
    input.value = Number.isFinite(currentVal)
      ? String(currentVal)
      : String(field.defaultValue);
    input.placeholder = String(field.defaultValue);
    input.style.cssText = `
      flex: 1; background: rgba(0,0,0,0.4); border: 1px solid ${PANEL_BORDER};
      color: ${TEXT_COLOR}; padding: 2px 4px; font-size: 9px; font-family: monospace;
      border-radius: 2px; width: 60px;
    `;
    input.addEventListener('change', () => {
      const parsed = parseFloat(input.value);
      if (Number.isFinite(parsed)) {
        debugSpeedOverrides[field.key] = parsed;
        input.style.borderColor = GREEN;
      } else {
        // Reset to default
        debugSpeedOverrides[field.key] = NaN;
        input.value = String(field.defaultValue);
        input.style.borderColor = PANEL_BORDER;
      }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => e.stopPropagation());
    input.addEventListener('keyup', (e) => e.stopPropagation());

    row.appendChild(lbl);
    row.appendChild(input);
    container.appendChild(row);
  }

  // Reset button
  const resetBtn = document.createElement('button');
  resetBtn.textContent = '↺ Reset All';
  resetBtn.style.cssText = `
    width: 100%; margin-top: 6px; padding: 4px; font-size: 9px;
    background: rgba(0,0,0,0.4); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; font-family: monospace; cursor: pointer;
    border-radius: 2px;
  `;
  resetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    for (const field of FIELDS) {
      debugSpeedOverrides[field.key] = NaN;
    }
    // Refresh input values
    const inputs = container.querySelectorAll('input');
    let idx = 0;
    for (const field of FIELDS) {
      if (idx < inputs.length) {
        inputs[idx].value = String(field.defaultValue);
        inputs[idx].style.borderColor = PANEL_BORDER;
      }
      idx++;
    }
  });
  container.appendChild(resetBtn);

  root.appendChild(container);

  return {
    container,
    destroy: () => {
      if (container.parentElement) container.parentElement.removeChild(container);
    },
  };
}
