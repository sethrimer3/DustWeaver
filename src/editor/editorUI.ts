/**
 * Editor UI — toolbar, palette panel, and export controls.
 * All DOM elements are created dynamically and removed on cleanup.
 *
 * The per-element property inspector panel is delegated to editorInspector.ts.
 */

import {
  EditorState, EditorTool, PaletteCategory, PALETTE_ITEMS,
  BLOCK_THEMES, BACKGROUND_OPTIONS, LIGHTING_OPTIONS,
  BlockTheme, BackgroundId, LightingEffect, SONG_OPTIONS, RoomSongId,
  AMBIENT_LIGHT_DIRECTION_OPTIONS, AmbientLightDirection,
  CrumbleVariant, CRUMBLE_VARIANT_OPTIONS, RoomEdge, EditorUICallbacks,
  DUST_KIND_OPTIONS,
} from './editorState';
import { WEAVE_LIST, WEAVE_REGISTRY } from '../sim/weaves/weaveDefinition';
import {
  addDimField,
} from './editorFormWidgets';
import { PANEL_BG, PANEL_BORDER, ACTIVE_BG, BTN_BG, TEXT_COLOR, GREEN } from './editorStyles';
import {
  makeBtn, makeEdgeBtn, makeThemeChip, makeThemePaletteButton,
  makeBlockPreviewCard,
} from './editorUIHelpers';
import { updateInspector } from './editorInspector';

// ── UI container ─────────────────────────────────────────────────────────────

export interface EditorUI {
  container: HTMLDivElement;
  /** Update UI to reflect current editor state. */
  update: (state: EditorState) => void;
  /** Set callbacks. */
  setCallbacks: (cbs: EditorUICallbacks) => void;
  destroy: () => void;
}

