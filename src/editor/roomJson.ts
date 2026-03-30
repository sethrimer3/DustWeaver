/**
 * Room JSON schema — defines the clean, human-readable JSON format for
 * authored room data. Provides conversion between RoomJsonDef and RoomDef,
 * ParticleKind string↔enum mapping, and validation.
 *
 * Boundary walls and tunnel wall geometry are NOT stored in the JSON;
 * they are regenerated deterministically at load time from room dimensions
 * and transition definitions.
 */

import { ParticleKind } from '../sim/particles/kinds';
import type { RoomDef, RoomEnemyDef, RoomWallDef, RoomTransitionDef, TransitionDirection } from '../levels/roomDef';
import type { EditorRoomData, EditorEnemy, EditorTransition, EditorWall, EditorSkillTomb } from './editorState';

// ── ParticleKind string mapping ──────────────────────────────────────────────

const KIND_NAME_MAP: Record<string, ParticleKind> = {
  Physical:  ParticleKind.Physical,
  Fire:      ParticleKind.Fire,
  Ice:       ParticleKind.Ice,
  Lightning: ParticleKind.Lightning,
  Poison:    ParticleKind.Poison,
  Arcane:    ParticleKind.Arcane,
  Wind:      ParticleKind.Wind,
  Holy:      ParticleKind.Holy,
  Shadow:    ParticleKind.Shadow,
  Metal:     ParticleKind.Metal,
  Earth:     ParticleKind.Earth,
  Nature:    ParticleKind.Nature,
  Crystal:   ParticleKind.Crystal,
  Void:      ParticleKind.Void,
  Water:     ParticleKind.Water,
  Lava:      ParticleKind.Lava,
  Stone:     ParticleKind.Stone,
};

const KIND_ENUM_TO_NAME: Record<number, string> = {};
for (const [name, val] of Object.entries(KIND_NAME_MAP)) {
  KIND_ENUM_TO_NAME[val] = name;
}

export function particleKindToString(kind: ParticleKind): string {
  return KIND_ENUM_TO_NAME[kind] ?? 'Physical';
}

export function stringToParticleKind(name: string): ParticleKind | null {
  return KIND_NAME_MAP[name] ?? null;
}

// ── JSON schema types ────────────────────────────────────────────────────────

export interface RoomJsonEnemy {
  xBlock: number;
  yBlock: number;
  kinds: string[];
  particleCount: number;
  isBoss: boolean;
  isFlyingEye: boolean;
  isRollingEnemy: boolean;
  rollingEnemySpriteIndex?: number;
  isRockElemental: boolean;
  isRadiantTether: boolean;
}

export interface RoomJsonWall {
  xBlock: number;
  yBlock: number;
  wBlock: number;
  hBlock: number;
}

export interface RoomJsonTransition {
  direction: TransitionDirection;
  positionBlock: number;
  openingSizeBlocks: number;
  targetRoomId: string;
  targetSpawnBlock: [number, number];
}

export interface RoomJsonSkillTomb {
  xBlock: number;
  yBlock: number;
}

export interface RoomJsonDef {
  id: string;
  name: string;
  worldNumber: number;
  widthBlocks: number;
  heightBlocks: number;
  playerSpawnBlock: [number, number];
  /** Interior walls only — boundary walls are regenerated from room dimensions + transitions. */
  interiorWalls: RoomJsonWall[];
  enemies: RoomJsonEnemy[];
  transitions: RoomJsonTransition[];
  skillTombs: RoomJsonSkillTomb[];
}

// ── Validation ───────────────────────────────────────────────────────────────

export interface ValidationError {
  path: string;
  message: string;
}

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

// ── Conversion: RoomJsonDef → EditorRoomData ─────────────────────────────────

export function jsonToEditorRoomData(json: RoomJsonDef, startUid: number): { data: EditorRoomData; nextUid: number } {
  let uid = startUid;

  const interiorWalls: EditorWall[] = json.interiorWalls.map(w => ({
    uid: uid++,
    xBlock: w.xBlock,
    yBlock: w.yBlock,
    wBlock: w.wBlock,
    hBlock: w.hBlock,
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
  }));

  const transitions: EditorTransition[] = json.transitions.map(t => ({
    uid: uid++,
    direction: t.direction,
    positionBlock: t.positionBlock,
    openingSizeBlocks: t.openingSizeBlocks,
    targetRoomId: t.targetRoomId,
    targetSpawnBlock: [...t.targetSpawnBlock] as [number, number],
  }));

  const skillTombs: EditorSkillTomb[] = json.skillTombs.map(s => ({
    uid: uid++,
    xBlock: s.xBlock,
    yBlock: s.yBlock,
  }));

  return {
    data: {
      id: json.id,
      name: json.name,
      worldNumber: json.worldNumber,
      widthBlocks: json.widthBlocks,
      heightBlocks: json.heightBlocks,
      playerSpawnBlock: [...json.playerSpawnBlock] as [number, number],
      interiorWalls,
      enemies,
      transitions,
      skillTombs,
    },
    nextUid: uid,
  };
}

