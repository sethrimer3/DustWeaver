/**
 * editorUIHelpers.ts — Low-level button and palette-card builder helpers for
 * the world editor side panel.
 *
 * Extracted from editorUI.ts to keep the main UI assembly file focused on
 * layout and state management rather than DOM widget construction.
 */

import type { PaletteItem } from './editorState';
import { addHoverStyle } from '../ui/helpers';
import { PANEL_BORDER, ACTIVE_BG, BTN_BG, TEXT_COLOR, GREEN } from './editorStyles';

// ── Block-theme visual constants ─────────────────────────────────────────────

/** Fill colour shown in palette previews for each block theme. */
export const THEME_FILL_COLOR: Readonly<Record<string, string>> = {
  blackRock: '#484856',
  brownRock: '#7a5230',
  dirt:      '#7a6038',
};

/** Representative block sprite URL for each block theme. */
export const THEME_BLOCK_SPRITE_URL: Readonly<Record<string, string>> = {
  blackRock: 'SPRITES/BLOCKS/blackRock/blackRock (1).png',
  brownRock: 'SPRITES/BLOCKS/brownRock/brownRock_8x8.png',
  dirt:      'SPRITES/BLOCKS/dirt/dirt_8x8.png',
};

// ── Button helpers ────────────────────────────────────────────────────────────

