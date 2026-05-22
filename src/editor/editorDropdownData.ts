/**
 * Read-only dropdown option arrays and palette definitions for the editor UI.
 *
 * Extracted from editorState.ts to keep the core state/type module focused on
 * mutable runtime data.  All symbols here are pure data constants (no side
 * effects, no runtime state).
 */

import type { BlockTheme, BlockThemeId, BackgroundId, LightingEffect, AmbientLightDirection, CrumbleVariant } from '../levels/roomDef';
import type { LightType } from '../levels/lightingSchema';
import type { RoomSongId } from '../audio/musicManager';
import { AVAILABLE_SONGS, SONG_DISPLAY_NAMES } from '../audio/musicManager';
import { FOLDER_BLOCK_THEMES, folderThemeShortId } from '../render/walls/folderBlockThemes';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Active brush mode for painting tools. */
export type BrushMode = 'single' | '3x3' | '5x5' | 'rect';

export type PaletteCategory = 'blocks' | 'enemies' | 'triggers' | 'collectables' | 'environment' | 'objects' | 'lighting' | 'liquids' | 'ropes' | 'guidePaths';

export interface PaletteItem {
  id: string;
  label: string;
  category: PaletteCategory;
  /** Default width in blocks (for walls). */
  defaultWidthBlocks?: number;
  /** Default height in blocks (for walls). */
  defaultHeightBlocks?: number;
  /** 1 if this palette item places a one-way platform. */
  isPlatformItem?: 1;
  /** 1 if this palette item places a ramp (diagonal triangle). */
  isRampItem?: 1;
  /** 1 if this palette item places a half-width pillar (4 px wide). */
  isPillarHalfWidthItem?: 1;
  /** 1 if this palette item paints ambient-light blocker tiles. */
  isAmbientLightBlockerItem?: 1;
  /** 1 if this palette item paints dark ambient-light blocker tiles (also draws a black background overlay). */
  isDarkAmbientLightBlockerItem?: 1;
  /** 1 if this palette item places a local light source. */
  isLightSourceItem?: 1;
  /** 1 if this palette item places a sunbeam. */
  isSunbeamItem?: 1;
  /** 1 if this palette item places a liquid zone (water or lava). */
  isLiquidZoneItem?: 1;
  /** 1 if this palette item places a crumble block (collapses on first contact). */
  isCrumbleBlockItem?: 1;
  /** 1 if this palette item places a bounce pad (reflects player velocity). */
  isBouncePadItem?: 1;
  /** Speed-factor index for the placed bounce pad: 0=50%, 1=100%. */
  bouncePadSpeedFactorIndex?: 0 | 1;
  /** 1 if this palette item places a kinetic block (fixed-velocity boost on contact). */
  isKineticBlockItem?: 1;
  /** 1 if this palette item places a collectible dust container (grants +4 max capacity). */
  isDustContainerItem?: 1;
  /** 1 if this palette item places a collectible dust container piece. */
  isDustContainerPieceItem?: 1;
  /** 1 if this palette item places a dust boost jar object (grants temporary dust of a specific kind). */
  isDustBoostJarItem?: 1;
  /** 1 if this palette item places a collectable dust swarm (press F to collect dust particles). */
  isDustSwarmItem?: 1;
  /** 1 if this palette item places a Lambda Anchor (temporary recall point, press F to link/teleport). */
  isLambdaAnchorItem?: 1;
  /** 1 if this palette item places a falling block tile (triggers as a rigid group when disturbed). */
  isFallingBlockItem?: 1;
  /** Which falling block variant this item places. Only meaningful when isFallingBlockItem === 1. */
  fallingBlockVariant?: import('../levels/roomDef').FallingBlockVariant;
  /** 1 if this palette item places a visual-only background block (no collision). */
  isBackgroundBlockItem?: 1;
  /** 1 if this background block also blocks ambient light. Only meaningful when isBackgroundBlockItem === 1. */
  isLightBlockingBackgroundBlockItem?: 1;
  /** 1 if this palette item places a scene light (visibility-polygon shadow system). */
  isSceneLightItem?: 1;
  /** 1 if this palette item places/extends a golden dust guide path. */
  isGuideDustPathItem?: 1;
}

export type RopeDestructibility = 'indestructible' | 'playerOnly' | 'any';

// ── Dropdown option arrays ────────────────────────────────────────────────────

