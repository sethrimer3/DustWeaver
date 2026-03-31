/**
 * Editor renderer — draws overlays for grid, placement preview,
 * selection highlights, transition zones, enemy markers, and
 * other editor visual feedback on the 2D canvas.
 */

import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { EditorState, EditorRoomData, EditorTransition } from './editorState';
import { EditorTool } from './editorState';
import { getPlacementPreview } from './editorTools';

const GRID_COLOR = 'rgba(255,255,255,0.06)';
const WALL_HIGHLIGHT = 'rgba(100,200,255,0.3)';
const WALL_SELECTED = 'rgba(0,200,255,0.6)';
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
const CURSOR_COLOR = 'rgba(255,255,255,0.4)';

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

  // ── Grid ─────────────────────────────────────────────────────────────────
  drawGrid(ctx, room, offsetXPx, offsetYPx, zoom, canvasWidth, canvasHeight);

  // ── Interior walls ────────────────────────────────────────────────────────
  for (const w of room.interiorWalls) {
    const isSelected = state.selectedElement?.type === 'wall' && state.selectedElement.uid === w.uid;
    drawBlockRect(ctx, w.xBlock, w.yBlock, w.wBlock, w.hBlock, offsetXPx, offsetYPx, zoom,
      isSelected ? WALL_SELECTED : WALL_HIGHLIGHT, isSelected ? 2 : 1);
  }

  // ── Enemies ──────────────────────────────────────────────────────────────
  for (const e of room.enemies) {
    const isSelected = state.selectedElement?.type === 'enemy' && state.selectedElement.uid === e.uid;
    drawMarker(ctx, e.xBlock, e.yBlock, offsetXPx, offsetYPx, zoom,
      isSelected ? ENEMY_SELECTED : ENEMY_COLOR, e.isFlyingEyeFlag === 1 ? '👁' : '⚔');
  }

  // ── Transitions ──────────────────────────────────────────────────────────
  for (const t of room.transitions) {
    const isSelected = state.selectedElement?.type === 'transition' && state.selectedElement.uid === t.uid;
    const isLinkSource = state.isLinkingTransition && state.linkSourceTransitionUid === t.uid;
    const isLinkCandidate = state.isLinkingTransition && state.linkSourceTransitionUid !== t.uid;
    let color = TRANSITION_COLOR;
    if (isLinkSource) color = TRANSITION_LINK_SOURCE;
    else if (isLinkCandidate) color = TRANSITION_LINK_CANDIDATE;
    else if (isSelected) color = TRANSITION_SELECTED;
    drawTransitionZone(ctx, t, room, offsetXPx, offsetYPx, zoom, color);
  }

  // ── Player spawn ─────────────────────────────────────────────────────────
  {
    const isSelected = state.selectedElement?.type === 'playerSpawn';
    drawMarker(ctx, room.playerSpawnBlock[0], room.playerSpawnBlock[1], offsetXPx, offsetYPx, zoom,
      isSelected ? SPAWN_SELECTED : SPAWN_COLOR, '🏠');
  }

  // ── Skill tombs ─────────────────────────────────────────────────────────
  for (const s of room.skillTombs) {
    const isSelected = state.selectedElement?.type === 'skillTomb' && state.selectedElement.uid === s.uid;
    drawMarker(ctx, s.xBlock, s.yBlock, offsetXPx, offsetYPx, zoom,
      isSelected ? TOMB_SELECTED : TOMB_COLOR, '⛩');
  }

  // ── Placement preview ────────────────────────────────────────────────────
  if (state.activeTool === EditorTool.Place && state.selectedPaletteItem !== null) {
    const preview = getPlacementPreview(state);
    if (preview !== null) {
      drawBlockRect(ctx, state.cursorBlockX, state.cursorBlockY,
        preview.wBlock, preview.hBlock, offsetXPx, offsetYPx, zoom, PREVIEW_COLOR, 2);
    }
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
): void {
  let xBlock: number, yBlock: number, wBlock: number, hBlock: number;
  if (t.direction === 'left') {
    xBlock = -1; yBlock = t.positionBlock; wBlock = 2; hBlock = t.openingSizeBlocks;
  } else if (t.direction === 'right') {
    xBlock = room.widthBlocks - 1; yBlock = t.positionBlock; wBlock = 2; hBlock = t.openingSizeBlocks;
  } else if (t.direction === 'up') {
    xBlock = t.positionBlock; yBlock = -1; wBlock = t.openingSizeBlocks; hBlock = 2;
  } else {
    xBlock = t.positionBlock; yBlock = room.heightBlocks - 1; wBlock = t.openingSizeBlocks; hBlock = 2;
  }

  drawBlockRect(ctx, xBlock, yBlock, wBlock, hBlock, ox, oy, zoom, color, 2);

  // Draw label
  const cx = (xBlock + wBlock / 2) * BS * zoom + ox;
  const cy = (yBlock + hBlock / 2) * BS * zoom + oy;
  ctx.fillStyle = '#fff';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = t.targetRoomId ? `→${t.targetRoomId}` : '(unlinked)';
  ctx.fillText(label, cx, cy);
}

/**
 * Draws the "WORLD EDITOR ON" indicator at the top of the screen.
 */
export function renderEditorIndicator(ctx: CanvasRenderingContext2D, canvasWidth: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0,200,100,0.85)';
  ctx.font = 'bold 8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('WORLD EDITOR ON', canvasWidth / 2, 6);
  ctx.restore();
}
