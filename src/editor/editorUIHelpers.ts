/**
 * editorUIHelpers.ts — Low-level button and palette-card builder helpers for
 * the world editor side panel.
 *
 * Extracted from editorUI.ts to keep the main UI assembly file focused on
 * layout and state management rather than DOM widget construction.
 */

import type { PaletteItem } from './editorState';
import { addHoverStyle } from '../ui/helpers';
import { PANEL_BORDER, ACTIVE_BG, BTN_BG, TEXT_COLOR, ACCENT_GOLD } from './editorStyles';
import { FOLDER_BLOCK_THEMES } from '../render/walls/folderBlockThemes';

// ── Block-theme visual constants ─────────────────────────────────────────────

// Build fill-color and sprite-URL maps, then freeze them to prevent accidental
// mutations after module initialisation.
const _fillColorMutable: Record<string, string> = {
  blackRock: '#484856',
  brownRock: '#7a5230',
  dirt:      '#7a6038',
};

const _spriteUrlMutable: Record<string, string> = {
  blackRock: 'SPRITES/BLOCKS/blackRock/blackRockBlock (1).png',
  brownRock: 'SPRITES/BLOCKS/brownRock/brownRockBlock.png',
  dirt:      'SPRITES/BLOCKS/dirt/dirtBlock.png',
};

// Populate folder-based theme entries from discovered sprites.
for (const theme of FOLDER_BLOCK_THEMES) {
  if (theme.sprite16Urls.length > 0) {
    _spriteUrlMutable[theme.id] = theme.sprite16Urls[0];
  }
  // Use a neutral grey as the fill-color fallback for folder-based themes.
  // The sprite thumbnail in the chip gives the primary visual identity.
  if (!(theme.id in _fillColorMutable)) {
    _fillColorMutable[theme.id] = '#555555';
  }
}

/** Fill colour shown in palette previews for each block theme. */
export const THEME_FILL_COLOR: Readonly<Record<string, string>> = Object.freeze(_fillColorMutable);

/** Representative block sprite URL for each block theme. */
export const THEME_BLOCK_SPRITE_URL: Readonly<Record<string, string>> = Object.freeze(_spriteUrlMutable);

function cssUrl(url: string): string {
  return url.length > 0 ? `url("${url.replace(/"/g, '\\"')}")` : 'none';
}

// ── Collapsible section helper ──────────────────────────────────────────────
//
// Shared, accessible collapsible-section component used by every top-level
// panel in the editor sidebars (room settings, layers, inspector, export,
// tools, brush, category tabs, palette, etc). A real <button> header (native
// keyboard activation, no extra tabindex wiring) with a chevron reflecting
// state, `aria-expanded` on the header, and `aria-controls` pointing at the
// body element's id. Sections default to collapsed — this is a purely
// presentational default (not session-persisted); callers that restore
// session state (e.g. the layers panel's workspace prefs) call
// `setExpanded()` right after construction.

export interface CollapsibleSection {
  /** Outer wrapper — append this (not `header`/`body` individually) to a parent. */
  readonly wrapper: HTMLDivElement;
  readonly header: HTMLButtonElement;
  readonly chevron: HTMLSpanElement;
  /** Append panel content here. */
  readonly body: HTMLDivElement;
  /** Stable identifying key, when passed to createCollapsibleSection — used
   *  to match this section's expanded state back up across a session-state
   *  snapshot/restore (see EditorUI.getSessionUIStateSnapshot). */
  readonly key: string | null;
  setExpanded: (expanded: boolean) => void;
  isExpanded: () => boolean;
}

let collapsibleSectionIdCounter = 0;
function nextCollapsibleBodyId(): string {
  collapsibleSectionIdCounter += 1;
  return `dw-collapsible-body-${collapsibleSectionIdCounter}`;
}

