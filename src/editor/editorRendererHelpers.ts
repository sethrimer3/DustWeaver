/**
 * editorRendererHelpers.ts — Drawing primitives and label helpers for the
 * editor overlay renderer.
 *
 * Contains all color constants, footprint constants, and the private helper
 * functions used by `renderEditorOverlays` in `editorRenderer.ts`.
 * Keeping these separate lets the main file focus on the high-level draw order
 * without being cluttered by low-level geometry utilities.
 *
 * Tooltip/label helpers live in editorElementLabels.ts (re-exported below).
 */

import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import type { CrumbleVariant, EditorRoomData, EditorTransition, EditorWall, AmbientLightDirection, EditorEnemy } from './editorState';
import { getTransitionEditorHitbox } from './editorHitTest';

export { buildElementTooltipId, buildElementTypeName, drawHoverTooltip } from './editorElementLabels';

// ── Color constants ──────────────────────────────────────────────────────────

export const GRID_COLOR = 'rgba(255,255,255,0.06)';
export const WALL_HIGHLIGHT = 'rgba(100,200,255,0.3)';
export const WALL_SELECTED = 'rgba(0,200,255,0.6)';
export const PLATFORM_HIGHLIGHT = 'rgba(255,200,50,0.35)';
export const PLATFORM_SELECTED = 'rgba(255,200,50,0.8)';
export const RAMP_HIGHLIGHT = 'rgba(120,220,120,0.4)';
export const RAMP_SELECTED = 'rgba(80,255,80,0.8)';
export const PILLAR_HALF_HIGHLIGHT = 'rgba(180,130,255,0.45)';
export const PILLAR_HALF_SELECTED = 'rgba(180,100,255,0.9)';
export const ENEMY_COLOR = 'rgba(255,80,80,0.5)';
export const ENEMY_SELECTED = 'rgba(255,80,80,0.9)';
export const TRANSITION_COLOR = 'rgba(80,255,80,0.35)';
export const TRANSITION_SELECTED = 'rgba(80,255,80,0.8)';
export const SECRET_DOOR_COLOR = 'rgba(160,80,255,0.35)';
export const SECRET_DOOR_SELECTED = 'rgba(160,80,255,0.8)';
export const TRANSITION_LINK_SOURCE = 'rgba(255,255,0,0.7)';
export const TRANSITION_LINK_CANDIDATE = 'rgba(0,255,200,0.5)';
export const SPAWN_COLOR = 'rgba(255,220,50,0.5)';
export const SPAWN_SELECTED = 'rgba(255,220,50,0.9)';
export const CAMPAIGN_SPAWN_COLOR = 'rgba(255,200,30,0.75)';
export const CAMPAIGN_SPAWN_SELECTED = 'rgba(255,220,60,1.0)';
export const TOMB_COLOR = 'rgba(212,168,75,0.5)';
export const TOMB_SELECTED = 'rgba(212,168,75,0.9)';
export const SKILL_TOMB_COLOR = 'rgba(120,80,220,0.55)';
export const SKILL_TOMB_SELECTED = 'rgba(160,120,255,0.9)';
export const PREVIEW_COLOR = 'rgba(0,200,255,0.25)';
export const PREVIEW_RAMP_COLOR = 'rgba(80,255,80,0.35)';
export const PREVIEW_PLATFORM_COLOR = 'rgba(255,200,50,0.4)';
export const PREVIEW_PILLAR_HALF_COLOR = 'rgba(180,130,255,0.35)';
export const CURSOR_COLOR = 'rgba(255,255,255,0.4)';
export const SELECTION_BOX_COLOR = 'rgba(100,200,255,0.25)';
export const SELECTION_BOX_BORDER = 'rgba(100,200,255,0.7)';
export const GRASSHOPPER_COLOR = 'rgba(100,200,100,0.20)';
export const GRASSHOPPER_SELECTED = 'rgba(100,220,100,0.45)';
export const FIREFLY_COLOR = 'rgba(255,220,60,0.20)';
export const FIREFLY_SELECTED = 'rgba(255,230,80,0.45)';

