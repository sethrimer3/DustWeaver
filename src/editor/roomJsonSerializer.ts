/**
 * roomJsonSerializer.ts — EditorRoomData → RoomJsonDef serializer.
 *
 * This is the serialization half of the room JSON codec. The deserialization
 * half (JSON → EditorRoomData) lives in roomJson.ts alongside the validator.
 *
 * Extracted from roomJson.ts (BUILD 312).
 * BUILD 420+: Bakes a runtime wall template into the exported JSON so that the
 * runtime can skip the expensive buildRoomWallTemplate() merge pass.
 */

import { blockThemeToId, BLOCK_SIZE_SMALL, DEFAULT_ROPE_SEGMENT_COUNT, indexToBlockTheme, WALL_THEME_DEFAULT_INDEX } from '../levels/roomDef';
import { getMaterialFootprintSize, isKnownMaterialId } from '../sim/pixelMaterials/pixelMaterialTypes';
import type {
  EditorRoomData,
} from './editorState';
import type { EditorWall } from './editorElementTypes';
import {
  normalizeSurfaceRimStyle,
  isDefaultSurfaceRimStyle,
  encodeSurfaceRimStyle,
  type CompactSurfaceRimStyle,
} from '../render/walls/surfaceRimStyle';
import { lightDefToSaved } from '../levels/lightingSchema';
import type {
  RoomJsonDef,
  RoomJsonWall,
  RoomJsonTransition,
  RoomJsonAmbientLightBlocker,
  RoomJsonLightSource,
  RoomJsonRope,
  RoomJsonDialogueTrigger,
  RoomJsonCrumbleBlock,
  RoomJsonSpike,
  RoomJsonBouncePad,
  RoomJsonBackgroundBlock,
  RoomJsonGuideDustPath,
  RoomJsonGuideDustPathPoint,
} from './roomJsonSchema';
import { editorRoomDataToRoomDef } from './editorRoomBuilder';
import { buildRoomWallTemplate } from '../screens/gameRoomWalls';
import { BAKED_WALL_SCHEMA_VERSION, computeWallTemplateSourceHash } from '../levels/roomWallTemplateHash';

/**
 * Converts the in-editor room representation into the compact JSON format that
 * is persisted to disk and read back by the loader.
 */
