/**
 * Pure editor panel layout model — where every dockable panel currently
 * lives (left sidebar, right sidebar, or floating) plus the pure operations
 * that move panels between those locations.
 *
 * This is the persisted workspace-layout state behind the dockable-panel
 * system. It is deliberately DOM-free so every layout rule (ordering,
 * cross-sidebar moves, floating/redocking, sanitization of corrupt stored
 * data) is unit-testable without a jsdom harness — the DOM coordinator in
 * editorPanelDocking.ts only reflects the result of these functions.
 *
 * Invariants enforced by `normalizePanelLayout`, which every load path must
 * go through:
 *   - Every registered panel appears in exactly one location.
 *   - No duplicates, within or across locations.
 *   - Unknown/retired panel ids are discarded.
 *   - Panels missing from a stored layout (e.g. added after it was saved)
 *     appear at their registered default location and default order.
 *   - Non-finite/negative-infinite coordinates and z values fall back safely.
 *   - Floating z values are re-densified to 1..N preserving relative order.
 */

import {
  EDITOR_PANEL_IDS, isEditorPanelId, getEditorPanelDef, defaultPanelIdsForSide,
  type EditorPanelId, type EditorSidebarSide,
} from './editorPanelRegistry';

/** Position/stacking of one floating (undocked) panel window. */
export interface FloatingPanelState {
  /** Left offset in CSS pixels, relative to the editor root. */
  xPx: number;
  /** Top offset in CSS pixels, relative to the editor root. */
  yPx: number;
  /** Stacking order among floating panels; higher is nearer the front. */
  z: number;
}

export interface EditorPanelLayout {
  left: EditorPanelId[];
  right: EditorPanelId[];
  floating: Partial<Record<EditorPanelId, FloatingPanelState>>;
}

/** Where a single panel currently is. */
export type EditorPanelLocation =
  | { kind: 'docked'; side: EditorSidebarSide; index: number }
  | { kind: 'floating'; state: FloatingPanelState };

/** The registered default arrangement — also what "Reset Workspace" restores. */
export function defaultPanelLayout(): EditorPanelLayout {
  return {
    left: defaultPanelIdsForSide('left'),
    right: defaultPanelIdsForSide('right'),
    floating: {},
  };
}

export function clonePanelLayout(layout: EditorPanelLayout): EditorPanelLayout {
  const floating: Partial<Record<EditorPanelId, FloatingPanelState>> = {};
  for (const id of EDITOR_PANEL_IDS) {
    const f = layout.floating[id];
    if (f !== undefined) floating[id] = { xPx: f.xPx, yPx: f.yPx, z: f.z };
  }
  return { left: layout.left.slice(), right: layout.right.slice(), floating };
}

function sanitizeCoordinate(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
}

/**
 * Reads an arbitrary parsed-JSON value into a valid layout. Never throws:
 * corrupt stored preferences must never prevent the editor from opening.
 */
