/**
 * Editor export — triggers browser downloads of room JSON and world-map JSON.
 *
 * Rooms are saved in the compact v2 schema (`SavedRoomV2`) by default.  The
 * loader auto-detects v2 vs. legacy so older files keep working.
 *
 * In Electron editor mode, "Export Campaign" writes directly to the filesystem
 * via the `dw:export-campaign-with-progress` IPC channel and displays a
 * progress modal.  In browser / GitHub Pages mode, a download is triggered
 * instead so the user can save the file manually.
 *
 * Source-of-truth rule: the .dwcampaign.json file is canonical.  The
 * individual room files (ROOMS/*.json) and manifest.json are derived cache
 * artifacts, regenerated on every export.
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
import { createExportProgressModal } from './editorExportProgressModal';
import type { SavedCampaignV1, CampaignSpawnData } from '../levels/campaignSchema';
import {
  ROOM_CACHE_VERSION,
} from '../levels/roomCacheManifest';
import type { RoomCacheManifest, RoomCacheEntry, AdjacencyEntry } from '../levels/roomCacheManifest';
import { computeContentHash, computeCampaignHashForValidation } from '../levels/roomFileLoader';
import { buildZipBlob } from '../utils/minimalZipWriter';
import type { ZipEntry } from '../utils/minimalZipWriter';

// ── Main campaign constants ───────────────────────────────────────────────────
const MAIN_CAMPAIGN_ID = 'DUSTWEAVER_CAMPAIGN';
const MAIN_CAMPAIGN_TITLE = 'DustWeaver';
const MAIN_CAMPAIGN_CREATOR = 'GravyThyme';
const MAIN_CAMPAIGN_DESCRIPTION =
  'The main DustWeaver campaign. This is the core single-player game experience ' +
  'with the canonical world map, progression, and story path.';
const MAIN_CAMPAIGN_INITIAL_ROOM_ID = 'lobby';

// ── Browser ZIP export helper ─────────────────────────────────────────────────

/**
 * Generates and downloads a derived room-cache ZIP for browser mode.
 *
 * The ZIP mirrors the ROOMS/ directory written by the Electron exporter:
 *   ROOMS/manifest.json
 *   ROOMS/<roomId>_room.json   (one per room)
 *
 * The manifest uses the same format as the Electron manifest so the ZIP can be
 * inspected with the same tooling.  Room hashes and campaign hash are computed
 * via SHA-256 (Web Crypto) exactly as in the Electron main-process path.
 *
 * This is called with `void` so the main export functions stay synchronous.
 * The ZIP download happens asynchronously after the main JSON download.
 *
 * Source-of-truth rule: the .dwcampaign.json remains canonical; the ZIP
 * contains only derived cache artifacts.
 */
