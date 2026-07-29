/**
 * Renderer-side `WorkshopAdapter` client. Calls
 * `window.electronPlatform.invoke(channel, payload)` — same bridge used by
 * `../platform/rendererPlatform.ts` — and forwards to the main-process
 * Steam Workshop adapter over IPC.
 */
import {
  WORKSHOP_GET_ITEMS,
  WORKSHOP_INSTALL_PATH,
  WORKSHOP_PUBLISH,
  WORKSHOP_SUBSCRIBE,
  WORKSHOP_UNSUBSCRIBE,
  type WorkshopGetItemsResponse,
  type WorkshopInstallPathResponse,
  type WorkshopPublishResponse,
  type WorkshopSubscribeResponse,
  type WorkshopUnsubscribeResponse,
} from '../platform/ipcBridge';
import type { ElectronPlatformBridge } from '../platform/rendererPlatform';
import type { WorkshopAdapter, WorkshopItem, WorkshopPackageManifest } from './types';

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

    async publish(manifest: WorkshopPackageManifest, campaignDir: string): Promise<WorkshopItem> {
      const response = (await bridge.invoke(WORKSHOP_PUBLISH, { manifest, campaignDir })) as WorkshopPublishResponse;
      if (!response.ok) throw new Error(response.error);
      return response.item;
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
      const response = (await bridge.invoke(WORKSHOP_INSTALL_PATH, { steamPublishedFileId })) as WorkshopInstallPathResponse;
      if (!response.ok) throw new Error(response.error);
      if (!response.installPath) throw new Error(`Workshop item ${steamPublishedFileId} is not installed`);
      return response.installPath;
    },
  };
}
