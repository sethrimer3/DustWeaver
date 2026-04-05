/**
 * Editor UI — toolbar, palette panel, inspector panel, and export controls.
 * All DOM elements are created dynamically and removed on cleanup.
 */

import {
  EditorState, EditorTool, PaletteCategory, PALETTE_ITEMS,
  PaletteItem, BLOCK_THEMES, BACKGROUND_OPTIONS, LIGHTING_OPTIONS,
  BlockTheme, BackgroundId, LightingEffect,
} from './editorState';

// ── Style constants ──────────────────────────────────────────────────────────

const PANEL_BG = 'rgba(15,15,20,0.92)';
const PANEL_BORDER = 'rgba(0,200,100,0.4)';
const ACTIVE_BG = 'rgba(0,200,100,0.25)';
const BTN_BG = 'rgba(30,30,40,0.85)';
const TEXT_COLOR = '#c0ffd0';
const GREEN = '#00c864';

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

  // ── Block Theme dropdown (shown only when "blocks" category is active) ───
  const blockThemeDiv = document.createElement('div');
  blockThemeDiv.style.cssText = `margin-bottom: 8px;`;
  const blockThemeLabel = document.createElement('div');
  blockThemeLabel.textContent = 'New Block Theme';
  blockThemeLabel.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.7); margin-bottom: 4px;`;
  blockThemeDiv.appendChild(blockThemeLabel);
  const blockThemeSelect = document.createElement('select');
  blockThemeSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  for (const th of BLOCK_THEMES) {
    const o = document.createElement('option');
    o.value = th.id;
    o.textContent = th.label;
    blockThemeSelect.appendChild(o);
  }
  blockThemeSelect.addEventListener('change', () => {
    callbacks?.onBlockThemeChange(blockThemeSelect.value as BlockTheme);
  });
  blockThemeSelect.addEventListener('click', (e) => e.stopPropagation());
  blockThemeDiv.appendChild(blockThemeSelect);

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
  let paletteBtns: { btn: HTMLButtonElement; itemId: string }[] = [];

  // ── Inspector ────────────────────────────────────────────────────────────
  const inspectorDiv = document.createElement('div');
  inspectorDiv.style.cssText = `
    border-top: 1px solid ${PANEL_BORDER}; padding-top: 10px; margin-top: 8px;
  `;
  container.appendChild(inspectorDiv);

  // Track rendered inspector state to avoid recreating fields every frame
  let inspectorElementUid: number = -1;
  let inspectorElementType: string = '';

  // ── Export button ────────────────────────────────────────────────────────
  const exportBtn = makeBtn('📥 Export Room JSON', () => callbacks?.onExport());
  exportBtn.style.cssText += `
    width: 100%; margin-top: 12px; padding: 10px; font-size: 13px;
    background: rgba(0,100,50,0.4); border-color: ${GREEN};
  `;
  container.appendChild(exportBtn);

  root.appendChild(container);

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

    // Update palette area (only recreate when category changes)
    if (renderedCategory !== state.activeCategory) {
      renderedCategory = state.activeCategory;
      paletteDiv.innerHTML = '';
      paletteBtns = [];

      // Add block theme dropdown above palette items when blocks category is active
      if (state.activeCategory === 'blocks') {
        paletteDiv.appendChild(blockThemeDiv);
        paletteDiv.appendChild(lightingDiv);
        const th = state.roomData?.blockTheme ?? 'blackRock';
        const lighting = state.roomData?.lightingEffect ?? 'DEFAULT';
        lastRenderedBlockTheme = th;
        lastRenderedLightingEffect = lighting;
        blockThemeSelect.value = th;
        lightingSelect.value = lighting;
      }

      const items = PALETTE_ITEMS.filter(i => i.category === state.activeCategory);
      for (const item of items) {
        const btn = makeBtn(item.label, () => callbacks?.onPaletteItemSelect(item));
        btn.style.width = '100%';
        btn.style.marginBottom = '3px';
        btn.style.textAlign = 'left';
        paletteBtns.push({ btn, itemId: item.id });
        paletteDiv.appendChild(btn);
      }
    } else if (state.activeCategory === 'blocks') {
      // Update block theme select if it changed without category change
      const th = state.roomData?.blockTheme ?? 'blackRock';
      if (th !== lastRenderedBlockTheme && document.activeElement !== blockThemeSelect) {
        lastRenderedBlockTheme = th;
        blockThemeSelect.value = th;
      }
      const lighting = state.roomData?.lightingEffect ?? 'DEFAULT';
      if (lighting !== lastRenderedLightingEffect && document.activeElement !== lightingSelect) {
        lastRenderedLightingEffect = lighting;
        lightingSelect.value = lighting;
      }
    }

    // Update palette selection highlight
    for (const { btn, itemId } of paletteBtns) {
      const isSelected = state.selectedPaletteItem?.id === itemId;
      btn.style.background = isSelected ? ACTIVE_BG : BTN_BG;
      btn.style.borderColor = isSelected ? GREEN : PANEL_BORDER;
    }

    // Update inspector (only recreate when selected element changes)
    const selUid = state.selectedElement?.uid ?? -1;
    const selType = state.selectedElement?.type ?? '';
    if (inspectorElementUid !== selUid || inspectorElementType !== selType) {
      inspectorElementUid = selUid;
      inspectorElementType = selType;
      updateInspector(inspectorDiv, state, callbacks);
    }
  }

  return {
    container,
    update,
    setCallbacks: (cbs: EditorUICallbacks) => { callbacks = cbs; },
    destroy: () => {
      renderedCategory = null;
      paletteBtns = [];
      inspectorElementUid = -1;
      inspectorElementType = '';
      lastRenderedRoomId = '';
      lastRenderedWidthBlocks = -1;
      lastRenderedHeightBlocks = -1;
      lastRenderedBackgroundId = '';
      lastRenderedBlockTheme = '';
      lastRenderedLightingEffect = '';
      dimWidthInput = null;
      dimHeightInput = null;
      if (container.parentElement) container.parentElement.removeChild(container);
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
  btn.addEventListener('mouseenter', () => { btn.style.background = ACTIVE_BG; });
  btn.addEventListener('mouseleave', () => { btn.style.background = BTN_BG; });
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
  btn.addEventListener('mouseenter', () => { btn.style.background = ACTIVE_BG; });
  btn.addEventListener('mouseleave', () => { btn.style.background = BTN_BG; });
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

function updateInspector(
  div: HTMLDivElement,
  state: EditorState,
  callbacks: EditorUICallbacks | null,
): void {
  div.innerHTML = '';
  if (state.selectedElement === null || state.roomData === null) {
    div.innerHTML = `<div style="color: rgba(200,255,200,0.4); font-size: 11px;">Select an element to inspect</div>`;
    return;
  }

  const el = state.selectedElement;
  const room = state.roomData;

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
      addField(div, 'targetRoomId', trans.targetRoomId,
        v => callbacks?.onPropertyChange('transition.targetRoomId', v));
      addField(div, 'targetSpawnX', String(trans.targetSpawnBlock[0]),
        v => callbacks?.onPropertyChange('transition.targetSpawnBlockX', parseInt(v)));
      addField(div, 'targetSpawnY', String(trans.targetSpawnBlock[1]),
        v => callbacks?.onPropertyChange('transition.targetSpawnBlockY', parseInt(v)));

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
  } else if (el.type === 'skillTomb') {
    const tomb = room.skillTombs.find(s => s.uid === el.uid);
    if (tomb) {
      addField(div, 'xBlock', String(tomb.xBlock),
        v => callbacks?.onPropertyChange('skillTomb.xBlock', parseInt(v)));
      addField(div, 'yBlock', String(tomb.yBlock),
        v => callbacks?.onPropertyChange('skillTomb.yBlock', parseInt(v)));
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
  options: { label: string; value: string }[],
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
