/**
 * editorCustomBlockDialog.ts — Pixel art editor dialog for custom block creation.
 *
 * Provides a self-contained modal that lets the user:
 *   1. Name the block and set its footprint (1×1 or 2×2).
 *   2. Edit each pixel using pencil, eraser, fill, eyedropper tools.
 *   3. Preview the block at actual game scale.
 *   4. Save it to the campaign.
 *
 * Undo/redo for pixel edits is tracked locally (separate from the room history).
 */

import type { CustomBlockDef, CustomBlockSourceDef } from '../levels/customBlocks';
import {
  CUSTOM_BLOCK_PIXELS_PER_TILE,
  makeBlankPixelData,
  serializeCustomBlock,
  toRgbaHex,
  parseRgbaHex,
  isValidRgbaHex,
  TRANSPARENT_PIXEL,
} from '../levels/customBlocks';
import type {
  CustomBlockProperties,
  CollisionPreset,
  FrictionPreset,
  BreakabilityPreset,
  MaterialResponsePreset,
  ContactDamagePreset,
} from '../levels/customBlockProperties';
import {
  DEFAULT_CUSTOM_BLOCK_PROPERTIES,
  COLLISION_PRESET_REGISTRY,
  FRICTION_PRESET_REGISTRY,
  BREAKABILITY_PRESET_REGISTRY,
  MATERIAL_RESPONSE_PRESET_REGISTRY,
  CONTACT_DAMAGE_PRESET_REGISTRY,
  checkCustomBlockPropertyCompatibility,
} from '../levels/customBlockProperties';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PixelTool = 'pencil' | 'eraser' | 'fill' | 'eyedropper';

export interface CustomBlockDialogResult {
  action: 'save' | 'cancel';
  sourceDef?: CustomBlockSourceDef;
}

// ── Dialog ────────────────────────────────────────────────────────────────────

const SCALE = 24; // Editor canvas: each pixel displayed at 24×24 px
const PREVIEW_SCALE = 4; // Preview at 4× (matches game's default zoom)

