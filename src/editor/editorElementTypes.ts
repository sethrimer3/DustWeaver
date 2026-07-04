/**
 * editorElementTypes.ts — Editor element interface definitions.
 *
 * Contains all Editor* element interfaces (EditorWall, EditorEnemy,
 * EditorTransition, collectibles, hazards, lighting, ropes, etc.) and the
 * EditorRoomData aggregate that owns them, plus SelectedElementType /
 * SelectedElement.
 *
 * Extracted from editorState.ts so that the core state module stays focused
 * on the EditorState shape and state-management helpers while element types
 * remain independently importable.  editorState.ts re-exports everything here
 * so all existing import paths continue to work without change.
 */

import type { TransitionDirection, BlockTheme, BackgroundId, LightingEffect, DecorationKind, AmbientLightDirection, CrumbleVariant, BlockSeamBlending, VoidEdgeStyle } from '../levels/roomDef';
import type { LightType, LightBlendMode } from '../levels/lightingSchema';
import type { RoomSongId } from '../audio/musicManager';

// ── Ropes ─────────────────────────────────────────────────────────────────────

export interface EditorRope {
  uid: number;
  anchorAXBlock: number;
  anchorAYBlock: number;
  anchorBXBlock: number;
  anchorBYBlock: number;
  segmentCount: number;
  isAnchorBFixedFlag: 0 | 1;
  destructibility: import('./editorDropdownData').RopeDestructibility;
  /** Visual and collision thickness index: 0=8 px, 1=16 px, 2=24 px. */
  thicknessIndex: 0 | 1 | 2;
}

// ── Scene lights ──────────────────────────────────────────────────────────────

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
  angleRad?: number;
  lengthWorld?: number;
  widthStartWorld?: number;
  widthEndWorld?: number;
  softness?: number;
  strandCount?: number;
  opacity?: number;
  noiseStrength?: number;
  flickerStrength?: number;
  dustEnabledFlag?: 0 | 1;
  dustDensity?: number;
  dustSpeed?: number;
  dustSizeMinWorld?: number;
  dustSizeMaxWorld?: number;
}

// ── Walls ─────────────────────────────────────────────────────────────────────

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

// ── Enemies ───────────────────────────────────────────────────────────────────

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
  isRadiantWebFlag: 0 | 1;
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
  isDustConstellationFlag?: 0 | 1;
  isDustConstellationLargeFlag?: 0 | 1;
  isOrbitalDustCoreFlag?: 0 | 1;
  isOrbitalDustCoreLargeFlag?: 0 | 1;
  isDustBlockMimicFlag?: 0 | 1;
  isDustBlockMimicLargeFlag?: 0 | 1;
  isDustWeaverArchitectFlag?: 0 | 1;
  isDustWeaverArchitectLargeFlag?: 0 | 1;
  isVoidSingularityFlag?: 0 | 1;
  isVoidSingularityPairFlag?: 0 | 1;
  isDustLeechFlag?: 0 | 1;
  isGridBlockEnemyFlag?: 0 | 1;
  gridBlockSizeIndex?: 0 | 1;
  gridBlockSpeedIndex?: 0 | 1 | 2;
}

// ── Transitions ───────────────────────────────────────────────────────────────

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

// ── Liquid zones ──────────────────────────────────────────────────────────────

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

// ── Crumble blocks ────────────────────────────────────────────────────────────

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

// ── Bounce pads ───────────────────────────────────────────────────────────────

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

/** A kinetic block — imparts a fixed directional velocity boost to the player on contact. */
export interface EditorKineticBlock {
  uid: number;
  xBlock: number;
  yBlock: number;
  /** Width in blocks (default 1). */
  wBlock: number;
  /** Height in blocks (default 1). */
  hBlock: number;
}

// ── Tombs ─────────────────────────────────────────────────────────────────────

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

// ── Collectibles ──────────────────────────────────────────────────────────────

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

// ── Critter areas ─────────────────────────────────────────────────────────────

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

// ── Decorations ───────────────────────────────────────────────────────────────

/** An editor-placed decoration (mushroom, grass, vine) anchored to a terrain surface. */
export interface EditorDecoration {
  uid: number;
  xBlock: number;
  yBlock: number;
  kind: DecorationKind;
}

