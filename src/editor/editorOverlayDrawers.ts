/**
 * Editor overlay draw helpers — one function per element-type group.
 *
 * Each function is responsible for rendering a specific category of room
 * elements as editor overlays on the 2D canvas.  All functions share the same
 * core parameter set: (ctx, room, state, isSelected, offsetXPx, offsetYPx, zoom).
 * Functions that don't need every parameter simply omit those they don't use.
 *
 * Called by renderEditorOverlays in editorRenderer.ts.
 * Zone/environment draw functions live in editorZoneDrawers.ts.
 */

import { BLOCK_SIZE_SMALL } from '../levels/roomDef';
import type { EditorState, EditorRoomData } from './editorState';
import { rawIdFromNamespaced } from '../levels/customBlocks';
import { getOrFallbackSprite, drawCustomBlockSprite } from '../render/customBlockSpriteCache';
import {
  WALL_HIGHLIGHT, WALL_SELECTED,
  PLATFORM_HIGHLIGHT, PLATFORM_SELECTED,
  RAMP_HIGHLIGHT, RAMP_SELECTED,
  STAIRS_HIGHLIGHT, STAIRS_SELECTED,
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
  SAVE_TOMB_FOOTPRINT_W_BLOCKS, SAVE_TOMB_FOOTPRINT_H_BLOCKS,
  SKILL_TOMB_FOOTPRINT_W_BLOCKS, SKILL_TOMB_FOOTPRINT_H_BLOCKS,
  DUST_CONTAINER_FOOTPRINT_W_BLOCKS, DUST_CONTAINER_FOOTPRINT_H_BLOCKS,
  DUST_CONTAINER_SHARD_FOOTPRINT_W_BLOCKS, DUST_CONTAINER_SHARD_FOOTPRINT_H_BLOCKS,
  DUST_CONTAINER_COLOR, DUST_CONTAINER_SELECTED,
  DUST_CONTAINER_PIECE_COLOR, DUST_CONTAINER_PIECE_SELECTED,
  DUST_BOOST_JAR_COLOR, DUST_BOOST_JAR_SELECTED,
  DUST_SWARM_COLOR, DUST_SWARM_SELECTED,
  CAMPAIGN_SPAWN_COLOR, CAMPAIGN_SPAWN_SELECTED,
  drawMergedWallOutline, drawWallTileGrid, drawRampTriangle, drawStairsShape,
  drawPlatformLine, drawHalfPillarRect, drawMarker, drawObjectFootprint,
  getEnemyFootprintBlocks, drawTransitionZone,
} from './editorRendererHelpers';
import type { IsElementSelected } from './editorZoneDrawers';

// Re-export zone/environment draw helpers and the shared IsElementSelected type
// so callers can import everything from this single file.
export type { IsElementSelected } from './editorZoneDrawers';
export {
  drawEditorLiquidZones,
  drawEditorTimeStopFields,
  drawEditorCrumbleBlocks,
  drawEditorSpikes,
  drawEditorBouncePads,
  drawEditorKineticBlocks,
  drawEditorGrappleCarryBlocks,
  drawEditorZipMoveBlocks,
  drawEditorPhantasmalTiles,
  drawEditorPixelMaterials,
  drawEditorEnvironmentItems,
  drawEditorRopes,
  drawEditorDialogueTriggers,
  drawEditorBackgroundBlocks,
  drawEditorGuideDustPaths,
} from './editorZoneDrawers';

// ============================================================================
// Interior walls (solid, platform, stairs, legacy ramp, half-pillar)
// ============================================================================

