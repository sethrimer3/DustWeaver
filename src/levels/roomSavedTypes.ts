/**
 * roomSavedTypes.ts — Compact saved-room schema types and constants.
 *
 * Extracted from roomSchemaV2.ts to keep pure type/interface definitions
 * separate from the hydrate/dehydrate pipeline logic.
 *
 * Re-exported by roomSchemaV2.ts so all existing imports continue to work
 * without modification.
 */

import type { BlockTheme, BlockThemeId, BackgroundId, LightingEffect, TransitionDirection, CrumbleVariant } from './roomDef';
import type { RoomJsonLightSource, RoomJsonSunbeam, RoomJsonDialogueTrigger } from '../editor/roomJson';
import type { SavedSceneLight } from './lightingSchema';
export type { SavedRect, SavedRun, SavedPoint, SavedSolidLayer } from './tileGridCompressor';
import type { SavedRect, SavedPoint, SavedSolidLayer } from './tileGridCompressor';

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA VERSIONING
// ─────────────────────────────────────────────────────────────────────────────

/** Current saved-file schema version. */
export const ROOM_SCHEMA_VERSION = 2 as const;

/** Sentinel theme key used for tiles that use the room-level default theme. */
export const DEFAULT_THEME_KEY = '__default__';

// ─────────────────────────────────────────────────────────────────────────────
// SAVED v2 TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Encoded solids, grouped by block theme. */
export interface SavedSolids {
  byTheme: Record<string, SavedSolidLayer>;
}

/**
 * A "special" wall entry that cannot participate in the uniform tile-grid
 * cover used by `SavedSolids` — i.e. one-way platforms, ramps, and
 * half-width pillars.  These travel in `specialWalls` and bypass the
 * tile-grid compressor entirely.
 */
export interface SavedSpecialWall {
  /** [x, y, w, h] */
  r: SavedRect;
  /** Block theme ID override (omit if using room default). */
  theme?: BlockThemeId | BlockTheme;
  /** 1 if one-way platform. */
  plat?: 1;
  /** Platform edge: 0=top,1=bottom,2=left,3=right. */
  edge?: 0 | 1 | 2 | 3;
  /** Ramp orientation 0-3. */
  ramp?: 0 | 1 | 2 | 3;
  /** 1 if half-width pillar. */
  half?: 1;
}

/**
 * Enemy "type" tag — replaces mutually-exclusive boolean flags from the
 * legacy format.  Kept as a string so adding new enemies is purely additive.
 */
export type SavedEnemyType =
  | 'basic'
  | 'flyingEye'
  | 'rolling'
  | 'rockElemental'
  | 'radiantTether'
  | 'radiantWeb'
  | 'grappleHunter'
  | 'slime'
  | 'largeSlime'
  | 'wheel'
  | 'beetle'
  | 'webSpider'
  | 'dustConstellation'
  | 'dustConstellationLarge'
  | 'orbitalDustCore'
  | 'orbitalDustCoreLarge'
  | 'dustBlockMimic'
  | 'dustBlockMimicLarge'
  | 'voidSingularity'
  | 'voidSingularityPair'
  | 'dustLeech';

export interface SavedEnemy {
  type: SavedEnemyType;
  /** [xBlock, yBlock] */
  pos: [number, number];
  kinds?: string[];
  particleCount?: number;
  boss?: true;
  /** Sprite index — only meaningful for `rolling`. */
  spriteIndex?: number;
}

export interface SavedTransition {
  dir: TransitionDirection;
  to: string;
  pos: number;
  size: number;
  /** [xBlock, yBlock] */
  spawn: [number, number];
  fade?: string;
  depth?: number;
  /** When true, this is a long/teleport-style transition (non-seamless). */
  lt?: boolean;
  /** gradientWidthBlocks — omitted when equal to the legacy default of 3. */
  gw?: number;
}

/** Compact crumble block entry. */
export interface SavedCrumble {
  /** [x, y, w, h] */
  r: SavedRect;
  /** Variant string (omit if 'normal'). */
  v?: CrumbleVariant;
  /** Ramp orientation 0-3 (omit if not a ramp). */
  ramp?: 0 | 1 | 2 | 3;
  /** Block theme ID override (omit if using room default). */
  theme?: string;
}

/** Compact bounce pad entry. */
export interface SavedBounce {
  /** [x, y, w, h] */
  r: SavedRect;
  /** Ramp orientation 0-3 (omit if not a ramp). */
  ramp?: 0 | 1 | 2 | 3;
  /** Speed factor index: 0=50%, 1=100% (omit if 0). */
  spd?: 0 | 1;
}

/** A kinetic block stored in the compact V2 save format. */
export interface SavedKineticBlock {
  /** [x, y, w, h] in block units. */
  r: SavedRect;
}

/** Compact rope entry matching RoomJsonRope shape for simplicity. */
export interface SavedRoomRope {
  aax: number;
  aay: number;
  abx: number;
  aby: number;
  segs?: number;
  fixed?: false;
  destr?: string;
  thick?: 0 | 1 | 2;
}

/** A single control point in a compact guide dust path: [xBlock, yBlock, speed?]. */
export type SavedGuideDustPoint = [number, number, number?];

