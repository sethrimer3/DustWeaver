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
import type { EditorState, EditorRoomData, EditorWall, EditorTransition } from './editorState';
import { EditorTool } from './editorState';
import { getPlacementPreview, evaluateBrushOperation } from './editorPlaceTool';
import { findFloorBlockRow, findCeilingBlockRow } from './editorHitTest';
import { anchorForMaterial } from './editorPixelMaterialTool';
import { getMaterialFootprintSize } from '../sim/pixelMaterials/pixelMaterialTypes';
import {
  getRectBrushPreview, getSquareBrushPreview,
  computeSingleTransitionPlacement, computeFillTransitionPlacement, computeRectTransitionPlacement,
} from './editorBrush';
import { getPlacementStatus } from './editorLayers';
import type { EditorRenderMask } from './editorRenderMask';
import {
  PREVIEW_COLOR, PREVIEW_RAMP_COLOR, PREVIEW_STAIRS_COLOR, PREVIEW_PLATFORM_COLOR, PREVIEW_PILLAR_HALF_COLOR,
  CURSOR_COLOR, SELECTION_BOX_COLOR, SELECTION_BOX_BORDER,
  CRUMBLE_VARIANT_CRACK_COLOR,
  SAVE_TOMB_FOOTPRINT_W_BLOCKS, SAVE_TOMB_FOOTPRINT_H_BLOCKS,
  SKILL_TOMB_FOOTPRINT_W_BLOCKS, SKILL_TOMB_FOOTPRINT_H_BLOCKS,
  getDirectionVector, buildElementTooltipId, buildElementTypeName,
  drawHoverTooltip, drawBlockRect, drawRampTriangle, drawStairsShape,
  drawPlatformLine, drawHalfPillarRect, drawMarker, drawObjectFootprint,
  drawTransitionZone,
} from './editorRendererHelpers';
import { loadImg, isSpriteReady } from '../render/imageCache';
import { THEME_BLOCK_SPRITE_URL } from './editorUIHelpers';

// ============================================================================
// Sprite animation tables for ghost placement preview
// ============================================================================

/**
 * Maps palette item IDs to one or more sprite URLs (public paths, same format
 * as `loadImg()`).  When multiple URLs are provided they are cycled as an idle
 * animation.
 */
const PLACEMENT_SPRITE_URLS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  enemy_rolling:         ['SPRITES/ENEMIES/goldenBlock/goldenBlock.png'],
  enemy_rock_elemental:  [
    'SPRITES/ENEMIES/earthElemental/earthElemental_head_deactivated.png',
    'SPRITES/ENEMIES/earthElemental/earthElemental_head_activated.png',
  ],
  enemy_beetle:          [
    'SPRITES/ENEMIES/goldenBeetle/goldenBeetle_walking.png',
    'SPRITES/ENEMIES/goldenBeetle/goldenBeetle_flying.png',
  ],
  enemy_radiant_tether:  [
    'SPRITES/ENEMIES/radiantTeather/radiantTether_flying.png',
    'SPRITES/ENEMIES/radiantTeather/radiantTether_attacking.png',
  ],
  save_tomb:             ['SPRITES/OBJECTS&TRIGGERS/INTERACTABLES&COLLECTABLES/saveTomb.png'],
  skill_tomb:            ['SPRITES/OBJECTS&TRIGGERS/INTERACTABLES&COLLECTABLES/skillTomb.png'],
  dust_container:        ['SPRITES/OBJECTS&TRIGGERS/INTERACTABLES&COLLECTABLES/dustContainer.png'],
  dust_container_piece:  ['SPRITES/OBJECTS&TRIGGERS/INTERACTABLES&COLLECTABLES/dustContainerShard.png'],
});

/** Milliseconds per animation frame for multi-sprite idle cycling. */
const ANIM_FRAME_MS = 800;

/** Ghost alpha for sprite previews. */
const SPRITE_GHOST_ALPHA = 0.55;

