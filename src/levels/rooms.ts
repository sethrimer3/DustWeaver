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
import type { SavedCampaignV1 } from './campaignSchema';
import { hydrateSavedCampaignToRoomDefs } from './campaignSchema';

// ── Room registry ────────────────────────────────────────────────────────────

/** Mutable backing store — populated by initRoomRegistry(). */
const registryMap = new Map<string, RoomDef>();

/** All rooms keyed by id for quick lookup. */
export const ROOM_REGISTRY: ReadonlyMap<string, RoomDef> = registryMap;

/** The room the player starts in. */
export const STARTING_ROOM_ID = 'lobby';

// ── World-map metadata stores ─────────────────────────────────────────────────

/** World id → display name. Populated from room world ids. */
const worldNamesMap = new Map<number, string>();

/** Room id → visual map position (map world units). */
const worldMapPositions = new Map<string, { mapX: number; mapY: number }>();

/** Room id → display name override (overrides the room JSON name). */
const roomNameOverridesMap = new Map<string, string>();

/** Room id → world id override (overrides the room JSON worldNumber). */
const roomWorldOverridesMap = new Map<string, number>();

/** World id → display name (read-only view). */
export const WORLD_NAMES: ReadonlyMap<number, string> = worldNamesMap;
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
}

/**
 * Loads all room JSON files from CAMPAIGNS/<CAMPAIGN_ID>/ROOMS/ and populates ROOM_REGISTRY.
 * Must be called (and awaited) before the game starts.
 */
export async function initRoomRegistry(): Promise<void> {
  const rooms = await loadRoomJsonFiles();
  registryMap.clear();
  worldNamesMap.clear();
  worldMapPositions.clear();
  roomNameOverridesMap.clear();
  roomWorldOverridesMap.clear();
  for (const [id, room] of rooms) {
    registryMap.set(id, room);
    worldMapPositions.set(id, { mapX: room.mapX, mapY: room.mapY });
    worldNamesMap.set(room.worldNumber, worldNamesMap.get(room.worldNumber) ?? `World ${room.worldNumber}`);
  }
  console.log(`[rooms] Loaded ${registryMap.size} rooms from JSON`);
}

// ── Main-campaign snapshot (for restoring after custom-campaign sessions) ─────

/** Saved snapshot of the main campaign registry state. */
let mainCampaignSnapshot: Map<string, RoomDef> | null = null;
let mainWorldNamesSnapshot: Map<number, string> | null = null;
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
  mainWorldMapPositionsSnapshot = new Map(worldMapPositions);
}

/**
 * Restores the ROOM_REGISTRY to the state captured by `captureMainCampaignSnapshot()`.
 * Call this when returning from a custom-campaign session to the main menu.
 *
 * No-op if no snapshot has been captured.
 */
export function restoreMainCampaignSnapshot(): void {
  if (!mainCampaignSnapshot || !mainWorldNamesSnapshot || !mainWorldMapPositionsSnapshot) return;
  registryMap.clear();
  worldNamesMap.clear();
  worldMapPositions.clear();
  roomNameOverridesMap.clear();
  roomWorldOverridesMap.clear();
  for (const [k, v] of mainCampaignSnapshot) registryMap.set(k, v);
  for (const [k, v] of mainWorldNamesSnapshot) worldNamesMap.set(k, v);
  for (const [k, v] of mainWorldMapPositionsSnapshot) worldMapPositions.set(k, v);
}

/**
 * Replaces the current ROOM_REGISTRY with rooms from a packed campaign.
 * World-map metadata (world names, map positions) is also replaced.
 *
 * Used when launching Play or Edit for a packed custom campaign.
 * Call `restoreMainCampaignSnapshot()` to undo when returning to the main menu.
 */
export function registerRoomsFromPackedCampaign(campaign: SavedCampaignV1): void {
  const rooms = hydrateSavedCampaignToRoomDefs(campaign);

  registryMap.clear();
  worldNamesMap.clear();
  worldMapPositions.clear();
  roomNameOverridesMap.clear();
  roomWorldOverridesMap.clear();

  for (const [id, room] of rooms) {
    registryMap.set(id, room);
    worldMapPositions.set(id, { mapX: room.mapX, mapY: room.mapY });
  }

  // Populate world names from the campaign's worldMap.
  for (const world of campaign.worldMap.worlds) {
    worldNamesMap.set(world.id, world.name);
  }
  // Fill gaps for any worlds referenced by rooms but missing from worldMap.worlds.
  for (const [, room] of rooms) {
    if (!worldNamesMap.has(room.worldNumber)) {
      worldNamesMap.set(room.worldNumber, `World ${room.worldNumber}`);
    }
  }

  console.log(`[rooms] Registered ${registryMap.size} rooms from packed campaign "${campaign.campaign.id}"`);
}