export function normalizePanelLayout(raw: unknown): EditorPanelLayout {
  const o = (typeof raw === 'object' && raw !== null) ? raw as Record<string, unknown> : {};

  // `claimed` enforces "exactly one location" — the first location to claim
  // an id wins and every later claim is dropped, which also removes
  // duplicates within a single array.
  const claimed = new Set<EditorPanelId>();

  function readSide(value: unknown): EditorPanelId[] {
    if (!Array.isArray(value)) return [];
    const out: EditorPanelId[] = [];
    for (const entry of value) {
      if (!isEditorPanelId(entry)) continue; // drop unknown/retired ids
      if (claimed.has(entry)) continue;      // drop duplicates
      claimed.add(entry);
      out.push(entry);
    }
    return out;
  }

  const left = readSide(o.left);
  const right = readSide(o.right);

  const floating: Partial<Record<EditorPanelId, FloatingPanelState>> = {};
  const floatingRaw = (typeof o.floating === 'object' && o.floating !== null)
    ? o.floating as Record<string, unknown>
    : {};
  // Collect first, so z can be re-densified deterministically below.
  const floatingEntries: { id: EditorPanelId; xPx: number; yPx: number; z: number }[] = [];
  for (const [id, v] of Object.entries(floatingRaw)) {
    if (!isEditorPanelId(id)) continue;
    if (claimed.has(id)) continue;
    if (typeof v !== 'object' || v === null) continue;
    const fo = v as Record<string, unknown>;
    const xPx = sanitizeCoordinate(fo.xPx);
    const yPx = sanitizeCoordinate(fo.yPx);
    // A floating panel with unusable coordinates can't be placed meaningfully;
    // leave it unclaimed so it falls back to its docked default below rather
    // than materializing at NaN,NaN where the user could never reach it.
    if (xPx === null || yPx === null) continue;
    const zRaw = sanitizeCoordinate(fo.z);
    claimed.add(id);
    floatingEntries.push({ id, xPx, yPx, z: zRaw ?? 0 });
  }
  // Re-densify stacking to 1..N, preserving relative order (ties broken by
  // registry order so the result is deterministic).
  floatingEntries.sort((a, b) => {
    if (a.z !== b.z) return a.z - b.z;
    return EDITOR_PANEL_IDS.indexOf(a.id) - EDITOR_PANEL_IDS.indexOf(b.id);
  });
  floatingEntries.forEach((entry, i) => {
    floating[entry.id] = { xPx: entry.xPx, yPx: entry.yPx, z: i + 1 };
  });

  const layout: EditorPanelLayout = { left, right, floating };

  // Any registered panel not claimed anywhere (new panel added since this
  // layout was saved, an unknown-id casualty, or a dropped invalid float)
  // returns to its registered default side, positioned to respect its
  // default order relative to the other default-side panels already present.
  for (const id of EDITOR_PANEL_IDS) {
    if (claimed.has(id)) continue;
    insertAtDefaultOrder(layout, id);
  }

  return layout;
}

/**
 * Inserts `id` into its registered default sidebar at the position implied by
 * its `defaultOrder` relative to the panels already there, so a newly
 * registered panel lands in a sensible spot instead of always at the bottom.
 */
function insertAtDefaultOrder(layout: EditorPanelLayout, id: EditorPanelId): void {
  const def = getEditorPanelDef(id);
  const list = def.defaultSide === 'left' ? layout.left : layout.right;
  let insertIndex = list.length;
  for (let i = 0; i < list.length; i++) {
    const other = getEditorPanelDef(list[i]);
    // Only compare against panels that natively belong to this side; a panel
    // the user dragged here from the other sidebar has no meaningful
    // default-order relationship to this one.
    if (other.defaultSide !== def.defaultSide) continue;
    if (other.defaultOrder > def.defaultOrder) { insertIndex = i; break; }
  }
  list.splice(insertIndex, 0, id);
}

/** Removes `id` from every location, mutating `layout`. */
function detach(layout: EditorPanelLayout, id: EditorPanelId): void {
  const li = layout.left.indexOf(id);
  if (li >= 0) layout.left.splice(li, 1);
  const ri = layout.right.indexOf(id);
  if (ri >= 0) layout.right.splice(ri, 1);
  delete layout.floating[id];
}

export function getPanelLocation(layout: EditorPanelLayout, id: EditorPanelId): EditorPanelLocation | null {
  const li = layout.left.indexOf(id);
  if (li >= 0) return { kind: 'docked', side: 'left', index: li };
  const ri = layout.right.indexOf(id);
  if (ri >= 0) return { kind: 'docked', side: 'right', index: ri };
  const f = layout.floating[id];
  if (f !== undefined) return { kind: 'floating', state: { ...f } };
  return null;
}

export function getSidebarPanelIds(layout: EditorPanelLayout, side: EditorSidebarSide): readonly EditorPanelId[] {
  return side === 'left' ? layout.left : layout.right;
}

/** Floating panel ids, back-to-front (ascending z). */
export function getFloatingPanelIdsByZ(layout: EditorPanelLayout): EditorPanelId[] {
  const ids = EDITOR_PANEL_IDS.filter(id => layout.floating[id] !== undefined);
  return ids.sort((a, b) => layout.floating[a]!.z - layout.floating[b]!.z);
}

