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
   * Call `offExportProgress()` once the export resolves.
   */
  onExportProgress(callback: (event: ExportProgressEvent) => void): void;

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
