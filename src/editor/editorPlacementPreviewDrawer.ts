/**
 * editorPlacementPreviewDrawer.ts — Placement preview and UI overlay draw
 * helpers for the editor canvas.
 *
 * Contains two functions extracted from editorOverlayDrawers.ts:
 *   • drawPlacementPreview  — cursor ghost showing the active Place-tool item
 *   • drawEditorUIOverlays  — selection box, cursor highlight, hover tooltip,
 *                             and ambient light direction indicator
 *
 * Called by renderEditorOverlays in editorRenderer.ts.
 */

import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import type { EditorState, EditorRoomData, EditorWall } from './editorState';
import { EditorTool } from './editorState';
import { getPlacementPreview } from './editorPlaceTool';
import { findFloorBlockRow, findCeilingBlockRow } from './editorHitTest';
import {
  PREVIEW_COLOR, PREVIEW_RAMP_COLOR, PREVIEW_PLATFORM_COLOR, PREVIEW_PILLAR_HALF_COLOR,
  CURSOR_COLOR, SELECTION_BOX_COLOR, SELECTION_BOX_BORDER,
  CRUMBLE_VARIANT_CRACK_COLOR,
  SAVE_TOMB_FOOTPRINT_W_BLOCKS, SAVE_TOMB_FOOTPRINT_H_BLOCKS,
  SKILL_TOMB_FOOTPRINT_W_BLOCKS, SKILL_TOMB_FOOTPRINT_H_BLOCKS,
  getDirectionVector, buildElementTooltipId, buildElementTypeName,
  drawHoverTooltip, drawBlockRect, drawRampTriangle,
  drawPlatformLine, drawHalfPillarRect, drawMarker, drawObjectFootprint,
} from './editorRendererHelpers';

// ============================================================================
// Placement preview (cursor ghost for the active Place tool item)
// ============================================================================

