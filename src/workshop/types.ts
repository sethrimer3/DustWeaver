import type { WorkshopPackageFile } from './packageValidator';

export interface WorkshopPackageManifest {
  formatVersion: 1;
  title: string;
  description: string;
  authorSteamId: string;
  campaignId: string;
  gameVersion: string;
  tags: string[];
}

export interface WorkshopItem {
  steamPublishedFileId: string;
  title: string;
  description: string;
  authorName: string;
  tags: string[];
  subscribed: boolean;
  installed: boolean;
  localPath?: string;
}

/**
 * Raw contents of an installed Workshop package, read from disk (or an
 * in-memory fake) but not yet validated. `files` mirrors the shape
 * `validateWorkshopPackage` expects, with paths relative to the package root.
 */
export interface WorkshopInstalledPackage {
  manifest: unknown;
  campaignData: unknown;
  files: WorkshopPackageFile[];
}

/**
 * Workshop platform adapter. Implementations: `fakeWorkshopAdapter` (tests,
 * non-Steam mode) and `steamWorkshopAdapter` (Electron main process only).
 */
export interface WorkshopAdapter {
  isAvailable(): boolean;
  publish(manifest: WorkshopPackageManifest, campaignDir: string): Promise<WorkshopItem>;
  subscribe(steamPublishedFileId: string): Promise<void>;
  unsubscribe(steamPublishedFileId: string): Promise<void>;
  getSubscribedItems(): Promise<WorkshopItem[]>;
  getInstalledItems(): Promise<WorkshopItem[]>;
  download(steamPublishedFileId: string): Promise<string>;
  /**
   * Reads an installed Workshop item's package contents (manifest, campaign
   * JSON, and file listing) from its `localPath` so the caller can validate
   * and convert it into a `CampaignSource`. Throws if the install directory
   * is missing, unreadable, or the package is structurally incomplete
   * (missing manifest/campaign file) — callers are expected to catch and
   * surface a localized error rather than let this propagate to a crash.
   */
  readInstalledPackage(localPath: string): Promise<WorkshopInstalledPackage>;
}