// ── Lighting elements ─────────────────────────────────────────────────────────

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

// ── Falling blocks ────────────────────────────────────────────────────────────

/** An editor-painted falling block tile (one tile per entry). */
export interface EditorFallingBlock {
  uid: number;
  xBlock: number;
  yBlock: number;
  /** Which falling block variant this tile belongs to. */
  variant: import('../levels/roomDef').FallingBlockVariant;
}

// ── Background blocks ─────────────────────────────────────────────────────────

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

// ── Dialogue triggers ─────────────────────────────────────────────────────────

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

// ── Room data aggregate ───────────────────────────────────────────────────────

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
  /** Directional-bias blend (0 = broad ambient, 1 = spotlight). */
  directionalBias?: number;
  /** Side-exposure strength for non-sky-connected air neighbours (0–1). */
  sideExposureStrength?: number;
  /** Minimum brightness fraction for tiles adjacent to open air (0–1). */
  minimumWallLight?: number;
  /** Gamma-like exponent on the raw exposure value (0.5–3). */
  falloffPower?: number;
  /** Optional warm-light spill onto air/background (0 = no spill, default). Range 0–0.5. */
  backgroundLightSpill?: number;
  /** Softness of per-tile darkness overlay (0 = crisp pixel-art, default). Range 0–1. */
  solidLightSoftness?: number;
  /** Block seam blending mode for this room. */
  blockSeamBlending?: BlockSeamBlending;
  /** Void edge style for this room. */
  voidEdgeStyle?: VoidEdgeStyle;
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
  kineticBlocks?: EditorKineticBlock[];
  /** Ropes placed in this room. */
  ropes?: EditorRope[];
  /** Sunbeams placed in this room. */
  sunbeams?: EditorSunbeam[];
  /** Room-level procedural sunrays/god-rays effect. */
  sunrays?: import('../levels/roomDef').RoomSunraysDef;
  /** Scene lights (visibility-polygon shadow system) placed in this room. */
  sceneLights?: EditorSceneLight[];
  /** Falling block tiles placed in this room. */
  fallingBlocks?: EditorFallingBlock[];
  /** Dialogue trigger zones placed in this room. */
  dialogueTriggers?: EditorDialogueTrigger[];
  /** Visual-only background blocks — no collision, drawn behind foreground walls. */
  backgroundBlocks?: EditorBackgroundBlock[];
  /** Golden dust guide paths (Catmull-Rom splines with organic mote particles). */
  guideDustPaths?: EditorGuideDustPath[];
}

// ── Selected element reference ────────────────────────────────────────────────

export type SelectedElementType = 'wall' | 'enemy' | 'transition' | 'saveTomb' | 'skillTomb' | 'dustContainer' | 'dustContainerPiece' | 'dustBoostJar' | 'dustSwarm' | 'lambdaAnchor' | 'dustPile' | 'grasshopperArea' | 'fireflyArea' | 'decoration' | 'playerSpawn' | 'campaignSpawn' | 'ambientLightBlocker' | 'lightSource' | 'waterZone' | 'lavaZone' | 'crumbleBlock' | 'bouncePad' | 'kineticBlock' | 'rope' | 'sunbeam' | 'sceneLight' | 'fallingBlock' | 'dialogueTrigger' | 'backgroundBlock' | 'guideDustPath';

export interface SelectedElement {
  type: SelectedElementType;
  uid: number;
}

// ── Guide dust path editor types ─────────────────────────────────────────────

/** A single control point on an editor-placed guide dust path. */
export interface EditorGuideDustPathPoint {
  xBlock: number;
  yBlock: number;
  speed: number;
}

/** An editor-owned Catmull-Rom spline guide path for golden dust motes. */
export interface EditorGuideDustPath {
  uid: number;
  points: EditorGuideDustPathPoint[];
  loop: boolean;
  /** Whether motes are rendered during normal gameplay (default true). */
  visibleInGame: boolean;
  /** Number of motes travelling along the path (3–20, default 8). */
  moteCount: number;
  /** Speed multiplier relative to the 6-second default crossing time (default 1.0). */
  moteSpeedFactor: number;
  /** Overall mote opacity (0–100 %, default 100). */
  opacityPct: number;
}
