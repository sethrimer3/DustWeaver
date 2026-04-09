/**
 * World-map data — types for the persistent world-map.json file.
 *
 * world-map.json stores world definitions and per-room metadata (name, world
 * assignment, and visual map position) independently of the individual room
 * JSON files.  This lets the editor rename rooms, move them between worlds,
 * and save layout positions without rewriting every room file.
 *
 * The file lives at ASSETS/ROOMS/world-map.json and is loaded at startup.
 * Use exportWorldMapJson() (editorExport.ts) to download an updated copy.
 */

export interface WorldMapWorldEntry {
  /** World number — matches RoomDef.worldNumber. */
  id: number;
  /** Display name for this world group. */
  name: string;
}

export interface WorldMapRoomEntry {
  /** Room id — matches RoomDef.id. */
  id: string;
  /** Display name (overrides the individual room JSON name in the editor). */
  name: string;
  /** World number this room belongs to. */
  worldId: number;
  /** X position on the visual world map (map world units). */
  mapX: number;
  /** Y position on the visual world map (map world units). */
  mapY: number;
}

export interface WorldMapJsonDef {
  worlds: WorldMapWorldEntry[];
  rooms: WorldMapRoomEntry[];
}