// ── Conversion: EditorRoomData → RoomJsonDef ─────────────────────────────────

export function editorRoomDataToJson(data: EditorRoomData): RoomJsonDef {
  return {
    id: data.id,
    name: data.name,
    worldNumber: data.worldNumber,
    widthBlocks: data.widthBlocks,
    heightBlocks: data.heightBlocks,
    playerSpawnBlock: [...data.playerSpawnBlock],
    interiorWalls: data.interiorWalls.map(w => ({
      xBlock: w.xBlock,
      yBlock: w.yBlock,
      wBlock: w.wBlock,
      hBlock: w.hBlock,
    })),
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
    })),
    transitions: data.transitions.map(t => ({
      direction: t.direction,
      positionBlock: t.positionBlock,
      openingSizeBlocks: t.openingSizeBlocks,
      targetRoomId: t.targetRoomId,
      targetSpawnBlock: [...t.targetSpawnBlock],
    })),
    skillTombs: data.skillTombs.map(s => ({
      xBlock: s.xBlock,
      yBlock: s.yBlock,
    })),
  };
}

// ── Conversion: EditorRoomData → RoomDef (for runtime loading) ───────────────

/**
 * Builds boundary walls with gaps for transition tunnel openings.
 * Mirrors the logic in rooms.ts but works from EditorRoomData.
 */
function buildBoundaryWalls(
  widthBlocks: number,
  heightBlocks: number,
  transitions: EditorTransition[],
): RoomWallDef[] {
  const walls: RoomWallDef[] = [];

  // Top wall (full width)
  walls.push({ xBlock: 0, yBlock: 0, wBlock: widthBlocks, hBlock: 1 });
  // Bottom wall (full width)
  walls.push({ xBlock: 0, yBlock: heightBlocks - 1, wBlock: widthBlocks, hBlock: 1 });

  // Left wall — split around tunnel openings
  const leftTunnels = transitions.filter(t => t.direction === 'left');
  buildSideWall(walls, 0, 1, heightBlocks - 2, leftTunnels);

  // Right wall — split around tunnel openings
  const rightTunnels = transitions.filter(t => t.direction === 'right');
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
      out.push({ xBlock, yBlock: currentY, wBlock: 1, hBlock: tunnelTop - currentY });
    }
    currentY = tunnelBottom;
  }

  if (currentY < endY) {
    out.push({ xBlock, yBlock: currentY, wBlock: 1, hBlock: endY - currentY });
  }
}

function buildTunnelWalls(
  roomWidthBlocks: number,
  transitions: EditorTransition[],
): RoomWallDef[] {
  const walls: RoomWallDef[] = [];
  const TUNNEL_OVERHANG_BLOCKS = 4;

  for (const tunnel of transitions) {
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
    };
  });

  const transitions: RoomTransitionDef[] = data.transitions.map(t => ({
    direction: t.direction,
    targetRoomId: t.targetRoomId,
    positionBlock: t.positionBlock,
    openingSizeBlocks: t.openingSizeBlocks,
    targetSpawnBlock: [t.targetSpawnBlock[0], t.targetSpawnBlock[1]] as readonly [number, number],
  }));

  return {
    id: data.id,
    name: data.name,
    worldNumber: data.worldNumber,
    widthBlocks: data.widthBlocks,
    heightBlocks: data.heightBlocks,
    walls: allWalls,
    enemies,
    playerSpawnBlock: [data.playerSpawnBlock[0], data.playerSpawnBlock[1]],
    transitions,
    skillTombs: data.skillTombs.map(s => ({ xBlock: s.xBlock, yBlock: s.yBlock })),
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
  }));

  const transitions: EditorTransition[] = room.transitions.map(t => ({
    uid: uid++,
    direction: t.direction,
    positionBlock: t.positionBlock,
    openingSizeBlocks: t.openingSizeBlocks,
    targetRoomId: t.targetRoomId,
    targetSpawnBlock: [t.targetSpawnBlock[0], t.targetSpawnBlock[1]] as [number, number],
  }));

  const skillTombs: EditorSkillTomb[] = room.skillTombs.map(s => ({
    uid: uid++,
    xBlock: s.xBlock,
    yBlock: s.yBlock,
  }));

  return {
    data: {
      id: room.id,
      name: room.name,
      worldNumber: room.worldNumber,
      widthBlocks: room.widthBlocks,
      heightBlocks: room.heightBlocks,
      playerSpawnBlock: [room.playerSpawnBlock[0], room.playerSpawnBlock[1]],
      interiorWalls,
      enemies,
      transitions,
      skillTombs,
    },
    nextUid: uid,
  };
}
