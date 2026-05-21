/**
 * Type declarations for the Electron preload API surface.
 *
 * When running inside Electron, the preload script exposes
 * `window.dustweaverElectron` via contextBridge. In browser/GitHub Pages
 * mode this property is absent, so all consumers must check for it first.
 */

import type { SavedCampaignV1 } from './levels/campaignSchema';

/** Result returned by all dustweaverElectron IPC calls. */
export interface ElectronSaveResult {
  ok: boolean;
  /** Present when ok is false. Human-readable error description. */
  error?: string;
}

/** Narrow IPC API exposed by the Electron preload script. */
export interface DustWeaverElectronAPI {
  /**
   * Writes the official DustWeaver campaign directly to the project's
   * ASSETS/CAMPAIGNS/DUSTWEAVER_CAMPAIGN directory (or userData in packaged
   * builds) without a browser download prompt.
   *
   * @param campaign  A validated SavedCampaignV1 with campaign.id === 'DUSTWEAVER_CAMPAIGN'.
   * @returns         Resolves to { ok: true } on success or { ok: false, error } on failure.
   */
  saveOfficialCampaignToProject(campaign: SavedCampaignV1): Promise<ElectronSaveResult>;
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
