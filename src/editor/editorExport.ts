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
import { getLoadedOfficialCampaignRevisionMetadata } from '../levels/rooms';
import type { EditableCampaignSession } from './editableCampaignSession';
import { assembleExportCampaign, buildWorldMapFromRegistry } from './editableCampaignSession';
import { WORLD_NAMES } from '../levels/rooms';
import { BUILD_NUMBER } from '../build-info';

// ── Main campaign constants ───────────────────────────────────────────────────
const MAIN_CAMPAIGN_ID = 'DUSTWEAVER_CAMPAIGN';
const MAIN_CAMPAIGN_TITLE = 'DustWeaver';
const MAIN_CAMPAIGN_CREATOR = 'GravyThyme';
const MAIN_CAMPAIGN_DESCRIPTION =
  'The main DustWeaver campaign. This is the core single-player game experience ' +
  'with the canonical world map, progression, and story path.';
const MAIN_CAMPAIGN_INITIAL_ROOM_ID = 'lobby';

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

/**
 * Exports the entire custom campaign as a single `.dwcampaign.json` file.
 *
 * Collects all rooms from ROOM_REGISTRY (the campaign rooms), merges pending
 * room edits, and includes world-map metadata and campaign metadata from the
 * session. The result is a valid SavedCampaignV1 for placement in
 * ASSETS/CAMPAIGNS/CUSTOM/<campaign-id>.dwcampaign.json.
 *
 * @param session          The active campaign editing session.
 * @param pendingRoomEdits  Rooms with unsaved edits (including the current room).
 */
export function exportCampaignJson(
  session: EditableCampaignSession,
  pendingRoomEdits: ReadonlyMap<string, EditorRoomData>,
  activeRoomData?: EditorRoomData | null,
): void {
  let exported: ReturnType<typeof assembleExportCampaign>;
  if (session.campaignStore !== undefined) {
    const worldMap = buildWorldMapFromRegistry(WORLD_NAMES, ROOM_REGISTRY);
    session.campaignStore.updateWorldMap(worldMap);
    if (activeRoomData !== undefined && activeRoomData !== null) {
      session.campaignStore.setActiveRoomId(activeRoomData.id);
      session.campaignStore.commitActiveRoom(activeRoomData);
      if (import.meta.env.DEV) {
        const verboseJson = editorRoomDataToJson(activeRoomData);
        const errors = validateRoomRoundtrip(verboseJson);
        if (errors.length > 0) {
          console.error(`[editorExport] Campaign round-trip validation failed for room "${activeRoomData.id}":`, errors);
        }
      }
    }
    exported = session.campaignStore.buildExportCampaign(session.campaign);
  } else {
    if (import.meta.env.DEV) {
      // Validate round-trip for each pending room.
      for (const [, data] of pendingRoomEdits) {
        const verboseJson = editorRoomDataToJson(data);
        const errors = validateRoomRoundtrip(verboseJson);
        if (errors.length > 0) {
          console.error(`[editorExport] Campaign round-trip validation failed for room "${data.id}":`, errors);
        }
      }
    }
    const worldMap = buildWorldMapFromRegistry(WORLD_NAMES, ROOM_REGISTRY);
    exported = assembleExportCampaign(session, pendingRoomEdits, ROOM_REGISTRY, worldMap);
  }

  const stringifyStartMs = import.meta.env.DEV ? performance.now() : 0;
  const text = JSON.stringify(exported, null, 2);
  if (import.meta.env.DEV) {
    console.log(`[campaignPerf] export stringify: ${(performance.now() - stringifyStartMs).toFixed(2)}ms`);
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  // Wall-clock time is intentionally used here: the date is purely a human-
  // readable suffix on a download filename, not simulation or game state.
  const a = document.createElement('a');
  a.href = url;
  a.download = `${exported.campaign.id}.dwcampaign.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Exports the main DustWeaver campaign as a single `.dwcampaign.json` file.
 *
 * Builds a synthetic EditableCampaignSession from the current ROOM_REGISTRY
 * (dehydrating every room) and merges any pending room edits on top before
 * assembling the final SavedCampaignV1 payload.
 *
 * The exported file is named `DustweaverCampaign.dwcampaign.json` — the
 * canonical runtime filename. Place it under
 * `ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN/` to deploy it.
 *
 * This is the handler for the "Export Campaign" button when editing the main
 * DustWeaver campaign (not a custom campaign session).
 *
 * @param pendingRoomEdits  Rooms with unsaved edits from the current session.
 */
export function exportMainCampaignJson(
  pendingRoomEdits: ReadonlyMap<string, EditorRoomData>,
): void {
  if (import.meta.env.DEV) {
    for (const [, data] of pendingRoomEdits) {
      const verboseJson = editorRoomDataToJson(data);
      const errors = validateRoomRoundtrip(verboseJson);
      if (errors.length > 0) {
        console.error(
          `[editorExport] Main campaign round-trip validation failed for room "${data.id}":`,
          errors,
        );
      }
    }
  }

  // Dehydrate every room in the registry to SavedRoomV2 as the baseline.
  // assembleExportCampaign will override with pending edits when present.
  const baselineRooms: ReturnType<typeof dehydrateRoom>[] = [];
  for (const [, roomDef] of ROOM_REGISTRY) {
    const { data } = roomDefToEditorRoomData(roomDef, 1);
    const jsonDef = editorRoomDataToJson(data);
    baselineRooms.push(dehydrateRoom(jsonDef));
  }

  const worldMap = buildWorldMapFromRegistry(WORLD_NAMES, ROOM_REGISTRY);

  // Synthetic session carrying the main campaign metadata and baseline rooms.
  // Propagate the existing revision metadata from the loaded canonical campaign
  // so that re-exporting increments the version counter rather than resetting to 1.
  const loadedRevMeta = getLoadedOfficialCampaignRevisionMetadata();
  const syntheticSession: EditableCampaignSession = {
    source: 'main',
    campaign: {
      v: 1,
      kind: 'DustWeaverCampaign',
      ...(loadedRevMeta !== null ? { metadata: loadedRevMeta } : {}),
      campaign: {
        id: MAIN_CAMPAIGN_ID,
        title: MAIN_CAMPAIGN_TITLE,
        creator: MAIN_CAMPAIGN_CREATOR,
        description: MAIN_CAMPAIGN_DESCRIPTION,
        initialRoomId: MAIN_CAMPAIGN_INITIAL_ROOM_ID,
        initialRoomImagePath: null,
      },
      worldMap,
      rooms: baselineRooms,
      editor: {
        createdWithBuild: String(BUILD_NUMBER),
        lastEditedIso: new Date().toISOString(),
      },
    },
  };

  const exported = assembleExportCampaign(
    syntheticSession,
    pendingRoomEdits,
    ROOM_REGISTRY,
    worldMap,
  );

  const stringifyStartMs = import.meta.env.DEV ? performance.now() : 0;
  const text = JSON.stringify(exported, null, 2);
  if (import.meta.env.DEV) {
    console.log(`[campaignPerf] export stringify: ${(performance.now() - stringifyStartMs).toFixed(2)}ms`);
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = 'DustweaverCampaign.dwcampaign.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
