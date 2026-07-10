/**
 * Editor UI — toolbar, palette panel, and export controls.
 * All DOM elements are created dynamically and removed on cleanup.
 *
 * The per-element property inspector panel is delegated to editorInspector.ts.
 */

import {
  EditorState, EditorTool, PaletteCategory, PALETTE_ITEMS,
  PALETTE_CATEGORIES, PALETTE_CATEGORY_LABELS,
  BLOCK_THEMES, BACKGROUND_OPTIONS,
  BlockTheme, SONG_OPTIONS, RoomSongId,
  RoomEdge, EditorUICallbacks, BrushMode, BlockPlacementModifier,
  CRUMBLE_VARIANT_OPTIONS, CrumbleVariant,
} from './editorState';
import {
  addDimField,
} from './editorFormWidgets';
import { PANEL_BG, PANEL_BORDER, ACTIVE_BG, BTN_BG, TEXT_COLOR, GREEN } from './editorStyles';
import {
  makeBtn, makeEdgeBtn, makeThemeChip, makeThemePaletteButton,
  makeBlockPreviewCard,
} from './editorUIHelpers';
import { makePalettePreviewCard, auditPalettePreviews } from './editorPalettePreview';
import { updateInspector } from './editorInspector';
import { createEditorSpecialItemPickers } from './editorSpecialItemPickers';
import { createEditorLightingPanel } from './editorUILightingPanel';
import type { TheroBackgroundEffect } from '../render/effects/theroBackgroundEffect';
import { createPrologueShapeEffect } from '../render/effects/prologueShapeEffect';
import { createVermiculateEffect } from '../render/effects/vermiculateEffect';
import { createGravityGridEffect } from '../render/effects/gravityGridEffect';
import { createEulerFluidEffect } from '../render/effects/eulerFluidEffect';
import { createFloaterLatticeEffect } from '../render/effects/floaterLatticeEffect';
import { createTetrisBlockEffect } from '../render/effects/tetrisBlockEffect';
import { createSubstrateEffect } from '../render/effects/substrateEffect';
import type { BackgroundId } from '../levels/roomDef';

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