async function downloadRoomCacheZip(
  exported: SavedCampaignV1,
  zipFilename: string,
): Promise<void> {
  const zipStartMs = import.meta.env.DEV ? performance.now() : 0;

  const textEncoder = new TextEncoder();
  const nowIso = new Date().toISOString();

  // ── Compute campaign hash ───────────────────────────────────────────────
  const campaignHash = await computeCampaignHashForValidation(exported);

  // ── Build entries and manifest rooms ────────────────────────────────────
  const entries: ZipEntry[] = [];
  const manifestRooms: Record<string, RoomCacheEntry> = {};

  for (const room of exported.rooms) {
    const roomId = (room as { id: string }).id;
    if (typeof roomId !== 'string') continue;

    const roomFilename = `${roomId}_room.json`;

    const roomHashStartMs = import.meta.env.DEV ? performance.now() : 0;
    const roomHash = await computeContentHash(room);
    const roomJsonStr = JSON.stringify(room, null, 2);
    if (import.meta.env.DEV) {
      console.log(
        `[campaignPerf] room "${roomId}" hash+stringify: ` +
        `${(performance.now() - roomHashStartMs).toFixed(2)}ms`,
      );
    }

    manifestRooms[roomId] = {
      roomId,
      file: roomFilename,
      hash: roomHash,
      updatedAt: nowIso,
    };
    entries.push({ path: `ROOMS/${roomFilename}`, data: textEncoder.encode(roomJsonStr) });
  }

  // ── Build adjacency index ─────────────────────────────────────────────
  // Derived from transition portal data; only rooms present in manifestRooms
  // appear as keys or targets.
  const adjacency: Record<string, AdjacencyEntry> = {};
  for (const room of exported.rooms) {
    const roomId = (room as { id: string }).id;
    if (typeof roomId !== 'string' || !(roomId in manifestRooms)) continue;

    const transitions = (room as { transitions?: unknown }).transitions;
    if (!Array.isArray(transitions)) continue;

    const seen = new Set<string>();
    const targets: string[] = [];
    for (const t of transitions) {
      const to = (t as { to?: unknown }).to;
      if (typeof to !== 'string' || to.length === 0) continue;
      // Only include targets that are known rooms in the manifest.
      if (!(to in manifestRooms)) continue;
      if (seen.has(to)) continue;
      seen.add(to);
      targets.push(to);
    }

    if (targets.length > 0) {
      adjacency[roomId] = { roomId, targets };
    }
  }

  // ── Build manifest ────────────────────────────────────────────────────
  const manifest: RoomCacheManifest = {
    campaignId: exported.campaign.id,
    campaignName: exported.campaign.title ?? exported.campaign.id,
    campaignHash,
    campaignVersion: exported.metadata?.version ?? 0,
    campaignSchemaVersion: exported.v,
    roomCacheVersion: ROOM_CACHE_VERSION,
    exportedAt: nowIso,
    rooms: manifestRooms,
    adjacency,
  };

  // Insert manifest as the first entry so it appears at the top of the ZIP.
  entries.unshift({
    path: 'ROOMS/manifest.json',
    data: textEncoder.encode(JSON.stringify(manifest, null, 2)),
  });

  if (import.meta.env.DEV) {
    console.log(
      `[campaignPerf] room-cache ZIP generation: ${(performance.now() - zipStartMs).toFixed(2)}ms` +
      ` (${exported.rooms.length} room(s))`,
    );
  }

  // ── Download the ZIP ──────────────────────────────────────────────────
  const zipBlob = buildZipBlob(entries);
  const url = URL.createObjectURL(zipBlob);

  const a = document.createElement('a');
  a.href = url;
  a.download = zipFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}


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

// ── Electron progress-based export helpers ────────────────────────────────────

/**
 * Runs an Electron progress export for the given campaign payload.
 *
 * Shows a progress modal in `progressRoot`, registers the progress listener,
 * invokes the IPC, and cleans up the listener when the promise resolves.
 *
 * This is an internal helper — call `exportMainCampaignJson` or
 * `exportCampaignJson` instead.
 */
async function runElectronProgressExport(
  exported: import('../levels/campaignSchema').SavedCampaignV1,
  isOfficialCampaign: boolean,
  progressRoot: HTMLElement,
): Promise<void> {
  const electronApi = window.dustweaverElectron;
  if (!electronApi) return;

  const modal = createExportProgressModal(progressRoot);
  modal.update({ step: 'serializing', message: 'Serializing campaign…' });

  // Register progress listener before invoking so no events are missed.
  electronApi.onExportProgress((event) => {
    modal.update(event);
  });

  let result: Awaited<ReturnType<typeof electronApi.exportCampaignWithProgress>>;
  try {
    result = await electronApi.exportCampaignWithProgress(exported, { isOfficialCampaign });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    modal.update({ step: 'error', message: `Export failed: ${msg}` });
    electronApi.offExportProgress();
    return;
  }

  // Clean up the listener immediately after the IPC call resolves.
  electronApi.offExportProgress();

  if (!result.ok) {
    modal.update({ step: 'error', message: `Export failed: ${result.error ?? 'Unknown error'}` });
  }
  // On success the modal auto-dismisses via the 'complete' event sent by main.
}

