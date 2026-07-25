/**
 * roomSavedTypes.ts — Compact saved-room schema types and constants.
 *
 * Extracted from roomSchemaV2.ts to keep pure type/interface definitions
 * separate from the hydrate/dehydrate pipeline logic.
 *
 * Re-exported by roomSchemaV2.ts so all existing imports continue to work
 * without modification.
 */

import type { BlockTheme, BlockThemeId, BackgroundId, LightingEffect, TransitionDirection, CrumbleVariant, VoidEdgeStyle } from './roomDef';
import type { RoomJsonLightSource, RoomJsonSunbeam, RoomJsonDialogueTrigger, RoomJsonBakedWallTemplate } from '../editor/roomJson';
import type { SavedSceneLight } from './lightingSchema';
export type { SavedRect, SavedRun, SavedPoint, SavedSolidLayer } from './tileGridCompressor';
import type { SavedRect, SavedPoint, SavedRun, SavedSolidLayer } from './tileGridCompressor';

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA VERSIONING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Current saved-file schema version.
 *
 * v3 changes vs v2:
 *   • `solids.v1ByTheme` — compressed 1×1-visual-intent walls stored as
 *     horizontal runs + points (no 2D rects).  Replaces the old `exactWalls`
 *     array so large runs of 1×1 tiles are no longer individual JSON records.
 *   • `exactWalls` is no longer written by the dehydrator for uniform solid
 *     walls.  Old v2 files that do have `exactWalls` still load correctly.
 */
export const ROOM_SCHEMA_VERSION = 3 as const;

/** Sentinel theme key used for tiles that use the room-level default theme. */
export const DEFAULT_THEME_KEY = '__default__';

// ─────────────────────────────────────────────────────────────────────────────
// SAVED v2/v3 TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compact layer for walls that must keep 1×1 visual grain.
 * Only horizontal runs and single points — no 2D rects — so that after
 * hydration all walls have hBlock = 1.  This prevents `_buildSolid2x2Map`
 * from promoting them to 2×2-sprite rendering.
 *
 * Also used for ambient-blocker layers (clear/dark), where each entry
 * represents a single blocker cell.
 */
export interface Saved1x1Layer {
  runs?: SavedRun[];
  points?: SavedPoint[];
}

/**
 * Compressed background-block layer for a single (theme, light-blocking) group.
 *
 * Background blocks that share the same theme key and the same `lb` flag are
 * stored together so the greedy rect algorithm can merge adjacent tiles.
 * Do not merge across different theme keys or different `lb` values.
 */
export interface SavedBgLayer {
  /**
   * Block theme key for this layer, or `DEFAULT_THEME_KEY` when the room
   * default theme applies.
   */
  themeKey: string;
  /** 1 if every block in this layer blocks ambient light. Omit if none do. */
  lb?: 1;
  /** Compressed tile coverage for this (theme, lb) group. */
  layer: SavedSolidLayer;
}

/** Encoded solids, grouped by block theme. */
export interface SavedSolids {
  /**
   * Bulk uniform solid walls (any shape other than hBlock=1 single-row or
   * exact 2×2).  Compressed using the full rect/run/point greedy algorithm.
   */
  byTheme: Record<string, SavedSolidLayer>;
  /**
   * 1×1-visual-intent walls compressed as runs + points only (no 2D rects).
   * Written by v3; absent in old v2 files (those use `exactWalls` instead).
   * All walls here hydrate with hBlock = 1, which keeps the 1×1 visual grain.
   */
  v1ByTheme?: Record<string, Saved1x1Layer>;
}


