import type { WorkshopAdapter, WorkshopInstalledPackage, WorkshopItem, WorkshopPackageManifest } from './types';

/**
 * Test/dev-only registry of installed package contents keyed by `localPath`,
 * consulted by every fake adapter instance's `readInstalledPackage`. Real
 * subscribe/download flows never populate this — only
 * `registerFakeInstalledPackage` (tests) or a same-session `publish` with a
 * matching path would. Kept module-scoped (not per-adapter-instance) so tests
 * can register content before or after constructing the adapter under test.
 */
const fakeInstalledPackagesByPath = new Map<string, WorkshopInstalledPackage>();

/** Test-only: registers package content to be returned by `readInstalledPackage(localPath)`. */
export function registerFakeInstalledPackage(localPath: string, pkg: WorkshopInstalledPackage): void {
  fakeInstalledPackagesByPath.set(localPath, pkg);
}

/** Test-only: clears all registered fake package content. */
export function clearFakeInstalledPackages(): void {
  fakeInstalledPackagesByPath.clear();
}

/**
 * In-memory fake `WorkshopAdapter` used by tests and non-Steam mode.
 * Items live in a `Map` — no filesystem access.
 */
export function createFakeWorkshopAdapter(): WorkshopAdapter {
  const items = new Map<string, WorkshopItem>();
  let nextId = 1;

  return {
    isAvailable(): boolean {
      return true;
    },

    async publish(manifest: WorkshopPackageManifest, campaignDir: string): Promise<WorkshopItem> {
      const steamPublishedFileId = `fake-${nextId++}`;
      const item: WorkshopItem = {
        steamPublishedFileId,
        title: manifest.title,
        description: manifest.description,
        authorName: manifest.authorSteamId,
        tags: manifest.tags,
        subscribed: true,
        installed: true,
        localPath: campaignDir,
      };
      items.set(steamPublishedFileId, item);
      return item;
    },

    async subscribe(steamPublishedFileId: string): Promise<void> {
      const item = items.get(steamPublishedFileId);
      if (item) {
        item.subscribed = true;
      } else {
        items.set(steamPublishedFileId, {
          steamPublishedFileId,
          title: `Item ${steamPublishedFileId}`,
          description: '',
          authorName: '',
          tags: [],
          subscribed: true,
          installed: false,
        });
      }
    },

    async unsubscribe(steamPublishedFileId: string): Promise<void> {
      const item = items.get(steamPublishedFileId);
      if (item) {
        item.subscribed = false;
      }
    },

    async getSubscribedItems(): Promise<WorkshopItem[]> {
      return Array.from(items.values()).filter((item) => item.subscribed);
    },

    async getInstalledItems(): Promise<WorkshopItem[]> {
      return Array.from(items.values()).filter((item) => item.installed);
    },

    async download(steamPublishedFileId: string): Promise<string> {
      const item = items.get(steamPublishedFileId);
      if (!item) {
        throw new Error(`Unknown Workshop item: ${steamPublishedFileId}`);
      }
      item.installed = true;
      item.localPath = item.localPath ?? `/fake-workshop/${steamPublishedFileId}`;
      return item.localPath;
    },

    async readInstalledPackage(localPath: string): Promise<WorkshopInstalledPackage> {
      const pkg = fakeInstalledPackagesByPath.get(localPath);
      if (!pkg) {
        throw new Error(`No fake Workshop package registered at "${localPath}". This is expected in web/dev builds without a real Steam install.`);
      }
      return pkg;
    },
  };
}
