/**
 * Editor panel registry — the single source of truth for which top-level
 * editor menus are dockable/floatable, what they're called, and where they
 * live by default.
 *
 * Before this module, placement was expressed as scattered
 * `leftContentGroup.appendChild(...)` / `rightContentGroup.appendChild(...)`
 * calls inside editorUI.ts, so "which sidebar owns this panel" was a
 * hardcoded property of the construction order. Panels are now registered
 * here and mounted by the docking system (editorPanelDocking.ts) according to
 * a persisted layout (editorPanelLayout.ts).
 *
 * Deliberately NOT registered here — fixed editor chrome that must stay put
 * because it is workspace-level, not a menu: the campaign title, the
 * Save / Save & Test / confirm-cancel bar, "Save and Export Campaign", the
 * Zone Map / Itemized Map row, the room density indicator, the developer
 * checks block, the sidebar hide arrows, and the sidebar reveal tabs.
 *
 * Pure data — no DOM access — so layout behavior is unit-testable without a
 * DOM harness.
 */

/**
 * Stable per-panel identity. These strings are persisted in workspace
 * preferences, so renaming one is a breaking change: an old saved layout
 * naming the retired id will drop it (and the panel then falls back to its
 * registered default location). They intentionally match the existing
 * `createCollapsibleSection` session keys so section-collapse session state
 * and panel-layout state agree on one vocabulary.
 */
export type EditorPanelId =
  | 'tools'
  | 'brush'
  | 'categories'
  | 'palette'
  | 'roomDimensions'
  | 'background'
  | 'roomSong'
  | 'layers'
  | 'inspector'
  | 'export';

/** Which physical sidebar a panel is docked in. Floating panels are in neither. */
export type EditorSidebarSide = 'left' | 'right';

export interface EditorPanelDef {
  readonly id: EditorPanelId;
  /** Human-readable title shown in the drag grip / floating window header. */
  readonly title: string;
  /** Sidebar this panel occupies on a fresh workspace (or after Reset Workspace). */
  readonly defaultSide: EditorSidebarSide;
  /** Sort order within `defaultSide`; lower is nearer the top. */
  readonly defaultOrder: number;
}

/**
 * Registered panels, in their default arrangement:
 *   left  — Room Dimensions, Background, Room Song, Inspector, Layers, Export
 *   right — Tools, Brush, Categories, Palette
 */
export const EDITOR_PANEL_DEFS: readonly EditorPanelDef[] = Object.freeze([
  // Right sidebar (placement controls).
  { id: 'tools', title: 'Tools', defaultSide: 'right', defaultOrder: 0 },
  { id: 'brush', title: 'Brush', defaultSide: 'right', defaultOrder: 1 },
  { id: 'categories', title: 'Categories', defaultSide: 'right', defaultOrder: 2 },
  { id: 'palette', title: 'Palette', defaultSide: 'right', defaultOrder: 3 },
  // Left sidebar (room/global settings and inspection).
  { id: 'roomDimensions', title: 'Room Dimensions', defaultSide: 'left', defaultOrder: 0 },
  { id: 'background', title: 'Background', defaultSide: 'left', defaultOrder: 1 },
  { id: 'roomSong', title: 'Room Song', defaultSide: 'left', defaultOrder: 2 },
  { id: 'inspector', title: 'Inspector', defaultSide: 'left', defaultOrder: 3 },
  { id: 'layers', title: 'Layers', defaultSide: 'left', defaultOrder: 4 },
  { id: 'export', title: 'Export', defaultSide: 'left', defaultOrder: 5 },
] as const);

/** Every registered panel id. */
export const EDITOR_PANEL_IDS: readonly EditorPanelId[] = Object.freeze(
  EDITOR_PANEL_DEFS.map(d => d.id),
);

const PANEL_DEF_BY_ID = new Map<EditorPanelId, EditorPanelDef>(
  EDITOR_PANEL_DEFS.map(d => [d.id, d]),
);

export function isEditorPanelId(v: unknown): v is EditorPanelId {
  return typeof v === 'string' && PANEL_DEF_BY_ID.has(v as EditorPanelId);
}

export function getEditorPanelDef(id: EditorPanelId): EditorPanelDef {
  const def = PANEL_DEF_BY_ID.get(id);
  if (def === undefined) throw new Error(`Unknown editor panel id: ${id}`);
  return def;
}

/** Panel ids registered to `side`, in their default top-to-bottom order. */
export function defaultPanelIdsForSide(side: EditorSidebarSide): EditorPanelId[] {
  return EDITOR_PANEL_DEFS
    .filter(d => d.defaultSide === side)
    .slice()
    .sort((a, b) => a.defaultOrder - b.defaultOrder)
    .map(d => d.id);
}
