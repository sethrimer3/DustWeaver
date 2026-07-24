import type { EditorRoomData } from './editorState';
import {
  capturePendingRoomFields,
  commitPendingSnapshot,
  type EditorHistory,
  type HistoryCommitResult,
} from './editorHistory';

/**
 * DOM-free transaction boundary for a room-level metadata control.
 * Property labels deliberately coalesce repeated input events for one field.
 */
export function runRoomFieldMutation(
  history: EditorHistory,
  room: EditorRoomData,
  field: string,
  mutate: (room: EditorRoomData) => void,
): HistoryCommitResult {
  const rootField = field.split('.')[0] as keyof EditorRoomData;
  const pending = capturePendingRoomFields(room, [rootField], `Property:room.${field}`);
  mutate(room);
  return commitPendingSnapshot(history, pending);
}
