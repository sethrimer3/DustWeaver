/**
 * Core editor state — tracks mode, active tool, palette selection,
 * selected elements, and mutable room data being edited.
 *
 * The editor operates on a mutable copy of authored room data (EditorRoomData)
 * which can be exported to JSON and later rebuilt into a RoomDef.
 *
 * Read-only dropdown/palette constants have been extracted to editorDropdownData.ts.
 * Editor element interfaces have been extracted to editorElementTypes.ts.
 */

import { WEAVE_LIST } from '../sim/weaves/weaveDefinition';
import type { BlockTheme, BackgroundId, LightingEffect, AmbientLightDirection, CrumbleVariant, FallingBlockVariant, BlockSeamBlending, VoidEdgeStyle } from '../levels/roomDef';
import type { LightType } from '../levels/lightingSchema';
import type { RoomSongId } from '../audio/musicManager';
import type { BrushMode, PaletteCategory, PaletteItem } from './editorDropdownData';
import type { SelectedElement, EditorRoomData } from './editorElementTypes';

// Re-export element types so existing consumers need not change their imports.
export type {
  EditorRope, EditorSceneLight, EditorWall, EditorEnemy, EditorTransition,
  EditorWaterZone, EditorLavaZone, EditorCrumbleBlock, EditorSpike, EditorBouncePad, EditorKineticBlock,
  EditorGrappleCarryBlock, EditorPhantasmalTile,
  EditorSaveTomb, EditorSkillTomb, EditorDustContainer, EditorDustContainerPiece,
  EditorDustBoostJar, EditorDustSwarm, EditorLambdaAnchor, EditorDustPile,
  EditorGrasshopperArea, EditorFireflyArea, EditorDecoration,
  EditorAmbientLightBlocker, EditorLightSource, EditorSunbeam, EditorFallingBlock,
  EditorBackgroundBlock, EditorDialogueEntry, EditorDialogueTrigger,
  EditorGuideDustPath, EditorGuideDustPathPoint,
  EditorRoomData, SelectedElementType, SelectedElement,
} from './editorElementTypes';

// Re-export for convenience in editor modules
export type { BlockTheme, BlockThemeId, BlockSoundHardness, BackgroundId, LightingEffect, DecorationKind, AmbientLightDirection, CrumbleVariant, BlockSeamBlending, VoidEdgeStyle } from '../levels/roomDef';
export type { LightType, LightBlendMode } from '../levels/lightingSchema';
export type { RoomSongId } from '../audio/musicManager';
// Re-export dropdown data so existing consumers don't need to change their imports.
export type { BrushMode, PaletteCategory, PaletteItem, RopeDestructibility } from './editorDropdownData';
export {
  SONG_OPTIONS, CRUMBLE_VARIANT_OPTIONS, SCENE_LIGHT_TYPE_OPTIONS,
  DUST_KIND_OPTIONS, ROPE_DESTRUCTIBILITY_OPTIONS, ROPE_THICKNESS_OPTIONS,
  PALETTE_ITEMS, BLOCK_THEMES, BACKGROUND_OPTIONS, LIGHTING_OPTIONS,
  AMBIENT_LIGHT_DIRECTION_OPTIONS, FADE_COLOR_OPTIONS,
} from './editorDropdownData';

// ── Editor tool enum ─────────────────────────────────────────────────────────

export enum EditorTool {
  Select = 'select',
  Place = 'place',
  Delete = 'delete',
}

