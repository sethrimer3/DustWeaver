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
  EditorDustContainer, EditorDustContainerPiece, EditorDustBoostJar, EditorDustSwarm,
  EditorLambdaAnchor,
  EditorFallingBlock, EditorDialogueTrigger,
} from './editorState';
import { particleKindToString, stringToParticleKind } from './roomJsonSchema';

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
    xBlock: t.xBlock,
    yBlock: t.yBlock,
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
 * Migrates a legacy RoomTransitionDef's xBlock from positionBlock/depthBlock.
 * Called when the RoomTransitionDef was created before the xBlock field existed.
 */
function migrateRoomDefTransitionXBlock(t: RoomTransitionDef, roomWidthBlocks: number): number {
  const gw = t.gradientWidthBlocks ?? 3;
  if (t.direction === 'left')  return t.depthBlock ?? 0;
  if (t.direction === 'right') return t.depthBlock ?? (roomWidthBlocks - gw);
  return t.positionBlock; // up/down: xBlock = positionBlock
}

function migrateRoomDefTransitionYBlock(t: RoomTransitionDef, roomHeightBlocks: number): number {
  const gw = t.gradientWidthBlocks ?? 3;
  if (t.direction === 'up')   return t.depthBlock ?? 0;
  if (t.direction === 'down') return t.depthBlock ?? (roomHeightBlocks - gw);
  return t.positionBlock; // left/right: yBlock = positionBlock
}

/**
 * Extracts interior walls from a RoomDef by removing regenerated boundary/tunnel walls.
 * This is a heuristic: boundary walls are at edges (x=0, x=w-1, y=0, y=h-1) and
 * tunnel walls extend past room boundaries (negative coordinates or past room width).
 */
function extractInteriorWalls(room: RoomDef): RoomWallDef[] {
  const interior: RoomWallDef[] = [];
  for (const w of room.walls) {
    // Boundary/tunnel walls are marked invisible — skip them.
    // User-placed interior walls are never invisible, even when placed at room edges.
    if (w.isInvisibleFlag === 1) continue;
    // Also skip anything genuinely out of bounds (defensive check).
    if (w.xBlock < 0 || w.yBlock < 0 ||
        w.xBlock + w.wBlock > room.widthBlocks ||
        w.yBlock + w.hBlock > room.heightBlocks) continue;
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

  const transitions: EditorTransition[] = room.transitions.map(t => {
    // Prefer explicit xBlock/yBlock when present (new format), otherwise migrate.
    const xBlock = t.xBlock !== undefined ? t.xBlock : migrateRoomDefTransitionXBlock(t, room.widthBlocks);
    const yBlock = t.yBlock !== undefined ? t.yBlock : migrateRoomDefTransitionYBlock(t, room.heightBlocks);
    return {
      uid: uid++,
      direction: t.direction,
      xBlock,
      yBlock,
      openingSizeBlocks: t.openingSizeBlocks,
      targetRoomId: t.targetRoomId,
      targetSpawnBlock: [t.targetSpawnBlock[0], t.targetSpawnBlock[1]] as [number, number],
      fadeColor: t.fadeColor,
      depthBlock: t.depthBlock,
      isSecretDoor: t.isSecretDoor,
      gradientWidthBlocks: t.gradientWidthBlocks,
      positionBlock: t.positionBlock,
    };
  });

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

  const dustSwarms: EditorDustSwarm[] = (room.dustSwarms ?? []).map(s => ({
    uid: uid++,
    xBlock: s.xBlock,
    yBlock: s.yBlock,
    dustKind: s.dustKind,
    dustCount: s.dustCount,
  }));

  const lambdaAnchors: EditorLambdaAnchor[] = (room.lambdaAnchors ?? []).map(a => ({
    uid: uid++,
    xBlock: a.xBlock,
    yBlock: a.yBlock,
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
      dustSwarms,
      lambdaAnchors,
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
