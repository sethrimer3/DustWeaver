/**
 * Debug speed panel — HTML overlay with editable textboxes for all player
 * speed constants. Reads/writes the mutable debugSpeedOverrides object
 * in movement.ts for live playtesting.
 */

import { debugSpeedOverrides } from '../sim/clusters/movement';
import { debugCloakOverrides } from '../render/clusters/cloakConstants';

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

interface CloakFieldDef {
  key: keyof typeof debugCloakOverrides;
  label: string;
  defaultValue: number;
}

/**
 * Default values must be kept in sync with the constants defined in
 * src/sim/clusters/movement.ts. These are duplicated here because the
 * constants are module-private and cannot be imported.
 */
const FIELDS: readonly FieldDef[] = [
  { key: 'walkSpeedWorld',     label: 'Walk Speed',      defaultValue: 105.0 },
  { key: 'jumpSpeedWorld',     label: 'Jump Speed',      defaultValue: 300.0 },
  { key: 'gravityWorld',       label: 'Gravity',         defaultValue: 900.0 },
  { key: 'normalFallCapWorld', label: 'Normal Fall Cap', defaultValue: 160.5 },
  { key: 'fastFallCapWorld',   label: 'Fast Fall Cap',   defaultValue: 240.0 },
  { key: 'sprintMultiplier',   label: 'Sprint Mult',     defaultValue: 1.5 },
  { key: 'groundAccelWorld',   label: 'Ground Accel',    defaultValue: 800.0 },
  { key: 'groundDecelWorld',   label: 'Ground Decel',    defaultValue: 1000.0 },
  { key: 'airAccelWorld',      label: 'Air Accel',       defaultValue: 520.0 },
  { key: 'airDecelWorld',      label: 'Air Decel',       defaultValue: 600.0 },
  { key: 'wallJumpXWorld',     label: 'Wall Jump X',     defaultValue: 147.0 },
  { key: 'wallJumpYWorld',     label: 'Wall Jump Y',     defaultValue: 147.0 },
];

const CLOAK_FIELDS: readonly CloakFieldDef[] = [
  { key: 'damping', label: 'Damping', defaultValue: 0.82 },
  { key: 'gravityWorldPerSec2', label: 'Gravity', defaultValue: 55.0 },
  { key: 'velocityInheritance', label: 'Vel Inherit', defaultValue: 0.45 },
  { key: 'restBiasStrength', label: 'Rest Bias', defaultValue: 0.22 },
  { key: 'turnImpulseWorld', label: 'Turn Impulse', defaultValue: 2.5 },
  { key: 'turnOvershootDurationSec', label: 'Turn Overshoot Sec', defaultValue: 0.25 },
  { key: 'turnOvershootSpreadMultiplier', label: 'Turn Spread Mult', defaultValue: 1.4 },
  { key: 'landingImpulseWorldPerSec', label: 'Landing Impulse', defaultValue: 18.0 },
  { key: 'landingDurationSec', label: 'Landing Duration', defaultValue: 0.18 },
  { key: 'landingCompression', label: 'Landing Compression', defaultValue: 0.7 },
  { key: 'shapeLerpSpeed', label: 'Shape Lerp Speed', defaultValue: 8.0 },
  { key: 'jumpingVelocityThresholdWorld', label: 'Jump Vel Threshold', defaultValue: -10.0 },
  { key: 'runningVelocityThresholdWorld', label: 'Run Vel Threshold', defaultValue: 15.0 },
  { key: 'fastFallVelocityThresholdWorld', label: 'FastFall Threshold', defaultValue: 180.0 },
  { key: 'spreadIdle', label: 'Spread Idle', defaultValue: 0.15 },
  { key: 'spreadRunning', label: 'Spread Running', defaultValue: 0.3 },
  { key: 'spreadSprinting', label: 'Spread Sprint', defaultValue: 0.4 },
  { key: 'spreadJumping', label: 'Spread Jump', defaultValue: 0.2 },
  { key: 'spreadFalling', label: 'Spread Fall', defaultValue: 0.5 },
  { key: 'spreadFastFall', label: 'Spread FastFall', defaultValue: 0.9 },
  { key: 'spreadWallSlide', label: 'Spread Wall', defaultValue: 0.25 },
  { key: 'spreadCrouching', label: 'Spread Crouch', defaultValue: 0.1 },
  { key: 'opennessIdle', label: 'Open Idle', defaultValue: 0.1 },
  { key: 'opennessRunning', label: 'Open Running', defaultValue: 0.25 },
  { key: 'opennessJumping', label: 'Open Jump', defaultValue: 0.15 },
  { key: 'opennessFalling', label: 'Open Fall', defaultValue: 0.4 },
  { key: 'opennessFastFall', label: 'Open FastFall', defaultValue: 0.65 },
  { key: 'opennessWallSlide', label: 'Open Wall', defaultValue: 0.2 },
];

