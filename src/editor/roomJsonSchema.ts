/**
 * Room JSON schema types — all exported interface definitions for the room
 * JSON format, plus the ParticleKind string↔enum mapping helpers.
 *
 * Split from roomJson.ts to keep that module focused on conversion logic
 * (validation, JSON↔EditorRoomData↔RoomDef conversions).
 */

import { ParticleKind } from '../sim/particles/kinds';
import type { TransitionDirection, BlockTheme, BlockThemeId, BackgroundId, LightingEffect, DecorationKind, AmbientLightDirection, CrumbleVariant } from '../levels/roomDef';

// ── ParticleKind string mapping ──────────────────────────────────────────────

const KIND_NAME_MAP: Record<string, ParticleKind> = {
  Physical:  ParticleKind.Physical,
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
};

const KIND_ENUM_TO_NAME: Record<number, string> = {};
for (const [name, val] of Object.entries(KIND_NAME_MAP)) {
  KIND_ENUM_TO_NAME[val] = name;
}

export function particleKindToString(kind: ParticleKind): string {
  return KIND_ENUM_TO_NAME[kind] ?? 'Physical';
}

export function stringToParticleKind(name: string): ParticleKind | null {
  return KIND_NAME_MAP[name] ?? null;
}

// ── JSON schema types ────────────────────────────────────────────────────────

export interface RoomJsonEnemy {
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
  isGrappleHunter: boolean;
  isSlime?: boolean;
  isLargeSlime?: boolean;
  isWheelEnemy?: boolean;
  isBeetle?: boolean;
  isBubbleEnemy?: boolean;
  isIceBubble?: boolean;
  isSquareStampede?: boolean;
  isGoldenMimic?: boolean;
  isGoldenMimicYFlipped?: boolean;
  isBeeSwarm?: boolean;
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
   * Ramp orientation. When present, this wall is a diagonal triangle.
   * 0=rises right(/), 1=rises left(\), 2=ceiling ramp(⌐), 3=ceiling ramp(¬).
   */
  rampOrientation?: 0 | 1 | 2 | 3;
  /** true if this pillar wall is half-block wide (4 px). */
  isPillarHalfWidth?: boolean;
}

export interface RoomJsonTransition {
  direction: TransitionDirection;
  positionBlock: number;
  openingSizeBlocks: number;
  targetRoomId: string;
  targetSpawnBlock: [number, number];
  fadeColor?: string;
  depthBlock?: number;
  isSecretDoor?: boolean;
  gradientWidthBlocks?: number;
}

/** Save Tomb — where the player saves their progress. Uses "skillTombs" JSON key for backward compat. */
export interface RoomJsonSkillTomb {
  xBlock: number;
  yBlock: number;
}

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
  /** Sparse tile-coord list of authored ambient-light blockers. */
  ambientLightBlockers?: RoomJsonAmbientLightBlocker[];
  /** Sparse list of authored local light sources. */
  lightSources?: RoomJsonLightSource[];
  /**
   * Background music. Omitting or setting to '_continue' means "keep playing
   * whatever was already playing".  '_silence' stops music.
   */
  songId?: string;
  widthBlocks: number;
  heightBlocks: number;
  playerSpawnBlock: [number, number];
  /** Interior walls only — boundary walls are regenerated from room dimensions + transitions. */
  interiorWalls: RoomJsonWall[];
  enemies: RoomJsonEnemy[];
  transitions: RoomJsonTransition[];
  /** Save Tombs (stored as "skillTombs" for backward compatibility with existing room files). */
  skillTombs: RoomJsonSkillTomb[];
  /** Skill Tombs — grant dust skills/weaves when interacted with. */
  dustSkillTombs?: RoomJsonDustSkillTomb[];
  /** Collectible skill book positions (block units). */
  skillBooks?: RoomJsonSkillTomb[];
  /** Collectible dust container positions (block units). */
  dustContainers?: RoomJsonSkillTomb[];
  // ── Environmental hazards (all optional) ──────────────────────────────────
  spikes?: RoomJsonSpike[];
  springboards?: RoomJsonSpringboard[];
  waterZones?: RoomJsonZone[];
  lavaZones?: RoomJsonZone[];
  breakableBlocks?: RoomJsonBreakableBlock[];
  crumbleBlocks?: RoomJsonCrumbleBlock[];
  dustBoostJars?: RoomJsonDustBoostJar[];
  fireflyJars?: RoomJsonFireflyJar[];
  dustPiles?: RoomJsonDustPile[];
  grasshopperAreas?: RoomJsonGrasshopperArea[];
  fireflyAreas?: RoomJsonFireflyArea[];
  /** Editor-placed decorations (glowing mushrooms, grass tufts, vines). */
  decorations?: RoomJsonDecoration[];
}

// ── Validation result ────────────────────────────────────────────────────────

export interface ValidationError {
  path: string;
  message: string;
}
