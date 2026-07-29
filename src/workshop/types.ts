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
}
