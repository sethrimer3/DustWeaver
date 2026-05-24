/**
 * Room JSON conversion — validation, song-ID helpers, and bidirectional
 * conversions between RoomJsonDef and EditorRoomData.
 *
 * JSON schema type definitions (interfaces) and the ParticleKind string↔enum
 * mapping live in roomJsonSchema.ts.
 *
 * Conversions between EditorRoomData and RoomDef (the runtime representation)
 * live in editorRoomBuilder.ts.
 *
 * Serialization (EditorRoomData → RoomJsonDef) lives in roomJsonSerializer.ts.
 */

import type { BlockTheme } from '../levels/roomDef';
import { blockThemeRefToTheme, DEFAULT_ROPE_SEGMENT_COUNT } from '../levels/roomDef';
import type {
  EditorRoomData, EditorEnemy, EditorTransition, EditorWall,
  EditorSaveTomb, EditorSkillTomb, EditorDustPile,
  EditorGrasshopperArea, EditorFireflyArea, EditorDecoration,
  EditorAmbientLightBlocker, EditorLightSource, EditorSunbeam,
  EditorWaterZone, EditorLavaZone, EditorCrumbleBlock, EditorBouncePad, EditorKineticBlock,
  EditorRope, RopeDestructibility,
  EditorDustContainer, EditorDustContainerPiece, EditorDustBoostJar, EditorDustSwarm,
  EditorLambdaAnchor,
  EditorFallingBlock, EditorDialogueTrigger, EditorBackgroundBlock, EditorSceneLight,
  EditorGuideDustPath,
  RoomSongId,
} from './editorState';
import { AVAILABLE_SONGS } from '../audio/musicManager';
import {
  stringToParticleKind,
} from './roomJsonSchema';
import { savedToLightDef } from '../levels/lightingSchema';
export { editorRoomDataToJson } from './roomJsonSerializer';
import type {
  RoomJsonDef,
  RoomJsonWall,
  RoomJsonTransition,
  ValidationError,
} from './roomJsonSchema';
export {
  particleKindToString,
  stringToParticleKind,
} from './roomJsonSchema';
export type {
  ValidationError,
  RoomJsonDef,
  RoomJsonEnemy,
  RoomJsonWall,
  RoomJsonTransition,
  RoomJsonSkillTomb,
  RoomJsonDustSkillTomb,
  RoomJsonSpike,
  RoomJsonSpringboard,
  RoomJsonZone,
  RoomJsonBreakableBlock,
  RoomJsonCrumbleBlock,
  RoomJsonBouncePad,
  RoomJsonDustBoostJar,
  RoomJsonDustSwarm,
  RoomJsonLambdaAnchor,
  RoomJsonFireflyJar,
  RoomJsonDustPile,
  RoomJsonGrasshopperArea,
  RoomJsonFireflyArea,
  RoomJsonDecoration,
  RoomJsonAmbientLightBlocker,
  RoomJsonLightSource,
  RoomJsonSunbeam,
  RoomJsonFallingBlock,
  RoomJsonDialogueTrigger,
  RoomJsonConversation,
  RoomJsonDialogueEntry,
  RoomJsonBackgroundBlock,
} from './roomJsonSchema';

