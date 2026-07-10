/**
 * Zone and environment editor overlay draw helpers.
 *
 * Extracted from editorOverlayDrawers.ts. Contains draw functions for:
 * liquid zones, crumble blocks, bounce pads, decorations, falling blocks,
 * ropes, dialogue triggers, and background blocks.
 *
 * Also exports the shared `IsElementSelected` helper type.
 *
 * Called by renderEditorOverlays via re-exports in editorOverlayDrawers.ts.
 */

import { BLOCK_SIZE_SMALL, BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import type { EditorState, EditorRoomData } from './editorState';
import { EditorTool } from './editorState';
import { ropeLineCrossesWall } from './editorHitTest';
import {
  ROPE_COLOR, ROPE_SELECTED, ROPE_PREVIEW_COLOR, ROPE_ANCHOR_COLOR, ROPE_INVALID_COLOR,
  CRUMBLE_VARIANT_CRACK_COLOR,
  DIALOGUE_TRIGGER_COLOR, DIALOGUE_TRIGGER_SELECTED,
  GUIDE_DUST_PATH_COLOR, GUIDE_DUST_PATH_SELECTED, GUIDE_DUST_POINT_COLOR,
  drawBlockRect, drawMarker,
} from './editorRendererHelpers';

/** Helper type: function that returns whether a room element is selected. */
export type IsElementSelected = (type: string, uid: number) => boolean;

// ============================================================================
// Liquid zones: water and lava
// ============================================================================

export function drawEditorLiquidZones(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  // Water zones
  for (const z of (room.waterZones ?? [])) {
    const sel = isSelected('waterZone', z.uid);
    const xPx = z.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = z.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = z.wBlock * BLOCK_SIZE_SMALL * zoom;
    const hPx = z.hBlock * BLOCK_SIZE_SMALL * zoom;
    ctx.fillStyle = sel ? 'rgba(80,160,255,0.30)' : 'rgba(60,120,220,0.18)';
    ctx.fillRect(xPx, yPx, wPx, hPx);
    ctx.strokeStyle = sel ? 'rgba(80,180,255,0.85)' : 'rgba(80,160,255,0.50)';
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(xPx, yPx, wPx, hPx);
    ctx.fillStyle = 'rgba(160,210,255,0.75)';
    ctx.font = `${Math.max(8, BLOCK_SIZE_SMALL * zoom * 0.7)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💧', xPx + wPx * 0.5, yPx + hPx * 0.5);
  }

  // Lava zones
  for (const z of (room.lavaZones ?? [])) {
    const sel = isSelected('lavaZone', z.uid);
    const xPx = z.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = z.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = z.wBlock * BLOCK_SIZE_SMALL * zoom;
    const hPx = z.hBlock * BLOCK_SIZE_SMALL * zoom;
    ctx.fillStyle = sel ? 'rgba(255,100,20,0.30)' : 'rgba(220,60,10,0.18)';
    ctx.fillRect(xPx, yPx, wPx, hPx);
    ctx.strokeStyle = sel ? 'rgba(255,120,30,0.85)' : 'rgba(220,90,20,0.50)';
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(xPx, yPx, wPx, hPx);
    ctx.fillStyle = 'rgba(255,180,60,0.75)';
    ctx.font = `${Math.max(8, BLOCK_SIZE_SMALL * zoom * 0.7)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔥', xPx + wPx * 0.5, yPx + hPx * 0.5);
  }
}

// ============================================================================
// Crumble blocks
// ============================================================================

export function drawEditorCrumbleBlocks(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  for (const b of (room.crumbleBlocks ?? [])) {
    const sel = isSelected('crumbleBlock', b.uid);
    const wBlocks = b.wBlock ?? 1;
    const hBlocks = b.hBlock ?? 1;
    const xPx = b.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = b.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = wBlocks * BLOCK_SIZE_SMALL * zoom;
    const hPx = hBlocks * BLOCK_SIZE_SMALL * zoom;

    // Block fill
    ctx.fillStyle = sel ? 'rgba(210,180,100,0.40)' : 'rgba(210,180,100,0.22)';
    if (b.rampOrientation !== undefined) {
      // Ramp triangle shape
      ctx.beginPath();
      switch (b.rampOrientation) {
        case 0: ctx.moveTo(xPx, yPx + hPx); ctx.lineTo(xPx + wPx, yPx + hPx); ctx.lineTo(xPx + wPx, yPx); break;
        case 1: ctx.moveTo(xPx, yPx + hPx); ctx.lineTo(xPx + wPx, yPx + hPx); ctx.lineTo(xPx, yPx); break;
        case 2: ctx.moveTo(xPx, yPx); ctx.lineTo(xPx + wPx, yPx); ctx.lineTo(xPx + wPx, yPx + hPx); break;
        case 3: ctx.moveTo(xPx, yPx); ctx.lineTo(xPx + wPx, yPx); ctx.lineTo(xPx, yPx + hPx); break;
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = sel ? 'rgba(220,160,50,0.90)' : 'rgba(200,150,60,0.55)';
      ctx.lineWidth = sel ? 2 : 1;
      ctx.stroke();
    } else {
      ctx.fillRect(xPx, yPx, wPx, hPx);
      ctx.strokeStyle = sel ? 'rgba(220,160,50,0.90)' : 'rgba(200,150,60,0.55)';
      ctx.lineWidth = sel ? 2 : 1;
      ctx.strokeRect(xPx, yPx, wPx, hPx);
    }

    // Crack overlay — zigzag geometry, color indicates elemental weakness
    const crackColor = CRUMBLE_VARIANT_CRACK_COLOR[b.variant ?? 'normal'];
    ctx.strokeStyle = crackColor;
    ctx.lineWidth = Math.max(1, zoom * 0.7);
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
  }
}

// ============================================================================
// Spikes
// ============================================================================

export function drawEditorSpikes(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  for (const sp of (room.spikes ?? [])) {
    const sel = isSelected('spike', sp.uid);
    const sizeBlocks = sp.size === '2x2' ? 2 : 1;
    const xPx = sp.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = sp.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = sizeBlocks * BLOCK_SIZE_SMALL * zoom;
    const hPx = sizeBlocks * BLOCK_SIZE_SMALL * zoom;
    const cx = xPx + wPx * 0.5;
    const cy = yPx + hPx * 0.5;

    const fillAlpha = sel ? 0.65 : 0.45;
    const strokeAlpha = sel ? 1.0 : 0.65;
    ctx.fillStyle = `rgba(160,20,20,${fillAlpha})`;
    ctx.strokeStyle = `rgba(220,60,60,${strokeAlpha})`;
    ctx.lineWidth = sel ? 2 : 1;

    ctx.beginPath();
    switch (sp.direction) {
      case 'up':
        ctx.moveTo(cx, yPx); ctx.lineTo(xPx, yPx + hPx); ctx.lineTo(xPx + wPx, yPx + hPx);
        break;
      case 'down':
        ctx.moveTo(cx, yPx + hPx); ctx.lineTo(xPx, yPx); ctx.lineTo(xPx + wPx, yPx);
        break;
      case 'left':
        ctx.moveTo(xPx, cy); ctx.lineTo(xPx + wPx, yPx); ctx.lineTo(xPx + wPx, yPx + hPx);
        break;
      case 'right':
        ctx.moveTo(xPx + wPx, cy); ctx.lineTo(xPx, yPx); ctx.lineTo(xPx, yPx + hPx);
        break;
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (sp.blockTheme !== undefined) {
      ctx.fillStyle = 'rgba(255,200,200,0.85)';
      ctx.font = `bold ${Math.max(7, zoom * 3.5)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(sp.blockTheme, cx, yPx + hPx + zoom * 5);
    }
  }
}

// ============================================================================
// Bounce pads
// ============================================================================

export function drawEditorBouncePads(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  for (const b of (room.bouncePads ?? [])) {
    const sel = isSelected('bouncePad', b.uid);
    const xPx = b.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = b.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = b.wBlock * BLOCK_SIZE_SMALL * zoom;
    const hPx = b.hBlock * BLOCK_SIZE_SMALL * zoom;

    const fillAlpha = sel ? 0.45 : 0.25;
    const strokeAlpha = sel ? 1.0 : 0.65;
    const fillColor = b.speedFactorIndex === 1
      ? `rgba(200,80,10,${fillAlpha})`
      : `rgba(140,50,5,${fillAlpha})`;
    const strokeColor = b.speedFactorIndex === 1
      ? `rgba(255,140,30,${strokeAlpha})`
      : `rgba(220,90,15,${strokeAlpha})`;

    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = sel ? 2 : 1;

    if (b.rampOrientation !== undefined) {
      ctx.beginPath();
      switch (b.rampOrientation) {
        case 0: ctx.moveTo(xPx, yPx + hPx); ctx.lineTo(xPx + wPx, yPx + hPx); ctx.lineTo(xPx + wPx, yPx); break;
        case 1: ctx.moveTo(xPx, yPx + hPx); ctx.lineTo(xPx + wPx, yPx + hPx); ctx.lineTo(xPx, yPx); break;
        case 2: ctx.moveTo(xPx, yPx); ctx.lineTo(xPx + wPx, yPx); ctx.lineTo(xPx + wPx, yPx + hPx); break;
        case 3: ctx.moveTo(xPx, yPx); ctx.lineTo(xPx + wPx, yPx); ctx.lineTo(xPx, yPx + hPx); break;
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillRect(xPx, yPx, wPx, hPx);
      ctx.strokeRect(xPx, yPx, wPx, hPx);
    }

    // Speed indicator dot
    const dotR = (b.speedFactorIndex === 1 ? 3 : 2) * zoom;
    const dotX = xPx + wPx * 0.5;
    const dotY = yPx + hPx * 0.5;
    ctx.fillStyle = b.speedFactorIndex === 1 ? 'rgba(255,200,50,0.90)' : 'rgba(255,110,20,0.75)';
    ctx.fillRect(dotX - dotR * 0.5, dotY - dotR * 0.5, dotR, dotR);
    ctx.fillStyle = 'rgba(255,180,60,0.85)';
    ctx.font = `bold ${Math.max(7, zoom * 3.5)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(b.speedFactorIndex === 1 ? '⟳100%' : '⟳50%', dotX, dotY + dotR + zoom * 3);
  }
}

export function drawEditorKineticBlocks(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  for (const kb of (room.kineticBlocks ?? [])) {
    const sel = isSelected('kineticBlock', kb.uid);
    const xPx = kb.xBlock * BLOCK_SIZE_MEDIUM * zoom + offsetXPx;
    const yPx = kb.yBlock * BLOCK_SIZE_MEDIUM * zoom + offsetYPx;
    const wPx = kb.wBlock * BLOCK_SIZE_MEDIUM * zoom;
    const hPx = kb.hBlock * BLOCK_SIZE_MEDIUM * zoom;

    const fillAlpha = sel ? 0.45 : 0.25;
    const strokeAlpha = sel ? 1.0 : 0.65;

    ctx.fillStyle = `rgba(30,80,200,${fillAlpha})`;
    ctx.strokeStyle = `rgba(80,160,255,${strokeAlpha})`;
    ctx.lineWidth = sel ? 2 : 1;

    ctx.fillRect(xPx, yPx, wPx, hPx);
    ctx.strokeRect(xPx, yPx, wPx, hPx);

    // Upward arrow label
    const cx = xPx + wPx * 0.5;
    const cy = yPx + hPx * 0.5;
    ctx.fillStyle = `rgba(150,210,255,${strokeAlpha})`;
    ctx.font = `bold ${Math.max(7, zoom * 3.5)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('↑KB', cx, cy + zoom * 3);
  }
}

export function drawEditorGrappleCarryBlocks(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const bs = BLOCK_SIZE_SMALL * zoom;
  for (const block of (room.grappleCarryBlocks ?? [])) {
    const sel = isSelected('grappleCarryBlock', block.uid);
    const xPx = block.xBlock * bs + offsetXPx;
    const yPx = block.yBlock * bs + offsetYPx;
    ctx.save();
    ctx.fillStyle = sel ? 'rgba(210,150,60,0.55)' : 'rgba(190,125,45,0.35)';
    ctx.strokeStyle = sel ? 'rgba(255,215,120,0.95)' : 'rgba(235,175,90,0.7)';
    ctx.lineWidth = sel ? 2 : 1;
    ctx.fillRect(xPx, yPx, bs, bs);
    ctx.strokeRect(xPx, yPx, bs, bs);
    ctx.fillStyle = sel ? 'rgba(255,240,180,0.95)' : 'rgba(255,220,140,0.75)';
    ctx.font = `bold ${Math.max(7, bs * 0.32)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GC', xPx + bs * 0.5, yPx + bs * 0.5);
    ctx.restore();
  }
}

export function drawEditorPhantasmalTiles(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const bs = BLOCK_SIZE_SMALL * zoom;
  for (const tile of (room.phantasmalTiles ?? [])) {
    const sel = isSelected('phantasmalTile', tile.uid);
    const xPx = tile.xBlock * bs + offsetXPx;
    const yPx = tile.yBlock * bs + offsetYPx;
    ctx.save();
    ctx.fillStyle = sel ? 'rgba(170,90,255,0.45)' : 'rgba(150,70,230,0.25)';
    ctx.strokeStyle = sel ? 'rgba(230,190,255,0.95)' : 'rgba(205,150,255,0.65)';
    ctx.lineWidth = sel ? 2 : 1;
    ctx.fillRect(xPx, yPx, bs, bs);
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(xPx, yPx, bs, bs);
    ctx.restore();
  }
}

/** Draws placed 1x1 pixel-material particles (native-pixel granularity, not block-snapped). */
export function drawEditorPixelMaterials(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const size = Math.max(1, zoom);
  for (const p of (room.pixelMaterials ?? [])) {
    const sel = isSelected('pixelMaterial', p.uid);
    const xPx = p.xPixel * zoom + offsetXPx;
    const yPx = p.yPixel * zoom + offsetYPx;
    ctx.fillStyle = sel ? '#f2e3a0' : '#d9c07a';
    ctx.fillRect(xPx, yPx, size, size);
  }
}

export function drawEditorEnvironmentItems(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  // Decorations (mushroom, glowGrass, vine)
  for (const d of (room.decorations ?? [])) {
    const sel = isSelected('decoration', d.uid);
    const emoji = d.kind === 'mushroom' ? '🍄' : d.kind === 'glowGrass' ? '🌿' : '🌱';
    const color = sel ? 'rgba(80,220,130,0.9)' : 'rgba(60,170,90,0.55)';
    drawMarker(ctx, d.xBlock, d.yBlock, offsetXPx, offsetYPx, zoom, color, emoji);
  }

  // Falling block tiles (standard, tough, sensitive)
  for (const fb of (room.fallingBlocks ?? [])) {
    const sel = isSelected('fallingBlock', fb.uid);
    const xPx = fb.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = fb.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const szPx = BLOCK_SIZE_SMALL * zoom;

    const fillColor =
      fb.variant === 'tough'     ? (sel ? 'rgba(60,100,200,0.55)' : 'rgba(50,90,180,0.30)') :
      fb.variant === 'sensitive' ? (sel ? 'rgba(210,60,40,0.55)'  : 'rgba(190,50,30,0.30)') :
                                   (sel ? 'rgba(200,170,20,0.55)' : 'rgba(180,150,15,0.30)');
    const strokeColor =
      fb.variant === 'tough'     ? (sel ? 'rgba(100,160,255,0.95)' : 'rgba(80,140,240,0.65)') :
      fb.variant === 'sensitive' ? (sel ? 'rgba(255,80,60,0.95)'   : 'rgba(220,60,40,0.65)') :
                                   (sel ? 'rgba(255,210,30,0.95)'  : 'rgba(220,190,20,0.65)');
    ctx.fillStyle = fillColor;
    ctx.fillRect(xPx, yPx, szPx, szPx);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(xPx, yPx, szPx, szPx);

    // Downward arrow indicator with variant suffix
    const cx = xPx + szPx * 0.5;
    const cy = yPx + szPx * 0.5;
    ctx.fillStyle = strokeColor;
    ctx.font = `bold ${Math.max(6, szPx * 0.55)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fb.variant === 'tough' ? '▼T' : fb.variant === 'sensitive' ? '▼S' : '▼C', cx, cy);
  }
}

// ============================================================================
// Ropes (placed segments + placement preview)
// ============================================================================

export function drawEditorRopes(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  state: EditorState,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  // Placed ropes
  for (const r of (room.ropes ?? [])) {
    const sel = isSelected('rope', r.uid);
    const lineColor = sel ? ROPE_SELECTED : ROPE_COLOR;
    const ax = r.anchorAXBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const ay = r.anchorAYBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const bx = r.anchorBXBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const by = r.anchorBYBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    ctx.save();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = sel ? 2.5 : 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ROPE_ANCHOR_COLOR;
    ctx.beginPath(); ctx.arc(ax, ay, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI * 2); ctx.fill();
    if (r.isAnchorBFixedFlag === 0) {
      ctx.strokeStyle = 'rgba(255,180,60,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // Rope placement preview: first anchor already placed, second follows cursor
  if (
    state.activeTool === EditorTool.Place &&
    state.selectedPaletteItem?.category === 'ropes' &&
    state.pendingRopeAnchorXBlock !== null
  ) {
    const ax = state.pendingRopeAnchorXBlock! * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const ay = state.pendingRopeAnchorYBlock! * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const bx = state.cursorBlockX * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const by = state.cursorBlockY * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const isBlocked = ropeLineCrossesWall(
      room,
      state.pendingRopeAnchorXBlock!,
      state.pendingRopeAnchorYBlock!,
      state.cursorBlockX,
      state.cursorBlockY,
    );
    const previewStroke = isBlocked ? ROPE_INVALID_COLOR : ROPE_PREVIEW_COLOR;
    const previewAnchor = isBlocked ? 'rgba(255, 100, 100, 0.7)' : ROPE_ANCHOR_COLOR;
    ctx.save();
    ctx.strokeStyle = previewStroke;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = previewAnchor;
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.arc(ax, ay, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

// ============================================================================
// Dialogue triggers
// ============================================================================

export function drawEditorDialogueTriggers(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const triggers = room.dialogueTriggers ?? [];
  if (triggers.length === 0) return;
  const bs = BLOCK_SIZE_SMALL * zoom;
  for (const dt of triggers) {
    const sel = isSelected('dialogueTrigger', dt.uid);
    const color = sel ? DIALOGUE_TRIGGER_SELECTED : DIALOGUE_TRIGGER_COLOR;
    const x = dt.xBlock * bs + offsetXPx;
    const y = dt.yBlock * bs + offsetYPx;
    const w = dt.wBlock * bs;
    const h = dt.hBlock * bs;
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = sel ? 'rgba(80, 220, 255, 0.9)' : 'rgba(80, 200, 255, 0.5)';
    ctx.lineWidth = sel ? 2 : 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    // Label
    ctx.fillStyle = sel ? 'rgba(200, 240, 255, 0.95)' : 'rgba(140, 210, 255, 0.7)';
    ctx.font = `${Math.max(8, Math.round(8 * zoom))}px monospace`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const label = dt.entries.length > 0 ? `💬 ${dt.entries.length}` : '💬 Dialogue';
    ctx.fillText(label, x + 3, y + 3);
    ctx.restore();
  }
}

// ============================================================================
// Background blocks (visual-only, no collision)
// ============================================================================

/** Teal fill for normal background blocks in the editor overlay. */
const BG_BLOCK_COLOR          = 'rgba(0, 200, 190, 0.20)';
const BG_BLOCK_SELECTED       = 'rgba(0, 240, 220, 0.35)';
/** Amber tint for light-blocking background blocks. */
const BG_BLOCK_LIGHT_COLOR    = 'rgba(210, 140, 0, 0.22)';
const BG_BLOCK_LIGHT_SELECTED = 'rgba(255, 190, 0, 0.40)';

export function drawEditorBackgroundBlocks(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const blocks = room.backgroundBlocks ?? [];
  if (blocks.length === 0) return;
  const bs = BLOCK_SIZE_SMALL * zoom;
  for (const b of blocks) {
    const sel = isSelected('backgroundBlock', b.uid);
    const isLightBlocking = b.isLightBlockingFlag === 1;
    const effectiveFillColor = isLightBlocking
      ? (sel ? BG_BLOCK_LIGHT_SELECTED : BG_BLOCK_LIGHT_COLOR)
      : (sel ? BG_BLOCK_SELECTED       : BG_BLOCK_COLOR);
    drawBlockRect(
      ctx,
      b.xBlock, b.yBlock, b.wBlock, b.hBlock,
      offsetXPx, offsetYPx, zoom,
      effectiveFillColor,
      sel ? 2 : 1,
    );
    ctx.save();
    ctx.strokeStyle = isLightBlocking
      ? (sel ? 'rgba(255, 200, 40, 0.9)' : 'rgba(200, 130, 0, 0.55)')
      : (sel ? 'rgba(0, 240, 220, 0.9)' : 'rgba(0, 190, 180, 0.55)');
    ctx.lineWidth = sel ? 2 : 1;
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(b.xBlock * bs + offsetXPx, b.yBlock * bs + offsetYPx, b.wBlock * bs, b.hBlock * bs);
    ctx.setLineDash([]);
    ctx.restore();
  }
}

// ============================================================================
// Guide dust paths
// ============================================================================

/**
 * Number of line segments used to approximate each Catmull-Rom spline segment
 * in the editor overlay. Higher values give smoother curves but cost more draw
 * calls; 12 is a good balance for the editor's 480×270 virtual canvas.
 */
const CATMULL_ROM_SAMPLE_STEPS = 12;

/**
 * Draw guide dust paths in the editor as golden Catmull-Rom spline overlays
 * with control point circles.
 */
export function drawEditorGuideDustPaths(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  state: EditorState,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const paths = room.guideDustPaths ?? [];
  if (paths.length === 0) return;

  for (const path of paths) {
    const pts = path.points;
    const bs = BLOCK_SIZE_SMALL;
    if (pts.length < 2) {
      if (pts.length === 0) continue;  // completely empty path — skip
      // Draw a lonely point
      const sel = state.selectedElements.some(e => e.type === 'guideDustPath' && e.uid === path.uid);
      ctx.save();
      ctx.fillStyle = sel ? GUIDE_DUST_PATH_SELECTED : GUIDE_DUST_POINT_COLOR;
      const r = Math.max(3, 4 * zoom);
      const px = pts[0].xBlock * bs * zoom + offsetXPx;
      const py = pts[0].yBlock * bs * zoom + offsetYPx;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }

    const isSel = state.selectedElements.some(e => e.type === 'guideDustPath' && e.uid === path.uid);
    const color = isSel ? GUIDE_DUST_PATH_SELECTED : GUIDE_DUST_PATH_COLOR;

    // Draw Catmull-Rom spline (sampled)
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = isSel ? 2.5 : 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();

    const STEPS = CATMULL_ROM_SAMPLE_STEPS;
    const n = pts.length;
    const segCount = path.loop ? n : n - 1;

    for (let seg = 0; seg < segCount; seg++) {
      const i0 = path.loop ? (seg - 1 + n) % n : Math.max(0, seg - 1);
      const i1 = seg % n;
      const i2 = path.loop ? (seg + 1) % n : Math.min(n - 1, seg + 1);
      const i3 = path.loop ? (seg + 2) % n : Math.min(n - 1, seg + 2);
      const x0 = pts[i0].xBlock * bs; const y0 = pts[i0].yBlock * bs;
      const x1 = pts[i1].xBlock * bs; const y1 = pts[i1].yBlock * bs;
      const x2 = pts[i2].xBlock * bs; const y2 = pts[i2].yBlock * bs;
      const x3 = pts[i3].xBlock * bs; const y3 = pts[i3].yBlock * bs;
      for (let step = 0; step <= STEPS; step++) {
        const t = step / STEPS;
        const t2 = t * t;
        const t3 = t2 * t;
        const x = 0.5 * ((2 * x1) + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3);
        const y = 0.5 * ((2 * y1) + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3);
        const px = x * zoom + offsetXPx;
        const py = y * zoom + offsetYPx;
        if (step === 0 && seg === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Draw control points
    const selPointIdx = isSel ? (state.guideDustPathSelectedPointIndex ?? null) : null;
    for (let i = 0; i < pts.length; i++) {
      const px = pts[i].xBlock * bs * zoom + offsetXPx;
      const py = pts[i].yBlock * bs * zoom + offsetYPx;
      const isSelPoint = selPointIdx === i;
      const r = Math.max(3, (isSelPoint ? 5 : 4) * zoom);
      ctx.save();
      ctx.fillStyle = isSelPoint ? GUIDE_DUST_PATH_SELECTED : GUIDE_DUST_POINT_COLOR;
      ctx.strokeStyle = isSel ? '#fff' : 'rgba(255,200,60,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Label index
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(7, 8 * zoom)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i), px, py);
      ctx.restore();
      // Show speed label if non-default
      if (isSel && pts[i].speed !== undefined && pts[i].speed !== 1.0) {
        ctx.save();
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.max(8, 10 * zoom)}px monospace`;
        ctx.fillText(`×${pts[i].speed.toFixed(1)}`, px + r + 2, py - r - 2);
        ctx.restore();
      }
    }
  }
}
