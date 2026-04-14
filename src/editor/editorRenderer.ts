/**
 * Editor renderer — draws overlays for grid, placement preview,
 * selection highlights, transition zones, enemy markers, and
 * other editor visual feedback on the 2D canvas.
 */

import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { EditorState, EditorRoomData, EditorTransition, EditorWall } from './editorState';
import { EditorTool } from './editorState';
import { getPlacementPreview } from './editorTools';

const GRID_COLOR = 'rgba(255,255,255,0.06)';
const WALL_HIGHLIGHT = 'rgba(100,200,255,0.3)';
const WALL_SELECTED = 'rgba(0,200,255,0.6)';
const PLATFORM_HIGHLIGHT = 'rgba(255,200,50,0.35)';
const PLATFORM_SELECTED = 'rgba(255,200,50,0.8)';
const RAMP_HIGHLIGHT = 'rgba(120,220,120,0.4)';
const RAMP_SELECTED = 'rgba(80,255,80,0.8)';
const PILLAR_HALF_HIGHLIGHT = 'rgba(180,130,255,0.45)';
const PILLAR_HALF_SELECTED = 'rgba(180,100,255,0.9)';
const ENEMY_COLOR = 'rgba(255,80,80,0.5)';
const ENEMY_SELECTED = 'rgba(255,80,80,0.9)';
const TRANSITION_COLOR = 'rgba(80,255,80,0.35)';
const TRANSITION_SELECTED = 'rgba(80,255,80,0.8)';
const TRANSITION_LINK_SOURCE = 'rgba(255,255,0,0.7)';
const TRANSITION_LINK_CANDIDATE = 'rgba(0,255,200,0.5)';
const SPAWN_COLOR = 'rgba(255,220,50,0.5)';
const SPAWN_SELECTED = 'rgba(255,220,50,0.9)';
const TOMB_COLOR = 'rgba(212,168,75,0.5)';
const TOMB_SELECTED = 'rgba(212,168,75,0.9)';
const PREVIEW_COLOR = 'rgba(0,200,255,0.25)';
const PREVIEW_RAMP_COLOR = 'rgba(80,255,80,0.35)';
const PREVIEW_PLATFORM_COLOR = 'rgba(255,200,50,0.4)';
const PREVIEW_PILLAR_HALF_COLOR = 'rgba(180,130,255,0.35)';
const CURSOR_COLOR = 'rgba(255,255,255,0.4)';
const SELECTION_BOX_COLOR = 'rgba(100,200,255,0.25)';
const SELECTION_BOX_BORDER = 'rgba(100,200,255,0.7)';

const BS = BLOCK_SIZE_MEDIUM;

/**
 * Renders all editor overlays on the 2D canvas.
 */