/** Ghost alpha for block tile previews. */
const BLOCK_GHOST_ALPHA = 0.45;

/**
 * Draws a sprite ghost at (xPx, yPx) sized (wPx × hPx).
 * When multiple URLs are provided, the frame is determined by performance.now().
 * Returns false if the sprite is not yet loaded.
 */
function drawSpriteGhost(
  ctx: CanvasRenderingContext2D,
  spriteUrls: readonly string[],
  xPx: number,
  yPx: number,
  wPx: number,
  hPx: number,
  alpha: number = SPRITE_GHOST_ALPHA,
): boolean {
  // Editor preview animations use wall-clock time intentionally — they are
  // cosmetic only and do not need to be deterministic or reproducible.
  const frameIndex = spriteUrls.length > 1
    ? Math.floor(performance.now() / ANIM_FRAME_MS) % spriteUrls.length
    : 0;
  const sprite = loadImg(spriteUrls[frameIndex]);
  if (!isSpriteReady(sprite)) return false;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, xPx, yPx, wPx, hPx);
  ctx.restore();
  return true;
}

/**
 * Draws the active block theme's sprite tiled across the given footprint.
 * Falls back silently when no sprite is available.
 */
function drawBlockSpriteGhost(
  ctx: CanvasRenderingContext2D,
  xBlock: number,
  yBlock: number,
  wBlock: number,
  hBlock: number,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
  themeId: string,
): void {
  const spriteUrl = THEME_BLOCK_SPRITE_URL[themeId];
  if (spriteUrl === undefined || spriteUrl.length === 0) return;
  const sprite = loadImg(spriteUrl);
  if (!isSpriteReady(sprite)) return;
  const tilePx = BLOCK_SIZE_SMALL * zoom;
  ctx.save();
  ctx.globalAlpha = BLOCK_GHOST_ALPHA;
  for (let row = 0; row < hBlock; row++) {
    for (let col = 0; col < wBlock; col++) {
      const sx = Math.round((xBlock + col) * tilePx + offsetXPx);
      const sy = Math.round((yBlock + row) * tilePx + offsetYPx);
      ctx.drawImage(sprite, sx, sy, Math.ceil(tilePx), Math.ceil(tilePx));
    }
  }
  ctx.restore();
}

// ============================================================================
// Placement preview (cursor ghost for the active Place tool item)
// ============================================================================

/**
 * Draws a blocked-placement treatment over the given pixel-space rect:
 * diagonal hatch fill (works at any zoom/resolution, unlike a thin dashed
 * line), a warning-orange/red outline (not relying on red/green alone), and
 * a small lock glyph. Used for every preview type — when the destination
 * layer itself is blocked, the WHOLE footprint (including multi-cell
 * brushes) is covered by one blocked overlay rather than per-cell styling.
 */
