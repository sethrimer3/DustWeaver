/**
 * Editor export — triggers browser downloads of room JSON and world-map JSON.
 *
 * Rooms are saved in the compact v2 schema (`SavedRoomV2`) by default.  The
 * loader auto-detects v2 vs. legacy so older files keep working.
 */

import type { EditorRoomData } from './editorState';
import { editorRoomDataToJson } from './roomJson';
import { roomDefToEditorRoomData } from './editorRoomBuilder';
import { dehydrateRoom, validateRoomRoundtrip } from '../levels/roomSchemaV2';
import {
  ROOM_REGISTRY,
} from '../levels/rooms';

/**
 * Exports the given editor room data as a downloadable .json file using the
 * compact v2 schema. In development builds we also run a dehydrate→hydrate
 * round-trip assertion so encoding regressions are caught immediately.
 */
export function exportRoomAsJson(data: EditorRoomData): void {
  const verboseJson = editorRoomDataToJson(data);
  const savedV2 = dehydrateRoom(verboseJson);

  if (import.meta.env.DEV) {
    const errors = validateRoomRoundtrip(verboseJson);
    if (errors.length > 0) {
      console.error(`[editorExport] Round-trip validation failed for room "${data.id}":`, errors);
    }
  }

  const text = JSON.stringify(savedV2, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.id}_room.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so browsers have time to begin reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Exports every room currently in the registry as individual JSON files. */
export function exportWorldMapJson(): void {
  for (const [, roomDef] of ROOM_REGISTRY) {
    const { data } = roomDefToEditorRoomData(roomDef, 1);
    exportRoomAsJson(data);
  }
}

/**
 * Exports all changed or newly-added rooms. If world-map metadata changed,
 * all rooms are exported because map/name/world metadata is room-local JSON now.
 *
 * @param pendingRoomEdits  Map of roomId → EditorRoomData for rooms explicitly
 *                          saved during this editor session.
 * @param initialRoomIds    Set of room IDs that existed when the editor session
 *                          started (used to identify newly-added rooms).
 * @param isWorldMapDirty   True if world-map metadata was changed this session.
 */
export function exportAllChanges(
  pendingRoomEdits: ReadonlyMap<string, EditorRoomData>,
  initialRoomIds: ReadonlySet<string>,
  isWorldMapDirty: boolean,
): number {
  let exportCount = 0;
  const exportedRoomIds = new Set<string>();

  // Export every room in the pending-edits store.
  for (const [, data] of pendingRoomEdits) {
    exportRoomAsJson(data);
    exportCount += 1;
    exportedRoomIds.add(data.id);
  }

  // Export newly-added rooms that were never explicitly saved (blank rooms).
  for (const [id, roomDef] of ROOM_REGISTRY) {
    if (!initialRoomIds.has(id) && !pendingRoomEdits.has(id) && !exportedRoomIds.has(id)) {
      const { data } = roomDefToEditorRoomData(roomDef, 1);
      exportRoomAsJson(data);
      exportCount += 1;
      exportedRoomIds.add(id);
    }
  }

  if (isWorldMapDirty) {
    for (const [, roomDef] of ROOM_REGISTRY) {
      if (exportedRoomIds.has(roomDef.id)) continue;
      const { data } = roomDefToEditorRoomData(roomDef, 1);
      exportRoomAsJson(data);
      exportCount += 1;
      exportedRoomIds.add(roomDef.id);
    }
  }

  return exportCount;
}
