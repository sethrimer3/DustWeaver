/**
 * Gesture-local drag target cache (Item D).
 *
 * `moveSelectedElements()` resolves every selected element by scanning its
 * room collection with `Array.prototype.find(uid)` — per element, per frame.
 * For a 500-element selection in a dense room that is hundreds of thousands
 * of comparisons per drag frame.
 *
 * This module resolves each selected element to a direct mutable reference
 * ONCE, at drag start:
 *   - the selection is grouped by element type;
 *   - each involved type's collection is walked exactly once to build a
 *     uid -> element index (so the build is O(collection + selection), not
 *     O(collection * selection));
 *   - the resulting entry carries everything the per-frame update needs
 *     (movement kind, original position, clamping dimensions, guide-path
 *     control-point refs), so the per-frame pass performs no lookups at all.
 *
 * Collections come from `ELEMENT_ADAPTERS` (editorElementRegistry.ts) rather
 * than a second hand-written per-type switch; only the *movement semantics*
 * (which the registry deliberately does not model) live here, collapsed into
 * five kinds instead of a ~35-arm type switch.
 *
 * Movement semantics are a faithful port of `moveSelectedElements()`:
 *  - the same set of draggable types (types with no arm there stay immovable);
 *  - `canMutateElement()` is re-checked per entry per frame, so a layer that
 *    becomes locked/hidden/solo-excluded mid-drag stops moving immediately;
 *  - zip blocks / challenge rects / gates / totems clamp to the room;
 *  - transitions clamp using their zone extent and keep `positionBlock` in
 *    sync;
 *  - guide dust paths move every control point;
 *  - the player spawn writes through to `roomData.playerSpawnBlock`.
 */

import type { EditorState } from './editorState';
import type { EditorRoomData, SelectedElement, SelectedElementType } from './editorElementTypes';
import { canMutateElement } from './editorLayers';
import { ELEMENT_ADAPTERS } from './editorElementRegistry';
import { editorPerfCounters } from './editorPerfCounters';

/**
 * How an element responds to a drag delta. Resolved once at drag start so the
 * per-frame loop switches on five cases instead of every element type.
 */
export type DragMoveKind =
  /** Free move: xBlock/yBlock = original + delta. */
  | 'plain'
  /** Clamped to the room using the element's own wBlock/hBlock. */
  | 'clampedRect'
  /** Clamped using the transition's zone extent; syncs positionBlock. */
  | 'transition'
  /** Writes through to roomData.playerSpawnBlock. */
  | 'playerSpawn'
  /** Moves every control point of a guide dust path. */
  | 'guidePath';

/**
 * Movement behavior per element type. Types absent from this map are not
 * draggable — exactly the set that `moveSelectedElements()` has no arm for
 * (campaign spawn, ambient light blockers, kinetic/grapple-carry/phantasmal
 * blocks, pixel materials, ropes, scene lights, dialogue triggers,
 * background blocks, custom blocks).
 */
export const DRAG_MOVE_KINDS: Partial<Record<SelectedElementType, DragMoveKind>> = {
  wall: 'plain',
  enemy: 'plain',
  saveTomb: 'plain',
  skillTomb: 'plain',
  dustContainer: 'plain',
  dustContainerPiece: 'plain',
  dustBoostJar: 'plain',
  dustSwarm: 'plain',
  lambdaAnchor: 'plain',
  fireflyJar: 'plain',
  springboard: 'plain',
  breakableBlock: 'plain',
  dustPile: 'plain',
  decoration: 'plain',
  lightSource: 'plain',
  sunbeam: 'plain',
  waterZone: 'plain',
  lavaZone: 'plain',
  timeStopField: 'plain',
  crumbleBlock: 'plain',
  bouncePad: 'plain',
  spike: 'plain',
  laser: 'plain',
  fallingBlock: 'plain',
  grasshopperArea: 'plain',
  fireflyArea: 'plain',
  zipMoveBlock: 'clampedRect',
  challengeField: 'clampedRect',
  challengeGate: 'clampedRect',
  challengeTotem: 'clampedRect',
  gate: 'clampedRect',
  transition: 'transition',
  playerSpawn: 'playerSpawn',
  guideDustPath: 'guidePath',
};

