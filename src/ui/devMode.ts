/**
 * devMode.ts — General-purpose developer mode flag.
 *
 * Gates debug-only UI elements that should never be visible to players
 * (e.g. the "Legacy Map Sketch" checkbox on the world map). Persisted to
 * localStorage, following the same pattern as debugPanelManager.ts.
 */

const STORAGE_KEY = 'dw_dev_mode';

export function isDevModeEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setDevModeEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore quota / security errors.
  }
}