export const DUST_CONTAINER_COLOR    = 'rgba(80,220,255,0.50)';
export const DUST_CONTAINER_SELECTED = 'rgba(80,220,255,0.90)';
export const DUST_CONTAINER_PIECE_COLOR    = 'rgba(130,200,255,0.45)';
export const DUST_CONTAINER_PIECE_SELECTED = 'rgba(130,220,255,0.85)';
export const DUST_BOOST_JAR_COLOR    = 'rgba(200,100,255,0.45)';
export const DUST_BOOST_JAR_SELECTED = 'rgba(220,130,255,0.90)';
export const DUST_SWARM_COLOR    = 'rgba(255,180,60,0.50)';
export const DUST_SWARM_SELECTED = 'rgba(255,200,80,0.92)';

export const ROPE_COLOR = 'rgba(180, 140, 80, 0.7)';
export const ROPE_SELECTED = 'rgba(220, 180, 100, 0.95)';
export const DIALOGUE_TRIGGER_COLOR    = 'rgba(80, 200, 255, 0.22)';
export const DIALOGUE_TRIGGER_SELECTED = 'rgba(80, 220, 255, 0.55)';
export const ROPE_PREVIEW_COLOR = 'rgba(180, 140, 80, 0.4)';
export const ROPE_ANCHOR_COLOR = 'rgba(255, 200, 100, 0.9)';
export const ROPE_INVALID_COLOR = 'rgba(255, 60, 60, 0.55)';

/**
 * Crack-line stroke color for each crumble block variant.
 * The same crack geometry is drawn for every block size/shape;
 * only the color changes to indicate the elemental weakness.
 */
export const CRUMBLE_VARIANT_CRACK_COLOR: Readonly<Record<CrumbleVariant, string>> = {
  normal:    '#c8a060',
  fire:      '#ff6030',
  water:     '#4080ff',
  void:      '#a040e0',
  ice:       '#80d8ff',
  lightning: '#ffee00',
  poison:    '#60cc40',
  shadow:    '#602090',
  nature:    '#90e060',
};

/** Footprint size of a save tomb in block units (sprite is 2 wide × 3 tall, centered). */
export const SAVE_TOMB_FOOTPRINT_W_BLOCKS = 2;
export const SAVE_TOMB_FOOTPRINT_H_BLOCKS = 3;
/** Footprint size of a skill tomb in block units (sprite is 2 wide × 2 tall, centered). */
export const SKILL_TOMB_FOOTPRINT_W_BLOCKS = 2;
export const SKILL_TOMB_FOOTPRINT_H_BLOCKS = 2;
/** Footprint size of a full dust container collectible. */
export const DUST_CONTAINER_FOOTPRINT_W_BLOCKS = 3;
export const DUST_CONTAINER_FOOTPRINT_H_BLOCKS = 3;
/** Footprint size of a dust container shard collectible. */
export const DUST_CONTAINER_SHARD_FOOTPRINT_W_BLOCKS = 2;
export const DUST_CONTAINER_SHARD_FOOTPRINT_H_BLOCKS = 2;

// ── Direction helper ─────────────────────────────────────────────────────────

export function getDirectionVector(dir: AmbientLightDirection): [number, number] {
  switch (dir) {
    case 'down':       return [0, 1];
    case 'down-right': return [1, 1];
    case 'down-left':  return [-1, 1];
    case 'up':         return [0, -1];
    case 'up-right':   return [1, -1];
    case 'up-left':    return [-1, -1];
    case 'left':       return [-1, 0];
    case 'right':      return [1, 0];
    case 'omni':       return [0, 0];
  }
}

// ── Drawing primitives ───────────────────────────────────────────────────────

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  ox: number, oy: number, zoom: number,
  canvasW: number, canvasH: number,
): void {
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();

  const startCol = Math.max(0, Math.floor(-ox / (BLOCK_SIZE_SMALL * zoom)));
  const endCol = Math.min(room.widthBlocks, Math.ceil((canvasW - ox) / (BLOCK_SIZE_SMALL * zoom)));
  const startRow = Math.max(0, Math.floor(-oy / (BLOCK_SIZE_SMALL * zoom)));
  const endRow = Math.min(room.heightBlocks, Math.ceil((canvasH - oy) / (BLOCK_SIZE_SMALL * zoom)));

  for (let col = startCol; col <= endCol; col++) {
    const x = col * BLOCK_SIZE_SMALL * zoom + ox;
    ctx.moveTo(x, startRow * BLOCK_SIZE_SMALL * zoom + oy);
    ctx.lineTo(x, endRow * BLOCK_SIZE_SMALL * zoom + oy);
  }
  for (let row = startRow; row <= endRow; row++) {
    const y = row * BLOCK_SIZE_SMALL * zoom + oy;
    ctx.moveTo(startCol * BLOCK_SIZE_SMALL * zoom + ox, y);
    ctx.lineTo(endCol * BLOCK_SIZE_SMALL * zoom + ox, y);
  }
  ctx.stroke();
}