export function validateRoomJson(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (typeof data !== 'object' || data === null) {
    errors.push({ path: '', message: 'Root must be a non-null object' });
    return errors;
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    errors.push({ path: 'id', message: 'Must be a non-empty string' });
  }
  if (typeof obj.name !== 'string') {
    errors.push({ path: 'name', message: 'Must be a string' });
  }
  if (typeof obj.worldNumber !== 'number') {
    errors.push({ path: 'worldNumber', message: 'Must be a number' });
  }
  if (obj.mapX !== undefined && typeof obj.mapX !== 'number') {
    errors.push({ path: 'mapX', message: 'Must be a number when provided' });
  }
  if (obj.mapY !== undefined && typeof obj.mapY !== 'number') {
    errors.push({ path: 'mapY', message: 'Must be a number when provided' });
  }
  if (obj.lightingEffect !== undefined) {
    const v = obj.lightingEffect;
    if (v !== 'Ambient' && v !== 'DarkRoom' && v !== 'FullyLit' && v !== 'DEFAULT' && v !== 'Above') {
      errors.push({ path: 'lightingEffect', message: 'Must be Ambient|DarkRoom|FullyLit (legacy DEFAULT|Above also accepted)' });
    }
  }
  if (typeof obj.widthBlocks !== 'number' || (obj.widthBlocks as number) < 10) {
    errors.push({ path: 'widthBlocks', message: 'Must be a number >= 10' });
  }
  if (typeof obj.heightBlocks !== 'number' || (obj.heightBlocks as number) < 10) {
    errors.push({ path: 'heightBlocks', message: 'Must be a number >= 10' });
  }

  if (!Array.isArray(obj.playerSpawnBlock) || obj.playerSpawnBlock.length !== 2) {
    errors.push({ path: 'playerSpawnBlock', message: 'Must be [x, y] array' });
  }

  if (Array.isArray(obj.enemies)) {
    for (let i = 0; i < obj.enemies.length; i++) {
      const e = obj.enemies[i] as Record<string, unknown>;
      if (!Array.isArray(e.kinds)) {
        errors.push({ path: `enemies[${i}].kinds`, message: 'Must be an array of particle kind strings' });
      } else {
        for (let k = 0; k < e.kinds.length; k++) {
          if (stringToParticleKind(e.kinds[k] as string) === null) {
            errors.push({ path: `enemies[${i}].kinds[${k}]`, message: `Unknown particle kind: "${e.kinds[k]}"` });
          }
        }
      }
    }
  }

  if (Array.isArray(obj.transitions)) {
    for (let i = 0; i < obj.transitions.length; i++) {
      const t = obj.transitions[i] as Record<string, unknown>;
      if (!['left', 'right', 'up', 'down'].includes(t.direction as string)) {
        errors.push({ path: `transitions[${i}].direction`, message: 'Must be left|right|up|down' });
      }
      if (typeof t.targetRoomId !== 'string') {
        errors.push({ path: `transitions[${i}].targetRoomId`, message: 'Must be a string' });
      }
    }
  }

  return errors;
}

// ── Song ID helpers ───────────────────────────────────────────────────────────

const VALID_SONG_IDS: ReadonlySet<string> = new Set<string>([
  '_continue', '_silence', ...AVAILABLE_SONGS,
]);

/**
 * Parse a raw string from JSON into a RoomSongId.
 * Unknown strings fall back to '_continue' with a console warning.
 */
export function parseSongId(raw: string | undefined): RoomSongId {
  if (raw === undefined) return '_continue';
  if (VALID_SONG_IDS.has(raw)) return raw as RoomSongId;
  console.warn(`[roomJson] Unknown songId "${raw}" — falling back to "_continue".`);
  return '_continue';
}

function resolveJsonBlockTheme(
  blockTheme: BlockTheme | undefined,
  blockThemeId: RoomJsonDef['blockThemeId'] | RoomJsonWall['blockThemeId'] | undefined,
): BlockTheme | undefined {
  return blockThemeRefToTheme(blockThemeId) ?? blockThemeRefToTheme(blockTheme);
}

/**
 * Migrates legacy positionBlock / depthBlock into the new xBlock / yBlock model.
 * If the JSON already carries xBlock and yBlock, those values are used directly.
 */
function migrateTransitionPosition(
  t: RoomJsonTransition,
  roomWidthBlocks: number,
  roomHeightBlocks: number,
): { xBlock: number; yBlock: number } {
  if (t.xBlock !== undefined && t.yBlock !== undefined) {
    return { xBlock: t.xBlock, yBlock: t.yBlock };
  }
  const gw = t.gradientWidthBlocks ?? 3;
  switch (t.direction) {
    case 'left':  return { xBlock: t.depthBlock ?? 0,                          yBlock: t.positionBlock };
    case 'right': return { xBlock: t.depthBlock ?? (roomWidthBlocks  - gw),    yBlock: t.positionBlock };
    case 'up':    return { xBlock: t.positionBlock, yBlock: t.depthBlock ?? 0                          };
    case 'down':  return { xBlock: t.positionBlock, yBlock: t.depthBlock ?? (roomHeightBlocks - gw)   };
  }
}

