/**
 * roomSchemaHydrator.ts — Load/expand (hydrate) side of the room schema pipeline.
 *
 * Extracted from roomSchemaV2.ts to separate the two directions of the codec:
 *   roomSchemaV2.ts       — dehydrate (save/compress) side
 *   roomSchemaHydrator.ts — hydrate  (load/expand)  side  ← this file
 *
 * Public API (re-exported from roomSchemaV2.ts for backward compatibility):
 *   enemyTypeToFlags  — SavedEnemyType → RoomJsonEnemy boolean flags
 *   hydrateSolidsByTheme — compact SavedSolids → RoomJsonWall[]
 *   isSavedRoomV2     — type-guard for SavedRoomV2
 *   hydrateV2Room     — SavedRoomV2 → RoomJsonDef
 *   hydrateRoomJson   — top-level entry: either v2 or legacy JSON → RoomJsonDef
 */

import type { BlockTheme, BlockThemeId } from './roomDef';
import { blockThemeRefToTheme } from './roomDef';
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
  RoomJsonDustSwarm,
  RoomJsonFireflyJar,
  RoomJsonDustPile,
  RoomJsonGrasshopperArea,
  RoomJsonDecoration,
  RoomJsonCrumbleBlock,
  RoomJsonLambdaAnchor,
  RoomJsonBackgroundBlock,
} from '../editor/roomJson';
import type {
  SavedSolids,
  SavedEnemyType,
  SavedRoomV2,
} from './roomSavedTypes';
import { ROOM_SCHEMA_VERSION, DEFAULT_THEME_KEY } from './roomSavedTypes';

// ── Enemy type mapping (expand direction) ────────────────────────────────────

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
    isRadiantWeb:    type === 'radiantWeb',
    isGrappleHunter: type === 'grappleHunter',
    isSlime:         type === 'slime',
    isLargeSlime:    type === 'largeSlime',
    isWheelEnemy:    type === 'wheel',
    isBeetle:        type === 'beetle',
    isWebSpider:     type === 'webSpider',
    isDustConstellation:      type === 'dustConstellation' || type === 'dustConstellationLarge',
    isDustConstellationLarge: type === 'dustConstellationLarge',
    isOrbitalDustCore:        type === 'orbitalDustCore' || type === 'orbitalDustCoreLarge',
    isOrbitalDustCoreLarge:   type === 'orbitalDustCoreLarge',
  };
}

// ── Solid hydration ───────────────────────────────────────────────────────────

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

// ── SavedRoomV2 type guard ────────────────────────────────────────────────────

/** Auto-detect whether `data` is a v2 saved room. */
export function isSavedRoomV2(data: unknown): data is SavedRoomV2 {
  return typeof data === 'object' && data !== null
      && (data as { v?: unknown }).v === ROOM_SCHEMA_VERSION;
}

// ── Full room hydration ───────────────────────────────────────────────────────

/**
 * Expand a SavedRoomV2 back into a RoomJsonDef (the verbose format the rest
 * of the engine already understands).  The downstream pipeline converts that
 * into either a RoomDef (runtime) or an EditorRoomData (editor).
 */
