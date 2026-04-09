/**
 * Metroidvania room definitions — barrel file.
 *
 * Layout:
 *   World 3 ← World 2 ← [LOBBY] → World 1
 *
 * Room data is loaded at startup from individual JSON files in ASSETS/ROOMS/.
 * Each room has its own .json file, listed in ASSETS/ROOMS/manifest.json.
 *
 * An optional ASSETS/ROOMS/world-map.json file stores world names, room name
 * overrides, world assignment overrides, and visual map positions.  The editor
 * reads and writes these stores; use exportWorldMapJson() to persist them.
 *
 * Call `initRoomRegistry()` at startup (before starting the game) to
 * populate the registry from the JSON data files.
 */

import { RoomDef } from './roomDef';
import { loadRoomJsonFiles, loadWorldMapJson } from './roomJsonLoader';

// ── Room registry ────────────────────────────────────────────────────────────

/** Mutable backing store — populated by initRoomRegistry(). */
const registryMap = new Map<string, RoomDef>();

/** All rooms keyed by id for quick lookup. */
export const ROOM_REGISTRY: ReadonlyMap<string, RoomDef> = registryMap;

/** The room the player starts in. */
export const STARTING_ROOM_ID = 'lobby';

// ── World-map metadata stores ─────────────────────────────────────────────────

/** World id → display name.  Populated from world-map.json if present. */
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
}

/** Sets the name override for a room. */
export function setRoomNameOverride(roomId: string, name: string): void {
  roomNameOverridesMap.set(roomId, name);
}

/** Sets the world id override for a room. */
export function setRoomWorldOverride(roomId: string, worldId: number): void {
  roomWorldOverridesMap.set(roomId, worldId);
}

/**
 * Registers a RoomDef directly into the registry.
 * Used by the editor when a new room is created at runtime.
 */
export function registerRoom(room: RoomDef): void {
  registryMap.set(room.id, room);
}

/**
 * Loads all room JSON files from ASSETS/ROOMS/ and populates ROOM_REGISTRY.
 * Also loads world-map.json (if present) to populate world-map metadata stores.
 * Must be called (and awaited) before the game starts.
 */
export async function initRoomRegistry(): Promise<void> {
  const rooms = await loadRoomJsonFiles();
  registryMap.clear();
  for (const [id, room] of rooms) {
    registryMap.set(id, room);
  }
  console.log(`[rooms] Loaded ${registryMap.size} rooms from JSON`);

  // Load optional world-map.json
  const worldMap = await loadWorldMapJson();
  if (worldMap) {
    for (const w of worldMap.worlds) {
      worldNamesMap.set(w.id, w.name);
    }
    for (const r of worldMap.rooms) {
      worldMapPositions.set(r.id, { mapX: r.mapX, mapY: r.mapY });
      // Only set name/world overrides when they differ from the room JSON,
      // so that updating the room JSON later is not silently masked.
      const room = registryMap.get(r.id);
      if (room && r.name !== room.name) {
        roomNameOverridesMap.set(r.id, r.name);
      } else if (!room) {
        // Room not in registry yet — still record the override
        roomNameOverridesMap.set(r.id, r.name);
      }
      if (room && r.worldId !== room.worldNumber) {
        roomWorldOverridesMap.set(r.id, r.worldId);
      } else if (!room) {
        roomWorldOverridesMap.set(r.id, r.worldId);
      }
    }
    console.log(`[rooms] Loaded world-map.json: ${worldMap.worlds.length} worlds, ${worldMap.rooms.length} room entries`);
  }
}
