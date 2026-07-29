import { ACHIEVEMENT_IDS } from './achievementIds';
import type { AchievementId, AchievementStatus, PlatformAdapter } from './types';

/**
 * In-memory fake `PlatformAdapter` used by tests and non-Steam/browser mode.
 * All achievements start locked; `unlockAchievement` is idempotent.
 */
export function createFakeSteamAdapter(): PlatformAdapter {
  const unlocked = new Map<AchievementId, number>();

  return {
    isAvailable(): boolean {
      return true;
    },

    async unlockAchievement(id: AchievementId): Promise<void> {
      if (!unlocked.has(id)) {
        unlocked.set(id, Date.now());
      }
    },

    async getAchievementStatus(id: AchievementId): Promise<AchievementStatus> {
      const unlockTimestampMs = unlocked.get(id);
      return {
        id,
        unlocked: unlockTimestampMs !== undefined,
        ...(unlockTimestampMs !== undefined ? { unlockTimestampMs } : {}),
      };
    },

    async getAllAchievementStatuses(): Promise<AchievementStatus[]> {
      return ACHIEVEMENT_IDS.map((id) => {
        const unlockTimestampMs = unlocked.get(id);
        return {
          id,
          unlocked: unlockTimestampMs !== undefined,
          ...(unlockTimestampMs !== undefined ? { unlockTimestampMs } : {}),
        };
      });
    },

    async storeStats(): Promise<void> {
      // No-op for the fake adapter.
    },

    async getPersonaName(): Promise<string | null> {
      return null;
    },
  };
}