export type BlockPlacementModifier = 'none' | 'cracked' | FallingBlockVariant;

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
  /**
   * If the currently-open room contains the campaign spawn, this holds its
   * [xBlock, yBlock] position.  Null when the campaign spawn is in a different
   * room (or when no campaign spawn has been placed yet).
   * Managed by the editor controller — not stored in room JSON.
   */
  campaignSpawnBlock: [number, number] | null;
  /**
   * Starting options for the campaign spawn (non-null when campaignSpawnBlock is not null).
   * Mirrors the optional starting configuration fields from CampaignSpawnData.
   * Managed by the editor controller — not stored in room JSON.
   */
  campaignSpawnStartingOptions: {
    startingHealth?: number;
    startingDustContainerCount?: number;
    startingDustTypes?: string[];
    startingWeaves?: string[];
  } | null;
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
  /** Optional modifier applied when placing ordinary block boxes. */
  pendingBlockPlacementModifier: BlockPlacementModifier;
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
   * Which dust kind a newly placed dust swarm will contain.
   */
  pendingDustSwarmKind: string;
  /**
   * How many dust particles a newly placed dust swarm grants when collected.
   */
  pendingDustSwarmCount: number;
  /**
   * Pending first anchor when placing a rope (null if not in rope-placement mode).
   */
  pendingRopeAnchorXBlock: number | null;
  pendingRopeAnchorYBlock: number | null;
  /**
   * Which LightType a newly placed scene light will use.
   */
  pendingSceneLightType: LightType;
  /**
   * The element the mouse is currently hovering over (Select tool only).
   * Null when no element is under the cursor or when not using the Select tool.
   */
  hoverElement: SelectedElement | null;
  /** Active brush mode for the Place tool. */
  brushMode: BrushMode;
  /** Block X where a rect-brush drag started (null when not dragging). */
  brushRectStartBlockX: number | null;
  /** Block Y where a rect-brush drag started (null when not dragging). */
  brushRectStartBlockY: number | null;
  /**
   * When a guide dust path is selected, the index of the control point that is
   * currently highlighted / being dragged. Null when no control point is active.
   */
  guideDustPathSelectedPointIndex: number | null;
}

export function createEditorState(): EditorState {
  return {
    isActive: false,
    activeTool: EditorTool.Select,
    activeCategory: 'blocks',
    selectedPaletteItem: null,
    selectedElements: [],
    selectedBlockTheme: 'blackRock',
    recentBlockThemes: [],
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
    campaignSpawnBlock: null,
    campaignSpawnStartingOptions: null,
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
    pendingBlockPlacementModifier: 'none',
    pendingDustBoostJarKind: 'Physical',
    pendingDustBoostJarCount: 5,
    pendingDustSwarmKind: 'Physical',
    pendingDustSwarmCount: 5,
    pendingRopeAnchorXBlock: null,
    pendingRopeAnchorYBlock: null,
    pendingSceneLightType: 'softGlow',
    hoverElement: null,
    brushMode: 'single',
    brushRectStartBlockX: null,
    brushRectStartBlockY: null,
    guideDustPathSelectedPointIndex: null,
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
  onDirectionalBiasChange: (value: number) => void;
  onSideExposureStrengthChange: (value: number) => void;
  onMinimumWallLightChange: (value: number) => void;
  onFalloffPowerChange: (value: number) => void;
  onBackgroundLightSpillChange: (value: number) => void;
  onSolidLightSoftnessChange: (value: number) => void;
  onSunraysEnabledChange: (enabled: boolean) => void;
  onSunraysStyleChange: (style: 'hard' | 'soft') => void;
  onSunraysAngleChange: (angleDeg: number) => void;
  onSunraysIntensityChange: (value: number) => void;
  onSunraysRayCountChange: (value: number) => void;
  onSunraysAnimationChange: (enabled: boolean) => void;
  onSeamBlendingChange: (mode: BlockSeamBlending) => void;
  onVoidEdgeStyleChange: (style: VoidEdgeStyle) => void;
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
  /** Called when the user toggles the cracked/falling block placement modifier. */
  onBlockPlacementModifierChange: (modifier: BlockPlacementModifier) => void;
  /** Called when the user picks a different dust kind for the dust boost jar. */
  onDustBoostJarKindChange: (dustKind: string) => void;
  /** Called when the user changes the dust count for the dust boost jar. */
  onDustBoostJarCountChange: (dustCount: number) => void;
  /** Called when the user changes the brush mode. */
  onBrushModeChange: (mode: BrushMode) => void;
  /** Called when the user clicks "Export Campaign JSON" while editing a custom campaign. */
  onExportCampaignJson?: () => void;
  /** DEV-only: run the active campaign room-file audit and log results. */
  onRunRoomAudit?: () => void;
  /** DEV-only: validate active campaign rooms through dehydrate -> hydrate. */
  onRunRoomRoundTripValidation?: () => void;
}

/** Selects the placement block theme and updates the recent-theme strip. */
export function selectBlockTheme(state: EditorState, theme: BlockTheme): void {
  state.selectedBlockTheme = theme;
  const nextRecent: BlockTheme[] = [theme];
  for (const recentTheme of state.recentBlockThemes) {
    if (recentTheme !== theme && nextRecent.length < 3) nextRecent.push(recentTheme);
  }
  state.recentBlockThemes = nextRecent;
}
