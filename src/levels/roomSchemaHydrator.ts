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
import type { RoomJsonPixelMaterial } from '../editor/roomJsonSchema';
import type {
  SavedSolids,
  Saved1x1Layer,
  SavedEnemyType,
  SavedRoomV2,
  SavedBgLayer,
} from './roomSavedTypes';
import { DEFAULT_THEME_KEY, SAVED_ENEMY_TYPES } from './roomSavedTypes';
import { expandLayerToRects, expandBlockerLayerToCells } from './tileGridCompressor';

// ── Enemy type mapping (expand direction) ────────────────────────────────────

/** Expand a SavedEnemyType into the legacy boolean-flag shape (as RoomJsonEnemy). */
export function enemyTypeToFlags(
  type: SavedEnemyType,
  base: { xBlock: number; yBlock: number; kinds: string[]; particleCount: number; isBoss: boolean; countsTowardRoomCompletion?: 0; goldenMimicYFlipped?: 1; spriteIndex?: number; snakeLength?: number; momentumTurretFacingIndex?: 0 | 1 | 2 | 3; slimeSnailSideIndex?: 0 | 1 | 2 | 3; slimeSnailCw?: 0 | 1 },
): RoomJsonEnemy {
  if (!SAVED_ENEMY_TYPES.includes(type)) {
    throw new Error(`Unsupported saved enemy type "${String(type)}"; refusing to downgrade it to basic.`);
  }
  return {
    xBlock: base.xBlock,
    yBlock: base.yBlock,
    kinds: base.kinds,
    particleCount: base.particleCount,
    isBoss: base.isBoss,
    countsTowardRoomCompletion: base.countsTowardRoomCompletion === 0 ? false : undefined,
    isFlyingEye:     type === 'flyingEye',
    isRollingEnemy:  type === 'rolling',
    rollingEnemySpriteIndex: type === 'rolling' ? (base.spriteIndex ?? 1) : undefined,
    isRockElemental: type === 'rockElemental',
    isRadiantTether: type === 'radiantTether',
    isRadiantWeb:    type === 'radiantWeb',
    isCrimsonWizard: type === 'crimsonWizard',
    isHerald:        type === 'herald',
    isIceWizard:     type === 'iceWizard',
    isGrappleHunter: type === 'grappleHunter',
    isSlime:         type === 'slime',
    isLargeSlime:    type === 'largeSlime',
    isWheelEnemy:    type === 'wheel',
    isBeetle:        type === 'beetle',
    isBubbleEnemy:   type === 'bubble' || type === 'iceBubble',
    isIceBubble:     type === 'iceBubble',
    isSquareStampede: type === 'squareStampede',
    isGoldenMimic: type === 'goldenMimic',
    isGoldenMimicYFlipped: type === 'goldenMimic' && base.goldenMimicYFlipped === 1,
    isBeeSwarm: type === 'beeSwarm',
    isWebSpider:     type === 'webSpider',
    isDustConstellation:      type === 'dustConstellation' || type === 'dustConstellationLarge',
    isDustConstellationLarge: type === 'dustConstellationLarge',
    isOrbitalDustCore:        type === 'orbitalDustCore' || type === 'orbitalDustCoreLarge',
    isOrbitalDustCoreLarge:   type === 'orbitalDustCoreLarge',
    isDustBlockMimic:         type === 'dustBlockMimic' || type === 'dustBlockMimicLarge',
    isDustBlockMimicLarge:    type === 'dustBlockMimicLarge',
    isDustWeaverArchitect: type === 'dustWeaverArchitect' || type === 'dustWeaverArchitectLarge',
    isDustWeaverArchitectLarge: type === 'dustWeaverArchitectLarge',
    isVoidSingularity:        type === 'voidSingularity' || type === 'voidSingularityPair',
    isVoidSingularityPair:    type === 'voidSingularityPair',
    isDustLeech:              type === 'dustLeech',
    isMomentumTurret: type === 'momentumTurret',
    momentumTurretFacingIndex: type === 'momentumTurret' ? (base.momentumTurretFacingIndex ?? 0) : undefined,
    isSlimeSnail: type === 'slimeSnail',
    isShadowEnemy: type === 'shadow',
    isNeedleUrchin: type === 'needleUrchin',
    slimeSnailSurfaceSideIndex: type === 'slimeSnail' ? (base.slimeSnailSideIndex ?? 0) : undefined,
    slimeSnailClockwiseFlag: type === 'slimeSnail' ? (base.slimeSnailCw ?? 1) : undefined,
    isGridSnakeEnemy:         type === 'gridSnake',
    gridSnakeLength:          type === 'gridSnake' ? (base.snakeLength ?? 4) : undefined,
    isGridBlockEnemy: (
      type === 'gridBlock1x1Slow' || type === 'gridBlock1x1Medium' || type === 'gridBlock1x1Fast' ||
      type === 'gridBlock2x2Slow' || type === 'gridBlock2x2Medium' || type === 'gridBlock2x2Fast'
    ),
    gridBlockSizeIndex: (
      type === 'gridBlock2x2Slow' || type === 'gridBlock2x2Medium' || type === 'gridBlock2x2Fast' ? 1 : 0
    ) as 0 | 1,
    gridBlockSpeedIndex: (
      type === 'gridBlock1x1Medium' || type === 'gridBlock2x2Medium' ? 1
      : type === 'gridBlock1x1Fast' || type === 'gridBlock2x2Fast' ? 2
      : 0
    ) as 0 | 1 | 2,
  };
}

