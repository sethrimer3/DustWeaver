import type { AchievementId } from './achievementIds';

export type { AchievementId };

export interface AchievementStatus {
  id: AchievementId;
  unlocked: boolean;
  unlockTimestampMs?: number;
}

/**
 * Platform-services abstraction. Implementations: `fakeSteamAdapter` (tests,
 * non-Steam/browser mode) and `steamAdapter` (Electron main process only,
 * behind an IPC boundary — see `ipcBridge.ts`).
 */
export interface PlatformAdapter {
  isAvailable(): boolean;
  unlockAchievement(id: AchievementId): Promise<void>;
  getAchievementStatus(id: AchievementId): Promise<AchievementStatus>;
  getAllAchievementStatuses(): Promise<AchievementStatus[]>;
  storeStats(): Promise<void>;
  getPersonaName(): Promise<string | null>;
}
