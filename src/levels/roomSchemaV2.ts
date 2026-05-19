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

import type { BlockTheme } from './roomDef';
import { blockThemeRefToTheme, blockThemeToId } from './roomDef';
import type {
  RoomJsonDef,
  RoomJsonWall,
  RoomJsonEnemy,
  RoomJsonTransition,
} from '../editor/roomJson';
import { createTileGrid, paintRect, extractLayerFromGrid } from './tileGridCompressor';
import { hydrateSolidsByTheme, hydrateV2Room } from './roomSchemaHydrator';

// Re-export all saved types and tileGridCompressor primitive types so that
// existing `import { ... } from './roomSchemaV2'` callers continue to work.
export {
  ROOM_SCHEMA_VERSION,
  DEFAULT_THEME_KEY,
} from './roomSavedTypes';
export type {
  SavedRect,
  SavedRun,
  SavedPoint,
  SavedSolidLayer,
  SavedSolids,
  SavedSpecialWall,
  SavedEnemyType,
  SavedEnemy,
  SavedTransition,
  SavedCrumble,
  SavedBounce,
  SavedKineticBlock,
  SavedRoomRope,
  SavedBgBlock,
  SavedRoomV2,
} from './roomSavedTypes';

// Re-export hydrate-side functions from their own module so existing callers
// (campaignSchema.ts, roomJsonLoader.ts, etc.) continue to work unchanged.
export {
  enemyTypeToFlags,
  hydrateSolidsByTheme,
  isSavedRoomV2,
  hydrateV2Room,
  hydrateRoomJson,
} from './roomSchemaHydrator';

import {
  ROOM_SCHEMA_VERSION,
  DEFAULT_THEME_KEY,
} from './roomSavedTypes';
import type {
  SavedSolids,
  SavedSpecialWall,
  SavedEnemyType,
  SavedEnemy,
  SavedTransition,
  SavedCrumble,
  SavedBounce,
  SavedKineticBlock,
  SavedRoomRope,
  SavedBgBlock,
  SavedRoomV2,
  SavedRect,
  SavedPoint,
  SavedSolidLayer,
} from './roomSavedTypes';

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
  if (e.isWebSpider)      return 'webSpider';
  return 'basic';
}

// ─────────────────────────────────────────────────────────────────────────────
// WALL CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A wall participates in the uniform tile-grid solid encoding iff it has
 * none of the "special" flags (platform, ramp, half-width pillar).
 */
export function isUniformSolidWall(w: RoomJsonWall): boolean {
  if (w.isPlatform === true)           return false;
  if (w.rampOrientation !== undefined) return false;
  if (w.isPillarHalfWidth === true)    return false;
  return true;
}

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

// ─────────────────────────────────────────────────────────────────────────────
// DEHYDRATE / HYDRATE  full room
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dehydrate a verbose RoomJsonDef into the compact SavedRoomV2 shape.
 * The editor saves in this format; the runtime never has to see it.
 */
