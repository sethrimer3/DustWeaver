/**
 * Core editor state — tracks mode, active tool, palette selection,
 * selected elements, and mutable room data being edited.
 *
 * The editor operates on a mutable copy of authored room data (EditorRoomData)
 * which can be exported to JSON and later rebuilt into a RoomDef.
 */

import type { TransitionDirection, BlockTheme, BlockThemeId, BackgroundId, LightingEffect, DecorationKind, AmbientLightDirection, CrumbleVariant } from '../levels/roomDef';
import type { RoomSongId } from '../audio/musicManager';
import { AVAILABLE_SONGS, SONG_DISPLAY_NAMES } from '../audio/musicManager';
import { WEAVE_LIST } from '../sim/weaves/weaveDefinition';
import { FOLDER_BLOCK_THEMES, folderThemeShortId } from '../render/walls/folderBlockThemes';

// Re-export for convenience in editor modules
export type { BlockTheme, BlockThemeId, BackgroundId, LightingEffect, DecorationKind, AmbientLightDirection, CrumbleVariant } from '../levels/roomDef';
export type { RoomSongId } from '../audio/musicManager';

/** Options shown in the "Room Song" editor dropdown, in display order. */
export const SONG_OPTIONS: readonly { id: RoomSongId; label: string }[] = [
  { id: '_continue', label: SONG_DISPLAY_NAMES._continue },
  { id: '_silence',  label: SONG_DISPLAY_NAMES._silence },
  ...AVAILABLE_SONGS.map(id => ({ id, label: SONG_DISPLAY_NAMES[id] })),
];

// ── Editor tool enum ─────────────────────────────────────────────────────────

export enum EditorTool {
  Select = 'select',
  Place = 'place',
  Delete = 'delete',
}

// ── Palette categories and items ─────────────────────────────────────────────

export type PaletteCategory = 'blocks' | 'enemies' | 'triggers' | 'collectables' | 'environment' | 'objects' | 'lighting' | 'liquids' | 'ropes';

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
  /** 1 if this palette item places a collectible dust container (grants +4 max capacity). */
  isDustContainerItem?: 1;
  /** 1 if this palette item places a collectible dust container piece. */
  isDustContainerPieceItem?: 1;
  /** 1 if this palette item places a dust boost jar object (grants temporary dust of a specific kind). */
  isDustBoostJarItem?: 1;
  /** 1 if this palette item places a falling block tile (triggers as a rigid group when disturbed). */
  isFallingBlockItem?: 1;
  /** Which falling block variant this item places. Only meaningful when isFallingBlockItem === 1. */
  fallingBlockVariant?: import('../levels/roomDef').FallingBlockVariant;
}

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

/** Canonical list of ParticleKind string values available for editor dropdowns. */
export const DUST_KIND_OPTIONS: readonly string[] = [
  'Physical', 'Fire', 'Ice', 'Lightning', 'Poison', 'Arcane',
  'Wind', 'Holy', 'Shadow', 'Metal', 'Earth', 'Nature', 'Crystal', 'Void', 'Water', 'Lava', 'Stone',
];

export type RopeDestructibility = 'indestructible' | 'playerOnly' | 'any';

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