export function makeBtn(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = `
    background: ${BTN_BG}; color: ${TEXT_COLOR}; border: 1px solid ${PANEL_BORDER};
    padding: 6px 8px; font-size: 11px; font-family: monospace; cursor: pointer;
    border-radius: 3px; transition: background 0.1s;
  `;
  addHoverStyle(btn, { background: ACTIVE_BG }, { background: BTN_BG });
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

export function makeEdgeBtn(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.style.cssText = `
    background: ${BTN_BG}; color: ${TEXT_COLOR}; border: 1px solid ${PANEL_BORDER};
    width: 28px; height: 22px; font-size: 13px; font-family: monospace; cursor: pointer;
    border-radius: 3px; transition: background 0.1s; text-align: center; padding: 0;
    line-height: 22px;
  `;
  addHoverStyle(btn, { background: ACTIVE_BG }, { background: BTN_BG });
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

/**
 * Creates a visual "theme chip" button for the block theme selector.
 * Shows a colour swatch + short name. Highlighted when isActive is true.
 */
export function makeThemeChip(themeId: string, label: string, shortId: string, isActive: boolean, onClick: () => void): HTMLButtonElement {
  const fill = THEME_FILL_COLOR[themeId] ?? '#555';
  const btn = document.createElement('button');
  btn.style.cssText = `
    min-width: 0; padding: 4px 2px; cursor: pointer; border-radius: 4px;
    background: ${isActive ? 'rgba(0,200,100,0.2)' : BTN_BG};
    border: 2px solid ${isActive ? GREEN : PANEL_BORDER};
    color: ${TEXT_COLOR}; font-size: 9px; font-family: monospace;
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    transition: background 0.1s;
  `;
  const swatch = document.createElement('div');
  swatch.style.cssText = `
    width: 24px; height: 24px; border-radius: 3px;
    background: ${fill};
    border: 1px solid rgba(255,255,255,0.15);
    background-image: url(${THEME_BLOCK_SPRITE_URL[themeId] ?? ''});
    background-size: cover; image-rendering: pixelated;
  `;
  const text = document.createElement('span');
  text.textContent = shortId.toUpperCase();
  text.title = label;
  text.style.cssText = `max-width: 100%; overflow: hidden; text-overflow: ellipsis;`;
  btn.appendChild(swatch);
  btn.appendChild(text);
  btn.title = label;
  btn.addEventListener('mouseenter', () => { if (!isActive) btn.style.background = ACTIVE_BG; });
  btn.addEventListener('mouseleave', () => { if (!isActive) btn.style.background = BTN_BG; });
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

export function makeThemePaletteButton(isOpen: boolean, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = isOpen ? '^' : 'All';
  btn.title = 'Open block theme palette';
  btn.style.cssText = `
    width: 30px; padding: 4px 0; cursor: pointer; border-radius: 4px;
    background: ${isOpen ? 'rgba(0,200,100,0.2)' : BTN_BG};
    border: 2px solid ${isOpen ? GREEN : PANEL_BORDER};
    color: ${TEXT_COLOR}; font-size: 13px; font-family: monospace;
    transition: background 0.1s;
  `;
  btn.addEventListener('mouseenter', () => { if (!isOpen) btn.style.background = ACTIVE_BG; });
  btn.addEventListener('mouseleave', () => { if (!isOpen) btn.style.background = BTN_BG; });
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

// ── Block palette card helpers ────────────────────────────────────────────────

/**
 * Builds the CSS for the inner shape div of a block preview, based on the item type and theme.
 */
export function makeBlockPreviewShapeCss(itemId: string, theme: string): { shapeCss: string; containerCss: string } {
  const fill = THEME_FILL_COLOR[theme] ?? '#555';
  const spriteUrl = THEME_BLOCK_SPRITE_URL[theme] ?? '';
  const baseTile = `
    background-color: ${fill};
    background-image: url(${spriteUrl});
    image-rendering: pixelated;
  `;
  const containerCss = `
    width: 40px; height: 40px; overflow: hidden; position: relative; flex-shrink: 0;
    border-radius: 2px; background: rgba(0,0,0,0.3);
  `;

  switch (itemId) {
    case 'block_1x1':
      return {
        containerCss,
        shapeCss: `${baseTile} width: 40px; height: 40px; background-size: cover;`,
      };
    case 'block_2x2':
      return {
        containerCss,
        shapeCss: `${baseTile} width: 40px; height: 40px; background-size: 50% 50%;`,
      };
    case 'ramp_1x1':
      return {
        containerCss,
        shapeCss: `${baseTile} width: 40px; height: 40px; background-size: cover;
          clip-path: polygon(0% 100%, 100% 100%, 100% 0%);`,
      };
    case 'ramp_1x2':
      return {
        containerCss,
        // Shallow angle: full width, half height on tall side
        shapeCss: `${baseTile} width: 40px; height: 40px; background-size: cover;
          clip-path: polygon(0% 100%, 100% 100%, 100% 50%);`,
      };
    case 'ramp_2x2':
      return {
        containerCss,
        shapeCss: `${baseTile} width: 40px; height: 40px; background-size: cover;
          clip-path: polygon(0% 100%, 100% 100%, 100% 0%);`,
      };
    case 'platform': {
      // Thin horizontal bar centred vertically with small end caps
      const pfill = fill;
      return {
        containerCss,
        shapeCss: `
          position: absolute; left: 0; top: 17px;
          width: 40px; height: 6px;
          background-color: ${pfill};
          background-image: url(${spriteUrl});
          background-size: auto 6px; image-rendering: pixelated;
          border-top: 1px solid rgba(255,255,255,0.2);
        `,
      };
    }
    // ── Crumble block variants (same shape as their non-crumble counterpart) ──
    case 'crumble_block':
      return {
        containerCss,
        shapeCss: `${baseTile} width: 40px; height: 40px; background-size: cover; opacity: 0.75;`,
      };
    case 'crumble_block_2x2':
      return {
        containerCss,
        shapeCss: `${baseTile} width: 40px; height: 40px; background-size: 50% 50%; opacity: 0.75;`,
      };
    case 'crumble_ramp_1x1':
      return {
        containerCss,
        shapeCss: `${baseTile} width: 40px; height: 40px; background-size: cover; opacity: 0.75;
          clip-path: polygon(0% 100%, 100% 100%, 100% 0%);`,
      };
    case 'crumble_ramp_1x2':
      return {
        containerCss,
        shapeCss: `${baseTile} width: 40px; height: 40px; background-size: cover; opacity: 0.75;
          clip-path: polygon(0% 100%, 100% 100%, 100% 50%);`,
      };
    case 'crumble_ramp_2x2':
      return {
        containerCss,
        shapeCss: `${baseTile} width: 40px; height: 40px; background-size: cover; opacity: 0.75;
          clip-path: polygon(0% 100%, 100% 100%, 100% 0%);`,
      };
    default:
      return {
        containerCss,
        shapeCss: `${baseTile} width: 40px; height: 40px; background-size: cover;`,
      };
  }
}

/**
 * Creates a palette card for a block item with a visual preview and label.
 */
export function makeBlockPreviewCard(item: PaletteItem, theme: string, onClick: () => void): HTMLDivElement {
  const card = document.createElement('div');
  card.style.cssText = `
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 6px 4px 5px; border-radius: 4px; cursor: pointer;
    background: ${BTN_BG}; border: 1px solid ${PANEL_BORDER};
    transition: background 0.1s;
  `;

  const { containerCss, shapeCss } = makeBlockPreviewShapeCss(item.id, theme);
  const previewWrap = document.createElement('div');
  previewWrap.style.cssText = containerCss;
  const shape = document.createElement('div');
  shape.style.cssText = shapeCss;
  previewWrap.appendChild(shape);

  // Crumble blocks get a crack overlay drawn on a canvas inside the preview
  if (item.isCrumbleBlockItem === 1) {
    const crackCanvas = document.createElement('canvas');
    crackCanvas.width = 40;
    crackCanvas.height = 40;
    crackCanvas.style.cssText = `position: absolute; top: 0; left: 0; pointer-events: none;`;
    const cctx = crackCanvas.getContext('2d');
    if (cctx) {
      cctx.strokeStyle = '#c8a060'; // neutral crack color in palette; variant color shows in preview cursor and placed blocks
      cctx.lineWidth = 1.5;
      cctx.beginPath();
      cctx.moveTo(17, 4);
      cctx.lineTo(22, 18);
      cctx.lineTo(18, 22);
      cctx.lineTo(23, 36);
      cctx.moveTo(22, 18);
      cctx.lineTo(30, 12);
      cctx.stroke();
    }
    previewWrap.appendChild(crackCanvas);
  }

  card.appendChild(previewWrap);

  const lbl = document.createElement('div');
  lbl.textContent = item.label;
  lbl.style.cssText = `
    font-size: 9px; color: ${TEXT_COLOR}; text-align: center; line-height: 1.2;
    word-break: break-word;
  `;
  card.appendChild(lbl);

  card.addEventListener('mouseenter', () => {
    if (card.style.background !== ACTIVE_BG) card.style.background = 'rgba(0,200,100,0.12)';
  });
  card.addEventListener('mouseleave', () => {
    if (card.style.background !== ACTIVE_BG) card.style.background = BTN_BG;
  });
  card.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return card;
}

