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
 * saveOfficialCampaignToProject — writes the official DustWeaver campaign
 * directly to the project's ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN directory
 * (or userData in packaged builds), bypassing browser download prompts.
 *
 * @param campaign  A SavedCampaignV1 object (plain JSON-serialisable value).
 * @returns         Promise resolving to { ok: true } on success, or
 *                  { ok: false, error: string } on validation/write failure.
 */
contextBridge.exposeInMainWorld('dustweaverElectron', {
  saveOfficialCampaignToProject: (campaign) =>
    ipcRenderer.invoke('dw:save-official-campaign', campaign),
});