export function renderEditorOverlays(
  ctx: CanvasRenderingContext2D,
  state: EditorState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const room = state.roomData;
  if (room === null) return;

  ctx.save();

  const isElementSelected = (type: string, uid: number): boolean =>
    state.selectedElements.some(e => e.type === type && e.uid === uid);

  // ── Grid ─────────────────────────────────────────────────────────────────
  drawGrid(ctx, room, offsetXPx, offsetYPx, zoom, canvasWidth, canvasHeight);

  // ── Interior walls ────────────────────────────────────────────────────────
  for (const w of room.interiorWalls) {
    const isSelected = isElementSelected('wall', w.uid);
    const isPlatform = w.isPlatformFlag === 1;
    const isRamp = w.rampOrientation !== undefined;
    const isHalfPillar = w.isPillarHalfWidthFlag === 1;

    if (isRamp) {
      const color = isSelected ? RAMP_SELECTED : RAMP_HIGHLIGHT;
      drawRampTriangle(ctx, w, offsetXPx, offsetYPx, zoom, color, isSelected ? 2 : 1);
    } else if (isPlatform) {
      const color = isSelected ? PLATFORM_SELECTED : PLATFORM_HIGHLIGHT;
      drawPlatformLine(ctx, w, offsetXPx, offsetYPx, zoom, color);
    } else if (isHalfPillar) {
      const color = isSelected ? PILLAR_HALF_SELECTED : PILLAR_HALF_HIGHLIGHT;
      drawHalfPillarRect(ctx, w, offsetXPx, offsetYPx, zoom, color);
    } else {
      const color = isSelected ? WALL_SELECTED : WALL_HIGHLIGHT;
      drawBlockRect(ctx, w.xBlock, w.yBlock, w.wBlock, w.hBlock, offsetXPx, offsetYPx, zoom, color, isSelected ? 2 : 1);
    }
  }

  // ── Enemies ──────────────────────────────────────────────────────────────
  for (const e of room.enemies) {
    const isSelected = isElementSelected('enemy', e.uid);
    drawMarker(ctx, e.xBlock, e.yBlock, offsetXPx, offsetYPx, zoom,
      isSelected ? ENEMY_SELECTED : ENEMY_COLOR, e.isFlyingEyeFlag === 1 ? '👁' : '⚔');
  }

  // ── Transitions ──────────────────────────────────────────────────────────
  for (let tIndex = 0; tIndex < room.transitions.length; tIndex++) {
    const t = room.transitions[tIndex];
    const isSelected = isElementSelected('transition', t.uid);
    const isLinkSource = state.isLinkingTransition && state.linkSourceTransitionUid === t.uid;
    const isLinkCandidate = state.isLinkingTransition && state.linkSourceTransitionUid !== t.uid;
    let color = TRANSITION_COLOR;
    if (isLinkSource) color = TRANSITION_LINK_SOURCE;
    else if (isLinkCandidate) color = TRANSITION_LINK_CANDIDATE;
    else if (isSelected) color = TRANSITION_SELECTED;
    drawTransitionZone(ctx, t, room, offsetXPx, offsetYPx, zoom, color, tIndex + 1);
  }

  // ── Player spawn ─────────────────────────────────────────────────────────
  {
    const isSelected = isElementSelected('playerSpawn', 0);
    drawMarker(ctx, room.playerSpawnBlock[0], room.playerSpawnBlock[1], offsetXPx, offsetYPx, zoom,
      isSelected ? SPAWN_SELECTED : SPAWN_COLOR, '🏠');
  }

  // ── Skill tombs ─────────────────────────────────────────────────────────
  for (const s of room.skillTombs) {
    const isSelected = isElementSelected('skillTomb', s.uid);
    drawMarker(ctx, s.xBlock, s.yBlock, offsetXPx, offsetYPx, zoom,
      isSelected ? TOMB_SELECTED : TOMB_COLOR, '⛩');
  }

  // ── Dust piles ──────────────────────────────────────────────────────────
  for (const p of room.dustPiles) {
    const isSelected = isElementSelected('dustPile', p.uid);
    drawMarker(ctx, p.xBlock, p.yBlock, offsetXPx, offsetYPx, zoom,
      isSelected ? 'rgba(255,215,0,0.8)' : 'rgba(255,215,0,0.4)', '✦');
  }

  // ── Placement preview ────────────────────────────────────────────────────
  if (state.activeTool === EditorTool.Place && state.selectedPaletteItem !== null) {
    const preview = getPlacementPreview(state);
    if (preview !== null) {
      const item = state.selectedPaletteItem;
      if (item.isRampItem === 1) {
        // Show ramp preview as a triangle with current orientation
        const base = state.placementRotationSteps % 4;
        const rampOri = (state.placementFlipH ? (base ^ 1) : base) as 0 | 1 | 2 | 3;
        const previewWall: EditorWall = {
          uid: -1,
          xBlock: state.cursorBlockX,
          yBlock: state.cursorBlockY,
          wBlock: preview.wBlock,
          hBlock: preview.hBlock,
          isPlatformFlag: 0,
          platformEdge: 0,
          rampOrientation: rampOri,
          isPillarHalfWidthFlag: 0,
        };
        drawRampTriangle(ctx, previewWall, offsetXPx, offsetYPx, zoom, PREVIEW_RAMP_COLOR, 2);
      } else if (item.isPlatformItem === 1) {
        const platformEdgeMap: readonly (0 | 1 | 2 | 3)[] = [0, 3, 1, 2];
        const platformEdge: 0 | 1 | 2 | 3 = platformEdgeMap[state.placementRotationSteps % 4];
        const previewWall: EditorWall = {
          uid: -1,
          xBlock: state.cursorBlockX,
          yBlock: state.cursorBlockY,
          wBlock: preview.wBlock,
          hBlock: preview.hBlock,
          isPlatformFlag: 1,
          platformEdge,
          isPillarHalfWidthFlag: 0,
        };
        drawPlatformLine(ctx, previewWall, offsetXPx, offsetYPx, zoom, PREVIEW_PLATFORM_COLOR);
      } else if (item.isPillarHalfWidthItem === 1) {
        const previewWall: EditorWall = {
          uid: -1,
          xBlock: state.cursorBlockX,
          yBlock: state.cursorBlockY,
          wBlock: preview.wBlock,
          hBlock: preview.hBlock,
          isPlatformFlag: 0,
          platformEdge: 0,
          isPillarHalfWidthFlag: 1,
        };
        drawHalfPillarRect(ctx, previewWall, offsetXPx, offsetYPx, zoom, PREVIEW_PILLAR_HALF_COLOR);
      } else {
        drawBlockRect(ctx, state.cursorBlockX, state.cursorBlockY,
          preview.wBlock, preview.hBlock, offsetXPx, offsetYPx, zoom, PREVIEW_COLOR, 2);
      }
    }
  }

  // ── Selection box ────────────────────────────────────────────────────────
  if (state.isSelectionBoxActive) {
    const x1 = Math.min(state.selectionBoxStartBlockX, state.cursorBlockX);
    const y1 = Math.min(state.selectionBoxStartBlockY, state.cursorBlockY);
    const x2 = Math.max(state.selectionBoxStartBlockX, state.cursorBlockX);
    const y2 = Math.max(state.selectionBoxStartBlockY, state.cursorBlockY);
    const sx = x1 * BS * zoom + offsetXPx;
    const sy = y1 * BS * zoom + offsetYPx;
    const sw = (x2 - x1 + 1) * BS * zoom;
    const sh = (y2 - y1 + 1) * BS * zoom;
    ctx.fillStyle = SELECTION_BOX_COLOR;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = SELECTION_BOX_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(sx, sy, sw, sh);
  }

  // ── Cursor highlight ─────────────────────────────────────────────────────
  drawBlockRect(ctx, state.cursorBlockX, state.cursorBlockY, 1, 1,
    offsetXPx, offsetYPx, zoom, CURSOR_COLOR, 1);

  ctx.restore();
}