export function hydrateV2Room(saved: SavedRoomV2): RoomJsonDef {
  const [widthBlocks, heightBlocks] = saved.size;

  const uniformWalls = hydrateSolidsByTheme(saved.solids);

  // exactWalls: 1×1 and 2×2 walls stored verbatim (bypass tile-grid compressor).
  const exactWalls: RoomJsonWall[] = (saved.exactWalls ?? []).map(sw => {
    const [x, y, w, h] = sw.r;
    const wall: RoomJsonWall = { xBlock: x, yBlock: y, wBlock: w, hBlock: h };
    if (sw.theme) {
      const wallTheme = blockThemeRefToTheme(sw.theme);
      if (wallTheme) wall.blockTheme = wallTheme;
    }
    return wall;
  });

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
    if (t.lt) jt.longTransition = true;
    if (t.gw !== undefined) jt.gradientWidthBlocks = t.gw;
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
    interiorWalls: [...uniformWalls, ...exactWalls, ...specialWalls],
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
  if (saved.dustSwarms)     json.dustSwarms      = saved.dustSwarms.map(([x, y, kind, count]) => ({ xBlock: x, yBlock: y, dustKind: kind, dustCount: count }) as RoomJsonDustSwarm);
  if (saved.lambdaAnchors) json.lambdaAnchors   = saved.lambdaAnchors.map(([x, y]) => ({ xBlock: x, yBlock: y }) as RoomJsonLambdaAnchor);
  if (saved.fireflyJars)    json.fireflyJars     = saved.fireflyJars.map(([x, y]) => ({ xBlock: x, yBlock: y }) as RoomJsonFireflyJar);
  if (saved.dustPiles)      json.dustPiles       = saved.dustPiles.map(([x, y, count]) => ({ xBlock: x, yBlock: y, dustCount: count }) as RoomJsonDustPile);
  if (saved.grasshopperAreas) json.grasshopperAreas = saved.grasshopperAreas.map(([x, y, w, h, count]) => ({ xBlock: x, yBlock: y, wBlock: w, hBlock: h, count }) as RoomJsonGrasshopperArea);
  if (saved.decorations)    json.decorations     = saved.decorations.map(([x, y, kind]) => ({ xBlock: x, yBlock: y, kind }) as RoomJsonDecoration);
  if (saved.ambientDir) {
    // Cast — the JSON field is typed as the literal union `AmbientLightDirection`.
    json.ambientLightDirection = saved.ambientDir as RoomJsonDef['ambientLightDirection'];
  }
  if (saved.dBias  !== undefined) json.directionalBias      = saved.dBias;
  if (saved.sExp   !== undefined) json.sideExposureStrength  = saved.sExp;
  if (saved.minWL  !== undefined) json.minimumWallLight      = saved.minWL;
  if (saved.fpow   !== undefined) json.falloffPower          = saved.fpow;
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
  if (saved.fallingBlocks && saved.fallingBlocks.length > 0) {
    json.fallingBlocks = saved.fallingBlocks.map(([x, y, code]) => ({
      xBlock: x,
      yBlock: y,
      variant: code === 's' ? 'sensitive' : code === 'c' ? 'crumbling' : 'tough',
    }));
  }
  if (saved.crumbles && saved.crumbles.length > 0) {
    json.crumbleBlocks = saved.crumbles.map(c => {
      const entry: RoomJsonCrumbleBlock = {
        xBlock: c.r[0],
        yBlock: c.r[1],
      };
      if (c.r[2] !== 1) entry.wBlock = c.r[2];
      if (c.r[3] !== 1) entry.hBlock = c.r[3];
      if (c.v) entry.variant = c.v;
      if (c.ramp !== undefined) entry.rampOrientation = c.ramp;
      if (c.theme) entry.blockThemeId = c.theme;
      return entry;
    });
  }
  if (saved.bounces && saved.bounces.length > 0) {
    json.bouncePads = saved.bounces.map(b => {
      const entry: { xBlock: number; yBlock: number; wBlock?: number; hBlock?: number; rampOrientation?: 0 | 1 | 2 | 3; speedFactorIndex?: 0 | 1 } = {
        xBlock: b.r[0],
        yBlock: b.r[1],
      };
      if (b.r[2] !== 1) entry.wBlock = b.r[2];
      if (b.r[3] !== 1) entry.hBlock = b.r[3];
      if (b.ramp !== undefined) entry.rampOrientation = b.ramp;
      if (b.spd !== undefined) entry.speedFactorIndex = b.spd;
      return entry;
    });
  }
  if (saved.kineticBlocks && saved.kineticBlocks.length > 0) {
    json.kineticBlocks = saved.kineticBlocks.map(kb => {
      const entry: { xBlock: number; yBlock: number; wBlock?: number; hBlock?: number } = {
        xBlock: kb.r[0],
        yBlock: kb.r[1],
      };
      if (kb.r[2] !== 1) entry.wBlock = kb.r[2];
      if (kb.r[3] !== 1) entry.hBlock = kb.r[3];
      return entry;
    });
  }
  if (saved.ropes && saved.ropes.length > 0) {
    // `fixed` defaults to true (both ends pinned); only `false` is stored.
    json.ropes = saved.ropes.map(r => ({ ...r, fixed: r.fixed === false ? false : undefined }));
  }
  if (saved.dialogueTriggers && saved.dialogueTriggers.length > 0) {
    json.dialogueTriggers = saved.dialogueTriggers.map(d => ({ ...d }));
  }
  if (saved.dcPieces && saved.dcPieces.length > 0) {
    json.dustContainerPieces = saved.dcPieces.map(([x, y]) => ({ xBlock: x, yBlock: y }));
  }
  if (saved.bgBlocks && saved.bgBlocks.length > 0) {
    json.backgroundBlocks = saved.bgBlocks.map(b => {
      const entry: RoomJsonBackgroundBlock = { xBlock: b.r[0], yBlock: b.r[1], wBlock: b.r[2], hBlock: b.r[3] };
      if (b.theme) {
        const theme = blockThemeRefToTheme(b.theme);
        if (theme) entry.blockTheme = theme;
      }
      if (b.lb === 1) entry.isLightBlocking = true;
      return entry;
    });
  }

  if (saved.sceneLights && saved.sceneLights.length > 0) {
    json.sceneLights = saved.sceneLights;
  }

  if (saved.guidePaths && saved.guidePaths.length > 0) {
    json.guideDustPaths = saved.guidePaths.map(p => ({
      points: p.pts.map(([x, y, sp]) => ({ xBlock: x, yBlock: y, speed: sp ?? 1.0 })),
      loop: p.lp === 1 ? true : undefined,
      moteCount: p.n,
      moteSpeedFactor: p.sp,
      opacityPct: p.op,
      visibleInGame: p.vi === 0 ? false : undefined,
    }));
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
