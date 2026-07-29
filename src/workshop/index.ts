/**
 * Single entry point for obtaining the active `WorkshopAdapter`.
 * Mirrors `src/platform/index.ts` — real adapter is main-process only and
 * reached over IPC; everything else uses the in-memory fake.
 */
import { createFakeWorkshopAdapter } from './fakeWorkshopAdapter';
import { createRendererWorkshopAdapter } from './rendererWorkshopAdapter';
import type { WorkshopAdapter } from './types';

let cachedAdapter: WorkshopAdapter | null = null;

export function getWorkshopAdapter(): WorkshopAdapter {
  if (!cachedAdapter) {
    const hasElectronBridge = typeof window !== 'undefined' && Boolean(window.electronPlatform);
    cachedAdapter = hasElectronBridge ? createRendererWorkshopAdapter() : createFakeWorkshopAdapter();
  }
  return cachedAdapter;
}

/** Test-only escape hatch to reset the cached adapter between test cases. */
export function resetWorkshopAdapterForTests(): void {
  cachedAdapter = null;
}

export type { WorkshopAdapter, WorkshopItem, WorkshopPackageManifest } from './types';