export interface EditorRope {
  uid: number;
  anchorAXBlock: number;
  anchorAYBlock: number;
  anchorBXBlock: number;
  anchorBYBlock: number;
  segmentCount: number;
  isAnchorBFixedFlag: 0 | 1;
  destructibility: RopeDestructibility;
  /** Visual and collision thickness index: 0=8 px, 1=16 px, 2=24 px. */
  thicknessIndex: 0 | 1 | 2;
}

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
  // Triggers (player-facing activators and room logic)
  { id: 'player_spawn',    label: 'Player Spawn',    category: 'triggers' },
  { id: 'room_transition', label: 'Room Transition', category: 'triggers' },
  { id: 'save_tomb',       label: 'Save Tomb',       category: 'triggers' },
  { id: 'dialogue_trigger', label: 'Dialogue Trigger', category: 'triggers' },
  // Collectables (items the player can pick up for permanent upgrades)
  { id: 'skill_tomb',            label: 'Skill Tomb',            category: 'collectables' },
  { id: 'dust_container',        label: 'Dust Container',        category: 'collectables', isDustContainerItem: 1 },
  { id: 'dust_container_piece',  label: 'Dust Container Piece',  category: 'collectables', isDustContainerPieceItem: 1 },
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
  { id: 'dust_boost_jar', label: 'Dust Jar (Object)', category: 'objects', isDustBoostJarItem: 1 },
  // ── Lighting layer ─────────────────────────────────────────────────────
  // Designer-facing authoring for the unified ambient lighting system.
  // See `RoomAmbientLightBlockerDef` / `RoomLightSourceDef` in roomDef.ts.
  { id: 'ambient_light_blocker',      label: 'Ambient Blocker', category: 'lighting', isAmbientLightBlockerItem: 1 },
  { id: 'dark_ambient_light_blocker', label: 'Dark Blocker',    category: 'lighting', isAmbientLightBlockerItem: 1, isDarkAmbientLightBlockerItem: 1 },
  { id: 'light_source',          label: 'Light Source',    category: 'lighting', isLightSourceItem: 1 },
  { id: 'sunbeam',               label: 'Sunbeam',         category: 'lighting', isSunbeamItem: 1 },
  // ── Liquids layer ───────────────────────────────────────────────────────
  { id: 'water_zone', label: 'Water Zone', category: 'liquids', defaultWidthBlocks: 4, defaultHeightBlocks: 4, isLiquidZoneItem: 1 },
  { id: 'lava_zone',  label: 'Lava Zone',  category: 'liquids', defaultWidthBlocks: 4, defaultHeightBlocks: 4, isLiquidZoneItem: 1 },
  // ── Crumble blocks ──────────────────────────────────────────────────────
  { id: 'crumble_block',    label: 'Crumble 1×1',       category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isCrumbleBlockItem: 1 },
  { id: 'crumble_block_2x2', label: 'Crumble 2×2',      category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isCrumbleBlockItem: 1 },
  { id: 'crumble_ramp_1x1', label: 'Crumble Ramp 1×1',  category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isCrumbleBlockItem: 1, isRampItem: 1 },
  { id: 'crumble_ramp_1x2', label: 'Crumble Ramp 1×2',  category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 1, isCrumbleBlockItem: 1, isRampItem: 1 },
  { id: 'crumble_ramp_2x2', label: 'Crumble Ramp 2×2',  category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2, isCrumbleBlockItem: 1, isRampItem: 1 },
  // ── Bounce pads ─────────────────────────────────────────────────────────
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
  // ── Falling blocks (triggers as rigid group when disturbed) ──────────────
  { id: 'falling_block_tough',     label: 'Falling Block, Tough',     category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isFallingBlockItem: 1, fallingBlockVariant: 'tough' as const },
  { id: 'falling_block_sensitive', label: 'Falling Block, Sensitive', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isFallingBlockItem: 1, fallingBlockVariant: 'sensitive' as const },
  { id: 'falling_block_crumbling', label: 'Falling Block, Crumbling', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1, isFallingBlockItem: 1, fallingBlockVariant: 'crumbling' as const },
  { id: 'rope', label: 'Rope', category: 'ropes', defaultWidthBlocks: 1, defaultHeightBlocks: 1 },
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

const DEFAULT_RECENT_BLOCK_THEMES: readonly BlockTheme[] = ['blackRock', 'brownRock', 'dirt'];

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

// ── Mutable editor room data (authored content) ─────────────────────────────

export interface EditorWall {
  uid: number;
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
  /** 1 if this wall is a one-way platform. */
  isPlatformFlag: 0 | 1;
  /**
   * Which edge of this platform block is the one-way surface.
   * 0 = top (default), 1 = bottom, 2 = left, 3 = right.
   */
  platformEdge: 0 | 1 | 2 | 3;
  /** Per-wall block theme override (defaults to room-level theme). */
  blockTheme?: BlockTheme;
  /**
   * Ramp orientation (0-3). Undefined or -1 = not a ramp.
   * 0=rises right(/), 1=rises left(\), 2=ceiling ramp(⌐), 3=ceiling ramp(¬).
   */
  rampOrientation?: 0 | 1 | 2 | 3;
  /** 1 if this pillar wall should be rendered and collide at half-block width. */
  isPillarHalfWidthFlag: 0 | 1;
}

