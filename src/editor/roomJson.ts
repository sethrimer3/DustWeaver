/**
 * Room JSON conversion — validation, song-ID helpers, and bidirectional
 * conversions between RoomJsonDef and EditorRoomData.
 *
 * JSON schema type definitions (interfaces) and the ParticleKind string↔enum
 * mapping live in roomJsonSchema.ts.
 *
 * Conversions between EditorRoomData and RoomDef (the runtime representation)
 * live in editorRoomBuilder.ts.
 */

import type { BlockTheme } from '../levels/roomDef';
import { blockThemeRefToTheme, blockThemeToId, DEFAULT_ROPE_SEGMENT_COUNT } from '../levels/roomDef';
import type {
  EditorRoomData, EditorEnemy, EditorTransition, EditorWall,
  EditorSaveTomb, EditorSkillTomb, EditorDustPile,
  EditorGrasshopperArea, EditorFireflyArea, EditorDecoration,
  EditorAmbientLightBlocker, EditorLightSource, EditorSunbeam,
  EditorWaterZone, EditorLavaZone, EditorCrumbleBlock, EditorBouncePad,
  EditorRope, RopeDestructibility,
  EditorDustContainer, EditorDustContainerPiece, EditorDustBoostJar,
  EditorFallingBlock, EditorDialogueTrigger,
  RoomSongId,
} from './editorState';
import { AVAILABLE_SONGS } from '../audio/musicManager';
import {
  stringToParticleKind,
} from './roomJsonSchema';
import type {
  RoomJsonDef,
  RoomJsonWall,
  RoomJsonTransition,
  RoomJsonAmbientLightBlocker,
  RoomJsonLightSource,
  RoomJsonRope,
  RoomJsonDialogueTrigger,
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

// ── Conversion: RoomJsonDef → EditorRoomData ─────────────────────────────────

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
  }));

  const transitions: EditorTransition[] = json.transitions.map(t => ({
    uid: uid++,
    direction: t.direction,
    positionBlock: t.positionBlock,
    openingSizeBlocks: t.openingSizeBlocks,
    targetRoomId: t.targetRoomId,
    targetSpawnBlock: [...t.targetSpawnBlock] as [number, number],
    fadeColor: t.fadeColor,
    depthBlock: t.depthBlock,
    isSecretDoor: t.isSecretDoor,
    gradientWidthBlocks: t.gradientWidthBlocks,
  }));

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
      ropes,
      sunbeams,
      fallingBlocks,
      dialogueTriggers,
    },
    nextUid: uid,
  };
}

// ── Conversion: EditorRoomData → RoomJsonDef ─────────────────────────────────

export function editorRoomDataToJson(data: EditorRoomData): RoomJsonDef {
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
      if (w.isPillarHalfWidthFlag === 1) wall.isPillarHalfWidth = true;
      return wall;
    }),
    enemies: data.enemies.map(e => ({
      xBlock: e.xBlock,
      yBlock: e.yBlock,
      kinds: [...e.kinds],
      particleCount: e.particleCount,
      isBoss: e.isBossFlag === 1,
      isFlyingEye: e.isFlyingEyeFlag === 1,
      isRollingEnemy: e.isRollingEnemyFlag === 1,
      rollingEnemySpriteIndex: e.isRollingEnemyFlag === 1 ? e.rollingEnemySpriteIndex : undefined,
      isRockElemental: e.isRockElementalFlag === 1,
      isRadiantTether: e.isRadiantTetherFlag === 1,
      isGrappleHunter: e.isGrappleHunterFlag === 1,
      isSlime: e.isSlimeFlag === 1,
      isLargeSlime: e.isLargeSlimeFlag === 1,
      isWheelEnemy: e.isWheelEnemyFlag === 1,
      isBeetle: e.isBeetleFlag === 1,
      isBubbleEnemy: e.isBubbleEnemyFlag === 1,
      isIceBubble: e.isIceBubbleFlag === 1,
      isSquareStampede: e.isSquareStampedeFlag === 1,
      isGoldenMimic: e.isGoldenMimicFlag === 1,
      isGoldenMimicYFlipped: e.isGoldenMimicYFlippedFlag === 1,
      isBeeSwarm: e.isBeeSwarmFlag === 1,
    })),
    transitions: data.transitions.map(t => {
      const jt: RoomJsonTransition = {
        direction: t.direction,
        positionBlock: t.positionBlock,
        openingSizeBlocks: t.openingSizeBlocks,
        targetRoomId: t.targetRoomId,
        targetSpawnBlock: [...t.targetSpawnBlock],
      };
      if (t.fadeColor) jt.fadeColor = t.fadeColor;
      if (t.depthBlock !== undefined) jt.depthBlock = t.depthBlock;
      if (t.isSecretDoor) jt.isSecretDoor = t.isSecretDoor;
      if (t.gradientWidthBlocks !== undefined) jt.gradientWidthBlocks = t.gradientWidthBlocks;
      return jt;
    }),
    skillTombs: data.saveTombs.map(s => ({
      xBlock: s.xBlock,
      yBlock: s.yBlock,
    })),
  };
  // Always write blockTheme and backgroundId when present
  if (data.blockTheme) {
    json.blockTheme = data.blockTheme;
    json.blockThemeId = blockThemeToId(data.blockTheme);
  }
  if (data.backgroundId) json.backgroundId = data.backgroundId;
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
  if ((data.crumbleBlocks ?? []).length > 0) {
    json.crumbleBlocks = (data.crumbleBlocks ?? []).map(b => {
      const entry: import('./roomJsonSchema').RoomJsonCrumbleBlock = {
        xBlock: b.xBlock,
        yBlock: b.yBlock,
      };
      if (b.wBlock !== 1) entry.wBlock = b.wBlock;
      if (b.hBlock !== 1) entry.hBlock = b.hBlock;
      if (b.rampOrientation !== undefined) entry.rampOrientation = b.rampOrientation;
      if (b.variant !== 'normal') entry.variant = b.variant;
      if (b.blockTheme !== undefined) {
        entry.blockTheme = b.blockTheme;
        entry.blockThemeId = blockThemeToId(b.blockTheme);
      }
      return entry;
    });
  }
  if ((data.bouncePads ?? []).length > 0) {
    json.bouncePads = (data.bouncePads ?? []).map(b => {
      const entry: import('./roomJsonSchema').RoomJsonBouncePad = {
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
  if ((data.fallingBlocks ?? []).length > 0) {
    json.fallingBlocks = (data.fallingBlocks ?? []).map(fb => ({
      xBlock: fb.xBlock,
      yBlock: fb.yBlock,
      variant: fb.variant,
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
  return json;
}