/** Options shown in the "Room Song" editor dropdown, in display order. */
export const SONG_OPTIONS: readonly { id: RoomSongId; label: string }[] = [
  { id: '_continue', label: SONG_DISPLAY_NAMES._continue },
  { id: '_silence',  label: SONG_DISPLAY_NAMES._silence },
  ...AVAILABLE_SONGS.map(id => ({ id, label: SONG_DISPLAY_NAMES[id] })),
];

/** Options for the crumble-block weakness variant dropdown. */
export const CRUMBLE_VARIANT_OPTIONS: readonly { id: CrumbleVariant; label: string }[] = [
  { id: 'normal',    label: 'Normal'    },
  { id: 'fire',      label: 'Fire'      },
  { id: 'water',     label: 'Water'     },
  { id: 'void',      label: 'Void'      },
  { id: 'ice',       label: 'Ice'       },
  { id: 'lightning', label: 'Lightning' },
  { id: 'poison',    label: 'Poison'    },
  { id: 'shadow',    label: 'Shadow'    },
  { id: 'nature',    label: 'Nature'    },
];

/** Options for the scene-light kind dropdown. */
export const SCENE_LIGHT_TYPE_OPTIONS: readonly { id: LightType; label: string }[] = [
  { id: 'softGlow',   label: 'Soft Glow'   },
  { id: 'spotlight',  label: 'Spotlight'   },
  { id: 'floodlight', label: 'Floodlight'  },
  { id: 'backlight',  label: 'Backlight'   },
  { id: 'sunray',     label: 'Volumetric Sunray' },
];

/** Canonical list of ParticleKind string values available for editor dropdowns. */
export const DUST_KIND_OPTIONS: readonly string[] = [
  'Physical', 'Fire', 'Ice', 'Lightning', 'Poison', 'Arcane',
  'Wind', 'Holy', 'Shadow', 'Metal', 'Earth', 'Nature', 'Crystal', 'Void', 'Water', 'Lava', 'Stone',
];

export const ROPE_DESTRUCTIBILITY_OPTIONS: ReadonlyArray<{ id: RopeDestructibility; label: string }> = [
  { id: 'indestructible', label: 'Indestructible' },
  { id: 'playerOnly',     label: 'Player Only' },
  { id: 'any',            label: 'Any' },
];

export const ROPE_THICKNESS_OPTIONS: ReadonlyArray<{ id: 0 | 1 | 2; label: string }> = [
  { id: 0, label: '8 px (thin)' },
  { id: 1, label: '16 px (medium)' },
  { id: 2, label: '24 px (thick)' },
];

