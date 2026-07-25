/**
 * O(1) selection membership lookup for the editor.
 *
 * Rendering used to answer "is this element selected?" with
 * `state.selectedElements.some(e => e.type === type && e.uid === uid)`, which
 * is O(selection) *per drawn element*, i.e. O(room * selection) per frame.
 * This module keeps a cached `Set<string>` of `${type}:${uid}` keys that is
 * rebuilt only when the selection actually changes.
 *
 * Invalidation is belt-and-braces:
 *  - every mutation site of `state.selectedElements` calls
 *    `bumpSelectionRevision(state)` (explicit, cheap);
 *  - the cache *additionally* validates the array identity and length, so a
 *    missed `bump` after an assignment or push/splice still self-heals.
 * Both checks are O(1), so the safety net costs nothing per frame.
 */
import type { EditorState } from './editorState';
import type { SelectedElement } from './editorElementTypes';
import { editorPerfCounters } from './editorPerfCounters';

/** Canonical selection key. Keep in sync with every consumer. */
export function selectionKey(type: string, uid: number): string {
  return `${type}:${uid}`;
}

interface SelectionCacheEntry {
  /** Identity of the array the Set was built from. */
  source: SelectedElement[];
  /** Length of that array at build time. */
  length: number;
  /** `state.selectionRevision` at build time. */
  revision: number;
  keys: Set<string>;
}

const caches = new WeakMap<object, SelectionCacheEntry>();

/** State slice this module needs — keeps tests from having to build a full EditorState. */
export type SelectionCacheState = Pick<EditorState, 'selectedElements' | 'selectionRevision'>;

/**
 * Marks the selection as changed. MUST be called by every site that assigns,
 * pushes to, splices, filters, or clears `state.selectedElements`.
 */
export function bumpSelectionRevision(state: { selectionRevision: number }): void {
  state.selectionRevision++;
}

/**
 * Returns the cached selected-key Set, rebuilding it only when the selection
 * changed. Increments `editorPerfCounters.selectionCacheRebuilds` on rebuild.
 */
export function getSelectedKeySet(state: SelectionCacheState): ReadonlySet<string> {
  const list = state.selectedElements;
  const cached = caches.get(state);
  if (cached !== undefined &&
      cached.source === list &&
      cached.length === list.length &&
      cached.revision === state.selectionRevision) {
    return cached.keys;
  }
  const keys = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    keys.add(selectionKey(list[i].type, list[i].uid));
  }
  caches.set(state, {
    source: list,
    length: list.length,
    revision: state.selectionRevision,
    keys,
  });
  editorPerfCounters.selectionCacheRebuilds++;
  return keys;
}

/**
 * Builds an O(1) `isElementSelected(type, uid)` predicate backed by the cache.
 * The returned closure captures the Set, so it stays valid for the duration of
 * a single render pass (selection cannot change mid-pass).
 */
export function makeIsElementSelected(
  state: SelectionCacheState,
): (type: string, uid: number) => boolean {
  const keys = getSelectedKeySet(state);
  return (type: string, uid: number): boolean => keys.has(selectionKey(type, uid));
}

/** Drops any cached Set for this state (used on editor teardown / tests). */
export function clearSelectionCache(state: object): void {
  caches.delete(state);
}