const COLLAPSIBLE_FOCUS_STYLE_ID = 'dw-editor-collapsible-focus-style';
function ensureCollapsibleFocusStyleInjected(): void {
  if (document.getElementById(COLLAPSIBLE_FOCUS_STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = COLLAPSIBLE_FOCUS_STYLE_ID;
  style.textContent = `
    .dw-collapsible-header-btn:focus-visible {
      outline: 2px solid #ffffff;
      outline-offset: 1px;
    }
  `;
  document.head.appendChild(style);
}

export function createCollapsibleSection(
  titleText: string,
  opts?: { defaultExpanded?: boolean; wrapperCss?: string; key?: string },
): CollapsibleSection {
  ensureCollapsibleFocusStyleInjected();

  const wrapper = document.createElement('div');
  wrapper.style.cssText = opts?.wrapperCss ?? `
    border: 1px solid ${PANEL_BORDER}; border-radius: 3px;
    padding: 6px 8px; margin-bottom: 10px; background: rgba(0,0,0,0.2);
  `;

  const bodyId = nextCollapsibleBodyId();

  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'dw-collapsible-header-btn';
  header.setAttribute('aria-controls', bodyId);
  header.style.cssText = `
    display: flex; align-items: center; justify-content: space-between; width: 100%;
    cursor: pointer; user-select: none; background: none; border: none; padding: 0;
    color: inherit; font: inherit;
  `;

  const titleEl = document.createElement('div');
  titleEl.textContent = titleText;
  titleEl.style.cssText = `font-size: 11px; color: ${ACCENT_GOLD}; font-weight: bold;`;
  header.appendChild(titleEl);

  const chevron = document.createElement('span');
  chevron.setAttribute('aria-hidden', 'true');
  chevron.style.cssText = 'font-size: 10px; color: rgba(241,231,203,0.6);';
  header.appendChild(chevron);

  wrapper.appendChild(header);

  const body = document.createElement('div');
  body.id = bodyId;
  body.style.cssText = 'margin-top: 6px;';
  wrapper.appendChild(body);

  let expanded = opts?.defaultExpanded ?? false;

  function setExpanded(value: boolean): void {
    expanded = value;
    header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    chevron.textContent = expanded ? '▾' : '▸';
    body.style.display = expanded ? 'block' : 'none';
  }

  function isExpanded(): boolean {
    return expanded;
  }

  header.addEventListener('click', (e) => {
    e.stopPropagation();
    setExpanded(!expanded);
  });

  setExpanded(expanded);

  return { wrapper, header, chevron, body, key: opts?.key ?? null, setExpanded, isExpanded };
}

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
    background: ${isActive ? 'rgba(212,168,75,0.2)' : BTN_BG};
    border: 2px solid ${isActive ? ACCENT_GOLD : PANEL_BORDER};
    color: ${TEXT_COLOR}; font-size: 9px; font-family: monospace;
    display: flex; flex-direction: column; align-items: center; gap: 3px;
    transition: background 0.1s;
  `;
  const swatch = document.createElement('div');
  swatch.style.cssText = `
    width: 24px; height: 24px; border-radius: 3px;
    background: ${fill};
    border: 1px solid rgba(255,255,255,0.15);
    overflow: hidden; display: flex; align-items: center; justify-content: center;
  `;
  const spriteUrl = THEME_BLOCK_SPRITE_URL[themeId] ?? '';
  if (spriteUrl.length > 0) {
    const img = document.createElement('img');
    img.src = spriteUrl;
    img.alt = '';
    img.draggable = false;
    img.style.cssText = `
      width: 100%; height: 100%; object-fit: cover;
      image-rendering: pixelated; pointer-events: none;
    `;
    swatch.appendChild(img);
  }
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
    background: ${isOpen ? 'rgba(212,168,75,0.2)' : BTN_BG};
    border: 2px solid ${isOpen ? ACCENT_GOLD : PANEL_BORDER};
    color: ${TEXT_COLOR}; font-size: 13px; font-family: monospace;
    transition: background 0.1s;
  `;
  btn.addEventListener('mouseenter', () => { if (!isOpen) btn.style.background = ACTIVE_BG; });
  btn.addEventListener('mouseleave', () => { if (!isOpen) btn.style.background = BTN_BG; });
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

/**
 * Creates one of the 4 compact block-theme "slots" shown atop the Blocks
 * palette category. Each slot shows a tile-sprite thumbnail; clicking the
 * slot body activates its theme, while a small "replace" icon button in the
 * top-right corner (with its own click handler, `stopPropagation`'d so it
 * never also triggers slot-body selection) opens the full theme palette.
 */
export function makeThemeSlot(
  themeId: string,
  label: string,
  isActive: boolean,
  onSelect: () => void,
  onReplace: () => void,
): HTMLDivElement {
  const fill = THEME_FILL_COLOR[themeId] ?? '#555';
  const slot = document.createElement('div');
  slot.setAttribute('role', 'button');
  slot.setAttribute('tabindex', '0');
  slot.setAttribute('aria-label', `Theme slot: ${label}${isActive ? ' (active)' : ''}`);
  slot.title = label;
  slot.style.cssText = `
    position: relative; width: 100%; aspect-ratio: 1 / 1; cursor: pointer;
    border-radius: 4px; overflow: hidden; box-sizing: border-box;
    background: ${fill};
    border: 2px solid ${isActive ? ACCENT_GOLD : PANEL_BORDER};
    box-shadow: ${isActive ? `0 0 0 2px rgba(240,199,94,0.55)` : 'none'};
    transition: border-color 0.1s;
  `;
  const spriteUrl = THEME_BLOCK_SPRITE_URL[themeId] ?? '';
  if (spriteUrl.length > 0) {
    const img = document.createElement('img');
    img.src = spriteUrl;
    img.alt = '';
    img.draggable = false;
    img.style.cssText = `
      position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
      image-rendering: pixelated; pointer-events: none;
    `;
    slot.appendChild(img);
  }
  slot.addEventListener('click', (e) => { e.stopPropagation(); onSelect(); });
  slot.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
  });

  const replaceBtn = document.createElement('button');
  replaceBtn.textContent = '⇄';
  replaceBtn.title = `Replace theme in this slot (currently ${label})`;
  replaceBtn.setAttribute('aria-label', `Replace theme in slot: ${label}`);
  replaceBtn.style.cssText = `
    position: absolute; top: 1px; right: 1px; width: 14px; height: 14px;
    padding: 0; line-height: 1; font-size: 9px; cursor: pointer; border-radius: 2px;
    background: rgba(0,0,0,0.65); border: 1px solid rgba(255,255,255,0.35);
    color: ${TEXT_COLOR};
  `;
  replaceBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onReplace();
  });
  slot.appendChild(replaceBtn);

  return slot;
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
    background-image: ${cssUrl(spriteUrl)};
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
          background-image: ${cssUrl(spriteUrl)};
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
    case 'bounce_pad_1x1_dim':
    case 'bounce_pad_1x1_bright':
      return {
        containerCss,
        shapeCss: `width: 40px; height: 40px; background: rgba(80,30,5,0.85);
          border: 2px solid rgba(220,80,10,0.80); box-sizing: border-box;`,
      };
    case 'bounce_pad_2x2_dim':
    case 'bounce_pad_2x2_bright':
      return {
        containerCss,
        // 2×2 grid overlay distinguishes this from the 1×1 variant.
        shapeCss: `width: 40px; height: 40px; background: rgba(80,30,5,0.85);
          border: 2px solid rgba(220,80,10,0.80); box-sizing: border-box;
          background-image:
            linear-gradient(rgba(220,80,10,0.30) 1px, transparent 1px),
            linear-gradient(90deg, rgba(220,80,10,0.30) 1px, transparent 1px);
          background-size: 50% 50%;`,
      };
    case 'bounce_pad_ramp_1x1_dim':
    case 'bounce_pad_ramp_1x1_bright':
      return {
        containerCss,
        shapeCss: `width: 40px; height: 40px; background: rgba(80,30,5,0.85);
          border: 2px solid rgba(220,80,10,0.80); box-sizing: border-box;
          clip-path: polygon(0% 100%, 100% 100%, 100% 0%);`,
      };
    case 'bounce_pad_ramp_1x2_dim':
    case 'bounce_pad_ramp_1x2_bright':
      return {
        containerCss,
        shapeCss: `width: 40px; height: 40px; background: rgba(80,30,5,0.85);
          border: 2px solid rgba(220,80,10,0.80); box-sizing: border-box;
          clip-path: polygon(0% 100%, 100% 100%, 100% 50%);`,
      };
    case 'bounce_pad_ramp_2x2_dim':
    case 'bounce_pad_ramp_2x2_bright':
      return {
        containerCss,
        shapeCss: `width: 40px; height: 40px; background: rgba(80,30,5,0.85);
          border: 2px solid rgba(220,80,10,0.80); box-sizing: border-box;
          clip-path: polygon(0% 100%, 100% 100%, 100% 0%);`,
      };
    case 'pillar_half_width':
      // Narrow vertical pillar centred in the 40x40 preview cell.
      return {
        containerCss,
        shapeCss: `
          position: absolute; left: 15px; top: 0;
          width: 10px; height: 40px;
          background-color: ${fill};
          background-image: ${cssUrl(spriteUrl)};
          background-size: auto 40px; image-rendering: pixelated;
          border-left: 1px solid rgba(255,255,255,0.15);
          border-right: 1px solid rgba(255,255,255,0.15);
        `,
      };
    case 'springboard':
      // Spring / upward-arrow icon, visually distinct from bounce pads (which
      // use an orange glowing-core dot — see the isBouncePadItem overlay below).
      return {
        containerCss,
        shapeCss: `width: 40px; height: 40px; background: rgba(20,60,30,0.85);
          border: 2px solid rgba(70,220,110,0.85); box-sizing: border-box;`,
      };
    case 'breakable_block_1x1':
      return {
        containerCss,
        shapeCss: `${baseTile} width: 40px; height: 40px; background-size: cover; opacity: 0.9;`,
      };
    case 'breakable_block_2x2':
      return {
        containerCss,
        shapeCss: `${baseTile} width: 40px; height: 40px; background-size: 50% 50%; opacity: 0.9;`,
      };
    case 'kinetic_block_1x1':
      return {
        containerCss,
        shapeCss: `width: 40px; height: 40px; background: rgba(10,30,90,0.88);
          border: 2px solid rgba(60,140,255,0.80); box-sizing: border-box;`,
      };
    case 'kinetic_block_2x2':
      return {
        containerCss,
        shapeCss: `width: 40px; height: 40px; background: rgba(10,30,90,0.88);
          border: 2px solid rgba(60,140,255,0.80); box-sizing: border-box;
          background-image: linear-gradient(rgba(60,140,255,0.12) 1px, transparent 1px),
            linear-gradient(90deg, rgba(60,140,255,0.12) 1px, transparent 1px);
          background-size: 50% 50%;`,
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
  // Bounce pads get a glowing core dot in the centre of the preview
  if (item.isBouncePadItem === 1) {
    const coreCanvas = document.createElement('canvas');
    coreCanvas.width = 40;
    coreCanvas.height = 40;
    coreCanvas.style.cssText = `position: absolute; top: 0; left: 0; pointer-events: none;`;
    const cctx2 = coreCanvas.getContext('2d');
    if (cctx2) {
      const dotSize = item.bouncePadSpeedFactorIndex === 1 ? 6 : 4;
      const cx2 = 20;
      const cy2 = 20;
      // Outer glow
      cctx2.fillStyle = 'rgba(255,140,30,0.35)';
      cctx2.fillRect(cx2 - dotSize, cy2 - dotSize, dotSize * 2, dotSize * 2);
      // Inner bright dot
      const innerSize = dotSize * 0.5;
      cctx2.fillStyle = item.bouncePadSpeedFactorIndex === 1 ? 'rgba(255,220,60,0.95)' : 'rgba(255,100,15,0.85)';
      cctx2.fillRect(cx2 - innerSize, cy2 - innerSize, innerSize * 2, innerSize * 2);
    }
    previewWrap.appendChild(coreCanvas);
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
    if (card.style.background !== ACTIVE_BG) card.style.background = 'rgba(212,168,75,0.12)';
  });
  card.addEventListener('mouseleave', () => {
    if (card.style.background !== ACTIVE_BG) card.style.background = BTN_BG;
  });
  card.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return card;
}

