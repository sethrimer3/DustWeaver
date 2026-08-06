/**
 * Renderer-side `WorkshopAdapter` client. Calls
 * `window.electronPlatform.invoke(channel, payload)` — same bridge used by
 * `../platform/rendererPlatform.ts` — and forwards to the main-process
 * Steam Workshop adapter over IPC.
 */
import {
  WORKSHOP_DOWNLOAD,
  WORKSHOP_GET_ITEMS,
  WORKSHOP_INSTALL_PATH,
  WORKSHOP_PUBLISH,
  WORKSHOP_READ_PACKAGE,
  WORKSHOP_SUBSCRIBE,
  WORKSHOP_UNSUBSCRIBE,
  type WorkshopDownloadResponse,
  type WorkshopGetItemsResponse,
  type WorkshopInstallPathResponse,
  type WorkshopPublishResponse,
  type WorkshopReadPackageResponse,
  type WorkshopSubscribeResponse,
  type WorkshopUnsubscribeResponse,
} from '../platform/ipcBridge';
import type { ElectronPlatformBridge } from '../platform/rendererPlatform';
import type {
  WorkshopAdapter,
  WorkshopInstalledPackage,
  WorkshopItem,
  WorkshopPublishInput,
  WorkshopPublishResult,
} from './types';

export function createRendererWorkshopAdapter(): WorkshopAdapter {
  const bridge = (typeof window !== 'undefined' ? window.electronPlatform : undefined) as
    | ElectronPlatformBridge
    | undefined;

  if (!bridge) {
    throw new Error('createRendererWorkshopAdapter requires window.electronPlatform');
  }

  return {
    isAvailable(): boolean {
      return true;
    },

    async publish(input: WorkshopPublishInput): Promise<WorkshopPublishResult> {
      const response = (await bridge.invoke(WORKSHOP_PUBLISH, input)) as WorkshopPublishResponse;
      if (!response.ok) throw new Error(response.error);
      return { item: response.item, needsToAcceptAgreement: response.needsToAcceptAgreement };
    },

    async subscribe(steamPublishedFileId: string): Promise<void> {
      const response = (await bridge.invoke(WORKSHOP_SUBSCRIBE, { steamPublishedFileId })) as WorkshopSubscribeResponse;
      if (!response.ok) throw new Error(response.error);
    },

    async unsubscribe(steamPublishedFileId: string): Promise<void> {
      const response = (await bridge.invoke(WORKSHOP_UNSUBSCRIBE, { steamPublishedFileId })) as WorkshopUnsubscribeResponse;
      if (!response.ok) throw new Error(response.error);
    },

    async getSubscribedItems(): Promise<WorkshopItem[]> {
      const response = (await bridge.invoke(WORKSHOP_GET_ITEMS)) as WorkshopGetItemsResponse;
      if (!response.ok) throw new Error(response.error);
      return response.items.filter((item) => item.subscribed);
    },

    async getInstalledItems(): Promise<WorkshopItem[]> {
      const response = (await bridge.invoke(WORKSHOP_GET_ITEMS)) as WorkshopGetItemsResponse;
      if (!response.ok) throw new Error(response.error);
      return response.items.filter((item) => item.installed);
    },

    async download(steamPublishedFileId: string): Promise<string> {
      // Fast path: already on disk, no need to ask Steam to fetch anything.
      const installed = (await bridge.invoke(WORKSHOP_INSTALL_PATH, { steamPublishedFileId })) as WorkshopInstallPathResponse;
      if (installed.ok && installed.installPath) {
        return installed.installPath;
      }
      const response = (await bridge.invoke(WORKSHOP_DOWNLOAD, { steamPublishedFileId })) as WorkshopDownloadResponse;
      if (!response.ok) throw new Error(response.error);
      return response.installPath;
    },

    async readInstalledPackage(localPath: string): Promise<WorkshopInstalledPackage> {
      const response = (await bridge.invoke(WORKSHOP_READ_PACKAGE, { localPath })) as WorkshopReadPackageResponse;
      if (!response.ok) throw new Error(response.error);
      return { manifest: response.manifest, campaignData: response.campaignData, files: response.files };
    },
  };
}