// ── Drawing helpers ──────────────────────────────────────────────────────────

function drawGrid(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  ox: number, oy: number, zoom: number,
  canvasW: number, canvasH: number,
): void {
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();

  const startCol = Math.max(0, Math.floor(-ox / (BS * zoom)));
  const endCol = Math.min(room.widthBlocks, Math.ceil((canvasW - ox) / (BS * zoom)));
  const startRow = Math.max(0, Math.floor(-oy / (BS * zoom)));
  const endRow = Math.min(room.heightBlocks, Math.ceil((canvasH - oy) / (BS * zoom)));

  for (let col = startCol; col <= endCol; col++) {
    const x = col * BS * zoom + ox;
    ctx.moveTo(x, startRow * BS * zoom + oy);
    ctx.lineTo(x, endRow * BS * zoom + oy);
  }
  for (let row = startRow; row <= endRow; row++) {
    const y = row * BS * zoom + oy;
    ctx.moveTo(startCol * BS * zoom + ox, y);
    ctx.lineTo(endCol * BS * zoom + ox, y);
  }
  ctx.stroke();
}

function drawBlockRect(
  ctx: CanvasRenderingContext2D,
  xBlock: number, yBlock: number, wBlock: number, hBlock: number,
  ox: number, oy: number, zoom: number,
  color: string, lineWidth: number,
): void {
  const x = xBlock * BS * zoom + ox;
  const y = yBlock * BS * zoom + oy;
  const w = wBlock * BS * zoom;
  const h = hBlock * BS * zoom;

  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color.replace(/[\d.]+\)$/, '1)');
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(x, y, w, h);
}

