/**
 * editorElementLabels.ts — Tooltip ID, type name, and hover tooltip helpers
 * for editor overlay elements.
 *
 * Extracted from editorRendererHelpers.ts to keep label/text concerns separate
 * from geometry drawing primitives.
 */

import type { SelectedElementType, EditorRoomData } from './editorState';
import { WEAVE_REGISTRY } from '../sim/weaves/weaveDefinition';

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
    dustSwarm:        'dust_swarm',
    lambdaAnchor:     'lambda_anchor',
    dustPile:         'dust_pile',
    grasshopperArea:  'grasshopper_area',
    fireflyArea:      'firefly_area',
    decoration:       'decoration',
    playerSpawn:      'player_spawn',
    campaignSpawn:    'campaign_spawn',
    ambientLightBlocker: 'ambient_blocker',
    lightSource:      'light_source',
    sunbeam:          'sunbeam',
    waterZone:        'water_zone',
    lavaZone:         'lava_zone',
    crumbleBlock:     'crumble_block',
    spike:            'spike',
    bouncePad:        'bounce_pad',
    kineticBlock:     'kinetic_block',
    rope:             'rope',
    fallingBlock:     'falling_block',
    dialogueTrigger:  'dialogue_trigger',
    sceneLight:       'scene_light',
    backgroundBlock:  'background_block',
    guideDustPath:    'guide_dust_path',
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
      if (e.isRadiantWebFlag === 1)   return 'Radiant Web';
      if (e.isCrimsonWizardFlag === 1)return 'Crimson Wizard';
      if (e.isHeraldFlag === 1)       return 'The Void Herald';
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
    playerSpawn:        'Player Spawn (Room)',
    campaignSpawn:      'Campaign Spawn',
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
  if (type === 'dustSwarm') {
    const s = (room.dustSwarms ?? []).find(x => x.uid === uid);
    if (s) return `Dust Swarm [${s.dustKind} ×${s.dustCount}]`;
    return 'Dust Swarm';
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
  if (type === 'spike') {
    const sp = (room.spikes ?? []).find(x => x.uid === uid);
    if (sp) {
      const sizeLabel = sp.size === '2x2' ? '2×2' : '1×1';
      const themeLabel = sp.blockTheme ? ` [${sp.blockTheme}]` : '';
      return `Spike ${sizeLabel} (${sp.direction})${themeLabel}`;
    }
    return 'Spike';
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
