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
import { blockThemeRefToTheme } from './roomDef';
import {
  validateRoomJson,
  stringToParticleKind,
  parseSongId,
} from '../editor/roomJson';
import type { RoomJsonDef, RoomJsonTransition } from '../editor/roomJson';
import { isSavedRoomV2, hydrateV2Room } from './roomSchemaV2';
import { getActiveCampaignId, getCampaignById, getCampaignRoomsBasePath } from './campaigns';
import { savedToLightDef } from './lightingSchema';

// ── Boundary wall generation (mirrors roomBuilders.ts) ───────────────────────

const DISCOVERED_ROOM_FILE_PATHS = Object.keys(import.meta.glob('/ASSETS/CAMPAIGNS/*/ROOMS/*.json', {
  query: '?url',
  import: 'default',
}));

function discoverRoomFilenames(campaignFolderNames: readonly string[]): string[] {
  const campaignFolderSet = new Set(campaignFolderNames);
  const filenames: string[] = [];
  for (const path of DISCOVERED_ROOM_FILE_PATHS) {
    const normalizedPath = path.replace(/\\/g, '/');
    const match = normalizedPath.match(/\/ASSETS\/CAMPAIGNS\/([^/]+)\/ROOMS\/([^/]+\.json)$/);
    if (!match) continue;
    const campaignFolderName = match[1];
    const filename = match[2];
    if (!campaignFolderSet.has(campaignFolderName)) continue;
    if (filename === 'manifest.json') continue;
    filenames.push(filename);
  }
  return [...new Set(filenames)].sort((a, b) => a.localeCompare(b));
}


// ── Async loader — fetches room JSON files at startup ────────────────────────

