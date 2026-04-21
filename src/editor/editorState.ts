/**
 * Core editor state — tracks mode, active tool, palette selection,
 * selected elements, and mutable room data being edited.
 *
 * The editor operates on a mutable copy of authored room data (EditorRoomData)
 * which can be exported to JSON and later rebuilt into a RoomDef.
 */

import type { TransitionDirection, BlockTheme, BackgroundId, LightingEffect, DecorationKind } from '../levels/roomDef';
import type { RoomSongId } from '../audio/musicManager';
import { AVAILABLE_SONGS, SONG_DISPLAY_NAMES } from '../audio/musicManager';
import { WEAVE_LIST } from '../sim/weaves/weaveDefinition';

// Re-export for convenience in editor modules
export type { BlockTheme, BackgroundId, LightingEffect, DecorationKind } from '../levels/roomDef';
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

export type PaletteCategory = 'blocks' | 'enemies' | 'triggers';

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
  // Triggers
  { id: 'player_spawn', label: 'Player Spawn', category: 'triggers' },
  { id: 'room_transition', label: 'Room Transition', category: 'triggers' },
  { id: 'save_tomb', label: 'Save Tomb', category: 'triggers' },
  { id: 'skill_tomb', label: 'Skill Tomb', category: 'triggers' },
  { id: 'dust_pile_small',  label: 'Dust Pile (S)',  category: 'triggers' },
  { id: 'dust_pile_medium', label: 'Dust Pile (M)',  category: 'triggers' },
  { id: 'dust_pile_large',  label: 'Dust Pile (L)',  category: 'triggers' },
  // Legacy alias kept for backward-compat with older room exports
  { id: 'dust_pile', label: 'Dust Pile', category: 'triggers' },
  { id: 'grasshopper_area', label: 'Grasshopper Area', category: 'triggers' },
  // Decorations
  { id: 'decoration_mushroom',  label: 'Glow Mushroom', category: 'triggers' },
  { id: 'decoration_glowgrass', label: 'Glow Grass',    category: 'triggers' },
  { id: 'decoration_vine',      label: 'Glow Vine',     category: 'triggers' },
];

/** Available block themes for the editor dropdown. */
export const BLOCK_THEMES: readonly { id: BlockTheme; label: string }[] = [
  { id: 'blackRock', label: 'Black Rock' },
  { id: 'brownRock', label: 'Brown Rock' },
  { id: 'dirt',      label: 'Dirt' },
];

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

/** Available lighting models for the editor dropdown. */
export const LIGHTING_OPTIONS: readonly { id: LightingEffect; label: string }[] = [
  { id: 'DEFAULT',  label: 'DEFAULT' },
  { id: 'Above',    label: 'Above' },
  { id: 'DarkRoom', label: 'Dark Room' },
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

export interface EditorDustPile {
  uid: number;
  xBlock: number;
  yBlock: number;
  dustCount: number;
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

/** An editor-placed decoration (mushroom, grass, vine) anchored to a terrain surface. */
export interface EditorDecoration {
  uid: number;
  xBlock: number;
  yBlock: number;
  kind: DecorationKind;
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
  dustPiles: EditorDustPile[];
  grasshopperAreas: EditorGrasshopperArea[];
  /** Editor-placed decorations (glowing mushrooms, grass tufts, vines). */
  decorations: EditorDecoration[];
}

// ── Selected element reference ───────────────────────────────────────────────

export type SelectedElementType = 'wall' | 'enemy' | 'transition' | 'saveTomb' | 'skillTomb' | 'dustPile' | 'grasshopperArea' | 'decoration' | 'playerSpawn';

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
    hoverElement: null,
  };
}

/** Generates a unique ID for a new editor element. */
export function allocateUid(state: EditorState): number {
  return state.nextUid++;
}
