/**
 * Editor export — triggers browser downloads of room JSON and world-map JSON.
 */

import type { EditorRoomData } from './editorState';
import { editorRoomDataToJson } from './roomJson';
import type { WorldMapJsonDef } from './worldMapData';
import {
  ROOM_REGISTRY,
  WORLD_NAMES,
  WORLD_MAP_POSITIONS,
  ROOM_NAME_OVERRIDES,
  ROOM_WORLD_OVERRIDES,
} from '../levels/rooms';

/**
 * Exports the given editor room data as a downloadable .json file.
 * The JSON is clean, human-readable, and uses the RoomJsonDef schema.
 */
export function exportRoomAsJson(data: EditorRoomData): void {
  const json = editorRoomDataToJson(data);
  const text = JSON.stringify(json, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.id}_room.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Builds a WorldMapJsonDef from the current in-memory world-map metadata
 * stores, then triggers a browser download of world-map.json.
 *
 * Place the downloaded file at ASSETS/ROOMS/world-map.json so it is loaded
 * the next time the game starts.
 */
export function exportWorldMapJson(): void {
  // Collect every unique world id from room worldNumbers + WORLD_NAMES
  const worldIdSet = new Set<number>();
  for (const [id] of WORLD_NAMES) {
    worldIdSet.add(id);
  }
  for (const [, room] of ROOM_REGISTRY) {
    const effectiveWorldId = ROOM_WORLD_OVERRIDES.get(room.id) ?? room.worldNumber;
    worldIdSet.add(effectiveWorldId);
  }

  const sortedWorldIds = [...worldIdSet].sort((a, b) => a - b);
  const worlds = sortedWorldIds.map(id => ({
    id,
    name: WORLD_NAMES.get(id) ?? `World ${id}`,
  }));

  const rooms = [...ROOM_REGISTRY.values()].map(room => {
    const pos = WORLD_MAP_POSITIONS.get(room.id);
    return {
      id: room.id,
      name: ROOM_NAME_OVERRIDES.get(room.id) ?? room.name,
      worldId: ROOM_WORLD_OVERRIDES.get(room.id) ?? room.worldNumber,
      mapX: pos?.mapX ?? 0,
      mapY: pos?.mapY ?? 0,
    };
  });

  const def: WorldMapJsonDef = { worlds, rooms };
  const text = JSON.stringify(def, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'world-map.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
