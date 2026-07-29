/**
 * editorPalettePreview.ts — Centralized palette-preview resolver.
 *
 * Provides `makePalettePreviewCard()` for every non-block palette category
 * (specialBlocks, enemies, triggers, collectables, environment, dust,
 * objects, lighting, liquids, ropes, guidePaths).
 *
 * Design goals:
 *  - One card style matching `makeBlockPreviewCard` exactly (40×40 preview + label).
 *  - Sprite images where assets exist; lightweight CSS/canvas shapes elsewhere.
 *  - Deterministic, never random or frame-dependent.
 *  - Missing sprites show a neutral fallback and warn once in DEV.
 *  - No per-frame allocations: preview elements are created once at palette-build time.
 */

import type { PaletteItem } from './editorState';
import { THEME_BLOCK_SPRITE_URL, makeBlockPreviewShapeCss, makePaletteCardShell, makePreviewContainer } from './editorUIHelpers';
import { getKineticBlockSpriteUrls } from '../render/specialBlocks/specialBlockSprites';

// ── Warning log deduplication ────────────────────────────────────────────────

const _warnedIds = new Set<string>();
function _warnOnce(id: string, msg: string): void {
  if (import.meta.env.DEV && !_warnedIds.has(id)) {
    _warnedIds.add(id);
    console.warn(`[editorPalettePreview] ${msg}`);
  }
}

// ── Sprite URL table ──────────────────────────────────────────────────────────

/**
 * Maps palette item IDs to their representative sprite URL (public path,
 * no leading slash, no ASSETS/ prefix — same format used by `loadImg()`).
 */
const ITEM_SPRITE_URL: Readonly<Record<string, string>> = Object.freeze({
  // Enemies with sprite assets
  enemy_rolling:         'SPRITES/ENEMIES/goldenBlock/goldenBlock.png',
  enemy_rock_elemental:  'SPRITES/ENEMIES/earthElemental/earthElemental_head_deactivated.png',
  enemy_beetle:          'SPRITES/ENEMIES/goldenBeetle/goldenBeetle_walking.png',
  enemy_radiant_tether:  'SPRITES/ENEMIES/radiantTeather/radiantTether_flying.png',
  enemy_crimson_wizard:  'SPRITES/ENEMIES/BOSSES/CrimsonWizard/CrimsonWizard_Idle.png',
  // Collectables / triggers with sprite assets
  save_tomb:             'SPRITES/OBJECTS&TRIGGERS/INTERACTABLES&COLLECTABLES/saveTomb.png',
  skill_tomb:            'SPRITES/OBJECTS&TRIGGERS/INTERACTABLES&COLLECTABLES/skillTomb.png',
  dust_container:        'SPRITES/OBJECTS&TRIGGERS/INTERACTABLES&COLLECTABLES/dustContainer.png',
  dust_container_piece:  'SPRITES/OBJECTS&TRIGGERS/INTERACTABLES&COLLECTABLES/dustContainerShard.png',
});

// ── Procedural visual descriptions ────────────────────────────────────────────

/** CSS background string + optional centered glyph for procedural previews. */
interface ProceduralVisual {
  bg: string;
  /** Extra CSS applied to the inner shape div (clip-path, gradient, etc.). */
  extraCss?: string;
  /** Unicode glyph rendered centred over the shape. */
  glyph?: string;
}

