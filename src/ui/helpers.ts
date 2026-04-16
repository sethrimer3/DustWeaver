/**
 * Shared UI component helpers.
 *
 * Provides factory functions for common styled elements and the
 * addHoverStyle utility for the mouseenter/mouseleave highlight pattern.
 */

// ─── Shared colour tokens ────────────────────────────────────────────────────

export const GOLD = '#d4a84b';
export const GOLD_HOVER = '#e8c374';
export const PANEL_BORDER = 'rgba(212,168,75,0.35)';

// ─── Hover helper ─────────────────────────────────────────────────────────────

export interface HoverStyles {
  background?: string;
  borderColor?: string;
  color?: string;
  textShadow?: string;
}

/**
 * Wires `mouseenter` / `mouseleave` listeners onto `el` to swap the given
 * CSS properties between the hover and leave states.
 */
export function addHoverStyle(
  el: HTMLElement,
  hover: HoverStyles,
  leave: HoverStyles,
): void {
  el.addEventListener('mouseenter', () => {
    if (hover.background  !== undefined) el.style.background  = hover.background;
    if (hover.borderColor !== undefined) el.style.borderColor = hover.borderColor;
    if (hover.color       !== undefined) el.style.color       = hover.color;
    if (hover.textShadow  !== undefined) el.style.textShadow  = hover.textShadow;
  });
  el.addEventListener('mouseleave', () => {
    if (leave.background  !== undefined) el.style.background  = leave.background;
    if (leave.borderColor !== undefined) el.style.borderColor = leave.borderColor;
    if (leave.color       !== undefined) el.style.color       = leave.color;
    if (leave.textShadow  !== undefined) el.style.textShadow  = leave.textShadow;
  });
}

// ─── Button factory ───────────────────────────────────────────────────────────

/**
 * Creates a styled `<button>` with the standard pause-menu appearance:
 * 260 px wide, gold Cinzel text, dark background, hover highlight.
 */
export function makeButton(text: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = `
    display: block;
    width: 260px;
    margin: 0 auto 14px auto;
    padding: 14px 0;
    font-family: 'Cinzel', serif;
    font-size: 1.15rem;
    color: ${GOLD};
    background: rgba(30,28,22,0.85);
    border: 2px solid ${PANEL_BORDER};
    border-radius: 6px;
    cursor: pointer;
    text-align: center;
    letter-spacing: 1px;
    transition: background 0.15s, color 0.15s;
  `;
  addHoverStyle(
    btn,
    { background: 'rgba(60,55,40,0.9)', color: GOLD_HOVER },
    { background: 'rgba(30,28,22,0.85)', color: GOLD },
  );
  btn.addEventListener('click', onClick);
  return btn;
}

// ─── Slider factory ───────────────────────────────────────────────────────────

/**
 * Creates a labelled range slider row that reports values in [0, 1].
 * `initialValue` is expected to be in [0, 1]; the slider shows percentages.
 */
export function makeSlider(
  label: string,
  initialValue: number,
  onChange: (value: number) => void,
): HTMLDivElement {
  const row = document.createElement('div');
  row.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    margin: 14px 0; font-family: 'Cinzel', serif; color: ${GOLD};
    font-size: 0.95rem;
  `;

  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.minWidth = '80px';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(Math.round(initialValue * 100));
  slider.style.cssText = `
    flex: 1; margin: 0 12px; accent-color: ${GOLD}; cursor: pointer;
  `;

  const valLabel = document.createElement('span');
  valLabel.textContent = `${Math.round(initialValue * 100)}%`;
  valLabel.style.minWidth = '44px';
  valLabel.style.textAlign = 'right';

  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10);
    valLabel.textContent = `${v}%`;
    onChange(v / 100);
  });

  row.appendChild(lbl);
  row.appendChild(slider);
  row.appendChild(valLabel);
  return row;
}

// ─── Tab-button factory ───────────────────────────────────────────────────────

/**
 * Creates a tab-style `<button>` suitable for the options panel tab bar.
 * The active tab is highlighted with a gold underline.
 */
export function makeTabButton(
  text: string,
  isActive: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = `
    flex: 1;
    padding: 10px 0;
    font-family: 'Cinzel', serif;
    font-size: 1rem;
    color: ${isActive ? '#fff' : GOLD};
    background: ${isActive ? 'rgba(212,168,75,0.2)' : 'transparent'};
    border: none;
    border-bottom: ${isActive ? `2px solid ${GOLD}` : '2px solid transparent'};
    cursor: pointer;
    transition: background 0.15s;
  `;
  btn.addEventListener('click', onClick);
  return btn;
}
