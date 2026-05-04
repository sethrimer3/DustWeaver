/**
 * Editor overlay draw helpers — one function per element-type group.
 *
 * Each function is responsible for rendering a specific category of room
 * elements as editor overlays on the 2D canvas.  All functions share the same
 * core parameter set: (ctx, room, state, isSelected, offsetXPx, offsetYPx, zoom).
 * Functions that don't need every parameter simply omit those they don't use.
 *
 * Called by renderEditorOverlays in editorRenderer.ts.
 */

import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import type { EditorState, EditorRoomData } from './editorState';
import { EditorTool } from './editorState';
import { ropeLineCrossesWall } from './editorHitTest';
import {
  WALL_HIGHLIGHT, WALL_SELECTED,
  PLATFORM_HIGHLIGHT, PLATFORM_SELECTED,
  RAMP_HIGHLIGHT, RAMP_SELECTED,
  PILLAR_HALF_HIGHLIGHT, PILLAR_HALF_SELECTED,
  ENEMY_COLOR, ENEMY_SELECTED,
  TRANSITION_COLOR, TRANSITION_SELECTED,
  SECRET_DOOR_COLOR, SECRET_DOOR_SELECTED,
  TRANSITION_LINK_SOURCE, TRANSITION_LINK_CANDIDATE,
  SPAWN_COLOR, SPAWN_SELECTED,
  TOMB_COLOR, TOMB_SELECTED,
  SKILL_TOMB_COLOR, SKILL_TOMB_SELECTED,
  GRASSHOPPER_COLOR, GRASSHOPPER_SELECTED,
  FIREFLY_COLOR, FIREFLY_SELECTED,
  ROPE_COLOR, ROPE_SELECTED, ROPE_PREVIEW_COLOR, ROPE_ANCHOR_COLOR, ROPE_INVALID_COLOR,
  CRUMBLE_VARIANT_CRACK_COLOR,
  SAVE_TOMB_FOOTPRINT_W_BLOCKS, SAVE_TOMB_FOOTPRINT_H_BLOCKS,
  SKILL_TOMB_FOOTPRINT_W_BLOCKS, SKILL_TOMB_FOOTPRINT_H_BLOCKS,
  DUST_CONTAINER_COLOR, DUST_CONTAINER_SELECTED,
  DUST_CONTAINER_PIECE_COLOR, DUST_CONTAINER_PIECE_SELECTED,
  DUST_BOOST_JAR_COLOR, DUST_BOOST_JAR_SELECTED,
  drawBlockRect, drawRampTriangle,
  drawPlatformLine, drawHalfPillarRect, drawMarker, drawObjectFootprint,
  getEnemyFootprintBlocks, drawTransitionZone,
} from './editorRendererHelpers';

/** Helper type: function that returns whether a room element is selected. */
export type IsElementSelected = (type: string, uid: number) => boolean;

// ============================================================================
// Interior walls (solid, platform, ramp, half-pillar)
// ============================================================================

export function drawEditorWalls(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  for (const w of room.interiorWalls) {
    const sel = isSelected('wall', w.uid);
    const isPlatform = w.isPlatformFlag === 1;
    const isRamp = w.rampOrientation !== undefined;
    const isHalfPillar = w.isPillarHalfWidthFlag === 1;

    if (isRamp) {
      const color = sel ? RAMP_SELECTED : RAMP_HIGHLIGHT;
      drawRampTriangle(ctx, w, offsetXPx, offsetYPx, zoom, color, sel ? 2 : 1);
    } else if (isPlatform) {
      const color = sel ? PLATFORM_SELECTED : PLATFORM_HIGHLIGHT;
      drawPlatformLine(ctx, w, offsetXPx, offsetYPx, zoom, color);
    } else if (isHalfPillar) {
      const color = sel ? PILLAR_HALF_SELECTED : PILLAR_HALF_HIGHLIGHT;
      drawHalfPillarRect(ctx, w, offsetXPx, offsetYPx, zoom, color);
    } else {
      const color = sel ? WALL_SELECTED : WALL_HIGHLIGHT;
      drawBlockRect(ctx, w.xBlock, w.yBlock, w.wBlock, w.hBlock, offsetXPx, offsetYPx, zoom, color, sel ? 2 : 1);
    }
  }
}

// ============================================================================
// Enemies
// ============================================================================

export function drawEditorEnemies(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  state: EditorState,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  for (const e of room.enemies) {
    const sel = isSelected('enemy', e.uid);
    const enemyFootprint = getEnemyFootprintBlocks(e);
    if (enemyFootprint !== null) {
      const isHovered = state.hoverElement !== null &&
        state.hoverElement.type === 'enemy' && state.hoverElement.uid === e.uid;
      drawObjectFootprint(ctx, e.xBlock, e.yBlock,
        enemyFootprint.wBlock, enemyFootprint.hBlock,
        offsetXPx, offsetYPx, zoom,
        sel ? ENEMY_SELECTED : ENEMY_COLOR,
        sel || isHovered ? 2 : 1);
    }
    drawMarker(ctx, e.xBlock, e.yBlock, offsetXPx, offsetYPx, zoom,
      sel ? ENEMY_SELECTED : ENEMY_COLOR, e.isFlyingEyeFlag === 1 ? '👁' : '⚔');
  }
}