const ITEM_VISUAL: Readonly<Record<string, ProceduralVisual>> = Object.freeze({
  laser_emitter: {
    bg: '#0a2a33',
    extraCss: `border: 2px solid rgba(120,240,255,0.9); box-sizing: border-box;`,
    glyph: '↑',
  },
  // ── Enemies ────────────────────────────────────────────────────────────────
  enemy_flying_eye: {
    bg: '#1a3a88',
    extraCss: `clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);`,
    glyph: '◈',
  },
  enemy_slime: {
    bg: '#2a8a2a',
    extraCss: `border-radius: 50% 50% 45% 45%;`,
  },
  enemy_slime_large: {
    bg: '#26a026',
    extraCss: `border-radius: 50% 50% 45% 45%;`,
    glyph: 'L',
  },
  enemy_wheel: {
    bg: '#666666',
    extraCss: `border-radius: 50%; border: 3px solid #444; box-sizing: border-box;`,
  },
  enemy_water_bubble: {
    bg: 'rgba(20,100,200,0.6)',
    extraCss: `border-radius: 50%; border: 2px solid rgba(80,160,255,0.8); box-sizing: border-box;`,
  },
  enemy_ice_bubble: {
    bg: 'rgba(160,220,255,0.5)',
    extraCss: `border-radius: 50%; border: 2px solid rgba(180,230,255,0.9); box-sizing: border-box;`,
  },
  enemy_square_stampede: {
    bg: '#802010',
    extraCss: `border: 2px solid rgba(220,80,30,0.8); box-sizing: border-box;`,
    glyph: '▣',
  },
  enemy_golden_mimic: {
    bg: '#3a2800',
    extraCss: `clip-path: polygon(50% 4%, 96% 50%, 50% 96%, 4% 50%); border: 2px solid #d4a820;`,
  },
  enemy_golden_mimic_xy: {
    bg: '#3a2800',
    extraCss: `clip-path: polygon(50% 4%, 96% 50%, 50% 96%, 4% 50%); border: 2px solid #d4a820;`,
    glyph: 'XY',
  },
  enemy_bee_swarm: {
    bg: '#2a1e00',
    extraCss: `border: 2px solid rgba(220,180,30,0.8); box-sizing: border-box; border-radius: 3px;`,
    glyph: '⬡',
  },
  enemy_web_spider: {
    bg: '#181818',
    extraCss: `border-radius: 50%; border: 2px solid #505050; box-sizing: border-box;`,
    glyph: '⊕',
  },
  enemy_dust_constellation: {
    bg: '#1a0840',
    extraCss: `clip-path: polygon(50% 0%, 62% 38%, 100% 38%, 69% 59%, 81% 100%, 50% 75%, 19% 100%, 31% 59%, 0% 38%, 38% 38%);`,
  },
  enemy_dust_constellation_large: {
    bg: '#220a50',
    extraCss: `clip-path: polygon(50% 0%, 62% 38%, 100% 38%, 69% 59%, 81% 100%, 50% 75%, 19% 100%, 31% 59%, 0% 38%, 38% 38%);`,
    glyph: 'L',
  },
  enemy_orbital_dust_core: {
    bg: '#2a0860',
    extraCss: `border-radius: 50%; border: 2px solid rgba(120,60,220,0.8); box-sizing: border-box;`,
  },
  enemy_orbital_dust_core_large: {
    bg: '#340a70',
    extraCss: `border-radius: 50%; border: 2px solid rgba(140,80,240,0.8); box-sizing: border-box;`,
    glyph: 'L',
  },
  enemy_dust_block_mimic: {
    bg: '#303020',
    extraCss: `border: 2px solid rgba(180,160,60,0.6); box-sizing: border-box;`,
    glyph: '⊡',
  },
  enemy_dust_block_mimic_large: {
    bg: '#383828',
    extraCss: `border: 2px solid rgba(180,160,60,0.6); box-sizing: border-box;`,
    glyph: 'L',
  },
  enemy_dust_weaver_architect: {
    bg: '#2a0845',
    extraCss: `clip-path: polygon(50% 4%, 96% 50%, 50% 96%, 4% 50%); border: 2px solid rgba(160,60,220,0.9);`,
  },
  enemy_dust_weaver_architect_large: {
    bg: '#300a50',
    extraCss: `clip-path: polygon(50% 4%, 96% 50%, 50% 96%, 4% 50%); border: 2px solid rgba(160,60,220,0.9);`,
    glyph: 'L',
  },
  enemy_void_singularity: {
    bg: '#050508',
    extraCss: `border-radius: 50%; border: 2px solid rgba(60,20,80,0.9); box-sizing: border-box;`,
  },
  enemy_void_singularity_pair: {
    bg: '#050508',
    extraCss: `border-radius: 50%; border: 2px solid rgba(60,20,80,0.9); box-sizing: border-box;`,
    glyph: '×2',
  },
  enemy_dust_leech: {
    bg: '#501c08',
    extraCss: `border-radius: 50% 30% 50% 30%; border: 1px solid rgba(180,80,30,0.6); box-sizing: border-box;`,
  },
  enemy_slime_snail: {
    bg: 'linear-gradient(0deg, #7fd66b 0 38%, #246b32 39% 78%, transparent 79%)',
    extraCss: `border-radius: 55% 45% 35% 30%; border-bottom: 2px solid #b9f49b; box-sizing: border-box;`,
    glyph: '•',
  },
  enemy_shadow: { bg: '#100c18', extraCss: `border: 2px solid #6d39a8; box-sizing: border-box; opacity:.8;`, glyph: '◼' },
  enemy_needle_urchin: { bg: '#303441', extraCss: `border-radius:50%; border:4px dashed #aaa4bc; box-sizing:border-box;`, glyph: '✦' },
  enemy_momentum_turret: {
    bg: 'linear-gradient(90deg, #292b35 0 55%, #ff4b20 56% 72%, #6d707d 73%)',
    extraCss: `border: 2px solid #171820; box-sizing: border-box;`,
    glyph: '›',
  },
  enemy_grid_snake: {
    bg: '#147d85',
    extraCss: `border-radius: 3px; border: 2px solid #35d6b8; box-sizing: border-box;`,
    glyph: 'S',
  },
  // Grid-block enemies (speed variants — colour-coded: slow=teal, medium=amber, fast=red)
  enemy_grid_block_1x1_slow: {
    bg: '#1a3a3a',
    extraCss: `border: 2px solid rgba(60,200,180,0.8); box-sizing: border-box;`,
    glyph: '1',
  },
  enemy_grid_block_1x1_medium: {
    bg: '#3a2e00',
    extraCss: `border: 2px solid rgba(220,170,20,0.8); box-sizing: border-box;`,
    glyph: '1',
  },
  enemy_grid_block_1x1_fast: {
    bg: '#3a0a08',
    extraCss: `border: 2px solid rgba(220,60,40,0.8); box-sizing: border-box;`,
    glyph: '1',
  },
  enemy_grid_block_2x2_slow: {
    bg: '#1a3a3a',
    extraCss: `border: 2px solid rgba(60,200,180,0.8); box-sizing: border-box;`,
    glyph: '2',
  },
  enemy_grid_block_2x2_medium: {
    bg: '#3a2e00',
    extraCss: `border: 2px solid rgba(220,170,20,0.8); box-sizing: border-box;`,
    glyph: '2',
  },
  enemy_grid_block_2x2_fast: {
    bg: '#3a0a08',
    extraCss: `border: 2px solid rgba(220,60,40,0.8); box-sizing: border-box;`,
    glyph: '2',
  },
  // Bosses without sprite assets yet
  enemy_herald: {
    bg: '#050510',
    extraCss: `border-radius: 50%; border: 2px solid rgba(80,40,160,0.9); box-sizing: border-box;`,
    glyph: '◬',
  },
  enemy_ice_wizard: {
    bg: '#081828',
    extraCss: `clip-path: polygon(50% 4%, 96% 50%, 50% 96%, 4% 50%); border: 2px solid rgba(140,210,255,0.9);`,
    glyph: '❄',
  },
  firefly_jar: {
    bg: '#241c0a',
    extraCss: `border-radius: 4px 4px 8px 8px; border: 2px solid rgba(210,180,90,0.7); box-sizing: border-box;`,
    glyph: '✦',
  },
  enemy_grapple_hunter: {
    bg: '#2a2418',
    extraCss: `border-radius: 50%; border: 2px solid rgba(200,170,90,0.85); box-sizing: border-box;`,
    glyph: '⚓',
  },
  enemy_radiant_web: {
    bg: '#1a0800',
    extraCss: `border-radius: 50%; border: 2px solid rgba(255,120,10,0.7); box-sizing: border-box;`,
    glyph: '✦',
  },

  // ── Triggers ───────────────────────────────────────────────────────────────
  campaign_spawn: {
    bg: '#0a2010',
    extraCss: `clip-path: polygon(50% 0%, 62% 38%, 100% 38%, 69% 59%, 81% 100%, 50% 75%, 19% 100%, 31% 59%, 0% 38%, 38% 38%);`,
    glyph: '★',
  },
  player_spawn: {
    bg: '#0a1830',
    extraCss: `border-radius: 50% 50% 8px 8px; border: 2px solid rgba(80,160,255,0.8); box-sizing: border-box;`,
    glyph: '▼',
  },
  room_transition: {
    bg: '#180a30',
    extraCss: `border: 2px solid rgba(140,90,255,0.8); box-sizing: border-box;`,
    glyph: '⇒',
  },
  dialogue_trigger: {
    bg: '#081830',
    extraCss: `border-radius: 6px 6px 6px 0px; border: 2px solid rgba(80,160,255,0.8); box-sizing: border-box;`,
    glyph: '…',
  },
  challenge_field: {
    bg: '#32105c',
    extraCss: `border: 2px solid rgba(190,110,255,0.9); box-sizing: border-box;`,
    glyph: 'C',
  },
  challenge_gate: {
    bg: '#bfae72',
    extraCss: `border: 3px double rgba(255,215,90,0.9); box-sizing: border-box;`,
    glyph: 'S',
  },
  enemy_gate: { bg: '#b98288', extraCss: `border: 3px double #e9d9da; box-sizing: border-box;`, glyph: 'X' },
  heart_gate: { bg: '#d5a2ae', extraCss: `border: 3px double #f6e0e6; box-sizing: border-box;`, glyph: 'H' },
  speed_gate: { bg: '#8fc6d2', extraCss: `border: 3px double #d9f2f6; box-sizing: border-box;`, glyph: '>' },
  challenge_totem: {
    bg: '#42126e',
    extraCss: `border-radius: 5px 5px 1px 1px; border: 2px solid rgba(210,145,255,0.9); box-sizing: border-box;`,
    glyph: 'C',
  },

  // ── Collectables ───────────────────────────────────────────────────────────
  dust_swarm: {
    bg: '#100830',
    extraCss: `border-radius: 50%; border: 2px solid rgba(100,80,255,0.8); box-sizing: border-box;`,
    glyph: '✦',
  },

  // ── Environment ────────────────────────────────────────────────────────────
  dust_pile_small: {
    bg: '#1a1400',
    extraCss: `border-radius: 50% 50% 20% 20%;`,
    glyph: 'S',
  },
  dust_pile_medium: {
    bg: '#211900',
    extraCss: `border-radius: 50% 50% 20% 20%;`,
    glyph: 'M',
  },
  dust_pile_large: {
    bg: '#282000',
    extraCss: `border-radius: 50% 50% 20% 20%;`,
    glyph: 'L',
  },
  dust_pile: {
    bg: '#1a1400',
    extraCss: `border-radius: 50% 50% 20% 20%;`,
  },
  grasshopper_area: {
    bg: 'rgba(20,80,20,0.5)',
    extraCss: `border: 2px dashed rgba(40,180,40,0.6); box-sizing: border-box; border-radius: 3px;`,
    glyph: '♫',
  },
  firefly_area: {
    bg: 'rgba(30,25,0,0.5)',
    extraCss: `border: 2px dashed rgba(200,190,20,0.6); box-sizing: border-box; border-radius: 3px;`,
    glyph: '✦',
  },
  decoration_mushroom: {
    bg: '#1c0814',
    extraCss: `border-radius: 50% 50% 8px 8px; border: 1px solid rgba(180,50,120,0.5); box-sizing: border-box;`,
    glyph: '🍄',
  },
  decoration_glowgrass: {
    bg: '#041c04',
    extraCss: `border-radius: 8px 8px 0 0; border: 1px solid rgba(40,200,40,0.5); box-sizing: border-box;`,
    glyph: '🌿',
  },
  decoration_vine: {
    bg: '#021408',
    extraCss: `border-radius: 3px; border: 1px solid rgba(30,160,60,0.5); box-sizing: border-box;`,
    glyph: '〜',
  },

  // ── Objects ─────────────────────────────────────────────────────────────────
  lambda_anchor: {
    bg: '#1a1200',
    extraCss: `border: 2px solid rgba(212,168,75,0.8); box-sizing: border-box; border-radius: 3px;`,
    glyph: 'λ',
  },
  dust_boost_jar: {
    bg: '#120020',
    extraCss: `border-radius: 4px 4px 8px 8px; border: 2px solid rgba(180,60,255,0.8); box-sizing: border-box;`,
    glyph: '⬡',
  },
  // ── Lighting ────────────────────────────────────────────────────────────────
  ambient_light_blocker: {
    bg: 'rgba(30,30,40,0.85)',
    extraCss: `border: 2px dashed rgba(100,100,180,0.5); box-sizing: border-box; border-radius: 3px;`,
    glyph: '▣',
  },
  dark_ambient_light_blocker: {
    bg: 'rgba(5,5,10,0.95)',
    extraCss: `border: 2px dashed rgba(60,60,100,0.5); box-sizing: border-box; border-radius: 3px;`,
    glyph: '■',
  },
  light_source: {
    bg: 'radial-gradient(circle, rgba(255,230,80,0.7) 0%, rgba(255,180,20,0.2) 60%, transparent 100%)',
    extraCss: `border-radius: 50%;`,
    glyph: '✦',
  },
  sunbeam: {
    bg: 'linear-gradient(135deg, rgba(255,220,120,0.6) 0%, rgba(255,200,60,0.15) 60%, transparent 100%)',
    extraCss: `border-radius: 2px;`,
    glyph: '⟋',
  },
  scene_light: {
    bg: 'radial-gradient(ellipse at 50% 20%, rgba(255,245,200,0.8) 0%, rgba(255,220,80,0.2) 50%, transparent 100%)',
    extraCss: `border-radius: 50% 50% 30% 30%;`,
    glyph: '⬦',
  },

  // ── Liquids ─────────────────────────────────────────────────────────────────
  water_zone: {
    bg: 'linear-gradient(180deg, rgba(20,80,180,0.3) 0%, rgba(20,100,220,0.7) 100%)',
    extraCss: `border: 2px solid rgba(60,140,255,0.7); box-sizing: border-box; border-radius: 3px;`,
    glyph: '≋',
  },
  lava_zone: {
    bg: 'linear-gradient(180deg, rgba(200,60,10,0.3) 0%, rgba(240,80,10,0.7) 100%)',
    extraCss: `border: 2px solid rgba(255,120,20,0.7); box-sizing: border-box; border-radius: 3px;`,
    glyph: '≋',
  },

  // ── Ropes ───────────────────────────────────────────────────────────────────
  rope: {
    bg: 'transparent',
    extraCss: `border-radius: 2px;`,
    glyph: '|',
  },

  // ── Guide paths ──────────────────────────────────────────────────────────────
  guide_dust_path: {
    bg: '#1a1200',
    extraCss: `border: 2px dashed rgba(212,168,75,0.6); box-sizing: border-box; border-radius: 3px;`,
    glyph: '⟿',
  },
});

