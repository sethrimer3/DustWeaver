/**
 * Type declarations for the Electron preload API surface.
 *
 * When running inside Electron, the preload script exposes
 * `window.dustweaverElectron` via contextBridge. In browser/GitHub Pages
 * mode this property is absent, so all consumers must check for it first.
 */

import type { SavedCampaignV1 } from './levels/campaignSchema';
import type { ExportProgressEvent } from './levels/roomCacheManifest';
import type { RoomCacheManifest } from './levels/roomCacheManifest';

/** Result returned by all dustweaverElectron IPC calls. */
export interface ElectronSaveResult {
  ok: boolean;
  /** Present when ok is false. Human-readable error description. */
  error?: string;
  /** Present when ok is true. Absolute path of the directory that was written. */
  campaignDir?: string;
  /** Present when ok is true, from `exportCampaignWithProgress`: rooms written or updated. */
  writtenRooms?: number;
  /** Present when ok is true, from `exportCampaignWithProgress`: rooms whose hash matched (unchanged). */
  skippedRooms?: number;
  /** Present when ok is true, from `exportCampaignWithProgress`: stale cache files removed. */
  removedCount?: number;
}

/** Options for `exportCampaignWithProgress`. */
export interface ExportCampaignOptions {
  /**
   * When true, the official campaign project path is used
   * (ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN or userData/CAMPAIGNS/DUSTWEAVER_CAMPAIGN).
   * When false (default), the campaign is written to userData/CUSTOM_CAMPAIGNS/<id>/.
   */
  isOfficialCampaign?: boolean;
}

/** Result returned by `readRoomCacheManifest`. */
export interface ReadManifestResult {
  ok: boolean;
  manifest?: RoomCacheManifest;
  error?: string;
}

/** Single room entry returned by `readAllRoomFiles`. */
export interface RoomFileEntry {
  /** The room ID (matches the `id` field in the SavedRoomV2 data). */
  roomId: string;
  /** Parsed SavedRoomV2 data for the room. */
  data: unknown;
  /** Expected content hash from the manifest (for validation). */
  expectedHash: string;
}

/** Result returned by `readRoomFile`. */
export interface ReadRoomFileResult {
  ok: boolean;
  /** Parsed SavedRoomV2 data when ok is true. */
  roomData?: unknown;
  /** Expected content hash from the manifest (for validation). */
  expectedHash?: string;
  error?: string;
}

/** Result returned by `readAllRoomFiles`. */
export interface ReadAllRoomFilesResult {
  ok: boolean;
  /** All room entries successfully read from disk. Missing/corrupt rooms are skipped. */
  rooms?: RoomFileEntry[];
  /** The raw manifest.json object (already verified valid before reading files). */
  manifest?: RoomCacheManifest;
  error?: string;
}

/** Result returned by `validateRoomCacheFiles`. */
export interface ValidateRoomCacheFilesResult {
  ok: boolean;
  /** Present when ok is false. Human-readable reason for failure. */
  error?: string;
}

/** Narrow IPC API exposed by the Electron preload script. */
export interface DustWeaverElectronAPI {
  /**
   * Legacy: writes the official DustWeaver campaign directly to the project's
   * ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN directory.
   * Prefer `exportCampaignWithProgress` for new code.
   *
   * @param campaign  A validated SavedCampaignV1 with campaign.id === 'DUSTWEAVER_CAMPAIGN'.
   * @returns         Resolves to { ok: true } on success or { ok: false, error } on failure.
   */
  saveOfficialCampaignToProject(campaign: SavedCampaignV1): Promise<ElectronSaveResult>;

  /**
   * Exports a campaign (official or custom) to disk with streaming progress events.
   *
   * Progress events are delivered via `onExportProgress`.  Register the callback
   * BEFORE calling this function, then call `offExportProgress` when done.
   *
   * @param campaign  A validated SavedCampaignV1.
   * @param opts      Export options (see ExportCampaignOptions).
   * @returns         Resolves to { ok: true, campaignDir } on success or
   *                  { ok: false, error } on failure.
   */
  exportCampaignWithProgress(
    campaign: SavedCampaignV1,
    opts?: ExportCampaignOptions,
  ): Promise<ElectronSaveResult>;

  /**
   * Registers a callback that receives live `ExportProgressEvent` objects
   * while `exportCampaignWithProgress` is running.
   *
   * Returns an unsubscribe function that removes exactly this listener.
   * Prefer it over `offExportProgress()` when concurrent exports are
   * possible, since that removes every listener on the channel.
   */
  onExportProgress(callback: (event: ExportProgressEvent) => void): () => void;

  /**
   * Removes all progress event listeners registered via `onExportProgress`.
   * Must be called after the export promise resolves to avoid listener leaks.
   */
  offExportProgress(): void;

  /**
   * Reads the room cache manifest for a campaign from the ROOMS/manifest.json.
   *
   * @param campaignId          The campaign ID to look up.
   * @param isOfficialCampaign  When true, reads from the official campaign path.
   * @returns                   Resolves to { ok: true, manifest } or { ok: false, error }.
   */
  readRoomCacheManifest(
    campaignId: string,
    isOfficialCampaign: boolean,
  ): Promise<ReadManifestResult>;

  /**
   * Reads a single derived room JSON file from the campaign's ROOMS directory.
   * Used to load room data from the file cache during gameplay.
   *
   * @param campaignId          The campaign ID.
   * @param roomId              The room ID to load.
   * @param isOfficialCampaign  When true, reads from the official campaign path.
   * @returns                   Resolves to { ok: true, roomData, expectedHash } or { ok: false, error }.
   */
  readRoomFile(
    campaignId: string,
    roomId: string,
    isOfficialCampaign: boolean,
  ): Promise<ReadRoomFileResult>;

  /**
   * Reads ALL derived room JSON files for a campaign in a single IPC call.
   * More efficient than calling readRoomFile N times for startup loading.
   * Skips unreadable room files with a console warning rather than failing entirely.
   *
   * @param campaignId          The campaign ID.
   * @param isOfficialCampaign  When true, reads from the official campaign path.
   * @returns                   Resolves to { ok: true, rooms, manifest } or { ok: false, error }.
   */
  readAllRoomFiles(
    campaignId: string,
    isOfficialCampaign: boolean,
  ): Promise<ReadAllRoomFilesResult>;

  /**
   * Verifies that every room file listed in the campaign's manifest.json
   * actually exists on disk.  Returns `{ ok: true }` if all files are present
   * or `{ ok: false, error }` if any file is missing.
   *
   * Called during cache validation so that missing files trigger regeneration
   * immediately rather than causing delayed runtime failures.
   *
   * @param campaignId          The campaign ID.
   * @param isOfficialCampaign  When true, reads from the official campaign path.
   * @returns                   Resolves to { ok: true } or { ok: false, error }.
   */
  validateRoomCacheFiles?(
    campaignId: string,
    isOfficialCampaign: boolean,
  ): Promise<ValidateRoomCacheFilesResult>;
}

declare global {
  interface Window {
    /**
     * Present only when running inside Electron (injected by preload.cjs).
     * Always check for existence before calling — absent in browser mode.
     */
    dustweaverElectron?: DustWeaverElectronAPI;
  }
}
