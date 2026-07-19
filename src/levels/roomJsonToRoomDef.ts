/**
 * Pure RoomJsonDef -> RoomDef conversion.
 *
 * Extracted from roomJsonLoader.ts so this conversion logic has no
 * dependency on Vite-only globals (`import.meta.glob`, `campaigns.ts`'s
 * `import.meta.env`). This keeps it importable from plain Node test runs.
 */

import { ParticleKind } from '../sim/particles/kinds';
import type {
  RoomDef,
  RoomEnemyDef,
  RoomWallDef,
  RoomTransitionDef,
  RoomSpikeDef,
  RoomSpringboardDef,
  RoomZoneDef,
  RoomBreakableBlockDef,
  RoomDustBoostJarDef,
  RoomFireflyJarDef,
  SpikeDirection,
} from './roomDef';
import { blockThemeRefToTheme } from './roomDef';
import {
  validateRoomJson,
  stringToParticleKind,
  parseRoomJsonSongId,
} from '../editor/roomJson';
import type { RoomJsonDef } from '../editor/roomJson';
import { savedToLightDef } from './lightingSchema';
import { extractLegacySkillBookWeaves } from './legacySkillBookMigration';
import { legacyChallengeGateToRoomGate, normalizeRoomGateDef } from './gateDefs';
import { buildCompleteBoundaryWalls } from './roomBoundaryWalls';
import { hydrateAndValidateBakedWallTemplate } from './roomWallTemplateHash';
import { isKnownMaterialId } from '../sim/pixelMaterials/pixelMaterialTypes';

export { validateRoomJson };

/**
 * Converts a validated RoomJsonDef into a full RoomDef suitable for runtime
 * loading.
 *
 * Boundary walls are complete solid edge walls (no transition holes).
 * See `roomBoundaryWalls.ts` for the design rationale.
 *
 * If the JSON contains a valid `bakedWallTemplate`, it is hydrated and stored
 * in `room.bakedWallTemplate` so that Phase D of room loading can skip the
 * expensive `buildRoomWallTemplate()` merge pass.
 */
