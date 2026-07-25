/**
 * Room JSON schema types — all exported interface definitions for the room
 * JSON format, plus the ParticleKind string↔enum mapping helpers.
 *
 * Split from roomJson.ts to keep that module focused on conversion logic
 * (validation, JSON↔EditorRoomData↔RoomDef conversions).
 */

import { ParticleKind } from '../sim/particles/kinds';
import type { TransitionDirection, BlockTheme, BlockThemeId, BlockSoundHardness, BackgroundId, LightingEffect, DecorationKind, AmbientLightDirection, CrumbleVariant, BlockSeamBlending, VoidEdgeStyle } from '../levels/roomDef';
import type { CompactSurfaceRimStyle } from '../render/walls/surfaceRimStyle';

// ── ParticleKind string mapping ──────────────────────────────────────────────

const KIND_NAME_MAP: Record<string, ParticleKind> = {
  Golden:    ParticleKind.Golden,
  Fire:      ParticleKind.Fire,
  Ice:       ParticleKind.Ice,
  Lightning: ParticleKind.Lightning,
  Poison:    ParticleKind.Poison,
  Arcane:    ParticleKind.Arcane,
  Wind:      ParticleKind.Wind,
  Holy:      ParticleKind.Holy,
  Shadow:    ParticleKind.Shadow,
  Metal:     ParticleKind.Metal,
  Earth:     ParticleKind.Earth,
  Nature:    ParticleKind.Nature,
  Crystal:   ParticleKind.Crystal,
  Void:      ParticleKind.Void,
  Water:     ParticleKind.Water,
  Lava:      ParticleKind.Lava,
  Stone:     ParticleKind.Stone,
  Light:     ParticleKind.Light,
};

const KIND_ENUM_TO_NAME: Record<number, string> = {};
for (const [name, val] of Object.entries(KIND_NAME_MAP)) {
  KIND_ENUM_TO_NAME[val] = name;
}

export function particleKindToString(kind: ParticleKind): string {
  return KIND_ENUM_TO_NAME[kind] ?? 'Golden';
}

export function stringToParticleKind(name: string): ParticleKind | null {
  const normalized = name.trim().toLowerCase();
  if (normalized === 'physical' || normalized === 'physical dust' || normalized === 'golden dust') {
    return ParticleKind.Golden;
  }
  for (const [kindName, kind] of Object.entries(KIND_NAME_MAP)) {
    if (kindName.toLowerCase() === normalized) return kind;
  }
  return null;
}

// ── JSON schema types ────────────────────────────────────────────────────────

export interface RoomJsonEnemy {
  countsTowardRoomCompletion?: boolean;
  xBlock: number;
  yBlock: number;
  kinds: string[];
  particleCount: number;
  isBoss: boolean;
  isFlyingEye: boolean;
  isRollingEnemy: boolean;
  rollingEnemySpriteIndex?: number;
  isRockElemental: boolean;
  isRadiantTether: boolean;
  isRadiantWeb?: boolean;
  isCrimsonWizard?: boolean;
  isHerald?: boolean;
  isIceWizard?: boolean;
  isGrappleHunter: boolean;
  isSlime?: boolean;
  isLargeSlime?: boolean;
  isWheelEnemy?: boolean;
  isBeetle?: boolean;
  isBubbleEnemy?: boolean;
  isIceBubble?: boolean;
  isSquareStampede?: boolean;
  isSlimeSnail?: boolean;
  isShadowEnemy?: boolean;
  isNeedleUrchin?: boolean;
  slimeSnailSurfaceSideIndex?: 0 | 1 | 2 | 3;
  slimeSnailClockwiseFlag?: 0 | 1;
  isGoldenMimic?: boolean;
  isGoldenMimicYFlipped?: boolean;
  isBeeSwarm?: boolean;
  isWebSpider?: boolean;
  isDustConstellation?: boolean;
  isDustConstellationLarge?: boolean;
  isOrbitalDustCore?: boolean;
  isOrbitalDustCoreLarge?: boolean;
  isDustBlockMimic?: boolean;
  isDustBlockMimicLarge?: boolean;
  isDustWeaverArchitect?: boolean;
  isDustWeaverArchitectLarge?: boolean;
  isVoidSingularity?: boolean;
  isVoidSingularityPair?: boolean;
  isDustLeech?: boolean;
  isGridBlockEnemy?: boolean;
  isMomentumTurret?: boolean;
  momentumTurretFacingIndex?: 0 | 1 | 2 | 3;
  gridBlockSizeIndex?: 0 | 1;
  gridBlockSpeedIndex?: 0 | 1 | 2;
  isGridSnakeEnemy?: boolean;
  gridSnakeLength?: number;
}

