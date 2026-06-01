/**
 * Metroidvania room definitions — barrel file.
 *
 * Layout:
 *   World 3 ← World 2 ← [LOBBY] → World 1
 *
 * Room data is loaded at startup from individual JSON files in CAMPAIGNS/<CAMPAIGN_ID>/ROOMS/.
 * Each room has its own .json file, listed in CAMPAIGNS/<CAMPAIGN_ID>/ROOMS/manifest.json.
 *
 * World-map metadata now lives directly in each room JSON file (mapX/mapY,
 * name, and worldNumber). The editor still reads/writes these stores as a
 * runtime cache and mutates the underlying room records.
 *
 * Call `initRoomRegistry()` at startup (before starting the game) to
 * populate the registry from the JSON data files.
 */

import { RoomDef } from './roomDef';
import { loadRoomJsonFiles } from './roomJsonLoader';
import type { SavedCampaignV1, SavedCampaignRevisionMetadata, CampaignSpawnData } from './campaignSchema';
import { hydrateSavedCampaignToRoomDefs } from './campaignSchema';
import { fetchOfficialPackedCampaign } from './packedCampaignLoader';

// ── Room registry ────────────────────────────────────────────────────────────

/** Mutable backing store — populated by initRoomRegistry(). */
const registryMap = new Map<string, RoomDef>();

/** All rooms keyed by id for quick lookup. */
export const ROOM_REGISTRY: ReadonlyMap<string, RoomDef> = registryMap;

/** The room the player starts in. */
export const STARTING_ROOM_ID = 'lobby';

/** Revision metadata from the last successfully loaded official campaign file. Null before init. */
let loadedOfficialCampaignRevisionMetadata: SavedCampaignRevisionMetadata | null = null;

/** Campaign spawn from the last successfully loaded official campaign file. Null before init or if absent. */
let loadedOfficialCampaignSpawn: CampaignSpawnData | null = null;

/**
 * Returns the revision metadata from the loaded official packed campaign, or null
 * if the campaign was not loaded from a packed file or has no metadata.
 * Used by the editor to propagate the existing version number on re-export.
 */
export function getLoadedOfficialCampaignRevisionMetadata(): SavedCampaignRevisionMetadata | null {
  return loadedOfficialCampaignRevisionMetadata;
}

/**
 * Returns the campaign spawn from the loaded official packed campaign, or null
 * if the campaign was not loaded from a packed file or has no campaignSpawn.
 * Used by game.ts to determine the initial room and spawn position.
 */
export function getLoadedOfficialCampaignSpawn(): CampaignSpawnData | null {
  return loadedOfficialCampaignSpawn;
}

// ── World-map metadata stores ─────────────────────────────────────────────────

/** World id → display name. Populated from room world ids. */
const worldNamesMap = new Map<number, string>();
const worldOrderMap = new Map<number, number>();

/** Room id → visual map position (map world units). */
const worldMapPositions = new Map<string, { mapX: number; mapY: number }>();

/** Room id → display name override (overrides the room JSON name). */
const roomNameOverridesMap = new Map<string, string>();

/** Room id → world id override (overrides the room JSON worldNumber). */
const roomWorldOverridesMap = new Map<string, number>();

/** World id → display name (read-only view). */
export const WORLD_NAMES: ReadonlyMap<number, string> = worldNamesMap;
export const WORLD_ORDER: ReadonlyMap<number, number> = worldOrderMap;
/** Room id → visual map position (read-only view). */
export const WORLD_MAP_POSITIONS: ReadonlyMap<string, { mapX: number; mapY: number }> = worldMapPositions;
/** Room id → name override (read-only view). */
export const ROOM_NAME_OVERRIDES: ReadonlyMap<string, string> = roomNameOverridesMap;
/** Room id → world id override (read-only view). */
export const ROOM_WORLD_OVERRIDES: ReadonlyMap<string, number> = roomWorldOverridesMap;

// ── World-map metadata mutators (editor only) ─────────────────────────────────

