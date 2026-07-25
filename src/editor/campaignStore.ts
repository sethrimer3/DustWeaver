import type { SavedCampaignV1, SavedCampaignMetadata } from '../levels/campaignSchema';
import { validateSavedCampaignTopLevel } from '../levels/campaignSchema';
import type { SavedRoomV2 } from '../levels/roomSchemaV2';
import { dehydrateRoom, hydrateV2Room } from '../levels/roomSchemaV2';
import type { EditorRoomData } from './editorState';
import { editorRoomDataToJson, jsonToEditorRoomData } from './roomJson';
import type { WorldMapJsonDef, WorldMapRoomEntry } from './worldMapData';
import { BUILD_NUMBER } from '../build-info';

export interface CampaignStore {
  campaignMeta: SavedCampaignMetadata;
  worldMap: WorldMapJsonDef;
  rawRoomsById: Map<string, SavedRoomV2>;
  worldMapRoomById: Map<string, WorldMapRoomEntry>;
  dirtyRoomIds: Set<string>;
  hydratedRoomsById: Map<string, EditorRoomData>;
  readonly activeRoomId: string | null;
  setActiveRoomId: (roomId: string | null) => void;
  updateWorldMap: (worldMap: WorldMapJsonDef) => void;
  getRoom: (roomId: string, startUid: number) => { roomData: EditorRoomData; nextUid: number };
  markRoomDirty: (roomId: string, roomData: EditorRoomData) => void;
  discardRoomChanges: (roomId: string) => void;
  commitRoom: (roomId: string, roomData: EditorRoomData) => void;
  commitActiveRoom: (activeRoomData: EditorRoomData | null) => void;
  commitAllDirtyRooms: () => void;
  buildExportCampaign: (baseCampaign: SavedCampaignV1, customBlockDefs?: SavedCampaignV1['customBlockDefs']) => SavedCampaignV1;
}

function isDev(): boolean {
  // Optional-chained so this module can also be imported under plain Node
  // (the test runner), where Vite's import.meta.env shim does not exist.
  return import.meta.env?.DEV === true;
}

function logTiming(label: string, startMs: number, details?: string): void {
  if (!isDev()) return;
  const suffix = details ? ` ${details}` : '';
  console.log(`[campaignPerf] ${label}: ${(performance.now() - startMs).toFixed(2)}ms${suffix}`);
}

function buildWorldMapRoomIndex(worldMap: WorldMapJsonDef): Map<string, WorldMapRoomEntry> {
  const index = new Map<string, WorldMapRoomEntry>();
  for (const room of worldMap.rooms) {
    index.set(room.id, room);
  }
  return index;
}

function computeMaxUidPlusOne(roomData: EditorRoomData, startUid: number): number {
  let nextUid = startUid;
  const track = (uid: number): void => {
    if (uid + 1 > nextUid) nextUid = uid + 1;
  };
  for (const w of roomData.interiorWalls) track(w.uid);
  for (const e of roomData.enemies) track(e.uid);
  for (const t of roomData.transitions) track(t.uid);
  for (const s of roomData.saveTombs) track(s.uid);
  for (const s of roomData.skillTombs) track(s.uid);
  for (const s of roomData.challengeFields ?? []) track(s.uid);
  for (const s of roomData.challengeGates ?? []) track(s.uid);
  for (const s of roomData.gates ?? []) track(s.uid);
  for (const s of roomData.challengeTotems ?? []) track(s.uid);
  for (const d of roomData.dustPiles) track(d.uid);
  for (const d of (roomData.decorations ?? [])) track(d.uid);
  for (const z of (roomData.waterZones ?? [])) track(z.uid);
  for (const z of (roomData.lavaZones ?? [])) track(z.uid);
  for (const z of (roomData.timeStopFields ?? [])) track(z.uid);
  for (const c of (roomData.crumbleBlocks ?? [])) track(c.uid);
  for (const sp of (roomData.spikes ?? [])) track(sp.uid);
  for (const b of (roomData.bouncePads ?? [])) track(b.uid);
  for (const kb of (roomData.kineticBlocks ?? [])) track(kb.uid);
  for (const r of (roomData.ropes ?? [])) track(r.uid);
  for (const d of (roomData.dialogueTriggers ?? [])) track(d.uid);
  for (const a of (roomData.ambientLightBlockers ?? [])) track(a.uid);
  for (const l of (roomData.lightSources ?? [])) track(l.uid);
  for (const s of (roomData.sunbeams ?? [])) track(s.uid);
  for (const d of (roomData.dustContainers ?? [])) track(d.uid);
  for (const d of (roomData.dustContainerPieces ?? [])) track(d.uid);
  for (const d of (roomData.dustBoostJars ?? [])) track(d.uid);
  for (const d of (roomData.dustSwarms ?? [])) track(d.uid);
  for (const d of (roomData.lambdaAnchors ?? [])) track(d.uid);
  for (const d of (roomData.fireflyJars ?? [])) track(d.uid);
  for (const d of (roomData.springboards ?? [])) track(d.uid);
  for (const d of (roomData.breakableBlocks ?? [])) track(d.uid);
  for (const d of (roomData.grasshopperAreas ?? [])) track(d.uid);
  for (const d of (roomData.fireflyAreas ?? [])) track(d.uid);
  for (const d of (roomData.sceneLights ?? [])) track(d.uid);
  for (const d of (roomData.fallingBlocks ?? [])) track(d.uid);
  for (const d of (roomData.backgroundBlocks ?? [])) track(d.uid);
  for (const d of (roomData.grappleCarryBlocks ?? [])) track(d.uid);
  for (const d of (roomData.phantasmalTiles ?? [])) track(d.uid);
  for (const d of (roomData.customBlockPlacements ?? [])) track(d.uid);
  return nextUid;
}