export function drawEditorWalls(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  // Precompute which cells are covered by a solid (non-shaped, non-platform,
  // non-half-pillar) wall so adjacent solid blocks can share a single merged
  // outline instead of each drawing its own per-cell border. Also track which
  // wall instance (uid) owns each cell so the per-tile grid can distinguish
  // real instance boundaries (e.g. a 2×2 block next to separate 1×1 blocks)
  // from cells that merely belong to the same multi-cell instance.
  const occupied = new Set<string>();
  const cellOwner = new Map<string, number>();
  for (const w of room.interiorWalls) {
    if (w.isPlatformFlag === 1 || w.rampOrientation !== undefined || w.stairsOrientation !== undefined || w.isPillarHalfWidthFlag === 1) continue;
    for (let dy = 0; dy < w.hBlock; dy++) {
      for (let dx = 0; dx < w.wBlock; dx++) {
        const key = `${w.xBlock + dx},${w.yBlock + dy}`;
        occupied.add(key);
        cellOwner.set(key, w.uid);
      }
    }
  }

  for (const w of room.interiorWalls) {
    const sel = isSelected('wall', w.uid);
    const isPlatform = w.isPlatformFlag === 1;
    const isStairs = w.stairsOrientation !== undefined;
    const isRamp = w.rampOrientation !== undefined;
    const isHalfPillar = w.isPillarHalfWidthFlag === 1;

    if (isStairs) {
      const color = sel ? STAIRS_SELECTED : STAIRS_HIGHLIGHT;
      drawStairsShape(ctx, w, offsetXPx, offsetYPx, zoom, color, sel ? 2 : 1);
    } else if (isRamp) {
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
      drawMergedWallOutline(ctx, occupied, w.xBlock, w.yBlock, w.wBlock, w.hBlock, offsetXPx, offsetYPx, zoom, color, sel ? 2 : 1);
    }
  }

  // Subtle per-tile grid on top of the fills/outlines so individual tile
  // boundaries stay visible inside merged blocks (a decorating aid).
  drawWallTileGrid(ctx, cellOwner, offsetXPx, offsetYPx, zoom);
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
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'transition' && state.hoverElement.uid === t.uid;
    let color = TRANSITION_COLOR;
    if (isLinkSource) color = TRANSITION_LINK_SOURCE;
    else if (isLinkCandidate) color = TRANSITION_LINK_CANDIDATE;
    else if (t.isSecretDoor) color = sel ? SECRET_DOOR_SELECTED : SECRET_DOOR_COLOR;
    else if (sel) color = TRANSITION_SELECTED;
    drawTransitionZone(ctx, t, room, offsetXPx, offsetYPx, zoom, color, tIndex + 1, isHovered || sel, sel);
  }
}

// ============================================================================
// Player spawn, save tombs, and skill tombs
// ============================================================================

type SpawnAndTombsElementType =
  'campaignSpawn' | 'playerSpawn' | 'saveTomb' | 'skillTomb' |
  'challengeField' | 'challengeGate' | 'challengeTotem' | 'gate';