/** A mutable element with block coordinates — the shape every arm writes to. */
interface MovableElement {
  xBlock: number;
  yBlock: number;
  [key: string]: unknown;
}

interface GuidePointTarget {
  ref: { xBlock: number; yBlock: number };
  origX: number;
  origY: number;
}

/** One resolved drag target: a direct reference plus everything to move it. */
export interface DragTargetEntry {
  readonly element: SelectedElement;
  readonly kind: DragMoveKind;
  /** Direct mutable reference. `null` only for the player spawn. */
  readonly ref: MovableElement | null;
  readonly origX: number;
  readonly origY: number;
  /** Clamping extent — `clampedRect` (wBlock/hBlock) and `transition` (zone). */
  readonly clampW: number;
  readonly clampH: number;
  /** Transition only: horizontal transitions sync positionBlock from y. */
  readonly transitionIsHoriz: boolean;
  /** Guide dust path only: one entry per control point. */
  readonly points: GuidePointTarget[] | null;
}

const NO_DELTA = Number.NaN;

export interface DragTargetCache {
  entries: DragTargetEntry[];
  /** Room the cache was resolved against — a room change invalidates it. */
  room: EditorRoomData | null;
  /** Snapped delta applied on the previous frame; NaN = nothing applied yet. */
  lastAppliedDeltaX: number;
  lastAppliedDeltaY: number;
}

export function createDragTargetCache(): DragTargetCache {
  return { entries: [], room: null, lastAppliedDeltaX: NO_DELTA, lastAppliedDeltaY: NO_DELTA };
}

/**
 * Clears the cache and the delta sentinel. Call on drag release, rollback,
 * layer-permission cancellation, room change, editor close, and any other
 * exceptional cancellation — a stale cache holds references into a room that
 * may no longer be live.
 */
export function resetDragTargetCache(cache: DragTargetCache): void {
  cache.entries.length = 0;
  cache.room = null;
  cache.lastAppliedDeltaX = NO_DELTA;
  cache.lastAppliedDeltaY = NO_DELTA;
}

function numberProp(element: MovableElement, key: string, fallback: number): number {
  const value = element[key];
  return typeof value === 'number' ? value : fallback;
}

/**
 * Resolves every selected element to a direct reference. One pass over each
 * involved collection, regardless of how many elements of that type are
 * selected.
 */