// ── Internal helpers ─────────────────────────────────────────────────────────

function _makeSpritePreview(spriteUrl: string, itemId: string): HTMLDivElement {
  const wrap = makePreviewContainer();
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  img.style.cssText = `
    width: 100%; height: 100%; object-fit: contain;
    image-rendering: pixelated; pointer-events: none;
  `;
  img.src = spriteUrl;
  img.addEventListener('error', () => {
    _warnOnce(`sprite:${itemId}`, `Sprite not found for palette item '${itemId}': ${spriteUrl}`);
    img.remove();
    _appendFallbackGlyph(wrap, '?');
  }, { once: true });
  wrap.appendChild(img);
  return wrap;
}

function _appendFallbackGlyph(container: HTMLElement, glyph: string): void {
  const g = document.createElement('div');
  g.textContent = glyph;
  g.style.cssText = `
    width: 100%; height: 100%; display: flex; align-items: center;
    justify-content: center; font-size: 16px; color: rgba(180,180,180,0.6);
    font-family: monospace;
  `;
  container.appendChild(g);
}

function _makeProceduralPreview(visual: ProceduralVisual): HTMLDivElement {
  const wrap = makePreviewContainer();
  const shape = document.createElement('div');
  shape.style.cssText = `
    width: 40px; height: 40px; box-sizing: border-box;
    background: ${visual.bg};
    display: flex; align-items: center; justify-content: center;
    ${visual.extraCss ?? ''}
  `;
  if (visual.glyph) {
    const glyphEl = document.createElement('span');
    glyphEl.textContent = visual.glyph;
    glyphEl.style.cssText = `
      font-size: 13px; color: rgba(220,220,220,0.75); font-family: monospace;
      pointer-events: none; user-select: none; position: relative; z-index: 1;
    `;
    shape.appendChild(glyphEl);
  }
  wrap.appendChild(shape);
  return wrap;
}

