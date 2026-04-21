/**
 * Editor renderer — draws overlays for grid, placement preview,
 * selection highlights, transition zones, enemy markers, and
 * other editor visual feedback on the 2D canvas.
 */

import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import type { EditorState, EditorRoomData, EditorTransition, EditorWall, SelectedElementType, AmbientLightDirection } from './editorState';
import { EditorTool } from './editorState';
import { getPlacementPreview, findFloorBlockRow, findCeilingBlockRow } from './editorTools';
import { WEAVE_REGISTRY } from '../sim/weaves/weaveDefinition';

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
const SKILL_TOMB_COLOR = 'rgba(120,80,220,0.55)';
const SKILL_TOMB_SELECTED = 'rgba(160,120,255,0.9)';
const PREVIEW_COLOR = 'rgba(0,200,255,0.25)';
const PREVIEW_RAMP_COLOR = 'rgba(80,255,80,0.35)';
const PREVIEW_PLATFORM_COLOR = 'rgba(255,200,50,0.4)';
const PREVIEW_PILLAR_HALF_COLOR = 'rgba(180,130,255,0.35)';
const CURSOR_COLOR = 'rgba(255,255,255,0.4)';
const SELECTION_BOX_COLOR = 'rgba(100,200,255,0.25)';
const SELECTION_BOX_BORDER = 'rgba(100,200,255,0.7)';

/** Footprint size of a save tomb in block units (sprite is 2 wide × 3 tall, centered). */
const SAVE_TOMB_FOOTPRINT_W_BLOCKS = 2;
const SAVE_TOMB_FOOTPRINT_H_BLOCKS = 3;
/** Footprint size of a skill tomb in block units (sprite is 2 wide × 2 tall, centered). */
const SKILL_TOMB_FOOTPRINT_W_BLOCKS = 2;
const SKILL_TOMB_FOOTPRINT_H_BLOCKS = 2;