export function buildDragTargetCache(state: EditorState, cache: DragTargetCache): void {
  resetDragTargetCache(cache);
  const room = state.roomData;
  if (room === null) return;
  cache.room = room;

  // Group the selection by type so each collection is walked at most once.
  const uidsByType = new Map<SelectedElementType, SelectedElement[]>();
  for (const el of state.selectedElements) {
    const kind = DRAG_MOVE_KINDS[el.type];
    if (kind === undefined) continue;          // not a draggable type
    if (kind === 'playerSpawn') {
      cache.entries.push({
        element: el,
        kind: 'playerSpawn',
        ref: null,
        origX: room.playerSpawnBlock[0],
        origY: room.playerSpawnBlock[1],
        clampW: 0, clampH: 0, transitionIsHoriz: false, points: null,
      });
      continue;
    }
    const bucket = uidsByType.get(el.type);
    if (bucket === undefined) uidsByType.set(el.type, [el]);
    else bucket.push(el);
  }

  for (const [type, selected] of uidsByType) {
    const adapter = ELEMENT_ADAPTERS[type];
    const collection = adapter.enumerate(state, room) as readonly MovableElement[];
    // Single pass over the collection -> uid index, then O(1) per selection.
    const byUid = new Map<number, MovableElement>();
    for (let i = 0; i < collection.length; i++) {
      byUid.set(adapter.uid(collection[i]), collection[i]);
    }
    const kind = DRAG_MOVE_KINDS[type] as DragMoveKind;
    for (const el of selected) {
      const ref = byUid.get(el.uid);
      if (ref === undefined) continue;         // selection referenced a deleted element
      if (kind === 'guidePath') {
        const rawPoints = ref['points'];
        if (!Array.isArray(rawPoints)) continue;
        const points: GuidePointTarget[] = [];
        for (const point of rawPoints as { xBlock: number; yBlock: number }[]) {
          points.push({ ref: point, origX: point.xBlock, origY: point.yBlock });
        }
        cache.entries.push({
          element: el, kind, ref,
          // A path has no origin of its own — only its control points move.
          origX: 0, origY: 0,
          clampW: 0, clampH: 0, transitionIsHoriz: false, points,
        });
        continue;
      }
      if (kind === 'transition') {
        const direction = ref['direction'];
        const isHoriz = direction === 'left' || direction === 'right';
        const gradientWidth = numberProp(ref, 'gradientWidthBlocks', 3);
        const openingSize = numberProp(ref, 'openingSizeBlocks', 1);
        cache.entries.push({
          element: el, kind, ref,
          origX: ref.xBlock, origY: ref.yBlock,
          clampW: isHoriz ? gradientWidth : openingSize,
          clampH: isHoriz ? openingSize : gradientWidth,
          transitionIsHoriz: isHoriz,
          points: null,
        });
        continue;
      }
      cache.entries.push({
        element: el, kind, ref,
        origX: ref.xBlock, origY: ref.yBlock,
        clampW: kind === 'clampedRect' ? numberProp(ref, 'wBlock', 1) : 0,
        clampH: kind === 'clampedRect' ? numberProp(ref, 'hBlock', 1) : 0,
        transitionIsHoriz: false,
        points: null,
      });
    }
  }
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

/**
 * Applies a snapped block delta to every cached target. Returns true when the
 * frame actually mutated elements.
 *
 * When the delta is unchanged from the previous applied frame this returns
 * immediately without touching a single element (`dragDeltaNoops`), which is
 * the common case: the pointer moves many pixels per block.
 */
export function applyDragDelta(
  state: EditorState,
  cache: DragTargetCache,
  deltaX: number,
  deltaY: number,
): boolean {
  const room = state.roomData;
  if (room === null || cache.room !== room) return false;
  if (deltaX === cache.lastAppliedDeltaX && deltaY === cache.lastAppliedDeltaY) {
    editorPerfCounters.dragDeltaNoops++;
    return false;
  }
  cache.lastAppliedDeltaX = deltaX;
  cache.lastAppliedDeltaY = deltaY;
  editorPerfCounters.dragDeltaApplied++;

  const entries = cache.entries;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    // Re-checked every frame: a layer locked/hidden mid-drag must freeze its
    // elements immediately (mutation-boundary guard, same as
    // moveSelectedElements()).
    if (!canMutateElement(state, entry.element)) continue;

    switch (entry.kind) {
      case 'plain': {
        const ref = entry.ref!;
        ref.xBlock = entry.origX + deltaX;
        ref.yBlock = entry.origY + deltaY;
        break;
      }
      case 'clampedRect': {
        const ref = entry.ref!;
        ref.xBlock = clamp(entry.origX + deltaX, room.widthBlocks - entry.clampW);
        ref.yBlock = clamp(entry.origY + deltaY, room.heightBlocks - entry.clampH);
        break;
      }
      case 'transition': {
        const ref = entry.ref!;
        const newX = clamp(entry.origX + deltaX, room.widthBlocks - entry.clampW);
        const newY = clamp(entry.origY + deltaY, room.heightBlocks - entry.clampH);
        ref.xBlock = newX;
        ref.yBlock = newY;
        ref['positionBlock'] = entry.transitionIsHoriz ? newY : newX;
        break;
      }
      case 'playerSpawn': {
        room.playerSpawnBlock[0] = entry.origX + deltaX;
        room.playerSpawnBlock[1] = entry.origY + deltaY;
        break;
      }
      case 'guidePath': {
        const points = entry.points;
        if (points === null) break;
        for (let p = 0; p < points.length; p++) {
          points[p].ref.xBlock = points[p].origX + deltaX;
          points[p].ref.yBlock = points[p].origY + deltaY;
        }
        break;
      }
    }
  }
  return true;
}
