/**
 * Room builder — bidirectional conversions between EditorRoomData and RoomDef.
 *
 * This module handles the runtime-representation layer: turning an author's
 * EditorRoomData into a fully hydrated RoomDef (for the sim), and the reverse
 * conversion that lets the editor load back a compiled RoomDef.
 *
 * JSON serialisation/deserialisation lives in roomJson.ts.
 * Boundary walls are NOT stored in the JSON; they are regenerated
 * deterministically here at load time using buildCompleteBoundaryWalls().
 *
 * DESIGN NOTE (BUILD 420+): Boundary walls are complete solid edge rectangles.
 * Transitions are independent trigger strips — they no longer cut holes in
 * boundary walls.  Do not reintroduce wall gaps for transitions here.
 */

import { ParticleKind } from '../sim/particles/kinds';
import type { RoomDef, RoomEnemyDef, RoomWallDef, RoomTransitionDef } from '../levels/roomDef';
import type { EditorRoomData } from './editorState';
import { stringToParticleKind } from './roomJsonSchema';
import { buildCompleteBoundaryWalls } from '../levels/roomBoundaryWalls';

// Re-export the reverse direction (RoomDef → EditorRoomData) from its own module
// so existing callers that import from editorRoomBuilder are unaffected.
export { roomDefToEditorRoomData } from './editorRoomImporter';

// ── Conversion: EditorRoomData → RoomDef (for runtime loading) ───────────────

/**
 * Converts editor room data into a full RoomDef suitable for runtime loading.
 * Boundary walls are complete solid edge walls (no transition holes).
 * See `roomBoundaryWalls.ts` for the design rationale.
 */