const BS = BLOCK_SIZE_SMALL;

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

  // ── Save tombs ──────────────────────────────────────────────────────────
  for (const s of room.saveTombs) {
    const isSelected = isElementSelected('saveTomb', s.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'saveTomb' && state.hoverElement.uid === s.uid;
    const color = isSelected ? TOMB_SELECTED : TOMB_COLOR;
    drawObjectFootprint(ctx, s.xBlock, s.yBlock,
      SAVE_TOMB_FOOTPRINT_W_BLOCKS, SAVE_TOMB_FOOTPRINT_H_BLOCKS,
      offsetXPx, offsetYPx, zoom, color, isSelected || isHovered ? 2 : 1);
    drawMarker(ctx, s.xBlock, s.yBlock, offsetXPx, offsetYPx, zoom, color, '⛩');
  }

  // ── Skill tombs (dust skill unlocks) ────────────────────────────────────
  for (const s of room.skillTombs) {
    const isSelected = isElementSelected('skillTomb', s.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'skillTomb' && state.hoverElement.uid === s.uid;
    const color = isSelected ? SKILL_TOMB_SELECTED : SKILL_TOMB_COLOR;
    drawObjectFootprint(ctx, s.xBlock, s.yBlock,
      SKILL_TOMB_FOOTPRINT_W_BLOCKS, SKILL_TOMB_FOOTPRINT_H_BLOCKS,
      offsetXPx, offsetYPx, zoom, color, isSelected || isHovered ? 2 : 1);
    drawMarker(ctx, s.xBlock, s.yBlock, offsetXPx, offsetYPx, zoom, color, '✦');
  }

  // ── Dust piles ──────────────────────────────────────────────────────────
  for (const p of room.dustPiles) {
    const isSelected = isElementSelected('dustPile', p.uid);
    drawMarker(ctx, p.xBlock, p.yBlock, offsetXPx, offsetYPx, zoom,
      isSelected ? 'rgba(255,215,0,0.8)' : 'rgba(255,215,0,0.4)', '✦');
  }

  // ── Ambient Light Blockers (before decorations so icons draw on top) ─────
  for (const b of (room.ambientLightBlockers ?? [])) {
    const isSelected = isElementSelected('ambientLightBlocker', b.uid);
    // Purple translucent fill
    ctx.fillStyle = 'rgba(120, 60, 200, 0.35)';
    const xPx = b.xBlock * BS * zoom + offsetXPx;
    const yPx = b.yBlock * BS * zoom + offsetYPx;
    const sizePx = BS * zoom;
    ctx.fillRect(xPx, yPx, sizePx, sizePx);
    // Purple stroke
    ctx.strokeStyle = isSelected ? 'rgba(255, 255, 255, 1.0)' : 'rgba(180, 120, 255, 0.85)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(xPx, yPx, sizePx, sizePx);
  }

  // ── Light Sources (before decorations so icons draw on top) ──────────────
  for (const l of (room.lightSources ?? [])) {
    const isSelected = isElementSelected('lightSource', l.uid);
    const centerXPx = (l.xBlock + 0.5) * BS * zoom + offsetXPx;
    const centerYPx = (l.yBlock + 0.5) * BS * zoom + offsetYPx;
    // Draw range circle (dashed)
    const rangeRadiusPx = l.radiusBlocks * BS * zoom;
    ctx.save();
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = `rgba(${l.colorR}, ${l.colorG}, ${l.colorB}, 0.6)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerXPx, centerYPx, rangeRadiusPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    // Draw center marker (filled circle)
    ctx.fillStyle = `rgb(${l.colorR}, ${l.colorG}, ${l.colorB})`;
    ctx.beginPath();
    ctx.arc(centerXPx, centerYPx, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = isSelected ? 'rgba(255, 255, 255, 1.0)' : 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.beginPath();
    ctx.arc(centerXPx, centerYPx, 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ── Decorations ──────────────────────────────────────────────────────────
  for (const d of (room.decorations ?? [])) {
    const isSelected = isElementSelected('decoration', d.uid);
    const emoji = d.kind === 'mushroom' ? '🍄' : d.kind === 'glowGrass' ? '🌿' : '🌱';
    const color = isSelected ? 'rgba(80,220,130,0.9)' : 'rgba(60,170,90,0.55)';
    drawMarker(ctx, d.xBlock, d.yBlock, offsetXPx, offsetYPx, zoom, color, emoji);
  }

  // ── Placement preview ────────────────────────────────────────────────────
  if (state.activeTool === EditorTool.Place && state.selectedPaletteItem !== null) {
    const preview = getPlacementPreview(state);
    if (preview !== null) {
      const item = state.selectedPaletteItem;
      if (item.id === 'decoration_mushroom' || item.id === 'decoration_glowgrass' || item.id === 'decoration_vine') {
        // Decoration preview: compute terrain-snapped target position
        const isVine = item.id === 'decoration_vine';
        const targetRow = isVine
          ? findCeilingBlockRow(room, state.cursorBlockX, state.cursorBlockY)
          : findFloorBlockRow(room, state.cursorBlockX, state.cursorBlockY);
        if (targetRow !== null) {
          const emoji = item.id === 'decoration_mushroom' ? '🍄' : item.id === 'decoration_glowgrass' ? '🌿' : '🌱';
          // Highlight the surface block
          const surfaceColor = 'rgba(80,220,130,0.2)';
          drawBlockRect(ctx, state.cursorBlockX, targetRow, 1, 1, offsetXPx, offsetYPx, zoom, surfaceColor, 1);
          drawMarker(ctx, state.cursorBlockX, targetRow, offsetXPx, offsetYPx, zoom, 'rgba(80,220,130,0.5)', emoji);
        } else {
          // No valid surface — show warning color on cursor
          drawBlockRect(ctx, state.cursorBlockX, state.cursorBlockY, 1, 1, offsetXPx, offsetYPx, zoom, 'rgba(255,60,60,0.2)', 1);
        }
      } else if (item.isRampItem === 1) {
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
      } else if (item.id === 'save_tomb') {
        drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY,
          SAVE_TOMB_FOOTPRINT_W_BLOCKS, SAVE_TOMB_FOOTPRINT_H_BLOCKS,
          offsetXPx, offsetYPx, zoom, 'rgba(212,168,75,0.35)', 2);
        drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
          'rgba(212,168,75,0.5)', '⛩');
      } else if (item.id === 'skill_tomb') {
        drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY,
          SKILL_TOMB_FOOTPRINT_W_BLOCKS, SKILL_TOMB_FOOTPRINT_H_BLOCKS,
          offsetXPx, offsetYPx, zoom, 'rgba(120,80,220,0.35)', 2);
        drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
          'rgba(120,80,220,0.55)', '✦');
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

  // ── Hover tooltip (Select tool only) ─────────────────────────────────────
  if (state.activeTool === EditorTool.Select && state.hoverElement !== null) {
    const el = state.hoverElement;
    const tooltipId = buildElementTooltipId(el.type, el.uid);
    const tooltipType = buildElementTypeName(el.type, el.uid, room);
    const cursorXPx = state.cursorWorldX * zoom + offsetXPx;
    const cursorYPx = state.cursorWorldY * zoom + offsetYPx;
    drawHoverTooltip(ctx, tooltipId, tooltipType, cursorXPx, cursorYPx, canvasWidth, canvasHeight);
  }

  // ── Ambient Light Direction Indicator ────────────────────────────────────
  if (room.ambientLightDirection && room.ambientLightDirection !== 'omni') {
    const dir = room.ambientLightDirection;
    const [dx, dy] = getDirectionVector(dir);
    const arrowLen = 16; // virtual px
    const startX = 12; // top-left padding
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
    // Arrowhead
    const headLen = 5;
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - headLen * Math.cos(angle - Math.PI / 6), endY - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(endX, endY);
    ctx.lineTo(endX - headLen * Math.cos(angle + Math.PI / 6), endY - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
    // Label
    ctx.font = '10px monospace';
    ctx.fillText(dir, endX + 4, endY + 4);
  }

  ctx.restore();
}

function getDirectionVector(dir: AmbientLightDirection): [number, number] {
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

// ── Drawing helpers ──────────────────────────────────────────────────────────

/** Returns a unique display ID string for the given element (e.g. "skill_tomb_12"). */
function buildElementTooltipId(type: SelectedElementType, uid: number): string {
  const prefix: Record<SelectedElementType, string> = {
    wall:             'wall',
    enemy:            'enemy',
    transition:       'transition',
    saveTomb:         'save_tomb',
    skillTomb:        'skill_tomb',
    dustPile:         'dust_pile',
    grasshopperArea:  'grasshopper_area',
    decoration:       'decoration',
    playerSpawn:      'player_spawn',
    ambientLightBlocker: 'ambient_blocker',
    lightSource:      'light_source',
  };
  const base = prefix[type] ?? type;
  return `${base}_${uid}`;
}

/**
 * Returns a human-readable type name for the element, enriched with enemy
 * sub-type when available.
 */
function buildElementTypeName(
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
    wall:        'Wall',
    transition:  'Room Transition',
    saveTomb:    'Save Tomb',
    dustPile:    'Dust Pile',
    playerSpawn: 'Player Spawn',
  };
  return names[type] ?? type;
}

/** Renders a small tooltip box near the cursor showing element ID + type. */
function drawHoverTooltip(
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

/**
 * Draws a filled + outlined footprint rectangle for an object whose sprite is
 * centered on the block at (xBlock, yBlock).  The object occupies
 * (wBlocks × hBlocks) blocks centered on the block-center point.
 */
function drawObjectFootprint(
  ctx: CanvasRenderingContext2D,
  xBlock: number, yBlock: number,
  wBlocks: number, hBlocks: number,
  ox: number, oy: number, zoom: number,
  color: string, lineWidth: number,
): void {
  // Center of the anchor block in pixel space
  const cx = (xBlock + 0.5) * BS * zoom + ox;
  const cy = (yBlock + 0.5) * BS * zoom + oy;
  const halfW = (wBlocks / 2) * BS * zoom;
  const halfH = (hBlocks / 2) * BS * zoom;
  const x = cx - halfW;
  const y = cy - halfH;
  const w = wBlocks * BS * zoom;
  const h = hBlocks * BS * zoom;

  ctx.fillStyle = color.replace(/[\d.]+\)$/, '0.12)');
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color.replace(/[\d.]+\)$/, '1)');
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(x, y, w, h);
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
    let rotHint: string;
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
