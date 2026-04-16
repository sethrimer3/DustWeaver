/**
 * Editor UI — toolbar, palette panel, inspector panel, and export controls.
 * All DOM elements are created dynamically and removed on cleanup.
 */

import {
  EditorState, EditorTool, PaletteCategory, PALETTE_ITEMS,
  PaletteItem, BLOCK_THEMES, BACKGROUND_OPTIONS, LIGHTING_OPTIONS, FADE_COLOR_OPTIONS,
  BlockTheme, BackgroundId, LightingEffect,
} from './editorState';
import { addHoverStyle } from '../ui/helpers';

// ── Style constants ──────────────────────────────────────────────────────────

const PANEL_BG = 'rgba(15,15,20,0.92)';
const PANEL_BORDER = 'rgba(0,200,100,0.4)';
const ACTIVE_BG = 'rgba(0,200,100,0.25)';
const BTN_BG = 'rgba(30,30,40,0.85)';
const TEXT_COLOR = '#c0ffd0';
const GREEN = '#00c864';

// ── Block-theme visual constants ─────────────────────────────────────────────

/** Fill colour shown in palette previews for each block theme. */
const THEME_FILL_COLOR: Readonly<Record<string, string>> = {
  blackRock: '#484856',
  brownRock: '#7a5230',
  dirt:      '#7a6038',
};

/** Representative block sprite URL for each block theme. */
const THEME_BLOCK_SPRITE_URL: Readonly<Record<string, string>> = {
  blackRock: 'SPRITES/BLOCKS/blackRock/blackRock (1).png',
  brownRock: 'SPRITES/BLOCKS/brownRock/brownRock_8x8.png',
  dirt:      'SPRITES/BLOCKS/dirt/dirt_8x8.png',
};

/** Pillar sprite URL for each block theme (fallback to block sprite). */
const THEME_PILLAR_SPRITE_URL: Readonly<Record<string, string>> = {
  blackRock: 'SPRITES/BLOCKS/blackRock/blackRock_pillar (1).png',
  brownRock: 'SPRITES/BLOCKS/brownRock/brownRock_8x8.png',
  dirt:      'SPRITES/BLOCKS/dirt/dirt_8x8.png',
};

// ── UI container ─────────────────────────────────────────────────────────────

export interface EditorUI {
  container: HTMLDivElement;
  /** Update UI to reflect current editor state. */
  update: (state: EditorState) => void;
  /** Set callbacks. */
  setCallbacks: (cbs: EditorUICallbacks) => void;
  destroy: () => void;
}

export type RoomEdge = 'top' | 'bottom' | 'left' | 'right';

export interface EditorUICallbacks {
  onToolChange: (tool: EditorTool) => void;
  onCategoryChange: (category: PaletteCategory) => void;
  onPaletteItemSelect: (item: PaletteItem) => void;
  onExport: () => void;
  onLinkTransition: () => void;
  onPropertyChange: (prop: string, value: string | number) => void;
  onRoomDimensionsChange: (prop: 'widthBlocks' | 'heightBlocks', value: number) => void;
  /** Add or remove one row/column from the given edge. delta is +1 (add) or -1 (remove). */
  onEdgeResize: (edge: RoomEdge, delta: 1 | -1) => void;
  onBlockThemeChange: (theme: BlockTheme) => void;
  onLightingEffectChange: (effect: LightingEffect) => void;
  onBackgroundChange: (backgroundId: BackgroundId) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onExportAllChanges: () => void;
  /** Open the visual world map overlay. */
  onOpenVisualMap: () => void;
}