export function dehydrateRoom(json: RoomJsonDef): SavedRoomV2 {
  const defaultTheme: BlockTheme = blockThemeRefToTheme(json.blockThemeId) ?? json.blockTheme ?? 'blackRock';

  // Partition walls: exact-size (1×1 and 2×2) go into exactWalls to preserve
  // identity across round-trips; remaining uniform walls go through the compressor.
  const uniformWallsBulk: RoomJsonWall[] = [];
  const exactWallsRaw: RoomJsonWall[] = [];
  const specialWallsRaw: RoomJsonWall[] = [];
  for (const w of json.interiorWalls) {
    const wallTheme = blockThemeRefToTheme(w.blockThemeId);
    if (wallTheme && w.blockTheme === undefined) w.blockTheme = wallTheme;
    if (!isUniformSolidWall(w)) {
      specialWallsRaw.push(w);
    } else if ((w.wBlock === 1 && w.hBlock === 1) || (w.wBlock === 2 && w.hBlock === 2)) {
      exactWallsRaw.push(w);
    } else {
      uniformWallsBulk.push(w);
    }
  }

  const solids = dehydrateSolidsByTheme(uniformWallsBulk, json.widthBlocks, json.heightBlocks, defaultTheme);

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
  if (json.dustSwarms && json.dustSwarms.length > 0) {
    out.dustSwarms = json.dustSwarms.map(s => [s.xBlock, s.yBlock, s.dustKind, s.dustCount]);
  }
  if (json.lambdaAnchors && json.lambdaAnchors.length > 0) {
    out.lambdaAnchors = json.lambdaAnchors.map(a => [a.xBlock, a.yBlock]);
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
  if (json.fallingBlocks && json.fallingBlocks.length > 0) {
    // Compact format: [xBlock, yBlock, variant_shortchar]
    // 't' = tough, 's' = sensitive, 'c' = crumbling
    out.fallingBlocks = json.fallingBlocks.map(fb => {
      const v = fb.variant ?? 'tough';
      const code = v === 'sensitive' ? 's' : v === 'crumbling' ? 'c' : 't';
      return [fb.xBlock, fb.yBlock, code] as [number, number, string];
    });
  }
  if (json.crumbleBlocks && json.crumbleBlocks.length > 0) {
    out.crumbles = json.crumbleBlocks.map(c => {
      const entry: SavedCrumble = { r: [c.xBlock, c.yBlock, c.wBlock ?? 1, c.hBlock ?? 1] };
      if (c.variant && c.variant !== 'normal') entry.v = c.variant;
      if (c.rampOrientation !== undefined) entry.ramp = c.rampOrientation as 0 | 1 | 2 | 3;
      if (c.blockThemeId) entry.theme = c.blockThemeId;
      return entry;
    });
  }
  if (json.bouncePads && json.bouncePads.length > 0) {
    out.bounces = json.bouncePads.map(b => {
      const entry: SavedBounce = { r: [b.xBlock, b.yBlock, b.wBlock ?? 1, b.hBlock ?? 1] };
      if (b.rampOrientation !== undefined) entry.ramp = b.rampOrientation as 0 | 1 | 2 | 3;
      if (b.speedFactorIndex !== undefined && b.speedFactorIndex !== 0) entry.spd = b.speedFactorIndex as 0 | 1;
      return entry;
    });
  }
  if (json.kineticBlocks && json.kineticBlocks.length > 0) {
    out.kineticBlocks = json.kineticBlocks.map(kb => {
      const entry: SavedKineticBlock = { r: [kb.xBlock, kb.yBlock, kb.wBlock ?? 1, kb.hBlock ?? 1] };
      return entry;
    });
  }
  if (json.ropes && json.ropes.length > 0) {
    out.ropes = json.ropes.map(r => {
      const entry: SavedRoomRope = {
        aax: r.aax, aay: r.aay, abx: r.abx, aby: r.aby,
      };
      if (r.segs !== undefined) entry.segs = r.segs;
      if (r.fixed === false) entry.fixed = false;
      if (r.destr) entry.destr = r.destr;
      if (r.thick !== undefined) entry.thick = r.thick as 0 | 1 | 2;
      return entry;
    });
  }
  if (json.dialogueTriggers && json.dialogueTriggers.length > 0) {
    out.dialogueTriggers = json.dialogueTriggers.map(d => ({ ...d }));
  }
  if (json.dustContainerPieces && json.dustContainerPieces.length > 0) {
    out.dcPieces = json.dustContainerPieces.map(p => [p.xBlock, p.yBlock] as [number, number]);
  }

  // exactWalls: 1×1 and 2×2 uniform walls stored verbatim to preserve identity.
  if (exactWallsRaw.length > 0) {
    out.exactWalls = exactWallsRaw.map(w => {
      const sw: SavedSpecialWall = { r: [w.xBlock, w.yBlock, w.wBlock, w.hBlock] };
      if (w.blockTheme && w.blockTheme !== defaultTheme) sw.theme = blockThemeToId(w.blockTheme);
      return sw;
    });
    out.exactWalls.sort((a, b) => a.r[1] - b.r[1] || a.r[0] - b.r[0] || a.r[2] - b.r[2] || a.r[3] - b.r[3]);
  }

  if (json.backgroundBlocks && json.backgroundBlocks.length > 0) {
    out.bgBlocks = json.backgroundBlocks.map(b => {
      const entry: SavedBgBlock = { r: [b.xBlock, b.yBlock, b.wBlock, b.hBlock] };
      if (b.blockTheme) entry.theme = blockThemeToId(b.blockTheme);
      if (b.isLightBlocking) entry.lb = 1;
      return entry;
    });
  }

  if (json.sceneLights && json.sceneLights.length > 0) {
    out.sceneLights = json.sceneLights;
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
  if (t.longTransition) out.lt = true;
  // Save gradientWidthBlocks whenever it differs from the legacy default of 3,
  // so zero-gradient transitions survive a dehydrate→hydrate round-trip.
  const gw = t.gradientWidthBlocks;
  if (gw !== undefined && gw !== 3) out.gw = gw;
  return out;
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
