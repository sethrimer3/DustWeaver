/**
 * mapSketchPreference.ts — Which world-map sketch renderer to use.
 *
 * The legacy hand-sketch renderer (mapSketchRenderer.ts's `drawRoomSketch`)
 * is kept as a dev-only opt-in behind the "Legacy Map Sketch" checkbox; the
 * new open-air renderer (`drawRoomSketchOpenAir`) is the default for players.
 */

const STORAGE_KEY = 'dw_legacy_map_sketch';

export function isLegacyMapSketchEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setLegacyMapSketchEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore quota / security errors.
  }
}