export interface RoomJsonWall {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
  /** true if this is a one-way platform block. */
  isPlatform?: boolean;
  /**
   * Which edge is the one-way surface. Only meaningful when isPlatform=true.
   * 0=top (default), 1=bottom, 2=left, 3=right.
   */
  platformEdge?: 0 | 1 | 2 | 3;
  /** Per-wall block theme override (defaults to room-level theme). */
  blockTheme?: BlockTheme;
  /** Compact per-wall block theme override used by newer JSON exports. */
  blockThemeId?: BlockThemeId;
  /**
   * Ramp orientation — LEGACY, retired from editor placement.
   * When present, this wall is a diagonal triangle.
   * 0=rises right(/), 1=rises left(\), 2=ceiling ramp(⌐), 3=ceiling ramp(¬).
   */
  rampOrientation?: 0 | 1 | 2 | 3;
  /**
   * Stairs orientation. When present, this wall is a stepped staircase whose
   * solid cells come from the stair template mask.
   * 0=rises right, 1=rises left, 2=ceiling (rises right), 3=ceiling (rises left).
   */
  stairsOrientation?: 0 | 1 | 2 | 3;
  /** true if this pillar wall is half-block wide (4 px). */
  isPillarHalfWidth?: boolean;
  /**
   * Index into the room-level `rimStyles` dedup table (see RoomJsonDef).
   * Omitted when this block uses the 'default' Surface Rim style.
   */
  r?: number;
}

export interface RoomJsonTransition {
  direction: TransitionDirection;
  /** @deprecated Superseded by xBlock/yBlock. Kept for backward compat. */
  positionBlock: number;
  openingSizeBlocks: number;
  targetRoomId: string;
  targetSpawnBlock: [number, number];
  fadeColor?: string;
  /** @deprecated Superseded by xBlock/yBlock. Kept for backward compat. */
  depthBlock?: number;
  isSecretDoor?: boolean;
  gradientWidthBlocks?: number;
  /** X block of the top-left corner of the zone (new primary field). */
  xBlock?: number;
  /** Y block of the top-left corner of the zone (new primary field). */
  yBlock?: number;
  /**
   * When true, entering this transition uses the legacy teleport-style room load
   * instead of seamless adjacent-room camera crossing.
   */
  longTransition?: boolean;
}

/** Save Tomb — where the player saves their progress. Uses "skillTombs" JSON key for backward compat. */
export interface RoomJsonSkillTomb {
  xBlock: number;
  yBlock: number;
}

export interface RoomJsonChallengeRect {
  uid: number;
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
}

export interface RoomJsonChallengeTotem {
  uid: number;
  xBlock: number;
  yBlock: number;
}
export type RoomJsonGate = import('../levels/gateDefs').RoomGateDef;
export type RoomJsonZipMoveBlock = import('../levels/roomElementDefs').RoomZipMoveBlockDef;

/** Skill Tomb — grants a specific dust skill/weave when interacted with. */
export interface RoomJsonDustSkillTomb {
  xBlock: number;
  yBlock: number;
  /** The weave ID unlocked by this tomb. */
  weaveId: string;
}

export interface RoomJsonSpike {
  xBlock: number;
  yBlock: number;
  direction: 'up' | 'down' | 'left' | 'right';
  /** Footprint size in blocks. Defaults to `'1x1'` when omitted. */
  size?: '1x1' | '2x2';
  /** Override block theme the spike's sprite is cut from. Absent = use room theme. */
  blockTheme?: BlockTheme;
}