/**
 * Exports the entire custom campaign as a single `.dwcampaign.json` file.
 *
 * Collects all rooms from ROOM_REGISTRY (the campaign rooms), merges pending
 * room edits, and includes world-map metadata and campaign metadata from the
 * session. The result is a valid SavedCampaignV1.
 *
 * In Electron: writes directly to userData/CUSTOM_CAMPAIGNS/<id>/ with a
 * progress modal.  In browser: triggers a download.
 *
 * @param session          The active campaign editing session.
 * @param pendingRoomEdits  Rooms with unsaved edits (including the current room).
 * @param activeRoomData   The room currently open in the editor (may be unsaved).
 * @param progressRoot     When provided and running in Electron, the progress
 *                         modal is appended here.
 */
export function exportCampaignJson(
  session: EditableCampaignSession,
  pendingRoomEdits: ReadonlyMap<string, EditorRoomData>,
  activeRoomData?: EditorRoomData | null,
  progressRoot?: HTMLElement | null,
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

  // In Electron, write directly to userData/CUSTOM_CAMPAIGNS/<id>/ with progress.
  if (window.dustweaverElectron !== undefined && progressRoot != null) {
    runElectronProgressExport(exported, false, progressRoot).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[editorExport] Electron custom campaign export error:', msg);
    });
    return;
  }

  // Browser / GitHub Pages fallback — trigger a download.
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

  // Also download the derived room-cache ZIP alongside the canonical JSON.
  // The ZIP is a convenience artifact; the .dwcampaign.json remains canonical.
  void downloadRoomCacheZip(exported, `${exported.campaign.id}_ROOMS.zip`);
}

/**
 * Exports the main DustWeaver campaign as a single `.dwcampaign.json` file.
 *
 * Builds a synthetic EditableCampaignSession from the current ROOM_REGISTRY
 * (dehydrating every room) and merges any pending room edits on top before
 * assembling the final SavedCampaignV1 payload.
 *
 * In Electron: writes directly to the project ASSETS/ directory (or userData
 * in packaged builds) with a live progress modal.
 * In browser / GitHub Pages: triggers a file download.
 *
 * Source-of-truth rule: the .dwcampaign.json file remains canonical.  The
 * individual ROOMS/ files are derived cache artifacts written alongside it.
 *
 * @param pendingRoomEdits  Rooms with unsaved edits from the current session.
 * @param progressRoot      When provided and running in Electron, the progress
 *                          modal is appended to this element.
 */
export function exportMainCampaignJson(
  pendingRoomEdits: ReadonlyMap<string, EditorRoomData>,
  progressRoot?: HTMLElement | null,
  campaignSpawn?: CampaignSpawnData | null,
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
        initialRoomId: campaignSpawn?.roomId ?? MAIN_CAMPAIGN_INITIAL_ROOM_ID,
        initialRoomImagePath: null,
        ...(campaignSpawn !== undefined && campaignSpawn !== null ? { campaignSpawn } : {}),
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

  // In Electron, write directly to the project files with a progress modal.
  if (window.dustweaverElectron !== undefined && progressRoot != null) {
    runElectronProgressExport(exported, true, progressRoot).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[editorExport] Electron main campaign export error:', msg);
    });
    return;
  }

  // In Electron without a progressRoot (legacy callers) fall back to the old
  // synchronous IPC call so no regression occurs.
  if (window.dustweaverElectron !== undefined) {
    window.dustweaverElectron
      .saveOfficialCampaignToProject(exported)
      .then((result) => {
        if (result.ok) {
          const dir = result.campaignDir ?? 'ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN';
          window.alert(`Campaign saved to project files:\n${dir}`);
        } else {
          window.alert(`Campaign save failed:\n${result.error ?? 'Unknown error'}`);
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`Campaign save failed:\n${msg}`);
      });
    return;
  }

  // Browser / GitHub Pages fallback — trigger a download.
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

  // Also download the derived room-cache ZIP alongside the canonical JSON.
  // The ZIP is a convenience artifact; the .dwcampaign.json remains canonical.
  void downloadRoomCacheZip(exported, 'DustweaverCampaign_ROOMS.zip');
}