function drawBlockedPlacementOverlay(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = 'rgba(120,20,20,0.22)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,140,90,0.9)';
  ctx.lineWidth = 1;
  const step = Math.max(6, Math.min(14, w / 3));
  for (let d = -h; d < w; d += step) {
    ctx.beginPath();
    ctx.moveTo(x + d, y + h);
    ctx.lineTo(x + d + h, y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,120,70,0.95)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const s = Math.max(6, Math.min(14, Math.min(w, h) * 0.4));
  ctx.font = `${Math.round(s)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,235,225,0.95)';
  ctx.fillText('🚫', cx, cy);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

export function drawPlacementPreview(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  state: EditorState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  if (state.activeTool !== EditorTool.Place || state.selectedPaletteItem === null) return;

  const placementStatus = getPlacementStatus(state, () => {
    const op = evaluateBrushOperation(state);
    return op.validCount > 0 ? true : (op.reason ?? false);
  });

  // Pixel-material tool: highlight the exact footprint that will be painted
  // (a single native pixel for Sand 1x1, a snapped 2x2 block for Sand 2x2).
  if (state.selectedPaletteItem.isPixelMaterialItem === 1) {
    const material = state.selectedPaletteItem.pixelMaterialId ?? 1;
    const anchor = anchorForMaterial(
      Math.floor(state.cursorWorldX), Math.floor(state.cursorWorldY), material,
    );
    const footprint = getMaterialFootprintSize(material);
    const cellPx = Math.max(1, zoom);
    const x = anchor.x * zoom + offsetXPx;
    const y = anchor.y * zoom + offsetYPx;
    const wh = cellPx * footprint;
    if (!placementStatus.allowed) {
      drawBlockedPlacementOverlay(ctx, x, y, wh, wh);
      return;
    }
    ctx.fillStyle = 'rgba(255,230,150,0.55)';
    ctx.fillRect(x, y, wh, wh);
    // Thicker stroke for the larger footprint so it reads as a distinct
    // "bigger brush" cursor rather than just a scaled-up 1x1 highlight.
    ctx.strokeStyle = 'rgba(255,240,190,0.9)';
    ctx.lineWidth = footprint > 1 ? 2 : 1;
    ctx.strokeRect(x, y, wh, wh);
    return;
  }

  // Any other placement type: if the destination layer itself is blocked
  // (hidden/locked/solo/select-only), show the whole footprint as blocked
  // rather than reproducing the shape-accurate ghost below — this covers
  // brush modes (rect/3x3/5x5) as one blocked region too, since a blocked
  // layer blocks the entire brush operation, not per-cell.
  if (!placementStatus.allowed) {
    let wBlock = 1;
    let hBlock = 1;
    let xBlock = state.cursorBlockX;
    let yBlock = state.cursorBlockY;
    const itemPreview = getPlacementPreview(state);
    if (state.brushMode === 'rect' && state.brushRectStartBlockX !== null) {
      const rectPreview = getRectBrushPreview(
        state.cursorBlockX, state.cursorBlockY,
        state.brushRectStartBlockX, state.brushRectStartBlockY,
        itemPreview?.wBlock ?? 1, itemPreview?.hBlock ?? 1,
      );
      if (rectPreview !== null) {
        xBlock = rectPreview.x; yBlock = rectPreview.y; wBlock = rectPreview.w; hBlock = rectPreview.h;
      }
    } else if (state.brushMode === '3x3' || state.brushMode === '5x5') {
      const squarePreview = getSquareBrushPreview(
        state.brushMode, state.cursorBlockX, state.cursorBlockY,
        itemPreview?.wBlock ?? 1, itemPreview?.hBlock ?? 1,
      );
      if (squarePreview !== null) {
        xBlock = squarePreview.x; yBlock = squarePreview.y; wBlock = squarePreview.w; hBlock = squarePreview.h;
      }
    } else if (itemPreview !== null) {
      wBlock = itemPreview.wBlock;
      hBlock = itemPreview.hBlock;
    }
    const x = xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const y = yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const w = wBlock * BLOCK_SIZE_SMALL * zoom;
    const h = hBlock * BLOCK_SIZE_SMALL * zoom;
    if (w > 0 && h > 0) drawBlockedPlacementOverlay(ctx, x, y, w, h);
    return;
  }

  // Rect brush: show the selection rectangle while first click is pending.
  if (state.brushMode === 'rect' && state.brushRectStartBlockX !== null) {
    // Brush-tiled items (blocks/specialBlocks/liquids/ambient-light-blockers)
    // fill the rect with non-overlapping copies of their own footprint —
    // snap the outline to that true tiled area, not the raw drag box, so a
    // 2x2 block never shows a preview larger than what will actually place.
    const item = state.selectedPaletteItem;
    const isBrushable = item !== null && (
      item.category === 'blocks' ||
      item.category === 'specialBlocks' ||
      item.category === 'liquids' ||
      item.category === 'timeStop' ||
      (item.category === 'lighting' && item.isAmbientLightBlockerItem === 1)
    );
    const itemPreview = getPlacementPreview(state);
    const itemWBlock = isBrushable ? (itemPreview?.wBlock ?? 1) : 1;
    const itemHBlock = isBrushable ? (itemPreview?.hBlock ?? 1) : 1;
    const rectPreview = getRectBrushPreview(
      state.cursorBlockX,
      state.cursorBlockY,
      state.brushRectStartBlockX,
      state.brushRectStartBlockY,
      itemWBlock,
      itemHBlock,
    );
    if (rectPreview !== null && rectPreview.w > 0 && rectPreview.h > 0) {
      drawBlockRect(ctx, rectPreview.x, rectPreview.y, rectPreview.w, rectPreview.h,
        offsetXPx, offsetYPx, zoom, 'rgba(100,200,255,0.18)', 2);
      const rx = rectPreview.x * BLOCK_SIZE_SMALL * zoom + offsetXPx;
      const ry = rectPreview.y * BLOCK_SIZE_SMALL * zoom + offsetYPx;
      const rw = rectPreview.w * BLOCK_SIZE_SMALL * zoom;
      const rh = rectPreview.h * BLOCK_SIZE_SMALL * zoom;
      ctx.strokeStyle = 'rgba(100,200,255,0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }
  }

  // Square brush (3x3/5x5): outline the full painted area, scaled to the
  // selected item's own footprint — e.g. a 2x2 block on a 3x3 brush outlines
  // a 6x6 area, since the brush paints a 3x3 grid of non-overlapping 2x2
  // copies rather than nine single-cell-offset copies.
  if (state.brushMode === '3x3' || state.brushMode === '5x5') {
    const itemPreview = getPlacementPreview(state);
    const squarePreview = getSquareBrushPreview(
      state.brushMode,
      state.cursorBlockX,
      state.cursorBlockY,
      itemPreview?.wBlock ?? 1,
      itemPreview?.hBlock ?? 1,
    );
    if (squarePreview !== null) {
      drawBlockRect(ctx, squarePreview.x, squarePreview.y, squarePreview.w, squarePreview.h,
        offsetXPx, offsetYPx, zoom, 'rgba(100,200,255,0.12)', 1);
      const sx = squarePreview.x * BLOCK_SIZE_SMALL * zoom + offsetXPx;
      const sy = squarePreview.y * BLOCK_SIZE_SMALL * zoom + offsetYPx;
      const sw = squarePreview.w * BLOCK_SIZE_SMALL * zoom;
      const sh = squarePreview.h * BLOCK_SIZE_SMALL * zoom;
      ctx.strokeStyle = 'rgba(100,200,255,0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.setLineDash([]);
    }
  }

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

  if (item.isCrumbleBlockItem === 1 || (item.category === 'blocks' && state.pendingBlockPlacementModifier === 'cracked')) {
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

  if (item.isStairsItem === 1) {
    // Stairs preview — step rectangles with the current orientation
    const base = state.placementRotationSteps % 4;
    const stairsOri = (state.placementFlipH ? (base ^ 1) : base) as 0 | 1 | 2 | 3;
    const previewWall: EditorWall = {
      uid: -1,
      xBlock: state.cursorBlockX,
      yBlock: state.cursorBlockY,
      wBlock: preview.wBlock,
      hBlock: preview.hBlock,
      isPlatformFlag: 0,
      platformEdge: 0,
      stairsOrientation: stairsOri,
      isPillarHalfWidthFlag: 0,
    };
    drawStairsShape(ctx, previewWall, offsetXPx, offsetYPx, zoom, PREVIEW_STAIRS_COLOR, 2);
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

  if (item.isSmoothRampItem === 1) {
    // Smooth ramp preview — same triangle drawer as legacy ramps, stairs-identical collision.
    const base = state.placementRotationSteps % 4;
    const smoothRampOri = (state.placementFlipH ? (base ^ 1) : base) as 0 | 1 | 2 | 3;
    const previewWall: EditorWall = {
      uid: -1,
      xBlock: state.cursorBlockX,
      yBlock: state.cursorBlockY,
      wBlock: preview.wBlock,
      hBlock: preview.hBlock,
      isPlatformFlag: 0,
      platformEdge: 0,
      smoothRampOrientation: smoothRampOri,
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

  if (item.id === 'challenge_field' || item.id.endsWith('_gate')) {
    const xPx = state.cursorBlockX * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = state.cursorBlockY * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = (item.defaultWidthBlocks ?? 1) * BLOCK_SIZE_SMALL * zoom;
    const hPx = (item.defaultHeightBlocks ?? 1) * BLOCK_SIZE_SMALL * zoom;
    const gateStyle = item.id === 'enemy_gate' ? ['rgba(194,145,151,0.76)', 'X']
      : item.id === 'heart_gate' ? ['rgba(227,174,186,0.76)', 'H']
      : item.id === 'speed_gate' ? ['rgba(151,207,220,0.76)', '>']
      : ['rgba(220,196,125,0.76)', 'S'];
    ctx.fillStyle = item.id === 'challenge_field' ? 'rgba(155,70,255,0.30)' : gateStyle[0];
    ctx.fillRect(xPx, yPx, wPx, hPx);
    ctx.strokeStyle = item.id === 'challenge_field' ? '#c878ff' : '#ffd85a';
    ctx.lineWidth = 2;
    ctx.strokeRect(xPx, yPx, wPx, hPx);
    drawMarker(ctx, state.cursorBlockX + (item.defaultWidthBlocks ?? 1) * 0.5, state.cursorBlockY + (item.defaultHeightBlocks ?? 1) * 0.5, offsetXPx, offsetYPx, zoom, '#ffffff', item.id === 'challenge_field' ? 'C' : gateStyle[1]);
    return;
  }
  if (item.id === 'challenge_totem') {
    drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom, 'rgba(190,90,255,0.8)', 'C');
    return;
  }

  if (item.id === 'save_tomb') {
    const wPx = SAVE_TOMB_FOOTPRINT_W_BLOCKS * BLOCK_SIZE_SMALL * zoom;
    const hPx = SAVE_TOMB_FOOTPRINT_H_BLOCKS * BLOCK_SIZE_SMALL * zoom;
    const xPx = state.cursorBlockX * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = state.cursorBlockY * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY,
      SAVE_TOMB_FOOTPRINT_W_BLOCKS, SAVE_TOMB_FOOTPRINT_H_BLOCKS,
      offsetXPx, offsetYPx, zoom, 'rgba(212,168,75,0.20)', 2);
    const urls = PLACEMENT_SPRITE_URLS[item.id];
    if (urls !== undefined) {
      drawSpriteGhost(ctx, urls, xPx, yPx, wPx, hPx);
    } else {
      drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
        'rgba(212,168,75,0.5)', '⛩');
    }
    return;
  }

  if (item.id === 'enemy_slime_snail') {
    drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY, 1, 1,
      offsetXPx, offsetYPx, zoom, 'rgba(80,190,75,0.25)', 2);
    const cx = (state.cursorBlockX + 0.5) * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const cy = (state.cursorBlockY + 0.5) * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const side = state.placementRotationSteps % 4;
    const normals = [[0,-1],[1,0],[0,1],[-1,0]] as const;
    ctx.save();
    ctx.strokeStyle = '#b9f49b'; ctx.lineWidth = Math.max(1, zoom);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + normals[side][0] * 5 * zoom, cy + normals[side][1] * 5 * zoom); ctx.stroke();
    ctx.fillStyle = '#397f3d'; ctx.beginPath(); ctx.arc(cx, cy, 3 * zoom, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }

  if (item.id === 'skill_tomb') {
    const wPx = SKILL_TOMB_FOOTPRINT_W_BLOCKS * BLOCK_SIZE_SMALL * zoom;
    const hPx = SKILL_TOMB_FOOTPRINT_H_BLOCKS * BLOCK_SIZE_SMALL * zoom;
    const xPx = state.cursorBlockX * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = state.cursorBlockY * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY,
      SKILL_TOMB_FOOTPRINT_W_BLOCKS, SKILL_TOMB_FOOTPRINT_H_BLOCKS,
      offsetXPx, offsetYPx, zoom, 'rgba(120,80,220,0.20)', 2);
    const urls = PLACEMENT_SPRITE_URLS[item.id];
    if (urls !== undefined) {
      drawSpriteGhost(ctx, urls, xPx, yPx, wPx, hPx);
    } else {
      drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
        'rgba(120,80,220,0.55)', '✦');
    }
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
      offsetXPx, offsetYPx, zoom, 'rgba(220,70,70,0.20)', 2);
    const xPx = state.cursorBlockX * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = state.cursorBlockY * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = fp.wBlock * BLOCK_SIZE_SMALL * zoom;
    const hPx = fp.hBlock * BLOCK_SIZE_SMALL * zoom;
    const urls = PLACEMENT_SPRITE_URLS[item.id];
    if (urls === undefined || !drawSpriteGhost(ctx, urls, xPx, yPx, wPx, hPx)) {
      drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
        'rgba(220,70,70,0.55)', '⚔');
    }
    return;
  }

  if (item.isDustContainerItem === 1 || item.id === 'dust_container') {
    drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY, 1, 1,
      offsetXPx, offsetYPx, zoom, 'rgba(80,220,255,0.20)', 2);
    const xPx = state.cursorBlockX * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = state.cursorBlockY * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const tilePx = BLOCK_SIZE_SMALL * zoom;
    const urls = PLACEMENT_SPRITE_URLS['dust_container'];
    if (urls === undefined || !drawSpriteGhost(ctx, urls, xPx, yPx, tilePx, tilePx)) {
      drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
        'rgba(80,220,255,0.45)', '◈');
    }
    return;
  }

  if (item.isDustContainerPieceItem === 1 || item.id === 'dust_container_piece') {
    drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY, 1, 1,
      offsetXPx, offsetYPx, zoom, 'rgba(130,200,255,0.20)', 2);
    const xPx = state.cursorBlockX * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = state.cursorBlockY * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const tilePx = BLOCK_SIZE_SMALL * zoom;
    const urls = PLACEMENT_SPRITE_URLS['dust_container_piece'];
    if (urls === undefined || !drawSpriteGhost(ctx, urls, xPx, yPx, tilePx, tilePx)) {
      drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
        'rgba(130,200,255,0.45)', '◇');
    }
    return;
  }

  if (item.isDustBoostJarItem === 1 || item.id === 'dust_boost_jar') {
    drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY, 1, 1,
      offsetXPx, offsetYPx, zoom, 'rgba(200,100,255,0.25)', 2);
    drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
      'rgba(200,100,255,0.45)', '⬡');
    return;
  }

  if (item.id === 'room_transition') {
    const directionMap: ('right' | 'down' | 'left' | 'up')[] = ['right', 'down', 'left', 'up'];
    const direction = directionMap[state.placementRotationSteps % 4];

    // Mirror the same brush-mode dispatch placeAt() uses, so the preview
    // never shows different geometry than what a click would actually create.
    let placement;
    if (state.brushMode === 'rect' && state.brushRectStartBlockX !== null && state.brushRectStartBlockY !== null) {
      placement = computeRectTransitionPlacement(room, state.brushRectStartBlockX, state.brushRectStartBlockY, state.cursorBlockX, state.cursorBlockY);
    } else if (state.brushMode === 'fill') {
      placement = computeFillTransitionPlacement(room, state.cursorBlockX, state.cursorBlockY, direction);
    } else {
      placement = computeSingleTransitionPlacement(room, state.cursorBlockX, state.cursorBlockY, direction);
    }
    if (placement === null) return;

    const previewTransition: EditorTransition = {
      uid: -1,
      direction: placement.direction,
      xBlock: placement.xBlock,
      yBlock: placement.yBlock,
      openingSizeBlocks: placement.openingSizeBlocks,
      gradientWidthBlocks: placement.gradientWidthBlocks,
      targetRoomId: '',
      targetSpawnBlock: [3, 3],
      positionBlock: placement.positionBlock,
    };
    drawTransitionZone(ctx, previewTransition, room, offsetXPx, offsetYPx, zoom, PREVIEW_COLOR, 0, true);
    return;
  }

  // Generic block preview
  drawBlockRect(ctx, state.cursorBlockX, state.cursorBlockY,
    preview.wBlock, preview.hBlock, offsetXPx, offsetYPx, zoom, PREVIEW_COLOR, 2);
  // Overlay the current block theme sprite across the footprint
  if (item.category === 'blocks' && state.selectedBlockTheme !== undefined) {
    drawBlockSpriteGhost(
      ctx,
      state.cursorBlockX, state.cursorBlockY,
      preview.wBlock, preview.hBlock,
      offsetXPx, offsetYPx, zoom,
      state.selectedBlockTheme,
    );
  }
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
  mask: EditorRenderMask,
): void {
  // ── Always-visible editor infrastructure ──────────────────────────────────
  // Selection box (marquee), cursor highlight, delete-brush preview, and the
  // hover tooltip are core editing affordances, not authored content — they
  // are NEVER gated by any layer (including Metadata/Debug), regardless of
  // what's hidden. See the Metadata-vs-Debug doc comment on EditorRenderMask.

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

  // Delete tool: outline the square brush's erase area (3x3/5x5 are always
  // single-cell-stepped for delete, since deletion targets whatever occupies
  // each cell rather than a fixed-size placed item).
  if (state.activeTool === EditorTool.Delete && (state.brushMode === '3x3' || state.brushMode === '5x5')) {
    const squarePreview = getSquareBrushPreview(state.brushMode, state.cursorBlockX, state.cursorBlockY, 1, 1);
    if (squarePreview !== null) {
      const sx = squarePreview.x * BLOCK_SIZE_SMALL * zoom + offsetXPx;
      const sy = squarePreview.y * BLOCK_SIZE_SMALL * zoom + offsetYPx;
      const sw = squarePreview.w * BLOCK_SIZE_SMALL * zoom;
      const sh = squarePreview.h * BLOCK_SIZE_SMALL * zoom;
      ctx.fillStyle = 'rgba(255,80,80,0.12)';
      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = 'rgba(255,80,80,0.7)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.setLineDash([]);
    }
  }

  // Hover tooltip (Select tool only)
  if (state.activeTool === EditorTool.Select && state.hoverElement !== null) {
    const el = state.hoverElement;
    const tooltipId = buildElementTooltipId(el.type, el.uid);
    const tooltipType = buildElementTypeName(el.type, el.uid, room);
    const cursorXPx = state.cursorWorldX * zoom + offsetXPx;
    const cursorYPx = state.cursorWorldY * zoom + offsetYPx;
    drawHoverTooltip(ctx, tooltipId, tooltipType, cursorXPx, cursorYPx, canvasWidth, canvasHeight);
  }

  // Ambient light direction indicator (top-left corner arrow) — this is a
  // purely informational/structural-guide overlay (not a selection/placement
  // affordance), so it's the one thing in this function gated by Metadata.
  if (mask.isLayerVisible('editorMetadata') && room.ambientLightDirection && room.ambientLightDirection !== 'omni') {
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