/** Builds a canvas with an upward directional-boost arrow, for kinetic block overlays. */
const _KINETIC_CANVAS_SIZE = 40;
const _KINETIC_ARROW_MID_X = 20;
const _KINETIC_ARROW_TAIL_Y = 28;
const _KINETIC_ARROW_TIP_Y  = 10;
const _KINETIC_ARROW_HEAD_TOP_Y = 18;
const _KINETIC_ARROW_HEAD_HALF_W = 5;

function _makeKineticArrowCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width  = _KINETIC_CANVAS_SIZE;
  c.height = _KINETIC_CANVAS_SIZE;
  c.style.cssText = `position: absolute; top: 0; left: 0; pointer-events: none;`;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.strokeStyle = 'rgba(100,200,255,0.9)';
    ctx.fillStyle   = 'rgba(100,200,255,0.9)';
    ctx.lineWidth = 1.5;
    // Shaft
    ctx.beginPath();
    ctx.moveTo(_KINETIC_ARROW_MID_X, _KINETIC_ARROW_TIP_Y + 2);
    ctx.lineTo(_KINETIC_ARROW_MID_X, _KINETIC_ARROW_TAIL_Y);
    ctx.stroke();
    // Arrowhead triangle
    ctx.beginPath();
    ctx.moveTo(_KINETIC_ARROW_MID_X, _KINETIC_ARROW_TIP_Y);
    ctx.lineTo(_KINETIC_ARROW_MID_X - _KINETIC_ARROW_HEAD_HALF_W, _KINETIC_ARROW_HEAD_TOP_Y);
    ctx.lineTo(_KINETIC_ARROW_MID_X + _KINETIC_ARROW_HEAD_HALF_W, _KINETIC_ARROW_HEAD_TOP_Y);
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

