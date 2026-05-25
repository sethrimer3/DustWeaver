/**
 * debugPanelManager.ts — Per-panel debug overlay visibility state.
 *
 * Each canvas debug overlay (movement, grapple, water, performance, chunks,
 * particles, room) can be toggled on/off independently via this module.
 * State is persisted to localStorage so the last-used configuration is
 * restored on next launch.
 *
 * All panels default to hidden (false) so the game screen is clean on first
 * load.  Users opt in by clicking the toggle buttons in the debug panel.
 */

export type DebugPanelId =
  | 'movement'
  | 'grapple'
  | 'water'
  | 'performance'
  | 'chunks'
  | 'particles'
  | 'room'
  | 'freeze'
  | 'prewarm';

export interface DebugPanelVisibility {
  movement: boolean;
  grapple: boolean;
  water: boolean;
  performance: boolean;
  chunks: boolean;
  particles: boolean;
  room: boolean;
  freeze: boolean;
  prewarm: boolean;
}

const STORAGE_KEY = 'dw_debug_panels';

function makeDefaults(): DebugPanelVisibility {
  return {
    movement:    false,
    grapple:     false,
    water:       false,
    performance: false,
    chunks:      false,
    particles:   false,
    room:        false,
    freeze:      false,
    prewarm:     false,
  };
}

function loadFromStorage(): DebugPanelVisibility {
  const defaults = makeDefaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaults;
    const parsed: unknown = JSON.parse(raw);
    // Accept only plain objects; validate each key/value individually.
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return defaults;
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as DebugPanelId[]) {
      const val = (parsed as Record<string, unknown>)[key];
      if (typeof val === 'boolean') result[key] = val;
    }
    return result;
  } catch {
    return defaults;
  }
}

function saveToStorage(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(debugPanelVisibility));
  } catch {
    // Ignore quota / security errors — state is still valid in-memory.
  }
}

/** Mutable singleton: each field is true when that debug overlay is visible. */
export const debugPanelVisibility: DebugPanelVisibility = loadFromStorage();

/** Toggle one debug panel on/off and persist the change. */
export function toggleDebugPanel(id: DebugPanelId): void {
  debugPanelVisibility[id] = !debugPanelVisibility[id];
  saveToStorage();
}

/** Hide all debug panels and persist. */
export function hideAllDebugPanels(): void {
  (Object.keys(debugPanelVisibility) as DebugPanelId[]).forEach((key) => {
    debugPanelVisibility[key] = false;
  });
  saveToStorage();
}

/**
 * Returns true when a given debug panel should be rendered.
 *
 * When `visibility` is undefined (legacy / no caller preference), the panel
 * is treated as visible for backward-compatibility.  When provided, the
 * panel is visible only if its flag is true.
 */
export function isPanelVisible(id: DebugPanelId, visibility?: DebugPanelVisibility): boolean {
  return visibility === undefined || visibility[id];
}