// ── Solid hydration ───────────────────────────────────────────────────────────

/**
 * Expands compact solids back into a flat RoomJsonWall[].  Each rect / run
 * / point becomes a single wall rectangle with the theme recovered from the
 * enclosing theme key (the `__default__` sentinel is mapped back to
 * `undefined` so walls use the room-level default theme).
 *
 * Also reads `v1ByTheme` (v3 format): runs and points that were originally
 * authored as 1×1-visual tiles.  These hydrate as hBlock = 1 walls so that
 * `_buildSolid2x2Map` never promotes them to 2×2-sprite rendering.
 */
function hydrateByThemeBulkLayer(solids: SavedSolids | undefined): RoomJsonWall[] {
  const out: RoomJsonWall[] = [];
  if (!solids?.byTheme) return out;
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

/**
 * Hydrates `solids.v1ByTheme` (runs + points only, hBlock = 1 always). Each
 * entry returned here represents 1×1-grain compression: adjacent same-theme
 * 1×1 walls that were coalesced into a horizontal run purely for storage
 * compactness by `dehydrateSolidsByTheme`. Callers that need independently
 * editable per-cell identities (the editor load path) must further split
 * any multi-cell run this returns — see `hydrateSolidsByThemeForEditor`.
 */
function hydrateV1ByThemeLayer(solids: SavedSolids | undefined): RoomJsonWall[] {
  const out: RoomJsonWall[] = [];
  if (!solids?.v1ByTheme) return out;
  for (const themeKey of Object.keys(solids.v1ByTheme).sort()) {
    const layer: Saved1x1Layer = solids.v1ByTheme[themeKey];
    const theme: BlockTheme | undefined = themeKey === DEFAULT_THEME_KEY
      ? undefined
      : blockThemeRefToTheme(themeKey as BlockTheme | BlockThemeId);

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

export function hydrateSolidsByTheme(
  solids: SavedSolids | undefined,
): RoomJsonWall[] {
  if (!solids) return [];
  return [...hydrateByThemeBulkLayer(solids), ...hydrateV1ByThemeLayer(solids)];
}

/**
 * Editor-only variant of `hydrateSolidsByTheme`. Behaves identically for the
 * bulk `byTheme` layer (those walls were never 1×1-grain-compressed, so they
 * keep their existing multi-cell editing semantics — true 2×2 sprites,
 * platforms, stairs, ramps, half-width pillars, etc. never pass through
 * here). For `v1ByTheme`, every run is additionally split into independent
 * 1×1 `RoomJsonWall` entries — one per occupied cell — so each becomes its
 * own `EditorWall` with its own UID after `jsonToEditorRoomData` runs.
 *
 * This must only be used on the editor load path (see `hydrateV2Room`'s
 * `forEditor` option). The runtime hydration fast path keeps using
 * `hydrateSolidsByTheme` unchanged for performance.
 */
export function hydrateSolidsByThemeForEditor(
  solids: SavedSolids | undefined,
): RoomJsonWall[] {
  if (!solids) return [];
  const bulk = hydrateByThemeBulkLayer(solids);
  const v1 = hydrateV1ByThemeLayer(solids);
  const splitV1: RoomJsonWall[] = [];
  for (const wall of v1) {
    if (wall.wBlock <= 1) {
      splitV1.push(wall);
      continue;
    }
    for (let i = 0; i < wall.wBlock; i++) {
      const cell: RoomJsonWall = { xBlock: wall.xBlock + i, yBlock: wall.yBlock, wBlock: 1, hBlock: 1 };
      if (wall.blockTheme) cell.blockTheme = wall.blockTheme;
      splitV1.push(cell);
    }
  }
  return [...bulk, ...splitV1];
}

// ── Background-block hydration ────────────────────────────────────────────────

/**
 * Expands one `SavedBgLayer` group's bulk `layer` (if present) into
 * `RoomJsonBackgroundBlock` rects, applying the group's theme/lb.
 */
function hydrateBgBulkGroup(group: SavedBgLayer): RoomJsonBackgroundBlock[] {
  if (!group.layer) return [];
  // themeKey is DEFAULT_THEME_KEY (empty string sentinel) or a BlockThemeId string.
  // blockThemeRefToTheme handles both BlockTheme and BlockThemeId inputs; casting here
  // is safe because themeKey originates from blockThemeToId() in the dehydrator.
  const theme = group.themeKey !== DEFAULT_THEME_KEY
    ? blockThemeRefToTheme(group.themeKey as BlockTheme | BlockThemeId)
    : undefined;
  const isLightBlocking = group.lb === 1;
  const out: RoomJsonBackgroundBlock[] = [];
  for (const [x, y, w, h] of expandLayerToRects(group.layer)) {
    const entry: RoomJsonBackgroundBlock = { xBlock: x, yBlock: y, wBlock: w, hBlock: h };
    if (theme) entry.blockTheme = theme;
    if (isLightBlocking) entry.isLightBlocking = true;
    out.push(entry);
  }
  return out;
}

/**
 * Expands one `SavedBgLayer` group's `v1` layer (1×1-authored blocks, runs +
 * points only) into `RoomJsonBackgroundBlock` entries. Runs are returned
 * merged (one wide entry per run) — callers needing independent per-cell
 * editor identity must further split via `splitBgV1Run`.
 */
function hydrateBgV1Group(group: SavedBgLayer): RoomJsonBackgroundBlock[] {
  if (!group.v1) return [];
  const theme = group.themeKey !== DEFAULT_THEME_KEY
    ? blockThemeRefToTheme(group.themeKey as BlockTheme | BlockThemeId)
    : undefined;
  const isLightBlocking = group.lb === 1;
  const out: RoomJsonBackgroundBlock[] = [];
  if (group.v1.runs) {
    for (const [y, xStart, xEnd] of group.v1.runs) {
      const entry: RoomJsonBackgroundBlock = { xBlock: xStart, yBlock: y, wBlock: xEnd - xStart, hBlock: 1 };
      if (theme) entry.blockTheme = theme;
      if (isLightBlocking) entry.isLightBlocking = true;
      out.push(entry);
    }
  }
  if (group.v1.points) {
    for (const [x, y] of group.v1.points) {
      const entry: RoomJsonBackgroundBlock = { xBlock: x, yBlock: y, wBlock: 1, hBlock: 1 };
      if (theme) entry.blockTheme = theme;
      if (isLightBlocking) entry.isLightBlocking = true;
      out.push(entry);
    }
  }
  return out;
}

/**
 * Runtime hydration: `SavedBgLayer[]` → flat `RoomJsonBackgroundBlock[]`.
 * Bulk and 1×1-authored blocks are both expanded as-is (1×1 runs stay merged
 * into one wide entry) — fast path, no per-cell identity needed at runtime.
 */
function hydrateBgLayers(bgLayers: readonly SavedBgLayer[]): RoomJsonBackgroundBlock[] {
  const out: RoomJsonBackgroundBlock[] = [];
  for (const group of bgLayers) {
    out.push(...hydrateBgBulkGroup(group), ...hydrateBgV1Group(group));
  }
  return out;
}

/**
 * Editor-only variant of `hydrateBgLayers`, mirroring
 * `hydrateSolidsByThemeForEditor`. Bulk blocks are expanded unchanged (they
 * were never 1×1-grain-compressed, so they keep their existing multi-cell
 * editing semantics). Every 1×1-authored `v1` run is additionally split into
 * independent 1×1 `RoomJsonBackgroundBlock` entries — one per occupied cell —
 * so each becomes its own `EditorBackgroundBlock` with its own UID after
 * hydration reaches `jsonToEditorRoomData`.
 *
 * Must only be used on the editor load path (see `hydrateV2Room`'s
 * `forEditor` option). The runtime hydration fast path keeps using
 * `hydrateBgLayers` unchanged for performance.
 */
function hydrateBgLayersForEditor(bgLayers: readonly SavedBgLayer[]): RoomJsonBackgroundBlock[] {
  const out: RoomJsonBackgroundBlock[] = [];
  for (const group of bgLayers) {
    out.push(...hydrateBgBulkGroup(group));
    for (const wall of hydrateBgV1Group(group)) {
      if (wall.wBlock <= 1) {
        out.push(wall);
        continue;
      }
      for (let i = 0; i < wall.wBlock; i++) {
        const cell: RoomJsonBackgroundBlock = { xBlock: wall.xBlock + i, yBlock: wall.yBlock, wBlock: 1, hBlock: 1 };
        if (wall.blockTheme) cell.blockTheme = wall.blockTheme;
        if (wall.isLightBlocking) cell.isLightBlocking = true;
        out.push(cell);
      }
    }
  }
  return out;
}

// ── SavedRoomV2 type guard ────────────────────────────────────────────────────

/** Auto-detect whether `data` is a saved room (v2 or v3). */
export function isSavedRoomV2(data: unknown): data is SavedRoomV2 {
  if (typeof data !== 'object' || data === null) return false;
  const v = (data as { v?: unknown }).v;
  return v === 2 || v === 3;
}

// ── Full room hydration ───────────────────────────────────────────────────────

/**
 * Expand a SavedRoomV2 back into a RoomJsonDef (the verbose format the rest
 * of the engine already understands).  The downstream pipeline converts that
 * into either a RoomDef (runtime) or an EditorRoomData (editor).
 *
 * Pass `{ forEditor: true }` on the editor load path only (before editor UID
 * allocation in `jsonToEditorRoomData`): this expands compact-storage-only
 * groupings of `solids.v1ByTheme` walls back into independent per-cell
 * `RoomJsonWall` entries so each becomes its own selectable/movable/
 * deletable `EditorWall`, without changing occupied cells, theme, rendering,
 * collision, or the runtime hydration fast path (which never passes this
 * option and is therefore completely unaffected).
 */
export function hydrateV2Room(saved: SavedRoomV2, opts?: { forEditor?: boolean }): RoomJsonDef {
  const [widthBlocks, heightBlocks] = saved.size;

  const uniformWalls = opts?.forEditor
    ? hydrateSolidsByThemeForEditor(saved.solids)
    : hydrateSolidsByTheme(saved.solids);

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
    if (sw.stairs !== undefined) wall.stairsOrientation = sw.stairs;
    if (sw.smoothRamp !== undefined) wall.smoothRampOrientation = sw.smoothRamp;
    if (sw.half === 1) wall.isPillarHalfWidth = true;
    if (sw.rim !== undefined) wall.r = sw.rim;
    return wall;
  });

  const enemies: RoomJsonEnemy[] = (saved.enemies ?? []).map(e => enemyTypeToFlags(e.type, {
    xBlock: e.pos[0],
    yBlock: e.pos[1],
    kinds: e.kinds ? [...e.kinds] : [],
    particleCount: e.particleCount ?? 0,
    isBoss: e.boss === true,
    spriteIndex: e.spriteIndex,
    snakeLength: e.snakeLength,
    momentumTurretFacingIndex: e.momentumTurretFacingIndex,
    slimeSnailSideIndex: e.slimeSnailSideIndex,
    slimeSnailCw: e.slimeSnailCw,
    countsTowardRoomCompletion: e.countsTowardRoomCompletion,
    goldenMimicYFlipped: e.goldenMimicYFlipped,
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
    if (t.fadeOpacity !== undefined) jt.gradientOpacity = t.fadeOpacity;
    if (t.depth !== undefined) jt.depthBlock = t.depth;
    if (t.lt) jt.longTransition = true;
    if (t.secret) jt.isSecretDoor = true;
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
  if (saved.challengeFields) json.challengeFields = saved.challengeFields.map(([uid, xBlock, yBlock, wBlock, hBlock]) => ({ uid, xBlock, yBlock, wBlock, hBlock }));
  if (saved.challengeGates) json.challengeGates = saved.challengeGates.map(([uid, xBlock, yBlock, wBlock, hBlock]) => ({ uid, xBlock, yBlock, wBlock, hBlock }));
  if (saved.challengeTotems) json.challengeTotems = saved.challengeTotems.map(([uid, xBlock, yBlock]) => ({ uid, xBlock, yBlock }));
  if (saved.gates) json.gates = saved.gates.map(gate => ({ ...gate }));
  if (saved.rimStyles?.length) json.rimStyles = saved.rimStyles.map(style => [...style]);

  if (saved.theme) {
    const roomTheme = blockThemeRefToTheme(saved.theme);
    if (roomTheme) json.blockTheme = roomTheme;
  }
  if (saved.bg)    json.backgroundId = saved.bg;
  if (saved.bgBlur === true) json.backgroundBlur = true;
  if (saved.light) json.lightingEffect = saved.light;
  if (saved.song)  json.songId = saved.song;
  if (dustSkillTombs && dustSkillTombs.length > 0) json.dustSkillTombs = dustSkillTombs;
  if (saved.skillBooks)     json.skillBooks      = saved.skillBooks.map(([x, y]) => ({ xBlock: x, yBlock: y }));
  if (saved.dustContainers) json.dustContainers  = saved.dustContainers.map(([x, y]) => ({ xBlock: x, yBlock: y }));
  if (saved.spikes)         json.spikes          = saved.spikes.map(([x, y, dir, size, themeId]) => ({
    xBlock: x, yBlock: y, direction: dir, size: size ?? '1x1',
    blockTheme: themeId !== undefined ? blockThemeRefToTheme(themeId) : undefined,
  }) as RoomJsonSpike);
  if (saved.springboards)   json.springboards    = saved.springboards.map(([x, y]) => ({ xBlock: x, yBlock: y }) as RoomJsonSpringboard);

  // Water zones: prefer compact `waterLayer` (v3+); fall back to legacy `waterZones`.
  if (saved.waterLayer) {
    const rects = expandLayerToRects(saved.waterLayer);
    if (rects.length > 0) json.waterZones = rects.map(([x, y, w, h]) => ({ xBlock: x, yBlock: y, wBlock: w, hBlock: h }));
  } else if (saved.waterZones) {
    json.waterZones = saved.waterZones.map(([x, y, w, h]) => ({ xBlock: x, yBlock: y, wBlock: w, hBlock: h }) as RoomJsonZone);
  }

  // Lava zones: prefer compact `lavaLayer` (v3+); fall back to legacy `lavaZones`.
  if (saved.lavaLayer) {
    const rects = expandLayerToRects(saved.lavaLayer);
    if (rects.length > 0) json.lavaZones = rects.map(([x, y, w, h]) => ({ xBlock: x, yBlock: y, wBlock: w, hBlock: h }));
  } else if (saved.lavaZones) {
    json.lavaZones = saved.lavaZones.map(([x, y, w, h]) => ({ xBlock: x, yBlock: y, wBlock: w, hBlock: h }) as RoomJsonZone);
  }

  // TimeStop Field tiles: compact `timeStopFieldLayer` only (no legacy
  // fallback needed — this field never existed before the compact format).
  if (saved.timeStopFieldLayer) {
    const rects = expandLayerToRects(saved.timeStopFieldLayer);
    if (rects.length > 0) json.timeStopFields = rects.map(([x, y, w, h]) => ({ xBlock: x, yBlock: y, wBlock: w, hBlock: h }));
  }
  if (saved.breakableBlocks) json.breakableBlocks = saved.breakableBlocks.map(([x, y, groupId]) => ({
    xBlock: x,
    yBlock: y,
    ...(groupId !== undefined ? { groupId } : {}),
  }) as RoomJsonBreakableBlock);
  if (saved.dustBoostJars)  json.dustBoostJars   = saved.dustBoostJars.map(([x, y, kind, count]) => ({ xBlock: x, yBlock: y, dustKind: kind, dustCount: count }) as RoomJsonDustBoostJar);
  if (saved.dustSwarms)     json.dustSwarms      = saved.dustSwarms.map(([x, y, kind, count]) => ({ xBlock: x, yBlock: y, dustKind: kind, dustCount: count }) as RoomJsonDustSwarm);
  if (saved.lambdaAnchors) json.lambdaAnchors   = saved.lambdaAnchors.map(([x, y]) => ({ xBlock: x, yBlock: y }) as RoomJsonLambdaAnchor);
  if (saved.fireflyJars)    json.fireflyJars     = saved.fireflyJars.map(([x, y]) => ({ xBlock: x, yBlock: y }) as RoomJsonFireflyJar);
  if (saved.dustPiles)      json.dustPiles       = saved.dustPiles.map(([x, y, count, spreadBlocks]) => ({
    xBlock: x,
    yBlock: y,
    dustCount: count,
    ...(spreadBlocks !== undefined ? { spreadBlocks } : {}),
  }) as RoomJsonDustPile);
  if (saved.fireflyAreas) json.fireflyAreas = saved.fireflyAreas.map(([x, y, w, h, count]) => ({
    xBlock: x, yBlock: y, wBlock: w, hBlock: h, count,
  }));
  if (saved.grasshopperAreas) json.grasshopperAreas = saved.grasshopperAreas.map(([x, y, w, h, count]) => ({ xBlock: x, yBlock: y, wBlock: w, hBlock: h, count }) as RoomJsonGrasshopperArea);
  if (saved.decorations)    json.decorations     = saved.decorations.map(([x, y, kind]) => ({ xBlock: x, yBlock: y, kind }) as RoomJsonDecoration);
  if (saved.pixelMaterials) json.pixelMaterials  = saved.pixelMaterials.map(([x, y, material]) => ({ xPixel: x, yPixel: y, material }) as RoomJsonPixelMaterial);
  if (saved.ambientDir) {
    // Cast — the JSON field is typed as the literal union `AmbientLightDirection`.
    json.ambientLightDirection = saved.ambientDir as RoomJsonDef['ambientLightDirection'];
  }
  if (saved.dBias    !== undefined) json.directionalBias      = saved.dBias;
  if (saved.sExp     !== undefined) json.sideExposureStrength  = saved.sExp;
  if (saved.minWL    !== undefined) json.minimumWallLight      = saved.minWL;
  if (saved.fpow     !== undefined) json.falloffPower          = saved.fpow;
  if (saved.bgSpill  !== undefined) json.backgroundLightSpill  = saved.bgSpill;
  if (saved.slSoft   !== undefined) json.solidLightSoftness    = saved.slSoft;
  if (saved.seamBlend)              json.blockSeamBlending     = saved.seamBlend;
  if (saved.voidEdge)               json.voidEdgeStyle         = saved.voidEdge;

  // Ambient blockers: prefer compact clear/dark layers (v3+); fall back to legacy `ambientBlockers`.
  if (saved.ambientBlockersClear || saved.ambientBlockersDark) {
    const blockers: RoomJsonDef['ambientLightBlockers'] = [];
    if (saved.ambientBlockersClear) {
      for (const [x, y] of expandBlockerLayerToCells(saved.ambientBlockersClear)) {
        blockers.push({ xBlock: x, yBlock: y, isDark: false });
      }
    }
    if (saved.ambientBlockersDark) {
      for (const [x, y] of expandBlockerLayerToCells(saved.ambientBlockersDark)) {
        blockers.push({ xBlock: x, yBlock: y, isDark: true });
      }
    }
    if (blockers.length > 0) json.ambientLightBlockers = blockers;
  } else if (saved.ambientBlockers && saved.ambientBlockers.length > 0) {
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
  if (saved.sunrays !== undefined) {
    json.sunrays = { ...saved.sunrays };
  }
  if (saved.fallingBlocks && saved.fallingBlocks.length > 0) {
    json.fallingBlocks = saved.fallingBlocks.map(([x, y, code, theme]) => ({
      xBlock: x,
      yBlock: y,
      variant: code === 's' ? 'sensitive' : code === 'c' ? 'crumbling' : 'tough',
      blockTheme: theme,
    }));
  }
  if (saved.zipMoveBlocks?.length) {
    json.zipMoveBlocks = saved.zipMoveBlocks.map(([uid, x, y, w, h, variant]) => ({
      uid: Number.isFinite(uid) ? Math.max(0, Math.floor(uid)) : 0,
      xBlock: Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0,
      yBlock: Number.isFinite(y) ? Math.max(0, Math.floor(y)) : 0,
      wBlock: Number.isFinite(w) ? Math.max(3, Math.floor(w)) : 3,
      hBlock: Number.isFinite(h) ? Math.max(3, Math.floor(h)) : 3,
      variant: variant === 'a' ? 'away' as const : 'toward' as const,
    }));
  }
  if (saved.grappleCarryBlocks?.length) {
    json.grappleCarryBlocks = saved.grappleCarryBlocks.map(([xBlock, yBlock]) => ({ xBlock, yBlock }));
  }
  if (saved.phantasmalTiles?.length) {
    json.phantasmalTiles = saved.phantasmalTiles.map(([xBlock, yBlock]) => ({ xBlock, yBlock }));
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
      if (c.stairs !== undefined) entry.stairsOrientation = c.stairs;
      if (c.smoothRamp !== undefined) entry.smoothRampOrientation = c.smoothRamp;
      if (c.pillar === 1) entry.isPillarHalfWidthFlag = 1;
      if (c.theme) entry.blockThemeId = c.theme;
      if (c.sd !== undefined) {
        entry.spikeDirection = c.sd;
        entry.spikeSize = c.ss ?? '1x1';
      }
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

  // Background blocks: prefer compact `bgLayers` (v3+); fall back to legacy `bgBlocks`.
  if (saved.bgLayers && saved.bgLayers.length > 0) {
    const bgBlocks = opts?.forEditor ? hydrateBgLayersForEditor(saved.bgLayers) : hydrateBgLayers(saved.bgLayers);
    if (bgBlocks.length > 0) json.backgroundBlocks = bgBlocks;
  } else if (saved.bgBlocks && saved.bgBlocks.length > 0) {
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

  if (saved.customBlockPlacements && saved.customBlockPlacements.length > 0) {
    json.customBlockPlacements = saved.customBlockPlacements.slice();
  }

  if (saved.bakedWallTemplate !== undefined) {
    // Deep-copy so the hydrated JSON does not share arrays with the saved object.
    const b = saved.bakedWallTemplate;
    json.bakedWallTemplate = {
      schemaVersion:         b.schemaVersion,
      sourceHash:            b.sourceHash,
      wallCount:             b.wallCount,
      xWorld:                b.xWorld.slice(),
      yWorld:                b.yWorld.slice(),
      wWorld:                b.wWorld.slice(),
      hWorld:                b.hWorld.slice(),
      isPlatformFlag:        b.isPlatformFlag.slice(),
      platformEdge:          b.platformEdge.slice(),
      themeIndex:            b.themeIndex.slice(),
      ...(b.themeNames !== undefined ? { themeNames: b.themeNames.slice() } : {}),
      soundHardnessIndex:    b.soundHardnessIndex.slice(),
      isInvisibleFlag:       b.isInvisibleFlag.slice(),
      rampOrientationIndex:  b.rampOrientationIndex.slice(),
      isPillarHalfWidthFlag: b.isPillarHalfWidthFlag.slice(),
      isIceFlag:             b.isIceFlag.slice(),
      isUltraIceFlag:        b.isUltraIceFlag.slice(),
      // Absent on saves predating the Surface Rim system (schemaVersion < 2) —
      // default to "no custom styles"; hydrateAndValidateBakedWallTemplate's
      // schemaVersion check safely falls back to buildRoomWallTemplate() for
      // those anyway, so this default is never actually consumed as data.
      rimStyleIndex:         (b.rimStyleIndex ?? []).slice(),
      rimStyles:             (b.rimStyles ?? []).slice(),
    };
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