/**
 * Draws a ramp wall as a colored triangle using the wall's rampOrientation.
 */
function drawRampTriangle(
  ctx: CanvasRenderingContext2D,
  w: EditorWall,
  ox: number, oy: number, zoom: number,
  color: string, lineWidth: number,
): void {
  const x  = w.xBlock * BS * zoom + ox;
  const y  = w.yBlock * BS * zoom + oy;
  const ww = w.wBlock * BS * zoom;
  const wh = w.hBlock * BS * zoom;
  const ori = w.rampOrientation ?? 0;

  // Corners: TL, TR, BL, BR
  const tlx = x;    const tly = y;
  const trx = x+ww; const try_ = y;
  const blx = x;    const bly = y+wh;
  const brx = x+ww; const bry = y+wh;

  ctx.fillStyle = color;
  ctx.strokeStyle = color.replace(/[\d.]+\)$/, '1)');
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  switch (ori) {
    case 0: // /: BL, BR, TR
      ctx.moveTo(blx, bly); ctx.lineTo(brx, bry); ctx.lineTo(trx, try_);
      break;
    case 1: // \: BR, BL, TL
      ctx.moveTo(brx, bry); ctx.lineTo(blx, bly); ctx.lineTo(tlx, tly);
      break;
    case 2: // ⌐ ceiling: TL, TR, BL
      ctx.moveTo(tlx, tly); ctx.lineTo(trx, try_); ctx.lineTo(blx, bly);
      break;
    case 3: // ¬ ceiling: TL, TR, BR
      ctx.moveTo(tlx, tly); ctx.lineTo(trx, try_); ctx.lineTo(brx, bry);
      break;
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/**
 * Draws a platform wall as a thin line on the appropriate edge.
 */
function drawPlatformLine(
  ctx: CanvasRenderingContext2D,
  w: EditorWall,
  ox: number, oy: number, zoom: number,
  color: string,
): void {
  const x  = w.xBlock * BS * zoom + ox;
  const y  = w.yBlock * BS * zoom + oy;
  const ww = w.wBlock * BS * zoom;
  const wh = w.hBlock * BS * zoom;
  const edge = w.platformEdge ?? 0;
  const LINE = Math.max(2, Math.round(3 * zoom));

  ctx.fillStyle = color;
  ctx.strokeStyle = color.replace(/[\d.]+\)$/, '1)');
  ctx.lineWidth = 1;

  // Draw a faint block outline to show the full block extent
  ctx.fillRect(x, y, ww, wh);

  // Draw the thick edge line
  ctx.fillStyle = color.replace(/[\d.]+\)$/, '0.9)');
  switch (edge) {
    case 0: ctx.fillRect(x, y, ww, LINE); break;           // top
    case 1: ctx.fillRect(x, y + wh - LINE, ww, LINE); break; // bottom
    case 2: ctx.fillRect(x, y, LINE, wh); break;           // left
    case 3: ctx.fillRect(x + ww - LINE, y, LINE, wh); break; // right
  }
  ctx.strokeRect(x, y, ww, wh);
}

/**
 * Draws a half-width pillar wall as a narrow rectangle.
 */