// ============================================================================
// Transitions (doors)
// ============================================================================

export function drawEditorTransitions(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  state: EditorState,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  for (let tIndex = 0; tIndex < room.transitions.length; tIndex++) {
    const t = room.transitions[tIndex];
    const sel = isSelected('transition', t.uid);
    const isLinkSource = state.isLinkingTransition && state.linkSourceTransitionUid === t.uid;
    const isLinkCandidate = state.isLinkingTransition && state.linkSourceTransitionUid !== t.uid;
    let color = TRANSITION_COLOR;
    if (isLinkSource) color = TRANSITION_LINK_SOURCE;
    else if (isLinkCandidate) color = TRANSITION_LINK_CANDIDATE;
    else if (t.isSecretDoor) color = sel ? SECRET_DOOR_SELECTED : SECRET_DOOR_COLOR;
    else if (sel) color = TRANSITION_SELECTED;
    drawTransitionZone(ctx, t, room, offsetXPx, offsetYPx, zoom, color, tIndex + 1);
  }
}

// ============================================================================
// Player spawn, save tombs, and skill tombs
// ============================================================================

export function drawEditorSpawnAndTombs(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  state: EditorState,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  // Player spawn marker
  {
    const sel = isSelected('playerSpawn', 0);
    drawMarker(ctx, room.playerSpawnBlock[0], room.playerSpawnBlock[1], offsetXPx, offsetYPx, zoom,
      sel ? SPAWN_SELECTED : SPAWN_COLOR, '🏠');
  }

  // Save tombs
  for (const s of room.saveTombs) {
    const sel = isSelected('saveTomb', s.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'saveTomb' && state.hoverElement.uid === s.uid;
    const color = sel ? TOMB_SELECTED : TOMB_COLOR;
    drawObjectFootprint(ctx, s.xBlock, s.yBlock,
      SAVE_TOMB_FOOTPRINT_W_BLOCKS, SAVE_TOMB_FOOTPRINT_H_BLOCKS,
      offsetXPx, offsetYPx, zoom, color, sel || isHovered ? 2 : 1);
    drawMarker(ctx, s.xBlock, s.yBlock, offsetXPx, offsetYPx, zoom, color, '⛩');
  }

  // Skill tombs (dust skill unlocks)
  for (const s of room.skillTombs) {
    const sel = isSelected('skillTomb', s.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'skillTomb' && state.hoverElement.uid === s.uid;
    const color = sel ? SKILL_TOMB_SELECTED : SKILL_TOMB_COLOR;
    drawObjectFootprint(ctx, s.xBlock, s.yBlock,
      SKILL_TOMB_FOOTPRINT_W_BLOCKS, SKILL_TOMB_FOOTPRINT_H_BLOCKS,
      offsetXPx, offsetYPx, zoom, color, sel || isHovered ? 2 : 1);
    drawMarker(ctx, s.xBlock, s.yBlock, offsetXPx, offsetYPx, zoom, color, '✦');
  }
}

// ============================================================================
// Collectibles: dust containers, container pieces, boost jars, dust piles
// ============================================================================

export function drawEditorCollectibles(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  state: EditorState,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  // Dust containers (+4 capacity each)
  for (const c of (room.dustContainers ?? [])) {
    const sel = isSelected('dustContainer', c.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'dustContainer' && state.hoverElement.uid === c.uid;
    const color = sel ? DUST_CONTAINER_SELECTED : DUST_CONTAINER_COLOR;
    drawObjectFootprint(ctx, c.xBlock, c.yBlock, 1, 1,
      offsetXPx, offsetYPx, zoom, color, sel || isHovered ? 2 : 1);
    drawMarker(ctx, c.xBlock, c.yBlock, offsetXPx, offsetYPx, zoom, color, '◈');
  }

  // Dust container pieces (accumulate toward a full container)
  for (const c of (room.dustContainerPieces ?? [])) {
    const sel = isSelected('dustContainerPiece', c.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'dustContainerPiece' && state.hoverElement.uid === c.uid;
    const color = sel ? DUST_CONTAINER_PIECE_SELECTED : DUST_CONTAINER_PIECE_COLOR;
    drawObjectFootprint(ctx, c.xBlock, c.yBlock, 1, 1,
      offsetXPx, offsetYPx, zoom, color, sel || isHovered ? 2 : 1);
    drawMarker(ctx, c.xBlock, c.yBlock, offsetXPx, offsetYPx, zoom, color, '◇');
  }

  // Dust boost jars (grant temporary dust of specific kind)
  for (const j of (room.dustBoostJars ?? [])) {
    const sel = isSelected('dustBoostJar', j.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'dustBoostJar' && state.hoverElement.uid === j.uid;
    const color = sel ? DUST_BOOST_JAR_SELECTED : DUST_BOOST_JAR_COLOR;
    drawObjectFootprint(ctx, j.xBlock, j.yBlock, 1, 1,
      offsetXPx, offsetYPx, zoom, color, sel || isHovered ? 2 : 1);
    drawMarker(ctx, j.xBlock, j.yBlock, offsetXPx, offsetYPx, zoom, color, '⬡');
  }

  // Dust piles (unowned Gold Dust for Storm Weave attraction)
  for (const p of room.dustPiles) {
    const sel = isSelected('dustPile', p.uid);
    drawMarker(ctx, p.xBlock, p.yBlock, offsetXPx, offsetYPx, zoom,
      sel ? 'rgba(255,215,0,0.8)' : 'rgba(255,215,0,0.4)', '✦');
  }
}

// ============================================================================
// Critter spawn areas: grasshoppers and fireflies
// ============================================================================

export function drawEditorCritterAreas(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  // Grasshopper areas
  for (const a of room.grasshopperAreas) {
    const sel = isSelected('grasshopperArea', a.uid);
    const xPx = a.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = a.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = a.wBlock * BLOCK_SIZE_SMALL * zoom;
    const hPx = a.hBlock * BLOCK_SIZE_SMALL * zoom;
    ctx.fillStyle = sel ? GRASSHOPPER_SELECTED : GRASSHOPPER_COLOR;
    ctx.fillRect(xPx, yPx, wPx, hPx);
    ctx.strokeStyle = sel ? 'rgba(100,220,100,0.85)' : 'rgba(100,200,100,0.50)';
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(xPx, yPx, wPx, hPx);
    ctx.fillStyle = 'rgba(180,255,180,0.75)';
    ctx.font = `${Math.max(8, BLOCK_SIZE_SMALL * zoom * 0.7)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🦗', xPx + wPx * 0.5, yPx + hPx * 0.5);
  }

  // Firefly areas
  for (const a of (room.fireflyAreas ?? [])) {
    const sel = isSelected('fireflyArea', a.uid);
    const xPx = a.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = a.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = a.wBlock * BLOCK_SIZE_SMALL * zoom;
    const hPx = a.hBlock * BLOCK_SIZE_SMALL * zoom;
    ctx.fillStyle = sel ? FIREFLY_SELECTED : FIREFLY_COLOR;
    ctx.fillRect(xPx, yPx, wPx, hPx);
    ctx.strokeStyle = sel ? 'rgba(255,230,80,0.85)' : 'rgba(255,220,60,0.50)';
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(xPx, yPx, wPx, hPx);
    ctx.fillStyle = 'rgba(255,255,180,0.75)';
    ctx.font = `${Math.max(8, BLOCK_SIZE_SMALL * zoom * 0.7)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✨', xPx + wPx * 0.5, yPx + hPx * 0.5);
  }
}

// ============================================================================
// Lighting: ambient light blockers and light sources
// ============================================================================

export function drawEditorLightingOverlays(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  // Ambient light blockers
  for (const b of (room.ambientLightBlockers ?? [])) {
    const sel = isSelected('ambientLightBlocker', b.uid);
    const isDark = b.isDarkFlag === 1;
    ctx.fillStyle = isDark ? 'rgba(0, 0, 0, 0.65)' : 'rgba(120, 60, 200, 0.35)';
    const xPx = b.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = b.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const sizePx = BLOCK_SIZE_SMALL * zoom;
    ctx.fillRect(xPx, yPx, sizePx, sizePx);
    ctx.strokeStyle = sel
      ? 'rgba(255, 255, 255, 1.0)'
      : (isDark ? 'rgba(90, 90, 90, 0.9)' : 'rgba(180, 120, 255, 0.85)');
    ctx.lineWidth = sel ? 2 : 1;
    ctx.strokeRect(xPx, yPx, sizePx, sizePx);
  }

  // Light sources (range circle + center marker)
  for (const l of (room.lightSources ?? [])) {
    const sel = isSelected('lightSource', l.uid);
    const centerXPx = (l.xBlock + 0.5) * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const centerYPx = (l.yBlock + 0.5) * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const rangeRadiusPx = l.radiusBlocks * BLOCK_SIZE_SMALL * zoom;
    ctx.save();
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = `rgba(${l.colorR}, ${l.colorG}, ${l.colorB}, 0.6)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerXPx, centerYPx, rangeRadiusPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.fillStyle = `rgb(${l.colorR}, ${l.colorG}, ${l.colorB})`;
    ctx.beginPath();
    ctx.arc(centerXPx, centerYPx, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = sel ? 'rgba(255, 255, 255, 1.0)' : 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = sel ? 2 : 1;
    ctx.beginPath();
    ctx.arc(centerXPx, centerYPx, 3, 0, Math.PI * 2);
    ctx.stroke();
  }
}

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

// ============================================================================
// Decorations, falling blocks
// ============================================================================

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
// Placement preview and UI overlays are in editorPlacementPreviewDrawer.ts
// ============================================================================
