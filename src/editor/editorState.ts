/**
 * Core editor state — tracks mode, active tool, palette selection,
 * selected elements, and mutable room data being edited.
 *
 * The editor operates on a mutable copy of authored room data (EditorRoomData)
 * which can be exported to JSON and later rebuilt into a RoomDef.
 */

import type { TransitionDirection } from '../levels/roomDef';

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
}

/** Built-in palette items available in the editor. */
export const PALETTE_ITEMS: readonly PaletteItem[] = [
  // Blocks / terrain
  { id: 'wall_1x1', label: 'Wall 1×1', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1 },
  { id: 'wall_2x1', label: 'Wall 2×1', category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 1 },
  { id: 'wall_4x1', label: 'Platform 4×1', category: 'blocks', defaultWidthBlocks: 4, defaultHeightBlocks: 1 },
  { id: 'wall_6x1', label: 'Platform 6×1', category: 'blocks', defaultWidthBlocks: 6, defaultHeightBlocks: 1 },
  { id: 'wall_1x4', label: 'Pillar 1×4', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 4 },
  { id: 'wall_3x3', label: 'Block 3×3', category: 'blocks', defaultWidthBlocks: 3, defaultHeightBlocks: 3 },
  { id: 'brownRock_1x1_v1', label: 'Brown Rock 1', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1 },
  { id: 'brownRock_1x1_v2', label: 'Brown Rock 2', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1 },
  { id: 'brownRock_1x1_v3', label: 'Brown Rock 3', category: 'blocks', defaultWidthBlocks: 1, defaultHeightBlocks: 1 },
  { id: 'brownRock_2x2',    label: 'Brown Rock Large', category: 'blocks', defaultWidthBlocks: 2, defaultHeightBlocks: 2 },
  // Enemies
  { id: 'enemy_rolling', label: 'Rolling Enemy', category: 'enemies' },
  { id: 'enemy_flying_eye', label: 'Flying Eye', category: 'enemies' },
  { id: 'enemy_rock_elemental', label: 'Rock Elemental', category: 'enemies' },
  // Triggers
  { id: 'player_spawn', label: 'Player Spawn', category: 'triggers' },
  { id: 'room_transition', label: 'Room Transition', category: 'triggers' },
  { id: 'skill_tomb', label: 'Skill Tomb', category: 'triggers' },
];

// ── Mutable editor room data (authored content) ─────────────────────────────

export interface EditorWall {
  uid: number;
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
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
}

export interface EditorTransition {
  uid: number;
  direction: TransitionDirection;
  positionBlock: number;
  openingSizeBlocks: number;
  targetRoomId: string;
  targetSpawnBlock: [number, number];
}

export interface EditorSkillTomb {
  uid: number;
  xBlock: number;
  yBlock: number;
}

export interface EditorRoomData {
  id: string;
  name: string;
  worldNumber: number;
  widthBlocks: number;
  heightBlocks: number;
  playerSpawnBlock: [number, number];
  interiorWalls: EditorWall[];
  enemies: EditorEnemy[];
  transitions: EditorTransition[];
  skillTombs: EditorSkillTomb[];
}

// ── Selected element reference ───────────────────────────────────────────────

export type SelectedElementType = 'wall' | 'enemy' | 'transition' | 'skillTomb' | 'playerSpawn';

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
  selectedElement: SelectedElement | null;
  /** Current placement rotation in 90° steps (0, 1, 2, 3). */
  placementRotationSteps: number;
  /** Mouse position in block units (snapped to grid). */
  cursorBlockX: number;
  cursorBlockY: number;
  /** Mouse position in world units (un-snapped). */
  cursorWorldX: number;
  cursorWorldY: number;
  /** Whether the world map overlay is open in editor mode. */
  isWorldMapOpen: boolean;
  /** Whether we are in transition link mode. */
  isLinkingTransition: boolean;
  /** UID of the source transition being linked. */
  linkSourceTransitionUid: number;
  /** Room data being edited (mutable authored content). */
  roomData: EditorRoomData | null;
  /** Next unique ID for placed elements. */
  nextUid: number;
}

export function createEditorState(): EditorState {
  return {
    isActive: false,
    activeTool: EditorTool.Select,
    activeCategory: 'blocks',
    selectedPaletteItem: null,
    selectedElement: null,
    placementRotationSteps: 0,
    cursorBlockX: 0,
    cursorBlockY: 0,
    cursorWorldX: 0,
    cursorWorldY: 0,
    isWorldMapOpen: false,
    isLinkingTransition: false,
    linkSourceTransitionUid: -1,
    roomData: null,
    nextUid: 1,
  };
}

/** Generates a unique ID for a new editor element. */
export function allocateUid(state: EditorState): number {
  return state.nextUid++;
}