/** Built-in palette items available in the editor. */
export const PALETTE_ITEMS: readonly PaletteItem[] = [
  // Blocks / terrain
  { id: 'block_1x1', label: '1×1 Block',   category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1 },
  { id: 'block_2x2', label: '2×2 Block',   category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2 },
  { id: 'platform',  label: 'Platform',     category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isPlatformItem: 1 },
  { id: 'ramp_1x1',  label: '1×1 Ramp',    category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isRampItem: 1 },
  { id: 'ramp_1x2',  label: '1×2 Ramp',    category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 1, isRampItem: 1 },
  { id: 'ramp_2x2',  label: '2×2 Ramp',    category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isRampItem: 1 },
  // Enemies
  { id: 'enemy_rolling', label: 'Rolling Enemy', category: 'enemies' },
  { id: 'enemy_flying_eye', label: 'Flying Eye', category: 'enemies' },
  { id: 'enemy_rock_elemental', label: 'Rock Elemental', category: 'enemies' },
  { id: 'enemy_slime', label: 'Slime', category: 'enemies' },
  { id: 'enemy_slime_large', label: 'Dust Slime (L)', category: 'enemies' },
  { id: 'enemy_wheel', label: 'Wheel Enemy', category: 'enemies' },
  { id: 'enemy_beetle', label: 'Golden Beetle', category: 'enemies' },
  { id: 'enemy_water_bubble', label: 'Water Bubble', category: 'enemies' },
  { id: 'enemy_ice_bubble',   label: 'Ice Bubble',   category: 'enemies' },
  { id: 'enemy_square_stampede', label: 'Square Stampede', category: 'enemies' },
  { id: 'enemy_golden_mimic', label: 'Golden Mimic', category: 'enemies' },
  { id: 'enemy_golden_mimic_xy', label: 'Golden Mimic (XY)', category: 'enemies' },
  { id: 'enemy_bee_swarm', label: 'Bee Swarm', category: 'enemies' },
  { id: 'enemy_web_spider', label: 'Web Spider', category: 'enemies' },
  { id: 'enemy_radiant_tether', label: 'Radiant Tether (Boss)', category: 'enemies' },
  { id: 'enemy_radiant_web', label: 'Radiant Web (Boss)', category: 'enemies' },
  // Triggers (player-facing activators and room logic)
  { id: 'campaign_spawn',  label: 'Campaign Spawn',          category: 'triggers' },
  { id: 'player_spawn',    label: 'Room Spawn (Fallback)',   category: 'triggers' },
  { id: 'room_transition', label: 'Room Transition', category: 'triggers' },
  { id: 'save_tomb',       label: 'Save Tomb',       category: 'triggers' },
  { id: 'dialogue_trigger', label: 'Dialogue Trigger', category: 'triggers' },
  // Collectables (items the player can pick up for permanent upgrades)
  { id: 'skill_tomb',            label: 'Skill Tomb',            category: 'collectables' },
  { id: 'dust_container',        label: 'Dust Container',        category: 'collectables', isDustContainerItem: 1 },
  { id: 'dust_container_piece',  label: 'Dust Container Piece',  category: 'collectables', isDustContainerPieceItem: 1 },
  { id: 'dust_swarm',            label: 'Dust Swarm',            category: 'collectables', isDustSwarmItem: 1 },
  // Environment (world atmosphere and critters)
  { id: 'dust_pile_small',  label: 'Dust Pile (S)', category: 'environment' },
  { id: 'dust_pile_medium', label: 'Dust Pile (M)', category: 'environment' },
  { id: 'dust_pile_large',  label: 'Dust Pile (L)', category: 'environment' },
  // Legacy alias kept for backward-compat with older room exports
  { id: 'dust_pile', label: 'Dust Pile', category: 'environment' },
  { id: 'grasshopper_area',     label: 'Grasshopper Area', category: 'environment' },
  { id: 'firefly_area',         label: 'Firefly Area',     category: 'environment' },
  { id: 'decoration_mushroom',  label: 'Glow Mushroom',    category: 'environment' },
  { id: 'decoration_glowgrass', label: 'Glow Grass',       category: 'environment' },
  { id: 'decoration_vine',      label: 'Glow Vine',        category: 'environment' },
  // Objects (interactive world objects)
  { id: 'lambda_anchor', label: 'Lambda Anchor', category: 'objects', isLambdaAnchorItem: 1 },
  { id: 'dust_boost_jar', label: 'Dust Jar (Object)', category: 'objects', isDustBoostJarItem: 1 },
  // ── Lighting layer ─────────────────────────────────────────────────────────
  // Designer-facing authoring for the unified ambient lighting system.
  // See `RoomAmbientLightBlockerDef` / `RoomLightSourceDef` in roomDef.ts.
  { id: 'ambient_light_blocker',      label: 'Ambient Blocker', category: 'lighting', isAmbientLightBlockerItem: 1 },
  { id: 'dark_ambient_light_blocker', label: 'Dark Blocker',    category: 'lighting', isAmbientLightBlockerItem: 1, isDarkAmbientLightBlockerItem: 1 },
  { id: 'light_source',          label: 'Light Source',    category: 'lighting', isLightSourceItem: 1 },
  { id: 'sunbeam',               label: 'Sunbeam',         category: 'lighting', isSunbeamItem: 1 },
  { id: 'scene_light',           label: 'Scene Light',     category: 'lighting', isSceneLightItem: 1 },
  // ── Liquids layer ───────────────────────────────────────────────────────────
  { id: 'water_zone', label: 'Water Zone', category: 'liquids', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isLiquidZoneItem: 1 },
  { id: 'lava_zone',  label: 'Lava Zone',  category: 'liquids', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isLiquidZoneItem: 1 },
  // ── Crumble blocks ──────────────────────────────────────────────────────────
  { id: 'crumble_block',    label: 'Crumble 1×1',       category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isCrumbleBlockItem: 1 },
  { id: 'crumble_block_2x2', label: 'Crumble 2×2',      category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isCrumbleBlockItem: 1 },
  { id: 'crumble_ramp_1x1', label: 'Crumble Ramp 1×1',  category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isCrumbleBlockItem: 1, isRampItem: 1 },
  { id: 'crumble_ramp_1x2', label: 'Crumble Ramp 1×2',  category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 1, isCrumbleBlockItem: 1, isRampItem: 1 },
  { id: 'crumble_ramp_2x2', label: 'Crumble Ramp 2×2',  category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isCrumbleBlockItem: 1, isRampItem: 1 },
  // ── Bounce pads ─────────────────────────────────────────────────────────────
  // Dim = 50 % restitution (small 2×2-pixel core)
  { id: 'bounce_pad_1x1_dim',       label: 'Bounce 1×1 (50%)',      category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 0 },
  { id: 'bounce_pad_2x2_dim',       label: 'Bounce 2×2 (50%)',      category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 0 },
  { id: 'bounce_pad_ramp_1x1_dim',  label: 'Bounce Ramp 1×1 (50%)', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 0, isRampItem: 1 },
  { id: 'bounce_pad_ramp_1x2_dim',  label: 'Bounce Ramp 1×2 (50%)', category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 1, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 0, isRampItem: 1 },
  { id: 'bounce_pad_ramp_2x2_dim',  label: 'Bounce Ramp 2×2 (50%)', category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 0, isRampItem: 1 },
  // Bright = 100 % restitution (large 4×4-pixel core)
  { id: 'bounce_pad_1x1_bright',      label: 'Bounce 1×1 (100%)',      category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 1 },
  { id: 'bounce_pad_2x2_bright',      label: 'Bounce 2×2 (100%)',      category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 1 },
  { id: 'bounce_pad_ramp_1x1_bright', label: 'Bounce Ramp 1×1 (100%)', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 1, isRampItem: 1 },
  { id: 'bounce_pad_ramp_1x2_bright', label: 'Bounce Ramp 1×2 (100%)', category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 1, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 1, isRampItem: 1 },
  { id: 'bounce_pad_ramp_2x2_bright', label: 'Bounce Ramp 2×2 (100%)', category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isBouncePadItem: 1, bouncePadSpeedFactorIndex: 1, isRampItem: 1 },
  // ── Kinetic blocks (impart fixed directional velocity boost on contact) ───
  { id: 'kinetic_block_1x1', label: 'Kinetic Block 1×1', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isKineticBlockItem: 1 },
  { id: 'kinetic_block_2x2', label: 'Kinetic Block 2×2', category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isKineticBlockItem: 1 },
  // ── Falling blocks (triggers as rigid group when disturbed) ──────────────
  { id: 'falling_block_tough',     label: 'Falling Block, Tough',     category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isFallingBlockItem: 1, fallingBlockVariant: 'tough' as const },
  { id: 'falling_block_sensitive', label: 'Falling Block, Sensitive', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isFallingBlockItem: 1, fallingBlockVariant: 'sensitive' as const },
  { id: 'falling_block_crumbling', label: 'Falling Block, Crumbling', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isFallingBlockItem: 1, fallingBlockVariant: 'crumbling' as const },
  // ── Background blocks (visual-only, no collision) ────────────────────────
  { id: 'bg_block_1x1',       label: 'BG Block 1×1',              category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isBackgroundBlockItem: 1 as const },
  { id: 'bg_block_2x2',       label: 'BG Block 2×2',              category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isBackgroundBlockItem: 1 as const },
  { id: 'bg_block_light_1x1', label: 'BG Block Light-Block 1×1',  category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isBackgroundBlockItem: 1 as const, isLightBlockingBackgroundBlockItem: 1 as const },
  { id: 'bg_block_light_2x2', label: 'BG Block Light-Block 2×2',  category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isBackgroundBlockItem: 1 as const, isLightBlockingBackgroundBlockItem: 1 as const },
  { id: 'rope', label: 'Rope', category: 'ropes', defaultWidthBlocks: 1, defaultHeightBlocks: 1 },
  { id: 'guide_dust_path', label: 'Guide Dust Path', category: 'guidePaths', isGuideDustPathItem: 1 as const },
];