export function drawPlacementPreview(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  state: EditorState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  if (state.activeTool !== EditorTool.Place || state.selectedPaletteItem === null) return;

  const preview = getPlacementPreview(state);
  if (preview === null) return;

  const item = state.selectedPaletteItem;

  if (item.id === 'decoration_mushroom' || item.id === 'decoration_glowgrass' || item.id === 'decoration_vine') {
    // Decoration preview: snap to terrain surface
    const isVine = item.id === 'decoration_vine';
    const targetRow = isVine
      ? findCeilingBlockRow(room, state.cursorBlockX, state.cursorBlockY)
      : findFloorBlockRow(room, state.cursorBlockX, state.cursorBlockY);
    if (targetRow !== null) {
      const emoji = item.id === 'decoration_mushroom' ? '🍄' : item.id === 'decoration_glowgrass' ? '🌿' : '🌱';
      drawBlockRect(ctx, state.cursorBlockX, targetRow, 1, 1, offsetXPx, offsetYPx, zoom, 'rgba(80,220,130,0.2)', 1);
      drawMarker(ctx, state.cursorBlockX, targetRow, offsetXPx, offsetYPx, zoom, 'rgba(80,220,130,0.5)', emoji);
    } else {
      // No valid surface — warning
      drawBlockRect(ctx, state.cursorBlockX, state.cursorBlockY, 1, 1, offsetXPx, offsetYPx, zoom, 'rgba(255,60,60,0.2)', 1);
    }
    return;
  }

  if (item.isCrumbleBlockItem === 1) {
    // Crumble block preview — block shape + crack overlay
    const xPx = state.cursorBlockX * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = state.cursorBlockY * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = preview.wBlock * BLOCK_SIZE_SMALL * zoom;
    const hPx = preview.hBlock * BLOCK_SIZE_SMALL * zoom;
    if (item.isRampItem === 1) {
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
      drawRampTriangle(ctx, previewWall, offsetXPx, offsetYPx, zoom, 'rgba(210,180,100,0.30)', 2);
    } else {
      drawBlockRect(ctx, state.cursorBlockX, state.cursorBlockY,
        preview.wBlock, preview.hBlock, offsetXPx, offsetYPx, zoom, 'rgba(210,180,100,0.30)', 2);
    }
    const crackColor = CRUMBLE_VARIANT_CRACK_COLOR[state.pendingCrumbleVariant ?? 'normal'];
    ctx.strokeStyle = crackColor;
    ctx.lineWidth = Math.max(1, zoom * 0.7);
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    const cx = xPx + wPx * 0.5;
    const cy = yPx + hPx * 0.5;
    ctx.moveTo(cx - wPx * 0.15, yPx + hPx * 0.1);
    ctx.lineTo(cx + wPx * 0.05, cy - hPx * 0.1);
    ctx.lineTo(cx - wPx * 0.05, cy + hPx * 0.1);
    ctx.lineTo(cx + wPx * 0.15, yPx + hPx * 0.9);
    ctx.moveTo(cx + wPx * 0.05, cy - hPx * 0.1);
    ctx.lineTo(cx + wPx * 0.25, cy - hPx * 0.25);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
    return;
  }

  if (item.isBouncePadItem === 1) {
    // Bounce pad preview — orange outline with optional ramp shape
    const bpFillColor = item.bouncePadSpeedFactorIndex === 1 ? 'rgba(200,80,10,0.28)' : 'rgba(140,50,5,0.22)';
    const bpStrokeColor = item.bouncePadSpeedFactorIndex === 1 ? 'rgba(255,140,30,0.70)' : 'rgba(220,90,15,0.55)';
    if (item.isRampItem === 1) {
      const base2 = state.placementRotationSteps % 4;
      const rampOri2 = (state.placementFlipH ? (base2 ^ 1) : base2) as 0 | 1 | 2 | 3;
      const bpXPx = state.cursorBlockX * BLOCK_SIZE_SMALL * zoom + offsetXPx;
      const bpYPx = state.cursorBlockY * BLOCK_SIZE_SMALL * zoom + offsetYPx;
      const bpWPx = preview.wBlock * BLOCK_SIZE_SMALL * zoom;
      const bpHPx = preview.hBlock * BLOCK_SIZE_SMALL * zoom;
      ctx.fillStyle = bpFillColor;
      ctx.strokeStyle = bpStrokeColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      switch (rampOri2) {
        case 0: ctx.moveTo(bpXPx, bpYPx + bpHPx); ctx.lineTo(bpXPx + bpWPx, bpYPx + bpHPx); ctx.lineTo(bpXPx + bpWPx, bpYPx); break;
        case 1: ctx.moveTo(bpXPx, bpYPx + bpHPx); ctx.lineTo(bpXPx + bpWPx, bpYPx + bpHPx); ctx.lineTo(bpXPx, bpYPx); break;
        case 2: ctx.moveTo(bpXPx, bpYPx); ctx.lineTo(bpXPx + bpWPx, bpYPx); ctx.lineTo(bpXPx + bpWPx, bpYPx + bpHPx); break;
        case 3: ctx.moveTo(bpXPx, bpYPx); ctx.lineTo(bpXPx + bpWPx, bpYPx); ctx.lineTo(bpXPx, bpYPx + bpHPx); break;
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      drawBlockRect(ctx, state.cursorBlockX, state.cursorBlockY,
        preview.wBlock, preview.hBlock, offsetXPx, offsetYPx, zoom, bpFillColor, 2);
      const bpXPx = state.cursorBlockX * BLOCK_SIZE_SMALL * zoom + offsetXPx;
      const bpYPx = state.cursorBlockY * BLOCK_SIZE_SMALL * zoom + offsetYPx;
      const bpWPx = preview.wBlock * BLOCK_SIZE_SMALL * zoom;
      const bpHPx = preview.hBlock * BLOCK_SIZE_SMALL * zoom;
      ctx.strokeStyle = bpStrokeColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(bpXPx, bpYPx, bpWPx, bpHPx);
    }
    return;
  }

  if (item.isRampItem === 1) {
    // Ramp preview — triangle with current orientation
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
    return;
  }

  if (item.isPlatformItem === 1) {
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
    return;
  }

  if (item.isPillarHalfWidthItem === 1) {
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
    return;
  }

  if (item.id === 'save_tomb') {
    drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY,
      SAVE_TOMB_FOOTPRINT_W_BLOCKS, SAVE_TOMB_FOOTPRINT_H_BLOCKS,
      offsetXPx, offsetYPx, zoom, 'rgba(212,168,75,0.35)', 2);
    drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
      'rgba(212,168,75,0.5)', '⛩');
    return;
  }

  if (item.id === 'skill_tomb') {
    drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY,
      SKILL_TOMB_FOOTPRINT_W_BLOCKS, SKILL_TOMB_FOOTPRINT_H_BLOCKS,
      offsetXPx, offsetYPx, zoom, 'rgba(120,80,220,0.35)', 2);
    drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
      'rgba(120,80,220,0.55)', '✦');
    return;
  }

  if (item.id === 'enemy_rolling' || item.id === 'enemy_beetle' || item.id === 'enemy_rock_elemental' || item.id === 'enemy_radiant_tether') {
    const footprintByItemId: Record<string, { wBlock: number; hBlock: number }> = {
      enemy_rolling: { wBlock: 2, hBlock: 2 },
      enemy_beetle: { wBlock: 2, hBlock: 1 },
      enemy_rock_elemental: { wBlock: 3, hBlock: 3 },
      enemy_radiant_tether: { wBlock: 3, hBlock: 3 },
    };
    const fp = footprintByItemId[item.id];
    drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY,
      fp.wBlock, fp.hBlock,
      offsetXPx, offsetYPx, zoom, 'rgba(220,70,70,0.35)', 2);
    drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
      'rgba(220,70,70,0.55)', '⚔');
    return;
  }

  if (item.isDustContainerItem === 1 || item.id === 'dust_container') {
    drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY, 1, 1,
      offsetXPx, offsetYPx, zoom, 'rgba(80,220,255,0.25)', 2);
    drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
      'rgba(80,220,255,0.45)', '◈');
    return;
  }

  if (item.isDustContainerPieceItem === 1 || item.id === 'dust_container_piece') {
    drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY, 1, 1,
      offsetXPx, offsetYPx, zoom, 'rgba(130,200,255,0.25)', 2);
    drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
      'rgba(130,200,255,0.45)', '◇');
    return;
  }

  if (item.isDustBoostJarItem === 1 || item.id === 'dust_boost_jar') {
    drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY, 1, 1,
      offsetXPx, offsetYPx, zoom, 'rgba(200,100,255,0.25)', 2);
    drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
      'rgba(200,100,255,0.45)', '⬡');
    return;
  }

  // Generic block preview
  drawBlockRect(ctx, state.cursorBlockX, state.cursorBlockY,
    preview.wBlock, preview.hBlock, offsetXPx, offsetYPx, zoom, PREVIEW_COLOR, 2);
}