/** Sets the display name for a world id. */
export function setWorldName(worldId: number, name: string): void {
  worldNamesMap.set(worldId, name);
  if (!worldOrderMap.has(worldId)) worldOrderMap.set(worldId, worldOrderMap.size);
}

export function setWorldOrder(worldId: number, order: number): void {
  worldOrderMap.set(worldId, order);
}

/** Sets the visual map position for a room. */
export function setRoomMapPosition(roomId: string, mapX: number, mapY: number): void {
  worldMapPositions.set(roomId, { mapX, mapY });
  const room = registryMap.get(roomId);
  if (room) {
    room.mapX = mapX;
    room.mapY = mapY;
  }
}

/** Sets the name override for a room. */
export function setRoomNameOverride(roomId: string, name: string): void {
  roomNameOverridesMap.set(roomId, name);
  const room = registryMap.get(roomId);
  if (room) {
    room.name = name;
  }
}

/** Sets the world id override for a room. */
export function setRoomWorldOverride(roomId: string, worldId: number): void {
  roomWorldOverridesMap.set(roomId, worldId);
  const room = registryMap.get(roomId);
  if (room) {
    room.worldNumber = worldId;
    if (!worldNamesMap.has(worldId)) {
      worldNamesMap.set(worldId, `World ${worldId}`);
    }
    if (!worldOrderMap.has(worldId)) worldOrderMap.set(worldId, worldOrderMap.size);
  }
}

/** Links one room transition to another room and spawn point. */
export function setRoomTransitionLink(
  roomId: string,
  transitionIndex: number,
  targetRoomId: string,
  targetSpawnBlock: readonly [number, number],
): boolean {
  const room = registryMap.get(roomId);
  const transitions = room?.transitions as RoomDef['transitions'] | undefined;
  const transition = transitions?.[transitionIndex];
  if (!room || !transition) return false;

  (transition as {
    targetRoomId: string;
    targetSpawnBlock: readonly [number, number];
  }).targetRoomId = targetRoomId;
  (transition as {
    targetRoomId: string;
    targetSpawnBlock: readonly [number, number];
  }).targetSpawnBlock = [targetSpawnBlock[0], targetSpawnBlock[1]] as readonly [number, number];
  return true;
}

/**
 * Registers a RoomDef directly into the registry.
 * Used by the editor when a new room is created at runtime.
 */
export function registerRoom(room: RoomDef): void {
  registryMap.set(room.id, room);
  worldMapPositions.set(room.id, { mapX: room.mapX, mapY: room.mapY });
  if (!worldNamesMap.has(room.worldNumber)) {
    worldNamesMap.set(room.worldNumber, `World ${room.worldNumber}`);
  }
  if (!worldOrderMap.has(room.worldNumber)) worldOrderMap.set(room.worldNumber, worldOrderMap.size);
}

/**
 * Loads the official campaign and populates ROOM_REGISTRY.
 *
 * Primary path: loads from the canonical packed campaign file
 * `ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/DustweaverCampaign.dwcampaign.json`.
 * World-map metadata (world names, map positions) is read from the campaign file.
 *
 * Fallback: if the packed file is unavailable or invalid, falls back to loading
 * individual room JSON files from `CAMPAIGNS/DUSTWEAVER_CAMPAIGN/ROOMS/`.
 *
 * Must be called (and awaited) before the game starts.
 */