export interface RoomJsonSpringboard {
  xBlock: number;
  yBlock: number;
}

export interface RoomJsonZone {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
}

export interface RoomJsonBreakableBlock {
  xBlock: number;
  yBlock: number;
  /** Shared group id for multi-cell placements (e.g. 2x2), so they act as one unit. */
  groupId?: number;
}

export interface RoomJsonCrumbleBlock {
  xBlock: number;
  yBlock: number;
  /** Width in blocks (default 1). */
  wBlock?: number;
  /** Height in blocks (default 1). */
  hBlock?: number;
  /**
   * Ramp orientation (0-3). Absent = not a ramp.
   * 0=rises right(/), 1=rises left(\), 2=ceiling ramp(⌐), 3=ceiling ramp(¬).
   */
  rampOrientation?: 0 | 1 | 2 | 3;
  /** Elemental weakness variant. Defaults to `'normal'` when absent. */
  variant?: CrumbleVariant;
  /** Per-block theme override (defaults to room-level theme). */
  blockTheme?: BlockTheme;
  /** Compact per-block theme override used by newer JSON exports. */
  blockThemeId?: BlockThemeId;
}

export interface RoomJsonDustBoostJar {
  xBlock: number;
  yBlock: number;
  dustKind: string;
  dustCount: number;
}

export interface RoomJsonDustSwarm {
  xBlock: number;
  yBlock: number;
  dustKind: string;
  dustCount: number;
}

export interface RoomJsonLambdaAnchor {
  xBlock: number;
  yBlock: number;
}

export interface RoomJsonFireflyJar {
  xBlock: number;
  yBlock: number;
}

export interface RoomJsonDustPile {
  xBlock: number;
  yBlock: number;
  dustCount: number;
  spreadBlocks?: number;
}

export interface RoomJsonGrasshopperArea {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
  count: number;
}

export interface RoomJsonFireflyArea {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
  count: number;
}

export interface RoomJsonDecoration {
  xBlock: number;
  yBlock: number;
  kind: DecorationKind;
}

/** Authored tile-coord ambient-light blocker (see {@link RoomAmbientLightBlockerDef}). */
export interface RoomJsonAmbientLightBlocker {
  xBlock: number;
  yBlock: number;
  /** When true, this blocker also draws a solid black overlay over the cell. */
  isDark?: boolean;
}

/** Authored local light source (see {@link RoomLightSourceDef}). */
export interface RoomJsonLightSource {
  xBlock: number;
  yBlock: number;
  radiusBlocks: number;
  /** 0-255 RGB channels. */
  colorR: number;
  colorG: number;
  colorB: number;
  /** 0-100 percent. */
  brightnessPct: number;
  /** Number of atmospheric dust motes near this source (0 = none). */
  dustMoteCount?: number;
  /** Radius (blocks) in which dust motes spawn; defaults to radiusBlocks. */
  dustMoteSpreadBlocks?: number;
}