const LEGACY_BLOCK_THEME_META: Readonly<Record<string, { shortId: BlockThemeId; label: string }>> = {
  blackRock: { shortId: 'bk', label: 'Blackstone' },
  brownRock: { shortId: 'br', label: 'Brownstone' },
  dirt:      { shortId: 'dt', label: 'Dirt' },
};
const LEGACY_BLOCK_THEME_ORDER: Readonly<Record<string, number>> = {
  blackRock: 0,
  brownRock: 1,
  dirt:      2,
};

function makeBlockThemeOption(theme: { id: string; label: string }): { id: BlockTheme; shortId: BlockThemeId; label: string } {
  const legacyMeta = LEGACY_BLOCK_THEME_META[theme.id];
  if (legacyMeta !== undefined) {
    return { id: theme.id, shortId: legacyMeta.shortId, label: legacyMeta.label };
  }
  return { id: theme.id, shortId: folderThemeShortId(theme.id), label: theme.label };
}

/** Available block themes for placement and wall inspection. */
export const BLOCK_THEMES: readonly { id: BlockTheme; shortId: BlockThemeId; label: string }[] = [...FOLDER_BLOCK_THEMES]
  .sort((a, b) => {
    const orderA = LEGACY_BLOCK_THEME_ORDER[a.id] ?? 1000;
    const orderB = LEGACY_BLOCK_THEME_ORDER[b.id] ?? 1000;
    return orderA !== orderB ? orderA - orderB : a.id.localeCompare(b.id);
  })
  .map(makeBlockThemeOption);

