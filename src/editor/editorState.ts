/**
 * Core editor state — tracks mode, active tool, palette selection,
 * selected elements, and mutable room data being edited.
 *
 * The editor operates on a mutable copy of authored room data (EditorRoomData)
 * which can be exported to JSON and later rebuilt into a RoomDef.
 *
 * Read-only dropdown/palette constants have been extracted to editorDropdownData.ts.
 */

import type { TransitionDirection, BlockTheme, BlockSoundHardness, BackgroundId, LightingEffect, DecorationKind, AmbientLightDirection, CrumbleVariant } from '../levels/roomDef';
import type { LightType, LightBlendMode } from '../levels/lightingSchema';
import type { RoomSongId } from '../audio/musicManager';
import { WEAVE_LIST } from '../sim/weaves/weaveDefinition';
import type { BrushMode, PaletteCategory, PaletteItem, RopeDestructibility } from './editorDropdownData';

// Re-export for convenience in editor modules
export type { BlockTheme, BlockThemeId, BlockSoundHardness, BackgroundId, LightingEffect, DecorationKind, AmbientLightDirection, CrumbleVariant } from '../levels/roomDef';
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

/** Editor representation of a scene light (adds `uid` to the runtime LightDef). */
export interface EditorSceneLight {
  uid: number;
  xWorld: number;
  yWorld: number;
  kind: LightType;
  radiusWorld: number;
  colorR: number;
  colorG: number;
  colorB: number;
  intensityPct: number;
  blendMode: LightBlendMode;
  castsShadowsFlag: 0 | 1;
  coneAngleRad?: number;
  rotationRad?: number;
  shadowSoftness?: number;
  isPulsingFlag?: 0 | 1;
  pulseSpeedHz?: number;
  pulseAmplitude?: number;
}

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
  /** Per-wall player SFX material hardness. Defaults from wall/room theme. */
  soundHardness?: BlockSoundHardness;
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
  isWebSpiderFlag?: 0 | 1;
}

export interface EditorTransition {
  uid: number;
  direction: TransitionDirection;
  /**
   * X block coordinate of the top-left corner of the transition zone.
   * For left/right transitions this is the x-start of the gradient zone.
   * For up/down transitions this is the x-start of the opening.
   */
  xBlock: number;
  /**
   * Y block coordinate of the top-left corner of the transition zone.
   * For left/right transitions this is the y-start of the opening.
   * For up/down transitions this is the y-start of the gradient zone.
   */
  yBlock: number;
  openingSizeBlocks: number;
  targetRoomId: string;
  targetSpawnBlock: [number, number];
  fadeColor?: string;
  /** When true, this transition is a secret door hidden from the player until approached. */
  isSecretDoor?: boolean;
  /** Depth of the fade gradient zone in the facing direction, in blocks (default: 3). */
  gradientWidthBlocks?: number;
  /**
   * When true, entering this transition uses the legacy teleport-style room load
   * instead of seamless adjacent-room camera crossing.
   */
  longTransition?: boolean;
  /**
   * @deprecated Legacy field — y-start (for left/right) or x-start (for up/down) of the
   * opening. Superseded by xBlock/yBlock. Kept for backward-compatible JSON round-trips.
   */
  positionBlock: number;
  /**
   * @deprecated Legacy field — x-start (for left/right) or y-start (for up/down) of the
   * gradient zone. Superseded by xBlock/yBlock. When undefined in old data the transition
   * sat on the room boundary. Kept for backward-compatible JSON round-trips.
   */
  depthBlock?: number;
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

/**
 * Dust swarm — a collectable sandstorm of a specific dust kind.
 * Player walks nearby and presses F to collect and receive the dust particles.
 */
export interface EditorDustSwarm {
  uid: number;
  xBlock: number;
  yBlock: number;
  /** The ParticleKind string name of the dust (e.g. 'Fire', 'Ice', 'Physical'). */
  dustKind: string;
  /** Number of dust particles granted on collection. */
  dustCount: number;
}

export interface EditorLambdaAnchor {
  uid: number;
  xBlock: number;
  yBlock: number;
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

/** A visual-only background block painted by the editor. */
export interface EditorBackgroundBlock {
  uid: number;
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
  /** Override block theme for this block. Null = use room theme. */
  blockTheme: string | null;
  /** 1 if this block should block ambient light. */
  isLightBlockingFlag: 0 | 1;
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
  /** Collectable dust-type swarms placed in this room. */
  dustSwarms: EditorDustSwarm[];
  /** Lambda Anchors — golden λ-glyph poles acting as temporary recall points. */
  lambdaAnchors: EditorLambdaAnchor[];
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
  /** Scene lights (visibility-polygon shadow system) placed in this room. */
  sceneLights?: EditorSceneLight[];
  /** Falling block tiles placed in this room. */
  fallingBlocks?: EditorFallingBlock[];
  /** Dialogue trigger zones placed in this room. */
  dialogueTriggers?: EditorDialogueTrigger[];
  /** Visual-only background blocks — no collision, drawn behind foreground walls. */
  backgroundBlocks?: EditorBackgroundBlock[];
}

// ── Selected element reference ───────────────────────────────────────────────

export type SelectedElementType = 'wall' | 'enemy' | 'transition' | 'saveTomb' | 'skillTomb' | 'dustContainer' | 'dustContainerPiece' | 'dustBoostJar' | 'dustSwarm' | 'lambdaAnchor' | 'dustPile' | 'grasshopperArea' | 'fireflyArea' | 'decoration' | 'playerSpawn' | 'ambientLightBlocker' | 'lightSource' | 'waterZone' | 'lavaZone' | 'crumbleBlock' | 'bouncePad' | 'rope' | 'sunbeam' | 'sceneLight' | 'fallingBlock' | 'dialogueTrigger' | 'backgroundBlock';

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
    pendingDustSwarmKind: 'Physical',
    pendingDustSwarmCount: 5,
    pendingRopeAnchorXBlock: null,
    pendingRopeAnchorYBlock: null,
    pendingSceneLightType: 'softGlow',
    hoverElement: null,
    brushMode: 'single',
    brushRectStartBlockX: null,
    brushRectStartBlockY: null,
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
  /** Called when the user changes the brush mode. */
  onBrushModeChange: (mode: BrushMode) => void;
  /** Called when the user clicks "Export Campaign JSON" while editing a custom campaign. */
  onExportCampaignJson?: () => void;
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
