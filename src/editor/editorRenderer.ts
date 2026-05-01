/**
 * Editor renderer — draws overlays for grid, placement preview,
 * selection highlights, transition zones, enemy markers, and
 * other editor visual feedback on the 2D canvas.
 */

import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import type { EditorState, EditorWall } from './editorState';
import { EditorTool } from './editorState';
import { getPlacementPreview, findFloorBlockRow, findCeilingBlockRow } from './editorTools';
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
  PREVIEW_COLOR, PREVIEW_RAMP_COLOR, PREVIEW_PLATFORM_COLOR, PREVIEW_PILLAR_HALF_COLOR,
  CURSOR_COLOR, SELECTION_BOX_COLOR, SELECTION_BOX_BORDER,
  GRASSHOPPER_COLOR, GRASSHOPPER_SELECTED,
  FIREFLY_COLOR, FIREFLY_SELECTED,
  ROPE_COLOR, ROPE_SELECTED, ROPE_PREVIEW_COLOR, ROPE_ANCHOR_COLOR,
  CRUMBLE_VARIANT_CRACK_COLOR,
  SAVE_TOMB_FOOTPRINT_W_BLOCKS, SAVE_TOMB_FOOTPRINT_H_BLOCKS,
  SKILL_TOMB_FOOTPRINT_W_BLOCKS, SKILL_TOMB_FOOTPRINT_H_BLOCKS,
  DUST_CONTAINER_COLOR, DUST_CONTAINER_SELECTED,
  DUST_CONTAINER_PIECE_COLOR, DUST_CONTAINER_PIECE_SELECTED,
  DUST_BOOST_JAR_COLOR, DUST_BOOST_JAR_SELECTED,
  getDirectionVector, buildElementTooltipId, buildElementTypeName,
  drawHoverTooltip, drawGrid, drawBlockRect, drawRampTriangle,
  drawPlatformLine, drawHalfPillarRect, drawMarker, drawObjectFootprint,
  getEnemyFootprintBlocks, drawTransitionZone,
} from './editorRendererHelpers';

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
    const enemyFootprint = getEnemyFootprintBlocks(e);
    if (enemyFootprint !== null) {
      const isHovered = state.hoverElement !== null &&
        state.hoverElement.type === 'enemy' && state.hoverElement.uid === e.uid;
      drawObjectFootprint(ctx, e.xBlock, e.yBlock,
        enemyFootprint.wBlock, enemyFootprint.hBlock,
        offsetXPx, offsetYPx, zoom,
        isSelected ? ENEMY_SELECTED : ENEMY_COLOR,
        isSelected || isHovered ? 2 : 1);
    }
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
    else if (t.isSecretDoor) color = isSelected ? SECRET_DOOR_SELECTED : SECRET_DOOR_COLOR;
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

  // ── Dust containers (collectibles, +4 capacity) ─────────────────────────
  for (const c of (room.dustContainers ?? [])) {
    const isSelected = isElementSelected('dustContainer', c.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'dustContainer' && state.hoverElement.uid === c.uid;
    const color = isSelected ? DUST_CONTAINER_SELECTED : DUST_CONTAINER_COLOR;
    drawObjectFootprint(ctx, c.xBlock, c.yBlock, 1, 1,
      offsetXPx, offsetYPx, zoom, color, isSelected || isHovered ? 2 : 1);
    drawMarker(ctx, c.xBlock, c.yBlock, offsetXPx, offsetYPx, zoom, color, '◈');
  }

  // ── Dust container pieces (collectibles, accumulate toward full container) ─
  for (const c of (room.dustContainerPieces ?? [])) {
    const isSelected = isElementSelected('dustContainerPiece', c.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'dustContainerPiece' && state.hoverElement.uid === c.uid;
    const color = isSelected ? DUST_CONTAINER_PIECE_SELECTED : DUST_CONTAINER_PIECE_COLOR;
    drawObjectFootprint(ctx, c.xBlock, c.yBlock, 1, 1,
      offsetXPx, offsetYPx, zoom, color, isSelected || isHovered ? 2 : 1);
    drawMarker(ctx, c.xBlock, c.yBlock, offsetXPx, offsetYPx, zoom, color, '◇');
  }

  // ── Dust boost jars (objects, grant temporary dust of specific kind) ─────
  for (const j of (room.dustBoostJars ?? [])) {
    const isSelected = isElementSelected('dustBoostJar', j.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'dustBoostJar' && state.hoverElement.uid === j.uid;
    const color = isSelected ? DUST_BOOST_JAR_SELECTED : DUST_BOOST_JAR_COLOR;
    drawObjectFootprint(ctx, j.xBlock, j.yBlock, 1, 1,
      offsetXPx, offsetYPx, zoom, color, isSelected || isHovered ? 2 : 1);
    drawMarker(ctx, j.xBlock, j.yBlock, offsetXPx, offsetYPx, zoom, color, '⬡');
  }

  // ── Dust piles ──────────────────────────────────────────────────────────
  for (const p of room.dustPiles) {
    const isSelected = isElementSelected('dustPile', p.uid);
    drawMarker(ctx, p.xBlock, p.yBlock, offsetXPx, offsetYPx, zoom,
      isSelected ? 'rgba(255,215,0,0.8)' : 'rgba(255,215,0,0.4)', '✦');
  }

  // ── Grasshopper areas ───────────────────────────────────────────────────────
  for (const a of room.grasshopperAreas) {
    const isSelected = isElementSelected('grasshopperArea', a.uid);
    const xPx = a.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = a.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = a.wBlock * BLOCK_SIZE_SMALL * zoom;
    const hPx = a.hBlock * BLOCK_SIZE_SMALL * zoom;
    ctx.fillStyle = isSelected ? GRASSHOPPER_SELECTED : GRASSHOPPER_COLOR;
    ctx.fillRect(xPx, yPx, wPx, hPx);
    ctx.strokeStyle = isSelected ? 'rgba(100,220,100,0.85)' : 'rgba(100,200,100,0.50)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(xPx, yPx, wPx, hPx);
    ctx.fillStyle = 'rgba(180,255,180,0.75)';
    ctx.font = `${Math.max(8, BLOCK_SIZE_SMALL * zoom * 0.7)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🦗', xPx + wPx * 0.5, yPx + hPx * 0.5);
  }

  // ── Firefly areas ────────────────────────────────────────────────────────────
  for (const a of (room.fireflyAreas ?? [])) {
    const isSelected = isElementSelected('fireflyArea', a.uid);
    const xPx = a.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = a.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = a.wBlock * BLOCK_SIZE_SMALL * zoom;
    const hPx = a.hBlock * BLOCK_SIZE_SMALL * zoom;
    ctx.fillStyle = isSelected ? FIREFLY_SELECTED : FIREFLY_COLOR;
    ctx.fillRect(xPx, yPx, wPx, hPx);
    ctx.strokeStyle = isSelected ? 'rgba(255,230,80,0.85)' : 'rgba(255,220,60,0.50)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(xPx, yPx, wPx, hPx);
    ctx.fillStyle = 'rgba(255,255,180,0.75)';
    ctx.font = `${Math.max(8, BLOCK_SIZE_SMALL * zoom * 0.7)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✨', xPx + wPx * 0.5, yPx + hPx * 0.5);
  }

  // ── Ambient Light Blockers (before decorations so icons draw on top) ─────
  for (const b of (room.ambientLightBlockers ?? [])) {
    const isSelected = isElementSelected('ambientLightBlocker', b.uid);
    const isDark = b.isDarkFlag === 1;
    // Dark blockers: near-opaque black fill with a dark grey stroke.
    // Clear blockers: purple translucent fill.
    ctx.fillStyle = isDark ? 'rgba(0, 0, 0, 0.65)' : 'rgba(120, 60, 200, 0.35)';
    const xPx = b.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = b.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const sizePx = BLOCK_SIZE_SMALL * zoom;
    ctx.fillRect(xPx, yPx, sizePx, sizePx);
    // Stroke
    ctx.strokeStyle = isSelected
      ? 'rgba(255, 255, 255, 1.0)'
      : (isDark ? 'rgba(90, 90, 90, 0.9)' : 'rgba(180, 120, 255, 0.85)');
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(xPx, yPx, sizePx, sizePx);
  }

  // ── Light Sources (before decorations so icons draw on top) ──────────────
  for (const l of (room.lightSources ?? [])) {
    const isSelected = isElementSelected('lightSource', l.uid);
    const centerXPx = (l.xBlock + 0.5) * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const centerYPx = (l.yBlock + 0.5) * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    // Draw range circle (dashed)
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

  // ── Water zones ──────────────────────────────────────────────────────────
  for (const z of (room.waterZones ?? [])) {
    const isSelected = isElementSelected('waterZone', z.uid);
    const xPx = z.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = z.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = z.wBlock * BLOCK_SIZE_SMALL * zoom;
    const hPx = z.hBlock * BLOCK_SIZE_SMALL * zoom;
    ctx.fillStyle = isSelected ? 'rgba(80,160,255,0.30)' : 'rgba(60,120,220,0.18)';
    ctx.fillRect(xPx, yPx, wPx, hPx);
    ctx.strokeStyle = isSelected ? 'rgba(80,180,255,0.85)' : 'rgba(80,160,255,0.50)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(xPx, yPx, wPx, hPx);
    ctx.fillStyle = 'rgba(160,210,255,0.75)';
    ctx.font = `${Math.max(8, BLOCK_SIZE_SMALL * zoom * 0.7)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💧', xPx + wPx * 0.5, yPx + hPx * 0.5);
  }

  // ── Lava zones ───────────────────────────────────────────────────────────
  for (const z of (room.lavaZones ?? [])) {
    const isSelected = isElementSelected('lavaZone', z.uid);
    const xPx = z.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = z.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = z.wBlock * BLOCK_SIZE_SMALL * zoom;
    const hPx = z.hBlock * BLOCK_SIZE_SMALL * zoom;
    ctx.fillStyle = isSelected ? 'rgba(255,100,20,0.30)' : 'rgba(220,60,10,0.18)';
    ctx.fillRect(xPx, yPx, wPx, hPx);
    ctx.strokeStyle = isSelected ? 'rgba(255,120,30,0.85)' : 'rgba(220,90,20,0.50)';
    ctx.lineWidth = isSelected ? 2 : 1;
    ctx.strokeRect(xPx, yPx, wPx, hPx);
    ctx.fillStyle = 'rgba(255,180,60,0.75)';
    ctx.font = `${Math.max(8, BLOCK_SIZE_SMALL * zoom * 0.7)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔥', xPx + wPx * 0.5, yPx + hPx * 0.5);
  }

  // ── Crumble blocks ───────────────────────────────────────────────────────
  for (const b of (room.crumbleBlocks ?? [])) {
    const isSelected = isElementSelected('crumbleBlock', b.uid);
    const wBlocks = b.wBlock ?? 1;
    const hBlocks = b.hBlock ?? 1;
    const xPx = b.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = b.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = wBlocks * BLOCK_SIZE_SMALL * zoom;
    const hPx = hBlocks * BLOCK_SIZE_SMALL * zoom;

    // Block fill
    ctx.fillStyle = isSelected ? 'rgba(210,180,100,0.40)' : 'rgba(210,180,100,0.22)';
    if (b.rampOrientation !== undefined) {
      // Draw ramp triangle shape
      ctx.beginPath();
      switch (b.rampOrientation) {
        case 0: ctx.moveTo(xPx, yPx + hPx); ctx.lineTo(xPx + wPx, yPx + hPx); ctx.lineTo(xPx + wPx, yPx); break;
        case 1: ctx.moveTo(xPx, yPx + hPx); ctx.lineTo(xPx + wPx, yPx + hPx); ctx.lineTo(xPx, yPx); break;
        case 2: ctx.moveTo(xPx, yPx); ctx.lineTo(xPx + wPx, yPx); ctx.lineTo(xPx + wPx, yPx + hPx); break;
        case 3: ctx.moveTo(xPx, yPx); ctx.lineTo(xPx + wPx, yPx); ctx.lineTo(xPx, yPx + hPx); break;
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = isSelected ? 'rgba(220,160,50,0.90)' : 'rgba(200,150,60,0.55)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();
    } else {
      ctx.fillRect(xPx, yPx, wPx, hPx);
      ctx.strokeStyle = isSelected ? 'rgba(220,160,50,0.90)' : 'rgba(200,150,60,0.55)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(xPx, yPx, wPx, hPx);
    }

    // Crack overlay — same zigzag geometry, color indicates elemental weakness
    const crackColor = CRUMBLE_VARIANT_CRACK_COLOR[b.variant ?? 'normal'];
    ctx.strokeStyle = crackColor;
    ctx.lineWidth = Math.max(1, zoom * 0.7);
    ctx.beginPath();
    // Central zigzag crack
    const cx = xPx + wPx * 0.5;
    const cy = yPx + hPx * 0.5;
    ctx.moveTo(cx - wPx * 0.15, yPx + hPx * 0.1);
    ctx.lineTo(cx + wPx * 0.05, cy - hPx * 0.1);
    ctx.lineTo(cx - wPx * 0.05, cy + hPx * 0.1);
    ctx.lineTo(cx + wPx * 0.15, yPx + hPx * 0.9);
    // Short branch crack
    ctx.moveTo(cx + wPx * 0.05, cy - hPx * 0.1);
    ctx.lineTo(cx + wPx * 0.25, cy - hPx * 0.25);
    ctx.stroke();
  }

  // ── Bounce pads ──────────────────────────────────────────────────────────
  for (const b of (room.bouncePads ?? [])) {
    const isSelected = isElementSelected('bouncePad', b.uid);
    const xPx = b.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const yPx = b.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const wPx = b.wBlock * BLOCK_SIZE_SMALL * zoom;
    const hPx = b.hBlock * BLOCK_SIZE_SMALL * zoom;

    const fillAlpha = isSelected ? 0.45 : 0.25;
    const strokeAlpha = isSelected ? 1.0 : 0.65;
    // Dim (50%): orange-red; Bright (100%): bright orange
    const fillColor = b.speedFactorIndex === 1
      ? `rgba(200,80,10,${fillAlpha})`
      : `rgba(140,50,5,${fillAlpha})`;
    const strokeColor = b.speedFactorIndex === 1
      ? `rgba(255,140,30,${strokeAlpha})`
      : `rgba(220,90,15,${strokeAlpha})`;

    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = isSelected ? 2 : 1;

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

    // Core indicator: a small bright dot in the center
    const dotR = (b.speedFactorIndex === 1 ? 3 : 2) * zoom;
    const dotX = xPx + wPx * 0.5;
    const dotY = yPx + hPx * 0.5;
    ctx.fillStyle = b.speedFactorIndex === 1 ? 'rgba(255,200,50,0.90)' : 'rgba(255,110,20,0.75)';
    ctx.fillRect(dotX - dotR * 0.5, dotY - dotR * 0.5, dotR, dotR);

    // Label
    ctx.fillStyle = 'rgba(255,180,60,0.85)';
    ctx.font = `bold ${Math.max(7, zoom * 3.5)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(b.speedFactorIndex === 1 ? '⟳100%' : '⟳50%', dotX, dotY + dotR + zoom * 3);
  }

  // ── Decorations ──────────────────────────────────────────────────────────
  for (const d of (room.decorations ?? [])) {
    const isSelected = isElementSelected('decoration', d.uid);
    const emoji = d.kind === 'mushroom' ? '🍄' : d.kind === 'glowGrass' ? '🌿' : '🌱';
    const color = isSelected ? 'rgba(80,220,130,0.9)' : 'rgba(60,170,90,0.55)';
    drawMarker(ctx, d.xBlock, d.yBlock, offsetXPx, offsetYPx, zoom, color, emoji);
  }

  // ── Ropes ─────────────────────────────────────────────────────────────────
  for (const r of (room.ropes ?? [])) {
    const isSelected = isElementSelected('rope', r.uid);
    const lineColor = isSelected ? ROPE_SELECTED : ROPE_COLOR;
    const ax = r.anchorAXBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const ay = r.anchorAYBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const bx = r.anchorBXBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const by = r.anchorBYBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    ctx.save();
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
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
  // Rope placement preview: show first anchor already placed
  if (
    state.activeTool === EditorTool.Place &&
    state.selectedPaletteItem?.category === 'ropes' &&
    state.pendingRopeAnchorXBlock !== null
  ) {
    const ax = state.pendingRopeAnchorXBlock! * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const ay = state.pendingRopeAnchorYBlock! * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const bx = state.cursorBlockX * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const by = state.cursorBlockY * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    ctx.save();
    ctx.strokeStyle = ROPE_PREVIEW_COLOR;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ROPE_ANCHOR_COLOR;
    ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.arc(ax, ay, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
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
      } else if (item.isCrumbleBlockItem === 1) {
        // Crumble block preview — draw block shape then crack overlay in variant color
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
        // Draw variant crack overlay
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
      } else if (item.isBouncePadItem === 1) {
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
      } else if (item.id === 'enemy_rolling' || item.id === 'enemy_beetle' || item.id === 'enemy_rock_elemental' || item.id === 'enemy_radiant_tether') {
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
      } else if (item.isDustContainerItem === 1 || item.id === 'dust_container') {
        drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY, 1, 1,
          offsetXPx, offsetYPx, zoom, 'rgba(80,220,255,0.25)', 2);
        drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
          'rgba(80,220,255,0.45)', '◈');
      } else if (item.isDustContainerPieceItem === 1 || item.id === 'dust_container_piece') {
        drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY, 1, 1,
          offsetXPx, offsetYPx, zoom, 'rgba(130,200,255,0.25)', 2);
        drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
          'rgba(130,200,255,0.45)', '◇');
      } else if (item.isDustBoostJarItem === 1 || item.id === 'dust_boost_jar') {
        drawObjectFootprint(ctx, state.cursorBlockX, state.cursorBlockY, 1, 1,
          offsetXPx, offsetYPx, zoom, 'rgba(200,100,255,0.25)', 2);
        drawMarker(ctx, state.cursorBlockX, state.cursorBlockY, offsetXPx, offsetYPx, zoom,
          'rgba(200,100,255,0.45)', '⬡');
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
