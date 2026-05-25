/**
 * editorRoomImporter.ts — RoomDef → EditorRoomData conversion.
 *
 * Extracted from editorRoomBuilder.ts to separate the two conversion directions:
 *   editorRoomBuilder.ts  — EditorRoomData → RoomDef (runtime "export" direction)
 *   editorRoomImporter.ts — RoomDef → EditorRoomData (editor "import" direction)
 *
 * The public API is the single `roomDefToEditorRoomData` function, which is
 * re-exported from editorRoomBuilder.ts so existing callers are unaffected.
 */

import type { RoomDef, RoomWallDef, RoomTransitionDef } from '../levels/roomDef';
import { DEFAULT_ROPE_SEGMENT_COUNT } from '../levels/roomDef';
import type {
  EditorRoomData,
  EditorEnemy,
  EditorWall,
  EditorTransition,
  EditorSaveTomb,
  EditorSkillTomb,
  EditorDustContainer,
  EditorDustContainerPiece,
  EditorDustBoostJar,
  EditorDustSwarm,
  EditorLambdaAnchor,
  EditorDustPile,
  EditorGrasshopperArea,
  EditorFireflyArea,
  EditorDecoration,
  EditorAmbientLightBlocker,
  EditorLightSource,
  EditorSunbeam,
  EditorWaterZone,
  EditorLavaZone,
  EditorCrumbleBlock,
  EditorRope,
  EditorFallingBlock,
  EditorDialogueTrigger,
  EditorSceneLight,
  EditorGuideDustPath,
} from './editorState';
import { particleKindToString } from './roomJsonSchema';

// ── Private helpers ───────────────────────────────────────────────────────────

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

// ── Public API ────────────────────────────────────────────────────────────────

export function roomDefToEditorRoomData(room: RoomDef, startUid: number): { data: EditorRoomData; nextUid: number } {
  let uid = startUid;

  // Split every interior wall rectangle into individual 1×1 block tiles.
  // This ensures that rooms loaded from compact/dehydrated storage (where walls
  // are stored as large merged rectangles) appear in the editor as individually
  // editable tiles.  When the room is exported/saved, editorRoomDataToRoomDef
  // re-assembles them into compact wall rects via the normal serialisation path.
  //
  // Special cases that should NOT be split into 1×1 tiles:
  //   • Ramps (rampOrientation set) — they represent a triangle block, not a rect.
  //   • Half-width pillars (isPillarHalfWidthFlag) — single-column elements.
  //   • Platforms (isPlatformFlag) — keep their original width for natural editing.
  const interiorWalls: EditorWall[] = [];
  for (const w of extractInteriorWalls(room)) {
    const shouldExpand =
      w.rampOrientation == null &&
      (w.isPillarHalfWidthFlag ?? 0) === 0 &&
      (w.isPlatformFlag ?? 0) === 0 &&
      (w.wBlock > 1 || w.hBlock > 1);

    if (shouldExpand) {
      // Expand the rectangle into individual 1×1 tiles.
      for (let dy = 0; dy < w.hBlock; dy++) {
        for (let dx = 0; dx < w.wBlock; dx++) {
          interiorWalls.push({
            uid: uid++,
            xBlock: w.xBlock + dx,
            yBlock: w.yBlock + dy,
            wBlock: 1,
            hBlock: 1,
            isPlatformFlag: 0,
            platformEdge: (w.platformEdge ?? 0) as 0 | 1 | 2 | 3,
            blockTheme: w.blockTheme,
            rampOrientation: undefined,
            isPillarHalfWidthFlag: 0,
          });
        }
      }
    } else {
      interiorWalls.push({
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
      });
    }
  }

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
    isRadiantWebFlag: (e.isRadiantWebFlag ?? 0) as 0 | 1,
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
      longTransition: t.longTransition,
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

  const sceneLights: EditorSceneLight[] = (room.sceneLights ?? []).map(l => ({
    uid: uid++,
    ...l,
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

  const guideDustPaths: EditorGuideDustPath[] = (room.guideDustPaths ?? []).map(p => ({
    uid: uid++,
    points: p.points.map(pt => ({ xBlock: pt.xBlock, yBlock: pt.yBlock, speed: pt.speed ?? 1.0 })),
    loop: p.loop,
    visibleInGame: p.visibleInGame,
    moteCount: p.moteCount,
    moteSpeedFactor: p.moteSpeedFactor,
    opacityPct: p.opacityPct,
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
      directionalBias:       room.directionalBias,
      sideExposureStrength:  room.sideExposureStrength,
      minimumWallLight:      room.minimumWallLight,
      falloffPower:          room.falloffPower,
      backgroundLightSpill:  room.backgroundLightSpill,
      solidLightSoftness:    room.solidLightSoftness,
      blockSeamBlending:     room.blockSeamBlending,
      voidEdgeStyle:         room.voidEdgeStyle,
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
      sceneLights,
      fallingBlocks,
      dialogueTriggers,
      guideDustPaths,
    },
    nextUid: uid,
  };
}
