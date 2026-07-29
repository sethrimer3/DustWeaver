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
  /** Opens a trusted HTTPS URL in the user's default browser. */
  openExternal: (url) => ipcRenderer.invoke('dw:open-external', url),

  /** Legacy: writes official campaign only.  Retained for backward compatibility. */
  saveOfficialCampaignToProject: (campaign) =>
    ipcRenderer.invoke('dw:save-official-campaign', campaign),

  /**
   * Exports a campaign (official or custom) with streaming progress events.
   *
   * @param campaign  A SavedCampaignV1 object.
   * @param opts      `{ isOfficialCampaign?: boolean, exportId?: string }` — when
   *                  `isOfficialCampaign` is true the official project path is
   *                  used; otherwise userData/CUSTOM_CAMPAIGNS/. Pass `exportId`
   *                  to allow this export to be cancelled via `cancelExport`.
   * @returns         Promise<{ ok: true, campaignDir } | { ok: false, error, cancelled? }>.
   */
  exportCampaignWithProgress: (campaign, opts) =>
    ipcRenderer.invoke('dw:export-campaign-with-progress', campaign, opts),

  /**
   * Requests cancellation of an in-progress export started with
   * `exportCampaignWithProgress({ ..., exportId })`. The main process checks
   * this flag between room writes, so cancellation takes effect shortly after
   * (not instantly) and never corrupts on-disk state — see the docstring on
   * `exportCampaignToDisk` in campaignExport.cjs for why that's safe.
   *
   * @param exportId  The same `exportId` passed to `exportCampaignWithProgress`.
   * @returns         Promise<{ ok: true }>.
   */
  cancelExport: (exportId) => ipcRenderer.invoke('dw:cancel-export', exportId),

  /**
   * Registers a callback that receives ExportProgressEvent objects while
   * `exportCampaignWithProgress` is running.
   *
   * Returns an unsubscribe function that removes exactly this listener —
   * prefer calling it over `offExportProgress()` when multiple exports could
   * be in flight, since `offExportProgress()` removes ALL listeners on the
   * channel and can discard an unrelated/concurrent export's callback.
   */
  onExportProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('dw:export-progress', listener);
    return () => ipcRenderer.removeListener('dw:export-progress', listener);
  },

  /**
   * Removes all progress event listeners added via `onExportProgress`.
   * Retained for backward compatibility; prefer the unsubscribe function
   * returned by `onExportProgress` when possible.
   */
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

  /**
   * Reads a single derived room JSON file from the campaign's ROOMS directory.
   * Used by the runtime to load individual rooms from the file cache.
   *
   * @param campaignId          The campaign ID.
   * @param roomId              The room ID to look up.
   * @param isOfficialCampaign  When true, reads from the official campaign path.
   * @returns  Promise<{ ok: true, roomData, expectedHash } | { ok: false, error }>.
   */
  readRoomFile: (campaignId, roomId, isOfficialCampaign) =>
    ipcRenderer.invoke('dw:read-room-file', campaignId, roomId, isOfficialCampaign),

  /**
   * Reads ALL derived room JSON files for a campaign in a single IPC call.
   * More efficient than calling readRoomFile N times for startup loading.
   *
   * @param campaignId          The campaign ID.
   * @param isOfficialCampaign  When true, reads from the official campaign path.
   * @returns  Promise<{ ok: true, rooms: [...], manifest } | { ok: false, error }>.
   */
  readAllRoomFiles: (campaignId, isOfficialCampaign) =>
    ipcRenderer.invoke('dw:read-all-room-files', campaignId, isOfficialCampaign),

  /**
   * Verifies that every room file listed in the campaign's ROOMS/manifest.json
   * actually exists on disk.  Returns { ok: true } when all files are present,
   * or { ok: false, error } if any file is missing.
   *
   * @param campaignId          The campaign ID.
   * @param isOfficialCampaign  When true, reads from the official campaign path.
   * @returns  Promise<{ ok: true } | { ok: false, error }>.
   */
  validateRoomCacheFiles: (campaignId, isOfficialCampaign) =>
    ipcRenderer.invoke('dw:validate-room-cache-files', campaignId, isOfficialCampaign),
});

/**
 * Platform-services bridge used by src/platform/rendererPlatform.ts and
 * src/workshop/rendererWorkshopAdapter.ts. Generic `invoke(channel, payload)`
 * — the channel names themselves (dw:platform-*, dw:workshop-*) are the
 * allowlisted, typed surface defined in src/platform/ipcBridge.ts.
 */
const PLATFORM_CHANNELS = new Set([
  'dw:platform-unlock-achievement',
  'dw:platform-get-achievement',
  'dw:platform-get-all-achievements',
  'dw:platform-store-stats',
  'dw:platform-get-persona-name',
  'dw:workshop-publish',
  'dw:workshop-get-items',
  'dw:workshop-subscribe',
  'dw:workshop-unsubscribe',
  'dw:workshop-install-path',
]);

contextBridge.exposeInMainWorld('electronPlatform', {
  invoke: (channel, payload) => {
    if (!PLATFORM_CHANNELS.has(channel)) {
      return Promise.resolve({ ok: false, error: `Unknown platform channel: ${channel}` });
    }
    return ipcRenderer.invoke(channel, payload);
  },
});