/** Available background options for the editor dropdown. */
export const BACKGROUND_OPTIONS: readonly { id: BackgroundId; label: string }[] = [
  { id: 'brownRock',        label: 'Brown Rock Cave' },
  { id: 'world1',           label: 'World 1' },
  { id: 'world2',           label: 'World 2' },
  { id: 'world3',           label: 'World 3' },
  { id: 'crystallineCracks', label: 'Crystalline Cracks' },
  { id: 'thero_prologue',   label: 'Thero Prologue (Shape Glow)' },
  { id: 'thero_ch1',        label: 'Thero Chapter 1 (Vermiculate)' },
  { id: 'thero_ch2',        label: 'Thero Chapter 2 (Gravity Grid)' },
  { id: 'thero_ch3',        label: 'Thero Chapter 3 (Euler Fluid)' },
  { id: 'thero_ch4',        label: 'Thero Chapter 4 (Floater Lattice)' },
  { id: 'thero_ch5',        label: 'Thero Chapter 5 (Tetris Blocks)' },
  { id: 'thero_ch6',        label: 'Thero Chapter 6 (Substrate)' },
];

/**
 * Available lighting models for the editor dropdown.
 *
 * The legacy `'DEFAULT'` and `'Above'` values are preserved for backward
 * compatibility with existing room files (the runtime solver maps them into
 * the unified ambient model — `'DEFAULT'` → omni, `'Above'` → down). New
 * rooms should pick `'Ambient'`, `'DarkRoom'`, or `'FullyLit'`.
 */
export const LIGHTING_OPTIONS: readonly { id: LightingEffect; label: string }[] = [
  { id: 'Ambient',  label: 'Ambient' },
  { id: 'DarkRoom', label: 'Dark Room' },
  { id: 'FullyLit', label: 'Fully Lit' },
  { id: 'DEFAULT',  label: 'Legacy: Default (omni)' },
  { id: 'Above',    label: 'Legacy: Above (down)' },
];

/**
 * Available ambient/skylight directions. `'down-right'` is the recommended
 * authored default for a natural diagonal spill (§8 of the spec).
 */
export const AMBIENT_LIGHT_DIRECTION_OPTIONS: readonly { id: AmbientLightDirection; label: string }[] = [
  { id: 'omni',       label: 'Omni (all sides)' },
  { id: 'down',       label: 'Down ↓' },
  { id: 'down-right', label: 'Down-Right ↘' },
  { id: 'down-left',  label: 'Down-Left ↙' },
  { id: 'up',         label: 'Up ↑' },
  { id: 'up-right',   label: 'Up-Right ↗' },
  { id: 'up-left',    label: 'Up-Left ↖' },
  { id: 'left',       label: 'Left ←' },
  { id: 'right',      label: 'Right →' },
];

/** Available fade color options for room transitions. */
export const FADE_COLOR_OPTIONS: readonly { label: string; value: string }[] = [
  { label: 'Black', value: '#000000' },
  { label: 'Warm Sunlight White', value: '#FFF4D6' },
];