function highestFloatingZ(layout: EditorPanelLayout): number {
  let max = 0;
  for (const id of EDITOR_PANEL_IDS) {
    const f = layout.floating[id];
    if (f !== undefined && f.z > max) max = f.z;
  }
  return max;
}

/**
 * Docks `id` into `side` at `index`. Covers reordering within one sidebar,
 * moving between sidebars, and redocking a floating panel.
 *
 * `index` is interpreted against the destination list **after** `id` has been
 * removed from it, and is clamped into range. This matches how the drag
 * coordinator computes a drop index: the dragged panel is lifted out of the
 * flow (replaced by a placeholder) before the insertion point is measured.
 */
export function dockPanel(
  layout: EditorPanelLayout,
  id: EditorPanelId,
  side: EditorSidebarSide,
  index: number,
): EditorPanelLayout {
  const next = clonePanelLayout(layout);
  detach(next, id);
  const list = side === 'left' ? next.left : next.right;
  const clamped = Math.max(0, Math.min(list.length, Math.floor(index)));
  list.splice(clamped, 0, id);
  return normalizeFloatingZ(next);
}

/**
 * Undocks `id` into a floating window at (`xPx`, `yPx`), placed in front of
 * every other floating panel. Coordinates are stored as given; viewport
 * clamping is the caller's job (see editorFloatingGeometry.ts) so this stays
 * independent of viewport size.
 */
export function floatPanel(
  layout: EditorPanelLayout,
  id: EditorPanelId,
  xPx: number,
  yPx: number,
): EditorPanelLayout {
  const next = clonePanelLayout(layout);
  detach(next, id);
  next.floating[id] = {
    xPx: Number.isFinite(xPx) ? xPx : 0,
    yPx: Number.isFinite(yPx) ? yPx : 0,
    z: highestFloatingZ(next) + 1,
  };
  return normalizeFloatingZ(next);
}

/** Repositions an already-floating panel. No-op if the panel isn't floating. */
export function moveFloatingPanel(
  layout: EditorPanelLayout,
  id: EditorPanelId,
  xPx: number,
  yPx: number,
): EditorPanelLayout {
  const existing = layout.floating[id];
  if (existing === undefined) return layout;
  const next = clonePanelLayout(layout);
  next.floating[id] = {
    xPx: Number.isFinite(xPx) ? xPx : existing.xPx,
    yPx: Number.isFinite(yPx) ? yPx : existing.yPx,
    z: existing.z,
  };
  return next;
}

/** Raises a floating panel above all others. No-op if it isn't floating or is already frontmost. */
export function bringFloatingPanelToFront(layout: EditorPanelLayout, id: EditorPanelId): EditorPanelLayout {
  const existing = layout.floating[id];
  if (existing === undefined) return layout;
  if (existing.z === highestFloatingZ(layout)) return layout;
  const next = clonePanelLayout(layout);
  next.floating[id] = { ...existing, z: highestFloatingZ(next) + 1 };
  return normalizeFloatingZ(next);
}

/** Re-densifies floating z to 1..N preserving relative order. */
function normalizeFloatingZ(layout: EditorPanelLayout): EditorPanelLayout {
  const ordered = getFloatingPanelIdsByZ(layout);
  ordered.forEach((id, i) => {
    layout.floating[id] = { ...layout.floating[id]!, z: i + 1 };
  });
  return layout;
}

/**
 * Verifies the "exactly one location, no duplicates, nothing unknown"
 * invariant. Used by tests and by defensive assertions; a normalized layout
 * must always satisfy it.
 */
export function isPanelLayoutComplete(layout: EditorPanelLayout): boolean {
  const seen = new Set<EditorPanelId>();
  for (const id of [...layout.left, ...layout.right]) {
    if (!isEditorPanelId(id)) return false;
    if (seen.has(id)) return false;
    seen.add(id);
  }
  for (const key of Object.keys(layout.floating)) {
    if (!isEditorPanelId(key)) return false;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return seen.size === EDITOR_PANEL_IDS.length;
}
