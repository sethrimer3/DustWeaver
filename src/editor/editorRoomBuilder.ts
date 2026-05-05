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
import { DEFAULT_ROPE_SEGMENT_COUNT } from '../levels/roomDef';
import type {
  EditorRoomData, EditorEnemy, EditorTransition, EditorWall,
  EditorSaveTomb, EditorSkillTomb, EditorDustPile,
  EditorGrasshopperArea, EditorFireflyArea, EditorDecoration,
  EditorAmbientLightBlocker, EditorLightSource, EditorSunbeam,
  EditorWaterZone, EditorLavaZone, EditorCrumbleBlock,
  EditorRope,
  EditorDustContainer, EditorDustContainerPiece, EditorDustBoostJar,
  EditorFallingBlock, EditorDialogueTrigger,
} from './editorState';
import { particleKindToString, stringToParticleKind } from './roomJsonSchema';

// ── Boundary wall generation ─────────────────────────────────────────────────

/**
 * Builds boundary walls with gaps for edge-transition tunnel openings.
 * Interior transitions (depthBlock defined) do not create gaps.
 */
function buildBoundaryWalls(
  widthBlocks: number,
  heightBlocks: number,
  transitions: EditorTransition[],
): RoomWallDef[] {
  const walls: RoomWallDef[] = [];

  // Top wall — split around edge-transition openings only
  const upTunnels = transitions.filter(t => t.direction === 'up' && t.depthBlock === undefined);
  buildHorizontalWall(walls, 0, 0, widthBlocks, upTunnels);

  // Bottom wall — split around edge-transition openings only
  const downTunnels = transitions.filter(t => t.direction === 'down' && t.depthBlock === undefined);
  buildHorizontalWall(walls, heightBlocks - 1, 0, widthBlocks, downTunnels);

  // Left wall — split around edge-transition openings only
  const leftTunnels = transitions.filter(t => t.direction === 'left' && t.depthBlock === undefined);
  buildSideWall(walls, 0, 1, heightBlocks - 2, leftTunnels);

  // Right wall — split around edge-transition openings only
  const rightTunnels = transitions.filter(t => t.direction === 'right' && t.depthBlock === undefined);
  buildSideWall(walls, widthBlocks - 1, 1, heightBlocks - 2, rightTunnels);

  return walls;
}