// ============================================================================
// UI overlays: selection box, cursor, hover tooltip, ambient light direction
// ============================================================================

export function drawEditorUIOverlays(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  state: EditorState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  // Selection box
  if (state.isSelectionBoxActive) {
    const x1 = Math.min(state.selectionBoxStartBlockX, state.cursorBlockX);
    const y1 = Math.min(state.selectionBoxStartBlockY, state.cursorBlockY);
    const x2 = Math.max(state.selectionBoxStartBlockX, state.cursorBlockX);
    const y2 = Math.max(state.selectionBoxStartBlockY, state.cursorBlockY);
    const sx = x1 * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const sy = y1 * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const sw = (x2 - x1 + 1) * BLOCK_SIZE_SMALL * zoom;
    const sh = (y2 - y1 + 1) * BLOCK_SIZE_SMALL * zoom;
    ctx.fillStyle = SELECTION_BOX_COLOR;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = SELECTION_BOX_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(sx, sy, sw, sh);
  }

  // Cursor highlight
  drawBlockRect(ctx, state.cursorBlockX, state.cursorBlockY, 1, 1,
    offsetXPx, offsetYPx, zoom, CURSOR_COLOR, 1);

  // Hover tooltip (Select tool only)
  if (state.activeTool === EditorTool.Select && state.hoverElement !== null) {
    const el = state.hoverElement;
    const tooltipId = buildElementTooltipId(el.type, el.uid);
    const tooltipType = buildElementTypeName(el.type, el.uid, room);
    const cursorXPx = state.cursorWorldX * zoom + offsetXPx;
    const cursorYPx = state.cursorWorldY * zoom + offsetYPx;
    drawHoverTooltip(ctx, tooltipId, tooltipType, cursorXPx, cursorYPx, canvasWidth, canvasHeight);
  }

  // Ambient light direction indicator (top-left corner arrow)
  if (room.ambientLightDirection && room.ambientLightDirection !== 'omni') {
    const dir = room.ambientLightDirection;
    const [dx, dy] = getDirectionVector(dir);
    const arrowLen = 16;
    const startX = 12;
    const startY = 12;
    const endX = startX + dx * arrowLen;
    const endY = startY + dy * arrowLen;
    ctx.strokeStyle = 'rgba(255, 220, 120, 0.9)';
    ctx.fillStyle = 'rgba(255, 220, 120, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    const headLen = 5;
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - headLen * Math.cos(angle - Math.PI / 6), endY - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - headLen * Math.cos(angle + Math.PI / 6), endY - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
    ctx.font = '10px monospace';
    ctx.fillText(dir, endX + 4, endY + 4);
  }
}