export interface DebugPanel {
  container: HTMLDivElement;
  destroy: () => void;
}

export function createDebugPanel(root: HTMLElement): DebugPanel {
  const container = document.createElement('div');
  container.id = 'debug-speed-panel';
  container.style.cssText = `
    position: absolute; top: 74px; right: 16px; width: 220px;
    background: ${PANEL_BG}; border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; font-family: monospace; font-size: 10px;
    padding: 6px; box-sizing: border-box; z-index: 850;
    pointer-events: auto; border-radius: 6px;
  `;

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.style.cssText = `
    width: 100%; display: flex; justify-content: space-between; align-items: center;
    background: rgba(0,0,0,0.35); border: 1px solid ${PANEL_BORDER}; color: ${TEXT_COLOR};
    padding: 6px 8px; font-size: 10px; font-family: monospace; cursor: pointer;
    border-radius: 4px;
  `;

  const body = document.createElement('div');
  body.style.cssText = 'margin-top: 6px; max-height: 44vh; overflow-y: auto;';
  const cloakBody = document.createElement('div');
  cloakBody.style.cssText = 'margin-top: 6px; max-height: 44vh; overflow-y: auto;';

  let isExpanded = false;
  let isCloakExpanded = false;
  const refreshToggleText = (): void => {
    toggleBtn.textContent = isExpanded
      ? '⚙ Movement Tuning ▾'
      : '⚙ Movement Tuning ▸';
    body.style.display = isExpanded ? 'block' : 'none';
  };
  const cloakToggleBtn = document.createElement('button');
  cloakToggleBtn.type = 'button';
  cloakToggleBtn.style.cssText = toggleBtn.style.cssText;
  const refreshCloakToggleText = (): void => {
    cloakToggleBtn.textContent = isCloakExpanded
      ? '🜁 Cloak Tuning ▾'
      : '🜁 Cloak Tuning ▸';
    cloakBody.style.display = isCloakExpanded ? 'block' : 'none';
  };

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isExpanded = !isExpanded;
    refreshToggleText();
  });

  container.appendChild(toggleBtn);

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
    body.appendChild(row);
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
    const inputs = body.querySelectorAll('input');
    let idx = 0;
    for (const field of FIELDS) {
      if (idx < inputs.length) {
        inputs[idx].value = String(field.defaultValue);
        inputs[idx].style.borderColor = PANEL_BORDER;
      }
      idx++;
    }
  });
  body.appendChild(resetBtn);

  container.appendChild(body);

  cloakToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    isCloakExpanded = !isCloakExpanded;
    refreshCloakToggleText();
  });
  container.appendChild(cloakToggleBtn);

  for (const field of CLOAK_FIELDS) {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; margin-bottom: 2px; gap: 4px;';

    const lbl = document.createElement('span');
    lbl.textContent = field.label;
    lbl.style.cssText = `min-width: 85px; font-size: 9px; color: ${LABEL_COLOR};`;

    const input = document.createElement('input');
    input.type = 'text';
    const currentVal = debugCloakOverrides[field.key];
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
        debugCloakOverrides[field.key] = parsed;
        input.style.borderColor = GREEN;
      } else {
        debugCloakOverrides[field.key] = NaN;
        input.value = String(field.defaultValue);
        input.style.borderColor = PANEL_BORDER;
      }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => e.stopPropagation());
    input.addEventListener('keyup', (e) => e.stopPropagation());

    row.appendChild(lbl);
    row.appendChild(input);
    cloakBody.appendChild(row);
  }

  const cloakResetBtn = document.createElement('button');
  cloakResetBtn.textContent = '↺ Reset Cloak';
  cloakResetBtn.style.cssText = resetBtn.style.cssText;
  cloakResetBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    for (const field of CLOAK_FIELDS) {
      debugCloakOverrides[field.key] = NaN;
    }
    const inputs = cloakBody.querySelectorAll('input');
    let idx = 0;
    for (const field of CLOAK_FIELDS) {
      if (idx < inputs.length) {
        inputs[idx].value = String(field.defaultValue);
        inputs[idx].style.borderColor = PANEL_BORDER;
      }
      idx++;
    }
  });
  cloakBody.appendChild(cloakResetBtn);

  container.appendChild(cloakBody);
  refreshToggleText();
  refreshCloakToggleText();
  root.appendChild(container);

  return {
    container,
    destroy: () => {
      if (container.parentElement) container.parentElement.removeChild(container);
    },
  };
}