function buildSideWall(
  out: RoomWallDef[],
  xBlock: number,
  startYBlock: number,
  totalHeightBlocks: number,
  tunnels: EditorTransition[],
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
  tunnels: EditorTransition[],
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

function buildTunnelWalls(
  roomWidthBlocks: number,
  roomHeightBlocks: number,
  transitions: EditorTransition[],
): RoomWallDef[] {
  const walls: RoomWallDef[] = [];
  const TUNNEL_OVERHANG_BLOCKS = 4;

  // Only edge transitions (depthBlock undefined) get physical corridor walls.
  for (const tunnel of transitions) {
    if (tunnel.depthBlock !== undefined) continue; // interior transition — no corridor walls

    const topY = tunnel.positionBlock - 1;
    const bottomY = tunnel.positionBlock + tunnel.openingSizeBlocks;
    const leftX = tunnel.positionBlock - 1;
    const rightX = tunnel.positionBlock + tunnel.openingSizeBlocks;

    if (tunnel.direction === 'left') {
      walls.push({ xBlock: -TUNNEL_OVERHANG_BLOCKS, yBlock: topY, wBlock: TUNNEL_OVERHANG_BLOCKS + 1, hBlock: 1 });
      walls.push({ xBlock: -TUNNEL_OVERHANG_BLOCKS, yBlock: bottomY, wBlock: TUNNEL_OVERHANG_BLOCKS + 1, hBlock: 1 });
    } else if (tunnel.direction === 'right') {
      walls.push({ xBlock: roomWidthBlocks - 1, yBlock: topY, wBlock: TUNNEL_OVERHANG_BLOCKS + 1, hBlock: 1 });
      walls.push({ xBlock: roomWidthBlocks - 1, yBlock: bottomY, wBlock: TUNNEL_OVERHANG_BLOCKS + 1, hBlock: 1 });
    } else if (tunnel.direction === 'up') {
      walls.push({ xBlock: leftX, yBlock: -TUNNEL_OVERHANG_BLOCKS, wBlock: 1, hBlock: TUNNEL_OVERHANG_BLOCKS + 1 });
      walls.push({ xBlock: rightX, yBlock: -TUNNEL_OVERHANG_BLOCKS, wBlock: 1, hBlock: TUNNEL_OVERHANG_BLOCKS + 1 });
    } else if (tunnel.direction === 'down') {
      walls.push({ xBlock: leftX, yBlock: roomHeightBlocks - 1, wBlock: 1, hBlock: TUNNEL_OVERHANG_BLOCKS + 1 });
      walls.push({ xBlock: rightX, yBlock: roomHeightBlocks - 1, wBlock: 1, hBlock: TUNNEL_OVERHANG_BLOCKS + 1 });
    }
  }

  return walls;
}

// ── Conversion: EditorRoomData → RoomDef (for runtime loading) ───────────────

/**
 * Converts editor room data into a full RoomDef suitable for runtime loading.
 * Boundary walls and tunnel corridor walls are regenerated here.
 */
export function editorRoomDataToRoomDef(data: EditorRoomData): RoomDef {
  const boundaryWalls = buildBoundaryWalls(data.widthBlocks, data.heightBlocks, data.transitions);
  const tunnelWalls = buildTunnelWalls(data.widthBlocks, data.heightBlocks, data.transitions);

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

  const allWalls: RoomWallDef[] = [...boundaryWalls, ...tunnelWalls, ...interiorWalls];

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
    };
  });

  const transitions: RoomTransitionDef[] = data.transitions.map(t => ({
    direction: t.direction,
    targetRoomId: t.targetRoomId,
    positionBlock: t.positionBlock,
    openingSizeBlocks: t.openingSizeBlocks,
    targetSpawnBlock: [t.targetSpawnBlock[0], t.targetSpawnBlock[1]] as readonly [number, number],
    fadeColor: t.fadeColor,
    depthBlock: t.depthBlock,
    isSecretDoor: t.isSecretDoor,
    gradientWidthBlocks: t.gradientWidthBlocks,
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
  };
}

// ── Conversion: RoomDef → EditorRoomData (for editing existing rooms) ────────

/**
 * Extracts interior walls from a RoomDef by removing regenerated boundary/tunnel walls.
 * This is a heuristic: boundary walls are at edges (x=0, x=w-1, y=0, y=h-1) and
 * tunnel walls extend past room boundaries (negative coordinates or past room width).
 */
function extractInteriorWalls(room: RoomDef): RoomWallDef[] {
  const interior: RoomWallDef[] = [];
  for (const w of room.walls) {
    // Skip boundary walls: top row, bottom row, leftmost column, rightmost column
    const isTopOrBottom = (w.yBlock === 0 && w.hBlock === 1) || (w.yBlock === room.heightBlocks - 1 && w.hBlock === 1);
    const isLeftBoundary = w.xBlock === 0 && w.wBlock === 1;
    const isRightBoundary = w.xBlock === room.widthBlocks - 1 && w.wBlock === 1;
    const isOutOfBounds = w.xBlock < 0 || w.xBlock + w.wBlock > room.widthBlocks;

    if (isTopOrBottom || isLeftBoundary || isRightBoundary || isOutOfBounds) continue;
    interior.push(w);
  }
  return interior;
}

export function roomDefToEditorRoomData(room: RoomDef, startUid: number): { data: EditorRoomData; nextUid: number } {
  let uid = startUid;

  const interiorWalls: EditorWall[] = extractInteriorWalls(room).map(w => ({
    uid: uid++,
    xBlock: w.xBlock,
    yBlock: w.yBlock,
    wBlock: w.wBlock,
    hBlock: w.hBlock,
    isPlatformFlag: (w.isPlatformFlag ?? 0) as 0 | 1,
    platformEdge: (w.platformEdge ?? 0) as 0 | 1 | 2 | 3,
    blockTheme: w.blockTheme,
    rampOrientation: w.rampOrientation,
    isPillarHalfWidthFlag: (w.isPillarHalfWidthFlag ?? 0) as 0 | 1,
  }));

  const enemies: EditorEnemy[] = room.enemies.map(e => ({
    uid: uid++,
    xBlock: e.xBlock,
    yBlock: e.yBlock,
    kinds: e.kinds.map(k => particleKindToString(k)),
    particleCount: e.particleCount,
    isBossFlag: e.isBossFlag,
    isFlyingEyeFlag: (e.isFlyingEyeFlag ?? 0) as 0 | 1,
    isRollingEnemyFlag: (e.isRollingEnemyFlag ?? 0) as 0 | 1,
    rollingEnemySpriteIndex: e.rollingEnemySpriteIndex ?? 1,
    isRockElementalFlag: (e.isRockElementalFlag ?? 0) as 0 | 1,
    isRadiantTetherFlag: (e.isRadiantTetherFlag ?? 0) as 0 | 1,
    isGrappleHunterFlag: (e.isGrappleHunterFlag ?? 0) as 0 | 1,
    isSlimeFlag: (e.isSlimeFlag ?? 0) as 0 | 1,
    isLargeSlimeFlag: (e.isLargeSlimeFlag ?? 0) as 0 | 1,
    isWheelEnemyFlag: (e.isWheelEnemyFlag ?? 0) as 0 | 1,
    isBeetleFlag: (e.isBeetleFlag ?? 0) as 0 | 1,
    isBubbleEnemyFlag: (e.isBubbleEnemyFlag ?? 0) as 0 | 1,
    isIceBubbleFlag: (e.isIceBubbleFlag ?? 0) as 0 | 1,
    isSquareStampedeFlag: (e.isSquareStampedeFlag ?? 0) as 0 | 1,
    isGoldenMimicFlag: (e.isGoldenMimicFlag ?? 0) as 0 | 1,
    isGoldenMimicYFlippedFlag: (e.isGoldenMimicYFlippedFlag ?? 0) as 0 | 1,
  }));

  const transitions: EditorTransition[] = room.transitions.map(t => ({
    uid: uid++,
    direction: t.direction,
    positionBlock: t.positionBlock,
    openingSizeBlocks: t.openingSizeBlocks,
    targetRoomId: t.targetRoomId,
    targetSpawnBlock: [t.targetSpawnBlock[0], t.targetSpawnBlock[1]] as [number, number],
    fadeColor: t.fadeColor,
    depthBlock: t.depthBlock,
    isSecretDoor: t.isSecretDoor,
    gradientWidthBlocks: t.gradientWidthBlocks,
  }));

  const saveTombs: EditorSaveTomb[] = room.saveTombs.map(s => ({
    uid: uid++,
    xBlock: s.xBlock,
    yBlock: s.yBlock,
  }));

  const skillTombs: EditorSkillTomb[] = (room.skillTombs ?? []).map(s => ({
    uid: uid++,
    xBlock: s.xBlock,
    yBlock: s.yBlock,
    weaveId: s.weaveId,
  }));

  const dustContainers: EditorDustContainer[] = (room.dustContainers ?? []).map(c => ({
    uid: uid++,
    xBlock: c.xBlock,
    yBlock: c.yBlock,
  }));

  const dustContainerPieces: EditorDustContainerPiece[] = (room.dustContainerPieces ?? []).map(c => ({
    uid: uid++,
    xBlock: c.xBlock,
    yBlock: c.yBlock,
  }));

  const dustBoostJars: EditorDustBoostJar[] = (room.dustBoostJars ?? []).map(j => ({
    uid: uid++,
    xBlock: j.xBlock,
    yBlock: j.yBlock,
    dustKind: particleKindToString(j.dustKind),
    dustCount: j.dustCount,
  }));

  const dustPiles: EditorDustPile[] = (room.dustPiles ?? []).map(p => ({
    uid: uid++,
    xBlock: p.xBlock,
    yBlock: p.yBlock,
    dustCount: p.dustCount,
    spreadBlocks: p.spreadBlocks ?? 0,
  }));

  const grasshopperAreas: EditorGrasshopperArea[] = (room.grasshopperAreas ?? []).map(a => ({
    uid: uid++,
    xBlock: a.xBlock,
    yBlock: a.yBlock,
    wBlock: a.wBlock,
    hBlock: a.hBlock,
    count: a.count,
  }));

  const fireflyAreas: EditorFireflyArea[] = (room.fireflyAreas ?? []).map(a => ({
    uid: uid++,
    xBlock: a.xBlock,
    yBlock: a.yBlock,
    wBlock: a.wBlock,
    hBlock: a.hBlock,
    count: a.count,
  }));

  const decorations: EditorDecoration[] = (room.decorations ?? []).map(d => ({
    uid: uid++,
    xBlock: d.xBlock,
    yBlock: d.yBlock,
    kind: d.kind,
  }));

  const ambientLightBlockers: EditorAmbientLightBlocker[] = (room.ambientLightBlockers ?? []).map(b => ({
    uid: uid++,
    xBlock: b.xBlock,
    yBlock: b.yBlock,
    isDarkFlag: b.isDark ? 1 : 0,
  }));

  const lightSources: EditorLightSource[] = (room.lightSources ?? []).map(l => ({
    uid: uid++,
    xBlock: l.xBlock,
    yBlock: l.yBlock,
    radiusBlocks: l.radiusBlocks,
    colorR: l.colorR,
    colorG: l.colorG,
    colorB: l.colorB,
    brightnessPct: l.brightnessPct,
    dustMoteCount: l.dustMoteCount ?? 0,
    dustMoteSpreadBlocks: l.dustMoteSpreadBlocks ?? 0,
  }));

  const sunbeams: EditorSunbeam[] = (room.sunbeams ?? []).map(s => ({
    uid: uid++,
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

  const waterZones: EditorWaterZone[] = (room.waterZones ?? []).map(z => ({
    uid: uid++,
    xBlock: z.xBlock,
    yBlock: z.yBlock,
    wBlock: z.wBlock,
    hBlock: z.hBlock,
  }));

  const lavaZones: EditorLavaZone[] = (room.lavaZones ?? []).map(z => ({
    uid: uid++,
    xBlock: z.xBlock,
    yBlock: z.yBlock,
    wBlock: z.wBlock,
    hBlock: z.hBlock,
  }));

  const crumbleBlocks: EditorCrumbleBlock[] = (room.crumbleBlocks ?? []).map(b => ({
    uid: uid++,
    xBlock: b.xBlock,
    yBlock: b.yBlock,
    wBlock: b.wBlock ?? 1,
    hBlock: b.hBlock ?? 1,
    rampOrientation: b.rampOrientation,
    variant: b.variant ?? 'normal',
    blockTheme: b.blockTheme,
  }));

  const ropes: EditorRope[] = (room.ropes ?? []).map(r => ({
    uid: uid++,
    anchorAXBlock: r.anchorAXBlock,
    anchorAYBlock: r.anchorAYBlock,
    anchorBXBlock: r.anchorBXBlock,
    anchorBYBlock: r.anchorBYBlock,
    segmentCount: r.segmentCount ?? DEFAULT_ROPE_SEGMENT_COUNT,
    isAnchorBFixedFlag: (r.isAnchorBFixed !== false ? 1 : 0) as 0 | 1,
    destructibility: r.destructibility ?? 'indestructible',
    thicknessIndex: (r.thicknessIndex ?? 0) as 0 | 1 | 2,
  }));

  const fallingBlocks: EditorFallingBlock[] = (room.fallingBlocks ?? []).map(fb => ({
    uid: uid++,
    xBlock: fb.xBlock,
    yBlock: fb.yBlock,
    variant: fb.variant,
  }));

  const dialogueTriggers: EditorDialogueTrigger[] = (room.dialogueTriggers ?? []).map(dt => ({
    uid: uid++,
    xBlock: dt.xBlock,
    yBlock: dt.yBlock,
    wBlock: dt.wBlock,
    hBlock: dt.hBlock,
    conversationId: dt.conversation.id,
    conversationTitle: dt.conversation.title ?? '',
    entries: (dt.conversation.entries ?? []).map(e => ({
      text: e.text,
      portraitId: e.portraitId,
      portraitSide: e.portraitSide,
    })),
  }));

  return {
    data: {
      id: room.id,
      name: room.name,
      worldNumber: room.worldNumber,
      mapX: room.mapX,
      mapY: room.mapY,
      blockTheme: room.blockTheme ?? 'blackRock',
      backgroundId: room.backgroundId ?? 'brownRock',
      lightingEffect: room.lightingEffect ?? 'Ambient',
      ambientLightDirection: room.ambientLightDirection,
      songId: room.songId ?? '_continue',
      widthBlocks: room.widthBlocks,
      heightBlocks: room.heightBlocks,
      playerSpawnBlock: [room.playerSpawnBlock[0], room.playerSpawnBlock[1]],
      interiorWalls,
      enemies,
      transitions,
      saveTombs,
      skillTombs,
      dustContainers,
      dustContainerPieces,
      dustBoostJars,
      dustPiles,
      grasshopperAreas,
      fireflyAreas,
      decorations,
      ambientLightBlockers,
      lightSources,
      waterZones,
      lavaZones,
      crumbleBlocks,
      ropes,
      sunbeams,
      fallingBlocks,
      dialogueTriggers,
    },
    nextUid: uid,
  };
}
