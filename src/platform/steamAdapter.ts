/**
 * Real Steamworks-backed `PlatformAdapter`. Runs ONLY in the Electron main
 * process — never import this module from renderer code. The renderer talks
 * to it exclusively through `ipcBridge.ts` channels (wired up in
 * electron/main.cjs) via `rendererPlatform.ts`.
 *
 * `steamworks.js` is required lazily and wrapped in a try/catch so builds
 * without the native module (or without a running Steam client) degrade to
 * `isAvailable() === false` instead of crashing.
 */
import { ACHIEVEMENT_IDS } from './achievementIds';
import type { AchievementId, AchievementStatus, PlatformAdapter } from './types';

// This module only ever runs in the Electron main process (Node), never in
// the browser/renderer build, so a bare ambient `require` is safe here.
declare const require: (id: string) => unknown;

interface SteamworksClient {
  achievement: {
    activate(name: string): boolean;
    isActivated(name: string): boolean;
  };
  localplayer: {
    getName(): string;
  };
  init(appId?: number): unknown;
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

export function createSteamAdapter(appId?: number): PlatformAdapter {
  const client = loadSteamworks(appId);

  return {
    isAvailable(): boolean {
      return client !== null;
    },

    async unlockAchievement(id: AchievementId): Promise<void> {
      if (!client) return;
      try {
        client.achievement.activate(id);
      } catch {
        // Steam client unavailable/transient failure — safe to ignore; the
        // save-load reconciliation step retries this on next launch.
      }
    },

    async getAchievementStatus(id: AchievementId): Promise<AchievementStatus> {
      if (!client) {
        return { id, unlocked: false };
      }
      try {
        return { id, unlocked: client.achievement.isActivated(id) };
      } catch {
        return { id, unlocked: false };
      }
    },

    async getAllAchievementStatuses(): Promise<AchievementStatus[]> {
      return Promise.all(ACHIEVEMENT_IDS.map((id) => this.getAchievementStatus(id)));
    },

    async storeStats(): Promise<void> {
      // steamworks.js persists stat/achievement writes automatically;
      // nothing further to flush explicitly.
    },

    async getPersonaName(): Promise<string | null> {
      if (!client) return null;
      try {
        return client.localplayer.getName();
      } catch {
        return null;
      }
    },
  };
}