export interface EditorEnemy {
  uid: number;
  xBlock: number;
  yBlock: number;
  /** ParticleKind string names, e.g. ['Fire', 'Ice']. */
  kinds: string[];
  particleCount: number;
  isBossFlag: 0 | 1;
  isFlyingEyeFlag: 0 | 1;
  isRollingEnemyFlag: 0 | 1;
  rollingEnemySpriteIndex: number;
  isRockElementalFlag: 0 | 1;
  isRadiantTetherFlag: 0 | 1;
  isGrappleHunterFlag: 0 | 1;
  isSlimeFlag: 0 | 1;
  isLargeSlimeFlag: 0 | 1;
  isWheelEnemyFlag: 0 | 1;
  isBeetleFlag: 0 | 1;
  isBubbleEnemyFlag: 0 | 1;
  isIceBubbleFlag: 0 | 1;
  isSquareStampedeFlag: 0 | 1;
  isGoldenMimicFlag?: 0 | 1;
  isGoldenMimicYFlippedFlag?: 0 | 1;
  isBeeSwarmFlag?: 0 | 1;
}

export interface EditorTransition {
  uid: number;
  direction: TransitionDirection;
  positionBlock: number;
  openingSizeBlocks: number;
  targetRoomId: string;
  targetSpawnBlock: [number, number];
  fadeColor?: string;
  /**
   * Left edge (for left/right) or top edge (for up/down) of the 6-block-deep
   * transition zone. When undefined the transition sits on the room boundary.
   * When defined the transition is an interior zone at this block position.
   */
  depthBlock?: number;
  /** When true, this transition is a secret door hidden from the player until approached. */
  isSecretDoor?: boolean;
  /** Width of the fade gradient in blocks (default: 3). */
  gradientWidthBlocks?: number;
}

/** A water zone rectangle placed in the room. */
export interface EditorWaterZone {
  uid: number;
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
}

/** A lava zone rectangle placed in the room. */
export interface EditorLavaZone {
  uid: number;
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
}

/** A crumble block that collapses on first player contact. */
export interface EditorCrumbleBlock {
  uid: number;
  xBlock: number;
  yBlock: number;
  /** Width in blocks (default 1). */
  wBlock: number;
  /** Height in blocks (default 1). */
  hBlock: number;
  /**
   * Ramp orientation (0-3). Undefined = not a ramp.
   * 0=rises right(/), 1=rises left(\), 2=ceiling ramp(⌐), 3=ceiling ramp(¬).
   */
  rampOrientation?: 0 | 1 | 2 | 3;
  /** Which elemental type this crumble block is weak to. */
  variant: CrumbleVariant;
  /** Per-block theme override. When set, overrides the room-level default. */
  blockTheme?: BlockTheme;
}

/** A bounce pad block that reflects the player's velocity on contact. */
export interface EditorBouncePad {
  uid: number;
  xBlock: number;
  yBlock: number;
  /** Width in blocks (default 1). */
  wBlock: number;
  /** Height in blocks (default 1). */
  hBlock: number;
  /**
   * Ramp orientation (0-3). Undefined = not a ramp.
   * 0=rises right(/), 1=rises left(\), 2=ceiling ramp(⌐), 3=ceiling ramp(¬).
   */
  rampOrientation?: 0 | 1 | 2 | 3;
  /** 0 = 50 % bounce (dim 2×2 core), 1 = 100 % bounce (bright 4×4 core). */
  speedFactorIndex: 0 | 1;
}

/** Save Tomb — where the player saves their progress. */
export interface EditorSaveTomb {
  uid: number;
  xBlock: number;
  yBlock: number;
}

/** Skill Tomb — grants the player a specific dust skill/weave when interacted with. */
export interface EditorSkillTomb {
  uid: number;
  xBlock: number;
  yBlock: number;
  /** The weave ID unlocked by this tomb. */
  weaveId: string;
}

/** Collectible dust container — grants +4 max dust particle capacity when picked up. */
export interface EditorDustContainer {
  uid: number;
  xBlock: number;
  yBlock: number;
}

/** Collectible dust container piece — accumulates toward a full dust container. */
export interface EditorDustContainerPiece {
  uid: number;
  xBlock: number;
  yBlock: number;
}

/** Dust boost jar — a breakable world object that temporarily grants dust particles of a specific kind. */
export interface EditorDustBoostJar {
  uid: number;
  xBlock: number;
  yBlock: number;
  /** The ParticleKind string name of the dust inside (e.g. 'Physical', 'Fire'). */
  dustKind: string;
  /** Number of temporary dust particles granted when broken. */
  dustCount: number;
}

export interface EditorDustPile {
  uid: number;
  xBlock: number;
  yBlock: number;
  dustCount: number;
  spreadBlocks?: number;
}

export interface EditorGrasshopperArea {
  uid: number;
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
  /** Number of grasshoppers to spawn in this area. */
  count: number;
}

export interface EditorFireflyArea {
  uid: number;
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
  count: number;
}

