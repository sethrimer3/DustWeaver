/**
 * Electron preload script.
 *
 * Exposes a minimal, safe IPC surface to the renderer via contextBridge.
 * Only the specific API needed for DustWeaver project file I/O is exposed —
 * no raw fs, path, or ipcRenderer references are leaked.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Safe API surface exposed to the renderer as `window.dustweaverElectron`.
 *
 * saveOfficialCampaignToProject — legacy; writes the official DustWeaver
 * campaign directly to the project's ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN
 * directory. Prefer `exportCampaignWithProgress` for new code.
 *
 * exportCampaignWithProgress — writes a campaign (official or custom) with
 * streaming progress events.  Call `onExportProgress` before invoking to
 * receive live status updates; call `offExportProgress` when done.
 *
 * onExportProgress — registers a callback to receive `ExportProgressEvent`
 * objects as the export proceeds.  Multiple calls add multiple listeners.
 *
 * offExportProgress — removes all progress listeners registered via
 * `onExportProgress`.  Call this once the export promise resolves.
 *
 * readRoomCacheManifest — reads the manifest.json from a campaign's ROOMS
 * directory.  Used by the runtime to validate whether cached room files are
 * still current.
 */
contextBridge.exposeInMainWorld('dustweaverElectron', {
  /** Legacy: writes official campaign only.  Retained for backward compatibility. */
  saveOfficialCampaignToProject: (campaign) =>
    ipcRenderer.invoke('dw:save-official-campaign', campaign),

  /**
   * Exports a campaign (official or custom) with streaming progress events.
   *
   * @param campaign  A SavedCampaignV1 object.
   * @param opts      `{ isOfficialCampaign?: boolean }` — when true the official
   *                  project path is used; otherwise userData/CUSTOM_CAMPAIGNS/.
   * @returns         Promise<{ ok: true, campaignDir } | { ok: false, error }>.
   */
  exportCampaignWithProgress: (campaign, opts) =>
    ipcRenderer.invoke('dw:export-campaign-with-progress', campaign, opts),

  /**
   * Registers a callback that receives ExportProgressEvent objects while
   * `exportCampaignWithProgress` is running.
   * Call `offExportProgress()` once the export promise resolves.
   */
  onExportProgress: (callback) => {
    ipcRenderer.on('dw:export-progress', (_event, data) => callback(data));
  },

  /** Removes all progress event listeners added via `onExportProgress`. */
  offExportProgress: () => {
    ipcRenderer.removeAllListeners('dw:export-progress');
  },

  /**
   * Reads the room cache manifest for a campaign.
   *
   * @param campaignId          The campaign ID to look up.
   * @param isOfficialCampaign  When true, reads from the official campaign path.
   * @returns  Promise<{ ok: true, manifest } | { ok: false, error }>.
   */
  readRoomCacheManifest: (campaignId, isOfficialCampaign) =>
    ipcRenderer.invoke('dw:read-room-cache-manifest', campaignId, isOfficialCampaign),
});