// Re-export shared types so consumers that already import from editorUI.ts
// continue to work without change.
export type { RoomEdge, EditorUICallbacks } from './editorState';

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

  // ── Room Song dropdown ───────────────────────────────────────────────────
  const songDiv = document.createElement('div');
  songDiv.style.cssText = `
    border: 1px solid ${PANEL_BORDER}; border-radius: 3px;
    padding: 6px 8px; margin-bottom: 10px; background: rgba(0,0,0,0.2);
  `;
  const songTitle = document.createElement('div');
  songTitle.textContent = 'Room Song';
  songTitle.style.cssText = `font-size: 11px; color: ${GREEN}; margin-bottom: 6px; font-weight: bold;`;
  songDiv.appendChild(songTitle);
  const songSelect = document.createElement('select');
  songSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  for (const opt of SONG_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    songSelect.appendChild(o);
  }
  songSelect.addEventListener('change', () => {
    callbacks?.onRoomSongChange(songSelect.value as RoomSongId);
  });
  songSelect.addEventListener('click', (e) => e.stopPropagation());
  songDiv.appendChild(songSelect);
  container.appendChild(songDiv);

  // ── Category tabs ────────────────────────────────────────────────────────
  let lastRenderedRoomId = '';
  let lastRenderedWidthBlocks = -1;
  let lastRenderedHeightBlocks = -1;
  let lastRenderedBackgroundId = '';
  let lastRenderedSongId = '';
  let dimWidthInput: HTMLInputElement | null = null;
  let dimHeightInput: HTMLInputElement | null = null;
  const catBar = document.createElement('div');
  catBar.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 8px;';
  const categories: PaletteCategory[] = ['blocks', 'enemies', 'triggers', 'collectables', 'environment', 'objects', 'lighting', 'liquids', 'ropes'];
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

  // ── Ambient Light Direction dropdown ─────────────────────────────────────
  const ambientDirLabel = document.createElement('div');
  ambientDirLabel.textContent = 'Ambient Direction';
  ambientDirLabel.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.7); margin-top: 6px; margin-bottom: 4px;`;
  lightingDiv.appendChild(ambientDirLabel);
  const ambientDirSelect = document.createElement('select');
  ambientDirSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid ${PANEL_BORDER};
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  // Add undefined/"room default" option
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '(room default)';
  ambientDirSelect.appendChild(defaultOpt);
  for (const opt of AMBIENT_LIGHT_DIRECTION_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    ambientDirSelect.appendChild(o);
  }
  ambientDirSelect.addEventListener('change', () => {
    const val = ambientDirSelect.value as AmbientLightDirection | '';
    callbacks?.onAmbientLightDirectionChange(val === '' ? undefined : val);
  });
  ambientDirSelect.addEventListener('click', (e) => e.stopPropagation());
  lightingDiv.appendChild(ambientDirSelect);

  // ── Palette items ────────────────────────────────────────────────────────
  const paletteDiv = document.createElement('div');
  paletteDiv.style.cssText = 'margin-bottom: 12px;';
  container.appendChild(paletteDiv);

  // Track rendered palette state to avoid recreating buttons every frame
  let renderedCategory: PaletteCategory | null = null;
  let lastRenderedBlockTheme = '';
  let lastRenderedLightingEffect = '';
  let lastRenderedRecentBlockThemes = '';
  let isBlockThemePaletteOpen = false;
  let paletteItems: { btn: HTMLElement; itemId: string }[] = [];

  // ── Skill tomb picker (shown above inspector when skill_tomb is selected) ──
  const skillTombPickerDiv = document.createElement('div');
  skillTombPickerDiv.style.cssText = `
    border: 1px solid rgba(212,168,75,0.5); border-radius: 3px;
    padding: 6px 8px; margin-top: 8px; background: rgba(20,15,0,0.4); display: none;
  `;
  const skillTombPickerTitle = document.createElement('div');
  skillTombPickerTitle.textContent = 'Skill in Tomb';
  skillTombPickerTitle.style.cssText = `font-size: 11px; color: #d4a84b; margin-bottom: 6px; font-weight: bold;`;
  skillTombPickerDiv.appendChild(skillTombPickerTitle);
  const skillTombSelect = document.createElement('select');
  skillTombSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid rgba(212,168,75,0.4);
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  for (const weaveId of WEAVE_LIST) {
    const def = WEAVE_REGISTRY.get(weaveId);
    const o = document.createElement('option');
    o.value = weaveId;
    o.textContent = def?.displayName ?? weaveId;
    skillTombSelect.appendChild(o);
  }
  skillTombSelect.addEventListener('change', () => {
    callbacks?.onSkillTombWeaveChange(skillTombSelect.value);
  });
  skillTombSelect.addEventListener('click', (e) => e.stopPropagation());
  skillTombPickerDiv.appendChild(skillTombSelect);

  // ── Crumble variant picker (shown above inspector when a crumble item is selected) ──
  const crumblePickerDiv = document.createElement('div');
  crumblePickerDiv.style.cssText = `
    border: 1px solid rgba(200,150,60,0.5); border-radius: 3px;
    padding: 6px 8px; margin-top: 8px; background: rgba(20,12,0,0.4); display: none;
  `;
  const crumblePickerTitle = document.createElement('div');
  crumblePickerTitle.textContent = 'Crumble Weakness';
  crumblePickerTitle.style.cssText = `font-size: 11px; color: #c8a060; margin-bottom: 6px; font-weight: bold;`;
  crumblePickerDiv.appendChild(crumblePickerTitle);
  const crumbleVariantSelect = document.createElement('select');
  crumbleVariantSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid rgba(200,150,60,0.4);
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px;
  `;
  for (const opt of CRUMBLE_VARIANT_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    crumbleVariantSelect.appendChild(o);
  }
  crumbleVariantSelect.addEventListener('change', () => {
    callbacks?.onCrumbleVariantChange(crumbleVariantSelect.value as CrumbleVariant);
  });
  crumbleVariantSelect.addEventListener('click', (e) => e.stopPropagation());
  crumblePickerDiv.appendChild(crumbleVariantSelect);

  // ── Dust boost jar picker (shown above inspector when dust_boost_jar is selected) ──
  const dustJarPickerDiv = document.createElement('div');
  dustJarPickerDiv.style.cssText = `
    border: 1px solid rgba(200,100,255,0.5); border-radius: 3px;
    padding: 6px 8px; margin-top: 8px; background: rgba(15,0,20,0.4); display: none;
  `;
  const dustJarPickerTitle = document.createElement('div');
  dustJarPickerTitle.textContent = 'Dust Jar Contents';
  dustJarPickerTitle.style.cssText = `font-size: 11px; color: #d080ff; margin-bottom: 6px; font-weight: bold;`;
  dustJarPickerDiv.appendChild(dustJarPickerTitle);
  const dustJarKindSelect = document.createElement('select');
  dustJarKindSelect.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid rgba(200,100,255,0.4);
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px; margin-bottom: 4px;
  `;
  for (const kind of DUST_KIND_OPTIONS) {
    const o = document.createElement('option');
    o.value = kind;
    o.textContent = kind;
    dustJarKindSelect.appendChild(o);
  }
  dustJarKindSelect.addEventListener('change', () => {
    callbacks?.onDustBoostJarKindChange(dustJarKindSelect.value);
  });
  dustJarKindSelect.addEventListener('click', (e) => e.stopPropagation());
  dustJarPickerDiv.appendChild(dustJarKindSelect);
  const dustJarCountLabel = document.createElement('div');
  dustJarCountLabel.textContent = 'Dust count';
  dustJarCountLabel.style.cssText = `font-size: 10px; color: rgba(200,200,200,0.6); margin-bottom: 2px;`;
  dustJarPickerDiv.appendChild(dustJarCountLabel);
  const dustJarCountInput = document.createElement('input');
  dustJarCountInput.type = 'number';
  dustJarCountInput.min = '1';
  dustJarCountInput.max = '20';
  dustJarCountInput.style.cssText = `
    width: 100%; background: rgba(0,0,0,0.6); border: 1px solid rgba(200,100,255,0.4);
    color: ${TEXT_COLOR}; padding: 4px 6px; font-size: 11px; font-family: monospace;
    border-radius: 2px; box-sizing: border-box;
  `;
  dustJarCountInput.addEventListener('change', () => {
    const v = parseInt(dustJarCountInput.value);
    if (!isNaN(v) && v >= 1 && v <= 20) callbacks?.onDustBoostJarCountChange(v);
  });
  dustJarCountInput.addEventListener('click', (e) => e.stopPropagation());
  dustJarPickerDiv.appendChild(dustJarCountInput);

  // ── Inspector ────────────────────────────────────────────────────────────
  const inspectorDiv = document.createElement('div');
  inspectorDiv.style.cssText = `
    border-top: 1px solid ${PANEL_BORDER}; padding-top: 10px; margin-top: 8px;
  `;
  container.appendChild(skillTombPickerDiv);
  container.appendChild(crumblePickerDiv);
  container.appendChild(dustJarPickerDiv);
  container.appendChild(inspectorDiv);

  // Track rendered inspector state to avoid recreating fields every frame
  let inspectorElementUid: number = -1;
  let inspectorElementType: string = '';
  let inspectorElementCount: number = 0;
  let inspectorDialogueEntryCount: number = -1;

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

    // Update song dropdown
    const currentSongId = state.roomData?.songId ?? '_continue';
    if (currentSongId !== lastRenderedSongId) {
      lastRenderedSongId = currentSongId;
      if (document.activeElement !== songSelect) {
        songSelect.value = currentSongId;
      }
    }

    // Update palette area — recreate when category changes OR when block theme changes
    const currentTheme = state.selectedBlockTheme;
    const recentBlockThemeSignature = state.recentBlockThemes.join('|');
    const currentLighting = state.roomData?.lightingEffect ?? 'DEFAULT';
    const needsPaletteRebuild = renderedCategory !== state.activeCategory ||
      (state.activeCategory === 'blocks' && (
        currentTheme !== lastRenderedBlockTheme ||
        recentBlockThemeSignature !== lastRenderedRecentBlockThemes
      ));

    if (needsPaletteRebuild) {
      renderedCategory = state.activeCategory;
      lastRenderedBlockTheme = currentTheme;
      lastRenderedRecentBlockThemes = recentBlockThemeSignature;
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
        themeRow.style.cssText = `display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 4px;`;
        for (const themeId of state.recentBlockThemes) {
          const th = BLOCK_THEMES.find(t => t.id === themeId);
          if (!th) continue;
          const chip = makeThemeChip(th.id, th.label, th.shortId, th.id === currentTheme, () => {
            callbacks?.onBlockThemeChange(th.id as BlockTheme);
          });
          themeRow.appendChild(chip);
        }
        const paletteButton = makeThemePaletteButton(isBlockThemePaletteOpen, () => {
          isBlockThemePaletteOpen = !isBlockThemePaletteOpen;
          lastRenderedBlockTheme = '';
        });
        themeRow.appendChild(paletteButton);
        themeSection.appendChild(themeRow);
        if (isBlockThemePaletteOpen) {
          const themePaletteGrid = document.createElement('div');
          themePaletteGrid.style.cssText = `display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 5px;`;
          for (const th of BLOCK_THEMES) {
            const chip = makeThemeChip(th.id, th.label, th.shortId, th.id === currentTheme, () => {
              callbacks?.onBlockThemeChange(th.id as BlockTheme);
              isBlockThemePaletteOpen = false;
              lastRenderedBlockTheme = '';
            });
            themePaletteGrid.appendChild(chip);
          }
          themeSection.appendChild(themePaletteGrid);
        }
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
      // Lighting and ambient direction may change independently; update selects in-place
      if (currentLighting !== lastRenderedLightingEffect && document.activeElement !== lightingSelect) {
        lastRenderedLightingEffect = currentLighting;
        lightingSelect.value = currentLighting;
      }
      const currentAmbientDir = state.roomData?.ambientLightDirection;
      if (document.activeElement !== ambientDirSelect) {
        ambientDirSelect.value = currentAmbientDir ?? '';
      }
    }

    // Update palette selection highlight
    for (const { btn, itemId } of paletteItems) {
      const isSelected = state.selectedPaletteItem?.id === itemId;
      btn.style.background = isSelected ? ACTIVE_BG : BTN_BG;
      btn.style.borderColor = isSelected ? GREEN : PANEL_BORDER;
    }

    // Show/hide the skill tomb picker based on selected palette item
    const isSkillTombSelected = state.selectedPaletteItem?.id === 'skill_tomb';
    skillTombPickerDiv.style.display = isSkillTombSelected ? '' : 'none';
    if (isSkillTombSelected && document.activeElement !== skillTombSelect) {
      skillTombSelect.value = state.pendingSkillTombWeaveId;
    }

    // Show/hide the crumble variant picker based on selected palette item
    const isCrumbleSelected = state.selectedPaletteItem?.isCrumbleBlockItem === 1;
    crumblePickerDiv.style.display = isCrumbleSelected ? '' : 'none';
    if (isCrumbleSelected && document.activeElement !== crumbleVariantSelect) {
      crumbleVariantSelect.value = state.pendingCrumbleVariant;
    }

    // Show/hide the dust boost jar picker based on selected palette item
    const isDustBoostJarSelected = state.selectedPaletteItem?.isDustBoostJarItem === 1 || state.selectedPaletteItem?.id === 'dust_boost_jar';
    dustJarPickerDiv.style.display = isDustBoostJarSelected ? '' : 'none';
    if (isDustBoostJarSelected) {
      if (document.activeElement !== dustJarKindSelect) {
        dustJarKindSelect.value = state.pendingDustBoostJarKind;
      }
      if (document.activeElement !== dustJarCountInput) {
        dustJarCountInput.value = String(state.pendingDustBoostJarCount);
      }
    }

    // Update inspector (only recreate when selected element changes)
    const selUid = state.selectedElements.length > 0 ? state.selectedElements[0].uid : -1;
    const selType = state.selectedElements.length > 0 ? state.selectedElements[0].type : '';
    const selCount = state.selectedElements.length;
    // For dialogue triggers, also rebuild when entry count changes (add/remove/reorder).
    let dialogueEntryCount = -1;
    if (selType === 'dialogueTrigger' && state.roomData) {
      const dt = (state.roomData.dialogueTriggers ?? []).find(t => t.uid === selUid);
      dialogueEntryCount = dt ? dt.entries.length : -1;
    }
    if (inspectorElementUid !== selUid || inspectorElementType !== selType || inspectorElementCount !== selCount || inspectorDialogueEntryCount !== dialogueEntryCount) {
      inspectorElementUid = selUid;
      inspectorElementType = selType;
      inspectorElementCount = selCount;
      inspectorDialogueEntryCount = dialogueEntryCount;
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
      inspectorDialogueEntryCount = -1;
      lastRenderedRoomId = '';
      lastRenderedWidthBlocks = -1;
      lastRenderedHeightBlocks = -1;
      lastRenderedBackgroundId = '';
      lastRenderedSongId = '';
      lastRenderedBlockTheme = '';
      lastRenderedRecentBlockThemes = '';
      lastRenderedLightingEffect = '';
      dimWidthInput = null;
      dimHeightInput = null;
      if (container.parentElement) container.parentElement.removeChild(container);
      if (topRightBar.parentElement) topRightBar.parentElement.removeChild(topRightBar);
    },
  };
}