export function roomJsonDefToRoomDef(json: RoomJsonDef): RoomDef {
  // Complete boundary walls — no holes for transitions (BUILD 420+)
  const boundaryWalls = buildCompleteBoundaryWalls(json.widthBlocks, json.heightBlocks);

  const interiorWalls: RoomWallDef[] = json.interiorWalls.map(w => ({
    xBlock: w.xBlock,
    yBlock: w.yBlock,
    wBlock: w.wBlock,
    hBlock: w.hBlock,
    isPlatformFlag: w.isPlatform ? (1 as const) : (0 as const),
    platformEdge: w.platformEdge,
    blockTheme: blockThemeRefToTheme(w.blockThemeId) ?? w.blockTheme,
    rampOrientation: w.rampOrientation,
    isPillarHalfWidthFlag: w.isPillarHalfWidth ? (1 as const) : (0 as const),
  }));

  const allWalls: RoomWallDef[] = [...boundaryWalls, ...interiorWalls];

  const enemies: RoomEnemyDef[] = json.enemies.map(e => {
    const kinds: ParticleKind[] = [];
    for (const name of e.kinds) {
      const k = stringToParticleKind(name);
      if (k !== null) kinds.push(k);
    }
    if (kinds.length === 0) kinds.push(ParticleKind.Golden);
    return {
      xBlock: e.xBlock,
      yBlock: e.yBlock,
      kinds,
      particleCount: e.particleCount,
      countsTowardRoomCompletionFlag: e.countsTowardRoomCompletion === false ? 0 : 1,
      isBossFlag: e.isBoss ? 1 as const : 0 as const,
      isFlyingEyeFlag: e.isFlyingEye ? 1 as const : 0 as const,
      isRollingEnemyFlag: e.isRollingEnemy ? 1 as const : 0 as const,
      rollingEnemySpriteIndex: e.rollingEnemySpriteIndex,
      isRockElementalFlag: e.isRockElemental ? 1 as const : 0 as const,
      isRadiantTetherFlag: e.isRadiantTether ? 1 as const : 0 as const,
      isRadiantWebFlag: e.isRadiantWeb ? 1 as const : 0 as const,
      isCrimsonWizardFlag: e.isCrimsonWizard ? 1 as const : 0 as const,
      isHeraldFlag: e.isHerald ? 1 as const : 0 as const,
      isGrappleHunterFlag: e.isGrappleHunter ? 1 as const : 0 as const,
      isSlimeFlag: e.isSlime ? 1 as const : 0 as const,
      isLargeSlimeFlag: e.isLargeSlime ? 1 as const : 0 as const,
      isWheelEnemyFlag: e.isWheelEnemy ? 1 as const : 0 as const,
      isBeetleFlag: e.isBeetle ? 1 as const : 0 as const,
      isSlimeSnailFlag: e.isSlimeSnail ? 1 as const : 0 as const,
      isShadowEnemyFlag: e.isShadowEnemy ? 1 as const : 0 as const,
      isNeedleUrchinFlag: e.isNeedleUrchin ? 1 as const : 0 as const,
      slimeSnailSurfaceSideIndex: (e.slimeSnailSurfaceSideIndex ?? 0) as 0 | 1 | 2 | 3,
      slimeSnailClockwiseFlag: (e.slimeSnailClockwiseFlag ?? 1) as 0 | 1,
    };
  });

  const transitions: RoomTransitionDef[] = json.transitions.map(t => {
    // Prefer explicit xBlock/yBlock; fall back to positionBlock/depthBlock migration.
    const isHoriz = t.direction === 'left' || t.direction === 'right';
    const gw = t.gradientWidthBlocks ?? 3;
    const xBlock = t.xBlock !== undefined ? t.xBlock
      : (isHoriz ? (t.depthBlock ?? 0) : t.positionBlock);
    const yBlock = t.yBlock !== undefined ? t.yBlock
      : (isHoriz ? t.positionBlock : (t.depthBlock ?? 0));

    // For right/down edge transitions that have no depthBlock or explicit xBlock/yBlock,
    // derive zone start from room dimensions so the zone is flush with the far edge.
    let xBlockFinal = xBlock;
    let yBlockFinal = yBlock;
    if (t.direction === 'right' && t.depthBlock === undefined && t.xBlock === undefined) {
      xBlockFinal = json.widthBlocks - gw;
    } else if (t.direction === 'down' && t.depthBlock === undefined && t.yBlock === undefined) {
      yBlockFinal = json.heightBlocks - gw;
    }

    return {
      direction: t.direction,
      targetRoomId: t.targetRoomId,
      xBlock: xBlockFinal,
      yBlock: yBlockFinal,
      positionBlock: t.positionBlock,
      openingSizeBlocks: t.openingSizeBlocks,
      targetSpawnBlock: [t.targetSpawnBlock[0], t.targetSpawnBlock[1]] as readonly [number, number],
      fadeColor: t.fadeColor,
      depthBlock: t.depthBlock,
      gradientWidthBlocks: t.gradientWidthBlocks,
      isSecretDoor: t.isSecretDoor,
    };
  });

  // ── Hazards ──────────────────────────────────────────────────────────────

  const spikes: RoomSpikeDef[] | undefined = json.spikes?.map(s => ({
    xBlock: s.xBlock,
    yBlock: s.yBlock,
    direction: s.direction as SpikeDirection,
    size: s.size ?? '1x1',
    blockTheme: s.blockTheme,
  }));

  const springboards: RoomSpringboardDef[] | undefined = json.springboards?.map(s => ({
    xBlock: s.xBlock,
    yBlock: s.yBlock,
  }));

  const waterZones: RoomZoneDef[] | undefined = json.waterZones?.map(z => ({
    xBlock: z.xBlock,
    yBlock: z.yBlock,
    wBlock: z.wBlock,
    hBlock: z.hBlock,
  }));

  const lavaZones: RoomZoneDef[] | undefined = json.lavaZones?.map(z => ({
    xBlock: z.xBlock,
    yBlock: z.yBlock,
    wBlock: z.wBlock,
    hBlock: z.hBlock,
  }));

  const breakableBlocks: RoomBreakableBlockDef[] | undefined = json.breakableBlocks?.map(b => ({
    xBlock: b.xBlock,
    yBlock: b.yBlock,
    ...(b.groupId !== undefined ? { groupId: b.groupId } : {}),
  }));

  const dustBoostJars: RoomDustBoostJarDef[] | undefined = json.dustBoostJars?.map(j => {
    const kind = stringToParticleKind(j.dustKind);
    return {
      xBlock: j.xBlock,
      yBlock: j.yBlock,
      dustKind: kind ?? ParticleKind.Golden,
      dustCount: j.dustCount,
    };
  });

  const fireflyJars: RoomFireflyJarDef[] | undefined = json.fireflyJars?.map(j => ({
    xBlock: j.xBlock,
    yBlock: j.yBlock,
  }));

  const usedGateUids = new Set<number>();
  let nextGateUid = 0;
  const gates = [...(json.gates ?? []), ...(json.challengeGates ?? []).map(legacyChallengeGateToRoomGate)].map(gate =>
    normalizeRoomGateDef(gate, {
      widthBlocks: json.widthBlocks,
      heightBlocks: json.heightBlocks,
      usedUids: usedGateUids,
      allocateUid: () => {
        while (usedGateUids.has(nextGateUid)) nextGateUid++;
        return nextGateUid++;
      },
    }));

  const room: RoomDef = {
    id: json.id,
    name: json.name,
    worldNumber: json.worldNumber,
    mapX: json.mapX ?? 0,
    mapY: json.mapY ?? 0,
    widthBlocks: json.widthBlocks,
    heightBlocks: json.heightBlocks,
    walls: allWalls,
    enemies,
    playerSpawnBlock: [json.playerSpawnBlock[0], json.playerSpawnBlock[1]],
    transitions,
    saveTombs: json.skillTombs.map(s => ({ xBlock: s.xBlock, yBlock: s.yBlock })),
    skillTombs: [
      ...(json.dustSkillTombs ?? []).map(s => ({ xBlock: s.xBlock, yBlock: s.yBlock, weaveId: s.weaveId })),
      // Legacy: skill books are unified with skill tombs — merge them in.
      ...extractLegacySkillBookWeaves(json.skillBooks),
    ],
    challengeFields: (json.challengeFields ?? []).map(element => ({ ...element })),
    challengeGates: [],
    challengeTotems: (json.challengeTotems ?? []).map(element => ({ ...element })),
    gates,
  };

  // Propagate optional theme/background fields
  const roomBlockTheme = blockThemeRefToTheme(json.blockThemeId) ?? json.blockTheme;
  if (roomBlockTheme) room.blockTheme = roomBlockTheme;
  if (json.soundHardness) room.soundHardness = json.soundHardness;
  if (json.backgroundId) room.backgroundId = json.backgroundId;
  if (json.lightingEffect) room.lightingEffect = json.lightingEffect;
  const resolvedSongId = parseRoomJsonSongId(json);
  if (resolvedSongId !== '_continue') room.songId = resolvedSongId;

  // Add optional fields only if present
  if (json.dustContainers && json.dustContainers.length > 0) {
    room.dustContainers = json.dustContainers.map(s => ({ xBlock: s.xBlock, yBlock: s.yBlock }));
  }
  if (spikes && spikes.length > 0) room.spikes = spikes;
  if (springboards && springboards.length > 0) room.springboards = springboards;
  if (waterZones && waterZones.length > 0) room.waterZones = waterZones;
  if (lavaZones && lavaZones.length > 0) room.lavaZones = lavaZones;
  if (breakableBlocks && breakableBlocks.length > 0) room.breakableBlocks = breakableBlocks;
  if (dustBoostJars && dustBoostJars.length > 0) room.dustBoostJars = dustBoostJars;
  if (fireflyJars && fireflyJars.length > 0) room.fireflyJars = fireflyJars;

  if (json.grasshopperAreas && json.grasshopperAreas.length > 0) {
    room.grasshopperAreas = json.grasshopperAreas.map(a => ({
      xBlock: a.xBlock,
      yBlock: a.yBlock,
      wBlock: a.wBlock,
      hBlock: a.hBlock,
      count: a.count,
    }));
  }

  if (json.dustPiles && json.dustPiles.length > 0) {
    room.dustPiles = json.dustPiles.map(p => ({
      xBlock: p.xBlock,
      yBlock: p.yBlock,
      dustCount: p.dustCount,
      spreadBlocks: p.spreadBlocks ?? 0,
    }));
  }

  if (json.pixelMaterials && json.pixelMaterials.length > 0) {
    // Bounds/overlap are still re-validated per-footprint by
    // `PixelMaterialSystem.loadFromDefs`/`place()` at room-load time (the
    // runtime authority); this filter only guards against non-finite
    // coordinates and unknown material ids so garbage data can't even reach
    // that stage.
    room.pixelMaterials = json.pixelMaterials
      .filter(p => Number.isFinite(p.xPixel) && Number.isFinite(p.yPixel) && isKnownMaterialId(p.material))
      .map(p => ({
        xPixel: Math.floor(p.xPixel),
        yPixel: Math.floor(p.yPixel),
        material: p.material,
      }));
  }

  if (json.fireflyAreas && json.fireflyAreas.length > 0) {
    room.fireflyAreas = json.fireflyAreas.map(a => ({
      xBlock: a.xBlock,
      yBlock: a.yBlock,
      wBlock: a.wBlock,
      hBlock: a.hBlock,
      count: a.count,
    }));
  }

  if (json.decorations && json.decorations.length > 0) {
    room.decorations = json.decorations.map(d => ({
      xBlock: d.xBlock,
      yBlock: d.yBlock,
      kind: d.kind,
    }));
  }

  if (json.ambientLightDirection) {
    room.ambientLightDirection = json.ambientLightDirection;
  }
  if (json.directionalBias      !== undefined) room.directionalBias      = json.directionalBias;
  if (json.sideExposureStrength !== undefined) room.sideExposureStrength = json.sideExposureStrength;
  if (json.minimumWallLight     !== undefined) room.minimumWallLight     = json.minimumWallLight;
  if (json.falloffPower         !== undefined) room.falloffPower         = json.falloffPower;
  if (json.sunrays              !== undefined) room.sunrays              = json.sunrays;
  if (json.backgroundLightSpill !== undefined) room.backgroundLightSpill = json.backgroundLightSpill;
  if (json.solidLightSoftness   !== undefined) room.solidLightSoftness   = json.solidLightSoftness;
  if (json.blockSeamBlending)                  room.blockSeamBlending    = json.blockSeamBlending;
  if (json.voidEdgeStyle)                      room.voidEdgeStyle        = json.voidEdgeStyle;
  if (json.ambientLightBlockers && json.ambientLightBlockers.length > 0) {
    room.ambientLightBlockers = json.ambientLightBlockers.map(b => ({
      xBlock: b.xBlock,
      yBlock: b.yBlock,
      isDark: b.isDark,
    }));
  }
  if (json.lightSources && json.lightSources.length > 0) {
    room.lightSources = json.lightSources.map(l => ({
      xBlock: l.xBlock,
      yBlock: l.yBlock,
      radiusBlocks: l.radiusBlocks,
      colorR: l.colorR,
      colorG: l.colorG,
      colorB: l.colorB,
      brightnessPct: l.brightnessPct,
    }));
  }
  if (json.sunbeams && json.sunbeams.length > 0) {
    room.sunbeams = json.sunbeams.map(s => ({
      xBlock: s.xBlock,
      yBlock: s.yBlock,
      angleRad: s.angleRad,
      widthBlocks: s.widthBlocks,
      lengthBlocks: s.lengthBlocks,
      colorR: s.colorR,
      colorG: s.colorG,
      colorB: s.colorB,
      intensityPct: s.intensityPct,
    }));
  }
  if (json.sceneLights && json.sceneLights.length > 0) {
    room.sceneLights = json.sceneLights.map(savedToLightDef);
  }

  if (json.dialogueTriggers && json.dialogueTriggers.length > 0) {
    room.dialogueTriggers = json.dialogueTriggers.map(dt => ({
      xBlock: dt.xBlock,
      yBlock: dt.yBlock,
      wBlock: dt.wBlock,
      hBlock: dt.hBlock,
      conversation: {
        id: dt.conversation.id,
        title: dt.conversation.title,
        entries: dt.conversation.entries.map(e => ({
          text: e.text,
          portraitId: e.portraitId,
          portraitSide: e.portraitSide,
        })),
      },
    }));
  }

  if (json.guideDustPaths && json.guideDustPaths.length > 0) {
    room.guideDustPaths = json.guideDustPaths
      .filter(p => p.points.length >= 2)
      .map(p => ({
        points: p.points.map(pt => ({ xBlock: pt.xBlock, yBlock: pt.yBlock, speed: pt.speed ?? 1.0 })),
        loop: p.loop ?? false,
        visibleInGame: p.visibleInGame ?? true,
        moteCount: p.moteCount ?? 8,
        moteSpeedFactor: p.moteSpeedFactor ?? 1.0,
        opacityPct: p.opacityPct ?? 100,
      }));
  }

  // ── Baked wall template (optional) ──────────────────────────────────────
  // If present and valid, stored on the RoomDef so Phase D can skip
  // buildRoomWallTemplate().  hydrateAndValidateBakedWallTemplate() logs a
  // DEV warning and returns undefined on any validation failure.
  if (json.bakedWallTemplate !== undefined) {
    const hydrated = hydrateAndValidateBakedWallTemplate(json, json.bakedWallTemplate);
    if (hydrated !== undefined) {
      room.bakedWallTemplate = hydrated;
    }
  }

  if (json.customBlockPlacements && json.customBlockPlacements.length > 0) {
    room.customBlockPlacements = json.customBlockPlacements.slice();
  }

  return room;
}
