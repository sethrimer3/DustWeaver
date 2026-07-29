/**
 * Renderer-side `PlatformAdapter` client. Calls
 * `window.electronPlatform.invoke(channel, payload)`, which the preload
 * script (electron/preload.cjs) exposes via `contextBridge` and forwards to
 * `ipcRenderer.invoke`. Falls back to the fake adapter when
 * `window.electronPlatform` is not defined (browser/non-Electron mode).
 */
import { createFakeSteamAdapter } from './fakeSteamAdapter';
import {
  PLATFORM_GET_ACHIEVEMENT,
  PLATFORM_GET_ALL_ACHIEVEMENTS,
  PLATFORM_GET_PERSONA_NAME,
  PLATFORM_STORE_STATS,
  PLATFORM_UNLOCK_ACHIEVEMENT,
  type PlatformGetAchievementResponse,
  type PlatformGetAllAchievementsResponse,
  type PlatformGetPersonaNameResponse,
  type PlatformStoreStatsResponse,
  type PlatformUnlockAchievementResponse,
} from './ipcBridge';
import type { AchievementId, AchievementStatus, PlatformAdapter } from './types';

export interface ElectronPlatformBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

declare global {
  interface Window {
    electronPlatform?: ElectronPlatformBridge;
  }
}

export function createRendererPlatformAdapter(): PlatformAdapter {
  const bridge = typeof window !== 'undefined' ? window.electronPlatform : undefined;
  if (!bridge) {
    return createFakeSteamAdapter();
  }

  return {
    isAvailable(): boolean {
      return true;
    },

    async unlockAchievement(id: AchievementId): Promise<void> {
      const response = (await bridge.invoke(PLATFORM_UNLOCK_ACHIEVEMENT, { id })) as PlatformUnlockAchievementResponse;
      if (!response.ok) {
        throw new Error(response.error);
      }
    },

    async getAchievementStatus(id: AchievementId): Promise<AchievementStatus> {
      const response = (await bridge.invoke(PLATFORM_GET_ACHIEVEMENT, { id })) as PlatformGetAchievementResponse;
      if (!response.ok) {
        throw new Error(response.error);
      }
      return response.status;
    },

    async getAllAchievementStatuses(): Promise<AchievementStatus[]> {
      const response = (await bridge.invoke(PLATFORM_GET_ALL_ACHIEVEMENTS)) as PlatformGetAllAchievementsResponse;
      if (!response.ok) {
        throw new Error(response.error);
      }
      return response.statuses;
    },

    async storeStats(): Promise<void> {
      const response = (await bridge.invoke(PLATFORM_STORE_STATS)) as PlatformStoreStatsResponse;
      if (!response.ok) {
        throw new Error(response.error);
      }
    },

    async getPersonaName(): Promise<string | null> {
      const response = (await bridge.invoke(PLATFORM_GET_PERSONA_NAME)) as PlatformGetPersonaNameResponse;
      if (!response.ok) {
        throw new Error(response.error);
      }
      return response.personaName;
    },
  };
}