function applyWorldMapRoomMetadata(room: SavedRoomV2, mapRoom: WorldMapRoomEntry | undefined): SavedRoomV2 {
  if (mapRoom === undefined) return room;
  return {
    ...room,
    name: mapRoom.name,
    world: mapRoom.worldId,
    map: [mapRoom.mapX, mapRoom.mapY],
  };
}

export function createCampaignStore(campaign: SavedCampaignV1): CampaignStore {
  const validateStartMs = isDev() ? performance.now() : 0;
  const topLevelErrors = validateSavedCampaignTopLevel(campaign);
  if (topLevelErrors.length > 0) {
    throw new Error(`Invalid campaign payload: ${topLevelErrors.join('; ')}`);
  }
  if (isDev()) {
    logTiming('campaign top-level validation (session init)', validateStartMs);
  }

  const indexBuildStartMs = isDev() ? performance.now() : 0;
  const rawRoomsById = new Map<string, SavedRoomV2>();
  for (const room of campaign.rooms) {
    rawRoomsById.set(room.id, room);
  }
  const worldMapRoomById = buildWorldMapRoomIndex(campaign.worldMap);
  if (isDev()) {
    logTiming('campaign room index build', indexBuildStartMs, `(rooms=${rawRoomsById.size})`);
  }

  const hydratedRoomsById = new Map<string, EditorRoomData>();
  const hydratedNextUidById = new Map<string, number>();
  const dirtyRoomIds = new Set<string>();
  let activeRoomId: string | null = null;
  let worldMap = campaign.worldMap;

  function setActiveRoomId(roomId: string | null): void {
    activeRoomId = roomId;
  }

  function updateWorldMap(nextWorldMap: WorldMapJsonDef): void {
    worldMap = nextWorldMap;
    worldMapRoomById.clear();
    for (const room of nextWorldMap.rooms) {
      worldMapRoomById.set(room.id, room);
    }
  }

  function getRoom(roomId: string, startUid: number): { roomData: EditorRoomData; nextUid: number } {
    const cached = hydratedRoomsById.get(roomId);
    if (cached !== undefined) {
      const cachedNextUid = hydratedNextUidById.get(roomId);
      if (cachedNextUid !== undefined) {
        return { roomData: cached, nextUid: cachedNextUid };
      }
      const computedNextUid = computeMaxUidPlusOne(cached, startUid);
      hydratedNextUidById.set(roomId, computedNextUid);
      return { roomData: cached, nextUid: computedNextUid };
    }
    const raw = rawRoomsById.get(roomId);
    if (raw === undefined) {
      throw new Error(`Room "${roomId}" was not found in campaign room index.`);
    }
    const hydrateStartMs = isDev() ? performance.now() : 0;
    const jsonDef = hydrateV2Room(raw);
    const mapRoom = worldMapRoomById.get(roomId);
    if (mapRoom !== undefined) {
      jsonDef.name = mapRoom.name;
      jsonDef.worldNumber = mapRoom.worldId;
      jsonDef.mapX = mapRoom.mapX;
      jsonDef.mapY = mapRoom.mapY;
    }
    const hydrated = jsonToEditorRoomData(jsonDef, startUid);
    hydratedRoomsById.set(roomId, hydrated.data);
    hydratedNextUidById.set(roomId, hydrated.nextUid);
    if (isDev()) {
      logTiming('hydrate room', hydrateStartMs, `(roomId=${roomId})`);
    }
    return { roomData: hydrated.data, nextUid: hydrated.nextUid };
  }

  function markRoomDirty(roomId: string, roomData: EditorRoomData): void {
    hydratedRoomsById.set(roomId, roomData);
    hydratedNextUidById.delete(roomId);
    dirtyRoomIds.add(roomId);
  }

  function discardRoomChanges(roomId: string): void {
    hydratedRoomsById.delete(roomId);
    hydratedNextUidById.delete(roomId);
    dirtyRoomIds.delete(roomId);
    if (activeRoomId === roomId) activeRoomId = null;
  }

  function commitRoom(roomId: string, roomData: EditorRoomData): void {
    const dehydrateStartMs = isDev() ? performance.now() : 0;
    const jsonDef = editorRoomDataToJson(roomData);
    const saved = dehydrateRoom(jsonDef);
    const adjusted = applyWorldMapRoomMetadata(saved, worldMapRoomById.get(roomId));
    rawRoomsById.set(roomId, adjusted);
    hydratedRoomsById.set(roomId, roomData);
    hydratedNextUidById.delete(roomId);
    dirtyRoomIds.delete(roomId);
    if (isDev()) {
      logTiming('dehydrate room', dehydrateStartMs, `(roomId=${roomId})`);
    }
  }

  function commitActiveRoom(activeRoomData: EditorRoomData | null): void {
    if (activeRoomData === null) return;
    commitRoom(activeRoomData.id, activeRoomData);
  }

  function commitAllDirtyRooms(): void {
    for (const roomId of [...dirtyRoomIds]) {
      const roomData = hydratedRoomsById.get(roomId);
      if (roomData !== undefined) {
        commitRoom(roomId, roomData);
      }
    }
  }

  function buildExportCampaign(baseCampaign: SavedCampaignV1, customBlockDefs?: import('../levels/campaignSchema').SavedCampaignV1['customBlockDefs']): SavedCampaignV1 {
    commitAllDirtyRooms();
    const outputRooms: SavedRoomV2[] = [];
    for (const [roomId, rawRoom] of rawRoomsById) {
      outputRooms.push(applyWorldMapRoomMetadata(rawRoom, worldMapRoomById.get(roomId)));
    }
    const exported: SavedCampaignV1 = {
      v: 1,
      kind: 'DustWeaverCampaign',
      metadata: {
        version: (() => {
          const prev = baseCampaign.metadata?.version;
          return (typeof prev === 'number' && Number.isInteger(prev) && prev >= 1) ? prev + 1 : 1;
        })(),
        lastEditedAt: new Date().toISOString(),
      },
      campaign: {
        ...baseCampaign.campaign,
      },
      worldMap,
      rooms: outputRooms,
      editor: {
        createdWithBuild: String(BUILD_NUMBER),
        lastEditedIso: new Date().toISOString(),
      },
    };
    if (customBlockDefs && customBlockDefs.length > 0) {
      exported.customBlockDefs = customBlockDefs;
    }
    return exported;
  }

  return {
    campaignMeta: campaign.campaign,
    worldMap,
    rawRoomsById,
    worldMapRoomById,
    dirtyRoomIds,
    hydratedRoomsById,
    get activeRoomId(): string | null {
      return activeRoomId;
    },
    setActiveRoomId,
    updateWorldMap,
    getRoom,
    markRoomDirty,
    discardRoomChanges,
    commitRoom,
    commitActiveRoom,
    commitAllDirtyRooms,
    buildExportCampaign,
  };
}