function buildBoundaryWalls(
  widthBlocks: number,
  heightBlocks: number,
  transitions: RoomJsonTransition[],
): RoomWallDef[] {
  const walls: RoomWallDef[] = [];

  const gw = (t: RoomJsonTransition) => t.gradientWidthBlocks ?? 3;

  // Compute xBlock/yBlock from positionBlock/depthBlock for JSON that lacks the new fields.
  function getXBlock(t: RoomJsonTransition): number {
    if (t.xBlock !== undefined) return t.xBlock;
    const isHoriz = t.direction === 'left' || t.direction === 'right';
    if (isHoriz) return t.depthBlock ?? 0;
    return t.positionBlock;
  }
  function getYBlock(t: RoomJsonTransition): number {
    if (t.yBlock !== undefined) return t.yBlock;
    const isHoriz = t.direction === 'left' || t.direction === 'right';
    if (isHoriz) return t.positionBlock;
    return t.depthBlock ?? 0;
  }

  // Top wall — gap where an 'up' transition's zone starts at y=0
  const upTunnels = transitions.filter(t => t.direction === 'up' && getYBlock(t) === 0);
  buildHorizontalWall(walls, 0, 0, widthBlocks,
    upTunnels.map(t => ({ positionBlock: getXBlock(t), openingSizeBlocks: t.openingSizeBlocks })));

  // Bottom wall — gap where a 'down' transition's zone ends at y=heightBlocks
  const downTunnels = transitions.filter(t => t.direction === 'down' && getYBlock(t) + gw(t) >= heightBlocks);
  buildHorizontalWall(walls, heightBlocks - 1, 0, widthBlocks,
    downTunnels.map(t => ({ positionBlock: getXBlock(t), openingSizeBlocks: t.openingSizeBlocks })));

  // Left wall — gap where a 'left' transition's zone starts at x=0
  const leftTunnels = transitions.filter(t => t.direction === 'left' && getXBlock(t) === 0);
  buildSideWall(walls, 0, 1, heightBlocks - 2,
    leftTunnels.map(t => ({ positionBlock: getYBlock(t), openingSizeBlocks: t.openingSizeBlocks })));

  // Right wall — gap where a 'right' transition's zone ends at x=widthBlocks
  const rightTunnels = transitions.filter(t => t.direction === 'right' && getXBlock(t) + gw(t) >= widthBlocks);
  buildSideWall(walls, widthBlocks - 1, 1, heightBlocks - 2,
    rightTunnels.map(t => ({ positionBlock: getYBlock(t), openingSizeBlocks: t.openingSizeBlocks })));

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

/**
 * Converts a validated RoomJsonDef into a full RoomDef suitable for runtime
 * loading. Boundary walls are regenerated. Tunnel corridor walls are no longer
 * generated — transitions are purely trigger/fade zones.
 */
export function roomJsonDefToRoomDef(json: RoomJsonDef): RoomDef {
  const boundaryWalls = buildBoundaryWalls(json.widthBlocks, json.heightBlocks, json.transitions);

  const interiorWalls: RoomWallDef[] = json.interiorWalls.map(w => ({
    xBlock: w.xBlock,
    yBlock: w.yBlock,
    wBlock: w.wBlock,
    hBlock: w.hBlock,
    isPlatformFlag: w.isPlatform ? (1 as const) : (0 as const),
    platformEdge: w.platformEdge,
    blockTheme: blockThemeRefToTheme(w.blockThemeId) ?? w.blockTheme,
    soundHardness: w.soundHardness,
    rampOrientation: w.rampOrientation,
    isPillarHalfWidthFlag: w.isPillarHalfWidth ? (1 as const) : (0 as const),
  }));

  const allWalls: RoomWallDef[] = [...boundaryWalls, ...interiorWalls];

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
      isBeetleFlag: e.isBeetle ? 1 as const : 0 as const,
    };
  });

  const transitions: RoomTransitionDef[] = json.transitions.map(t => {
    // Prefer explicit xBlock/yBlock; fall back to positionBlock/depthBlock migration.
    const isHoriz = t.direction === 'left' || t.direction === 'right';
    const gw = t.gradientWidthBlocks ?? 3;
    const xBlock = t.xBlock !== undefined ? t.xBlock
      : (isHoriz ? (t.depthBlock ?? 0) : t.positionBlock);
    const yBlock = t.yBlock !== undefined ? t.yBlock
      : (isHoriz ? t.positionBlock : (t.depthBlock ?? 0));

    // For right/down edge transitions that have no depthBlock or explicit xBlock/yBlock,
    // derive zone start from room dimensions so the zone is flush with the far edge.
    let xBlockFinal = xBlock;
    let yBlockFinal = yBlock;
    if (t.direction === 'right' && t.depthBlock === undefined && t.xBlock === undefined) {
      xBlockFinal = json.widthBlocks - gw;
    } else if (t.direction === 'down' && t.depthBlock === undefined && t.yBlock === undefined) {
      yBlockFinal = json.heightBlocks - gw;
    }

    return {
      direction: t.direction,
      targetRoomId: t.targetRoomId,
      xBlock: xBlockFinal,
      yBlock: yBlockFinal,
      positionBlock: t.positionBlock,
      openingSizeBlocks: t.openingSizeBlocks,
      targetSpawnBlock: [t.targetSpawnBlock[0], t.targetSpawnBlock[1]] as readonly [number, number],
      fadeColor: t.fadeColor,
      depthBlock: t.depthBlock,
      gradientWidthBlocks: t.gradientWidthBlocks,
      isSecretDoor: t.isSecretDoor,
    };
  });

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
    skillTombs: [
      ...(json.dustSkillTombs ?? []).map(s => ({ xBlock: s.xBlock, yBlock: s.yBlock, weaveId: s.weaveId })),
      // Legacy: skill books are unified with skill tombs — merge them in.
      ...(json.skillBooks ?? []).filter(s => !!(s as unknown as Record<string, unknown>)['weaveId']).map(s => ({
        xBlock: s.xBlock,
        yBlock: s.yBlock,
        weaveId: (s as unknown as Record<string, unknown>)['weaveId'] as string,
      })),
    ],
  };

  // Propagate optional theme/background fields
  const roomBlockTheme = blockThemeRefToTheme(json.blockThemeId) ?? json.blockTheme;
  if (roomBlockTheme) room.blockTheme = roomBlockTheme;
  if (json.soundHardness) room.soundHardness = json.soundHardness;
  if (json.backgroundId) room.backgroundId = json.backgroundId;
  if (json.lightingEffect) room.lightingEffect = json.lightingEffect;
  const resolvedSongId = parseSongId(json.songId);
  if (resolvedSongId !== '_continue') room.songId = resolvedSongId;

  // Add optional fields only if present
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

  if (json.dustPiles && json.dustPiles.length > 0) {
    room.dustPiles = json.dustPiles.map(p => ({
      xBlock: p.xBlock,
      yBlock: p.yBlock,
      dustCount: p.dustCount,
      spreadBlocks: p.spreadBlocks ?? 0,
    }));
  }

  if (json.fireflyAreas && json.fireflyAreas.length > 0) {
    room.fireflyAreas = json.fireflyAreas.map(a => ({
      xBlock: a.xBlock,
      yBlock: a.yBlock,
      wBlock: a.wBlock,
      hBlock: a.hBlock,
      count: a.count,
    }));
  }

  if (json.decorations && json.decorations.length > 0) {
    room.decorations = json.decorations.map(d => ({
      xBlock: d.xBlock,
      yBlock: d.yBlock,
      kind: d.kind,
    }));
  }

  if (json.ambientLightDirection) {
    room.ambientLightDirection = json.ambientLightDirection;
  }
  if (json.directionalBias      !== undefined) room.directionalBias      = json.directionalBias;
  if (json.sideExposureStrength !== undefined) room.sideExposureStrength = json.sideExposureStrength;
  if (json.minimumWallLight     !== undefined) room.minimumWallLight     = json.minimumWallLight;
  if (json.falloffPower         !== undefined) room.falloffPower         = json.falloffPower;
  if (json.backgroundLightSpill !== undefined) room.backgroundLightSpill = json.backgroundLightSpill;
  if (json.solidLightSoftness   !== undefined) room.solidLightSoftness   = json.solidLightSoftness;
  if (json.blockSeamBlending)                  room.blockSeamBlending    = json.blockSeamBlending;
  if (json.voidEdgeStyle)                      room.voidEdgeStyle        = json.voidEdgeStyle;
  if (json.ambientLightBlockers && json.ambientLightBlockers.length > 0) {
    room.ambientLightBlockers = json.ambientLightBlockers.map(b => ({
      xBlock: b.xBlock,
      yBlock: b.yBlock,
      isDark: b.isDark,
    }));
  }
  if (json.lightSources && json.lightSources.length > 0) {
    room.lightSources = json.lightSources.map(l => ({
      xBlock: l.xBlock,
      yBlock: l.yBlock,
      radiusBlocks: l.radiusBlocks,
      colorR: l.colorR,
      colorG: l.colorG,
      colorB: l.colorB,
      brightnessPct: l.brightnessPct,
    }));
  }
  if (json.sunbeams && json.sunbeams.length > 0) {
    room.sunbeams = json.sunbeams.map(s => ({
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
  if (json.sceneLights && json.sceneLights.length > 0) {
    room.sceneLights = json.sceneLights.map(savedToLightDef);
  }

  if (json.guideDustPaths && json.guideDustPaths.length > 0) {
    room.guideDustPaths = json.guideDustPaths
      .filter(p => p.points.length >= 2)
      .map(p => ({
        points: p.points.map(pt => ({ xBlock: pt.xBlock, yBlock: pt.yBlock, speed: pt.speed ?? 1.0 })),
        loop: p.loop ?? false,
        visibleInGame: p.visibleInGame ?? true,
        moteCount: p.moteCount ?? 8,
        moteSpeedFactor: p.moteSpeedFactor ?? 1.0,
        opacityPct: p.opacityPct ?? 100,
      }));
  }

  return room;
}

// ── Async loader — fetches room JSON files at startup ────────────────────────

/**
 * Fetches room JSON files for the active campaign from auto-discovered paths.
 * Rooms are populated from files found by the build-time Vite glob
 * without fetching a manifest.
 * Returns a Map of room ID → RoomDef.
 *
 * If any room file fails to load, the error is logged and that room is skipped.
 */
export async function loadRoomJsonFiles(): Promise<Map<string, RoomDef>> {
  const rooms = new Map<string, RoomDef>();

  const activeCampaignId = getActiveCampaignId();
  const meta = await getCampaignById(activeCampaignId);

  const campaignFolderNames = meta
    ? [...new Set([activeCampaignId, meta.folderName])]
    : [activeCampaignId];
  const discoveredFilenames = discoverRoomFilenames(campaignFolderNames);

  if (discoveredFilenames.length === 0) {
    console.error('[roomJsonLoader] No room files discovered for campaign:', campaignFolderNames);
    return rooms;
  }

  const roomsBasePath = meta
    ? getCampaignRoomsBasePath(meta.folderName)
    : getCampaignRoomsBasePath(activeCampaignId);

  // Fetch all room files in parallel
  const fetches = discoveredFilenames.map(async (filename) => {
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