/** An editor-placed decoration (mushroom, grass, vine) anchored to a terrain surface. */
export interface EditorDecoration {
  uid: number;
  xBlock: number;
  yBlock: number;
  kind: DecorationKind;
}

/**
 * An editor-painted ambient-light blocker tile.
 *
 * One entry per opaque cell. The sparse cell-coordinate storage fits the
 * existing JSON arrays model (see ARCHITECTURE/roomJson.ts). The tile has
 * no collision, no hazard, and no visual geometry — it only influences
 * the ambient-light propagation pass.
 */
export interface EditorAmbientLightBlocker {
  uid: number;
  xBlock: number;
  yBlock: number;
  /**
   * 1 if this is a dark blocker that draws a solid black overlay over the air
   * cell, hiding the room background.  0 (or absent) for the standard clear blocker.
   */
  isDarkFlag: 0 | 1;
}

/** An editor-placed local light source (see {@link RoomLightSourceDef}). */
export interface EditorLightSource {
  uid: number;
  xBlock: number;
  yBlock: number;
  radiusBlocks: number;
  colorR: number;
  colorG: number;
  colorB: number;
  /** Designer-facing 0-100 percent brightness slider value. */
  brightnessPct: number;
  /** Number of atmospheric dust motes near this source (0 = none). */
  dustMoteCount: number;
  /** Radius (blocks) in which dust motes spawn; 0 = use radiusBlocks. */
  dustMoteSpreadBlocks: number;
}

/** An editor-placed sunbeam (see {@link RoomSunbeamDef}). */
export interface EditorSunbeam {
  uid: number;
  xBlock: number;
  yBlock: number;
  /** Angle (radians) the beam travels — 0 = right, π/2 = down. */
  angleRad: number;
  /** Width of the beam base in blocks. */
  widthBlocks: number;
  /** Length of the beam shaft in blocks. */
  lengthBlocks: number;
  colorR: number;
  colorG: number;
  colorB: number;
  /** Intensity as 0–100 percent. */
  intensityPct: number;
}

/** An editor-painted falling block tile (one tile per entry). */
export interface EditorFallingBlock {
  uid: number;
  xBlock: number;
  yBlock: number;
  /** Which falling block variant this tile belongs to. */
  variant: import('../levels/roomDef').FallingBlockVariant;
}

/** A dialogue trigger zone that starts a conversation when the player enters it. */
export interface EditorDialogueEntry {
  text: string;
  portraitId: string;
  portraitSide: 'left' | 'right';
}

export interface EditorDialogueTrigger {
  uid: number;
  xBlock: number;
  yBlock: number;
  /** Width in blocks (default 4). */
  wBlock: number;
  /** Height in blocks (default 4). */
  hBlock: number;
  conversationId: string;
  /** Optional speaker name displayed above the dialogue text. */
  conversationTitle: string;
  /** Dialogue entries, max 99. */
  entries: EditorDialogueEntry[];
}

export interface EditorRoomData {
  id: string;
  name: string;
  worldNumber: number;
  /** X position on the visual world map (map world units). */
  mapX: number;
  /** Y position on the visual world map (map world units). */
  mapY: number;
  /** Block sprite theme for this room. Defaults to 'blackRock'. */
  blockTheme: BlockTheme;
  /** Background visual for this room. */
  backgroundId: BackgroundId;
  /** Lighting model for this room. */
  lightingEffect: LightingEffect;
  /**
   * Direction ambient/skylight arrives from. Undefined means "use whatever
   * the legacy `lightingEffect` value implies" (omni for `DEFAULT`/`Ambient`,
   * down for `Above`).
   */
  ambientLightDirection?: AmbientLightDirection;
  /**
   * Background music for this room.
   * '_continue' = keep playing the previous room's song (default).
   * '_silence'  = stop music when entering this room.
   * Any other value = switch to the named song when entering this room.
   */
  songId: RoomSongId;
  widthBlocks: number;
  heightBlocks: number;
  playerSpawnBlock: [number, number];
  interiorWalls: EditorWall[];
  enemies: EditorEnemy[];
  transitions: EditorTransition[];
  saveTombs: EditorSaveTomb[];
  skillTombs: EditorSkillTomb[];
  dustContainers: EditorDustContainer[];
  dustContainerPieces: EditorDustContainerPiece[];
  dustBoostJars: EditorDustBoostJar[];
  dustPiles: EditorDustPile[];
  grasshopperAreas: EditorGrasshopperArea[];
  /** Firefly spawn areas (free-roaming fireflies, not jar-based). */
  fireflyAreas: EditorFireflyArea[];
  /** Editor-placed decorations (glowing mushrooms, grass tufts, vines). */
  decorations: EditorDecoration[];
  /** Editor-painted ambient-light blocker tiles (sparse). */
  ambientLightBlockers: EditorAmbientLightBlocker[];
  /** Editor-placed local light sources. */
  lightSources: EditorLightSource[];
  /** Water zones placed in this room. */
  waterZones?: EditorWaterZone[];
  /** Lava zones placed in this room. */
  lavaZones?: EditorLavaZone[];
  /** Crumble blocks placed in this room (collapse on first player contact). */
  crumbleBlocks?: EditorCrumbleBlock[];
  /** Bounce pads placed in this room (reflect player velocity on contact). */
  bouncePads?: EditorBouncePad[];
  /** Ropes placed in this room. */
  ropes?: EditorRope[];
  /** Sunbeams placed in this room. */
  sunbeams?: EditorSunbeam[];
  /** Falling block tiles placed in this room. */
  fallingBlocks?: EditorFallingBlock[];
  /** Dialogue trigger zones placed in this room. */
  dialogueTriggers?: EditorDialogueTrigger[];
}