/**
 * A "special" wall entry that cannot participate in the uniform tile-grid
 * cover used by `SavedSolids` — i.e. one-way platforms, stairs, legacy ramps,
 * and half-width pillars.  These travel in `specialWalls` and bypass the
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
  /** Ramp orientation 0-3 (legacy; omit if not a ramp). */
  ramp?: 0 | 1 | 2 | 3;
  /** Stairs orientation 0-3 (omit if not stairs). */
  stairs?: 0 | 1 | 2 | 3;
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
  | 'dustLeech'
  | 'gridBlock1x1Slow'
  | 'gridBlock1x1Medium'
  | 'gridBlock1x1Fast'
  | 'gridBlock2x2Slow'
  | 'gridBlock2x2Medium'
  | 'gridBlock2x2Fast'
  | 'gridSnake'
  | 'momentumTurret'
  | 'slimeSnail'
  | 'shadow'
  | 'needleUrchin';

export interface SavedEnemy {
  type: SavedEnemyType;
  /** [xBlock, yBlock] */
  pos: [number, number];
  kinds?: string[];
  particleCount?: number;
  boss?: true;
  /** Sprite index — only meaningful for `rolling`. */
  spriteIndex?: number;
  snakeLength?: number;
  momentumTurretFacingIndex?: 0 | 1 | 2 | 3;
  /** Starting exposed surface side (0=top,1=right,2=bottom,3=left) — only meaningful for `slimeSnail`. */
  slimeSnailSideIndex?: 0 | 1 | 2 | 3;
  /** 1=clockwise, 0=counterclockwise — only meaningful for `slimeSnail`. */
  slimeSnailCw?: 0 | 1;
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
  /** Schema version. 2 = legacy (uses `exactWalls`); 3 = compressed (uses `solids.v1ByTheme`). */
  v: 2 | 3;
  id: string;
  name: string;
  world: number;
  /** [mapX, mapY] */
  map?: [number, number];
  theme?: BlockThemeId | BlockTheme;
  bg?: BackgroundId;
  /** When true, render the blurred variant of `bg`. Omitted when false. */
  bgBlur?: true;
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
  challengeFields?: [number, number, number, number, number][];
  challengeGates?: [number, number, number, number, number][];
  challengeTotems?: [number, number, number][];
  gates?: import('./gateDefs').RoomGateDef[];
  skillBooks?: SavedPoint[];
  dustContainers?: SavedPoint[];
  /**
   * Spikes as `[x, y, direction, size?, themeId?]`. `size` is omitted for
   * `'1x1'` (the implicit default prior to 2×2 spike support) to keep
   * older-format saves byte-for-byte unchanged. `themeId` (compact block
   * theme id, e.g. `'bk'`) is present only when the spike overrides the
   * room's default theme; when present, `size` is always written explicitly
   * (even `'1x1'`) so the tuple stays positionally unambiguous.
   */
  spikes?: [number, number, 'up' | 'down' | 'left' | 'right', ('1x1' | '2x2')?, string?][];
  springboards?: SavedPoint[];
  /**
   * Compact water-zone coverage layer (v3+ preferred).
   * Rects/runs/points define the full water coverage; hydrates to RoomJsonZone[].
   * Water and lava are always kept separate: never merge across zone types.
   */
  waterLayer?: SavedSolidLayer;
  /**
   * Compact lava-zone coverage layer (v3+ preferred).
   * Rects/runs/points define the full lava coverage; hydrates to RoomJsonZone[].
   */
  lavaLayer?: SavedSolidLayer;
  /**
   * @deprecated Legacy per-rect water zone list from v2/early-v3.
   * New exports write `waterLayer` instead.  Still read for backward compatibility.
   */
  waterZones?: SavedRect[];
  /**
   * @deprecated Legacy per-rect lava zone list from v2/early-v3.
   * New exports write `lavaLayer` instead.  Still read for backward compatibility.
   */
  lavaZones?: SavedRect[];
  /**
   * Compact TimeStop Field tile coverage layer, same encoding as
   * waterLayer/lavaLayer. Absent (undefined) on rooms with no TimeStop
   * Field tiles or saved before this field existed — always defaults safely
   * to an empty list on hydrate, so old rooms keep loading unaffected.
   */
  timeStopFieldLayer?: SavedSolidLayer;
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
  /** Side-exposure strength for non-sky-facing air neighbours (0–1). */
  sExp?: number;
  /** Minimum wall brightness for air-adjacent tiles (0–1). */
  minWL?: number;
  /** Falloff power / gamma exponent (0.5–3). */
  fpow?: number;
  /** Background light spill strength (0 = none, default; subtle warm haze into air). */
  bgSpill?: number;
  /** Solid light softness (0 = crisp pixel-art, 1 = max softening). */
  slSoft?: number;
  /** Block seam blending mode. Omitted when 'off'. */
  seamBlend?: 'subtle' | 'organic' | 'heavy';
  /** Void edge style. Omitted when 'off'. */
  voidEdge?: VoidEdgeStyle;
  /**
   * Compressed clear ambient-light blocker cells (v3+ preferred).
   * Runs + points; each cell hydrates to `{xBlock, yBlock, isDark: false}`.
   * Clear blockers and dark blockers are always stored separately so that
   * their identities (dark vs clear) are never accidentally merged.
   */
  ambientBlockersClear?: Saved1x1Layer;
  /**
   * Compressed dark ambient-light blocker cells (v3+ preferred).
   * Runs + points; each cell hydrates to `{xBlock, yBlock, isDark: true}`.
   */
  ambientBlockersDark?: Saved1x1Layer;
  /**
   * @deprecated Legacy per-cell ambient blocker list from v2/early-v3.
   * New exports write `ambientBlockersClear`/`ambientBlockersDark` instead.
   * Still read for backward compatibility.
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
  /** Room-level procedural sunrays/god-rays effect. Stored as a full object. */
  sunrays?: import('./roomDef').RoomSunraysDef;
  /** Designer-placed scene lights (visibility-polygon shadow system). */
  sceneLights?: SavedSceneLight[];
  /** Editor-painted falling block tiles. Stored as compact tuples [x, y, variant_char, blockTheme?]. */
  fallingBlocks?: [number, number, string, string?][];
  /** Crumble blocks. */
  crumbles?: SavedCrumble[];
  /** Bounce pads. */
  bounces?: SavedBounce[];
  /** Kinetic blocks. */
  kineticBlocks?: SavedKineticBlock[];
  /** Zip moving blocks: [uid, x, y, width, height, variant char]. */
  zipMoveBlocks?: [number, number, number, number, number, 't' | 'a'][];
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
   *
   * @deprecated v3 exports no longer write `exactWalls` for ordinary solid walls.
   * `solids.v1ByTheme` covers all 1×1-visual walls.  This field is kept as
   * read-only backward-compat support for old v2 files only.  The room audit
   * warns if a v3 active campaign room still contains this field.
   */
  exactWalls?: SavedSpecialWall[];
  /**
   * Compressed background-block layers, grouped by (themeKey, lb) (v3+ preferred).
   * Each `SavedBgLayer` covers one (theme, light-blocking) group.
   * Never merge across different theme keys or different `lb` values.
   */
  bgLayers?: SavedBgLayer[];
  /**
   * @deprecated Legacy per-entry background block list from v2/early-v3.
   * New exports write `bgLayers` instead.  Still read for backward compatibility.
   */
  bgBlocks?: SavedBgBlock[];
  /** Golden dust guide paths. */
  guidePaths?: SavedGuideDustPath[];
  /** Pixel-material (falling sand) placements as [xPixel, yPixel, material]. */
  pixelMaterials?: [number, number, number][];
  /**
   * Pre-baked runtime wall template produced during export.
   * Optional — absent in old v2/v3 files. When present and valid, the
   * runtime skips `buildRoomWallTemplate()` and uses the baked fast path.
   */
  bakedWallTemplate?: RoomJsonBakedWallTemplate;
  /**
   * Custom block placements as [xBlock, yBlock, namespacedId, tileWidth?, tileHeight?].
   * namespacedId is "custom:<id>". Absent when no custom blocks are placed.
   * Absent in rooms without custom blocks — older rooms load unchanged.
   * tileWidth/tileHeight preserve the authored footprint; absent means 1x1.
   */
  customBlockPlacements?: ([number, number, string] | [number, number, string, number, number])[];
}