function drawHalfPillarRect(
  ctx: CanvasRenderingContext2D,
  w: EditorWall,
  ox: number, oy: number, zoom: number,
  color: string,
): void {
  // Full AABB position
  const x  = w.xBlock * BS * zoom + ox;
  const y  = w.yBlock * BS * zoom + oy;
  const ww = w.wBlock * BS * zoom;
  const wh = w.hBlock * BS * zoom;
  // Half-width pillar = 3 world units wide (half of BLOCK_SIZE_MEDIUM=6)
  const halfW = ww / 2;

  ctx.fillStyle = color;
  ctx.fillRect(x, y, halfW, wh);
  ctx.strokeStyle = color.replace(/[\d.]+\)$/, '1)');
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, halfW, wh);
  // Faint outline of full block extent
  ctx.strokeStyle = color.replace(/[\d.]+\)$/, '0.3)');
  ctx.strokeRect(x, y, ww, wh);
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  xBlock: number, yBlock: number,
  ox: number, oy: number, zoom: number,
  color: string, emoji: string,
): void {
  const cx = xBlock * BS * zoom + ox;
  const cy = yBlock * BS * zoom + oy;
  const r = BS * zoom * 0.4;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = `${Math.max(10, r)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, cx, cy);
}

function drawTransitionZone(
  ctx: CanvasRenderingContext2D,
  t: EditorTransition,
  room: EditorRoomData,
  ox: number, oy: number, zoom: number,
  color: string,
  doorNumber: number,
): void {
  const DEPTH = 6;
  let xBlock: number, yBlock: number, wBlock: number, hBlock: number;
  if (t.direction === 'left' || t.direction === 'right') {
    const zoneX = t.depthBlock !== undefined
      ? t.depthBlock
      : (t.direction === 'left' ? 0 : room.widthBlocks - DEPTH);
    xBlock = zoneX; yBlock = t.positionBlock; wBlock = DEPTH; hBlock = t.openingSizeBlocks;
  } else {
    const zoneY = t.depthBlock !== undefined
      ? t.depthBlock
      : (t.direction === 'up' ? 0 : room.heightBlocks - DEPTH);
    xBlock = t.positionBlock; yBlock = zoneY; wBlock = t.openingSizeBlocks; hBlock = DEPTH;
  }

  drawBlockRect(ctx, xBlock, yBlock, wBlock, hBlock, ox, oy, zoom, color, 2);

  // Draw label with door number
  const cx = (xBlock + wBlock / 2) * BS * zoom + ox;
  const cy = (yBlock + hBlock / 2) * BS * zoom + oy;
  ctx.fillStyle = '#fff';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = t.targetRoomId ? `#${doorNumber} →${t.targetRoomId}` : `#${doorNumber} (unlinked)`;
  ctx.fillText(label, cx, cy);
}

/**
 * Draws the "WORLD EDITOR ON" indicator at the top of the screen.
 */
export function renderEditorIndicator(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  state?: EditorState,
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0,200,100,0.85)';
  ctx.font = 'bold 8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('WORLD EDITOR ON', canvasWidth / 2, 6);

  // Show rotation / flip state when Place tool is active and a block item is selected
  if (state !== null && state !== undefined &&
      state.activeTool === EditorTool.Place &&
      state.selectedPaletteItem !== null &&
      state.selectedPaletteItem.category === 'blocks') {
    const rampLabels = ['/', '\\', '⌐', '¬'];
    const item = state.selectedPaletteItem;
    let rotHint = '';
    if (item.isRampItem === 1) {
      const base = state.placementRotationSteps % 4;
      const ori = state.placementFlipH ? (base ^ 1) : base;
      rotHint = `Ramp:${rampLabels[ori]}`;
    } else if (item.isPlatformItem === 1) {
      const platformEdgeMap: readonly string[] = ['↑top', '→rgt', '↓btm', '←lft'];
      rotHint = `Plat:${platformEdgeMap[state.placementRotationSteps % 4]}`;
    } else {
      rotHint = `R${state.placementRotationSteps}`;
    }
    const flipHint = state.placementFlipH ? ' [F]' : '';
    ctx.fillStyle = 'rgba(200,255,200,0.75)';
    ctx.font = '7px monospace';
    ctx.fillText(`${rotHint}${flipHint}  [scroll]=rotate  [F]=flip`, canvasWidth / 2, 16);
  }
  ctx.restore();
}