export async function initRoomRegistry(): Promise<void> {
  registryMap.clear();
  worldNamesMap.clear();
  worldOrderMap.clear();
  worldMapPositions.clear();
  roomNameOverridesMap.clear();
  roomWorldOverridesMap.clear();
  loadedOfficialCampaignRevisionMetadata = null;
  loadedOfficialCampaignSpawn = null;

  // ── Primary: load from packed campaign file ────────────────────────────────
  const packedCampaign = await fetchOfficialPackedCampaign();
  if (packedCampaign !== null) {
    const rooms = hydrateSavedCampaignToRoomDefs(packedCampaign);
    for (const [id, room] of rooms) {
      registryMap.set(id, room);
      worldMapPositions.set(id, { mapX: room.mapX, mapY: room.mapY });
    }
    for (let worldIndex = 0; worldIndex < packedCampaign.worldMap.worlds.length; worldIndex++) {
      const world = packedCampaign.worldMap.worlds[worldIndex];
      worldNamesMap.set(world.id, world.name);
      worldOrderMap.set(world.id, world.order ?? worldIndex);
    }
    for (const [, room] of rooms) {
      if (!worldNamesMap.has(room.worldNumber)) {
        worldNamesMap.set(room.worldNumber, `World ${room.worldNumber}`);
      }
      if (!worldOrderMap.has(room.worldNumber)) worldOrderMap.set(room.worldNumber, worldOrderMap.size);
    }
    loadedOfficialCampaignRevisionMetadata = packedCampaign.metadata ?? null;
    loadedOfficialCampaignSpawn = packedCampaign.campaign.campaignSpawn ?? null;
    console.log(
      `[rooms] Loaded ${registryMap.size} rooms from packed campaign ` +
      `"${packedCampaign.campaign.id}" (initialRoom: ${packedCampaign.campaign.initialRoomId})`
    );
    return;
  }

  // ── Fallback: load individual room JSON files ──────────────────────────────
  console.warn(
    '[rooms] Official packed campaign file unavailable — falling back to individual room JSON files. ' +
    'Export the campaign from the editor and place it at ' +
    'ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/DustweaverCampaign.dwcampaign.json'
  );
  const rooms = await loadRoomJsonFiles();
  for (const [id, room] of rooms) {
    registryMap.set(id, room);
    worldMapPositions.set(id, { mapX: room.mapX, mapY: room.mapY });
    worldNamesMap.set(room.worldNumber, worldNamesMap.get(room.worldNumber) ?? `World ${room.worldNumber}`);
    if (!worldOrderMap.has(room.worldNumber)) worldOrderMap.set(room.worldNumber, worldOrderMap.size);
  }
  console.log(`[rooms] Loaded ${registryMap.size} rooms from individual JSON files (fallback)`);
}

// ── Main-campaign snapshot (for restoring after custom-campaign sessions) ─────

/** Saved snapshot of the main campaign registry state. */
let mainCampaignSnapshot: Map<string, RoomDef> | null = null;
let mainWorldNamesSnapshot: Map<number, string> | null = null;
let mainWorldOrderSnapshot: Map<number, number> | null = null;
let mainWorldMapPositionsSnapshot: Map<string, { mapX: number; mapY: number }> | null = null;

/**
 * Captures a snapshot of the current ROOM_REGISTRY state so it can be
 * restored after a custom-campaign session ends.
 *
 * Call this once after `initRoomRegistry()` succeeds (in main.ts).
 */
export function captureMainCampaignSnapshot(): void {
  mainCampaignSnapshot = new Map(registryMap);
  mainWorldNamesSnapshot = new Map(worldNamesMap);
  mainWorldOrderSnapshot = new Map(worldOrderMap);
  mainWorldMapPositionsSnapshot = new Map(worldMapPositions);
}

/**
 * Restores the ROOM_REGISTRY to the state captured by `captureMainCampaignSnapshot()`.
 * Call this when returning from a custom-campaign session to the main menu.
 *
 * No-op if no snapshot has been captured.
 */
export function restoreMainCampaignSnapshot(): void {
  if (!mainCampaignSnapshot || !mainWorldNamesSnapshot || !mainWorldOrderSnapshot || !mainWorldMapPositionsSnapshot) return;
  registryMap.clear();
  worldNamesMap.clear();
  worldOrderMap.clear();
  worldMapPositions.clear();
  roomNameOverridesMap.clear();
  roomWorldOverridesMap.clear();
  for (const [k, v] of mainCampaignSnapshot) registryMap.set(k, v);
  for (const [k, v] of mainWorldNamesSnapshot) worldNamesMap.set(k, v);
  for (const [k, v] of mainWorldOrderSnapshot) worldOrderMap.set(k, v);
  for (const [k, v] of mainWorldMapPositionsSnapshot) worldMapPositions.set(k, v);
}

