import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import type { EditorState } from './editorState';
import { EditorTool } from './editorState';
import { getRectBrushPreview } from './editorBrush';
import { getPlacementPreview } from './editorPlaceTool';

export interface EditorDragRect {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
}

/** Returns the block-space rectangle currently being dragged in the editor. */
export function getActiveEditorDragRect(state: EditorState): EditorDragRect | null {
  if (state.isSelectionBoxActive) {
    const xBlock = Math.min(state.selectionBoxStartBlockX, state.cursorBlockX);
    const yBlock = Math.min(state.selectionBoxStartBlockY, state.cursorBlockY);
    return {
      xBlock,
      yBlock,
      wBlock: Math.abs(state.cursorBlockX - state.selectionBoxStartBlockX) + 1,
      hBlock: Math.abs(state.cursorBlockY - state.selectionBoxStartBlockY) + 1,
    };
  }

  if (
    state.activeTool !== EditorTool.Place ||
    state.brushMode !== 'rect' ||
    state.brushRectStartBlockX === null ||
    state.brushRectStartBlockY === null
  ) {
    return null;
  }

  const item = state.selectedPaletteItem;
  const isBrushable = item !== null && (
    item.category === 'blocks' ||
    item.category === 'specialBlocks' ||
    item.category === 'liquids' ||
    item.category === 'timeStop' ||
    (item.category === 'lighting' && item.isAmbientLightBlockerItem === 1)
  );
  const preview = getPlacementPreview(state);
  const rect = getRectBrushPreview(
    state.cursorBlockX,
    state.cursorBlockY,
    state.brushRectStartBlockX,
    state.brushRectStartBlockY,
    isBrushable ? (preview?.wBlock ?? 1) : 1,
    isBrushable ? (preview?.hBlock ?? 1) : 1,
  );
  if (rect === null || rect.w <= 0 || rect.h <= 0) return null;
  return { xBlock: rect.x, yBlock: rect.y, wBlock: rect.w, hBlock: rect.h };
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontPx: number,
  paddingXPx: number,
  paddingYPx: number,
  rotationRad = 0,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotationRad);
  ctx.font = `bold ${fontPx}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(text).width + paddingXPx * 2;
  const height = fontPx + paddingYPx * 2;
  ctx.fillStyle = 'rgba(8, 16, 24, 0.9)';
  ctx.strokeStyle = 'rgba(100, 210, 255, 0.95)';
  ctx.lineWidth = Math.max(1, fontPx / 10);
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.strokeRect(-width / 2, -height / 2, width, height);
  ctx.fillStyle = '#e8f8ff';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * Draws dimension labels directly on the device-resolution canvas, after the
 * low-resolution game canvas has been upscaled.
 */
export function renderEditorDragDimensionsHighResolution(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  virtualWidthPx: number,
  virtualHeightPx: number,
  state: EditorState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const rect = getActiveEditorDragRect(state);
  if (rect === null) return;

  const scaleX = canvas.width / virtualWidthPx;
  const scaleY = canvas.height / virtualHeightPx;
  const left = (rect.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx) * scaleX;
  const top = (rect.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx) * scaleY;
  const right = left + rect.wBlock * BLOCK_SIZE_SMALL * zoom * scaleX;
  const bottom = top + rect.hBlock * BLOCK_SIZE_SMALL * zoom * scaleY;

  const cssWidth = canvas.getBoundingClientRect().width || canvas.width;
  const deviceScale = canvas.width / cssWidth;
  const fontPx = 13 * deviceScale;
  const gapPx = 13 * deviceScale;
  const padX = 5 * deviceScale;
  const padY = 3 * deviceScale;
  const widthText = `${rect.wBlock}`;
  const heightText = `${rect.hBlock}`;

  drawLabel(ctx, widthText, (left + right) / 2, top - gapPx, fontPx, padX, padY);
  drawLabel(ctx, widthText, (left + right) / 2, bottom + gapPx, fontPx, padX, padY);
  drawLabel(ctx, heightText, left - gapPx, (top + bottom) / 2, fontPx, padX, padY, -Math.PI / 2);
  drawLabel(ctx, heightText, right + gapPx, (top + bottom) / 2, fontPx, padX, padY, Math.PI / 2);
}
