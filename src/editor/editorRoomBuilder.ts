/**
 * Room builder — bidirectional conversions between EditorRoomData and RoomDef.
 *
 * This module handles the runtime-representation layer: turning an author's
 * EditorRoomData into a fully hydrated RoomDef (for the sim), and the reverse
 * conversion that lets the editor load back a compiled RoomDef.
 *
 * JSON serialisation/deserialisation lives in roomJson.ts.
 * Boundary walls and tunnel wall geometry are NOT stored in the JSON;
 * they are regenerated deterministically here at load time.
 */

import { ParticleKind } from '../sim/particles/kinds';
import type { RoomDef, RoomEnemyDef, RoomWallDef, RoomTransitionDef } from '../levels/roomDef';
import type { EditorRoomData, EditorTransition } from './editorState';
import { stringToParticleKind } from './roomJsonSchema';

// Re-export the reverse direction (RoomDef → EditorRoomData) from its own module
// so existing callers that import from editorRoomBuilder are unaffected.
export { roomDefToEditorRoomData } from './editorRoomImporter';

// ── Boundary wall generation ─────────────────────────────────────────────────

/**
 * Builds boundary walls with gaps where transitions are placed at the room edge.
 *
 * A gap is only created when the transition zone actually touches the wall:
 *   left  → xBlock === 0
 *   right → xBlock + gradientWidth === widthBlocks
 *   up    → yBlock === 0
 *   down  → yBlock + gradientHeight === heightBlocks
 *
 * Interior transitions (zone not touching boundary) do not create gaps.
 * Transition zones never generate out-of-room corridor/tunnel walls.
 */
function buildBoundaryWalls(
  widthBlocks: number,
  heightBlocks: number,
  transitions: EditorTransition[],
): RoomWallDef[] {
  const walls: RoomWallDef[] = [];

  const gw = (t: EditorTransition) => t.gradientWidthBlocks ?? 3;

  // Top wall — gap where an 'up' transition's zone starts at y=0
  const upTunnels = transitions.filter(t => t.direction === 'up' && t.yBlock === 0);
  buildHorizontalWall(walls, 0, 0, widthBlocks, upTunnels.map(t => ({ positionBlock: t.xBlock, openingSizeBlocks: t.openingSizeBlocks })));

  // Bottom wall — gap where a 'down' transition's zone ends at y=heightBlocks
  const downTunnels = transitions.filter(t => t.direction === 'down' && t.yBlock + gw(t) >= heightBlocks);
  buildHorizontalWall(walls, heightBlocks - 1, 0, widthBlocks, downTunnels.map(t => ({ positionBlock: t.xBlock, openingSizeBlocks: t.openingSizeBlocks })));

  // Left wall — gap where a 'left' transition's zone starts at x=0
  const leftTunnels = transitions.filter(t => t.direction === 'left' && t.xBlock === 0);
  buildSideWall(walls, 0, 1, heightBlocks - 2, leftTunnels.map(t => ({ positionBlock: t.yBlock, openingSizeBlocks: t.openingSizeBlocks })));

  // Right wall — gap where a 'right' transition's zone ends at x=widthBlocks
  const rightTunnels = transitions.filter(t => t.direction === 'right' && t.xBlock + gw(t) >= widthBlocks);
  buildSideWall(walls, widthBlocks - 1, 1, heightBlocks - 2, rightTunnels.map(t => ({ positionBlock: t.yBlock, openingSizeBlocks: t.openingSizeBlocks })));

  return walls;
}

function buildSideWall(
  out: RoomWallDef[],
  xBlock: number,
  startYBlock: number,
  totalHeightBlocks: number,
  tunnels: Array<{ positionBlock: number; openingSizeBlocks: number }>,
): void {
  const sorted = [...tunnels].sort((a, b) => a.positionBlock - b.positionBlock);
  let currentY = startYBlock;
  const endY = startYBlock + totalHeightBlocks;

  for (const tunnel of sorted) {
    const tunnelTop = tunnel.positionBlock;
    const tunnelBottom = tunnel.positionBlock + tunnel.openingSizeBlocks;
    if (tunnelTop > currentY) {
      out.push({ xBlock, yBlock: currentY, wBlock: 1, hBlock: tunnelTop - currentY, isInvisibleFlag: 1 });
    }
    currentY = tunnelBottom;
  }

  if (currentY < endY) {
    out.push({ xBlock, yBlock: currentY, wBlock: 1, hBlock: endY - currentY, isInvisibleFlag: 1 });
  }
}

function buildHorizontalWall(
  out: RoomWallDef[],
  yBlock: number,
  startXBlock: number,
  totalWidthBlocks: number,
  tunnels: Array<{ positionBlock: number; openingSizeBlocks: number }>,
): void {
  const sorted = [...tunnels].sort((a, b) => a.positionBlock - b.positionBlock);
  let currentX = startXBlock;
  const endX = startXBlock + totalWidthBlocks;

  for (const tunnel of sorted) {
    const tunnelLeft = tunnel.positionBlock;
    const tunnelRight = tunnel.positionBlock + tunnel.openingSizeBlocks;
    if (tunnelLeft > currentX) {
      out.push({ xBlock: currentX, yBlock, wBlock: tunnelLeft - currentX, hBlock: 1, isInvisibleFlag: 1 });
    }
    currentX = tunnelRight;
  }

  if (currentX < endX) {
    out.push({ xBlock: currentX, yBlock, wBlock: endX - currentX, hBlock: 1, isInvisibleFlag: 1 });
  }
}

// ── Conversion: EditorRoomData → RoomDef (for runtime loading) ───────────────

/**
 * Converts editor room data into a full RoomDef suitable for runtime loading.
 * Boundary walls are regenerated; tunnel corridor walls are no longer generated
 * (transitions are purely trigger/fade zones, not wall geometry sources).
 */
export function editorRoomDataToRoomDef(data: EditorRoomData): RoomDef {
  const boundaryWalls = buildBoundaryWalls(data.widthBlocks, data.heightBlocks, data.transitions);

  const interiorWalls: RoomWallDef[] = data.interiorWalls.map(w => ({
    xBlock: w.xBlock,
    yBlock: w.yBlock,
    wBlock: w.wBlock,
    hBlock: w.hBlock,
    isPlatformFlag: w.isPlatformFlag,
    platformEdge: w.platformEdge,
    blockTheme: w.blockTheme,
    soundHardness: w.soundHardness,
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
      isDustLeechFlag: e.isDustLeechFlag ?? 0,
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
  };
}