export function createEditorUI(root: HTMLElement): EditorUI {
  let callbacks: EditorUICallbacks | null = null;

  const container = document.createElement('div');
  container.id = 'editor-ui';
  container.style.cssText = `
    position: absolute; top: 0; left: 0; width: 260px; height: 100%;
    background: ${PANEL_BG}; border-right: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; font-family: 'Cinzel', monospace; font-size: 12px;
    overflow-y: auto; z-index: 900; padding: 10px; box-sizing: border-box;
    pointer-events: auto;
  `;

  // ── Title ────────────────────────────────────────────────────────────────
  const title = document.createElement('div');
  title.textContent = '🛠 World Editor';
  title.style.cssText = `font-size: 15px; color: ${GREEN}; margin-bottom: 12px; font-weight: bold;`;
  container.appendChild(title);

  // ── Confirm / Cancel bar ─────────────────────────────────────────────────
  const confirmCancelBar = document.createElement('div');
  confirmCancelBar.style.cssText = 'display: flex; gap: 4px; margin-bottom: 10px;';

  const confirmBtn = makeBtn('✔ Confirm', () => callbacks?.onConfirm());
  confirmBtn.style.cssText += `
    flex: 1; padding: 8px; font-size: 12px;
    background: rgba(0,100,50,0.4); border-color: ${GREEN}; color: ${GREEN};
  `;
  confirmCancelBar.appendChild(confirmBtn);

  const cancelBtn = makeBtn('✕ Cancel', () => callbacks?.onCancel());
  cancelBtn.style.cssText += `
    flex: 1; padding: 8px; font-size: 12px;
    background: rgba(100,30,20,0.4); border-color: #ff6644; color: #ff6644;
  `;
  confirmCancelBar.appendChild(cancelBtn);
  container.appendChild(confirmCancelBar);

  // ── Export All Changes button ────────────────────────────────────────────
  const exportAllBtn = makeBtn('📦 Export All Changes', () => callbacks?.onExportAllChanges());
  exportAllBtn.style.cssText += `
    width: 100%; padding: 8px; font-size: 12px; margin-bottom: 10px;
    background: rgba(80,60,0,0.4); border-color: #ccaa00; color: #ccaa00;
  `;
  container.appendChild(exportAllBtn);

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
  container.appendChild(toolBar);

  // ── Room dimensions ──────────────────────────────────────────────────────
  const roomDimDiv = document.createElement('div');
  roomDimDiv.style.cssText = `
    border: 1px solid ${PANEL_BORDER}; border-radius: 3px;
    padding: 6px 8px; margin-bottom: 10px; background: rgba(0,0,0,0.2);
  `;
  const roomDimTitle = document.createElement('div');
  roomDimTitle.textContent = 'Room Dimensions';
  roomDimTitle.style.cssText = `font-size: 11px; color: ${GREEN}; margin-bottom: 6px; font-weight: bold;`;
  roomDimDiv.appendChild(roomDimTitle);

  // Edge resize buttons (add/remove row/column from each edge)
  const edgeResizeDiv = document.createElement('div');
  edgeResizeDiv.style.cssText = `margin-top: 6px;`;

  const edgeResizeTitle = document.createElement('div');
  edgeResizeTitle.textContent = 'Add / Remove Row or Column';
  edgeResizeTitle.style.cssText = `font-size: 10px; color: rgba(200,255,200,0.5); margin-bottom: 4px;`;
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
    lbl.style.cssText = `min-width: 50px; font-size: 11px; color: rgba(200,255,200,0.7);`;
    row.appendChild(lbl);

    const addBtn = makeEdgeBtn('+', () => callbacks?.onEdgeResize(edge, 1));
    const removeBtn = makeEdgeBtn('−', () => callbacks?.onEdgeResize(edge, -1));
    row.appendChild(addBtn);
    row.appendChild(removeBtn);
    edgeResizeDiv.appendChild(row);
  }
  roomDimDiv.appendChild(edgeResizeDiv);

  container.appendChild(roomDimDiv);

  // ── Background dropdown ──────────────────────────────────────────────────
  const bgDiv = document.createElement('div');
  bgDiv.style.cssText = `
    border: 1px solid ${PANEL_BORDER}; border-radius: 3px;
    padding: 6px 8px; margin-bottom: 10px; background: rgba(0,0,0,0.2);
  `;
  const bgTitle = document.createElement('div');
  bgTitle.textContent = 'Background';
  bgTitle.style.cssText = `font-size: 11px; color: ${GREEN}; margin-bottom: 6px; font-weight: bold;`;
  bgDiv.appendChild(bgTitle);
  const bgSelect = document.createElement('select');
  bgSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  for (const opt of BACKGROUND_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    bgSelect.appendChild(o);
  }
  bgSelect.addEventListener('change', () => {
    callbacks?.onBackgroundChange(bgSelect.value as BackgroundId);
  });
  bgSelect.addEventListener('click', (e) => e.stopPropagation());
  bgDiv.appendChild(bgSelect);
  container.appendChild(bgDiv);

  // ── Category tabs ────────────────────────────────────────────────────────
  let lastRenderedRoomId = '';
  let lastRenderedWidthBlocks = -1;
  let lastRenderedHeightBlocks = -1;
  let lastRenderedBackgroundId = '';
  let dimWidthInput: HTMLInputElement | null = null;
  let dimHeightInput: HTMLInputElement | null = null;
  const catBar = document.createElement('div');
  catBar.style.cssText = 'display: flex; gap: 4px; margin-bottom: 8px;';
  const categories: PaletteCategory[] = ['blocks', 'enemies', 'triggers'];
  const catBtns: HTMLButtonElement[] = [];
  for (const cat of categories) {
    const btn = makeBtn(cat, () => callbacks?.onCategoryChange(cat));
    btn.dataset.category = cat;
    catBtns.push(btn);
    catBar.appendChild(btn);
  }
  container.appendChild(catBar);

  // ── Lighting dropdown (shown only when "blocks" category is active) ─────
  const lightingDiv = document.createElement('div');
  lightingDiv.style.cssText = `margin-bottom: 8px;`;
  const lightingLabel = document.createElement('div');
  lightingLabel.textContent = 'Lighting';
  lightingLabel.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.7); margin-bottom: 4px;`;
  lightingDiv.appendChild(lightingLabel);
  const lightingSelect = document.createElement('select');
  lightingSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  for (const opt of LIGHTING_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    lightingSelect.appendChild(o);
  }
  lightingSelect.addEventListener('change', () => {
    callbacks?.onLightingEffectChange(lightingSelect.value as LightingEffect);
  });
  lightingSelect.addEventListener('click', (e) => e.stopPropagation());
  lightingDiv.appendChild(lightingSelect);

  // ── Palette items ────────────────────────────────────────────────────────
  const paletteDiv = document.createElement('div');
  paletteDiv.style.cssText = 'margin-bottom: 12px;';
  container.appendChild(paletteDiv);

  // Track rendered palette state to avoid recreating buttons every frame
  let renderedCategory: PaletteCategory | null = null;
  let lastRenderedBlockTheme = '';
  let lastRenderedLightingEffect = '';
  let paletteItems: { btn: HTMLElement; itemId: string }[] = [];

  // ── Inspector ────────────────────────────────────────────────────────────
  const inspectorDiv = document.createElement('div');
  inspectorDiv.style.cssText = `
    border-top: 1px solid ${PANEL_BORDER}; padding-top: 10px; margin-top: 8px;
  `;
  container.appendChild(inspectorDiv);

  // Track rendered inspector state to avoid recreating fields every frame
  let inspectorElementUid: number = -1;
  let inspectorElementType: string = '';
  let inspectorElementCount: number = 0;

  // ── Export button ────────────────────────────────────────────────────────
  const exportBtn = makeBtn('📥 Export Room JSON', () => callbacks?.onExport());
  exportBtn.style.cssText += `
    width: 100%; margin-top: 12px; padding: 10px; font-size: 13px;
    background: rgba(0,100,50,0.4); border-color: ${GREEN};
  `;
  container.appendChild(exportBtn);

  root.appendChild(container);

  // ── Top-right "World Map" button bar ─────────────────────────────────────
  const topRightBar = document.createElement('div');
  topRightBar.style.cssText = `
    position: absolute; top: 10px; right: 10px; z-index: 920;
    display: flex; gap: 6px; pointer-events: auto;
  `;
  const worldMapBtn = makeBtn('🗺 World Map', () => callbacks?.onOpenVisualMap());
  worldMapBtn.style.cssText += `
    padding: 8px 14px; font-size: 12px;
    background: rgba(0,80,60,0.6); border-color: rgba(0,200,100,0.6); color: ${GREEN};
  `;
  topRightBar.appendChild(worldMapBtn);
  root.appendChild(topRightBar);

  function update(state: EditorState): void {
    // Update tool highlight
    for (const btn of toolBtns) {
      btn.style.background = btn.dataset.tool === state.activeTool ? ACTIVE_BG : BTN_BG;
    }
    // Update category highlight
    for (const btn of catBtns) {
      btn.style.background = btn.dataset.category === state.activeCategory ? ACTIVE_BG : BTN_BG;
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

    // Update background dropdown
    const currentBgId = state.roomData?.backgroundId ?? 'brownRock';
    if (currentBgId !== lastRenderedBackgroundId) {
      lastRenderedBackgroundId = currentBgId;
      if (document.activeElement !== bgSelect) {
        bgSelect.value = currentBgId;
      }
    }

    // Update palette area — recreate when category changes OR when block theme changes
    const currentTheme = state.roomData?.blockTheme ?? 'blackRock';
    const currentLighting = state.roomData?.lightingEffect ?? 'DEFAULT';
    const needsPaletteRebuild = renderedCategory !== state.activeCategory ||
      (state.activeCategory === 'blocks' && currentTheme !== lastRenderedBlockTheme);

    if (needsPaletteRebuild) {
      renderedCategory = state.activeCategory;
      lastRenderedBlockTheme = currentTheme;
      lastRenderedLightingEffect = currentLighting;
      paletteDiv.innerHTML = '';
      paletteItems = [];

      if (state.activeCategory === 'blocks') {
        // ── Visual block theme selector ─────────────────────────────────────
        const themeSection = document.createElement('div');
        themeSection.style.cssText = `margin-bottom: 8px;`;
        const themeTitle = document.createElement('div');
        themeTitle.textContent = 'Block Theme';
        themeTitle.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.7); margin-bottom: 5px;`;
        themeSection.appendChild(themeTitle);

        const themeRow = document.createElement('div');
        themeRow.style.cssText = `display: flex; gap: 4px;`;
        for (const th of BLOCK_THEMES) {
          const isActive = th.id === currentTheme;
          const chip = makeThemeChip(th.id, th.label, isActive, () => {
            callbacks?.onBlockThemeChange(th.id as BlockTheme);
          });
          themeRow.appendChild(chip);
        }
        themeSection.appendChild(themeRow);
        paletteDiv.appendChild(themeSection);

        // ── Lighting dropdown ───────────────────────────────────────────────
        lightingSelect.value = currentLighting;
        paletteDiv.appendChild(lightingDiv);

        // ── Block type preview grid ─────────────────────────────────────────
        const gridTitle = document.createElement('div');
        gridTitle.textContent = 'Block Types';
        gridTitle.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.7); margin-top: 8px; margin-bottom: 5px;`;
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
        // Non-blocks categories: simple text button list
        const items = PALETTE_ITEMS.filter(i => i.category === state.activeCategory);
        for (const item of items) {
          const btn = makeBtn(item.label, () => callbacks?.onPaletteItemSelect(item));
          btn.style.width = '100%';
          btn.style.marginBottom = '3px';
          btn.style.textAlign = 'left';
          paletteItems.push({ btn, itemId: item.id });
          paletteDiv.appendChild(btn);
        }
      }
    } else if (state.activeCategory === 'blocks') {
      // Lighting may change independently; update select in-place
      if (currentLighting !== lastRenderedLightingEffect && document.activeElement !== lightingSelect) {
        lastRenderedLightingEffect = currentLighting;
        lightingSelect.value = currentLighting;
      }
    }

    // Update palette selection highlight
    for (const { btn, itemId } of paletteItems) {
      const isSelected = state.selectedPaletteItem?.id === itemId;
      btn.style.background = isSelected ? ACTIVE_BG : BTN_BG;
      btn.style.borderColor = isSelected ? GREEN : PANEL_BORDER;
    }

    // Update inspector (only recreate when selected element changes)
    const selUid = state.selectedElements.length > 0 ? state.selectedElements[0].uid : -1;
    const selType = state.selectedElements.length > 0 ? state.selectedElements[0].type : '';
    const selCount = state.selectedElements.length;
    if (inspectorElementUid !== selUid || inspectorElementType !== selType || inspectorElementCount !== selCount) {
      inspectorElementUid = selUid;
      inspectorElementType = selType;
      inspectorElementCount = selCount;
      updateInspector(inspectorDiv, state, callbacks);
    }
  }

  return {
    container,
    update,
    setCallbacks: (cbs: EditorUICallbacks) => { callbacks = cbs; },
    destroy: () => {
      renderedCategory = null;
      paletteItems = [];
      inspectorElementUid = -1;
      inspectorElementType = '';
      inspectorElementCount = 0;
      lastRenderedRoomId = '';
      lastRenderedWidthBlocks = -1;
      lastRenderedHeightBlocks = -1;
      lastRenderedBackgroundId = '';
      lastRenderedBlockTheme = '';
      lastRenderedLightingEffect = '';
      dimWidthInput = null;
      dimHeightInput = null;
      if (container.parentElement) container.parentElement.removeChild(container);
      if (topRightBar.parentElement) topRightBar.parentElement.removeChild(topRightBar);
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBtn(label: string, onClick: () => void): HTMLButtonElement {
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

function makeEdgeBtn(label: string, onClick: () => void): HTMLButtonElement {
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
function makeThemeChip(themeId: string, label: string, isActive: boolean, onClick: () => void): HTMLButtonElement {
  const fill = THEME_FILL_COLOR[themeId] ?? '#555';
  const btn = document.createElement('button');
  btn.style.cssText = `
    flex: 1; padding: 4px 2px; cursor: pointer; border-radius: 4px;
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
  text.textContent = label;
  btn.appendChild(swatch);
  btn.appendChild(text);
  btn.addEventListener('mouseenter', () => { if (!isActive) btn.style.background = ACTIVE_BG; });
  btn.addEventListener('mouseleave', () => { if (!isActive) btn.style.background = BTN_BG; });
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