export function createEditorUI(root: HTMLElement, campaignTitle?: string | null): EditorUI {
  let callbacks: EditorUICallbacks | null = null;
  let animatedBackgroundPreviewCanvases: HTMLCanvasElement[] = [];
  const animatedBackgroundPreviewEffects = new WeakMap<HTMLCanvasElement, TheroBackgroundEffect>();
  let animatedBackgroundPreviewFrame: number | null = null;

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
  if (campaignTitle) {
    title.innerHTML = `🛠 Custom Campaign Editor<br><span style="font-size:11px;color:#ffcc66;font-weight:normal;">${campaignTitle}</span>`;
  } else {
    title.textContent = '🛠 Zone Editor';
  }
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

  // ── Export Campaign button ───────────────────────────────────────────────
  // Always shows "Export Campaign" regardless of whether this is a custom
  // campaign session or the main DustWeaver campaign.
  const exportAllBtn = makeBtn('📦 Export Campaign', () => callbacks?.onExportCampaignJson?.());
  exportAllBtn.style.cssText += `
    width: 100%; padding: 8px; font-size: 12px; margin-bottom: 10px;
    background: rgba(30,70,120,0.5); border-color: #55aaff; color: #55aaff;
  `;
  container.appendChild(exportAllBtn);

  if (import.meta.env.DEV) {
    const devToolsDiv = document.createElement('div');
    devToolsDiv.style.cssText = `
      border: 1px solid rgba(255,204,102,0.45); border-radius: 3px;
      padding: 6px 8px; margin-bottom: 10px; background: rgba(35,25,0,0.3);
    `;
    const devToolsTitle = document.createElement('div');
    devToolsTitle.textContent = 'Dev Room Checks';
    devToolsTitle.style.cssText = 'font-size: 11px; color: #ffcc66; margin-bottom: 6px; font-weight: bold;';
    devToolsDiv.appendChild(devToolsTitle);

    const auditBtn = makeBtn('Room Audit', () => callbacks?.onRunRoomAudit?.());
    auditBtn.style.cssText += `
      width: 100%; padding: 6px 8px; font-size: 11px; margin-bottom: 4px;
      background: rgba(90,65,0,0.45); border-color: #ffcc66; color: #ffdd88;
    `;
    devToolsDiv.appendChild(auditBtn);

    const roundTripBtn = makeBtn('Round-trip Validate Rooms', () => callbacks?.onRunRoomRoundTripValidation?.());
    roundTripBtn.style.cssText += `
      width: 100%; padding: 6px 8px; font-size: 11px;
      background: rgba(90,65,0,0.45); border-color: #ffcc66; color: #ffdd88;
    `;
    devToolsDiv.appendChild(roundTripBtn);

    container.appendChild(devToolsDiv);
  }

  // Run the one-time palette-preview audit at editor init time.
  // auditPalettePreviews is a no-op in production builds (internal DEV guard).
  auditPalettePreviews(PALETTE_ITEMS);

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

  // ── Brush mode selector ──────────────────────────────────────────────────
  const brushRow = document.createElement('div');
  brushRow.style.cssText = `
    display: flex; gap: 4px; margin-bottom: 10px; align-items: center;
  `;
  const brushLabel = document.createElement('span');
  brushLabel.textContent = 'Brush:';
  brushLabel.style.cssText = `font-size: 11px; color: rgba(200,255,200,0.7); min-width: 38px;`;
  brushRow.appendChild(brushLabel);

  const brushModes: { mode: BrushMode; label: string }[] = [
    { mode: 'single', label: '1' },
    { mode: '3x3',   label: '3×3' },
    { mode: '5x5',   label: '5×5' },
    { mode: 'rect',  label: '▭' },
    { mode: 'fill',  label: '⛃' },
  ];
  const brushBtns: HTMLButtonElement[] = [];
  for (const { mode, label } of brushModes) {
    const btn = makeBtn(label, () => callbacks?.onBrushModeChange(mode));
    btn.dataset.brushMode = mode;
    btn.style.cssText += `flex: 1; font-size: 11px; padding: 3px 4px;`;
    brushBtns.push(btn);
    brushRow.appendChild(btn);
  }
  container.appendChild(brushRow);
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

  // ── Background picker ────────────────────────────────────────────────────
  const bgDiv = document.createElement('div');
  bgDiv.style.cssText = `
    border: 1px solid ${PANEL_BORDER}; border-radius: 3px;
    padding: 6px 8px; margin-bottom: 10px; background: rgba(0,0,0,0.2);
  `;
  const bgTitle = document.createElement('div');
  bgTitle.textContent = 'Background';
  bgTitle.style.cssText = `font-size: 11px; color: ${GREEN}; margin-bottom: 6px; font-weight: bold;`;
  bgDiv.appendChild(bgTitle);
  const bgCurrentBtn = document.createElement('button');
  bgCurrentBtn.type = 'button';
  bgCurrentBtn.style.cssText = `
    width: 100%; height: 58px; position: relative; overflow: hidden; cursor: pointer;
    border: 1px solid ${PANEL_BORDER}; border-radius: 3px; padding: 0;
    background: #000; color: #fff; font-family: 'Cinzel', monospace;
  `;
  const bgCurrentLabel = document.createElement('span');
  bgCurrentLabel.style.cssText = `
    position: absolute; left: 6px; right: 6px; bottom: 5px; text-align: center;
    color: #fff; font-size: 11px; font-weight: bold; pointer-events: none;
    text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 0 #000;
  `;
  bgCurrentBtn.appendChild(bgCurrentLabel);
  const bgPickerPanel = document.createElement('div');
  bgPickerPanel.style.cssText = `
    display: none; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 6px;
    max-height: 300px; overflow-y: auto; padding-right: 2px;
  `;
  function findBackgroundOption(id: string) {
    return BACKGROUND_OPTIONS.find(opt => opt.id === id) ?? null;
  }
  function backgroundPreviewCss(option: { previewUrl: string | null; isProcedural?: boolean }): string {
    if (option.previewUrl !== null) {
      return `center / cover repeat url("${option.previewUrl}")`;
    }
    if (option.isProcedural) {
      return 'radial-gradient(circle at 50% 45%, rgba(90,255,190,0.45), rgba(0,0,0,0.96) 48%), #000';
    }
    return '#000';
  }
  function createAnimatedBackgroundPreviewEffect(backgroundId: BackgroundId): TheroBackgroundEffect | null {
    switch (backgroundId) {
      case 'crystallineCracks':
      case 'thero_ch6':
        return createSubstrateEffect();
      case 'thero_prologue':
        return createPrologueShapeEffect();
      case 'thero_ch1':
        return createVermiculateEffect();
      case 'thero_ch2':
        return createGravityGridEffect();
      case 'thero_ch3':
        return createEulerFluidEffect();
      case 'thero_ch4':
        return createFloaterLatticeEffect();
      case 'thero_ch5':
        return createTetrisBlockEffect();
      default:
        return null;
    }
  }
  function drawAnimatedBackgroundPreview(canvas: HTMLCanvasElement, nowMs: number): void {
    const backgroundId = canvas.dataset.backgroundId as BackgroundId | undefined;
    if (backgroundId === undefined) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const effect = animatedBackgroundPreviewEffects.get(canvas);
    if (effect === undefined) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    effect.update(nowMs, canvas.width, canvas.height);
    effect.draw(ctx);
  }
  function drawAnimatedBackgroundPreviews(nowMs: number): void {
    animatedBackgroundPreviewCanvases = animatedBackgroundPreviewCanvases.filter(canvas => canvas.isConnected);
    for (const canvas of animatedBackgroundPreviewCanvases) {
      drawAnimatedBackgroundPreview(canvas, nowMs);
    }
    animatedBackgroundPreviewFrame = requestAnimationFrame(drawAnimatedBackgroundPreviews);
  }
  function ensureAnimatedBackgroundPreviewLoop(): void {
    if (animatedBackgroundPreviewFrame !== null) return;
    animatedBackgroundPreviewFrame = requestAnimationFrame(drawAnimatedBackgroundPreviews);
  }
  function makeAnimatedBackgroundPreviewCanvas(backgroundId: BackgroundId, width: number, height: number): HTMLCanvasElement {
    const effect = createAnimatedBackgroundPreviewEffect(backgroundId);
    if (effect === null) {
      throw new Error(`No animated background preview effect for ${backgroundId}`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.dataset.backgroundId = backgroundId;
    canvas.style.cssText = `
      position: absolute; inset: 0; width: 100%; height: 100%;
      display: block; pointer-events: none; background: #000;
    `;
    animatedBackgroundPreviewCanvases.push(canvas);
    animatedBackgroundPreviewEffects.set(canvas, effect);
    ensureAnimatedBackgroundPreviewLoop();
    return canvas;
  }
  function syncCurrentBackgroundButton(backgroundId: string): void {
    const option = findBackgroundOption(backgroundId);
    bgCurrentLabel.textContent = option?.label ?? backgroundId;
    bgCurrentBtn.style.background = backgroundPreviewCss(option ?? { previewUrl: null });
    const existingCanvas = bgCurrentBtn.querySelector<HTMLCanvasElement>('canvas[data-current-background-preview="1"]');
    if (existingCanvas !== null) {
      existingCanvas.remove();
      animatedBackgroundPreviewCanvases = animatedBackgroundPreviewCanvases.filter(canvas => canvas !== existingCanvas);
    }
    if (option?.isProcedural) {
      const canvas = makeAnimatedBackgroundPreviewCanvas(option.id, 148, 58);
      canvas.dataset.currentBackgroundPreview = '1';
      bgCurrentBtn.insertBefore(canvas, bgCurrentLabel);
    }
  }
  function makeBackgroundPreviewButton(option: (typeof BACKGROUND_OPTIONS)[number]): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.backgroundId = option.id;
    btn.title = option.label;
    btn.style.cssText = `
      height: 64px; position: relative; overflow: hidden; cursor: pointer;
      border: 1px solid ${PANEL_BORDER}; border-radius: 3px; padding: 0;
      background: ${backgroundPreviewCss(option)}; color: #fff; font-family: 'Cinzel', monospace;
    `;
    if (option.isProcedural) {
      btn.appendChild(makeAnimatedBackgroundPreviewCanvas(option.id, 120, 64));
    }
    const label = document.createElement('span');
    label.textContent = option.label;
    label.style.cssText = `
      position: absolute; left: 5px; right: 5px; bottom: 4px; text-align: center;
      color: #fff; font-size: 10px; line-height: 1.05; font-weight: bold; pointer-events: none;
      text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 0 #000;
    `;
    btn.appendChild(label);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      callbacks?.onBackgroundChange(option.id);
    });
    return btn;
  }
  bgCurrentBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    bgPickerPanel.style.display = bgPickerPanel.style.display === 'grid' ? 'none' : 'grid';
  });
  for (const opt of BACKGROUND_OPTIONS) {
    bgPickerPanel.appendChild(makeBackgroundPreviewButton(opt));
  }
  bgDiv.appendChild(bgCurrentBtn);
  bgDiv.appendChild(bgPickerPanel);
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
  const categories: readonly PaletteCategory[] = PALETTE_CATEGORIES;
  const catBtns: HTMLButtonElement[] = [];
  for (const cat of categories) {
    const btn = makeBtn(PALETTE_CATEGORY_LABELS[cat], () => callbacks?.onCategoryChange(cat));
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
  let lastRenderedBlockTheme = '';
  let lastRenderedRecentBlockThemes = '';
  let isBlockThemePaletteOpen = false;
  let paletteItems: { btn: HTMLElement; itemId: string }[] = [];

  const specialItemPickers = createEditorSpecialItemPickers(() => callbacks);
  const lightingPanel = createEditorLightingPanel(() => callbacks);
  const blockModifierDiv = document.createElement('div');
  blockModifierDiv.style.cssText = `
    border: 1px solid rgba(120,180,220,0.45); border-radius: 3px;
    padding: 6px 8px; margin-top: 8px; background: rgba(0,15,25,0.35); display: none;
  `;
  const blockModifierTitle = document.createElement('div');
  blockModifierTitle.textContent = 'Block Modifier';
  blockModifierTitle.style.cssText = 'font-size: 11px; color: #8fc8ff; margin-bottom: 6px; font-weight: bold;';
  blockModifierDiv.appendChild(blockModifierTitle);
  const modifierInputs: HTMLInputElement[] = [];
  const modifierOptions: { id: BlockPlacementModifier; label: string; help: string }[] = [
    { id: 'cracked', label: 'Cracked',
      help: 'Places a crumble block: cracks on the first hit, then breaks apart on the second.' },
    { id: 'tough', label: 'Falling: Tough',
      help: 'Falling block that only drops when hit by a strong downward force or a downward grapple pull.' },
    { id: 'sensitive', label: 'Falling: Sensitive',
      help: 'Falling block that drops from almost any contact.' },
    { id: 'crumbling', label: 'Falling: Crumbling',
      help: 'Falling block that drops like Sensitive, then disappears once it reaches full fall speed.' },
  ];
  function makeModifierRow(id: BlockPlacementModifier, label: string, help: string): void {
    const row = document.createElement('label');
    row.style.cssText = 'display: flex; align-items: center; gap: 6px; margin: 3px 0; font-size: 11px; cursor: pointer;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = id;
    input.dataset.modifier = id;
    input.addEventListener('change', () => {
      callbacks?.onBlockPlacementModifierChange(input.checked ? id : 'none');
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    modifierInputs.push(input);
    row.appendChild(input);
    const text = document.createElement('span');
    text.textContent = label;
    row.appendChild(text);
    const helpIcon = document.createElement('span');
    helpIcon.textContent = '(?)';
    helpIcon.title = help;
    helpIcon.style.cssText = 'color: rgba(143,200,255,0.75); cursor: help; font-size: 10px;';
    helpIcon.addEventListener('click', (e) => e.preventDefault());
    row.appendChild(helpIcon);
    blockModifierDiv.appendChild(row);
  }
  for (const opt of modifierOptions) makeModifierRow(opt.id, opt.label, opt.help);
  const modifierCrumbleSelect = document.createElement('select');
  modifierCrumbleSelect.style.cssText = `
    width: 100%; margin-top: 6px; background: rgba(0,0,0,0.6);
    border: 1px solid rgba(143,200,255,0.4); color: ${TEXT_COLOR};
    padding: 4px 6px; font-size: 11px; font-family: monospace; border-radius: 2px;
    display: none;
  `;
  for (const opt of CRUMBLE_VARIANT_OPTIONS) {
    const o = document.createElement('option');
    o.value = opt.id;
    o.textContent = opt.label;
    modifierCrumbleSelect.appendChild(o);
  }
  modifierCrumbleSelect.addEventListener('change', () => {
    callbacks?.onCrumbleVariantChange(modifierCrumbleSelect.value as CrumbleVariant);
  });
  modifierCrumbleSelect.addEventListener('click', (e) => e.stopPropagation());
  blockModifierDiv.appendChild(modifierCrumbleSelect);

  // ── Inspector ────────────────────────────────────────────────────────────
  const inspectorDiv = document.createElement('div');
  inspectorDiv.style.cssText = `
    border-top: 1px solid ${PANEL_BORDER}; padding-top: 10px; margin-top: 8px;
  `;
  container.appendChild(specialItemPickers.skillTombPickerDiv);
  container.appendChild(blockModifierDiv);
  container.appendChild(specialItemPickers.crumblePickerDiv);
  container.appendChild(specialItemPickers.dustJarPickerDiv);
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
  const worldMapBtn = makeBtn('🗺 Zone Map', () => callbacks?.onOpenVisualMap());
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
    // Update brush mode highlight
    for (const btn of brushBtns) {
      btn.style.background = btn.dataset.brushMode === state.brushMode ? ACTIVE_BG : BTN_BG;
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

    // Update background picker
    const currentBgId = state.roomData?.backgroundId ?? 'brownRock';
    if (currentBgId !== lastRenderedBackgroundId) {
      lastRenderedBackgroundId = currentBgId;
      syncCurrentBackgroundButton(currentBgId);
      for (const btn of bgPickerPanel.querySelectorAll<HTMLButtonElement>('button[data-background-id]')) {
        const isSelected = btn.dataset.backgroundId === currentBgId;
        btn.style.borderColor = isSelected ? GREEN : PANEL_BORDER;
        btn.style.boxShadow = isSelected ? `0 0 0 1px ${GREEN} inset` : 'none';
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
        // Non-blocks categories
        if (state.activeCategory === 'lighting') {
          lightingPanel.syncOnRebuild(state, currentLighting, paletteDiv);
        }
        const items = PALETTE_ITEMS.filter(i => i.category === state.activeCategory);

        // Categories that get a visual 2-column preview grid
        const usePreviewGrid = (
          state.activeCategory === 'specialBlocks' ||
          state.activeCategory === 'enemies' ||
          state.activeCategory === 'triggers' ||
          state.activeCategory === 'collectables' ||
          state.activeCategory === 'environment' ||
          state.activeCategory === 'dust' ||
          state.activeCategory === 'objects' ||
          state.activeCategory === 'lighting' ||
          state.activeCategory === 'liquids' ||
          state.activeCategory === 'ropes' ||
          state.activeCategory === 'guidePaths'
        );

        if (usePreviewGrid) {
          const grid = document.createElement('div');
          grid.style.cssText = `display: grid; grid-template-columns: 1fr 1fr; gap: 5px;`;
          for (const item of items) {
            const card = makePalettePreviewCard(item, currentTheme, () => {
              callbacks?.onPaletteItemSelect(item);
            });
            paletteItems.push({ btn: card, itemId: item.id });
            grid.appendChild(card);
          }
          paletteDiv.appendChild(grid);
        }
      }
    } else if (state.activeCategory === 'lighting') {
      lightingPanel.syncInPlace(state, currentLighting);
    }

    // Update palette selection highlight
    for (const { btn, itemId } of paletteItems) {
      const isSelected = state.selectedPaletteItem?.id === itemId;
      btn.style.background = isSelected ? ACTIVE_BG : BTN_BG;
      btn.style.borderColor = isSelected ? GREEN : PANEL_BORDER;
    }

    specialItemPickers.update(state);
    const item = state.selectedPaletteItem;
    const isModifierEligible = state.activeCategory === 'blocks' &&
      item !== null &&
      item.category === 'blocks' &&
      item.isPlatformItem !== 1 &&
      item.isRampItem !== 1 &&
      item.isBackgroundBlockItem !== 1;
    blockModifierDiv.style.display = isModifierEligible ? '' : 'none';
    if (isModifierEligible) {
      for (const input of modifierInputs) {
        input.checked = input.dataset.modifier === state.pendingBlockPlacementModifier;
      }
      modifierCrumbleSelect.style.display = state.pendingBlockPlacementModifier === 'cracked' ? '' : 'none';
      if (document.activeElement !== modifierCrumbleSelect) {
        modifierCrumbleSelect.value = state.pendingCrumbleVariant;
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
      lightingPanel.resetState();
      dimWidthInput = null;
      dimHeightInput = null;
      if (animatedBackgroundPreviewFrame !== null) {
        cancelAnimationFrame(animatedBackgroundPreviewFrame);
        animatedBackgroundPreviewFrame = null;
      }
      animatedBackgroundPreviewCanvases = [];
      if (container.parentElement) container.parentElement.removeChild(container);
      if (topRightBar.parentElement) topRightBar.parentElement.removeChild(topRightBar);
    },
  };
}
