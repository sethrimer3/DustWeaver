/**
 * Room JSON loader — fetches room JSON files from ASSETS/ROOMS/ at startup
 * and converts them into RoomDef objects for the ROOM_REGISTRY.
 *
 * Boundary walls and tunnel corridor walls are NOT stored in the JSON;
 * they are regenerated deterministically at load time from room dimensions
 * and transition definitions.
 */

import { ParticleKind } from '../sim/particles/kinds';
import type {
  RoomDef,
  RoomEnemyDef,
  RoomWallDef,
  RoomTransitionDef,
  RoomSpikeDef,
  RoomSpringboardDef,
  RoomZoneDef,
  RoomBreakableBlockDef,
  RoomDustBoostJarDef,
  RoomFireflyJarDef,
  SpikeDirection,
} from './roomDef';
import {
  validateRoomJson,
  stringToParticleKind,
} from '../editor/roomJson';
import type { RoomJsonDef, RoomJsonTransition } from '../editor/roomJson';
// ── Vite base URL ────────────────────────────────────────────────────────────

const BASE = import.meta.env.BASE_URL;

// ── Boundary wall generation (mirrors roomBuilders.ts) ───────────────────────

const TUNNEL_OVERHANG_BLOCKS = 4;

function buildBoundaryWalls(
  widthBlocks: number,
  heightBlocks: number,
  transitions: RoomJsonTransition[],
): RoomWallDef[] {
  const walls: RoomWallDef[] = [];

  // Top wall (full width) — invisible boundary
  walls.push({ xBlock: 0, yBlock: 0, wBlock: widthBlocks, hBlock: 1, isInvisibleFlag: 1 });
  // Bottom wall (full width) — invisible boundary
  walls.push({ xBlock: 0, yBlock: heightBlocks - 1, wBlock: widthBlocks, hBlock: 1, isInvisibleFlag: 1 });

  // Left wall — split around tunnel openings (invisible boundary)
  const leftTunnels = transitions.filter(t => t.direction === 'left');
  buildSideWall(walls, 0, 1, heightBlocks - 2, leftTunnels);

  // Right wall — split around tunnel openings (invisible boundary)
  const rightTunnels = transitions.filter(t => t.direction === 'right');
  buildSideWall(walls, widthBlocks - 1, 1, heightBlocks - 2, rightTunnels);

  return walls;
}