export function drawEditorSpawnAndTombs(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  state: EditorState,
  isSelected: IsElementSelected,
  isTypeVisible: (type: SpawnAndTombsElementType) => boolean,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  // Campaign spawn marker — drawn first so room spawn overlaps it slightly (clear priority)
  if (isTypeVisible('campaignSpawn') && state.campaignSpawnBlock !== null) {
    const [csx, csy] = state.campaignSpawnBlock;
    const sel = isSelected('campaignSpawn', 0);
    const color = sel ? CAMPAIGN_SPAWN_SELECTED : CAMPAIGN_SPAWN_COLOR;
    // Draw a slightly larger footprint to distinguish from room spawn
    drawObjectFootprint(ctx, csx, csy, 1, 1, offsetXPx, offsetYPx, zoom, color, sel ? 2 : 1);
    drawMarker(ctx, csx, csy, offsetXPx, offsetYPx, zoom, color, '⭐');
    // Label "CSPAWN" below the star when selected or hovered
    const isHovered = state.hoverElement !== null && state.hoverElement.type === 'campaignSpawn';
    if (sel || isHovered) {
      const bs = BLOCK_SIZE_SMALL;
      const px = Math.round(csx * bs * zoom + offsetXPx + bs * zoom * 0.5);
      const py = Math.round((csy + 1) * bs * zoom + offsetYPx + 2);
      ctx.save();
      ctx.font = `bold ${Math.max(7, Math.round(7 * zoom))}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = CAMPAIGN_SPAWN_SELECTED;
      ctx.fillText('CAMPAIGN SPAWN', px, py);
      ctx.restore();
    }
  }

  // Player spawn marker (room-local fallback)
  if (isTypeVisible('playerSpawn')) {
    const sel = isSelected('playerSpawn', 0);
    drawMarker(ctx, room.playerSpawnBlock[0], room.playerSpawnBlock[1], offsetXPx, offsetYPx, zoom,
      sel ? SPAWN_SELECTED : SPAWN_COLOR, '🏠');
  }

  // Save tombs
  if (isTypeVisible('saveTomb')) for (const s of room.saveTombs) {
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
  if (isTypeVisible('skillTomb')) for (const s of room.skillTombs) {
    const sel = isSelected('skillTomb', s.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'skillTomb' && state.hoverElement.uid === s.uid;
    const color = sel ? SKILL_TOMB_SELECTED : SKILL_TOMB_COLOR;
    drawObjectFootprint(ctx, s.xBlock, s.yBlock,
      SKILL_TOMB_FOOTPRINT_W_BLOCKS, SKILL_TOMB_FOOTPRINT_H_BLOCKS,
      offsetXPx, offsetYPx, zoom, color, sel || isHovered ? 2 : 1);
    drawMarker(ctx, s.xBlock, s.yBlock, offsetXPx, offsetYPx, zoom, color, '✦');
  }
  for (const [kind, elements, fill, label] of [
    ['challengeField', room.challengeFields ?? [], 'rgba(155,70,255,0.34)', 'C'],
    ['challengeGate', room.challengeGates ?? [], 'rgba(120,70,180,0.58)', 'S'],
  ] as const) {
    if (!isTypeVisible(kind)) continue;
    for (const element of elements) {
      const selected = isSelected(kind, element.uid);
      const x = element.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
      const y = element.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
      const w = element.wBlock * BLOCK_SIZE_SMALL * zoom;
      const h = element.hBlock * BLOCK_SIZE_SMALL * zoom;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = selected ? '#ffffff' : '#d7a3ff';
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = '#ffffff';
      ctx.font = `${Math.max(8, Math.round(10 * zoom))}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(label, x + w * 0.5, y + h * 0.5 + 3 * zoom);
    }
  }
  if (isTypeVisible('challengeTotem')) for (const totem of room.challengeTotems ?? []) {
    const selected = isSelected('challengeTotem', totem.uid);
    drawMarker(ctx, totem.xBlock, totem.yBlock, offsetXPx, offsetYPx, zoom, selected ? '#ffd85a' : '#b85cff', 'C');
  }
  const gatePreview = {
    enemy: ['rgba(194,145,151,0.78)', 'X'], challenge: ['rgba(220,196,125,0.78)', 'S'],
    heart: ['rgba(227,174,186,0.78)', 'H'], speed: ['rgba(151,207,220,0.78)', '>'],
  } as const;
  if (isTypeVisible('gate')) for (const gate of room.gates ?? []) {
    const selected = isSelected('gate', gate.uid);
    const [fill, label] = gatePreview[gate.kind];
    const x = gate.xBlock * BLOCK_SIZE_SMALL * zoom + offsetXPx;
    const y = gate.yBlock * BLOCK_SIZE_SMALL * zoom + offsetYPx;
    const w = gate.wBlock * BLOCK_SIZE_SMALL * zoom;
    const h = gate.hBlock * BLOCK_SIZE_SMALL * zoom;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = selected ? '#fff' : '#eef4f5';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(x, y, w, h);
    if (selected) {
      ctx.fillStyle = '#fff';
      const size = Math.max(3, 4 * zoom);
      for (const [hx, hy] of [[x, y], [x + w * 0.5, y], [x + w, y], [x, y + h * 0.5], [x + w, y + h * 0.5], [x, y + h], [x + w * 0.5, y + h], [x + w, y + h]]) {
        ctx.fillRect(hx - size * 0.5, hy - size * 0.5, size, size);
      }
    }
    ctx.fillStyle = '#272b31';
    ctx.font = `bold ${Math.max(8, Math.round(Math.min(14, 10 * zoom)))}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w * 0.5, y + h * 0.5 + 3 * zoom);
  }
}

// ============================================================================
// Collectibles: dust containers, container pieces, boost jars, dust piles
// ============================================================================

type CollectibleElementType =
  'dustContainer' | 'dustContainerPiece' | 'dustBoostJar' | 'dustSwarm' |
  'lambdaAnchor' | 'fireflyJar' | 'springboard' | 'breakableBlock' | 'dustPile';

export function drawEditorCollectibles(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  state: EditorState,
  isSelected: IsElementSelected,
  isTypeVisible: (type: CollectibleElementType) => boolean,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  // Dust containers (+4 capacity each)
  if (isTypeVisible('dustContainer')) for (const c of (room.dustContainers ?? [])) {
    const sel = isSelected('dustContainer', c.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'dustContainer' && state.hoverElement.uid === c.uid;
    const color = sel ? DUST_CONTAINER_SELECTED : DUST_CONTAINER_COLOR;
    drawObjectFootprint(ctx, c.xBlock, c.yBlock,
      DUST_CONTAINER_FOOTPRINT_W_BLOCKS, DUST_CONTAINER_FOOTPRINT_H_BLOCKS,
      offsetXPx, offsetYPx, zoom, color, sel || isHovered ? 2 : 1);
    drawMarker(ctx, c.xBlock, c.yBlock, offsetXPx, offsetYPx, zoom, color, '◈');
  }

  // Dust container pieces (accumulate toward a full container)
  if (isTypeVisible('dustContainerPiece')) for (const c of (room.dustContainerPieces ?? [])) {
    const sel = isSelected('dustContainerPiece', c.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'dustContainerPiece' && state.hoverElement.uid === c.uid;
    const color = sel ? DUST_CONTAINER_PIECE_SELECTED : DUST_CONTAINER_PIECE_COLOR;
    drawObjectFootprint(ctx, c.xBlock, c.yBlock,
      DUST_CONTAINER_SHARD_FOOTPRINT_W_BLOCKS, DUST_CONTAINER_SHARD_FOOTPRINT_H_BLOCKS,
      offsetXPx, offsetYPx, zoom, color, sel || isHovered ? 2 : 1);
    drawMarker(ctx, c.xBlock, c.yBlock, offsetXPx, offsetYPx, zoom, color, '◇');
  }

  // Dust boost jars (grant temporary dust of specific kind)
  if (isTypeVisible('dustBoostJar')) for (const j of (room.dustBoostJars ?? [])) {
    const sel = isSelected('dustBoostJar', j.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'dustBoostJar' && state.hoverElement.uid === j.uid;
    const color = sel ? DUST_BOOST_JAR_SELECTED : DUST_BOOST_JAR_COLOR;
    drawObjectFootprint(ctx, j.xBlock, j.yBlock, 1, 1,
      offsetXPx, offsetYPx, zoom, color, sel || isHovered ? 2 : 1);
    drawMarker(ctx, j.xBlock, j.yBlock, offsetXPx, offsetYPx, zoom, color, '⬡');
  }

  // Dust swarms (collectible sandstorms — press F to collect)
  if (isTypeVisible('dustSwarm')) for (const s of (room.dustSwarms ?? [])) {
    const sel = isSelected('dustSwarm', s.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'dustSwarm' && state.hoverElement.uid === s.uid;
    const color = sel ? DUST_SWARM_SELECTED : DUST_SWARM_COLOR;
    drawObjectFootprint(ctx, s.xBlock, s.yBlock, 1, 1,
      offsetXPx, offsetYPx, zoom, color, sel || isHovered ? 2 : 1);
    drawMarker(ctx, s.xBlock, s.yBlock, offsetXPx, offsetYPx, zoom, color, '⟳');
  }

  // Lambda Anchors (temporary recall points — press F to link/teleport)
  const LAMBDA_ANCHOR_COLOR    = 'rgba(255, 215, 0, 0.55)';
  const LAMBDA_ANCHOR_SELECTED = 'rgba(255, 235, 80, 0.95)';
  if (isTypeVisible('lambdaAnchor')) for (const a of (room.lambdaAnchors ?? [])) {
    const sel = isSelected('lambdaAnchor', a.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'lambdaAnchor' && state.hoverElement.uid === a.uid;
    const color = sel ? LAMBDA_ANCHOR_SELECTED : LAMBDA_ANCHOR_COLOR;
    drawObjectFootprint(ctx, a.xBlock, a.yBlock, 1, 1,
      offsetXPx, offsetYPx, zoom, color, sel || isHovered ? 2 : 1);
    drawMarker(ctx, a.xBlock, a.yBlock, offsetXPx, offsetYPx, zoom, color, 'λ');
  }

  // Firefly Jars (decorative jar emitting fireflies)
  const FIREFLY_JAR_COLOR    = 'rgba(255, 200, 60, 0.55)';
  const FIREFLY_JAR_SELECTED = 'rgba(255, 225, 120, 0.95)';
  if (isTypeVisible('fireflyJar')) for (const j of (room.fireflyJars ?? [])) {
    const sel = isSelected('fireflyJar', j.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'fireflyJar' && state.hoverElement.uid === j.uid;
    const color = sel ? FIREFLY_JAR_SELECTED : FIREFLY_JAR_COLOR;
    drawObjectFootprint(ctx, j.xBlock, j.yBlock, 1, 1,
      offsetXPx, offsetYPx, zoom, color, sel || isHovered ? 2 : 1);
    drawMarker(ctx, j.xBlock, j.yBlock, offsetXPx, offsetYPx, zoom, color, '✺');
  }

  // Springboards (directional launch pad, distinct from bounce pads)
  const SPRINGBOARD_COLOR    = 'rgba(90, 220, 140, 0.55)';
  const SPRINGBOARD_SELECTED = 'rgba(130, 255, 180, 0.95)';
  if (isTypeVisible('springboard')) for (const s of (room.springboards ?? [])) {
    const sel = isSelected('springboard', s.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'springboard' && state.hoverElement.uid === s.uid;
    const color = sel ? SPRINGBOARD_SELECTED : SPRINGBOARD_COLOR;
    drawObjectFootprint(ctx, s.xBlock, s.yBlock, 1, 1,
      offsetXPx, offsetYPx, zoom, color, sel || isHovered ? 2 : 1);
    drawMarker(ctx, s.xBlock, s.yBlock, offsetXPx, offsetYPx, zoom, color, '⬆');
  }

  // Breakable blocks (generic fracture-on-impact block)
  const BREAKABLE_COLOR    = 'rgba(210, 150, 90, 0.55)';
  const BREAKABLE_SELECTED = 'rgba(240, 190, 130, 0.95)';
  if (isTypeVisible('breakableBlock')) for (const b of (room.breakableBlocks ?? [])) {
    const sel = isSelected('breakableBlock', b.uid);
    const isHovered = state.hoverElement !== null &&
      state.hoverElement.type === 'breakableBlock' && state.hoverElement.uid === b.uid;
    const color = sel ? BREAKABLE_SELECTED : BREAKABLE_COLOR;
    drawObjectFootprint(ctx, b.xBlock, b.yBlock, 1, 1,
      offsetXPx, offsetYPx, zoom, color, sel || isHovered ? 2 : 1);
    drawMarker(ctx, b.xBlock, b.yBlock, offsetXPx, offsetYPx, zoom, color, '✕');
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

// (Liquid zones, crumble blocks, bounce pads, decorations/falling blocks,
//  ropes, dialogue triggers, and background blocks are in editorZoneDrawers.ts
//  and re-exported above.)

// ============================================================================
// Custom blocks
// ============================================================================

export function drawEditorCustomBlocks(
  ctx: CanvasRenderingContext2D,
  room: EditorRoomData,
  isSelected: IsElementSelected,
  offsetXPx: number,
  offsetYPx: number,
  zoom: number,
): void {
  const placements = room.customBlockPlacements ?? [];
  if (placements.length === 0) return;

  const tileSize = BLOCK_SIZE_SMALL * zoom;

  for (const p of placements) {
    const rawId = rawIdFromNamespaced(p.blockId);
    if (rawId === null) continue;
    const sprite = getOrFallbackSprite(rawId, p.tileWidth, p.tileHeight);
    const destX = Math.round(p.xBlock * tileSize + offsetXPx);
    const destY = Math.round(p.yBlock * tileSize + offsetYPx);
    const destW = Math.round(p.tileWidth * tileSize);
    const destH = Math.round(p.tileHeight * tileSize);
    drawCustomBlockSprite(ctx, sprite, destX, destY, destW, destH);

    // Selection / hover outline
    if (isSelected('customBlock', p.uid)) {
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = 2;
      ctx.strokeRect(destX + 1, destY + 1, destW - 2, destH - 2);
    } else {
      ctx.strokeStyle = 'rgba(100,200,255,0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(destX, destY, destW, destH);
    }
  }
}
