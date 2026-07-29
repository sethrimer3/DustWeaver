/**
 * Single entry point for obtaining the active `PlatformAdapter`.
 *
 * - Electron renderer with `window.electronPlatform` present → IPC-backed
 *   adapter that talks to the main-process Steam adapter.
 * - Everywhere else (tests, browser/dev mode) → in-memory fake adapter.
 *
 * Never import `steamAdapter.ts` here — it is main-process only.
 */
import { createFakeSteamAdapter } from './fakeSteamAdapter';
import { createRendererPlatformAdapter } from './rendererPlatform';
import type { PlatformAdapter } from './types';

let cachedAdapter: PlatformAdapter | null = null;

export function getPlatformAdapter(): PlatformAdapter {
  if (!cachedAdapter) {
    const hasElectronBridge = typeof window !== 'undefined' && Boolean(window.electronPlatform);
    cachedAdapter = hasElectronBridge ? createRendererPlatformAdapter() : createFakeSteamAdapter();
  }
  return cachedAdapter;
}

/** Test-only escape hatch to reset the cached adapter between test cases. */
export function resetPlatformAdapterForTests(): void {
  cachedAdapter = null;
}

export type { AchievementId, AchievementStatus, PlatformAdapter } from './types';
export { ACHIEVEMENT_IDS, isAchievementId } from './achievementIds';