// ── Generic palette card helpers ──────────────────────────────────────────────

/**
 * Creates the outer shell of a palette card (same visual style as
 * `makeBlockPreviewCard`) with a custom 40×40 preview element and label.
 *
 * Used by `editorPalettePreview.ts` to keep the card style consistent across
 * all palette categories.
 */
export function makePaletteCardShell(
  previewEl: HTMLElement,
  label: string,
  onClick: () => void,
): HTMLDivElement {
  const card = document.createElement('div');
  card.style.cssText = `
    display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 6px 4px 5px; border-radius: 4px; cursor: pointer;
    background: ${BTN_BG}; border: 1px solid ${PANEL_BORDER};
    transition: background 0.1s;
  `;

  card.appendChild(previewEl);

  const lbl = document.createElement('div');
  lbl.textContent = label;
  lbl.style.cssText = `
    font-size: 9px; color: ${TEXT_COLOR}; text-align: center; line-height: 1.2;
    word-break: break-word;
  `;
  card.appendChild(lbl);

  card.addEventListener('mouseenter', () => {
    if (card.style.background !== ACTIVE_BG) card.style.background = 'rgba(212,168,75,0.12)';
  });
  card.addEventListener('mouseleave', () => {
    if (card.style.background !== ACTIVE_BG) card.style.background = BTN_BG;
  });
  card.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return card;
}

/**
 * Standard 40×40 preview container used across all palette card types.
 */
export function makePreviewContainer(): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = `
    width: 40px; height: 40px; overflow: hidden; position: relative; flex-shrink: 0;
    border-radius: 2px; background: rgba(0,0,0,0.3);
  `;
  return wrap;
}

