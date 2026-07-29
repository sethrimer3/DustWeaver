/**
 * Real Steamworks UGC-backed `WorkshopAdapter`. Runs ONLY in the Electron
 * main process — never import this module from renderer code. The renderer
 * talks to it exclusively through the WORKSHOP_* IPC channels in
 * `../platform/ipcBridge.ts`.
 *
 * `steamworks.js` is required lazily and wrapped in a try/catch so builds
 * without the native module degrade to `isAvailable() === false`.
 */
import type { WorkshopAdapter, WorkshopInstalledPackage, WorkshopItem, WorkshopPackageManifest } from './types';
import type { WorkshopPackageFile } from './packageValidator';

// This module only ever runs in the Electron main process (Node), never in
// the browser/renderer build, so a bare ambient `require` is safe here.
declare const require: (id: string) => unknown;

interface NodeFsModule {
  existsSync(path: string): boolean;
  statSync(path: string): { isDirectory(): boolean; isFile(): boolean; size: number };
  readdirSync(path: string): string[];
  readFileSync(path: string, encoding: 'utf8'): string;
  realpathSync(path: string): string;
}
interface NodePathModule {
  join(...segments: string[]): string;
  relative(from: string, to: string): string;
  resolve(...segments: string[]): string;
  sep: string;
}

function walkPackageFiles(fs: NodeFsModule, path: NodePathModule, rootDir: string): WorkshopPackageFile[] {
  const results: WorkshopPackageFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        const relPath = path.relative(rootDir, fullPath).split(path.sep).join('/');
        results.push({ path: relPath, sizeBytes: stat.size });
      }
    }
  };
  walk(rootDir);
  return results;
}

/**
 * Reads an installed Workshop package directory: `workshop-meta.json` at the
 * root, plus exactly one `*.dwcampaign.json` file (root or nested). Used by
 * both the real Steam adapter and, indirectly, documents the on-disk shape
 * `electron/platformBridge.cjs`'s `dw:workshop-read-package` handler mirrors
 * (that file cannot import this TS module directly — see its own docstring).
 */
export function readInstalledWorkshopPackageFromDisk(localPath: string): WorkshopInstalledPackage {
  const fs = require('fs') as NodeFsModule;
  const path = require('path') as NodePathModule;

  const resolvedRoot = fs.realpathSync(path.resolve(localPath));
  if (!fs.existsSync(resolvedRoot) || !fs.statSync(resolvedRoot).isDirectory()) {
    throw new Error(`Workshop install directory not found: "${localPath}"`);
  }

  const files = walkPackageFiles(fs, path, resolvedRoot);

  const manifestFile = files.find((f) => f.path === 'workshop-meta.json');
  if (!manifestFile) {
    throw new Error(`Workshop package at "${localPath}" is missing workshop-meta.json`);
  }
  const manifest: unknown = JSON.parse(fs.readFileSync(path.join(resolvedRoot, 'workshop-meta.json'), 'utf8'));

  const campaignFiles = files.filter((f) => f.path.toLowerCase().endsWith('.dwcampaign.json'));
  if (campaignFiles.length === 0) {
    throw new Error(`Workshop package at "${localPath}" contains no .dwcampaign.json file`);
  }
  const campaignData: unknown = JSON.parse(fs.readFileSync(path.join(resolvedRoot, campaignFiles[0].path), 'utf8'));

  return { manifest, campaignData, files };
}

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

interface SteamworksModule {
  init(appId?: number): SteamworksClient;
}

function loadSteamworks(appId: number | undefined): SteamworksClient | null {
  try {
    const steamworks = require('steamworks.js') as SteamworksModule;
    return appId !== undefined ? steamworks.init(appId) : steamworks.init();
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

    async readInstalledPackage(localPath: string): Promise<WorkshopInstalledPackage> {
      return readInstalledWorkshopPackageFromDisk(localPath);
    },
  };
}