export function jsonToEditorRoomData(json: RoomJsonDef, startUid: number): { data: EditorRoomData; nextUid: number } {
  let uid = startUid;

  const interiorWalls: EditorWall[] = json.interiorWalls.map(w => ({
    uid: uid++,
    xBlock: w.xBlock,
    yBlock: w.yBlock,
    wBlock: w.wBlock,
    hBlock: w.hBlock,
    isPlatformFlag: w.isPlatform ? 1 : 0,
    platformEdge: w.platformEdge ?? 0,
    blockTheme: resolveJsonBlockTheme(w.blockTheme, w.blockThemeId),
    soundHardness: w.soundHardness,
    rampOrientation: w.rampOrientation,
    isPillarHalfWidthFlag: w.isPillarHalfWidth ? 1 : 0,
  }));

  const enemies: EditorEnemy[] = json.enemies.map(e => ({
    uid: uid++,
    xBlock: e.xBlock,
    yBlock: e.yBlock,
    kinds: e.kinds,
    particleCount: e.particleCount,
    isBossFlag: e.isBoss ? 1 : 0,
    isFlyingEyeFlag: e.isFlyingEye ? 1 : 0,
    isRollingEnemyFlag: e.isRollingEnemy ? 1 : 0,
    rollingEnemySpriteIndex: e.rollingEnemySpriteIndex ?? 1,
    isRockElementalFlag: e.isRockElemental ? 1 : 0,
    isRadiantTetherFlag: e.isRadiantTether ? 1 : 0,
    isRadiantWebFlag: e.isRadiantWeb ? 1 : 0,
    isGrappleHunterFlag: e.isGrappleHunter ? 1 : 0,
    isSlimeFlag: (e.isSlime ?? false) ? 1 : 0,
    isLargeSlimeFlag: (e.isLargeSlime ?? false) ? 1 : 0,
    isWheelEnemyFlag: (e.isWheelEnemy ?? false) ? 1 : 0,
    isBeetleFlag: (e.isBeetle ?? false) ? 1 : 0,
    isBubbleEnemyFlag: (e.isBubbleEnemy ?? false) ? 1 : 0,
    isIceBubbleFlag: (e.isIceBubble ?? false) ? 1 : 0,
    isSquareStampedeFlag: (e.isSquareStampede ?? false) ? 1 : 0,
    isGoldenMimicFlag: (e.isGoldenMimic ?? false) ? 1 : 0,
    isGoldenMimicYFlippedFlag: (e.isGoldenMimicYFlipped ?? false) ? 1 : 0,
    isBeeSwarmFlag: (e.isBeeSwarm ?? false) ? 1 : 0,
    isWebSpiderFlag: (e.isWebSpider ?? false) ? 1 : 0,
    isDustConstellationFlag: (e.isDustConstellation ?? false) ? 1 : 0,
    isDustConstellationLargeFlag: (e.isDustConstellationLarge ?? false) ? 1 : 0,
    isOrbitalDustCoreFlag: (e.isOrbitalDustCore ?? false) ? 1 : 0,
    isOrbitalDustCoreLargeFlag: (e.isOrbitalDustCoreLarge ?? false) ? 1 : 0,
    isVoidSingularityFlag: (e.isVoidSingularity ?? false) ? 1 : 0,
    isVoidSingularityPairFlag: (e.isVoidSingularityPair ?? false) ? 1 : 0,
  }));

  const transitions: EditorTransition[] = json.transitions.map(t => {
    const { xBlock, yBlock } = migrateTransitionPosition(t, json.widthBlocks, json.heightBlocks);
    return {
      uid: uid++,
      direction: t.direction,
      xBlock,
      yBlock,
      openingSizeBlocks: t.openingSizeBlocks,
      targetRoomId: t.targetRoomId,
      targetSpawnBlock: [...t.targetSpawnBlock] as [number, number],
      fadeColor: t.fadeColor,
      isSecretDoor: t.isSecretDoor,
      gradientWidthBlocks: t.gradientWidthBlocks,
      longTransition: t.longTransition,
      // Legacy backward-compat fields:
      positionBlock: t.positionBlock,
      depthBlock: t.depthBlock,
    };
  });

  const saveTombs: EditorSaveTomb[] = json.skillTombs.map(s => ({
    uid: uid++,
    xBlock: s.xBlock,
    yBlock: s.yBlock,
  }));

  const skillTombs: EditorSkillTomb[] = [
    ...(json.dustSkillTombs ?? []).map(s => ({
      uid: uid++,
      xBlock: s.xBlock,
      yBlock: s.yBlock,
      weaveId: s.weaveId,
    })),
    // Legacy: skill books are unified with skill tombs — load them in.
    ...(json.skillBooks ?? []).filter(s => !!(s as unknown as Record<string, unknown>)['weaveId']).map(s => ({
      uid: uid++,
      xBlock: s.xBlock,
      yBlock: s.yBlock,
      weaveId: (s as unknown as Record<string, unknown>)['weaveId'] as string,
    })),
  ];

  const dustContainers: EditorDustContainer[] = (json.dustContainers ?? []).map(container => ({
    uid: uid++,
    xBlock: container.xBlock,
    yBlock: container.yBlock,
  }));

  const dustContainerPieces: EditorDustContainerPiece[] = (json.dustContainerPieces ?? []).map(piece => ({
    uid: uid++,
    xBlock: piece.xBlock,
    yBlock: piece.yBlock,
  }));

  const dustBoostJars: EditorDustBoostJar[] = (json.dustBoostJars ?? []).map(j => ({
    uid: uid++,
    xBlock: j.xBlock,
    yBlock: j.yBlock,
    dustKind: j.dustKind,
    dustCount: j.dustCount,
  }));

  const dustSwarms: EditorDustSwarm[] = (json.dustSwarms ?? []).map(s => ({
    uid: uid++,
    xBlock: s.xBlock,
    yBlock: s.yBlock,
    dustKind: s.dustKind,
    dustCount: s.dustCount,
  }));

  const lambdaAnchors: EditorLambdaAnchor[] = (json.lambdaAnchors ?? []).map(a => ({
    uid: uid++,
    xBlock: a.xBlock,
    yBlock: a.yBlock,
  }));

  const dustPiles: EditorDustPile[] = (json.dustPiles ?? []).map(p => ({
    uid: uid++,
    xBlock: p.xBlock,
    yBlock: p.yBlock,
    dustCount: p.dustCount,
    spreadBlocks: p.spreadBlocks ?? 0,
  }));

  const grasshopperAreas: EditorGrasshopperArea[] = (json.grasshopperAreas ?? []).map(a => ({
    uid: uid++,
    xBlock: a.xBlock,
    yBlock: a.yBlock,
    wBlock: a.wBlock,
    hBlock: a.hBlock,
    count: a.count,
  }));

  const fireflyAreas: EditorFireflyArea[] = (json.fireflyAreas ?? []).map(a => ({
    uid: uid++,
    xBlock: a.xBlock,
    yBlock: a.yBlock,
    wBlock: a.wBlock,
    hBlock: a.hBlock,
    count: a.count,
  }));

  const decorations: EditorDecoration[] = (json.decorations ?? []).map(d => ({
    uid: uid++,
    xBlock: d.xBlock,
    yBlock: d.yBlock,
    kind: d.kind,
  }));

  const ambientLightBlockers: EditorAmbientLightBlocker[] = (json.ambientLightBlockers ?? []).map(b => ({
    uid: uid++,
    xBlock: b.xBlock,
    yBlock: b.yBlock,
    isDarkFlag: b.isDark ? 1 : 0,
  }));

  const lightSources: EditorLightSource[] = (json.lightSources ?? []).map(l => ({
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

  const sunbeams: EditorSunbeam[] = (json.sunbeams ?? []).map(s => ({
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

  const sceneLights: EditorSceneLight[] = (json.sceneLights ?? []).map(s => ({
    uid: uid++,
    ...savedToLightDef(s),
  }));

  const fallingBlocks: EditorFallingBlock[] = (json.fallingBlocks ?? []).map(fb => ({
    uid: uid++,
    xBlock: fb.xBlock,
    yBlock: fb.yBlock,
    variant: (fb.variant ?? 'tough') as import('../levels/roomDef').FallingBlockVariant,
  }));

  const waterZones: EditorWaterZone[] = (json.waterZones ?? []).map(z => ({
    uid: uid++,
    xBlock: z.xBlock,
    yBlock: z.yBlock,
    wBlock: z.wBlock,
    hBlock: z.hBlock,
  }));

  const lavaZones: EditorLavaZone[] = (json.lavaZones ?? []).map(z => ({
    uid: uid++,
    xBlock: z.xBlock,
    yBlock: z.yBlock,
    wBlock: z.wBlock,
    hBlock: z.hBlock,
  }));

  const crumbleBlocks: EditorCrumbleBlock[] = (json.crumbleBlocks ?? []).map(b => ({
    uid: uid++,
    xBlock: b.xBlock,
    yBlock: b.yBlock,
    wBlock: b.wBlock ?? 1,
    hBlock: b.hBlock ?? 1,
    rampOrientation: b.rampOrientation,
    variant: b.variant ?? 'normal',
    blockTheme: resolveJsonBlockTheme(b.blockTheme, b.blockThemeId),
  }));

  const bouncePads: EditorBouncePad[] = (json.bouncePads ?? []).map(b => ({
    uid: uid++,
    xBlock: b.xBlock,
    yBlock: b.yBlock,
    wBlock: b.wBlock ?? 1,
    hBlock: b.hBlock ?? 1,
    rampOrientation: b.rampOrientation,
    speedFactorIndex: (b.speedFactorIndex ?? 0) as 0 | 1,
  }));

  const kineticBlocks: EditorKineticBlock[] = (json.kineticBlocks ?? []).map(kb => ({
    uid: uid++,
    xBlock: kb.xBlock,
    yBlock: kb.yBlock,
    wBlock: kb.wBlock ?? 1,
    hBlock: kb.hBlock ?? 1,
  }));

  const ropes: EditorRope[] = (json.ropes ?? []).map(r => ({
    uid: uid++,
    anchorAXBlock: r.aax,
    anchorAYBlock: r.aay,
    anchorBXBlock: r.abx,
    anchorBYBlock: r.aby,
    segmentCount: r.segs ?? DEFAULT_ROPE_SEGMENT_COUNT,
    isAnchorBFixedFlag: (r.fixed !== false ? 1 : 0) as 0 | 1,
    destructibility: (r.destr ?? 'indestructible') as RopeDestructibility,
    thicknessIndex: (r.thick === 1 ? 1 : r.thick === 2 ? 2 : 0) as 0 | 1 | 2,
  }));

  const dialogueTriggers: EditorDialogueTrigger[] = (json.dialogueTriggers ?? []).map(dt => ({
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

  const backgroundBlocks: EditorBackgroundBlock[] = (json.backgroundBlocks ?? []).map(b => ({
    uid: uid++,
    xBlock: b.xBlock,
    yBlock: b.yBlock,
    wBlock: b.wBlock,
    hBlock: b.hBlock,
    blockTheme: b.blockTheme ?? null,
    isLightBlockingFlag: b.isLightBlocking ? 1 : 0,
  }));

  const guideDustPaths: EditorGuideDustPath[] = (json.guideDustPaths ?? []).map(p => ({
    uid: uid++,
    points: (p.points ?? []).map(pt => ({ xBlock: pt.xBlock, yBlock: pt.yBlock, speed: pt.speed ?? 1.0 })),
    loop: p.loop ?? false,
    visibleInGame: p.visibleInGame !== false,
    moteCount: p.moteCount ?? 8,
    moteSpeedFactor: p.moteSpeedFactor ?? 1.0,
    opacityPct: p.opacityPct ?? 100,
  }));

  return {
    data: {
      id: json.id,
      name: json.name,
      worldNumber: json.worldNumber,
      mapX: json.mapX ?? 0,
      mapY: json.mapY ?? 0,
      blockTheme: resolveJsonBlockTheme(json.blockTheme, json.blockThemeId) ?? 'blackRock',
      backgroundId: json.backgroundId ?? 'brownRock',
      lightingEffect: json.lightingEffect ?? 'Ambient',
      ambientLightDirection: json.ambientLightDirection,
      directionalBias:       json.directionalBias,
      sideExposureStrength:  json.sideExposureStrength,
      minimumWallLight:      json.minimumWallLight,
      falloffPower:          json.falloffPower,
      songId: parseSongId(json.songId),
      widthBlocks: json.widthBlocks,
      heightBlocks: json.heightBlocks,
      playerSpawnBlock: [...json.playerSpawnBlock] as [number, number],
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
      bouncePads,
      kineticBlocks,
      ropes,
      sunbeams,
      sceneLights,
      fallingBlocks,
      dialogueTriggers,
      backgroundBlocks,
      guideDustPaths,
    },
    nextUid: uid,
  };
}