export function editorRoomDataToJson(data: EditorRoomData): RoomJsonDef {
  const rimTable: CompactSurfaceRimStyle[] = [];
  const rimIndexByKey = new Map<string, number>();
  const rimIndexForWall = (w: EditorWall): number | undefined => {
    if (w.surfaceRim === undefined) return undefined;
    const normalized = normalizeSurfaceRimStyle(w.surfaceRim);
    if (isDefaultSurfaceRimStyle(normalized)) return undefined;
    const encoded = encodeSurfaceRimStyle(normalized);
    const key = JSON.stringify(encoded);
    let idx = rimIndexByKey.get(key);
    if (idx === undefined) {
      idx = rimTable.length;
      rimTable.push(encoded);
      rimIndexByKey.set(key, idx);
    }
    return idx;
  };

  const json: RoomJsonDef = {
    id: data.id,
    name: data.name,
    worldNumber: data.worldNumber,
    mapX: data.mapX,
    mapY: data.mapY,
    widthBlocks: data.widthBlocks,
    heightBlocks: data.heightBlocks,
    playerSpawnBlock: [...data.playerSpawnBlock],
    interiorWalls: data.interiorWalls.map(w => {
      const wall: RoomJsonWall = {
        xBlock: w.xBlock,
        yBlock: w.yBlock,
        wBlock: w.wBlock,
        hBlock: w.hBlock,
      };
      if (w.isPlatformFlag === 1) {
        wall.isPlatform = true;
        if (w.platformEdge !== 0 && w.platformEdge !== undefined) wall.platformEdge = w.platformEdge;
      }
      if (w.blockTheme !== undefined) wall.blockTheme = w.blockTheme;
      if (w.blockTheme !== undefined) wall.blockThemeId = blockThemeToId(w.blockTheme);
      if (w.rampOrientation !== undefined) wall.rampOrientation = w.rampOrientation;
      if (w.stairsOrientation !== undefined) wall.stairsOrientation = w.stairsOrientation;
      if (w.smoothRampOrientation !== undefined) wall.smoothRampOrientation = w.smoothRampOrientation;
      if (w.isPillarHalfWidthFlag === 1) wall.isPillarHalfWidth = true;
      const rimIndex = rimIndexForWall(w);
      if (rimIndex !== undefined) wall.r = rimIndex;
      return wall;
    }),
    enemies: data.enemies.map(e => ({
      xBlock: e.xBlock,
      yBlock: e.yBlock,
      kinds: [...e.kinds],
      particleCount: e.particleCount,
      countsTowardRoomCompletion: e.countsTowardRoomCompletionFlag !== 0,
      isBoss: e.isBossFlag === 1,
      isFlyingEye: e.isFlyingEyeFlag === 1,
      isRollingEnemy: e.isRollingEnemyFlag === 1,
      rollingEnemySpriteIndex: e.isRollingEnemyFlag === 1 ? e.rollingEnemySpriteIndex : undefined,
      isRockElemental: e.isRockElementalFlag === 1,
      isRadiantTether: e.isRadiantTetherFlag === 1,
      isRadiantWeb: e.isRadiantWebFlag === 1,
      isCrimsonWizard: e.isCrimsonWizardFlag === 1,
      isHerald: e.isHeraldFlag === 1,
      isIceWizard: e.isIceWizardFlag === 1,
      isGrappleHunter: e.isGrappleHunterFlag === 1,
      isSlime: e.isSlimeFlag === 1,
      isLargeSlime: e.isLargeSlimeFlag === 1,
      isWheelEnemy: e.isWheelEnemyFlag === 1,
      isBeetle: e.isBeetleFlag === 1,
      isBubbleEnemy: e.isBubbleEnemyFlag === 1,
      isIceBubble: e.isIceBubbleFlag === 1,
      isSquareStampede: e.isSquareStampedeFlag === 1,
      isSlimeSnail: e.isSlimeSnailFlag === 1 ? true : undefined,
      isShadowEnemy: e.isShadowEnemyFlag === 1 ? true : undefined,
      isNeedleUrchin: e.isNeedleUrchinFlag === 1 ? true : undefined,
      slimeSnailSurfaceSideIndex: e.isSlimeSnailFlag === 1 ? (e.slimeSnailSurfaceSideIndex ?? 0) : undefined,
      slimeSnailClockwiseFlag: e.isSlimeSnailFlag === 1 ? (e.slimeSnailClockwiseFlag ?? 1) : undefined,
      isGoldenMimic: e.isGoldenMimicFlag === 1,
      isGoldenMimicYFlipped: e.isGoldenMimicYFlippedFlag === 1,
      isBeeSwarm: e.isBeeSwarmFlag === 1,
      isWebSpider: e.isWebSpiderFlag === 1,
      isDustConstellation: e.isDustConstellationFlag === 1,
      isDustConstellationLarge: e.isDustConstellationLargeFlag === 1,
      isOrbitalDustCore: e.isOrbitalDustCoreFlag === 1,
      isOrbitalDustCoreLarge: e.isOrbitalDustCoreLargeFlag === 1,
      isDustBlockMimic: e.isDustBlockMimicFlag === 1,
      isDustBlockMimicLarge: e.isDustBlockMimicLargeFlag === 1,
      isDustWeaverArchitect: e.isDustWeaverArchitectFlag === 1,
      isDustWeaverArchitectLarge: e.isDustWeaverArchitectLargeFlag === 1,
      isVoidSingularity: e.isVoidSingularityFlag === 1,
      isVoidSingularityPair: e.isVoidSingularityPairFlag === 1,
      isDustLeech:        e.isDustLeechFlag === 1,
      isGridBlockEnemy:   e.isGridBlockEnemyFlag === 1 ? true : undefined,
      isMomentumTurret: e.isMomentumTurretFlag === 1 ? true : undefined,
      momentumTurretFacingIndex: e.isMomentumTurretFlag === 1 ? (e.momentumTurretFacingIndex ?? 0) : undefined,
      gridBlockSizeIndex: e.isGridBlockEnemyFlag === 1 ? e.gridBlockSizeIndex  : undefined,
      gridBlockSpeedIndex: e.isGridBlockEnemyFlag === 1 ? e.gridBlockSpeedIndex : undefined,
      isGridSnakeEnemy:   e.isGridSnakeEnemyFlag === 1 ? true : undefined,
      gridSnakeLength:    e.isGridSnakeEnemyFlag === 1 ? e.gridSnakeLength : undefined,
    })),
    transitions: data.transitions.map(t => {
      // Compute legacy positionBlock / depthBlock from xBlock/yBlock for backward compat.
      const isHoriz = t.direction === 'left' || t.direction === 'right';
      const legacyPositionBlock = isHoriz ? t.yBlock : t.xBlock;
      const legacyDepthBlock    = isHoriz ? t.xBlock : t.yBlock;
      const jt: RoomJsonTransition = {
        direction: t.direction,
        positionBlock: legacyPositionBlock,
        openingSizeBlocks: t.openingSizeBlocks,
        targetRoomId: t.targetRoomId,
        targetSpawnBlock: [...t.targetSpawnBlock],
        xBlock: t.xBlock,
        yBlock: t.yBlock,
      };
      // Only emit depthBlock when it differs from the boundary-edge default, to
      // avoid confusing old readers that treat depthBlock===undefined as "edge".
      const gw = t.gradientWidthBlocks ?? 3;
      const isAtEdge = (t.direction === 'left' && t.xBlock === 0)
        || (t.direction === 'up'   && t.yBlock === 0);
      if (!isAtEdge || legacyDepthBlock !== 0) jt.depthBlock = legacyDepthBlock;
      if (t.fadeColor) jt.fadeColor = t.fadeColor;
      if (t.gradientOpacity !== undefined && t.gradientOpacity !== 1) jt.gradientOpacity = t.gradientOpacity;
      if (t.isSecretDoor) jt.isSecretDoor = t.isSecretDoor;
      if (t.longTransition) jt.longTransition = t.longTransition;
      if (gw !== 3 || t.gradientWidthBlocks !== undefined) jt.gradientWidthBlocks = gw;
      return jt;
    }),
    skillTombs: data.saveTombs.map(s => ({
      xBlock: s.xBlock,
      yBlock: s.yBlock,
    })),
  };

  if (rimTable.length > 0) json.rimStyles = rimTable;

  // Always write blockTheme and backgroundId when present
  if (data.blockTheme) {
    json.blockTheme = data.blockTheme;
    json.blockThemeId = blockThemeToId(data.blockTheme);
  }
  if (data.backgroundId) json.backgroundId = data.backgroundId;
  // Omit entirely when false/unset — only serialize when explicitly true, for
  // backward compatibility with saved rooms that predate this field.
  if (data.backgroundBlur === true) json.backgroundBlur = true;
  if (data.lightingEffect) json.lightingEffect = data.lightingEffect;
  // Only write songId when it differs from the default ('_continue')
  if (data.songId !== '_continue') json.songId = data.songId;
  if (data.skillTombs.length > 0) {
    json.dustSkillTombs = data.skillTombs.map(s => ({
      xBlock: s.xBlock,
      yBlock: s.yBlock,
      weaveId: s.weaveId,
    }));
  }
  if ((data.challengeFields ?? []).length > 0) {
    json.challengeFields = data.challengeFields!.map(element => ({ ...element }));
  }
  if ((data.challengeGates ?? []).length > 0) {
    json.challengeGates = data.challengeGates!.map(element => ({ ...element }));
  }
  if ((data.challengeTotems ?? []).length > 0) {
    json.challengeTotems = data.challengeTotems!.map(element => ({ ...element }));
  }
  if ((data.gates ?? []).length > 0) json.gates = data.gates!.map(gate => ({ ...gate }));
  if ((data.dustContainers ?? []).length > 0) {
    json.dustContainers = data.dustContainers.map(c => ({
      xBlock: c.xBlock,
      yBlock: c.yBlock,
    }));
  }
  if ((data.dustContainerPieces ?? []).length > 0) {
    json.dustContainerPieces = data.dustContainerPieces.map(c => ({
      xBlock: c.xBlock,
      yBlock: c.yBlock,
    }));
  }
  if ((data.dustBoostJars ?? []).length > 0) {
    json.dustBoostJars = data.dustBoostJars.map(j => ({
      xBlock: j.xBlock,
      yBlock: j.yBlock,
      dustKind: j.dustKind,
      dustCount: j.dustCount,
    }));
  }
  if ((data.dustSwarms ?? []).length > 0) {
    json.dustSwarms = data.dustSwarms.map(s => ({
      xBlock: s.xBlock,
      yBlock: s.yBlock,
      dustKind: s.dustKind,
      dustCount: s.dustCount,
    }));
  }
  if ((data.lambdaAnchors ?? []).length > 0) {
    json.lambdaAnchors = data.lambdaAnchors.map(a => ({
      xBlock: a.xBlock,
      yBlock: a.yBlock,
    }));
  }
  if ((data.fireflyJars ?? []).length > 0) {
    json.fireflyJars = data.fireflyJars!.map(j => ({
      xBlock: j.xBlock,
      yBlock: j.yBlock,
    }));
  }
  if ((data.springboards ?? []).length > 0) {
    json.springboards = data.springboards!.map(s => ({
      xBlock: s.xBlock,
      yBlock: s.yBlock,
    }));
  }
  if ((data.breakableBlocks ?? []).length > 0) {
    json.breakableBlocks = data.breakableBlocks!.map(b => ({
      xBlock: b.xBlock,
      yBlock: b.yBlock,
      ...(b.groupId !== undefined ? { groupId: b.groupId } : {}),
    }));
  }
  if (data.dustPiles.length > 0) {
    json.dustPiles = data.dustPiles.map(p => ({
      xBlock: p.xBlock,
      yBlock: p.yBlock,
      dustCount: p.dustCount,
      ...(p.spreadBlocks ? { spreadBlocks: p.spreadBlocks } : {}),
    }));
  }
  if ((data.grasshopperAreas ?? []).length > 0) {
    json.grasshopperAreas = data.grasshopperAreas.map(a => ({
      xBlock: a.xBlock,
      yBlock: a.yBlock,
      wBlock: a.wBlock,
      hBlock: a.hBlock,
      count: a.count,
    }));
  }
  if ((data.fireflyAreas ?? []).length > 0) {
    json.fireflyAreas = data.fireflyAreas.map(a => ({
      xBlock: a.xBlock,
      yBlock: a.yBlock,
      wBlock: a.wBlock,
      hBlock: a.hBlock,
      count: a.count,
    }));
  }
  if ((data.decorations ?? []).length > 0) {
    json.decorations = data.decorations.map(d => ({
      xBlock: d.xBlock,
      yBlock: d.yBlock,
      kind: d.kind,
    }));
  }
  if (data.ambientLightDirection) {
    json.ambientLightDirection = data.ambientLightDirection;
  }
  if (data.directionalBias      !== undefined) json.directionalBias      = data.directionalBias;
  if (data.sideExposureStrength !== undefined) json.sideExposureStrength = data.sideExposureStrength;
  if (data.minimumWallLight     !== undefined) json.minimumWallLight     = data.minimumWallLight;
  if (data.falloffPower         !== undefined) json.falloffPower         = data.falloffPower;
  if (data.backgroundLightSpill !== undefined) json.backgroundLightSpill = data.backgroundLightSpill;
  if (data.solidLightSoftness   !== undefined) json.solidLightSoftness   = data.solidLightSoftness;
  if (data.sunrays              !== undefined) json.sunrays              = data.sunrays;
  if (data.blockSeamBlending && data.blockSeamBlending !== 'off') {
    json.blockSeamBlending = data.blockSeamBlending;
  }
  if (data.voidEdgeStyle && data.voidEdgeStyle !== 'off') {
    json.voidEdgeStyle = data.voidEdgeStyle;
  }
  if ((data.ambientLightBlockers ?? []).length > 0) {
    json.ambientLightBlockers = data.ambientLightBlockers.map(b => {
      const entry: RoomJsonAmbientLightBlocker = { xBlock: b.xBlock, yBlock: b.yBlock };
      if (b.isDarkFlag === 1) entry.isDark = true;
      return entry;
    });
  }
  if ((data.lightSources ?? []).length > 0) {
    json.lightSources = data.lightSources.map(l => {
      const entry: RoomJsonLightSource = {
        xBlock: l.xBlock,
        yBlock: l.yBlock,
        radiusBlocks: l.radiusBlocks,
        colorR: l.colorR,
        colorG: l.colorG,
        colorB: l.colorB,
        brightnessPct: l.brightnessPct,
      };
      if (l.dustMoteCount > 0) entry.dustMoteCount = l.dustMoteCount;
      if (l.dustMoteSpreadBlocks > 0) entry.dustMoteSpreadBlocks = l.dustMoteSpreadBlocks;
      return entry;
    });
  }
  if ((data.sunbeams ?? []).length > 0) {
    json.sunbeams = (data.sunbeams ?? []).map(s => ({
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
  if ((data.waterZones ?? []).length > 0) {
    json.waterZones = (data.waterZones ?? []).map(z => ({
      xBlock: z.xBlock,
      yBlock: z.yBlock,
      wBlock: z.wBlock,
      hBlock: z.hBlock,
    }));
  }
  if ((data.lavaZones ?? []).length > 0) {
    json.lavaZones = (data.lavaZones ?? []).map(z => ({
      xBlock: z.xBlock,
      yBlock: z.yBlock,
      wBlock: z.wBlock,
      hBlock: z.hBlock,
    }));
  }
  if ((data.timeStopFields ?? []).length > 0) {
    json.timeStopFields = (data.timeStopFields ?? []).map(z => ({
      xBlock: z.xBlock,
      yBlock: z.yBlock,
      wBlock: z.wBlock,
      hBlock: z.hBlock,
    }));
  }
  if ((data.crumbleBlocks ?? []).length > 0) {
    json.crumbleBlocks = (data.crumbleBlocks ?? []).map(b => {
      const entry: RoomJsonCrumbleBlock = {
        xBlock: b.xBlock,
        yBlock: b.yBlock,
      };
      if (b.wBlock !== 1) entry.wBlock = b.wBlock;
      if (b.hBlock !== 1) entry.hBlock = b.hBlock;
      if (b.rampOrientation !== undefined) entry.rampOrientation = b.rampOrientation;
      if (b.stairsOrientation !== undefined) entry.stairsOrientation = b.stairsOrientation;
      if (b.smoothRampOrientation !== undefined) entry.smoothRampOrientation = b.smoothRampOrientation;
      if (b.isPillarHalfWidthFlag === 1) entry.isPillarHalfWidthFlag = 1;
      if (b.variant !== 'normal') entry.variant = b.variant;
      if (b.blockTheme !== undefined) {
        entry.blockTheme = b.blockTheme;
        entry.blockThemeId = blockThemeToId(b.blockTheme);
      }
      if (b.spikeDirection !== undefined) {
        entry.spikeDirection = b.spikeDirection;
        if (b.spikeSize !== undefined && b.spikeSize !== '1x1') entry.spikeSize = b.spikeSize;
      }
      return entry;
    });
  }
  if ((data.spikes ?? []).length > 0) {
    json.spikes = (data.spikes ?? []).map(sp => {
      const entry: RoomJsonSpike = {
        xBlock: sp.xBlock,
        yBlock: sp.yBlock,
        direction: sp.direction,
      };
      if (sp.size !== '1x1') entry.size = sp.size;
      if (sp.blockTheme !== undefined) entry.blockTheme = sp.blockTheme;
      return entry;
    });
  }
  if ((data.bouncePads ?? []).length > 0) {
    json.bouncePads = (data.bouncePads ?? []).map(b => {
      const entry: RoomJsonBouncePad = {
        xBlock: b.xBlock,
        yBlock: b.yBlock,
      };
      if (b.wBlock !== 1) entry.wBlock = b.wBlock;
      if (b.hBlock !== 1) entry.hBlock = b.hBlock;
      if (b.rampOrientation !== undefined) entry.rampOrientation = b.rampOrientation;
      if (b.speedFactorIndex !== 0) entry.speedFactorIndex = b.speedFactorIndex;
      return entry;
    });
  }
  if ((data.ropes ?? []).length > 0) {
    json.ropes = (data.ropes ?? []).map(r => {
      const entry: RoomJsonRope = {
        aax: r.anchorAXBlock,
        aay: r.anchorAYBlock,
        abx: r.anchorBXBlock,
        aby: r.anchorBYBlock,
      };
      if (r.segmentCount !== DEFAULT_ROPE_SEGMENT_COUNT) entry.segs = r.segmentCount;
      if (r.isAnchorBFixedFlag === 0) entry.fixed = false;
      if (r.destructibility !== 'indestructible') entry.destr = r.destructibility;
      if (r.thicknessIndex !== 0) entry.thick = r.thicknessIndex;
      return entry;
    });
  }
  if ((data.grappleCarryBlocks ?? []).length > 0) {
    json.grappleCarryBlocks = (data.grappleCarryBlocks ?? []).map(b => ({
      xBlock: b.xBlock,
      yBlock: b.yBlock,
    }));
  }
  if ((data.phantasmalTiles ?? []).length > 0) {
    json.phantasmalTiles = (data.phantasmalTiles ?? []).map(b => ({
      xBlock: b.xBlock,
      yBlock: b.yBlock,
    }));
  }
  if ((data.pixelMaterials ?? []).length > 0) {
    // Defensive bounds + material-id filter: even if in-memory data somehow
    // contains out-of-bounds or invalid-material entries (e.g. a bug
    // elsewhere, or hand-edited JSON that was re-imported), never export
    // them. This is a belt-and-suspenders check — `applyRoomDimensionChange`/
    // `applyEdgeResize` already clip on resize — but export is the last line
    // of defense before the data leaves the editor. Footprint-aware: a 2x2
    // entry is rejected if ANY part of its footprint falls outside bounds,
    // not just its anchor.
    const widthPx = data.widthBlocks * BLOCK_SIZE_SMALL;
    const heightPx = data.heightBlocks * BLOCK_SIZE_SMALL;
    const valid = (data.pixelMaterials ?? []).filter(p => {
      if (!Number.isFinite(p.xPixel) || !Number.isFinite(p.yPixel) || !isKnownMaterialId(p.material)) return false;
      const size = getMaterialFootprintSize(p.material);
      return p.xPixel >= 0 && p.yPixel >= 0 &&
        p.xPixel + size <= widthPx && p.yPixel + size <= heightPx;
    });
    if (valid.length > 0) {
      json.pixelMaterials = valid.map(p => ({
        xPixel: p.xPixel,
        yPixel: p.yPixel,
        material: p.material,
      }));
    }
  }
  if ((data.fallingBlocks ?? []).length > 0) {
    json.fallingBlocks = (data.fallingBlocks ?? []).map(fb => ({
      xBlock: fb.xBlock,
      yBlock: fb.yBlock,
      variant: fb.variant,
      blockTheme: fb.blockTheme ?? undefined,
    }));
  }
  if ((data.dialogueTriggers ?? []).length > 0) {
    json.dialogueTriggers = (data.dialogueTriggers ?? []).map(dt => {
      const entry: RoomJsonDialogueTrigger = {
        xBlock: dt.xBlock,
        yBlock: dt.yBlock,
        wBlock: dt.wBlock,
        hBlock: dt.hBlock,
        conversation: {
          id: dt.conversationId,
          entries: dt.entries.map(e => ({
            text: e.text,
            portraitId: e.portraitId,
            portraitSide: e.portraitSide,
          })),
        },
      };
      if (dt.conversationTitle && dt.conversationTitle.trim().length > 0) {
        entry.conversation.title = dt.conversationTitle;
      }
      return entry;
    });
  }
  if ((data.backgroundBlocks ?? []).length > 0) {
    json.backgroundBlocks = (data.backgroundBlocks ?? []).map(b => {
      const entry: RoomJsonBackgroundBlock = {
        xBlock: b.xBlock,
        yBlock: b.yBlock,
        wBlock: b.wBlock,
        hBlock: b.hBlock,
      };
      if (b.blockTheme !== null && b.blockTheme !== undefined) entry.blockTheme = b.blockTheme;
      if (b.isLightBlockingFlag === 1) entry.isLightBlocking = true;
      return entry;
    });
  }
  if ((data.sceneLights ?? []).length > 0) {
    json.sceneLights = (data.sceneLights ?? []).map(s => lightDefToSaved({ ...s }));
  }
  if ((data.guideDustPaths ?? []).length > 0) {
    json.guideDustPaths = (data.guideDustPaths ?? []).map(p => {
      const entry: RoomJsonGuideDustPath = {
        points: p.points.map(pt => {
          const out: RoomJsonGuideDustPathPoint = { xBlock: pt.xBlock, yBlock: pt.yBlock };
          if (pt.speed !== 1.0) out.speed = pt.speed;
          return out;
        }),
      };
      if (p.loop) entry.loop = true;
      if (p.moteCount !== 8) entry.moteCount = p.moteCount;
      if (p.moteSpeedFactor !== 1.0) entry.moteSpeedFactor = p.moteSpeedFactor;
      if (p.opacityPct !== 100) entry.opacityPct = p.opacityPct;
      if (!p.visibleInGame) entry.visibleInGame = false;
      return entry;
    });
  }

  // ── Custom block placements ──────────────────────────────────────────────
  if ((data.customBlockPlacements ?? []).length > 0) {
    json.customBlockPlacements = (data.customBlockPlacements ?? []).map(
      p => [p.xBlock, p.yBlock, p.blockId, p.tileWidth, p.tileHeight] as [number, number, string, number, number],
    );
  }

  // ── Bake runtime wall template ───────────────────────────────────────────
  // Build the RoomDef (with complete boundary walls) and run the merge pass
  // once at export time.  The result is stored in the JSON so the runtime can
  // skip buildRoomWallTemplate() for rooms that have not changed since export.
  try {
    const roomDef = editorRoomDataToRoomDef(data);
    const tpl = buildRoomWallTemplate(roomDef);
    const sourceHash = computeWallTemplateSourceHash(json);

    // Collect theme names for non-legacy dynamic indices (≥3) so that
    // hydrateAndValidateBakedWallTemplate can remap them to the runtime
    // session registry independently of registration order.
    let maxLocalIdx = 2;
    for (let wi = 0; wi < tpl.wallCount; wi++) {
      const idx = tpl.themeIndex[wi];
      if (idx !== WALL_THEME_DEFAULT_INDEX && idx > maxLocalIdx) maxLocalIdx = idx;
    }
    const themeNames: string[] = [];
    for (let i = 3; i <= maxLocalIdx; i++) {
      themeNames.push(indexToBlockTheme(i));
    }

    json.bakedWallTemplate = {
      schemaVersion: BAKED_WALL_SCHEMA_VERSION,
      sourceHash,
      wallCount: tpl.wallCount,
      xWorld:                Array.from(tpl.xWorld),
      yWorld:                Array.from(tpl.yWorld),
      wWorld:                Array.from(tpl.wWorld),
      hWorld:                Array.from(tpl.hWorld),
      isPlatformFlag:        Array.from(tpl.isPlatformFlag),
      platformEdge:          Array.from(tpl.platformEdge),
      themeIndex:            Array.from(tpl.themeIndex),
      ...(themeNames.length > 0 ? { themeNames } : {}),
      soundHardnessIndex:    Array.from(tpl.soundHardnessIndex),
      isInvisibleFlag:       Array.from(tpl.isInvisibleFlag),
      rampOrientationIndex:  Array.from(tpl.rampOrientationIndex),
      isPillarHalfWidthFlag: Array.from(tpl.isPillarHalfWidthFlag),
      isIceFlag:             Array.from(tpl.isIceFlag),
      isUltraIceFlag:        Array.from(tpl.isUltraIceFlag),
      rimStyleIndex:         Array.from(tpl.rimStyleIndex),
      rimStyles:             tpl.rimStyleTable.map(encodeSurfaceRimStyle),
    };
  } catch (err) {
    // Non-fatal: export still succeeds; runtime will fall back to buildRoomWallTemplate().
    console.warn('[roomJsonSerializer] Failed to bake wall template:', err);
  }

  return json;
}
