/**
 * Editor workspace preferences — per-campaign, per-browser editor UI state
 * (which layers are shown/locked, the active palette category, brush mode,
 * layer-panel collapse state, sidebar scroll position).
 *
 * This is deliberately NOT room/campaign data: it never appears in exported
 * campaign JSON, never marks a room dirty, and never creates undo/history
 * entries. It follows the same localStorage try/catch/sanitize pattern as
 * editorThemeSlotPreferences.ts / mapSketchPreference.ts.
 *
 * Explicitly NOT persisted (always reset to a safe default on load):
 *   - Solo state (`solo` on each layer) — a per-session isolation tool, not
 *     a durable preference; reopening the editor solo'd would be surprising.
 *   - Selection, active gestures, pending placement anchors — transient.
 *   - Undo/redo history.
 *   - Transient blocked-placement feedback.
 */

import { LAYER_IDS, type LayerId, type EditorLayersState, createDefaultEditorLayers } from './editorLayers';
import { PALETTE_CATEGORIES, type PaletteCategory } from './editorPaletteItems';
import type { BrushMode } from './editorDropdownData';
import {
  defaultPanelLayout, normalizePanelLayout, type EditorPanelLayout,
} from './editorPanelLayout';

/**
 * Schema version.
 *
 * v1 → v2 added the dockable-panel `panelLayout` and split the single
 * `sidebarScrollTop` into independent `leftSidebarScrollTop` /
 * `rightSidebarScrollTop`. Migration is handled inside `sanitize()` rather
 * than by changing the storage key, so an existing v1 record keeps every
 * preference it already had (layers, category, brush, layer-panel collapse,
 * and its scroll position, which is reinterpreted as the LEFT sidebar's).
 */
export const EDITOR_WORKSPACE_PREFS_VERSION = 2;

/** Stable storage key for the built-in (non-custom) campaign. */
export const BUILTIN_CAMPAIGN_WORKSPACE_KEY = 'DUSTWEAVER_CAMPAIGN';

const STORAGE_KEY_PREFIX = 'dw_editor_workspace_prefs_v1__';