/**
 * Builds the CSS for the inner shape div of a block preview, based on the item type and theme.
 */
function makeBlockPreviewShapeCss(itemId: string, theme: string): { shapeCss: string; containerCss: string } {
  const fill = THEME_FILL_COLOR[theme] ?? '#555';
  const spriteUrl = THEME_BLOCK_SPRITE_URL[theme] ?? '';
  const pillarUrl = THEME_PILLAR_SPRITE_URL[theme] ?? spriteUrl;
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
    case 'pillar_full':
      return {
        containerCss,
        shapeCss: `
          position: absolute; left: 13px; top: 0;
          width: 14px; height: 40px;
          background-color: ${fill};
          background-image: url(${pillarUrl});
          background-size: cover; image-rendering: pixelated;
          border-left: 1px solid rgba(255,255,255,0.1);
          border-right: 1px solid rgba(255,255,255,0.1);
        `,
      };
    case 'pillar_half':
      return {
        containerCss,
        shapeCss: `
          position: absolute; left: 16px; top: 0;
          width: 8px; height: 40px;
          background-color: ${fill};
          background-image: url(${pillarUrl});
          background-size: cover; image-rendering: pixelated;
          border-left: 1px solid rgba(255,255,255,0.1);
          border-right: 1px solid rgba(255,255,255,0.1);
        `,
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
function makeBlockPreviewCard(item: PaletteItem, theme: string, onClick: () => void): HTMLDivElement {
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

function updateInspector(
  div: HTMLDivElement,
  state: EditorState,
  callbacks: EditorUICallbacks | null,
): void {
  div.innerHTML = '';
  if (state.selectedElements.length === 0 || state.roomData === null) {
    div.innerHTML = `<div style="color: rgba(200,255,200,0.4); font-size: 11px;">Select an element to inspect</div>`;
    return;
  }

  const room = state.roomData;

  // Multi-selection: show count
  if (state.selectedElements.length > 1) {
    const heading = document.createElement('div');
    heading.textContent = `Inspector: ${state.selectedElements.length} elements`;
    heading.style.cssText = `color: ${GREEN}; font-size: 13px; margin-bottom: 8px; font-weight: bold;`;
    div.appendChild(heading);

    // Show shared properties for multi-selection
    const types = new Set(state.selectedElements.map(e => e.type));
    if (types.size === 1) {
      const type = state.selectedElements[0].type;
      const typeLabel = document.createElement('div');
      typeLabel.textContent = `All: ${type}`;
      typeLabel.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.5); margin-bottom: 4px;`;
      div.appendChild(typeLabel);

      if (type === 'wall') {
        addSelect(div, 'blockTheme',
          BLOCK_THEMES.map(t => ({ label: t.label, value: t.id })),
          '(mixed)',
          v => callbacks?.onPropertyChange('wall.blockTheme', v));
      } else if (type === 'transition') {
        addSelect(div, 'fadeColor',
          FADE_COLOR_OPTIONS,
          '(mixed)',
          v => callbacks?.onPropertyChange('transition.fadeColor', v));
      }
    } else {
      const typeInfo = document.createElement('div');
      typeInfo.textContent = `Mixed types: ${[...types].join(', ')}`;
      typeInfo.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.5); margin-bottom: 4px;`;
      div.appendChild(typeInfo);
    }
    return;
  }

  // Single selection
  const el = state.selectedElements[0];

  const heading = document.createElement('div');
  heading.textContent = `Inspector: ${el.type}`;
  heading.style.cssText = `color: ${GREEN}; font-size: 13px; margin-bottom: 8px; font-weight: bold;`;
  div.appendChild(heading);

  if (el.type === 'wall') {
    const wall = room.interiorWalls.find(w => w.uid === el.uid);
    if (wall) {
      addField(div, 'xBlock', String(wall.xBlock), v => callbacks?.onPropertyChange('wall.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(wall.yBlock), v => callbacks?.onPropertyChange('wall.yBlock', parseInt(v)));
      addField(div, 'wBlock', String(wall.wBlock), v => callbacks?.onPropertyChange('wall.wBlock', parseInt(v)));
      addField(div, 'hBlock', String(wall.hBlock), v => callbacks?.onPropertyChange('wall.hBlock', parseInt(v)));
      addSelect(div, 'blockTheme',
        BLOCK_THEMES.map(t => ({ label: t.label, value: t.id })),
        wall.blockTheme ?? room.blockTheme,
        v => callbacks?.onPropertyChange('wall.blockTheme', v));
      const typeLabel = wall.isPlatformFlag === 1 ? 'Platform (one-way)' : 'Solid Block';
      const typeDiv = document.createElement('div');
      typeDiv.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.5); margin-top: 4px;`;
      typeDiv.textContent = `Type: ${typeLabel}`;
      div.appendChild(typeDiv);
    }
  } else if (el.type === 'enemy') {
    const enemy = room.enemies.find(e => e.uid === el.uid);
    if (enemy) {
      addField(div, 'xBlock', String(enemy.xBlock), v => callbacks?.onPropertyChange('enemy.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(enemy.yBlock), v => callbacks?.onPropertyChange('enemy.yBlock', parseInt(v)));
      addField(div, 'kinds', enemy.kinds.join(', '), v => callbacks?.onPropertyChange('enemy.kinds', v));
      addField(div, 'particleCount', String(enemy.particleCount), v => callbacks?.onPropertyChange('enemy.particleCount', parseInt(v)));
      addSelect(div, 'type', [
        { label: 'Rolling', value: 'rolling' },
        { label: 'Flying Eye', value: 'flyingEye' },
      ], enemy.isRollingEnemyFlag === 1 ? 'rolling' : 'flyingEye',
      v => callbacks?.onPropertyChange('enemy.type', v));
      if (enemy.isRollingEnemyFlag === 1) {
        addField(div, 'spriteIndex', String(enemy.rollingEnemySpriteIndex),
          v => callbacks?.onPropertyChange('enemy.rollingEnemySpriteIndex', parseInt(v)));
      }
      addCheckbox(div, 'isBoss', enemy.isBossFlag === 1,
        v => callbacks?.onPropertyChange('enemy.isBossFlag', v ? 1 : 0));
    }
  } else if (el.type === 'transition') {
    const trans = room.transitions.find(t => t.uid === el.uid);
    if (trans) {
      // Show door number
      const doorIndex = room.transitions.indexOf(trans);
      const doorLabel = document.createElement('div');
      doorLabel.textContent = `Door #${doorIndex + 1}`;
      doorLabel.style.cssText = `font-size: 12px; color: #88bbff; margin-bottom: 6px; font-weight: bold;`;
      div.appendChild(doorLabel);

      addSelect(div, 'direction',
        ['left', 'right', 'up', 'down'].map(d => ({ label: d, value: d })),
        trans.direction, v => callbacks?.onPropertyChange('transition.direction', v));
      addField(div, 'positionBlock', String(trans.positionBlock),
        v => callbacks?.onPropertyChange('transition.positionBlock', parseInt(v)));
      addField(div, 'openingSizeBlocks', String(trans.openingSizeBlocks),
        v => callbacks?.onPropertyChange('transition.openingSizeBlocks', parseInt(v)));
      addField(div, 'depthBlock (blank=edge)', trans.depthBlock !== undefined ? String(trans.depthBlock) : '',
        v => callbacks?.onPropertyChange('transition.depthBlock', v.trim() === '' ? '' : parseInt(v)));
      addField(div, 'targetRoomId', trans.targetRoomId,
        v => callbacks?.onPropertyChange('transition.targetRoomId', v));
      addField(div, 'targetSpawnX', String(trans.targetSpawnBlock[0]),
        v => callbacks?.onPropertyChange('transition.targetSpawnBlockX', parseInt(v)));
      addField(div, 'targetSpawnY', String(trans.targetSpawnBlock[1]),
        v => callbacks?.onPropertyChange('transition.targetSpawnBlockY', parseInt(v)));

      // Fade color dropdown
      addSelect(div, 'fadeColor',
        FADE_COLOR_OPTIONS,
        trans.fadeColor ?? '#000000',
        v => callbacks?.onPropertyChange('transition.fadeColor', v));

      // Link Transition button
      const linkBtn = makeBtn('🔗 Link Transition', () => callbacks?.onLinkTransition());
      linkBtn.style.width = '100%';
      linkBtn.style.marginTop = '8px';
      linkBtn.style.background = 'rgba(0,100,200,0.3)';
      linkBtn.style.borderColor = 'rgba(0,150,255,0.5)';
      div.appendChild(linkBtn);
    }
  } else if (el.type === 'playerSpawn') {
    addField(div, 'xBlock', String(room.playerSpawnBlock[0]),
      v => callbacks?.onPropertyChange('playerSpawn.xBlock', parseInt(v)));
    addField(div, 'yBlock', String(room.playerSpawnBlock[1]),
      v => callbacks?.onPropertyChange('playerSpawn.yBlock', parseInt(v)));
  } else if (el.type === 'saveTomb') {
    const tomb = room.saveTombs.find(s => s.uid === el.uid);
    if (tomb) {
      addField(div, 'xBlock', String(tomb.xBlock),
        v => callbacks?.onPropertyChange('saveTomb.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(tomb.yBlock),
        v => callbacks?.onPropertyChange('saveTomb.yBlock', parseInt(v)));
    }
  } else if (el.type === 'skillTomb') {
    const tomb = room.skillTombs.find(s => s.uid === el.uid);
    if (tomb) {
      addField(div, 'xBlock', String(tomb.xBlock),
        v => callbacks?.onPropertyChange('skillTomb.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(tomb.yBlock),
        v => callbacks?.onPropertyChange('skillTomb.yBlock', parseInt(v)));
      addSelect(div, 'weaveId',
        [
          { label: 'Storm Weave', value: 'storm' },
          { label: 'Shield Weave', value: 'shield' },
        ],
        tomb.weaveId,
        v => callbacks?.onPropertyChange('skillTomb.weaveId', v));
    }
  } else if (el.type === 'dustPile') {
    const pile = room.dustPiles.find(p => p.uid === el.uid);
    if (pile) {
      addField(div, 'xBlock', String(pile.xBlock),
        v => callbacks?.onPropertyChange('dustPile.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(pile.yBlock),
        v => callbacks?.onPropertyChange('dustPile.yBlock', parseInt(v)));
      addField(div, 'dustCount', String(pile.dustCount),
        v => callbacks?.onPropertyChange('dustPile.dustCount', parseInt(v)));
    }
  }
}

function addField(
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

function addSelect(
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

function addCheckbox(
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

function addDimField(
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