function buildSideWall(
  out: RoomWallDef[],
  xBlock: number,
  startYBlock: number,
  totalHeightBlocks: number,
  tunnels: RoomJsonTransition[],
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
  transitions: RoomJsonTransition[],
): RoomWallDef[] {
  const walls: RoomWallDef[] = [];

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

// ── RoomJsonDef → RoomDef conversion ─────────────────────────────────────────

/**
 * Converts a validated RoomJsonDef into a full RoomDef suitable for runtime
 * loading. Boundary walls and tunnel corridor walls are regenerated.
 */
export function roomJsonDefToRoomDef(json: RoomJsonDef): RoomDef {
  const boundaryWalls = buildBoundaryWalls(json.widthBlocks, json.heightBlocks, json.transitions);
  const tunnelWalls = buildTunnelWalls(json.widthBlocks, json.transitions);

  const interiorWalls: RoomWallDef[] = json.interiorWalls.map(w => ({
    xBlock: w.xBlock,
    yBlock: w.yBlock,
    wBlock: w.wBlock,
    hBlock: w.hBlock,
    isPlatformFlag: w.isPlatform ? (1 as const) : (0 as const),
    blockTheme: w.blockTheme,
  }));

  const allWalls: RoomWallDef[] = [...boundaryWalls, ...tunnelWalls, ...interiorWalls];

  const enemies: RoomEnemyDef[] = json.enemies.map(e => {
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
      isBossFlag: e.isBoss ? 1 as const : 0 as const,
      isFlyingEyeFlag: e.isFlyingEye ? 1 as const : 0 as const,
      isRollingEnemyFlag: e.isRollingEnemy ? 1 as const : 0 as const,
      rollingEnemySpriteIndex: e.rollingEnemySpriteIndex,
      isRockElementalFlag: e.isRockElemental ? 1 as const : 0 as const,
      isRadiantTetherFlag: e.isRadiantTether ? 1 as const : 0 as const,
      isGrappleHunterFlag: e.isGrappleHunter ? 1 as const : 0 as const,
    };
  });

  const transitions: RoomTransitionDef[] = json.transitions.map(t => ({
    direction: t.direction,
    targetRoomId: t.targetRoomId,
    positionBlock: t.positionBlock,
    openingSizeBlocks: t.openingSizeBlocks,
    targetSpawnBlock: [t.targetSpawnBlock[0], t.targetSpawnBlock[1]] as readonly [number, number],
    fadeColor: t.fadeColor,
  }));

  // ── Hazards ──────────────────────────────────────────────────────────────

  const spikes: RoomSpikeDef[] | undefined = json.spikes?.map(s => ({
    xBlock: s.xBlock,
    yBlock: s.yBlock,
    direction: s.direction as SpikeDirection,
  }));

  const springboards: RoomSpringboardDef[] | undefined = json.springboards?.map(s => ({
    xBlock: s.xBlock,
    yBlock: s.yBlock,
  }));

  const waterZones: RoomZoneDef[] | undefined = json.waterZones?.map(z => ({
    xBlock: z.xBlock,
    yBlock: z.yBlock,
    wBlock: z.wBlock,
    hBlock: z.hBlock,
  }));

  const lavaZones: RoomZoneDef[] | undefined = json.lavaZones?.map(z => ({
    xBlock: z.xBlock,
    yBlock: z.yBlock,
    wBlock: z.wBlock,
    hBlock: z.hBlock,
  }));

  const breakableBlocks: RoomBreakableBlockDef[] | undefined = json.breakableBlocks?.map(b => ({
    xBlock: b.xBlock,
    yBlock: b.yBlock,
  }));

  const dustBoostJars: RoomDustBoostJarDef[] | undefined = json.dustBoostJars?.map(j => {
    const kind = stringToParticleKind(j.dustKind);
    return {
      xBlock: j.xBlock,
      yBlock: j.yBlock,
      dustKind: kind ?? ParticleKind.Physical,
      dustCount: j.dustCount,
    };
  });

  const fireflyJars: RoomFireflyJarDef[] | undefined = json.fireflyJars?.map(j => ({
    xBlock: j.xBlock,
    yBlock: j.yBlock,
  }));

  const room: RoomDef = {
    id: json.id,
    name: json.name,
    worldNumber: json.worldNumber,
    widthBlocks: json.widthBlocks,
    heightBlocks: json.heightBlocks,
    walls: allWalls,
    enemies,
    playerSpawnBlock: [json.playerSpawnBlock[0], json.playerSpawnBlock[1]],
    transitions,
    skillTombs: json.skillTombs.map(s => ({ xBlock: s.xBlock, yBlock: s.yBlock })),
  };

  // Propagate optional theme/background fields
  if (json.blockTheme) room.blockTheme = json.blockTheme;
  if (json.backgroundId) room.backgroundId = json.backgroundId;
  if (json.lightingEffect) room.lightingEffect = json.lightingEffect;

  // Add optional fields only if present
  if (json.skillBooks && json.skillBooks.length > 0) {
    room.skillBooks = json.skillBooks.map(s => ({ xBlock: s.xBlock, yBlock: s.yBlock }));
  }
  if (json.dustContainers && json.dustContainers.length > 0) {
    room.dustContainers = json.dustContainers.map(s => ({ xBlock: s.xBlock, yBlock: s.yBlock }));
  }
  if (spikes && spikes.length > 0) room.spikes = spikes;
  if (springboards && springboards.length > 0) room.springboards = springboards;
  if (waterZones && waterZones.length > 0) room.waterZones = waterZones;
  if (lavaZones && lavaZones.length > 0) room.lavaZones = lavaZones;
  if (breakableBlocks && breakableBlocks.length > 0) room.breakableBlocks = breakableBlocks;
  if (dustBoostJars && dustBoostJars.length > 0) room.dustBoostJars = dustBoostJars;
  if (fireflyJars && fireflyJars.length > 0) room.fireflyJars = fireflyJars;

  return room;
}

// ── Async loader — fetches room JSON files at startup ────────────────────────

/**
 * Fetches the room manifest and all referenced JSON room files from ASSETS/ROOMS/.
 * Returns a Map of room ID → RoomDef.
 *
 * If the manifest or any room file fails to load, the error is logged and that
 * room is skipped (the game can still start with whatever rooms loaded successfully).
 */
export async function loadRoomJsonFiles(): Promise<Map<string, RoomDef>> {
  const rooms = new Map<string, RoomDef>();

  let manifest: string[];
  try {
    const resp = await fetch(`${BASE}ROOMS/manifest.json`);
    if (!resp.ok) {
      console.error(`[roomJsonLoader] Failed to fetch manifest: ${resp.status}`);
      return rooms;
    }
    manifest = await resp.json() as string[];
  } catch (err) {
    console.error('[roomJsonLoader] Failed to parse manifest:', err);
    return rooms;
  }

  // Fetch all room files in parallel
  const fetches = manifest.map(async (filename) => {
    try {
      const resp = await fetch(`${BASE}ROOMS/${filename}`);
      if (!resp.ok) {
        console.error(`[roomJsonLoader] Failed to fetch ${filename}: ${resp.status}`);
        return;
      }
      const data: unknown = await resp.json();
      const errors = validateRoomJson(data);
      if (errors.length > 0) {
        console.error(`[roomJsonLoader] Validation errors in ${filename}:`, errors);
        return;
      }
      const json = data as RoomJsonDef;
      const roomDef = roomJsonDefToRoomDef(json);
      rooms.set(roomDef.id, roomDef);
    } catch (err) {
      console.error(`[roomJsonLoader] Error loading ${filename}:`, err);
    }
  });

  await Promise.all(fetches);
  return rooms;
}
