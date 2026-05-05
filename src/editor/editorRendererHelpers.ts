/**
 * editorRendererHelpers.ts — Drawing primitives and label helpers for the
 * editor overlay renderer.
 *
 * Contains all color constants, footprint constants, and the private helper
 * functions used by `renderEditorOverlays` in `editorRenderer.ts`.
 * Keeping these separate lets the main file focus on the high-level draw order
 * without being cluttered by low-level geometry utilities.
 */

import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import type { CrumbleVariant, EditorRoomData, EditorTransition, EditorWall, SelectedElementType, AmbientLightDirection, EditorEnemy } from './editorState';
import { WEAVE_REGISTRY } from '../sim/weaves/weaveDefinition';

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

// ── Label / tooltip helpers ──────────────────────────────────────────────────

/** Returns a unique display ID string for the given element (e.g. "skill_tomb_12"). */
export function buildElementTooltipId(type: SelectedElementType, uid: number): string {
  const prefix: Record<SelectedElementType, string> = {
    wall:             'wall',
    enemy:            'enemy',
    transition:       'transition',
    saveTomb:         'save_tomb',
    skillTomb:        'skill_tomb',
    dustContainer:    'dust_container',
    dustContainerPiece: 'dust_container_piece',
    dustBoostJar:     'dust_jar',
    dustPile:         'dust_pile',
    grasshopperArea:  'grasshopper_area',
    fireflyArea:      'firefly_area',
    decoration:       'decoration',
    playerSpawn:      'player_spawn',
    ambientLightBlocker: 'ambient_blocker',
    lightSource:      'light_source',
    sunbeam:          'sunbeam',
    waterZone:        'water_zone',
    lavaZone:         'lava_zone',
    crumbleBlock:     'crumble_block',
    bouncePad:        'bounce_pad',
    rope:             'rope',
    fallingBlock:     'falling_block',
  };
  const base = prefix[type] ?? type;
  return `${base}_${uid}`;
}

/**
 * Returns a human-readable type name for the element, enriched with enemy
 * sub-type when available.
 */
export function buildElementTypeName(
  type: SelectedElementType,
  uid: number,
  room: EditorRoomData,
): string {
  if (type === 'enemy') {
    const e = room.enemies.find(x => x.uid === uid);
    if (e) {
      if (e.isFlyingEyeFlag === 1)    return 'Flying Eye';
      if (e.isRollingEnemyFlag === 1) return 'Rolling Enemy';
      if (e.isRockElementalFlag === 1)return 'Rock Elemental';
      if (e.isRadiantTetherFlag === 1)return 'Radiant Tether';
      if (e.isGrappleHunterFlag === 1)return 'Grapple Hunter';
      return 'Enemy';
    }
  }
  if (type === 'decoration') {
    const d = (room.decorations ?? []).find(x => x.uid === uid);
    if (d) {
      if (d.kind === 'mushroom')  return 'Glow Mushroom';
      if (d.kind === 'glowGrass') return 'Glow Grass';
      if (d.kind === 'vine')      return 'Glow Vine';
    }
    return 'Decoration';
  }
  if (type === 'skillTomb') {
    const s = room.skillTombs.find(x => x.uid === uid);
    if (s) {
      const displayName = WEAVE_REGISTRY.get(s.weaveId)?.displayName ?? '(unknown weave)';
      return `Skill Tomb [${displayName}]`;
    }
    return 'Skill Tomb';
  }
  const names: Partial<Record<SelectedElementType, string>> = {
    wall:               'Wall',
    transition:         'Room Transition',
    saveTomb:           'Save Tomb',
    dustContainer:      'Dust Container',
    dustContainerPiece: 'Dust Container Piece',
    dustPile:           'Dust Pile',
    grasshopperArea:    'Grasshopper Area',
    fireflyArea:        'Firefly Area',
    playerSpawn:        'Player Spawn',
    ambientLightBlocker:'Ambient Blocker',
    lightSource:        'Light Source',
    sunbeam:            'Sunbeam',
    waterZone:          'Water Zone',
    lavaZone:           'Lava Zone',
    rope:               'Rope',
  };
  if (type === 'dustBoostJar') {
    const j = (room.dustBoostJars ?? []).find(x => x.uid === uid);
    if (j) return `Dust Jar [${j.dustKind} ×${j.dustCount}]`;
    return 'Dust Jar';
  }
  if (type === 'crumbleBlock') {
    const b = (room.crumbleBlocks ?? []).find(x => x.uid === uid);
    if (b) {
      const variantLabel = b.variant && b.variant !== 'normal' ? ` [${b.variant}]` : '';
      const sizeLabel = (b.wBlock ?? 1) > 1 || (b.hBlock ?? 1) > 1
        ? ` ${b.wBlock ?? 1}×${b.hBlock ?? 1}` : '';
      return `Crumble Block${sizeLabel}${variantLabel}`;
    }
    return 'Crumble Block';
  }
  if (type === 'bouncePad') {
    const b = (room.bouncePads ?? []).find(x => x.uid === uid);
    if (b) {
      const sfLabel = b.speedFactorIndex === 1 ? '100%' : '50%';
      const sizeLabel = b.wBlock > 1 || b.hBlock > 1 ? ` ${b.wBlock}×${b.hBlock}` : '';
      const rampLabel = b.rampOrientation !== undefined ? ' Ramp' : '';
      return `Bounce Pad${rampLabel}${sizeLabel} [${sfLabel}]`;
    }
    return 'Bounce Pad';
  }
  if (type === 'fallingBlock') {
    const fb = (room.fallingBlocks ?? []).find(x => x.uid === uid);
    if (fb) {
      const varLabel = fb.variant === 'tough' ? 'Tough' : fb.variant === 'sensitive' ? 'Sensitive' : 'Crumbling';
      return `Falling Block [${varLabel}]`;
    }
    return 'Falling Block';
  }
  if (type === 'ambientLightBlocker') {
    const b = (room.ambientLightBlockers ?? []).find(x => x.uid === uid);
    if (b) return b.isDarkFlag === 1 ? 'Dark Blocker' : 'Ambient Blocker';
  }
  return names[type] ?? type;
}