export function openCustomBlockDialog(
  options: {
    existingDef?: CustomBlockDef;
    defaultTileWidth?: 1 | 2;
    existingIds?: ReadonlySet<string>;
  },
  onResult: (result: CustomBlockDialogResult) => void,
): void {
  const { existingDef, defaultTileWidth = 1, existingIds = new Set() } = options;

  let tileWidth: 1 | 2 = existingDef?.tileWidth ?? defaultTileWidth;
  let tileHeight: 1 | 2 = existingDef?.tileHeight ?? 1;
  let pw = tileWidth * CUSTOM_BLOCK_PIXELS_PER_TILE;
  let ph = tileHeight * CUSTOM_BLOCK_PIXELS_PER_TILE;
  let pixelData = existingDef
    ? new Uint8ClampedArray(existingDef.pixelData)
    : makeBlankPixelData(tileWidth, tileHeight);

  let properties: CustomBlockProperties = existingDef?.properties ?? DEFAULT_CUSTOM_BLOCK_PROPERTIES;

  // Snapshot of persisted pixel data / properties used to detect unsaved changes.
  const savedPixelData = new Uint8ClampedArray(pixelData);
  let savedProperties: CustomBlockProperties = properties;

  function propertiesEqual(a: CustomBlockProperties, b: CustomBlockProperties): boolean {
    return a.collision === b.collision && a.friction === b.friction && a.breakability === b.breakability &&
      a.materialResponse === b.materialResponse && a.contactDamage === b.contactDamage;
  }

  function isDirty(): boolean {
    if (pixelData.length !== savedPixelData.length) return true;
    for (let i = 0; i < pixelData.length; i++) {
      if (pixelData[i] !== savedPixelData[i]) return true;
    }
    if (!propertiesEqual(properties, savedProperties)) return true;
    return false;
  }

  const blockId = existingDef?.id ?? '';
  const blockName = existingDef?.name ?? '';
  let activeTool: PixelTool = 'pencil';
  let activeColor = '#FF0000FF';
  let isDrawing = false;
  const drawPixelsThisStroke = new Set<number>(); // pixel indices touched this stroke
  let lastDrawnPx = -1; // for Bresenham interpolation between mousemove events
  let lastDrawnPy = -1;

  // Undo/redo stacks (each entry = full pixel data + properties snapshot)
  interface EditorSnapshot { pixelData: Uint8ClampedArray; properties: CustomBlockProperties }
  const undoStack: EditorSnapshot[] = [];
  const redoStack: EditorSnapshot[] = [];

  // ── DOM setup ──────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; inset: 0; background: rgba(0,0,0,0.75);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999; font-family: monospace; color: #eee;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: #1a1a2e; border: 1px solid #444; border-radius: 6px;
    padding: 16px; display: flex; flex-direction: column; gap: 10px;
    max-height: 95vh; overflow-y: auto; min-width: 420px;
  `;
  overlay.appendChild(modal);

  // Title
  const title = document.createElement('div');
  title.textContent = existingDef ? `Edit Block: ${existingDef.name}` : 'New Custom Block';
  title.style.cssText = 'font-size: 15px; font-weight: bold; color: #7fda7f;';
  modal.appendChild(title);

  // Name input
  const nameRow = document.createElement('div');
  nameRow.style.cssText = 'display:flex;gap:8px;align-items:center;';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Name:';
  nameLabel.style.cssText = 'font-size:12px;width:50px;';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = blockName;
  nameInput.placeholder = 'e.g. Weathered Stone';
  nameInput.style.cssText = 'background:#0d0d1a;border:1px solid #555;color:#eee;padding:4px 8px;border-radius:3px;flex:1;font-family:monospace;font-size:12px;';
  nameRow.appendChild(nameLabel);
  nameRow.appendChild(nameInput);
  modal.appendChild(nameRow);

  // Footprint selector (only for new blocks, disabled when editing)
  const footprintRow = document.createElement('div');
  footprintRow.style.cssText = 'display:flex;gap:8px;align-items:center;';
  const footprintLabel = document.createElement('span');
  footprintLabel.textContent = 'Footprint:';
  footprintLabel.style.cssText = 'font-size:12px;width:70px;';
  footprintRow.appendChild(footprintLabel);

  const btn1x1 = document.createElement('button');
  btn1x1.textContent = '1×1 (8×8 px)';
  const btn2x2 = document.createElement('button');
  btn2x2.textContent = '2×2 (16×16 px)';

  function styleFootprintBtn(btn: HTMLButtonElement, active: boolean): void {
    btn.style.cssText = `padding:4px 10px;font-size:11px;cursor:pointer;border-radius:3px;font-family:monospace;
      background:${active ? '#2a5a2a' : '#222'};border:1px solid ${active ? '#7fda7f' : '#555'};
      color:${active ? '#7fda7f' : '#aaa'};`;
    if (existingDef) { btn.disabled = true; btn.style.opacity = '0.5'; }
  }

  styleFootprintBtn(btn1x1, tileWidth === 1 && tileHeight === 1);
  styleFootprintBtn(btn2x2, tileWidth === 2 && tileHeight === 2);

  function applyFootprint(w: 1 | 2, h: 1 | 2): void {
    if (existingDef) return;
    tileWidth = w; tileHeight = h;
    pw = w * CUSTOM_BLOCK_PIXELS_PER_TILE;
    ph = h * CUSTOM_BLOCK_PIXELS_PER_TILE;
    pixelData = makeBlankPixelData(w, h);
    undoStack.length = 0;
    redoStack.length = 0;
    styleFootprintBtn(btn1x1, w === 1 && h === 1);
    styleFootprintBtn(btn2x2, w === 2 && h === 2);
    rebuildCanvas();
    drawCanvas();
    updatePreview();
    refreshCompatibilityMessage();
  }

  btn1x1.addEventListener('click', () => applyFootprint(1, 1));
  btn2x2.addEventListener('click', () => applyFootprint(2, 2));
  footprintRow.appendChild(btn1x1);
  footprintRow.appendChild(btn2x2);
  modal.appendChild(footprintRow);

  // ── Properties section ────────────────────────────────────────────────────
  const propsSection = document.createElement('div');
  propsSection.style.cssText = 'display:flex;flex-direction:column;gap:6px;border:1px solid #333;border-radius:4px;padding:8px;margin-top:2px;';
  const propsTitle = document.createElement('div');
  propsTitle.textContent = 'Properties';
  propsTitle.style.cssText = 'font-size:12px;font-weight:bold;color:#aac;';
  propsSection.appendChild(propsTitle);

  function makePropertyRow<T extends string>(
    label: string,
    registry: Readonly<Record<T, { id: T; label: string; description: string }>>,
    getValue: () => T,
    setValue: (v: T) => void,
  ): { row: HTMLElement; select: HTMLSelectElement; desc: HTMLElement } {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:2px;';
    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;gap:8px;align-items:center;';
    const lbl = document.createElement('span');
    lbl.textContent = `${label}:`;
    lbl.style.cssText = 'font-size:11px;width:80px;color:#ccc;';
    const select = document.createElement('select');
    select.style.cssText = 'background:#0d0d1a;border:1px solid #555;color:#eee;padding:3px 6px;border-radius:3px;font-family:monospace;font-size:11px;flex:1;';
    for (const key of Object.keys(registry) as T[]) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = registry[key].label;
      select.appendChild(opt);
    }
    select.value = getValue();
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:10px;color:#888;margin-left:88px;';
    desc.textContent = registry[getValue()].description;
    select.addEventListener('change', () => {
      pushUndo();
      const v = select.value as T;
      setValue(v);
      desc.textContent = registry[v].description;
      refreshCompatibilityMessage();
    });
    topRow.appendChild(lbl);
    topRow.appendChild(select);
    row.appendChild(topRow);
    row.appendChild(desc);
    return { row, select, desc };
  }

  const collisionCtl = makePropertyRow<CollisionPreset>(
    'Collision', COLLISION_PRESET_REGISTRY,
    () => properties.collision,
    (v) => { properties = { ...properties, collision: v }; },
  );
  const frictionCtl = makePropertyRow<FrictionPreset>(
    'Friction', FRICTION_PRESET_REGISTRY,
    () => properties.friction,
    (v) => { properties = { ...properties, friction: v }; },
  );
  const breakabilityCtl = makePropertyRow<BreakabilityPreset>(
    'Breakability', BREAKABILITY_PRESET_REGISTRY,
    () => properties.breakability,
    (v) => { properties = { ...properties, breakability: v }; },
  );
  const materialResponseCtl = makePropertyRow<MaterialResponsePreset>(
    'Material response', MATERIAL_RESPONSE_PRESET_REGISTRY,
    () => properties.materialResponse,
    (v) => { properties = { ...properties, materialResponse: v }; },
  );
  const contactDamageCtl = makePropertyRow<ContactDamagePreset>(
    'Contact damage', CONTACT_DAMAGE_PRESET_REGISTRY,
    () => properties.contactDamage,
    (v) => { properties = { ...properties, contactDamage: v }; },
  );
  propsSection.appendChild(collisionCtl.row);
  propsSection.appendChild(frictionCtl.row);
  propsSection.appendChild(breakabilityCtl.row);
  propsSection.appendChild(materialResponseCtl.row);
  propsSection.appendChild(contactDamageCtl.row);

  const compatMsg = document.createElement('div');
  compatMsg.style.cssText = 'font-size:10px;color:#ff8844;min-height:14px;';
  propsSection.appendChild(compatMsg);

  function refreshCompatibilityMessage(): void {
    const issues = checkCustomBlockPropertyCompatibility(properties, tileWidth, tileHeight);
    compatMsg.textContent = issues.length > 0 ? `⚠ ${issues.map(i => i.message).join(' ')}` : '';
  }

  function refreshPropertyControls(): void {
    collisionCtl.select.value = properties.collision;
    collisionCtl.desc.textContent = COLLISION_PRESET_REGISTRY[properties.collision].description;
    frictionCtl.select.value = properties.friction;
    frictionCtl.desc.textContent = FRICTION_PRESET_REGISTRY[properties.friction].description;
    breakabilityCtl.select.value = properties.breakability;
    breakabilityCtl.desc.textContent = BREAKABILITY_PRESET_REGISTRY[properties.breakability].description;
    materialResponseCtl.select.value = properties.materialResponse;
    materialResponseCtl.desc.textContent = MATERIAL_RESPONSE_PRESET_REGISTRY[properties.materialResponse].description;
    contactDamageCtl.select.value = properties.contactDamage;
    contactDamageCtl.desc.textContent = CONTACT_DAMAGE_PRESET_REGISTRY[properties.contactDamage].description;
    refreshCompatibilityMessage();
  }

  refreshCompatibilityMessage();
  modal.appendChild(propsSection);

  // ── Canvas area ────────────────────────────────────────────────────────────
  const canvasWrap = document.createElement('div');
  canvasWrap.style.cssText = 'display:flex;gap:16px;align-items:flex-start;';
  modal.appendChild(canvasWrap);

  // Pixel editor canvas
  let editorCanvas: HTMLCanvasElement;
  let editorCtx: CanvasRenderingContext2D;

  function rebuildCanvas(): void {
    if (editorCanvas) {
      editorCanvas.width = pw * SCALE;
      editorCanvas.height = ph * SCALE;
    } else {
      editorCanvas = document.createElement('canvas');
      editorCanvas.width = pw * SCALE;
      editorCanvas.height = ph * SCALE;
      editorCanvas.style.cssText = `border:1px solid #555;cursor:crosshair;image-rendering:pixelated;`;
      canvasWrap.insertBefore(editorCanvas, canvasWrap.firstChild);
      attachCanvasEvents();
    }
  }

  function drawCanvas(): void {
    editorCtx = editorCanvas.getContext('2d')!;
    editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);

    // Checkerboard background (transparency indicator)
    const checker = 8;
    for (let py = 0; py < ph; py++) {
      for (let px = 0; px < pw; px++) {
        const isLight = (Math.floor(px / checker) + Math.floor(py / checker)) % 2 === 0;
        editorCtx.fillStyle = isLight ? '#aaa' : '#777';
        editorCtx.fillRect(px * SCALE, py * SCALE, SCALE, SCALE);
      }
    }

    // Pixels
    editorCtx.imageSmoothingEnabled = false;
    const img = new ImageData(new Uint8ClampedArray(pixelData.buffer as ArrayBuffer), pw, ph);
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = pw;
    tmpCanvas.height = ph;
    const tmpCtx = tmpCanvas.getContext('2d')!;
    tmpCtx.putImageData(img, 0, 0);
    editorCtx.drawImage(tmpCanvas, 0, 0, pw * SCALE, ph * SCALE);

    // Grid
    editorCtx.strokeStyle = 'rgba(255,255,255,0.2)';
    editorCtx.lineWidth = 0.5;
    for (let px = 0; px <= pw; px++) {
      editorCtx.beginPath();
      editorCtx.moveTo(px * SCALE, 0);
      editorCtx.lineTo(px * SCALE, ph * SCALE);
      editorCtx.stroke();
    }
    for (let py = 0; py <= ph; py++) {
      editorCtx.beginPath();
      editorCtx.moveTo(0, py * SCALE);
      editorCtx.lineTo(pw * SCALE, py * SCALE);
      editorCtx.stroke();
    }
  }

  function updatePreview(): void {
    const prevW = pw * PREVIEW_SCALE;
    const prevH = ph * PREVIEW_SCALE;
    previewCanvas.width = prevW;
    previewCanvas.height = prevH;
    const prevCtx = previewCanvas.getContext('2d')!;
    prevCtx.clearRect(0, 0, prevW, prevH);

    // Checkerboard
    const ck = 4;
    for (let py = 0; py < prevH; py += ck) {
      for (let px = 0; px < prevW; px += ck) {
        const light = (Math.floor(px / ck) + Math.floor(py / ck)) % 2 === 0;
        prevCtx.fillStyle = light ? '#aaa' : '#777';
        prevCtx.fillRect(px, py, ck, ck);
      }
    }

    const img = new ImageData(new Uint8ClampedArray(pixelData.buffer as ArrayBuffer), pw, ph);
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = pw;
    tmpCanvas.height = ph;
    const tmpCtx = tmpCanvas.getContext('2d')!;
    tmpCtx.putImageData(img, 0, 0);
    prevCtx.imageSmoothingEnabled = false;
    prevCtx.drawImage(tmpCanvas, 0, 0, prevW, prevH);
    previewLabel.textContent = `Preview (${PREVIEW_SCALE}× scale)`;
  }

  // Side panel (tools + preview)
  const sidePanel = document.createElement('div');
  sidePanel.style.cssText = 'display:flex;flex-direction:column;gap:8px;min-width:120px;';
  canvasWrap.appendChild(sidePanel);

  // Tools
  const toolsLabel = document.createElement('div');
  toolsLabel.textContent = 'Tools';
  toolsLabel.style.cssText = 'font-size:11px;color:#aaa;';
  sidePanel.appendChild(toolsLabel);

  const toolButtons: { tool: PixelTool; label: string }[] = [
    { tool: 'pencil', label: '✏ Pencil' },
    { tool: 'eraser', label: '◻ Eraser' },
    { tool: 'fill', label: '🪣 Fill' },
    { tool: 'eyedropper', label: '💧 Pick' },
  ];

  const toolBtnEls: Map<PixelTool, HTMLButtonElement> = new Map();

  function updateToolButtons(): void {
    for (const [tool, el] of toolBtnEls) {
      const active = tool === activeTool;
      el.style.background = active ? '#2a3a2a' : '#222';
      el.style.borderColor = active ? '#7fda7f' : '#555';
      el.style.color = active ? '#7fda7f' : '#ccc';
    }
  }

  for (const { tool, label } of toolButtons) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = 'padding:4px 8px;font-size:11px;cursor:pointer;border-radius:3px;font-family:monospace;width:100%;text-align:left;';
    btn.addEventListener('click', () => { activeTool = tool; updateToolButtons(); });
    sidePanel.appendChild(btn);
    toolBtnEls.set(tool, btn);
  }
  updateToolButtons();

  // Color picker
  const colorSection = document.createElement('div');
  colorSection.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:6px;';
  const colorLabel = document.createElement('div');
  colorLabel.textContent = 'Color';
  colorLabel.style.cssText = 'font-size:11px;color:#aaa;';
  colorSection.appendChild(colorLabel);

  const colorPicker = document.createElement('input');
  colorPicker.type = 'color';
  colorPicker.value = '#FF0000';
  colorPicker.style.cssText = 'width:100%;height:28px;cursor:pointer;background:none;border:1px solid #555;border-radius:3px;';
  colorSection.appendChild(colorPicker);

  const hexInput = document.createElement('input');
  hexInput.type = 'text';
  hexInput.value = '#FF0000FF';
  hexInput.placeholder = '#RRGGBBAA';
  hexInput.maxLength = 9;
  hexInput.style.cssText = 'background:#0d0d1a;border:1px solid #555;color:#eee;padding:3px 6px;font-family:monospace;font-size:11px;border-radius:3px;width:100%;box-sizing:border-box;';
  colorSection.appendChild(hexInput);

  // Alpha slider
  const alphaRow = document.createElement('div');
  alphaRow.style.cssText = 'display:flex;gap:4px;align-items:center;';
  const alphaLabel = document.createElement('span');
  alphaLabel.textContent = 'A:';
  alphaLabel.style.cssText = 'font-size:10px;color:#aaa;';
  const alphaSlider = document.createElement('input');
  alphaSlider.type = 'range';
  alphaSlider.min = '0';
  alphaSlider.max = '255';
  alphaSlider.value = '255';
  alphaSlider.style.cssText = 'flex:1;';
  const alphaVal = document.createElement('span');
  alphaVal.textContent = '255';
  alphaVal.style.cssText = 'font-size:10px;color:#aaa;min-width:25px;';
  alphaRow.appendChild(alphaLabel);
  alphaRow.appendChild(alphaSlider);
  alphaRow.appendChild(alphaVal);
  colorSection.appendChild(alphaRow);

  sidePanel.appendChild(colorSection);

  function syncColorFromHex(hex: string): void {
    if (!isValidRgbaHex(hex)) return;
    activeColor = hex;
    colorPicker.value = '#' + hex.slice(1, 7);
    alphaSlider.value = String(parseInt(hex.slice(7, 9), 16));
    alphaVal.textContent = alphaSlider.value;
  }

  colorPicker.addEventListener('input', () => {
    const a = parseInt(alphaSlider.value);
    const rgba = parseRgbaHex(`${colorPicker.value}${a.toString(16).padStart(2, '0').toUpperCase()}FF`.slice(0, 9));
    if (!rgba) return;
    activeColor = toRgbaHex(rgba[0], rgba[1], rgba[2], a);
    hexInput.value = activeColor;
    alphaVal.textContent = String(a);
  });

  alphaSlider.addEventListener('input', () => {
    const a = parseInt(alphaSlider.value);
    alphaVal.textContent = String(a);
    const rgba = parseRgbaHex(activeColor);
    if (!rgba) return;
    activeColor = toRgbaHex(rgba[0], rgba[1], rgba[2], a);
    hexInput.value = activeColor;
  });

  hexInput.addEventListener('change', () => {
    let v = hexInput.value.trim();
    if (!v.startsWith('#')) v = '#' + v;
    v = v.toUpperCase();
    if (isValidRgbaHex(v)) {
      syncColorFromHex(v);
    }
  });

  // Preview canvas
  const previewLabel = document.createElement('div');
  previewLabel.style.cssText = 'font-size:10px;color:#aaa;margin-top:8px;';
  sidePanel.appendChild(previewLabel);

  const previewCanvas = document.createElement('canvas');
  previewCanvas.style.cssText = 'border:1px solid #555;image-rendering:pixelated;';
  sidePanel.appendChild(previewCanvas);

  // Undo/Redo/Clear buttons
  const actionsRow = document.createElement('div');
  actionsRow.style.cssText = 'display:flex;gap:6px;margin-top:4px;';

  function makeSmallBtn(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'padding:3px 8px;font-size:10px;cursor:pointer;border-radius:3px;background:#222;border:1px solid #555;color:#ccc;font-family:monospace;';
    b.addEventListener('click', onClick);
    return b;
  }

  function pushUndo(): void {
    undoStack.push({ pixelData: new Uint8ClampedArray(pixelData), properties });
    redoStack.length = 0;
    if (undoStack.length > 50) undoStack.shift();
  }

  function doUndo(): void {
    const snap = undoStack.pop();
    if (!snap) return;
    redoStack.push({ pixelData: new Uint8ClampedArray(pixelData), properties });
    pixelData = snap.pixelData;
    properties = snap.properties;
    drawCanvas();
    updatePreview();
    refreshPropertyControls();
  }

  function doRedo(): void {
    const snap = redoStack.pop();
    if (!snap) return;
    undoStack.push({ pixelData: new Uint8ClampedArray(pixelData), properties });
    pixelData = snap.pixelData;
    properties = snap.properties;
    drawCanvas();
    updatePreview();
    refreshPropertyControls();
  }

  function doClear(): void {
    pushUndo();
    pixelData = makeBlankPixelData(tileWidth, tileHeight);
    drawCanvas();
    updatePreview();
  }

  actionsRow.appendChild(makeSmallBtn('↩ Undo', doUndo));
  actionsRow.appendChild(makeSmallBtn('↪ Redo', doRedo));
  actionsRow.appendChild(makeSmallBtn('🗑 Clear', doClear));
  sidePanel.appendChild(actionsRow);

  // ── Canvas event handlers ──────────────────────────────────────────────────

  function canvasPixelAt(e: MouseEvent): [number, number] {
    const rect = editorCanvas.getBoundingClientRect();
    const px = Math.floor((e.clientX - rect.left) / (rect.width / pw));
    const py = Math.floor((e.clientY - rect.top) / (rect.height / ph));
    return [Math.max(0, Math.min(pw - 1, px)), Math.max(0, Math.min(ph - 1, py))];
  }

  function setPixel(px: number, py: number, color: string): void {
    const idx = (py * pw + px) * 4;
    if (color === TRANSPARENT_PIXEL) {
      pixelData[idx] = pixelData[idx + 1] = pixelData[idx + 2] = pixelData[idx + 3] = 0;
      return;
    }
    const rgba = parseRgbaHex(color);
    if (!rgba) return;
    pixelData[idx]     = rgba[0];
    pixelData[idx + 1] = rgba[1];
    pixelData[idx + 2] = rgba[2];
    pixelData[idx + 3] = rgba[3];
  }

  function getPixelColor(px: number, py: number): string {
    const idx = (py * pw + px) * 4;
    return toRgbaHex(pixelData[idx], pixelData[idx + 1], pixelData[idx + 2], pixelData[idx + 3]);
  }

  function floodFill(startX: number, startY: number, fillColor: string): void {
    const targetColor = getPixelColor(startX, startY);
    if (targetColor === fillColor) return;
    const stack: [number, number][] = [[startX, startY]];
    const visited = new Set<number>();
    while (stack.length > 0) {
      const [cx, cy] = stack.pop()!;
      const key = cy * pw + cx;
      if (visited.has(key)) continue;
      if (cx < 0 || cy < 0 || cx >= pw || cy >= ph) continue;
      if (getPixelColor(cx, cy) !== targetColor) continue;
      visited.add(key);
      setPixel(cx, cy, fillColor);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  // Bresenham's line: visit all pixels from (x0,y0) to (x1,y1) inclusive.
  function* bresenhamLine(x0: number, y0: number, x1: number, y1: number): Generator<[number, number]> {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let cx = x0, cy = y0;
    while (true) {
      yield [cx, cy];
      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx)  { err += dx; cy += sy; }
    }
  }

  function paintPixel(px: number, py: number): boolean {
    if (px < 0 || py < 0 || px >= pw || py >= ph) return false;
    const idx = py * pw + px;
    if (drawPixelsThisStroke.has(idx)) return false;
    drawPixelsThisStroke.add(idx);
    setPixel(px, py, activeTool === 'eraser' ? TRANSPARENT_PIXEL : activeColor);
    return true;
  }

  function applyToolAt(px: number, py: number, isFirstInStroke: boolean): void {
    if (activeTool === 'pencil' || activeTool === 'eraser') {
      let changed = false;
      if (isFirstInStroke || lastDrawnPx < 0) {
        changed = paintPixel(px, py);
      } else {
        // Interpolate from last position to current to prevent gaps on fast moves.
        for (const [lx, ly] of bresenhamLine(lastDrawnPx, lastDrawnPy, px, py)) {
          if (paintPixel(lx, ly)) changed = true;
        }
      }
      lastDrawnPx = px;
      lastDrawnPy = py;
      if (changed) { drawCanvas(); updatePreview(); }
    } else if (activeTool === 'fill' && isFirstInStroke) {
      pushUndo();
      floodFill(px, py, activeColor);
      drawCanvas();
      updatePreview();
    } else if (activeTool === 'eyedropper' && isFirstInStroke) {
      const picked = getPixelColor(px, py);
      syncColorFromHex(picked);
    }
  }

  function attachCanvasEvents(): void {
    editorCanvas.addEventListener('mousedown', (e) => {
      isDrawing = true;
      drawPixelsThisStroke.clear();
      lastDrawnPx = -1;
      lastDrawnPy = -1;
      const [px, py] = canvasPixelAt(e);
      if (activeTool === 'pencil' || activeTool === 'eraser') {
        pushUndo(); // One undo step per stroke
        redoStack.length = 0;
      }
      applyToolAt(px, py, true);
      e.preventDefault();
    });

    editorCanvas.addEventListener('mousemove', (e) => {
      if (!isDrawing) return;
      const [px, py] = canvasPixelAt(e);
      applyToolAt(px, py, false);
    });

    // End stroke on mouseup anywhere in the document — so releasing the button
    // outside the canvas correctly finishes the stroke (not leaves it hanging).
    const stopDraw = (): void => {
      if (!isDrawing) return;
      isDrawing = false;
      drawPixelsThisStroke.clear();
      lastDrawnPx = -1;
      lastDrawnPy = -1;
    };
    window.addEventListener('mouseup', stopDraw);

    // Cleanup the global listener when the dialog is removed.
    const observer = new MutationObserver(() => {
      if (!document.contains(overlay)) {
        window.removeEventListener('mouseup', stopDraw);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: false });
  }

  // ── Save/Cancel ────────────────────────────────────────────────────────────
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:8px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '✕ Cancel';
  cancelBtn.style.cssText = 'padding:6px 14px;font-size:12px;cursor:pointer;border-radius:3px;background:#2a0d0d;border:1px solid #aa4444;color:#ff8888;font-family:monospace;';
  cancelBtn.addEventListener('click', () => {
    attemptCancel();
  });

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '💾 Save Block';
  saveBtn.style.cssText = 'padding:6px 14px;font-size:12px;cursor:pointer;border-radius:3px;background:#0d2a0d;border:1px solid #44aa44;color:#7fda7f;font-family:monospace;';

  const errorMsg = document.createElement('div');
  errorMsg.style.cssText = 'font-size:11px;color:#ff6644;min-height:16px;';
  modal.appendChild(errorMsg);

  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (name.length === 0) {
      errorMsg.textContent = 'Block name cannot be empty.';
      return;
    }

    const compatIssues = checkCustomBlockPropertyCompatibility(properties, tileWidth, tileHeight);
    if (compatIssues.length > 0) {
      errorMsg.textContent = `Cannot save: ${compatIssues.map(i => i.message).join(' ')}`;
      return;
    }

    let id = blockId;
    if (!id) {
      // Generate ID from name
      id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'block';
      // Make unique
      if (existingIds.has(id)) {
        for (let n = 2; n < 9999; n++) {
          const candidate = `${id}-${n}`;
          if (!existingIds.has(candidate)) { id = candidate; break; }
        }
      }
    }

    const sourceDef = serializeCustomBlock(id, name, tileWidth, tileHeight, pixelData, properties);
    overlay.remove();
    onResult({ action: 'save', sourceDef });
    // Clear dirty state after successful save (for external callers tracking this).
    savedPixelData.set(pixelData);
    savedProperties = properties;
  });

  /**
   * Shows a Save/Discard/Keep Editing confirmation dialog when the user
   * tries to cancel with unsaved changes.
   */
  function attemptCancel(): void {
    if (!isDirty()) {
      overlay.remove();
      onResult({ action: 'cancel' });
      return;
    }

    // Build the confirmation sub-dialog
    const confirmOverlay = document.createElement('div');
    confirmOverlay.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center; z-index: 10000;
      font-family: monospace; color: #eee;
    `;

    const confirmBox = document.createElement('div');
    confirmBox.style.cssText = `
      background: #1a1a2e; border: 1px solid #666; border-radius: 6px;
      padding: 20px; display: flex; flex-direction: column; gap: 12px;
      min-width: 280px; max-width: 360px;
    `;

    const msg = document.createElement('div');
    msg.style.cssText = 'font-size:13px;line-height:1.5;color:#ddd;';
    msg.textContent = 'You have unsaved pixel edits. What would you like to do?';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;';

    const keepBtn = document.createElement('button');
    keepBtn.textContent = '↩ Keep Editing';
    keepBtn.style.cssText = 'padding:6px 12px;font-size:12px;cursor:pointer;border-radius:3px;background:#2a2a3e;border:1px solid #666;color:#ccc;font-family:monospace;';
    keepBtn.addEventListener('click', () => {
      confirmOverlay.remove();
      overlay.focus();
    });

    const discardBtn = document.createElement('button');
    discardBtn.textContent = '🗑 Discard Changes';
    discardBtn.style.cssText = 'padding:6px 12px;font-size:12px;cursor:pointer;border-radius:3px;background:#2a0d0d;border:1px solid #aa4444;color:#ff8888;font-family:monospace;';
    discardBtn.addEventListener('click', () => {
      confirmOverlay.remove();
      overlay.remove();
      onResult({ action: 'cancel' });
    });

    const saveAndCloseBtn = document.createElement('button');
    saveAndCloseBtn.textContent = '💾 Save & Close';
    saveAndCloseBtn.style.cssText = 'padding:6px 12px;font-size:12px;cursor:pointer;border-radius:3px;background:#0d2a0d;border:1px solid #44aa44;color:#7fda7f;font-family:monospace;';
    saveAndCloseBtn.addEventListener('click', () => {
      confirmOverlay.remove();
      saveBtn.click(); // Trigger the existing save logic (validates, serializes, removes overlay)
    });

    btnRow.appendChild(keepBtn);
    btnRow.appendChild(discardBtn);
    btnRow.appendChild(saveAndCloseBtn);
    confirmBox.appendChild(msg);
    confirmBox.appendChild(btnRow);
    confirmOverlay.appendChild(confirmBox);
    document.body.appendChild(confirmOverlay);
    keepBtn.focus();

    confirmOverlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { confirmOverlay.remove(); overlay.focus(); e.stopPropagation(); }
    });
  }

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  modal.appendChild(btnRow);

  // Keyboard shortcuts
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { attemptCancel(); e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { doUndo(); e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { doRedo(); e.preventDefault(); }
    if (e.key === 'p' || e.key === 'P') activeTool = 'pencil';
    if (e.key === 'e' || e.key === 'E') activeTool = 'eraser';
    if (e.key === 'f' || e.key === 'F') activeTool = 'fill';
    if (e.key === 'i' || e.key === 'I') activeTool = 'eyedropper';
    updateToolButtons();
  });
  overlay.tabIndex = -1;

  // Initial render
  document.body.appendChild(overlay);
  overlay.focus();
  rebuildCanvas();
  drawCanvas();
  updatePreview();
}