/**
 * Clears the entire registry and applies world-map metadata from the given
 * campaign WITHOUT loading any rooms.
 *
 * Used by the file-based room loading path (Electron only) to prepare the
 * registry for incremental room registration via `registerRoom()`, while still
 * applying world names and map positions from the campaign's worldMap the same
 * way that `registerRoomsFromPackedCampaign` does.
 *
 * World map positions are populated from `campaign.worldMap.rooms` so that
 * the minimap and world-map UI function correctly even when room data is loaded
 * lazily and the registry is only partially populated.
 *
 * After calling this function, the registry is empty.  The caller is
 * responsible for populating it via `registerRoom()` before gameplay starts.
 */
export function clearRegistryAndApplyCampaignMetadata(campaign: SavedCampaignV1): void {
  registryMap.clear();
  worldNamesMap.clear();
  worldOrderMap.clear();
  worldMapPositions.clear();
  roomNameOverridesMap.clear();
  roomWorldOverridesMap.clear();

  // Populate world names from the campaign's worldMap.worlds so that proper
  // names (e.g. "Ancient Ruins") are used instead of the "World N" fallbacks.
  for (let worldIndex = 0; worldIndex < campaign.worldMap.worlds.length; worldIndex++) {
    const world = campaign.worldMap.worlds[worldIndex];
    worldNamesMap.set(world.id, world.name);
    worldOrderMap.set(world.id, world.order ?? worldIndex);
  }

  // Populate world map positions from the campaign's worldMap.rooms so that
  // the minimap and world-map overlay show correct positions for rooms that
  // have not yet been lazily loaded into the registry.
  for (const wmRoom of campaign.worldMap.rooms) {
    worldMapPositions.set(wmRoom.id, { mapX: wmRoom.mapX, mapY: wmRoom.mapY });
  }
}

/**
 * Applies official-campaign-specific metadata (revision info and campaign spawn)
 * to the module-level metadata fields WITHOUT touching ROOM_REGISTRY.
 *
 * Call this when the official campaign is loaded via the file-cache path
 * (Electron only) to ensure `getLoadedOfficialCampaignRevisionMetadata()` and
 * `getLoadedOfficialCampaignSpawn()` return the correct values even though
 * `initRoomRegistry()` was not called.
 *
 * Editor mode: not needed — editor calls `initRoomRegistry()` which sets these.
 * Gameplay mode: called from `main.ts` when using the lazy file-cache path.
 */
export function applyOfficialCampaignMetadata(campaign: SavedCampaignV1): void {
  loadedOfficialCampaignRevisionMetadata = campaign.metadata ?? null;
  loadedOfficialCampaignSpawn = campaign.campaign.campaignSpawn ?? null;
}


export function registerRoomsFromPackedCampaign(campaign: SavedCampaignV1): void {
  const rooms = hydrateSavedCampaignToRoomDefs(campaign);

  registryMap.clear();
  worldNamesMap.clear();
  worldOrderMap.clear();
  worldMapPositions.clear();
  roomNameOverridesMap.clear();
  roomWorldOverridesMap.clear();

  for (const [id, room] of rooms) {
    registryMap.set(id, room);
    worldMapPositions.set(id, { mapX: room.mapX, mapY: room.mapY });
  }

  // Populate world names from the campaign's worldMap.
  for (let worldIndex = 0; worldIndex < campaign.worldMap.worlds.length; worldIndex++) {
    const world = campaign.worldMap.worlds[worldIndex];
    worldNamesMap.set(world.id, world.name);
    worldOrderMap.set(world.id, world.order ?? worldIndex);
  }
  // Fill gaps for any worlds referenced by rooms but missing from worldMap.worlds.
  for (const [, room] of rooms) {
    if (!worldNamesMap.has(room.worldNumber)) {
      worldNamesMap.set(room.worldNumber, `World ${room.worldNumber}`);
    }
    if (!worldOrderMap.has(room.worldNumber)) worldOrderMap.set(room.worldNumber, worldOrderMap.size);
  }

  console.log(`[rooms] Registered ${registryMap.size} rooms from packed campaign "${campaign.campaign.id}"`);
}