/** Renders a small tooltip box near the cursor showing element ID + type. */
export function drawHoverTooltip(
  ctx: CanvasRenderingContext2D,
  idText: string,
  typeText: string,
  cursorXPx: number,
  cursorYPx: number,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const PADDING = 5;
  const LINE_HEIGHT = 13;
  const ID_FONT    = 'bold 11px monospace';
  const TYPE_FONT  = '10px monospace';
  const OFFSET_X   = 12;
  const OFFSET_Y   = -28;

  ctx.save();
  ctx.font = ID_FONT;
  const idWidth = ctx.measureText(idText).width;
  ctx.font = TYPE_FONT;
  const typeWidth = ctx.measureText(typeText).width;
  const boxW = Math.max(idWidth, typeWidth) + PADDING * 2;
  const boxH = LINE_HEIGHT * 2 + PADDING * 2;

  let tx = cursorXPx + OFFSET_X;
  let ty = cursorYPx + OFFSET_Y;
  // Keep tooltip inside canvas
  if (tx + boxW > canvasWidth - 4) tx = cursorXPx - OFFSET_X - boxW;
  if (ty < 4) ty = cursorYPx + 16;
  if (ty + boxH > canvasHeight - 4) ty = canvasHeight - 4 - boxH;

  ctx.globalAlpha = 0.88;
  ctx.fillStyle = 'rgba(10,12,20,0.9)';
  ctx.strokeStyle = 'rgba(0,200,100,0.55)';
  ctx.lineWidth = 1;
  // Rounded rectangle
  const r = 3;
  ctx.beginPath();
  ctx.moveTo(tx + r, ty);
  ctx.lineTo(tx + boxW - r, ty);
  ctx.arcTo(tx + boxW, ty,         tx + boxW, ty + r,         r);
  ctx.lineTo(tx + boxW, ty + boxH - r);
  ctx.arcTo(tx + boxW, ty + boxH,  tx + boxW - r, ty + boxH,  r);
  ctx.lineTo(tx + r, ty + boxH);
  ctx.arcTo(tx,       ty + boxH,   tx, ty + boxH - r,          r);
  ctx.lineTo(tx, ty + r);
  ctx.arcTo(tx,       ty,          tx + r, ty,                  r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.globalAlpha = 1.0;
  ctx.font = ID_FONT;
  ctx.fillStyle = '#c0ffd0';
  ctx.fillText(idText,   tx + PADDING, ty + PADDING + LINE_HEIGHT - 2);
  ctx.font = TYPE_FONT;
  ctx.fillStyle = 'rgba(170,220,180,0.7)';
  ctx.fillText(typeText, tx + PADDING, ty + PADDING + LINE_HEIGHT * 2 - 2);

  ctx.restore();
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
  const cx = xBlock * BLOCK_SIZE_SMALL * zoom + ox;
  const cy = yBlock * BLOCK_SIZE_SMALL * zoom + oy;
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
  if (enemy.isRockElementalFlag === 1) return { wBlock: 3, hBlock: 3 };
  return null;
}

export function drawTransitionZone(
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
  const cx = (xBlock + wBlock / 2) * BLOCK_SIZE_SMALL * zoom + ox;
  const cy = (yBlock + hBlock / 2) * BLOCK_SIZE_SMALL * zoom + oy;
  ctx.fillStyle = '#fff';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = t.targetRoomId ? `#${doorNumber} →${t.targetRoomId}` : `#${doorNumber} (unlinked)`;
  ctx.fillText(label, cx, cy);
}
