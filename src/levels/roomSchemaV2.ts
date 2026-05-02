/**
 * Versioned compact room schema (v2).
 *
 * This module defines the on-disk v2 room format and provides the full
 * hydrate/dehydrate pipeline between compact saved JSON and the verbose
 * `RoomJsonDef` shape the rest of the engine already understands.
 *
 * Goals:
 *   1. Exact correctness        — dehydrate → hydrate round-trips losslessly.
 *   2. Backwards compatibility  — legacy room files still load unchanged.
 *   3. Compactness              — interior walls are encoded as a hybrid
 *      rects/runs/points tile cover grouped by block theme.
 *   4. Maintainability          — plain JSON, stable ordering, no binary
 *      packing.  Editor + runtime only ever see the familiar RoomJsonDef /
 *      RoomDef shapes after hydration.
 *
 * Pipeline:
 *   legacy JSON ─┐
 *                ├─► hydrateRoomJson  → RoomJsonDef ─► RoomDef (runtime)
 *   v2 JSON  ────┘                                     └─► EditorRoomData
 *
 *   EditorRoomData ─► dehydrateRoom → SavedRoomV2 (file on disk)
 *
 * The solid-encoding algorithm is a deterministic 3-pass greedy tile cover:
 *   1. Rasterize all non-special solid walls into a boolean tile grid, per
 *      theme.  Theme keys are compact BlockThemeId strings (the room-default uses the
 *      sentinel key `__default__` so we never repeat the default name on
 *      every tile).
 *   2. Greedy rectangle extraction — for each seed cell, grow the maximal
 *      axis-aligned rectangle that stays inside the grid and stays filled.
 *      Only accept it when it is "meaningfully" better than runs/points
 *      (minimum 2×2 AND area ≥ RECT_MIN_AREA).  Clear covered cells.
 *   3. Horizontal run extraction — every remaining row span of length ≥ 2.
 *   4. Leftover single cells become points.
 *
 * The pipeline is deterministic: cells are scanned top-to-bottom, left-to
 * right, and all output arrays are sorted lexicographically so diffs stay
 * stable.
 */

import type { BlockTheme, BlockThemeId, BackgroundId, LightingEffect, TransitionDirection } from './roomDef';
import { blockThemeRefToTheme, blockThemeToId } from './roomDef';
import type {
  RoomJsonDef,
  RoomJsonWall,
  RoomJsonEnemy,
  RoomJsonTransition,
  RoomJsonSkillTomb,
  RoomJsonDustSkillTomb,
  RoomJsonSpike,
  RoomJsonSpringboard,
  RoomJsonZone,
  RoomJsonBreakableBlock,
  RoomJsonDustBoostJar,
  RoomJsonFireflyJar,
  RoomJsonDustPile,
  RoomJsonGrasshopperArea,
  RoomJsonDecoration,
  RoomJsonLightSource,
  RoomJsonSunbeam,
} from '../editor/roomJson';
import { createTileGrid, paintRect, extractLayerFromGrid } from './tileGridCompressor';
import type { SavedRect, SavedPoint, SavedSolidLayer } from './tileGridCompressor';
export type { SavedRect, SavedRun, SavedPoint, SavedSolidLayer } from './tileGridCompressor';

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
 * "Special" walls that cannot participate in the uniform tile-grid cover —
 * one-way platforms, ramps, half-width pillars.  Kept in a short-key list
 * next to `solids`.
 */
export interface SavedSpecialWall {
  /** [x, y, w, h] */
  r: SavedRect;
  /** Compact block theme override, if any. Legacy long names are still accepted. */
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
  | 'grappleHunter'
  | 'slime'
  | 'largeSlime'
  | 'wheel'
  | 'beetle';

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
}

// ─────────────────────────────────────────────────────────────────────────────
// ENEMY TYPE MAPPING
// ─────────────────────────────────────────────────────────────────────────────

/** Determine the SavedEnemyType for a legacy RoomJsonEnemy. */
export function enemyFlagsToType(e: RoomJsonEnemy): SavedEnemyType {
  if (e.isFlyingEye)      return 'flyingEye';
  if (e.isRollingEnemy)   return 'rolling';
  if (e.isRockElemental)  return 'rockElemental';
  if (e.isRadiantTether)  return 'radiantTether';
  if (e.isGrappleHunter)  return 'grappleHunter';
  if (e.isSlime)          return 'slime';
  if (e.isLargeSlime)     return 'largeSlime';
  if (e.isWheelEnemy)     return 'wheel';
  if (e.isBeetle)         return 'beetle';
  return 'basic';
}

