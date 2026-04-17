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