// ── Selected element reference ───────────────────────────────────────────────

export type SelectedElementType = 'wall' | 'enemy' | 'transition' | 'saveTomb' | 'skillTomb' | 'dustContainer' | 'dustContainerPiece' | 'dustBoostJar' | 'dustPile' | 'grasshopperArea' | 'fireflyArea' | 'decoration' | 'playerSpawn' | 'ambientLightBlocker' | 'lightSource' | 'waterZone' | 'lavaZone' | 'crumbleBlock' | 'bouncePad' | 'rope' | 'sunbeam' | 'fallingBlock' | 'dialogueTrigger';

export interface SelectedElement {
  type: SelectedElementType;
  uid: number;
}

// ── Editor state ─────────────────────────────────────────────────────────────

export interface EditorState {
  isActive: boolean;
  activeTool: EditorTool;
  activeCategory: PaletteCategory;
  selectedPaletteItem: PaletteItem | null;
  selectedElements: SelectedElement[];
  /** Block theme assigned to newly placed wall blocks. */
  selectedBlockTheme: BlockTheme;
  /** Last three block themes picked for placement, most recent first. */
  recentBlockThemes: BlockTheme[];
  /** Current placement rotation in 90° steps (0, 1, 2, 3). */
  placementRotationSteps: number;
  /** Whether the current placement is horizontally flipped. */
  placementFlipH: boolean;
  /** Mouse position in block units (snapped to grid). */
  cursorBlockX: number;
  cursorBlockY: number;
  /** Mouse position in world units (un-snapped). */
  cursorWorldX: number;
  cursorWorldY: number;
  /** Whether the world map overlay is open in editor mode. */
  isWorldMapOpen: boolean;
  /** Whether the visual world map editor is open (N key). */
  isVisualMapOpen: boolean;
  /** Whether we are in transition link mode. */
  isLinkingTransition: boolean;
  /** UID of the source transition being linked. */
  linkSourceTransitionUid: number;
  /** Room data being edited (mutable authored content). */
  roomData: EditorRoomData | null;
  /** Next unique ID for placed elements. */
  nextUid: number;
  /** Whether the user is dragging selected elements. */
  isDragging: boolean;
  /** Block coordinates where drag started. */
  dragStartBlockX: number;
  dragStartBlockY: number;
  /** Whether a drag selection box is active. */
  isSelectionBoxActive: boolean;
  /** Block coordinates where selection box started. */
  selectionBoxStartBlockX: number;
  selectionBoxStartBlockY: number;
  /** Serialized clipboard data for copy/paste. */
  clipboard: string | null;
  /**
   * Which skill (weave) a newly placed skill tomb will contain.
   * Populated from the skill picker dropdown when skill_tomb is selected.
   */
  pendingSkillTombWeaveId: string;
  /**
   * Which crumble variant a newly placed crumble block will have.
   * Populated from the crumble variant dropdown when a crumble item is selected.
   */
  pendingCrumbleVariant: CrumbleVariant;
  /**
   * Which dust kind a newly placed dust boost jar will contain.
   * Populated from the dust kind dropdown when dust_boost_jar is selected.
   */
  pendingDustBoostJarKind: string;
  /**
   * How many dust particles a newly placed dust boost jar grants when broken.
   */
  pendingDustBoostJarCount: number;
  /**
   * Pending first anchor when placing a rope (null if not in rope-placement mode).
   */
  pendingRopeAnchorXBlock: number | null;
  pendingRopeAnchorYBlock: number | null;
  /**
   * The element the mouse is currently hovering over (Select tool only).
   * Null when no element is under the cursor or when not using the Select tool.
   */
  hoverElement: SelectedElement | null;
}

