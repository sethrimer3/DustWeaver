/**
 * Room JSON loader — fetches room JSON files from CAMPAIGNS/<CAMPAIGN_ID>/ROOMS/ at startup
 * and converts them into RoomDef objects for the ROOM_REGISTRY.
 *
 * Boundary walls are NOT stored in the JSON; they are generated from room dimensions
 * at load time as complete solid edge walls (no transition holes).
 *
 * If the JSON includes a valid `bakedWallTemplate`, it is hydrated and stored on
 * the RoomDef so that the runtime can skip `buildRoomWallTemplate()` on first load.
 * See `roomBoundaryWalls.ts` for the complete-boundary design decision.
 */

import type { RoomDef } from './roomDef';
import { validateRoomJson } from '../editor/roomJson';
import type { RoomJsonDef } from '../editor/roomJson';
import { isSavedRoomV2, hydrateV2Room } from './roomSchemaV2';
import { getActiveCampaignId, getCampaignById, getCampaignRoomsBasePath } from './campaigns';
import { roomJsonDefToRoomDef } from './roomJsonToRoomDef';

export { roomJsonDefToRoomDef } from './roomJsonToRoomDef';

// ── Async loader — fetches room JSON files at startup ────────────────────────

const DISCOVERED_ROOM_FILE_PATHS = Object.keys(import.meta.glob('/ASSETS/CAMPAIGNS/*/ROOMS/*.json', {
  query: '?url',
  import: 'default',
}));

function discoverRoomFilenames(campaignFolderNames: readonly string[]): string[] {
  const campaignFolderSet = new Set(campaignFolderNames);
  const filenames: string[] = [];
  for (const path of DISCOVERED_ROOM_FILE_PATHS) {
    const normalizedPath = path.replace(/\\/g, '/');
    const match = normalizedPath.match(/\/ASSETS\/CAMPAIGNS\/([^/]+)\/ROOMS\/([^/]+\.json)$/);
    if (!match) continue;
    const campaignFolderName = match[1];
    const filename = match[2];
    if (!campaignFolderSet.has(campaignFolderName)) continue;
    if (filename === 'manifest.json') continue;
    filenames.push(filename);
  }
  return [...new Set(filenames)].sort((a, b) => a.localeCompare(b));
}

/**
 * Fetches room JSON files for the active campaign from auto-discovered paths.
 * Rooms are populated from files found by the build-time Vite glob
 * without fetching a manifest.
 * Returns a Map of room ID → RoomDef.
 *
 * If any room file fails to load, the error is logged and that room is skipped.
 */
export async function loadRoomJsonFiles(): Promise<Map<string, RoomDef>> {
  const rooms = new Map<string, RoomDef>();

  const activeCampaignId = getActiveCampaignId();
  const meta = await getCampaignById(activeCampaignId);

  const campaignFolderNames = meta
    ? [...new Set([activeCampaignId, meta.folderName])]
    : [activeCampaignId];
  const discoveredFilenames = discoverRoomFilenames(campaignFolderNames);

  if (discoveredFilenames.length === 0) {
    console.error('[roomJsonLoader] No room files discovered for campaign:', campaignFolderNames);
    return rooms;
  }

  const roomsBasePath = meta
    ? getCampaignRoomsBasePath(meta.folderName)
    : getCampaignRoomsBasePath(activeCampaignId);

  // Fetch all room files in parallel
  const fetches = discoveredFilenames.map(async (filename) => {
    try {
      const resp = await fetch(`${roomsBasePath}/${filename}`);
      if (!resp.ok) {
        console.error(`[roomJsonLoader] Failed to fetch ${filename}: ${resp.status}`);
        return;
      }
      const data: unknown = await resp.json();
      // Auto-detect schema: v2 rooms hydrate first into the legacy RoomJsonDef
      // shape so the downstream conversion pipeline stays unchanged.
      let json: RoomJsonDef;
      if (isSavedRoomV2(data)) {
        json = hydrateV2Room(data);
      } else {
        const errors = validateRoomJson(data);
        if (errors.length > 0) {
          console.error(`[roomJsonLoader] Validation errors in ${filename}:`, errors);
          return;
        }
        json = data as RoomJsonDef;
      }
      const roomDef = roomJsonDefToRoomDef(json);
      rooms.set(roomDef.id, roomDef);
    } catch (err) {
      console.error(`[roomJsonLoader] Error loading ${filename}:`, err);
    }
  });

  await Promise.all(fetches);
  return rooms;
}