export function editorRoomDataToRoomDef(data: EditorRoomData): RoomDef {
  const boundaryWalls = buildCompleteBoundaryWalls(data.widthBlocks, data.heightBlocks);

  const interiorWalls: RoomWallDef[] = data.interiorWalls.map(w => ({
    xBlock: w.xBlock,
    yBlock: w.yBlock,
    wBlock: w.wBlock,
    hBlock: w.hBlock,
    isPlatformFlag: w.isPlatformFlag,
    platformEdge: w.platformEdge,
    blockTheme: w.blockTheme,
    rampOrientation: w.rampOrientation,
    isPillarHalfWidthFlag: w.isPillarHalfWidthFlag,
  }));

  const allWalls: RoomWallDef[] = [...boundaryWalls, ...interiorWalls];

  const enemies: RoomEnemyDef[] = data.enemies.map(e => {
    const kinds: ParticleKind[] = [];
    for (const name of e.kinds) {
      const k = stringToParticleKind(name);
      if (k !== null) kinds.push(k);
    }
    if (kinds.length === 0) kinds.push(ParticleKind.Physical);
    return {
      xBlock: e.xBlock,
      yBlock: e.yBlock,
      kinds,
      particleCount: e.particleCount,
      isBossFlag: e.isBossFlag,
      isFlyingEyeFlag: e.isFlyingEyeFlag,
      isRollingEnemyFlag: e.isRollingEnemyFlag,
      rollingEnemySpriteIndex: e.rollingEnemySpriteIndex,
      isRockElementalFlag: e.isRockElementalFlag,
      isRadiantTetherFlag: e.isRadiantTetherFlag,
      isRadiantWebFlag: e.isRadiantWebFlag,
      isGrappleHunterFlag: e.isGrappleHunterFlag,
      isSlimeFlag: e.isSlimeFlag,
      isLargeSlimeFlag: e.isLargeSlimeFlag,
      isWheelEnemyFlag: e.isWheelEnemyFlag,
      isBeetleFlag: e.isBeetleFlag,
      isBubbleEnemyFlag: e.isBubbleEnemyFlag,
      isIceBubbleFlag: e.isIceBubbleFlag,
      isSquareStampedeFlag: e.isSquareStampedeFlag,
      isGoldenMimicFlag: e.isGoldenMimicFlag ?? 0,
      isGoldenMimicYFlippedFlag: e.isGoldenMimicYFlippedFlag ?? 0,
      isBeeSwarmFlag: e.isBeeSwarmFlag ?? 0,
      isWebSpiderFlag: e.isWebSpiderFlag ?? 0,
      isDustConstellationFlag: e.isDustConstellationFlag ?? 0,
      isDustConstellationLargeFlag: e.isDustConstellationLargeFlag ?? 0,
      isOrbitalDustCoreFlag: e.isOrbitalDustCoreFlag ?? 0,
      isOrbitalDustCoreLargeFlag: e.isOrbitalDustCoreLargeFlag ?? 0,
      isDustLeechFlag:       e.isDustLeechFlag       ?? 0,
      isGridBlockEnemyFlag:  e.isGridBlockEnemyFlag  ?? 0,
      gridBlockSizeIndex:    e.gridBlockSizeIndex     ?? 0,
      gridBlockSpeedIndex:   e.gridBlockSpeedIndex    ?? 0,
    };
  });

  const transitions: RoomTransitionDef[] = data.transitions.map(t => ({
    direction: t.direction,
    targetRoomId: t.targetRoomId,
    xBlock: t.xBlock,
    yBlock: t.yBlock,
    positionBlock: t.positionBlock,
    openingSizeBlocks: t.openingSizeBlocks,
    targetSpawnBlock: [t.targetSpawnBlock[0], t.targetSpawnBlock[1]] as readonly [number, number],
    fadeColor: t.fadeColor,
    depthBlock: t.depthBlock,
    isSecretDoor: t.isSecretDoor,
    gradientWidthBlocks: t.gradientWidthBlocks,
    longTransition: t.longTransition,
  }));

  return {
    id: data.id,
    name: data.name,
    worldNumber: data.worldNumber,
    mapX: data.mapX,
    mapY: data.mapY,
    blockTheme: data.blockTheme,
    backgroundId: data.backgroundId,
    lightingEffect: data.lightingEffect,
    songId: data.songId !== '_continue' ? data.songId : undefined,
    widthBlocks: data.widthBlocks,
    heightBlocks: data.heightBlocks,
    walls: allWalls,
    enemies,
    playerSpawnBlock: [data.playerSpawnBlock[0], data.playerSpawnBlock[1]],
    transitions,
    saveTombs: data.saveTombs.map(s => ({ xBlock: s.xBlock, yBlock: s.yBlock })),
    skillTombs: data.skillTombs.map(s => ({ xBlock: s.xBlock, yBlock: s.yBlock, weaveId: s.weaveId })),
    dustContainers: (data.dustContainers ?? []).map(c => ({ xBlock: c.xBlock, yBlock: c.yBlock })),
    dustContainerPieces: (data.dustContainerPieces ?? []).map(c => ({ xBlock: c.xBlock, yBlock: c.yBlock })),
    dustBoostJars: (data.dustBoostJars ?? []).map(j => {
      const kind = stringToParticleKind(j.dustKind);
      return {
        xBlock: j.xBlock,
        yBlock: j.yBlock,
        dustKind: kind !== null ? kind : 0,
        dustCount: j.dustCount,
      };
    }),
    dustSwarms: (data.dustSwarms ?? []).map(s => ({
      xBlock: s.xBlock,
      yBlock: s.yBlock,
      dustKind: s.dustKind,
      dustCount: s.dustCount,
    })),
    lambdaAnchors: (data.lambdaAnchors ?? []).map(a => ({
      xBlock: a.xBlock,
      yBlock: a.yBlock,
    })),
    dustPiles: data.dustPiles.map(p => ({ xBlock: p.xBlock, yBlock: p.yBlock, dustCount: p.dustCount, spreadBlocks: p.spreadBlocks ?? 0 })),
    grasshopperAreas: data.grasshopperAreas.map(a => ({
      xBlock: a.xBlock,
      yBlock: a.yBlock,
      wBlock: a.wBlock,
      hBlock: a.hBlock,
      count: a.count,
    })),
    fireflyAreas: data.fireflyAreas.map(a => ({
      xBlock: a.xBlock,
      yBlock: a.yBlock,
      wBlock: a.wBlock,
      hBlock: a.hBlock,
      count: a.count,
    })),
    decorations: (data.decorations ?? []).map(d => ({
      xBlock: d.xBlock,
      yBlock: d.yBlock,
      kind: d.kind,
    })),
    ambientLightDirection: data.ambientLightDirection,
    directionalBias:       data.directionalBias,
    sideExposureStrength:  data.sideExposureStrength,
    minimumWallLight:      data.minimumWallLight,
    falloffPower:          data.falloffPower,
    sunrays:               data.sunrays,
    backgroundLightSpill:  data.backgroundLightSpill,
    solidLightSoftness:    data.solidLightSoftness,
    ambientLightBlockers: (data.ambientLightBlockers ?? []).map(b => ({
      xBlock: b.xBlock,
      yBlock: b.yBlock,
      isDark: b.isDarkFlag === 1,
    })),
    lightSources: (data.lightSources ?? []).map(l => ({
      xBlock: l.xBlock,
      yBlock: l.yBlock,
      radiusBlocks: l.radiusBlocks,
      colorR: l.colorR,
      colorG: l.colorG,
      colorB: l.colorB,
      brightnessPct: l.brightnessPct,
      dustMoteCount: l.dustMoteCount ?? 0,
      dustMoteSpreadBlocks: l.dustMoteSpreadBlocks ?? 0,
    })),
    sunbeams: (data.sunbeams ?? []).map(s => ({
      xBlock: s.xBlock,
      yBlock: s.yBlock,
      angleRad: s.angleRad,
      widthBlocks: s.widthBlocks,
      lengthBlocks: s.lengthBlocks,
      colorR: s.colorR,
      colorG: s.colorG,
      colorB: s.colorB,
      intensityPct: s.intensityPct,
    })),
    waterZones: (data.waterZones ?? []).map(z => ({
      xBlock: z.xBlock,
      yBlock: z.yBlock,
      wBlock: z.wBlock,
      hBlock: z.hBlock,
    })),
    lavaZones: (data.lavaZones ?? []).map(z => ({
      xBlock: z.xBlock,
      yBlock: z.yBlock,
      wBlock: z.wBlock,
      hBlock: z.hBlock,
    })),
    crumbleBlocks: (data.crumbleBlocks ?? []).map(b => ({
      xBlock: b.xBlock,
      yBlock: b.yBlock,
      wBlock: b.wBlock !== 1 ? b.wBlock : undefined,
      hBlock: b.hBlock !== 1 ? b.hBlock : undefined,
      rampOrientation: b.rampOrientation,
      variant: b.variant !== 'normal' ? b.variant : undefined,
      blockTheme: b.blockTheme,
    })),
    bouncePads: (data.bouncePads ?? []).map(b => ({
      xBlock: b.xBlock,
      yBlock: b.yBlock,
      wBlock: b.wBlock !== 1 ? b.wBlock : undefined,
      hBlock: b.hBlock !== 1 ? b.hBlock : undefined,
      rampOrientation: b.rampOrientation,
      speedFactorIndex: b.speedFactorIndex !== 0 ? b.speedFactorIndex : undefined,
    })),
    kineticBlocks: (data.kineticBlocks ?? []).map(kb => ({
      xBlock: kb.xBlock,
      yBlock: kb.yBlock,
      wBlock: kb.wBlock !== 1 ? kb.wBlock : undefined,
      hBlock: kb.hBlock !== 1 ? kb.hBlock : undefined,
    })),
    ropes: (data.ropes ?? []).map(r => ({
      anchorAXBlock: r.anchorAXBlock,
      anchorAYBlock: r.anchorAYBlock,
      anchorBXBlock: r.anchorBXBlock,
      anchorBYBlock: r.anchorBYBlock,
      segmentCount: r.segmentCount,
      isAnchorBFixed: r.isAnchorBFixedFlag === 1,
      destructibility: r.destructibility,
      thicknessIndex: r.thicknessIndex,
    })),
    fallingBlocks: (data.fallingBlocks ?? []).map(fb => ({
      xBlock: fb.xBlock,
      yBlock: fb.yBlock,
      variant: fb.variant,
    })),
    backgroundBlocks: (data.backgroundBlocks ?? []).map(b => ({
      xBlock: b.xBlock,
      yBlock: b.yBlock,
      wBlock: b.wBlock,
      hBlock: b.hBlock,
      blockTheme: b.blockTheme,
      isLightBlockingFlag: b.isLightBlockingFlag,
    })),
    dialogueTriggers: (data.dialogueTriggers ?? []).map(dt => ({
      xBlock: dt.xBlock,
      yBlock: dt.yBlock,
      wBlock: dt.wBlock,
      hBlock: dt.hBlock,
      conversation: {
        id: dt.conversationId,
        title: dt.conversationTitle || undefined,
        entries: dt.entries.map(e => ({
          text: e.text,
          portraitId: e.portraitId,
          portraitSide: e.portraitSide,
        })),
      },
    })),
    sceneLights: (data.sceneLights ?? []).map(s => {
      const { uid, ...lightDef } = s;
      void uid;
      return lightDef as import('../levels/lightingSchema').LightDef;
    }),
    guideDustPaths: (data.guideDustPaths ?? []).map(p => ({
      points: p.points.map(pt => ({ xBlock: pt.xBlock, yBlock: pt.yBlock, speed: pt.speed ?? 1.0 })),
      loop: p.loop,
      visibleInGame: p.visibleInGame,
      moteCount: p.moteCount,
      moteSpeedFactor: p.moteSpeedFactor,
      opacityPct: p.opacityPct,
    })),
    blockSeamBlending: data.blockSeamBlending,
    voidEdgeStyle: data.voidEdgeStyle,
  };
}