/** Compact golden dust guide path entry. */
export interface SavedGuideDustPath {
  /** Control points as [xBlock, yBlock] pairs. */
  pts: SavedGuideDustPoint[];
  /** 1 when the path loops (last point connects back to first). Omit when false. */
  lp?: 1;
  /** Mote count override. Omit when equal to default (8). */
  n?: number;
  /** Speed factor override. Omit when equal to default (1.0). */
  sp?: number;
  /** Opacity percent override. Omit when equal to default (100). */
  op?: number;
  /** 0 when NOT visible in game. Omit when visible (default). */
  vi?: 0;
}

/** Compact background (visual-only) block entry. */
export interface SavedBgBlock {
  /** [x, y, w, h] */
  r: SavedRect;
  /** Block theme ID override (omit if using room default). */
  theme?: string;
  /** 1 if this block blocks ambient light. */
  lb?: 1;
}

export interface SavedRoomV2 {
  v: 2;
  id: string;
  name: string;
  world: number;
  /** [mapX, mapY] */
  map?: [number, number];
  theme?: BlockThemeId | BlockTheme;
  bg?: BackgroundId;
  light?: LightingEffect;
  song?: string;
  /** [widthBlocks, heightBlocks] */
  size: [number, number];
  /** [xBlock, yBlock] */
  spawn: [number, number];
  solids: SavedSolids;
  specialWalls?: SavedSpecialWall[];
  enemies?: SavedEnemy[];
  transitions?: SavedTransition[];
  /** Save tombs as [x, y]. Kept as "saveTombs" for clarity. */
  saveTombs?: SavedPoint[];
  /** Skill tombs as [x, y, weaveId]. */
  skillTombs?: [number, number, string][];
  skillBooks?: SavedPoint[];
  dustContainers?: SavedPoint[];
  spikes?: [number, number, 'up' | 'down' | 'left' | 'right'][];
  springboards?: SavedPoint[];
  waterZones?: SavedRect[];
  lavaZones?: SavedRect[];
  breakableBlocks?: SavedPoint[];
  dustBoostJars?: [number, number, string, number][];
  /** [x, y, kind, count] */
  dustSwarms?: [number, number, string, number][];
  /** [x, y] */
  lambdaAnchors?: [number, number][];
  fireflyJars?: SavedPoint[];
  /** [x, y, count] */
  dustPiles?: [number, number, number][];
  /** [x, y, w, h, count] */
  grasshopperAreas?: [number, number, number, number, number][];
  /** [x, y, kind] */
  decorations?: [number, number, string][];
  /**
   * Authored ambient/skylight direction (see `AmbientLightDirection`).
   * Stored verbatim as the string literal.
   */
  ambientDir?: string;
  /** Directional-bias blend param (0 = broad ambient, 1 = spotlight). */
  dBias?: number;
  /** Side-exposure strength for non-sky-connected air neighbours (0–1). */
  sExp?: number;
  /** Minimum wall brightness for air-adjacent tiles (0–1). */
  minWL?: number;
  /** Falloff power / gamma exponent (0.5–3). */
  fpow?: number;
  /** Block seam blending mode. Omitted when 'off'. */
  seamBlend?: 'subtle' | 'organic' | 'heavy';
  /**
   * Sparse list of ambient-light blocker tile coordinates.
   * Each entry is [x, y] for a clear blocker, or [x, y, 1] for a dark blocker.
   */
  ambientBlockers?: ([number, number] | [number, number, 1])[];
  /**
   * Sparse list of local light sources:
   * [xBlock, yBlock, radiusBlocks, r, g, b, brightnessPct].
   */
  lights?: [number, number, number, number, number, number, number][];
  /**
   * Full light-source objects used when any source has extended fields
   * (e.g. dustMoteCount > 0). When present, takes priority over `lights`.
   */
  lightSourcesExt?: RoomJsonLightSource[];
  /** Designer-placed sunbeams. Stored as full objects (small count). */
  sunbeams?: RoomJsonSunbeam[];
  /** Designer-placed scene lights (visibility-polygon shadow system). */
  sceneLights?: SavedSceneLight[];
  /** Editor-painted falling block tiles. Stored as compact tuples [x, y, variant_char]. */
  fallingBlocks?: [number, number, string][];
  /** Crumble blocks. */
  crumbles?: SavedCrumble[];
  /** Bounce pads. */
  bounces?: SavedBounce[];
  /** Kinetic blocks. */
  kineticBlocks?: SavedKineticBlock[];
  /** Ropes. */
  ropes?: SavedRoomRope[];
  /** Dialogue triggers. */
  dialogueTriggers?: RoomJsonDialogueTrigger[];
  /** Dust container pieces (xBlock, yBlock). */
  dcPieces?: [number, number][];
  /**
   * Exact-sized uniform walls that bypass the tile-grid compressor.
   * Used to preserve 1×1 and 2×2 block identity across save/load round-trips.
   * These walls are NOT also encoded in `solids`.
   */
  exactWalls?: SavedSpecialWall[];
  /** Visual-only background blocks — no collision, drawn behind walls. */
  bgBlocks?: SavedBgBlock[];
  /** Golden dust guide paths. */
  guidePaths?: SavedGuideDustPath[];
}
