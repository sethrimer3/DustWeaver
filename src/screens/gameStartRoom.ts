import type { RoomDef } from '../levels/roomDef';

export interface GameStartRoomSelection {
  configuredSpawnRoom: RoomDef | null;
  requestedStartRoom: RoomDef | null;
  campaignSpawnRoom: RoomDef;
  initialRoom: RoomDef;
  campaignSpawnBlock: readonly [number, number];
  shouldOpenFailsafeEditor: boolean;
}

interface ResolveGameStartRoomSelectionParams {
  roomRegistry: ReadonlyMap<string, RoomDef>;
  startingRoomId: string;
  startRoomId: string | null;
  hasCampaignSession: boolean;
  openEditorImmediately?: boolean;
  campaignSpawnBlockOverride?: readonly [number, number] | null;
}

function createFallbackRoomDef(): RoomDef {
  return {
    id: 'fallback_boot_room',
    name: 'Fallback Room',
    worldNumber: 1,
    mapX: 0,
    mapY: 0,
    widthBlocks: 80,
    heightBlocks: 45,
    walls: [
      { xBlock: 0, yBlock: 44, wBlock: 80, hBlock: 1 },
      { xBlock: 0, yBlock: 0, wBlock: 1, hBlock: 45 },
      { xBlock: 79, yBlock: 0, wBlock: 1, hBlock: 45 },
    ],
    enemies: [],
    playerSpawnBlock: [40, 40],
    transitions: [],
    saveTombs: [],
    skillTombs: [],
  };
}

export function resolveGameStartRoomSelection(
  params: ResolveGameStartRoomSelectionParams,
): GameStartRoomSelection {
  const {
    roomRegistry,
    startingRoomId,
    startRoomId,
    hasCampaignSession,
    openEditorImmediately,
    campaignSpawnBlockOverride,
  } = params;
  const firstAvailableRoom: RoomDef | null = roomRegistry.values().next().value ?? null;
  const configuredSpawnRoom: RoomDef | null = roomRegistry.get('lobby')
    ?? roomRegistry.get(startingRoomId)
    ?? firstAvailableRoom;
  const requestedStartRoom: RoomDef | null = (startRoomId !== null ? roomRegistry.get(startRoomId) : undefined)
    ?? roomRegistry.get(startingRoomId)
    ?? configuredSpawnRoom;
  const fallbackRoom = createFallbackRoomDef();
  const campaignSpawnRoom: RoomDef = (campaignSpawnBlockOverride != null
    ? requestedStartRoom
    : configuredSpawnRoom) ?? fallbackRoom;
  const initialRoom: RoomDef = requestedStartRoom ?? campaignSpawnRoom;
  const campaignSpawnBlock: readonly [number, number] =
    campaignSpawnBlockOverride ?? campaignSpawnRoom.playerSpawnBlock;
  const shouldOpenFailsafeEditor = hasCampaignSession
    ? (openEditorImmediately === true)
    : ((startRoomId !== null && roomRegistry.get(startRoomId) === undefined)
      || !roomRegistry.has('lobby'));
  return {
    configuredSpawnRoom,
    requestedStartRoom,
    campaignSpawnRoom,
    initialRoom,
    campaignSpawnBlock,
    shouldOpenFailsafeEditor,
  };
}
