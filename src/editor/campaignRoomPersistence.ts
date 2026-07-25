import type { EditableCampaignSession } from './editableCampaignSession';
import type { EditorRoomData } from './editorState';

/**
 * Production persistence boundary used when connected-room creation completes.
 * Store-backed campaigns commit immediately; pending edits are legacy-only.
 */
export function persistCreatedCampaignRoom(
  session: EditableCampaignSession | null | undefined,
  pendingRoomEdits: Map<string, EditorRoomData>,
  roomData: EditorRoomData,
): 'campaign-store' | 'legacy-pending-edits' {
  const store = session?.campaignStore;
  if (store !== undefined) {
    store.markRoomDirty(roomData.id, roomData);
    store.commitRoom(roomData.id, roomData);
    return 'campaign-store';
  }
  pendingRoomEdits.set(roomData.id, roomData);
  return 'legacy-pending-edits';
}

export function persistSavedCampaignRoom(
  session: EditableCampaignSession | null | undefined,
  pendingRoomEdits: Map<string, EditorRoomData>,
  roomData: EditorRoomData,
): 'campaign-store' | 'legacy-pending-edits' {
  const store = session?.campaignStore;
  if (store !== undefined) {
    store.setActiveRoomId(roomData.id);
    store.commitRoom(roomData.id, roomData);
    return 'campaign-store';
  }
  pendingRoomEdits.set(roomData.id, structuredClone(roomData));
  return 'legacy-pending-edits';
}

export function loadPersistedCampaignRoom(
  session: EditableCampaignSession | null | undefined,
  pendingRoomEdits: ReadonlyMap<string, EditorRoomData>,
  roomId: string,
  startUid: number,
): { roomData: EditorRoomData; nextUid: number; source: 'campaign-store' | 'legacy-pending-edits' } | null {
  const store = session?.campaignStore;
  if (store !== undefined) {
    const loaded = store.getRoom(roomId, startUid);
    store.setActiveRoomId(roomId);
    return { ...loaded, source: 'campaign-store' };
  }
  const pending = pendingRoomEdits.get(roomId);
  if (pending === undefined) return null;
  return {
    roomData: structuredClone(pending),
    nextUid: startUid,
    source: 'legacy-pending-edits',
  };
}
