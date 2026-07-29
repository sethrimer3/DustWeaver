/**
 * Real Steamworks UGC-backed `WorkshopAdapter`. Runs ONLY in the Electron
 * main process — never import this module from renderer code. The renderer
 * talks to it exclusively through the WORKSHOP_* IPC channels in
 * `../platform/ipcBridge.ts`.
 *
 * `steamworks.js` is required lazily and wrapped in a try/catch so builds
 * without the native module degrade to `isAvailable() === false`.
 */
import type { WorkshopAdapter, WorkshopItem, WorkshopPackageManifest } from './types';

interface SteamworksUgcClient {
  createItem(appId: number): Promise<{ itemId: bigint }>;
  startItemUpdate(appId: number, itemId: bigint): unknown;
  submitItemUpdate(update: unknown, changeNote: string): Promise<{ itemId: bigint }>;
  subscribeItem(itemId: bigint): Promise<void>;
  unsubscribeItem(itemId: bigint): Promise<void>;
  getSubscribedItems(): bigint[];
  downloadItem(itemId: bigint): Promise<void>;
  getItemInstallInfo(itemId: bigint): { folder: string } | null;
}

interface SteamworksClient {
  workshop: SteamworksUgcClient;
}

function loadSteamworks(appId: number | undefined): SteamworksClient | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const steamworks = require('steamworks.js');
    const client: SteamworksClient = appId !== undefined ? steamworks.init(appId) : steamworks.init();
    return client;
  } catch {
    return null;
  }
}

/**
 * Zips `campaignDir` plus the manifest into an uploadable package. Actual
 * archive creation is delegated to the caller-supplied `zipDirectory` so
 * this module stays testable without real filesystem/zip dependencies.
 */
export interface SteamWorkshopAdapterOptions {
  appId?: number;
  zipDirectory?: (dir: string) => Promise<string>;
}

export function createSteamWorkshopAdapter(options: SteamWorkshopAdapterOptions = {}): WorkshopAdapter {
  const client = loadSteamworks(options.appId);
  const appId = options.appId ?? 0;

  return {
    isAvailable(): boolean {
      return client !== null;
    },

    async publish(manifest: WorkshopPackageManifest, campaignDir: string): Promise<WorkshopItem> {
      if (!client) {
        throw new Error('Steam Workshop is unavailable');
      }
      if (options.zipDirectory) {
        await options.zipDirectory(campaignDir);
      }
      const { itemId } = await client.workshop.createItem(appId);
      const update = client.workshop.startItemUpdate(appId, itemId);
      await client.workshop.submitItemUpdate(update, `Publish ${manifest.title}`);

      return {
        steamPublishedFileId: itemId.toString(),
        title: manifest.title,
        description: manifest.description,
        authorName: manifest.authorSteamId,
        tags: manifest.tags,
        subscribed: true,
        installed: true,
        localPath: campaignDir,
      };
    },

    async subscribe(steamPublishedFileId: string): Promise<void> {
      if (!client) return;
      await client.workshop.subscribeItem(BigInt(steamPublishedFileId));
    },

    async unsubscribe(steamPublishedFileId: string): Promise<void> {
      if (!client) return;
      await client.workshop.unsubscribeItem(BigInt(steamPublishedFileId));
    },

    async getSubscribedItems(): Promise<WorkshopItem[]> {
      if (!client) return [];
      const ids = client.workshop.getSubscribedItems();
      return ids.map((itemId) => {
        const info = client.workshop.getItemInstallInfo(itemId);
        return {
          steamPublishedFileId: itemId.toString(),
          title: '',
          description: '',
          authorName: '',
          tags: [],
          subscribed: true,
          installed: info !== null,
          ...(info ? { localPath: info.folder } : {}),
        };
      });
    },

    async getInstalledItems(): Promise<WorkshopItem[]> {
      const subscribed = await this.getSubscribedItems();
      return subscribed.filter((item) => item.installed);
    },

    async download(steamPublishedFileId: string): Promise<string> {
      if (!client) {
        throw new Error('Steam Workshop is unavailable');
      }
      const itemId = BigInt(steamPublishedFileId);
      await client.workshop.downloadItem(itemId);
      const info = client.workshop.getItemInstallInfo(itemId);
      if (!info) {
        throw new Error(`Workshop item ${steamPublishedFileId} did not install`);
      }
      return info.folder;
    },
  };
}