function storageKeyFor(campaignKey: string): string {
  // Sanitize to keep the key filesystem/localStorage-safe regardless of what
  // a campaign id contains (defensive — campaign ids are normally simple).
  const safeKey = campaignKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${STORAGE_KEY_PREFIX}${safeKey}`;
}

/** Per-layer prefs that are safe to persist (deliberately excludes `solo`). */
export interface EditorWorkspaceLayerPrefs {
  visible: boolean;
  locked: boolean;
  selectOnly: boolean;
}

export interface EditorWorkspacePreferences {
  version: number;
  /** Keyed by LayerId; a missing entry means "use the default" (all-visible/unlocked). */
  layers: Partial<Record<LayerId, EditorWorkspaceLayerPrefs>>;
  layerPanelCollapsed: boolean;
  activeCategory: PaletteCategory;
  brushMode: BrushMode;
  /** Left editor sidebar's scrollTop, in pixels. (v1's `sidebarScrollTop`.) */
  leftSidebarScrollTop: number;
  /** Right editor sidebar's scrollTop, in pixels. Added in v2; v1 records default it to 0. */
  rightSidebarScrollTop: number;
  /**
   * Dockable-panel arrangement: which panels are in each sidebar (and in what
   * order) plus any floating panel windows. Always a complete, normalized
   * layout — see normalizePanelLayout's invariants.
   */
  panelLayout: EditorPanelLayout;
  sidebarsSwapped: boolean;
}

export function defaultEditorWorkspacePreferences(): EditorWorkspacePreferences {
  return {
    version: EDITOR_WORKSPACE_PREFS_VERSION,
    layers: {},
    layerPanelCollapsed: false,
    activeCategory: 'blocks',
    brushMode: 'single',
    leftSidebarScrollTop: 0,
    rightSidebarScrollTop: 0,
    panelLayout: defaultPanelLayout(),
    sidebarsSwapped: false,
  };
}

const VALID_BRUSH_MODES: readonly BrushMode[] = ['single', '3x3', '5x5', 'rect', 'fill'];

function isValidLayerId(v: unknown): v is LayerId {
  return typeof v === 'string' && (LAYER_IDS as readonly string[]).includes(v);
}

/**
 * Legacy palette-category ids retired from `PALETTE_CATEGORIES` map to their
 * replacement here, so a stored `activeCategory` from an older build
 * normalizes instead of producing a blank/unknown palette on load.
 *
 * `timeStop` was folded into the canonical `fields` category (which also now
 * holds `challenge_field`) — see editorPaletteItems.ts.
 */
const LEGACY_CATEGORY_ALIASES: Readonly<Record<string, PaletteCategory>> = {
  timeStop: 'fields',
};

function sanitizeActiveCategory(v: unknown, fallback: PaletteCategory): PaletteCategory {
  if (typeof v !== 'string') return fallback;
  const aliased = LEGACY_CATEGORY_ALIASES[v] ?? v;
  return (PALETTE_CATEGORIES as readonly string[]).includes(aliased) ? (aliased as PaletteCategory) : fallback;
}

function sanitizeLayerPrefs(v: unknown): EditorWorkspaceLayerPrefs | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  return {
    visible: typeof o.visible === 'boolean' ? o.visible : true,
    locked: typeof o.locked === 'boolean' ? o.locked : false,
    selectOnly: typeof o.selectOnly === 'boolean' ? o.selectOnly : false,
  };
}

/**
 * Sanitizes an arbitrary parsed JSON value into a safe, complete
 * EditorWorkspacePreferences — never throws. Unknown/missing/wrong-typed
 * fields fall back to defaults; unknown layer ids in stored data are
 * silently dropped (e.g. from a future version); layers newly added since
 * the record was saved are simply absent (defaulting to visible/unlocked
 * when applied — see applyWorkspacePreferencesToLayers).
 */
function sanitize(raw: unknown): EditorWorkspacePreferences {
  const fallback = defaultEditorWorkspacePreferences();
  if (typeof raw !== 'object' || raw === null) return fallback;
  const o = raw as Record<string, unknown>;

  const layers: Partial<Record<LayerId, EditorWorkspaceLayerPrefs>> = {};
  if (typeof o.layers === 'object' && o.layers !== null) {
    for (const [id, v] of Object.entries(o.layers as Record<string, unknown>)) {
      if (!isValidLayerId(id)) continue; // drop unknown/retired layer ids
      const sanitized = sanitizeLayerPrefs(v);
      if (sanitized !== null) layers[id] = sanitized;
    }
  }

  return {
    version: EDITOR_WORKSPACE_PREFS_VERSION,
    layers,
    layerPanelCollapsed: typeof o.layerPanelCollapsed === 'boolean' ? o.layerPanelCollapsed : fallback.layerPanelCollapsed,
    activeCategory: sanitizeActiveCategory(o.activeCategory, fallback.activeCategory),
    brushMode: VALID_BRUSH_MODES.includes(o.brushMode as BrushMode) ? (o.brushMode as BrushMode) : fallback.brushMode,
    // v1 → v2: the single `sidebarScrollTop` becomes the LEFT sidebar's, and
    // the right sidebar defaults to 0. A v2 record's own
    // `leftSidebarScrollTop` takes precedence when present.
    leftSidebarScrollTop: sanitizeScrollTop(o.leftSidebarScrollTop)
      ?? sanitizeScrollTop(o.sidebarScrollTop)
      ?? fallback.leftSidebarScrollTop,
    rightSidebarScrollTop: sanitizeScrollTop(o.rightSidebarScrollTop) ?? fallback.rightSidebarScrollTop,
    // Absent (v1), malformed, or partial layouts all normalize to a complete
    // layout with every registered panel in exactly one location.
    panelLayout: normalizePanelLayout(o.panelLayout),
    sidebarsSwapped: typeof o.sidebarsSwapped === 'boolean' ? o.sidebarsSwapped : fallback.sidebarsSwapped,
  };
}

function sanitizeScrollTop(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  return v;
}

/**
 * Loads workspace preferences for the given campaign key. Missing, corrupt
 * (unparsable JSON), or wrong-shaped data all safely fall back to defaults —
 * this must never throw regardless of what's in storage.
 */
export function loadEditorWorkspacePreferences(campaignKey: string): EditorWorkspacePreferences {
  try {
    const raw = localStorage.getItem(storageKeyFor(campaignKey));
    if (raw === null) return defaultEditorWorkspacePreferences();
    return sanitize(JSON.parse(raw));
  } catch {
    return defaultEditorWorkspacePreferences();
  }
}

export function saveEditorWorkspacePreferencesNow(campaignKey: string, prefs: EditorWorkspacePreferences): void {
  try {
    localStorage.setItem(storageKeyFor(campaignKey), JSON.stringify(prefs));
  } catch {
    // Ignore quota / security errors — preferences are a convenience, not critical state.
  }
}

/**
 * Debounced saver — call `schedule()` on every workspace-preference-affecting
 * change; the actual write is coalesced to at most one per `delayMs`.
 * Call `flush()` on editor close to guarantee the latest state is persisted
 * even if a debounce window hasn't elapsed yet.
 */
export interface DebouncedWorkspacePreferencesSaver {
  schedule(prefs: EditorWorkspacePreferences): void;
  flush(prefs?: EditorWorkspacePreferences): void;
  cancel(): void;
}

export function createDebouncedWorkspacePreferencesSaver(
  campaignKey: string,
  delayMs = 500,
): DebouncedWorkspacePreferencesSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: EditorWorkspacePreferences | null = null;

  function schedule(prefs: EditorWorkspacePreferences): void {
    pending = prefs;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (pending !== null) {
        saveEditorWorkspacePreferencesNow(campaignKey, pending);
        pending = null;
      }
    }, delayMs);
  }

  function flush(prefs?: EditorWorkspacePreferences): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const toSave = prefs ?? pending;
    if (toSave !== null) {
      saveEditorWorkspacePreferencesNow(campaignKey, toSave);
    }
    pending = null;
  }

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  }

  return { schedule, flush, cancel };
}

/**
 * Builds a full EditorLayersState by starting from
 * createDefaultEditorLayers() (so any layer absent from `prefs` — including
 * a layer added in a later version than the stored record — safely defaults
 * to visible/unlocked/not-select-only) and overlaying only the fields Phase
 * 6 persists (`visible`, `locked`, `selectOnly`). `solo` is always left at
 * its default (false) — it is never read from preferences.
 */
export function applyWorkspacePreferencesToLayers(
  prefs: EditorWorkspacePreferences,
): EditorLayersState {
  const layers = createDefaultEditorLayers();
  for (const id of LAYER_IDS) {
    const stored = prefs.layers[id];
    if (stored === undefined) continue;
    layers[id] = {
      ...layers[id],
      visible: stored.visible,
      locked: stored.locked,
      selectOnly: stored.selectOnly,
    };
  }
  return layers;
}

/** Extracts the persistable slice of a live EditorLayersState. */
export function extractWorkspaceLayerPrefs(layers: EditorLayersState): Partial<Record<LayerId, EditorWorkspaceLayerPrefs>> {
  const out: Partial<Record<LayerId, EditorWorkspaceLayerPrefs>> = {};
  for (const id of LAYER_IDS) {
    const l = layers[id];
    out[id] = { visible: l.visible, locked: l.locked, selectOnly: l.selectOnly };
  }
  return out;
}

// ── Built-in layer presets ───────────────────────────────────────────────────

export type LayerPresetId = 'all' | 'geometry' | 'gameplay' | 'lightingVfx' | 'triggersAndPaths';

export interface LayerPreset {
  id: LayerPresetId;
  label: string;
  /** Exactly the layers that are visible under this preset — every other LayerId is hidden. */
  visibleLayers: readonly LayerId[];
}

export const LAYER_PRESETS: readonly LayerPreset[] = [
  {
    id: 'all',
    label: 'All',
    visibleLayers: LAYER_IDS,
  },
  {
    id: 'geometry',
    label: 'Geometry',
    visibleLayers: ['background', 'terrain', 'foreground', 'dynamicGeometry', 'roomStructure'],
  },
  {
    id: 'gameplay',
    label: 'Gameplay',
    visibleLayers: ['terrain', 'dynamicGeometry', 'liquids', 'powder', 'objects', 'hazards', 'enemies', 'fields', 'roomStructure'],
  },
  {
    id: 'lightingVfx',
    label: 'Lighting/VFX',
    visibleLayers: ['background', 'terrain', 'foreground', 'lighting'],
  },
  {
    id: 'triggersAndPaths',
    label: 'Triggers & Paths',
    visibleLayers: ['terrain', 'roomStructure', 'triggers', 'paths', 'editorMetadata'],
  },
];

export function getLayerPreset(id: LayerPresetId): LayerPreset {
  const preset = LAYER_PRESETS.find(p => p.id === id);
  if (preset === undefined) throw new Error(`Unknown layer preset: ${id}`);
  return preset;
}

/**
 * Applies a preset's exact visibility mask to `layers`, returning a new
 * EditorLayersState. Per Phase 6 spec: clears solo and selectOnly on every
 * layer (no preset deliberately uses either), and never touches `locked`.
 */
export function applyLayerPreset(layers: EditorLayersState, presetId: LayerPresetId): EditorLayersState {
  const preset = getLayerPreset(presetId);
  const visibleSet = new Set(preset.visibleLayers);
  const next = {} as EditorLayersState;
  for (const id of LAYER_IDS) {
    next[id] = {
      visible: visibleSet.has(id),
      locked: layers[id].locked,
      solo: false,
      selectOnly: false,
    };
  }
  return next;
}

/** "Reset Workspace" — restores every workspace default (layers, category, brush, collapse, scroll). */
export function resetWorkspaceLayers(): EditorLayersState {
  return createDefaultEditorLayers();
}

/**
 * "Reset Workspace" — the default dockable-panel arrangement (both sidebars'
 * panel sets and order restored, every floating window redocked). This is the
 * escape hatch when a user has dragged panels into an unusable arrangement,
 * so it must clear floating state too, not just reorder the sidebars.
 */
export function resetWorkspacePanelLayout(): EditorPanelLayout {
  return defaultPanelLayout();
}
