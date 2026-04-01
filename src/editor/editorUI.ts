/**
 * Editor UI — toolbar, palette panel, inspector panel, and export controls.
 * All DOM elements are created dynamically and removed on cleanup.
 */

import {
  EditorState, EditorTool, PaletteCategory, PALETTE_ITEMS,
  PaletteItem,
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

export interface EditorUICallbacks {
  onToolChange: (tool: EditorTool) => void;
  onCategoryChange: (category: PaletteCategory) => void;
  onPaletteItemSelect: (item: PaletteItem) => void;
  onExport: () => void;
  onLinkTransition: () => void;
  onPropertyChange: (prop: string, value: string | number) => void;
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

  // ── Category tabs ────────────────────────────────────────────────────────
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

  // ── Palette items ────────────────────────────────────────────────────────
  const paletteDiv = document.createElement('div');
  paletteDiv.style.cssText = 'margin-bottom: 12px;';
  container.appendChild(paletteDiv);

  // Track rendered palette state to avoid recreating buttons every frame
  let renderedCategory: PaletteCategory | null = null;
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
    // Update palette items (only recreate when category changes)
    if (renderedCategory !== state.activeCategory) {
      renderedCategory = state.activeCategory;
      paletteDiv.innerHTML = '';
      paletteBtns = [];
      const items = PALETTE_ITEMS.filter(i => i.category === state.activeCategory);
      for (const item of items) {
        const btn = makeBtn(item.label, () => callbacks?.onPaletteItemSelect(item));
        btn.style.width = '100%';
        btn.style.marginBottom = '3px';
        btn.style.textAlign = 'left';
        paletteBtns.push({ btn, itemId: item.id });
        paletteDiv.appendChild(btn);
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