export function createEditorState(): EditorState {
  return {
    isActive: false,
    activeTool: EditorTool.Select,
    activeCategory: 'blocks',
    selectedPaletteItem: null,
    selectedElements: [],
    selectedBlockTheme: 'blackRock',
    recentBlockThemes: [...DEFAULT_RECENT_BLOCK_THEMES],
    placementRotationSteps: 0,
    placementFlipH: false,
    cursorBlockX: 0,
    cursorBlockY: 0,
    cursorWorldX: 0,
    cursorWorldY: 0,
    isWorldMapOpen: false,
    isVisualMapOpen: false,
    isLinkingTransition: false,
    linkSourceTransitionUid: -1,
    roomData: null,
    nextUid: 1,
    isDragging: false,
    dragStartBlockX: 0,
    dragStartBlockY: 0,
    isSelectionBoxActive: false,
    selectionBoxStartBlockX: 0,
    selectionBoxStartBlockY: 0,
    clipboard: null,
    pendingSkillTombWeaveId: WEAVE_LIST[0] ?? 'storm',
    pendingCrumbleVariant: 'normal',
    pendingDustBoostJarKind: 'Physical',
    pendingDustBoostJarCount: 5,
    pendingRopeAnchorXBlock: null,
    pendingRopeAnchorYBlock: null,
    hoverElement: null,
  };
}

/** Generates a unique ID for a new editor element. */
export function allocateUid(state: EditorState): number {
  return state.nextUid++;
}

// ── Editor UI shared types ────────────────────────────────────────────────────
// These live here so both editorUI.ts and editorInspector.ts can import them
// without creating a circular dependency.

/** The four edges of the room that can be grown or shrunk via the edge-resize buttons. */
export type RoomEdge = 'top' | 'bottom' | 'left' | 'right';

/** Callbacks wired from EditorUI to EditorController. */
export interface EditorUICallbacks {
  onToolChange: (tool: EditorTool) => void;
  onCategoryChange: (category: PaletteCategory) => void;
  onPaletteItemSelect: (item: PaletteItem) => void;
  onExport: () => void;
  onLinkTransition: () => void;
  onPropertyChange: (prop: string, value: string | number) => void;
  onRoomDimensionsChange: (prop: 'widthBlocks' | 'heightBlocks', value: number) => void;
  /** Add or remove one row/column from the given edge. delta is +1 (add) or -1 (remove). */
  onEdgeResize: (edge: RoomEdge, delta: 1 | -1) => void;
  onBlockThemeChange: (theme: BlockTheme) => void;
  onLightingEffectChange: (effect: LightingEffect) => void;
  onAmbientLightDirectionChange: (direction: AmbientLightDirection | undefined) => void;
  onBackgroundChange: (backgroundId: BackgroundId) => void;
  onRoomSongChange: (songId: RoomSongId) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onExportAllChanges: () => void;
  /** Open the visual world map overlay. */
  onOpenVisualMap: () => void;
  /** Called when the user picks a different skill in the skill tomb dropdown. */
  onSkillTombWeaveChange: (weaveId: string) => void;
  /** Called when the user picks a different crumble variant in the crumble variant dropdown. */
  onCrumbleVariantChange: (variant: CrumbleVariant) => void;
  /** Called when the user picks a different dust kind for the dust boost jar. */
  onDustBoostJarKindChange: (dustKind: string) => void;
  /** Called when the user changes the dust count for the dust boost jar. */
  onDustBoostJarCountChange: (dustCount: number) => void;
}

/** Selects the placement block theme and updates the recent-theme strip. */
export function selectBlockTheme(state: EditorState, theme: BlockTheme): void {
  state.selectedBlockTheme = theme;
  const nextRecent: BlockTheme[] = [theme];
  for (const recentTheme of state.recentBlockThemes) {
    if (recentTheme !== theme && nextRecent.length < 3) nextRecent.push(recentTheme);
  }
  for (const fallbackTheme of DEFAULT_RECENT_BLOCK_THEMES) {
    if (!nextRecent.includes(fallbackTheme) && nextRecent.length < 3) nextRecent.push(fallbackTheme);
  }
  state.recentBlockThemes = nextRecent;
}
