/**
 * Room JSON loader — fetches room JSON files from CAMPAIGNS/<CAMPAIGN_ID>/ROOMS/ at startup
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
  parseSongId,
} from '../editor/roomJson';
import type { RoomJsonDef, RoomJsonTransition } from '../editor/roomJson';
import { isSavedRoomV2, hydrateV2Room } from './roomSchemaV2';
import { getActiveCampaignId, getCampaignById, getCampaignRoomsBasePath } from './campaigns';

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

  // Left wall — split around edge-transition openings only (interior transitions keep wall intact)
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
    platformEdge: w.platformEdge,
    blockTheme: w.blockTheme,
    rampOrientation: w.rampOrientation,
    isPillarHalfWidthFlag: w.isPillarHalfWidth ? (1 as const) : (0 as const),
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
      isSlimeFlag: e.isSlime ? 1 as const : 0 as const,
      isLargeSlimeFlag: e.isLargeSlime ? 1 as const : 0 as const,
      isWheelEnemyFlag: e.isWheelEnemy ? 1 as const : 0 as const,
    };
  });

  const transitions: RoomTransitionDef[] = json.transitions.map(t => ({
    direction: t.direction,
    targetRoomId: t.targetRoomId,
    positionBlock: t.positionBlock,
    openingSizeBlocks: t.openingSizeBlocks,
    targetSpawnBlock: [t.targetSpawnBlock[0], t.targetSpawnBlock[1]] as readonly [number, number],
    fadeColor: t.fadeColor,
    depthBlock: t.depthBlock,
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
    mapX: json.mapX ?? 0,
    mapY: json.mapY ?? 0,
    widthBlocks: json.widthBlocks,
    heightBlocks: json.heightBlocks,
    walls: allWalls,
    enemies,
    playerSpawnBlock: [json.playerSpawnBlock[0], json.playerSpawnBlock[1]],
    transitions,
    saveTombs: json.skillTombs.map(s => ({ xBlock: s.xBlock, yBlock: s.yBlock })),
    skillTombs: (json.dustSkillTombs ?? []).map(s => ({ xBlock: s.xBlock, yBlock: s.yBlock, weaveId: s.weaveId })),
  };

  // Propagate optional theme/background fields
  if (json.blockTheme) room.blockTheme = json.blockTheme;
  if (json.backgroundId) room.backgroundId = json.backgroundId;
  if (json.lightingEffect) room.lightingEffect = json.lightingEffect;
  const resolvedSongId = parseSongId(json.songId);
  if (resolvedSongId !== '_continue') room.songId = resolvedSongId;

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

  if (json.grasshopperAreas && json.grasshopperAreas.length > 0) {
    room.grasshopperAreas = json.grasshopperAreas.map(a => ({
      xBlock: a.xBlock,
      yBlock: a.yBlock,
      wBlock: a.wBlock,
      hBlock: a.hBlock,
      count: a.count,
    }));
  }

  return room;
}

// ── Async loader — fetches room JSON files at startup ────────────────────────

/**
 * Fetches the room manifest and all referenced JSON room files from CAMPAIGNS/<CAMPAIGN_ID>/ROOMS/.
 * Returns a Map of room ID → RoomDef.
 *
 * If the manifest or any room file fails to load, the error is logged and that
 * room is skipped (the game can still start with whatever rooms loaded successfully).
 */
export async function loadRoomJsonFiles(): Promise<Map<string, RoomDef>> {
  const rooms = new Map<string, RoomDef>();

  const activeCampaignId = getActiveCampaignId();
  const basePathCandidates: string[] = [];
  const preferredBasePath = getCampaignRoomsBasePath(activeCampaignId);
  basePathCandidates.push(preferredBasePath);
  // Fallback for environments where BASE_URL differs from deployment root.
  basePathCandidates.push(`CAMPAIGNS/${activeCampaignId}/ROOMS`);
  basePathCandidates.push(`/CAMPAIGNS/${activeCampaignId}/ROOMS`);

  const meta = await getCampaignById(activeCampaignId);
  if (meta) {
    basePathCandidates.push(getCampaignRoomsBasePath(meta.folderName));
    basePathCandidates.push(`CAMPAIGNS/${meta.folderName}/ROOMS`);
    basePathCandidates.push(`/CAMPAIGNS/${meta.folderName}/ROOMS`);
  }

  const uniqueBasePaths = [...new Set(basePathCandidates)];

  let manifest: string[] | null = null;
  let roomsBasePath = preferredBasePath;
  for (const candidate of uniqueBasePaths) {
    try {
      const resp = await fetch(`${candidate}/manifest.json`);
      if (!resp.ok) continue;
      const data = await resp.json() as unknown;
      if (!Array.isArray(data)) continue;
      manifest = data
        .filter((entry): entry is string => typeof entry === 'string')
        .map(entry => entry.replace(/\\/g, '/').replace(/^\/+/, ''));
      roomsBasePath = candidate;
      break;
    } catch {
      // Try next candidate.
    }
  }

  if (manifest === null) {
    console.error('[roomJsonLoader] Failed to fetch rooms manifest from all known campaign paths:', uniqueBasePaths);
    return rooms;
  }

  // Fetch all room files in parallel
  const fetches = manifest.map(async (filename) => {
    try {
      const resp = await fetch(`${roomsBasePath}/${filename}`);
      if (!resp.ok) {
        console.error(`[roomJsonLoader] Failed to fetch ${filename}: ${resp.status}`);
        return;
      }
      const data: unknown = await resp.json();
      // Auto-detect schema: v2 rooms hydrate first into the legacy RoomJsonDef
      // shape so the downstream conversion pipeline stays unchanged.
      let json: RoomJsonDef;
      if (isSavedRoomV2(data)) {
        json = hydrateV2Room(data);
      } else {
        const errors = validateRoomJson(data);
        if (errors.length > 0) {
          console.error(`[roomJsonLoader] Validation errors in ${filename}:`, errors);
          return;
        }
        json = data as RoomJsonDef;
      }
      const roomDef = roomJsonDefToRoomDef(json);
      rooms.set(roomDef.id, roomDef);
    } catch (err) {
      console.error(`[roomJsonLoader] Error loading ${filename}:`, err);
    }
  });

  await Promise.all(fetches);
  return rooms;
}
