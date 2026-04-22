/**
 * Editor form widget helpers — low-level HTML input builders used by the
 * inspector panel. Extracted from editorUI.ts to reduce file size while
 * keeping the widgets co-located with the editor system.
 *
 * Each function creates a labelled row with the appropriate input element and
 * appends it to `parent`.
 */

import { PANEL_BORDER, TEXT_COLOR, GREEN } from './editorStyles';

// ── Widget builders ──────────────────────────────────────────────────────────

export function addField(
  parent: HTMLElement, label: string, value: string,
  onChange: (v: string) => void,
): void {
  const row = document.createElement('div');
  row.style.cssText = 'display: flex; align-items: center; margin-bottom: 4px; gap: 6px;';

  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.cssText = `min-width: 90px; font-size: 11px; color: rgba(200,255,200,0.7);`;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.style.cssText = `
    flex: 1; background: rgba(0,0,0,0.4); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; padding: 3px 5px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  input.addEventListener('change', () => onChange(input.value));
  input.addEventListener('click', (e) => e.stopPropagation());

  row.appendChild(lbl);
  row.appendChild(input);
  parent.appendChild(row);
}

export function addSelect(
  parent: HTMLElement, label: string,
  options: readonly { label: string; value: string }[],
  current: string,
  onChange: (v: string) => void,
): void {
  const row = document.createElement('div');
  row.style.cssText = 'display: flex; align-items: center; margin-bottom: 4px; gap: 6px;';

  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.cssText = `min-width: 90px; font-size: 11px; color: rgba(200,255,200,0.7);`;

  const sel = document.createElement('select');
  sel.style.cssText = `
    flex: 1; background: rgba(0,0,0,0.4); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; padding: 3px; font-size: 11px; font-family: monospace;
  `;
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === current) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  sel.addEventListener('click', (e) => e.stopPropagation());

  row.appendChild(lbl);
  row.appendChild(sel);
  parent.appendChild(row);
}

export function addCheckbox(
  parent: HTMLElement, label: string, checked: boolean,
  onChange: (v: boolean) => void,
): void {
  const row = document.createElement('div');
  row.style.cssText = 'display: flex; align-items: center; margin-bottom: 4px; gap: 6px;';

  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.cssText = `min-width: 90px; font-size: 11px; color: rgba(200,255,200,0.7);`;

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = checked;
  cb.style.cssText = `accent-color: ${GREEN};`;
  cb.addEventListener('change', () => onChange(cb.checked));
  cb.addEventListener('click', (e) => e.stopPropagation());

  row.appendChild(lbl);
  row.appendChild(cb);
  parent.appendChild(row);
}

export function addDimField(
  parent: HTMLElement, label: string, value: number,
  onChange: (v: number) => void,
): HTMLInputElement {
  const row = document.createElement('div');
  row.style.cssText = 'display: flex; align-items: center; margin-bottom: 4px; gap: 6px;';

  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.cssText = `min-width: 100px; font-size: 11px; color: rgba(200,255,200,0.7);`;

  const input = document.createElement('input');
  input.type = 'number';
  input.value = String(value);
  input.min = '10';
  input.style.cssText = `
    flex: 1; background: rgba(0,0,0,0.4); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; padding: 3px 5px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  input.addEventListener('change', () => {
    const v = parseInt(input.value, 10);
    if (!isNaN(v) && v >= 10) onChange(v);
  });
  input.addEventListener('click', (e) => e.stopPropagation());

  row.appendChild(lbl);
  row.appendChild(input);
  parent.appendChild(row);
  return input;
}

export function addNumberField(
  parent: HTMLElement, label: string, value: number, min: number, max: number,
  onChange: (v: number) => void,
): void {
  const row = document.createElement('div');
  row.style.cssText = 'display: flex; align-items: center; margin-bottom: 4px; gap: 6px;';

  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.cssText = `min-width: 90px; font-size: 11px; color: rgba(200,255,200,0.7);`;

  const input = document.createElement('input');
  input.type = 'number';
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.style.cssText = `
    flex: 1; background: rgba(0,0,0,0.4); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; padding: 3px 5px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  input.addEventListener('change', () => {
    const v = parseInt(input.value, 10);
    if (!isNaN(v) && v >= min && v <= max) onChange(v);
  });
  input.addEventListener('click', (e) => e.stopPropagation());

  row.appendChild(lbl);
  row.appendChild(input);
  parent.appendChild(row);
}

export function addSliderField(
  parent: HTMLElement, label: string, value: number, min: number, max: number,
  onChange: (v: number) => void,
): void {
  const row = document.createElement('div');
  row.style.cssText = 'display: flex; align-items: center; margin-bottom: 4px; gap: 6px;';

  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.cssText = `min-width: 90px; font-size: 11px; color: rgba(200,255,200,0.7);`;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.value = String(value);
  slider.min = String(min);
  slider.max = String(max);
  slider.step = '1';
  slider.style.cssText = `flex: 1; accent-color: ${GREEN};`;

  const valueDisplay = document.createElement('span');
  valueDisplay.textContent = String(value);
  valueDisplay.style.cssText = `min-width: 30px; font-size: 11px; color: ${TEXT_COLOR}; text-align: right;`;

  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10);
    valueDisplay.textContent = String(v);
    onChange(v);
  });
  slider.addEventListener('click', (e) => e.stopPropagation());

  row.appendChild(lbl);
  row.appendChild(slider);
  row.appendChild(valueDisplay);
  parent.appendChild(row);
}

export function addColorSliders(
  parent: HTMLElement, label: string, r: number, g: number, b: number,
  onChange: (r: number, g: number, b: number) => void,
): void {
  const heading = document.createElement('div');
  heading.textContent = label;
  heading.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.7); margin-top: 6px; margin-bottom: 4px;`;
  parent.appendChild(heading);

  let currentR = r;
  let currentG = g;
  let currentB = b;

  const updateColor = () => onChange(currentR, currentG, currentB);

  const addChannelSlider = (channelLabel: string, initialValue: number, setter: (v: number) => void) => {
    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; margin-bottom: 3px; gap: 6px;';

    const lbl = document.createElement('span');
    lbl.textContent = channelLabel;
    lbl.style.cssText = `min-width: 20px; font-size: 10px; color: rgba(200,255,200,0.6);`;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.value = String(initialValue);
    slider.min = '0';
    slider.max = '255';
    slider.step = '1';
    slider.style.cssText = `flex: 1; accent-color: ${GREEN};`;

    const valueDisplay = document.createElement('span');
    valueDisplay.textContent = String(initialValue);
    valueDisplay.style.cssText = `min-width: 30px; font-size: 10px; color: ${TEXT_COLOR}; text-align: right;`;

    slider.addEventListener('input', () => {
      const v = parseInt(slider.value, 10);
      valueDisplay.textContent = String(v);
      setter(v);
      updateColor();
      updateSwatch();
    });
    slider.addEventListener('click', (e) => e.stopPropagation());

    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(valueDisplay);
    parent.appendChild(row);
  };

  addChannelSlider('R', r, v => { currentR = v; });
  addChannelSlider('G', g, v => { currentG = v; });
  addChannelSlider('B', b, v => { currentB = v; });

  const swatch = document.createElement('div');
  swatch.style.cssText = `
    width: 100%; height: 20px; border-radius: 3px; margin-top: 4px;
    border: 1px solid ${PANEL_BORDER};
  `;
  parent.appendChild(swatch);

  const updateSwatch = () => {
    swatch.style.backgroundColor = `rgb(${currentR},${currentG},${currentB})`;
  };
  updateSwatch();
}