/**
 * Builds a preview element (40×40 container) for items that use the block
 * theme system (specialBlocks using `blockThemeOverride`).
 */
function _makeSpecialBlockPreview(item: PaletteItem, blockTheme: string): HTMLDivElement {
  // Kinetic blocks: prefer the actual sprite when available.
  if (item.isKineticBlockItem) {
    const kineticUrls = getKineticBlockSpriteUrls();
    if (kineticUrls.length > 0) {
      const wrap = _makeSpritePreview(kineticUrls[0], item.id);
      // Overlay a directional arrow so it's clear this is a kinetic (boost) block.
      wrap.appendChild(_makeKineticArrowCanvas());
      return wrap;
    }
    // Fall through to CSS procedural if no sprites discovered.
  }

  const effectiveTheme = item.blockThemeOverride ?? blockTheme;
  const { containerCss, shapeCss } = makeBlockPreviewShapeCss(item, effectiveTheme);
  const wrap = document.createElement('div');
  wrap.style.cssText = containerCss;
  const shape = document.createElement('div');
  shape.style.cssText = shapeCss;
  wrap.appendChild(shape);

  // Bounce pads: add glowing core dot (mirrored from makeBlockPreviewCard)
  if (item.isBouncePadItem) {
    const coreCanvas = document.createElement('canvas');
    coreCanvas.width = 40;
    coreCanvas.height = 40;
    coreCanvas.style.cssText = `position: absolute; top: 0; left: 0; pointer-events: none;`;
    const ctx = coreCanvas.getContext('2d');
    if (ctx) {
      const dotSize = item.bouncePadSpeedFactorIndex === 1 ? 6 : 4;
      const cx = 20, cy = 20;
      ctx.fillStyle = 'rgba(255,140,30,0.35)';
      ctx.fillRect(cx - dotSize, cy - dotSize, dotSize * 2, dotSize * 2);
      const innerSize = dotSize * 0.5;
      ctx.fillStyle = item.bouncePadSpeedFactorIndex === 1 ? 'rgba(255,220,60,0.95)' : 'rgba(255,100,15,0.85)';
      ctx.fillRect(cx - innerSize, cy - innerSize, innerSize * 2, innerSize * 2);
    }
    wrap.appendChild(coreCanvas);
  }

  // Kinetic blocks (CSS fallback): add a directional-boost arrow overlay
  if (item.isKineticBlockItem) {
    wrap.appendChild(_makeKineticArrowCanvas());
  }

  // Springboard: upward-arrow glyph, visually distinct from the bounce-pad
  // glowing-core dot above.
  if (item.id === 'springboard') {
    const arrowCanvas = document.createElement('canvas');
    arrowCanvas.width = 40;
    arrowCanvas.height = 40;
    arrowCanvas.style.cssText = `position: absolute; top: 0; left: 0; pointer-events: none;`;
    const actx = arrowCanvas.getContext('2d');
    if (actx) {
      actx.fillStyle = 'rgba(120,255,160,0.9)';
      actx.beginPath();
      actx.moveTo(20, 8);
      actx.lineTo(28, 20);
      actx.lineTo(23, 20);
      actx.lineTo(23, 32);
      actx.lineTo(17, 32);
      actx.lineTo(17, 20);
      actx.lineTo(12, 20);
      actx.closePath();
      actx.fill();
    }
    wrap.appendChild(arrowCanvas);
  }

  // Breakable blocks: fractured/cracked overlay, matching the crumble-block
  // crack styling but with a distinct (neutral tan) colour.
  if (item.id === 'breakable_block_1x1' || item.id === 'breakable_block_2x2') {
    const crackCanvas = document.createElement('canvas');
    crackCanvas.width = 40;
    crackCanvas.height = 40;
    crackCanvas.style.cssText = `position: absolute; top: 0; left: 0; pointer-events: none;`;
    const cctx = crackCanvas.getContext('2d');
    if (cctx) {
      cctx.strokeStyle = '#e0c890';
      cctx.lineWidth = 1.5;
      cctx.beginPath();
      cctx.moveTo(8, 6);
      cctx.lineTo(18, 16);
      cctx.lineTo(12, 22);
      cctx.lineTo(24, 34);
      cctx.moveTo(18, 16);
      cctx.lineTo(30, 10);
      cctx.moveTo(24, 34);
      cctx.lineTo(34, 30);
      cctx.stroke();
    }
    wrap.appendChild(crackCanvas);
  }

  return wrap;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the preview sprite URL for a given palette item, or null if no sprite
 * is registered. Used by external modules that want just the URL (e.g. for
 * `<img>` tags built outside this module).
 */
export function getPaletteItemSpriteUrl(itemId: string): string | null {
  // Check sprite override table
  const direct = ITEM_SPRITE_URL[itemId];
  if (direct !== undefined) return direct;
  return null;
}

/** Coarse preview kind descriptor — used by the DEV audit and for future tooling. */
export type PalettePreviewKind =
  | 'sprite'       // Registered in ITEM_SPRITE_URL
  | 'procedural'   // Registered in ITEM_VISUAL
  | 'specialBlock' // Handled by _makeSpecialBlockPreview (block theme / kinetic sprite)
  | 'none';        // No preview registered → will render '?' fallback

/**
 * Returns the preview kind for a given palette item without building any DOM.
 * Used by `auditPalettePreviews` and can be used by external tooling.
 */
export function getPalettePreviewKind(item: PaletteItem): PalettePreviewKind {
  if (item.category === 'specialBlocks') return 'specialBlock';
  if (Object.prototype.hasOwnProperty.call(ITEM_SPRITE_URL, item.id)) return 'sprite';
  if (Object.prototype.hasOwnProperty.call(ITEM_VISUAL, item.id)) return 'procedural';
  return 'none';
}

/**
 * Returns true when `makePalettePreviewCard()` will produce a meaningful visual
 * for this item (i.e. not just a '?' fallback glyph).
 */
export function hasPalettePreview(item: PaletteItem): boolean {
  return getPalettePreviewKind(item) !== 'none';
}

// ── DEV palette audit ─────────────────────────────────────────────────────────

let _auditDone = false;

/**
 * DEV-only: checks every item in `items` for a registered preview and logs
 * a one-time report.  Safe to call every frame — the audit runs at most once
 * per session and is a no-op in production.
 *
 * @param items  Typically `PALETTE_ITEMS` from `editorDropdownData.ts`.
 */
export function auditPalettePreviews(items: readonly PaletteItem[]): void {
  if (!import.meta.env.DEV || _auditDone) return;
  _auditDone = true;

  const missing: PaletteItem[] = [];
  for (const item of items) {
    if (!hasPalettePreview(item)) {
      missing.push(item);
    }
  }

  if (missing.length === 0) {
    console.log('[editorPalettePreview] Audit: all palette items have previews. ✓');
  } else {
    console.group(`[editorPalettePreview] Audit: ${missing.length} item(s) lack previews`);
    for (const item of missing) {
      console.warn(`  id='${item.id}'  label='${item.label}'  category='${item.category}'`);
    }
    console.groupEnd();
  }
}

/**
 * Creates a full palette card (40×40 preview + label) for the given item.
 *
 * For `specialBlocks`: renders a block-style shape using the current block theme
 * (or `blockThemeOverride` when set on the item).
 *
 * For all other categories: uses a sprite image if one is registered, or falls
 * back to a lightweight procedural CSS+canvas shape.
 *
 * The returned card uses the same visual style as `makeBlockPreviewCard`.
 */
export function makePalettePreviewCard(
  item: PaletteItem,
  blockTheme: string,
  onClick: () => void,
): HTMLDivElement {
  let previewEl: HTMLDivElement;

  if (item.category === 'specialBlocks') {
    previewEl = _makeSpecialBlockPreview(item, blockTheme);
  } else {
    const spriteUrl = ITEM_SPRITE_URL[item.id];
    if (spriteUrl !== undefined) {
      previewEl = _makeSpritePreview(spriteUrl, item.id);
    } else {
      const visual = ITEM_VISUAL[item.id];
      if (visual !== undefined) {
        previewEl = _makeProceduralPreview(visual);
      } else {
        // Unknown item — neutral fallback
        _warnOnce(`unknown:${item.id}`, `No preview registered for palette item '${item.id}' (category: ${item.category}). Add it to ITEM_SPRITE_URL or ITEM_VISUAL in editorPalettePreview.ts.`);
        const fallbackWrap = makePreviewContainer();
        _appendFallbackGlyph(fallbackWrap, '?');
        previewEl = fallbackWrap;
      }
    }
  }

  // Special-case: if the item uses blockThemeOverride we want the ice sprite
  // from THEME_BLOCK_SPRITE_URL; confirm at preview-build time and warn if missing.
  if (item.blockThemeOverride !== undefined && item.category === 'specialBlocks') {
    const url = THEME_BLOCK_SPRITE_URL[item.blockThemeOverride];
    if (url === undefined && import.meta.env.DEV) {
      _warnOnce(
        `theme:${item.blockThemeOverride}`,
        `Block theme '${item.blockThemeOverride}' has no sprite in THEME_BLOCK_SPRITE_URL — palette preview will use colour fill only.`,
      );
    }
  }

  return makePaletteCardShell(previewEl, item.label, onClick);
}