export function drawBlockRect(
  ctx: CanvasRenderingContext2D,
  xBlock: number, yBlock: number, wBlock: number, hBlock: number,
  ox: number, oy: number, zoom: number,
  color: string, lineWidth: number,
): void {
  const x = xBlock * BLOCK_SIZE_SMALL * zoom + ox;
  const y = yBlock * BLOCK_SIZE_SMALL * zoom + oy;
  const w = wBlock * BLOCK_SIZE_SMALL * zoom;
  const h = hBlock * BLOCK_SIZE_SMALL * zoom;

  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color.replace(/[\d.]+\)$/, '1)');
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(x, y, w, h);
}

/** Subtle color for the boundary line drawn between distinct wall instances. */
export const WALL_TILE_GRID_COLOR = 'rgba(140,210,255,0.25)';

/**
 * Draws a thin, subtle line only where two *different* wall instances meet
 * (tracked via `cellOwner`, cell key → owning wall uid) — never inside a
 * single instance's own footprint. This lets a level designer see exactly
 * where one placed block ends and the next begins (e.g. a 2×2 block sitting
 * next to four separate 1×1 blocks reads as one 2×2 plus four distinct
 * cells, not as an undifferentiated blob).
 */
export function drawWallTileGrid(
  ctx: CanvasRenderingContext2D,
  cellOwner: Map<string, number>,
  ox: number, oy: number, zoom: number,
): void {
  const tile = BLOCK_SIZE_SMALL * zoom;
  ctx.strokeStyle = WALL_TILE_GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [cellKey, uid] of cellOwner) {
    const [gx, gy] = cellKey.split(',').map(Number);
    const cellX = gx * tile + ox;
    const cellY = gy * tile + oy;

    // Only draw an edge when the neighbor cell is occupied by a *different*
    // wall instance — a missing neighbor (open air) is already handled by
    // the merged outer outline, and a same-instance neighbor shares this
    // block and should show no seam at all.
    const rightOwner = cellOwner.get(`${gx + 1},${gy}`);
    if (rightOwner !== undefined && rightOwner !== uid) {
      ctx.moveTo(cellX + tile, cellY);
      ctx.lineTo(cellX + tile, cellY + tile);
    }
    const downOwner = cellOwner.get(`${gx},${gy + 1}`);
    if (downOwner !== undefined && downOwner !== uid) {
      ctx.moveTo(cellX, cellY + tile);
      ctx.lineTo(cellX + tile, cellY + tile);
    }
  }
  ctx.stroke();
}

/**
 * Draws a wall's fill plus an outline that traces only the boundary between
 * this wall's footprint and unoccupied space — shared edges with adjacent
 * occupied cells (from `occupied`) are skipped, so contiguous blocks (e.g. a
 * 2×2 block, or several 1×1 blocks placed side by side) render with a single
 * merged outline instead of a grid of per-cell outlines. Isolated 1×1 blocks
 * are unaffected since they have no occupied neighbors.
 */
export function drawMergedWallOutline(
  ctx: CanvasRenderingContext2D,
  occupied: Set<string>,
  xBlock: number, yBlock: number, wBlock: number, hBlock: number,
  ox: number, oy: number, zoom: number,
  color: string, lineWidth: number,
): void {
  const tile = BLOCK_SIZE_SMALL * zoom;
  const x = xBlock * tile + ox;
  const y = yBlock * tile + oy;
  const w = wBlock * tile;
  const h = hBlock * tile;

  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = color.replace(/[\d.]+\)$/, '1)');
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (let cy = 0; cy < hBlock; cy++) {
    for (let cx = 0; cx < wBlock; cx++) {
      const gx = xBlock + cx;
      const gy = yBlock + cy;
      const cellX = gx * tile + ox;
      const cellY = gy * tile + oy;
      if (!occupied.has(`${gx},${gy - 1}`)) {
        ctx.moveTo(cellX, cellY);
        ctx.lineTo(cellX + tile, cellY);
      }
      if (!occupied.has(`${gx},${gy + 1}`)) {
        ctx.moveTo(cellX, cellY + tile);
        ctx.lineTo(cellX + tile, cellY + tile);
      }
      if (!occupied.has(`${gx - 1},${gy}`)) {
        ctx.moveTo(cellX, cellY);
        ctx.lineTo(cellX, cellY + tile);
      }
      if (!occupied.has(`${gx + 1},${gy}`)) {
        ctx.moveTo(cellX + tile, cellY);
        ctx.lineTo(cellX + tile, cellY + tile);
      }
    }
  }
  ctx.stroke();
}

