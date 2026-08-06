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
  /** True while Steam is actively fetching the item's content. */
  downloading?: boolean;
  /** True when Steam holds a newer revision than the one installed locally. */
  needsUpdate?: boolean;
  localPath?: string;
}

/** Steam UGC visibility, mirrored as strings so the UI never hardcodes enum ints. */
export type WorkshopVisibility = 'public' | 'friendsOnly' | 'private' | 'unlisted';

/**
 * Everything needed to upload a campaign. The campaign is passed as data
 * rather than a directory path: the main process stages it into a temp folder
 * in the installed-package layout before handing it to Steam, so campaigns
 * that only exist in browser storage (never exported to disk) can publish too.
 */
export interface WorkshopPublishInput {
  manifest: WorkshopPackageManifest;
  /** A validated `SavedCampaignV1`. */
  campaign: unknown;
  /**
   * When set, updates that existing Workshop item instead of creating a new
   * one — this is what stops re-publishing from littering the author's
   * Workshop page with duplicates.
   */
  existingPublishedFileId?: string;
  visibility?: WorkshopVisibility;
  changeNote?: string;
  /** `data:image/png;base64,…` (or jpeg), max 1 MiB per Steam's preview limit. */
  previewImageDataUrl?: string;
}

export interface WorkshopPublishResult {
  item: WorkshopItem;
  /**
   * True when Steam reports the author has not yet accepted the Workshop legal
   * agreement. Until they do, the item stays invisible on the Workshop even if
   * visibility was set to public, so the UI must tell them to visit the page.
   */
  needsToAcceptAgreement: boolean;
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
  publish(input: WorkshopPublishInput): Promise<WorkshopPublishResult>;
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
