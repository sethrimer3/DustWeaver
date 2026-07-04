import type { RoomDef } from '../levels/roomDef';

// Matches canonical 480x270 virtual resolution at medium block size (6 world units):
// 480 / 6 = 80 blocks wide, 270 / 6 = 45 blocks high.
const FALLBACK_ROOM_WIDTH_BLOCKS = 80;
const FALLBACK_ROOM_HEIGHT_BLOCKS = 45;

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
    widthBlocks: FALLBACK_ROOM_WIDTH_BLOCKS,
    heightBlocks: FALLBACK_ROOM_HEIGHT_BLOCKS,
    walls: [
      { xBlock: 0, yBlock: FALLBACK_ROOM_HEIGHT_BLOCKS - 1, wBlock: FALLBACK_ROOM_WIDTH_BLOCKS, hBlock: 1 },
      { xBlock: 0, yBlock: 0, wBlock: 1, hBlock: FALLBACK_ROOM_HEIGHT_BLOCKS },
      { xBlock: FALLBACK_ROOM_WIDTH_BLOCKS - 1, yBlock: 0, wBlock: 1, hBlock: FALLBACK_ROOM_HEIGHT_BLOCKS },
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
  const firstRegistryRoom: RoomDef | null = roomRegistry.values().next().value ?? null;
  const configuredSpawnRoom: RoomDef | null = roomRegistry.get('lobby')
    ?? roomRegistry.get(startingRoomId)
    ?? firstRegistryRoom;
  const requestedStartRoomFromId = startRoomId !== null ? roomRegistry.get(startRoomId) : null;
  const requestedStartRoom: RoomDef | null = requestedStartRoomFromId
    ?? roomRegistry.get(startingRoomId)
    ?? configuredSpawnRoom;
  const fallbackRoom = createFallbackRoomDef();
  const campaignSpawnRoom: RoomDef = (campaignSpawnBlockOverride != null
    ? requestedStartRoom
    : configuredSpawnRoom) ?? fallbackRoom;
  const initialRoom: RoomDef = requestedStartRoom ?? campaignSpawnRoom;
  const campaignSpawnBlock: readonly [number, number] =
    campaignSpawnBlockOverride ?? campaignSpawnRoom.playerSpawnBlock;
  // Failsafe rules: with an explicit start room, only its absence indicates
  // broken wiring.  The 'lobby' presence check applies only when no start room
  // was requested — packed custom campaigns replace the registry and rarely
  // contain a room named 'lobby', so requiring it would force-open the editor
  // for every custom campaign played from the menu.
  const shouldOpenFailsafeEditor = hasCampaignSession
    ? (openEditorImmediately === true)
    : (startRoomId !== null
      ? roomRegistry.get(startRoomId) === undefined
      : !roomRegistry.has('lobby'));
  return {
    configuredSpawnRoom,
    requestedStartRoom,
    campaignSpawnRoom,
    initialRoom,
    campaignSpawnBlock,
    shouldOpenFailsafeEditor,
  };
}