/** Expand a SavedEnemyType into the legacy boolean-flag shape (as RoomJsonEnemy). */
export function enemyTypeToFlags(
  type: SavedEnemyType,
  base: { xBlock: number; yBlock: number; kinds: string[]; particleCount: number; isBoss: boolean; spriteIndex?: number },
): RoomJsonEnemy {
  return {
    xBlock: base.xBlock,
    yBlock: base.yBlock,
    kinds: base.kinds,
    particleCount: base.particleCount,
    isBoss: base.isBoss,
    isFlyingEye:     type === 'flyingEye',
    isRollingEnemy:  type === 'rolling',
    rollingEnemySpriteIndex: type === 'rolling' ? (base.spriteIndex ?? 1) : undefined,
    isRockElemental: type === 'rockElemental',
    isRadiantTether: type === 'radiantTether',
    isGrappleHunter: type === 'grappleHunter',
    isSlime:         type === 'slime',
    isLargeSlime:    type === 'largeSlime',
    isWheelEnemy:    type === 'wheel',
    isBeetle:        type === 'beetle',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WALL CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A wall participates in the uniform tile-grid solid encoding iff it has
 * none of the "special" flags (platform, ramp, half-width pillar).
 */
export function isUniformSolidWall(w: RoomJsonWall): boolean {
  if (w.isPlatform === true)          return false;
  if (w.rampOrientation !== undefined) return false;
  if (w.isPillarHalfWidth === true)   return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// TILE GRID + EXTRACTION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** 2D boolean tile occupancy map backed by a single Uint8Array. */
// ─────────────────────────────────────────────────────────────────────────────
// DEHYDRATE / HYDRATE  solids by theme
// ─────────────────────────────────────────────────────────────────────────────

/** Pick the theme-grouping key for a wall (sentinel for room-default theme). */
function themeKeyForWall(wallTheme: BlockTheme | undefined, defaultTheme: BlockTheme): string {
  return wallTheme && wallTheme !== defaultTheme ? blockThemeToId(wallTheme) : DEFAULT_THEME_KEY;
}

/**
 * Compresses a list of uniform solid walls into byTheme/rects/runs/points.
 * Walls with special flags (platform/ramp/pillar half) MUST be filtered out
 * before calling this — they travel in `specialWalls` and bypass the grid.
 */
export function dehydrateSolidsByTheme(
  uniformWalls: readonly RoomJsonWall[],
  widthBlocks: number,
  heightBlocks: number,
  defaultTheme: BlockTheme,
): SavedSolids {
  // 1. Partition walls by theme key (default theme → sentinel key).
  const byThemeWalls = new Map<string, RoomJsonWall[]>();
  for (const w of uniformWalls) {
    const themeKey = themeKeyForWall(w.blockTheme, defaultTheme);
    const list = byThemeWalls.get(themeKey) ?? [];
    list.push(w);
    if (!byThemeWalls.has(themeKey)) byThemeWalls.set(themeKey, list);
  }

  // 2. Rasterize and extract per-theme.  Themes are emitted in alphabetical
  //    order for stable diffs (default sentinel sorts first due to '_' < 'a').
  const byTheme: Record<string, SavedSolidLayer> = {};
  const themeKeys = [...byThemeWalls.keys()].sort();
  for (const themeKey of themeKeys) {
    const walls = byThemeWalls.get(themeKey)!;
    const grid = createTileGrid(widthBlocks, heightBlocks);
    for (const w of walls) paintRect(grid, w.xBlock, w.yBlock, w.wBlock, w.hBlock);
    const layer = extractLayerFromGrid(grid);
    if (layer.rects || layer.runs || layer.points) byTheme[themeKey] = layer;
  }
  return { byTheme };
}

/**
 * Expands compact solids back into a flat RoomJsonWall[].  Each rect / run
 * / point becomes a single wall rectangle with the theme recovered from the
 * enclosing theme key (the `__default__` sentinel is mapped back to
 * `undefined` so walls use the room-level default theme).
 */
export function hydrateSolidsByTheme(
  solids: SavedSolids | undefined,
): RoomJsonWall[] {
  const out: RoomJsonWall[] = [];
  if (!solids || !solids.byTheme) return out;

  for (const themeKey of Object.keys(solids.byTheme).sort()) {
    const layer = solids.byTheme[themeKey];
    const theme: BlockTheme | undefined = themeKey === DEFAULT_THEME_KEY
      ? undefined
      : blockThemeRefToTheme(themeKey as BlockTheme | BlockThemeId);

    if (layer.rects) {
      for (const [x, y, w, h] of layer.rects) {
        const wall: RoomJsonWall = { xBlock: x, yBlock: y, wBlock: w, hBlock: h };
        if (theme) wall.blockTheme = theme;
        out.push(wall);
      }
    }
    if (layer.runs) {
      for (const [y, xStart, xEnd] of layer.runs) {
        const wall: RoomJsonWall = { xBlock: xStart, yBlock: y, wBlock: xEnd - xStart, hBlock: 1 };
        if (theme) wall.blockTheme = theme;
        out.push(wall);
      }
    }
    if (layer.points) {
      for (const [x, y] of layer.points) {
        const wall: RoomJsonWall = { xBlock: x, yBlock: y, wBlock: 1, hBlock: 1 };
        if (theme) wall.blockTheme = theme;
        out.push(wall);
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEHYDRATE / HYDRATE  full room
// ─────────────────────────────────────────────────────────────────────────────

/** Auto-detect whether `data` is a v2 saved room. */
export function isSavedRoomV2(data: unknown): data is SavedRoomV2 {
  return typeof data === 'object' && data !== null
      && (data as { v?: unknown }).v === ROOM_SCHEMA_VERSION;
}

/**
 * Dehydrate a verbose RoomJsonDef into the compact SavedRoomV2 shape.
 * The editor saves in this format; the runtime never has to see it.
 */
export function dehydrateRoom(json: RoomJsonDef): SavedRoomV2 {
  const defaultTheme: BlockTheme = blockThemeRefToTheme(json.blockThemeId) ?? json.blockTheme ?? 'blackRock';

  // Partition walls: uniform vs. special.
  const uniformWalls: RoomJsonWall[] = [];
  const specialWallsRaw: RoomJsonWall[] = [];
  for (const w of json.interiorWalls) {
    const wallTheme = blockThemeRefToTheme(w.blockThemeId);
    if (wallTheme && w.blockTheme === undefined) w.blockTheme = wallTheme;
    if (isUniformSolidWall(w)) uniformWalls.push(w);
    else specialWallsRaw.push(w);
  }

  const solids = dehydrateSolidsByTheme(uniformWalls, json.widthBlocks, json.heightBlocks, defaultTheme);

  const specialWalls: SavedSpecialWall[] = specialWallsRaw.map(w => {
    const sw: SavedSpecialWall = { r: [w.xBlock, w.yBlock, w.wBlock, w.hBlock] };
    if (w.blockTheme && w.blockTheme !== defaultTheme) sw.theme = blockThemeToId(w.blockTheme);
    if (w.isPlatform) {
      sw.plat = 1;
      if (w.platformEdge !== undefined && w.platformEdge !== 0) sw.edge = w.platformEdge;
    }
    if (w.rampOrientation !== undefined) sw.ramp = w.rampOrientation;
    if (w.isPillarHalfWidth) sw.half = 1;
    return sw;
  });

  // Deterministic order for special walls: by (y, x, w, h).
  specialWalls.sort((a, b) => a.r[1] - b.r[1] || a.r[0] - b.r[0] || a.r[2] - b.r[2] || a.r[3] - b.r[3]);

  const out: SavedRoomV2 = {
    v: ROOM_SCHEMA_VERSION,
    id: json.id,
    name: json.name,
    world: json.worldNumber,
    size: [json.widthBlocks, json.heightBlocks],
    spawn: [json.playerSpawnBlock[0], json.playerSpawnBlock[1]],
    solids,
  };

  if (json.mapX !== undefined || json.mapY !== undefined) out.map = [json.mapX ?? 0, json.mapY ?? 0];
  out.theme = blockThemeToId(defaultTheme);
  if (json.backgroundId)   out.bg = json.backgroundId;
  if (json.lightingEffect) out.light = json.lightingEffect;
  if (json.songId && json.songId !== '_continue') out.song = json.songId;
  if (specialWalls.length > 0) out.specialWalls = specialWalls;

  if (json.enemies.length > 0) {
    out.enemies = json.enemies.map(e => dehydrateEnemy(e));
  }
  if (json.transitions.length > 0) {
    out.transitions = json.transitions.map(t => dehydrateTransition(t));
  }
  if (json.skillTombs.length > 0) {
    out.saveTombs = json.skillTombs.map(s => [s.xBlock, s.yBlock] as SavedPoint);
  }
  if (json.dustSkillTombs && json.dustSkillTombs.length > 0) {
    out.skillTombs = json.dustSkillTombs.map(s => [s.xBlock, s.yBlock, s.weaveId]);
  }
  if (json.skillBooks && json.skillBooks.length > 0) {
    out.skillBooks = json.skillBooks.map(s => [s.xBlock, s.yBlock] as SavedPoint);
  }
  if (json.dustContainers && json.dustContainers.length > 0) {
    out.dustContainers = json.dustContainers.map(s => [s.xBlock, s.yBlock] as SavedPoint);
  }
  if (json.spikes && json.spikes.length > 0) {
    out.spikes = json.spikes.map(s => [s.xBlock, s.yBlock, s.direction]);
  }
  if (json.springboards && json.springboards.length > 0) {
    out.springboards = json.springboards.map(s => [s.xBlock, s.yBlock] as SavedPoint);
  }
  if (json.waterZones && json.waterZones.length > 0) {
    out.waterZones = json.waterZones.map(z => [z.xBlock, z.yBlock, z.wBlock, z.hBlock] as SavedRect);
  }
  if (json.lavaZones && json.lavaZones.length > 0) {
    out.lavaZones = json.lavaZones.map(z => [z.xBlock, z.yBlock, z.wBlock, z.hBlock] as SavedRect);
  }
  if (json.breakableBlocks && json.breakableBlocks.length > 0) {
    out.breakableBlocks = json.breakableBlocks.map(b => [b.xBlock, b.yBlock] as SavedPoint);
  }
  if (json.dustBoostJars && json.dustBoostJars.length > 0) {
    out.dustBoostJars = json.dustBoostJars.map(j => [j.xBlock, j.yBlock, j.dustKind, j.dustCount]);
  }
  if (json.fireflyJars && json.fireflyJars.length > 0) {
    out.fireflyJars = json.fireflyJars.map(j => [j.xBlock, j.yBlock] as SavedPoint);
  }
  if (json.dustPiles && json.dustPiles.length > 0) {
    out.dustPiles = json.dustPiles.map(p => [p.xBlock, p.yBlock, p.dustCount]);
  }
  if (json.grasshopperAreas && json.grasshopperAreas.length > 0) {
    out.grasshopperAreas = json.grasshopperAreas.map(a => [a.xBlock, a.yBlock, a.wBlock, a.hBlock, a.count]);
  }
  if (json.decorations && json.decorations.length > 0) {
    out.decorations = json.decorations.map(d => [d.xBlock, d.yBlock, d.kind] as [number, number, string]);
  }
  // ── Lighting authoring data ────────────────────────────────────────────
  if (json.ambientLightDirection) {
    out.ambientDir = json.ambientLightDirection;
  }
  if (json.ambientLightBlockers && json.ambientLightBlockers.length > 0) {
    out.ambientBlockers = json.ambientLightBlockers.map(b =>
      b.isDark
        ? ([b.xBlock, b.yBlock, 1] as [number, number, 1])
        : ([b.xBlock, b.yBlock] as [number, number]),
    );
  }
  if (json.lightSources && json.lightSources.length > 0) {
    const hasExtendedLightSources = json.lightSources.some(l => (l.dustMoteCount ?? 0) > 0 || (l.dustMoteSpreadBlocks ?? 0) > 0);
    if (hasExtendedLightSources) {
      out.lightSourcesExt = json.lightSources.map(l => ({ ...l }));
    } else {
      out.lights = json.lightSources.map(l => [
        l.xBlock, l.yBlock, l.radiusBlocks, l.colorR, l.colorG, l.colorB, l.brightnessPct,
      ] as [number, number, number, number, number, number, number]);
    }
  }
  if (json.sunbeams && json.sunbeams.length > 0) {
    out.sunbeams = json.sunbeams.map(s => ({ ...s }));
  }

  return out;
}

function dehydrateEnemy(e: RoomJsonEnemy): SavedEnemy {
  const type = enemyFlagsToType(e);
  const out: SavedEnemy = {
    type,
    pos: [e.xBlock, e.yBlock],
  };
  if (e.kinds.length > 0) out.kinds = [...e.kinds];
  if (e.particleCount !== 0) out.particleCount = e.particleCount;
  if (e.isBoss) out.boss = true;
  if (type === 'rolling' && e.rollingEnemySpriteIndex !== undefined && e.rollingEnemySpriteIndex !== 1) {
    out.spriteIndex = e.rollingEnemySpriteIndex;
  }
  return out;
}

function dehydrateTransition(t: RoomJsonTransition): SavedTransition {
  const out: SavedTransition = {
    dir: t.direction,
    to: t.targetRoomId,
    pos: t.positionBlock,
    size: t.openingSizeBlocks,
    spawn: [t.targetSpawnBlock[0], t.targetSpawnBlock[1]],
  };
  if (t.fadeColor) out.fade = t.fadeColor;
  if (t.depthBlock !== undefined) out.depth = t.depthBlock;
  return out;
}

/**
 * Expand a SavedRoomV2 back into a RoomJsonDef (the verbose format the rest
 * of the engine already understands).  The downstream pipeline converts that
 * into either a RoomDef (runtime) or an EditorRoomData (editor).
 */
export function hydrateV2Room(saved: SavedRoomV2): RoomJsonDef {
  const [widthBlocks, heightBlocks] = saved.size;

  const uniformWalls = hydrateSolidsByTheme(saved.solids);
  const specialWalls: RoomJsonWall[] = (saved.specialWalls ?? []).map(sw => {
    const [x, y, w, h] = sw.r;
    const wall: RoomJsonWall = { xBlock: x, yBlock: y, wBlock: w, hBlock: h };
    if (sw.theme) {
      const wallTheme = blockThemeRefToTheme(sw.theme);
      if (wallTheme) wall.blockTheme = wallTheme;
    }
    if (sw.plat === 1) {
      wall.isPlatform = true;
      if (sw.edge !== undefined && sw.edge !== 0) wall.platformEdge = sw.edge;
    }
    if (sw.ramp !== undefined) wall.rampOrientation = sw.ramp;
    if (sw.half === 1) wall.isPillarHalfWidth = true;
    return wall;
  });

  const enemies: RoomJsonEnemy[] = (saved.enemies ?? []).map(e => enemyTypeToFlags(e.type, {
    xBlock: e.pos[0],
    yBlock: e.pos[1],
    kinds: e.kinds ? [...e.kinds] : [],
    particleCount: e.particleCount ?? 0,
    isBoss: e.boss === true,
    spriteIndex: e.spriteIndex,
  }));

  const transitions: RoomJsonTransition[] = (saved.transitions ?? []).map(t => {
    const jt: RoomJsonTransition = {
      direction: t.dir,
      positionBlock: t.pos,
      openingSizeBlocks: t.size,
      targetRoomId: t.to,
      targetSpawnBlock: [t.spawn[0], t.spawn[1]],
    };
    if (t.fade) jt.fadeColor = t.fade;
    if (t.depth !== undefined) jt.depthBlock = t.depth;
    return jt;
  });

  const skillTombs: RoomJsonSkillTomb[] = (saved.saveTombs ?? []).map(([x, y]) => ({ xBlock: x, yBlock: y }));
  const dustSkillTombs: RoomJsonDustSkillTomb[] | undefined = saved.skillTombs
    ? saved.skillTombs.map(([x, y, weaveId]) => ({ xBlock: x, yBlock: y, weaveId }))
    : undefined;

  const json: RoomJsonDef = {
    id: saved.id,
    name: saved.name,
    worldNumber: saved.world,
    mapX: saved.map ? saved.map[0] : 0,
    mapY: saved.map ? saved.map[1] : 0,
    widthBlocks,
    heightBlocks,
    playerSpawnBlock: [saved.spawn[0], saved.spawn[1]],
    interiorWalls: [...uniformWalls, ...specialWalls],
    enemies,
    transitions,
    skillTombs,
  };

  if (saved.theme) {
    const roomTheme = blockThemeRefToTheme(saved.theme);
    if (roomTheme) json.blockTheme = roomTheme;
  }
  if (saved.bg)    json.backgroundId = saved.bg;
  if (saved.light) json.lightingEffect = saved.light;
  if (saved.song)  json.songId = saved.song;
  if (dustSkillTombs && dustSkillTombs.length > 0) json.dustSkillTombs = dustSkillTombs;
  if (saved.skillBooks)     json.skillBooks      = saved.skillBooks.map(([x, y]) => ({ xBlock: x, yBlock: y }));
  if (saved.dustContainers) json.dustContainers  = saved.dustContainers.map(([x, y]) => ({ xBlock: x, yBlock: y }));
  if (saved.spikes)         json.spikes          = saved.spikes.map(([x, y, dir]) => ({ xBlock: x, yBlock: y, direction: dir }) as RoomJsonSpike);
  if (saved.springboards)   json.springboards    = saved.springboards.map(([x, y]) => ({ xBlock: x, yBlock: y }) as RoomJsonSpringboard);
  if (saved.waterZones)     json.waterZones      = saved.waterZones.map(([x, y, w, h]) => ({ xBlock: x, yBlock: y, wBlock: w, hBlock: h }) as RoomJsonZone);
  if (saved.lavaZones)      json.lavaZones       = saved.lavaZones.map(([x, y, w, h]) => ({ xBlock: x, yBlock: y, wBlock: w, hBlock: h }) as RoomJsonZone);
  if (saved.breakableBlocks) json.breakableBlocks = saved.breakableBlocks.map(([x, y]) => ({ xBlock: x, yBlock: y }) as RoomJsonBreakableBlock);
  if (saved.dustBoostJars)  json.dustBoostJars   = saved.dustBoostJars.map(([x, y, kind, count]) => ({ xBlock: x, yBlock: y, dustKind: kind, dustCount: count }) as RoomJsonDustBoostJar);
  if (saved.fireflyJars)    json.fireflyJars     = saved.fireflyJars.map(([x, y]) => ({ xBlock: x, yBlock: y }) as RoomJsonFireflyJar);
  if (saved.dustPiles)      json.dustPiles       = saved.dustPiles.map(([x, y, count]) => ({ xBlock: x, yBlock: y, dustCount: count }) as RoomJsonDustPile);
  if (saved.grasshopperAreas) json.grasshopperAreas = saved.grasshopperAreas.map(([x, y, w, h, count]) => ({ xBlock: x, yBlock: y, wBlock: w, hBlock: h, count }) as RoomJsonGrasshopperArea);
  if (saved.decorations)    json.decorations     = saved.decorations.map(([x, y, kind]) => ({ xBlock: x, yBlock: y, kind }) as RoomJsonDecoration);
  if (saved.ambientDir) {
    // Cast — the JSON field is typed as the literal union `AmbientLightDirection`.
    json.ambientLightDirection = saved.ambientDir as RoomJsonDef['ambientLightDirection'];
  }
  if (saved.ambientBlockers && saved.ambientBlockers.length > 0) {
    json.ambientLightBlockers = saved.ambientBlockers.map(entry => ({
      xBlock: entry[0],
      yBlock: entry[1],
      isDark: entry[2] === 1,
    }));
  }
  if (saved.lightSourcesExt && saved.lightSourcesExt.length > 0) {
    json.lightSources = saved.lightSourcesExt.map(l => ({ ...l }));
  } else if (saved.lights && saved.lights.length > 0) {
    json.lightSources = saved.lights.map(([x, y, r, cr, cg, cb, br]) => ({
      xBlock: x, yBlock: y, radiusBlocks: r,
      colorR: cr, colorG: cg, colorB: cb, brightnessPct: br,
    }));
  }
  if (saved.sunbeams && saved.sunbeams.length > 0) {
    json.sunbeams = saved.sunbeams.map(s => ({ ...s }));
  }

  return json;
}

/**
 * Top-level hydrate: accepts either a legacy RoomJsonDef-shaped object or a
 * v2 SavedRoomV2, returns the verbose RoomJsonDef ready to feed the existing
 * RoomDef / EditorRoomData conversion pipelines.
 */
export function hydrateRoomJson(data: unknown): RoomJsonDef {
  if (isSavedRoomV2(data)) return hydrateV2Room(data);
  return data as RoomJsonDef;
}


/** Build a theme→occupancy Map from a list of uniform RoomJsonWall rectangles. */
function buildCoverageByTheme(
  walls: readonly RoomJsonWall[],
  widthBlocks: number,
  heightBlocks: number,
  defaultTheme: BlockTheme,
): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const w of walls) {
    if (!isUniformSolidWall(w)) continue;
    const key = themeKeyForWall(w.blockTheme, defaultTheme);
    let cells = out.get(key);
    if (!cells) { cells = new Uint8Array(widthBlocks * heightBlocks); out.set(key, cells); }
    const x0 = Math.max(0, w.xBlock);
    const y0 = Math.max(0, w.yBlock);
    const x1 = Math.min(widthBlocks, w.xBlock + w.wBlock);
    const y1 = Math.min(heightBlocks, w.yBlock + w.hBlock);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        cells[yy * widthBlocks + xx] = 1;
      }
    }
  }
  return out;
}

/**
 * Verifies that dehydrate → hydrate preserves exact tile coverage for every
 * theme.  Returns the list of errors (empty = success).
 */
export function validateSolidsRoundtrip(
  originalWalls: readonly RoomJsonWall[],
  widthBlocks: number,
  heightBlocks: number,
  defaultTheme: BlockTheme,
): string[] {
  const errors: string[] = [];
  const uniform = originalWalls.filter(isUniformSolidWall);
  const solids = dehydrateSolidsByTheme(uniform, widthBlocks, heightBlocks, defaultTheme);
  const rebuilt = hydrateSolidsByTheme(solids);

  const beforeCoverage = buildCoverageByTheme(uniform, widthBlocks, heightBlocks, defaultTheme);
  const afterCoverage  = buildCoverageByTheme(rebuilt, widthBlocks, heightBlocks, defaultTheme);

  const allKeys = new Set<string>([...beforeCoverage.keys(), ...afterCoverage.keys()]);
  for (const key of allKeys) {
    const a = beforeCoverage.get(key);
    const b = afterCoverage.get(key);
    if (!a || !b) { errors.push(`Theme "${key}" appears in only one side of the round-trip`); continue; }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        const x = i % widthBlocks;
        const y = Math.floor(i / widthBlocks);
        errors.push(`Theme "${key}" coverage mismatch at (${x},${y}): ${a[i]} vs ${b[i]}`);
        break;
      }
    }
  }

  // Overlap and bounds checks within each theme layer.
  for (const themeKey of Object.keys(solids.byTheme)) {
    const layer = solids.byTheme[themeKey];
    const seen = new Uint8Array(widthBlocks * heightBlocks);

    const touch = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= widthBlocks || y >= heightBlocks) {
        errors.push(`Theme "${themeKey}" primitive out of bounds at (${x},${y})`);
        return;
      }
      const idx = y * widthBlocks + x;
      if (seen[idx] === 1) errors.push(`Theme "${themeKey}" duplicate tile at (${x},${y})`);
      seen[idx] = 1;
    };

    for (const [x, y, w, h] of layer.rects ?? []) {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) touch(xx, yy);
    }
    for (const [y, xStart, xEnd] of layer.runs ?? []) {
      for (let xx = xStart; xx < xEnd; xx++) touch(xx, y);
    }
    for (const [x, y] of layer.points ?? []) touch(x, y);
  }

  return errors;
}

/**
 * End-to-end round-trip validator: dehydrate a RoomJsonDef, hydrate it back,
 * and compare the interior walls as coverage maps.  Used by development
 * assertions and by future tests.
 */
export function validateRoomRoundtrip(json: RoomJsonDef): string[] {
  const saved = dehydrateRoom(json);
  const rebuilt = hydrateV2Room(saved);
  const defaultTheme: BlockTheme = blockThemeRefToTheme(json.blockThemeId) ?? json.blockTheme ?? 'blackRock';

  const errors = validateSolidsRoundtrip(
    json.interiorWalls, json.widthBlocks, json.heightBlocks, defaultTheme,
  );

  if (rebuilt.interiorWalls.length === 0 && json.interiorWalls.length > 0) {
    errors.push('Hydrated room has no interior walls but the original did');
  }
  if (rebuilt.enemies.length !== json.enemies.length) {
    errors.push(`Enemy count mismatch: ${json.enemies.length} → ${rebuilt.enemies.length}`);
  }
  if (rebuilt.transitions.length !== json.transitions.length) {
    errors.push(`Transition count mismatch: ${json.transitions.length} → ${rebuilt.transitions.length}`);
  }
  return errors;
}
