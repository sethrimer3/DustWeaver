/**
 * Room JSON conversion — validation, song-ID helpers, and bidirectional
 * conversions between RoomJsonDef, EditorRoomData, and RoomDef.
 *
 * JSON schema type definitions (interfaces) and the ParticleKind string↔enum
 * mapping live in roomJsonSchema.ts.
 *
 * Boundary walls and tunnel wall geometry are NOT stored in the JSON;
 * they are regenerated deterministically at load time from room dimensions
 * and transition definitions.
 */

import { ParticleKind } from '../sim/particles/kinds';
import type { RoomDef, RoomEnemyDef, RoomWallDef, RoomTransitionDef, BlockTheme } from '../levels/roomDef';
import { blockThemeRefToTheme, blockThemeToId } from '../levels/roomDef';
import type { EditorRoomData, EditorEnemy, EditorTransition, EditorWall, EditorSaveTomb, EditorSkillTomb, EditorDustPile, EditorGrasshopperArea, EditorFireflyArea, EditorDecoration, EditorAmbientLightBlocker, EditorLightSource, EditorWaterZone, EditorLavaZone, EditorCrumbleBlock, RoomSongId } from './editorState';
import { AVAILABLE_SONGS } from '../audio/musicManager';
import {
  particleKindToString,
  stringToParticleKind,
} from './roomJsonSchema';
import type {
  RoomJsonDef,
  RoomJsonWall,
  RoomJsonTransition,
  RoomJsonAmbientLightBlocker,
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
  RoomJsonDustBoostJar,
  RoomJsonFireflyJar,
  RoomJsonDustPile,
  RoomJsonGrasshopperArea,
  RoomJsonFireflyArea,
  RoomJsonDecoration,
  RoomJsonAmbientLightBlocker,
  RoomJsonLightSource,
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
      dustPiles,
      grasshopperAreas,
      fireflyAreas,
      decorations,
      ambientLightBlockers,
      lightSources,
      waterZones,
      lavaZones,
      crumbleBlocks,
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
    json.lightSources = data.lightSources.map(l => ({
      xBlock: l.xBlock,
      yBlock: l.yBlock,
      radiusBlocks: l.radiusBlocks,
      colorR: l.colorR,
      colorG: l.colorG,
      colorB: l.colorB,
      brightnessPct: l.brightnessPct,
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
  return json;
}

// ── Conversion: EditorRoomData → RoomDef (for runtime loading) ───────────────

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

  // Top wall (full width) — invisible boundary
  walls.push({ xBlock: 0, yBlock: 0, wBlock: widthBlocks, hBlock: 1, isInvisibleFlag: 1 });
  // Bottom wall (full width) — invisible boundary
  walls.push({ xBlock: 0, yBlock: heightBlocks - 1, wBlock: widthBlocks, hBlock: 1, isInvisibleFlag: 1 });

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

function buildTunnelWalls(
  roomWidthBlocks: number,
  transitions: EditorTransition[],
): RoomWallDef[] {
  const walls: RoomWallDef[] = [];
  const TUNNEL_OVERHANG_BLOCKS = 4;

  // Only edge transitions (depthBlock undefined) get physical corridor walls.
  for (const tunnel of transitions) {
    if (tunnel.depthBlock !== undefined) continue; // interior transition — no corridor walls

    const topY = tunnel.positionBlock - 1;
    const bottomY = tunnel.positionBlock + tunnel.openingSizeBlocks;

    if (tunnel.direction === 'left') {
      walls.push({ xBlock: -TUNNEL_OVERHANG_BLOCKS, yBlock: topY, wBlock: TUNNEL_OVERHANG_BLOCKS + 1, hBlock: 1 });
      walls.push({ xBlock: -TUNNEL_OVERHANG_BLOCKS, yBlock: bottomY, wBlock: TUNNEL_OVERHANG_BLOCKS + 1, hBlock: 1 });
    } else if (tunnel.direction === 'right') {
      walls.push({ xBlock: roomWidthBlocks - 1, yBlock: topY, wBlock: TUNNEL_OVERHANG_BLOCKS + 1, hBlock: 1 });
      walls.push({ xBlock: roomWidthBlocks - 1, yBlock: bottomY, wBlock: TUNNEL_OVERHANG_BLOCKS + 1, hBlock: 1 });
    }
    // TODO: up/down tunnel wall generation when runtime supports it
  }

  return walls;
}

/**
 * Converts editor room data into a full RoomDef suitable for runtime loading.
 * Boundary walls and tunnel corridor walls are regenerated here.
 */
export function editorRoomDataToRoomDef(data: EditorRoomData): RoomDef {
  const boundaryWalls = buildBoundaryWalls(data.widthBlocks, data.heightBlocks, data.transitions);
  const tunnelWalls = buildTunnelWalls(data.widthBlocks, data.transitions);

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
      dustPiles,
      grasshopperAreas,
      fireflyAreas,
      decorations,
      ambientLightBlockers,
      lightSources,
      waterZones,
      lavaZones,
      crumbleBlocks,
    },
    nextUid: uid,
  };
}
