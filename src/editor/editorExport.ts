/**
 * Editor export — triggers a browser download of the current room as JSON.
 */

import type { EditorRoomData } from './editorState';
import { editorRoomDataToJson } from './roomJson';

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
