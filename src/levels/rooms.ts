/**
 * Metroidvania room definitions — barrel file.
 *
 * Layout:
 *   World 3 ← World 2 ← [LOBBY] → World 1
 *
 * Room data is loaded at startup from individual JSON files in ASSETS/ROOMS/.
 * Each room has its own .json file, listed in ASSETS/ROOMS/manifest.json.
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

/**
 * Loads all room JSON files from ASSETS/ROOMS/ and populates ROOM_REGISTRY.
 * Must be called (and awaited) before the game starts.
 */
export async function initRoomRegistry(): Promise<void> {
  const rooms = await loadRoomJsonFiles();
  registryMap.clear();
  for (const [id, room] of rooms) {
    registryMap.set(id, room);
  }
  console.log(`[rooms] Loaded ${registryMap.size} rooms from JSON`);
}