/** A pixel-art sunbeam authored in the editor (see {@link RoomSunbeamDef}). */
export interface RoomJsonSunbeam {
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

/** A bounce pad block that reflects the player's velocity when they collide with it. */
export interface RoomJsonBouncePad {
  xBlock: number;
  yBlock: number;
  wBlock?: number;
  hBlock?: number;
  rampOrientation?: 0 | 1 | 2 | 3;
  /** 0 = 50 % restitution (dim core), 1 = 100 % restitution (bright core). */
  speedFactorIndex?: 0 | 1;
}

export interface RoomJsonKineticBlock {
  xBlock: number;
  yBlock: number;
  wBlock?: number;
  hBlock?: number;
}

export interface RoomJsonGrappleCarryBlock {
  xBlock: number;
  yBlock: number;
}

export interface RoomJsonPhantasmalTile {
  xBlock: number;
  yBlock: number;
}

/** Authored 1x1 pixel-material placement — native-pixel coordinates (NOT block units). */
export interface RoomJsonPixelMaterial {
  xPixel: number;
  yPixel: number;
  material: number;
}

export interface RoomJsonRope {
  aax: number;
  aay: number;
  abx: number;
  aby: number;
  segs?: number;
  fixed?: boolean;
  destr?: string;
  /** Thickness index: 0=8 px, 1=16 px, 2=24 px.  Omitted when 0 (default). */
  thick?: number;
}

/** JSON representation of a single falling block tile. */
export interface RoomJsonFallingBlock {
  xBlock: number;
  yBlock: number;
  /** 'tough' | 'sensitive' | 'crumbling'. Defaults to 'tough' if missing. */
  variant?: string;
  /** Override block theme/material for this tile (e.g. 'blackRock' = Blackstone). */
  blockTheme?: string;
}

/** JSON representation of a single dialogue entry within a conversation. */
export interface RoomJsonDialogueEntry {
  text: string;
  portraitId: string;
  portraitSide: 'left' | 'right';
}

/** JSON representation of a dialogue conversation. */
export interface RoomJsonConversation {
  id: string;
  title?: string;
  entries: RoomJsonDialogueEntry[];
}

/**
 * JSON representation of a dialogue trigger zone.
 *
 * How dialogue triggers are stored in room JSON:
 * Each trigger contains its zone rect and a full inline conversation object.
 * No external conversation asset file is needed — the room JSON is self-contained.
 * Older rooms without this field continue to load normally (field is optional).
 */
export interface RoomJsonDialogueTrigger {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
  conversation: RoomJsonConversation;
}

export interface RoomJsonDef {
  id: string;
  name: string;
  worldNumber: number;
  /** X position on the visual world map (map world units). */
  mapX?: number;
  /** Y position on the visual world map (map world units). */
  mapY?: number;
  /** Block sprite theme. Defaults to 'blackRock' if not set. */
  blockTheme?: BlockTheme;
  /** Compact block sprite theme ID. Preferred by newer JSON exports. */
  blockThemeId?: BlockThemeId;
  /** Default player SFX material hardness for walls in this room. */
  soundHardness?: BlockSoundHardness;
  /** Background visual ID. Falls back to worldNumber if not set. */
  backgroundId?: BackgroundId;
  /**
   * Lighting model. Falls back to `'Ambient'` when not set.
   * Legacy `'DEFAULT'` and `'Above'` values are accepted and treated as
   * `'Ambient'` with the appropriate direction (omni / down) at runtime.
   */
  lightingEffect?: LightingEffect;
  /** Ambient/skylight direction (see {@link AmbientLightDirection}). */
  ambientLightDirection?: AmbientLightDirection;
  /** Directional-bias blend (0 = broad ambient, 1 = spotlight). Range 0–1. */
  directionalBias?: number;
  /** Side-exposure strength for non-sky-facing air neighbours. Range 0–1. */
  sideExposureStrength?: number;
  /** Minimum brightness fraction for tiles adjacent to open air. Range 0–1. */
  minimumWallLight?: number;
  /** Gamma-like exponent on the raw exposure value. Range 0.5–3. */
  falloffPower?: number;
  /** Optional warm-light spill onto air/background. 0 = no spill (default). Range 0–0.5. */
  backgroundLightSpill?: number;
  /** Softness of per-tile darkness overlay. 0 = crisp (default). Range 0–1. */
  solidLightSoftness?: number;
  /** Block seam blending mode. Omitted when 'off'. */
  blockSeamBlending?: BlockSeamBlending;
  /** Void edge style. Omitted when 'off'. */
  voidEdgeStyle?: VoidEdgeStyle;
  /** Sparse tile-coord list of authored ambient-light blockers. */
  ambientLightBlockers?: RoomJsonAmbientLightBlocker[];
  /** Sparse list of authored local light sources. */
  lightSources?: RoomJsonLightSource[];
  /** Designer-placed sunbeams (see {@link RoomJsonSunbeam}). */
  sunbeams?: RoomJsonSunbeam[];
  /** Room-level procedural sunrays/god-rays effect. */
  sunrays?: import('../levels/roomDef').RoomSunraysDef;
  /**
   * Background music. Omitting or setting to '_continue' means "keep playing
   * whatever was already playing".  '_silence' stops music.
   */
  songId?: string;
  /** Legacy packed-campaign field. Prefer songId for newly-written room JSON. */
  song?: string;
  widthBlocks: number;
  heightBlocks: number;
  playerSpawnBlock: [number, number];
  /** Interior walls only — boundary walls are regenerated from room dimensions alone. */
  interiorWalls: RoomJsonWall[];
  /**
   * Deduplicated Surface Rim style table (see render/walls/surfaceRimStyle.ts
   * CompactSurfaceRimStyle). `RoomJsonWall.r` indexes into this array.
   * Omitted when no wall in the room uses a non-default Surface Rim style.
   */
  rimStyles?: CompactSurfaceRimStyle[];
  enemies: RoomJsonEnemy[];
  transitions: RoomJsonTransition[];
  /** Save Tombs (stored as "skillTombs" for backward compatibility with existing room files). */
  skillTombs: RoomJsonSkillTomb[];
  challengeFields?: RoomJsonChallengeRect[];
  challengeGates?: RoomJsonChallengeRect[];
  challengeTotems?: RoomJsonChallengeTotem[];
  gates?: RoomJsonGate[];
  /** Skill Tombs — grant dust skills/weaves when interacted with. */
  dustSkillTombs?: RoomJsonDustSkillTomb[];
  /** Collectible skill book positions (block units). */
  skillBooks?: RoomJsonSkillTomb[];
  /** Collectible dust container positions (block units). */
  dustContainers?: RoomJsonSkillTomb[];
  /** Collectible dust container piece positions (block units). */
  dustContainerPieces?: RoomJsonSkillTomb[];
  // ── Environmental hazards (all optional) ──────────────────────────────────
  spikes?: RoomJsonSpike[];
  springboards?: RoomJsonSpringboard[];
  waterZones?: RoomJsonZone[];
  lavaZones?: RoomJsonZone[];
  timeStopFields?: RoomJsonZone[];
  breakableBlocks?: RoomJsonBreakableBlock[];
  crumbleBlocks?: RoomJsonCrumbleBlock[];
  bouncePads?: RoomJsonBouncePad[];
  kineticBlocks?: RoomJsonKineticBlock[];
  grappleCarryBlocks?: RoomJsonGrappleCarryBlock[];
  zipMoveBlocks?: RoomJsonZipMoveBlock[];
  phantasmalTiles?: RoomJsonPhantasmalTile[];
  pixelMaterials?: RoomJsonPixelMaterial[];
  ropes?: RoomJsonRope[];
  dustBoostJars?: RoomJsonDustBoostJar[];
  dustSwarms?: RoomJsonDustSwarm[];
  fireflyJars?: RoomJsonFireflyJar[];
  dustPiles?: RoomJsonDustPile[];
  grasshopperAreas?: RoomJsonGrasshopperArea[];
  fireflyAreas?: RoomJsonFireflyArea[];
  /** Editor-placed decorations (glowing mushrooms, grass tufts, vines). */
  decorations?: RoomJsonDecoration[];
  /** Editor-painted falling block tiles (grouped into rigid falling units at runtime). */
  fallingBlocks?: RoomJsonFallingBlock[];
  /** Dialogue trigger zones. Absent in older rooms — ignored on load (backward-compatible). */
  dialogueTriggers?: RoomJsonDialogueTrigger[];
  /** Lambda Anchors — golden λ-glyph poles acting as temporary recall points. */
  lambdaAnchors?: RoomJsonLambdaAnchor[];
  /** Visual-only background blocks — drawn behind foreground walls. */
  backgroundBlocks?: RoomJsonBackgroundBlock[];
  /** Designer-placed scene lights (visibility-polygon shadow system). */
  sceneLights?: import('../levels/lightingSchema').SavedSceneLight[];
  /** Golden dust guide paths (Catmull-Rom splines). */
  guideDustPaths?: RoomJsonGuideDustPath[];
  /**
   * Pre-baked runtime wall template produced during export/serialisation.
   * When present and valid (schema version + source hash match), the runtime
   * skips `buildRoomWallTemplate()` and hydrates this data directly.
   * Missing in older room files — runtime falls back safely.
   */
  bakedWallTemplate?: RoomJsonBakedWallTemplate;
  /**
   * Custom block placements as [xBlock, yBlock, namespacedId, tileWidth?, tileHeight?].
   * namespacedId is "custom:<id>". Absent when no custom blocks are placed.
   * tileWidth/tileHeight preserve the authored footprint; absent means 1x1
   * (older data written before this field existed).
   */
  customBlockPlacements?: ([number, number, string] | [number, number, string, number, number])[];
}

// ── Background blocks ────────────────────────────────────────────────────────

/** A visual-only background block stored in the room JSON. */
export interface RoomJsonBackgroundBlock {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
  /** Override block theme. Absent = use room theme. */
  blockTheme?: BlockTheme;
  /** When true, this background block blocks ambient-light propagation. */
  isLightBlocking?: boolean;
}

// ── Baked wall template ───────────────────────────────────────────────────────

/**
 * Pre-baked runtime wall template stored in room JSON during export.
 *
 * All arrays have length equal to `wallCount`.  Values are plain JSON numbers;
 * the runtime hydrates them into typed arrays (`Float32Array`, `Uint8Array`).
 *
 * `schemaVersion` must match `BAKED_WALL_SCHEMA_VERSION` (currently 1).
 * `sourceHash`    must match the hash recomputed from the loaded room's
 *                 wall-affecting inputs.  A mismatch means stale baked data.
 */
export interface RoomJsonBakedWallTemplate {
  schemaVersion: number;
  sourceHash: string;
  wallCount: number;
  xWorld: number[];
  yWorld: number[];
  wWorld: number[];
  hWorld: number[];
  isPlatformFlag: number[];
  platformEdge: number[];
  /**
   * Per-wall theme indices.  Values 0–2 are legacy fixed indices (blackRock,
   * brownRock, dirt); 255 is WALL_THEME_DEFAULT_INDEX (room default).
   * Values ≥3 are local indices into `themeNames` (index − 3 = position in
   * themeNames).  During hydration these local indices are remapped to the
   * runtime session registry via `blockThemeToIndex`.
   */
  themeIndex: number[];
  /**
   * Theme names for non-legacy dynamic indices (3+).  `themeNames[i]` is the
   * theme name for local index `i + 3`.  Present when the room uses any
   * folder-based or unknown per-wall theme overrides.  When absent or empty,
   * themeIndex values ≥3 are used as-is (legacy behaviour).
   */
  themeNames?: string[];
  soundHardnessIndex: number[];
  isInvisibleFlag: number[];
  rampOrientationIndex: number[];
  isPillarHalfWidthFlag: number[];
  isIceFlag: number[];
  isUltraIceFlag: number[];
  /**
   * Per-wall Surface Rim style index — index into `rimStyles`, or
   * `SURFACE_RIM_STYLE_INDEX_DEFAULT` (0xFFFF) for the default style.
   * Absent on baked templates predating the Surface Rim system (BAKED_WALL_SCHEMA_VERSION
   * bump forces those to fall back to buildRoomWallTemplate() instead of guessing).
   */
  rimStyleIndex: number[];
  /** Compact Surface Rim style table referenced by `rimStyleIndex` (see surfaceRimStyle.ts). */
  rimStyles: CompactSurfaceRimStyle[];
}

// ── Validation result ────────────────────────────────────────────────────────

export interface ValidationError {
  path: string;
  message: string;
}

// ── Guide dust paths ─────────────────────────────────────────────────────────

/** A single control point in a room JSON guide dust path. */
export interface RoomJsonGuideDustPathPoint {
  xBlock: number;
  yBlock: number;
  speed?: number;
}

/** A golden dust guide path stored in room JSON. */
export interface RoomJsonGuideDustPath {
  points: RoomJsonGuideDustPathPoint[];
  loop?: boolean;
  moteCount?: number;
  moteSpeedFactor?: number;
  opacityPct?: number;
  visibleInGame?: boolean;
}