/**
 * Draws a ramp wall as a colored triangle using the wall's rampOrientation.
 */
export function drawRampTriangle(
  ctx: CanvasRenderingContext2D,
  w: EditorWall,
  ox: number, oy: number, zoom: number,
  color: string, lineWidth: number,
): void {
  const x  = w.xBlock * BLOCK_SIZE_SMALL * zoom + ox;
  const y  = w.yBlock * BLOCK_SIZE_SMALL * zoom + oy;
  const ww = w.wBlock * BLOCK_SIZE_SMALL * zoom;
  const wh = w.hBlock * BLOCK_SIZE_SMALL * zoom;
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
export function drawPlatformLine(
  ctx: CanvasRenderingContext2D,
  w: EditorWall,
  ox: number, oy: number, zoom: number,
  color: string,
): void {
  const x  = w.xBlock * BLOCK_SIZE_SMALL * zoom + ox;
  const y  = w.yBlock * BLOCK_SIZE_SMALL * zoom + oy;
  const ww = w.wBlock * BLOCK_SIZE_SMALL * zoom;
  const wh = w.hBlock * BLOCK_SIZE_SMALL * zoom;
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
export function drawHalfPillarRect(
  ctx: CanvasRenderingContext2D,
  w: EditorWall,
  ox: number, oy: number, zoom: number,
  color: string,
): void {
  // Full AABB position
  const x  = w.xBlock * BLOCK_SIZE_SMALL * zoom + ox;
  const y  = w.yBlock * BLOCK_SIZE_SMALL * zoom + oy;
  const ww = w.wBlock * BLOCK_SIZE_SMALL * zoom;
  const wh = w.hBlock * BLOCK_SIZE_SMALL * zoom;
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

export function drawMarker(
  ctx: CanvasRenderingContext2D,
  xBlock: number, yBlock: number,
  ox: number, oy: number, zoom: number,
  color: string, emoji: string,
): void {
  const cx = (xBlock + 0.5) * BLOCK_SIZE_SMALL * zoom + ox;
  const cy = (yBlock + 0.5) * BLOCK_SIZE_SMALL * zoom + oy;
  const r = BLOCK_SIZE_SMALL * zoom * 0.4;

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

/**
 * Draws a filled + outlined footprint rectangle for an object whose sprite is
 * centered on the block at (xBlock, yBlock).  The object occupies
 * (wBlocks × hBlocks) blocks centered on the block-center point.
 */
export function drawObjectFootprint(
  ctx: CanvasRenderingContext2D,
  xBlock: number, yBlock: number,
  wBlocks: number, hBlocks: number,
  ox: number, oy: number, zoom: number,
  color: string, lineWidth: number,
): void {
  // Center of the anchor block in pixel space
  const cx = (xBlock + 0.5) * BLOCK_SIZE_SMALL * zoom + ox;
  const cy = (yBlock + 0.5) * BLOCK_SIZE_SMALL * zoom + oy;
  const halfW = (wBlocks / 2) * BLOCK_SIZE_SMALL * zoom;
  const halfH = (hBlocks / 2) * BLOCK_SIZE_SMALL * zoom;
  const x = cx - halfW;
  const y = cy - halfH;
  const w = wBlocks * BLOCK_SIZE_SMALL * zoom;
  const h = hBlocks * BLOCK_SIZE_SMALL * zoom;

  ctx.fillStyle = color.replace(/[\d.]+\)$/, '0.12)');
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color.replace(/[\d.]+\)$/, '1)');
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(x, y, w, h);
}

export function getEnemyFootprintBlocks(enemy: EditorEnemy): { wBlock: number; hBlock: number } | null {
  if (enemy.isRollingEnemyFlag === 1) return { wBlock: 2, hBlock: 2 };
  if (enemy.isBeetleFlag === 1) return { wBlock: 2, hBlock: 1 };
  if (enemy.isRadiantTetherFlag === 1) return { wBlock: 3, hBlock: 3 };
  if (enemy.isRadiantWebFlag === 1) return { wBlock: 3, hBlock: 3 };
  if (enemy.isCrimsonWizardFlag === 1) return { wBlock: 1, hBlock: 3 };
  if (enemy.isHeraldFlag === 1) return { wBlock: 2, hBlock: 3 };
  if (enemy.isRockElementalFlag === 1) return { wBlock: 3, hBlock: 3 };
  if (enemy.isGridBlockEnemyFlag === 1) return enemy.gridBlockSizeIndex === 1 ? { wBlock: 2, hBlock: 2 } : { wBlock: 1, hBlock: 1 };
  if (enemy.isGridSnakeEnemyFlag === 1) return { wBlock: 1, hBlock: 1 };
  return null;
}

export function drawTransitionZone(
  ctx: CanvasRenderingContext2D,
  t: EditorTransition,
  _room: EditorRoomData,
  ox: number, oy: number, zoom: number,
  color: string,
  doorNumber: number,
  isHovered: boolean,
): void {
  const gw = t.gradientWidthBlocks ?? 3;
  const isHoriz = t.direction === 'left' || t.direction === 'right';
  const xBlock = t.xBlock;
  const yBlock = t.yBlock;
  const wBlock = isHoriz ? gw : t.openingSizeBlocks;
  const hBlock = isHoriz ? t.openingSizeBlocks : gw;

  const bs = BLOCK_SIZE_SMALL;

  // When gw === 0 and the transition is hovered or selected, draw the 1-block
  // editor hitbox area so the user can see and interact with the transition.
  if (gw === 0 && isHovered) {
    const hb = getTransitionEditorHitbox(t);
    ctx.save();
    ctx.fillStyle = 'rgba(255,200,100,0.18)';
    ctx.strokeStyle = 'rgba(255,200,100,0.55)';
    ctx.lineWidth = 1;
    ctx.fillRect(
      hb.xBlock * bs * zoom + ox, hb.yBlock * bs * zoom + oy,
      Math.max(hb.wBlock, 0.2) * bs * zoom, Math.max(hb.hBlock, 0.2) * bs * zoom,
    );
    ctx.strokeRect(
      hb.xBlock * bs * zoom + ox, hb.yBlock * bs * zoom + oy,
      Math.max(hb.wBlock, 0.2) * bs * zoom, Math.max(hb.hBlock, 0.2) * bs * zoom,
    );
    ctx.restore();
  }

  // Draw translucent zone rectangle
  drawBlockRect(ctx, xBlock, yBlock, wBlock, hBlock, ox, oy, zoom, color, 2);

  // Draw thick red trigger edge
  const triggerEdgeColor = '#ff2222';
  const triggerLineWidth = Math.max(2, 3 * zoom);
  ctx.save();
  ctx.strokeStyle = triggerEdgeColor;
  ctx.lineWidth = triggerLineWidth;
  ctx.beginPath();
  if (t.direction === 'right') {
    // Trigger edge = right edge
    const ex = (xBlock + wBlock) * bs * zoom + ox;
    const ey1 = yBlock * bs * zoom + oy;
    const ey2 = (yBlock + hBlock) * bs * zoom + oy;
    ctx.moveTo(ex, ey1); ctx.lineTo(ex, ey2);
  } else if (t.direction === 'left') {
    // Trigger edge = left edge
    const ex = xBlock * bs * zoom + ox;
    const ey1 = yBlock * bs * zoom + oy;
    const ey2 = (yBlock + hBlock) * bs * zoom + oy;
    ctx.moveTo(ex, ey1); ctx.lineTo(ex, ey2);
  } else if (t.direction === 'down') {
    // Trigger edge = bottom edge
    const ey = (yBlock + hBlock) * bs * zoom + oy;
    const ex1 = xBlock * bs * zoom + ox;
    const ex2 = (xBlock + wBlock) * bs * zoom + ox;
    ctx.moveTo(ex1, ey); ctx.lineTo(ex2, ey);
  } else {
    // up: trigger edge = top edge
    const ey = yBlock * bs * zoom + oy;
    const ex1 = xBlock * bs * zoom + ox;
    const ex2 = (xBlock + wBlock) * bs * zoom + ox;
    ctx.moveTo(ex1, ey); ctx.lineTo(ex2, ey);
  }
  ctx.stroke();
  ctx.restore();

  // Draw hover arrow pointing outward in the transition's facing direction
  if (isHovered) {
    _drawTransitionHoverArrow(ctx, t, xBlock, yBlock, wBlock, hBlock, ox, oy, zoom);
  }

  // Draw label with door number
  const cx = (xBlock + wBlock / 2) * bs * zoom + ox;
  const cy = (yBlock + hBlock / 2) * bs * zoom + oy;
  ctx.fillStyle = '#fff';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = t.targetRoomId ? `#${doorNumber} →${t.targetRoomId}` : `#${doorNumber} (unlinked)`;
  ctx.fillText(label, cx, cy);
}

/** Draws a red arrow starting at the trigger edge, pointing outward in the facing direction. */
function _drawTransitionHoverArrow(
  ctx: CanvasRenderingContext2D,
  t: EditorTransition,
  xBlock: number,
  yBlock: number,
  wBlock: number,
  hBlock: number,
  ox: number,
  oy: number,
  zoom: number,
): void {
  const bs = BLOCK_SIZE_SMALL;
  /** Minimum arrow shaft length in pixels. */
  const ARROW_MIN_LEN_PX = 12;
  /** Scale factor for arrow length relative to block size. */
  const ARROW_LEN_BLOCKS = 3;
  /** Fraction of arrow length used for the arrowhead. */
  const ARROW_HEAD_RATIO = 0.35;
  /** Minimum arrowhead length in pixels. */
  const ARROW_HEAD_MIN_PX = 6;
  /** Half-angle of the arrowhead in radians (30°). */
  const ARROW_HEAD_ANGLE_RAD = Math.PI / 6;

  const arrowLenPx = Math.max(ARROW_MIN_LEN_PX, ARROW_LEN_BLOCKS * bs * zoom);
  const headLen = Math.max(ARROW_HEAD_MIN_PX, arrowLenPx * ARROW_HEAD_RATIO);

  // Center of the trigger edge
  let startX: number, startY: number, dirX: number, dirY: number;
  if (t.direction === 'right') {
    startX = (xBlock + wBlock) * bs * zoom + ox;
    startY = (yBlock + hBlock / 2) * bs * zoom + oy;
    dirX = 1; dirY = 0;
  } else if (t.direction === 'left') {
    startX = xBlock * bs * zoom + ox;
    startY = (yBlock + hBlock / 2) * bs * zoom + oy;
    dirX = -1; dirY = 0;
  } else if (t.direction === 'down') {
    startX = (xBlock + wBlock / 2) * bs * zoom + ox;
    startY = (yBlock + hBlock) * bs * zoom + oy;
    dirX = 0; dirY = 1;
  } else {
    startX = (xBlock + wBlock / 2) * bs * zoom + ox;
    startY = yBlock * bs * zoom + oy;
    dirX = 0; dirY = -1;
  }

  const endX = startX + dirX * arrowLenPx;
  const endY = startY + dirY * arrowLenPx;

  ctx.save();
  ctx.strokeStyle = '#ff2222';
  ctx.fillStyle = '#ff2222';
  ctx.lineWidth = Math.max(2, 2 * zoom);

  // Shaft
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  // Arrow head (two lines)
  const angleRad = Math.atan2(dirY, dirX);
  const h1X = endX - headLen * Math.cos(angleRad - ARROW_HEAD_ANGLE_RAD);
  const h1Y = endY - headLen * Math.sin(angleRad - ARROW_HEAD_ANGLE_RAD);
  const h2X = endX - headLen * Math.cos(angleRad + ARROW_HEAD_ANGLE_RAD);
  const h2Y = endY - headLen * Math.sin(angleRad + ARROW_HEAD_ANGLE_RAD);

  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(h1X, h1Y);
  ctx.moveTo(endX, endY);
  ctx.lineTo(h2X, h2Y);
  ctx.stroke();

  ctx.restore();
}


export const GUIDE_DUST_PATH_COLOR    = 'rgba(255, 200, 60, 0.7)';
export const GUIDE_DUST_PATH_SELECTED = 'rgba(255, 220, 80, 1.0)';
export const GUIDE_DUST_POINT_COLOR   = 'rgba(255, 240, 100, 0.9)';
