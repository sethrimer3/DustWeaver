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
  | 'room';

export interface DebugPanelVisibility {
  movement: boolean;
  grapple: boolean;
  water: boolean;
  performance: boolean;
  chunks: boolean;
  particles: boolean;
  room: boolean;
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
  };
}

function loadFromStorage(): DebugPanelVisibility {
  const defaults = makeDefaults();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<DebugPanelVisibility>) };
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
