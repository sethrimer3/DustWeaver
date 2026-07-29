/**
 * Editor tools — Select, Rotate, Flip, Multi-select, and rope-anchor hit-test logic.
 *
 * Place tool logic lives in editorPlaceTool.ts.
 * Delete tool logic lives in editorDeleteTool.ts.
 * Hit-test geometry helpers live in editorHitTest.ts.
 */

import {
  EditorState, EditorRoomData, SelectedElement, SelectedElementType, EditorTransition,
} from './editorState';
import type { TransitionDirection } from '../levels/roomDef';
import { canSelectElementType, canMutateElement, LAYER_IDS } from './editorLayers';
import { ELEMENT_ADAPTERS, ALL_ELEMENT_TYPES, type MarqueeRect } from './editorElementRegistry';
import { editorPerfCounters } from './editorPerfCounters';
export { deleteAtCursor, deleteAtCursorBrushed } from './editorDeleteTool';

// ── Select tool ──────────────────────────────────────────────────────────────

/**
 * One selectable element found under the cursor, before any layer-eligibility
 * filtering. `priority` is the element's rank in the deterministic hit-test
 * order below — LOWER numbers win when multiple candidates overlap the same
 * cell (this mirrors the "first match wins" ordering the old single-hit
 * scanner used, made explicit instead of implicit-via-loop-order). Ties never
 * occur since priority is assigned by enumeration order.
 */
export interface EditorHitCandidate {
  element: SelectedElement;
  priority: number;
  /** Set only for `guideDustPath` hits: the control-point index that matched. */
  guideDustPathPointIndex?: number;
}

/**
 * Gathers every selectable element under the cursor's block coordinates,
 * ignoring layer visibility/lock/select-only state, ordered by an explicit
 * priority (see `EditorHitCandidate`). Used by `selectAtCursor` (click/hover)
 * and by the delete tool, so both features agree on exactly the same set of
 * candidates and tie-break order — one hit-test to keep in sync, not two.
 */
/**
 * Walks every selectable element under the cursor in the same deterministic
 * priority order `getHitCandidatesAnyLayer` documents, invoking `visit` for
 * each one. `visit` returns `true` to stop the walk immediately (used by
 * `findTopEligibleHitCandidate` for an early-return, allocation-free single-
 * candidate lookup) or `false` to keep scanning (used by
 * `getHitCandidatesAnyLayer` to build the exhaustive list). Shared here so
 * the two callers can never drift out of sync on ordering.
 */
/**
 * Explicit click-priority order — LOWER index wins when candidates overlap.
 * Preserves the exact ordering the old hand-written per-type scan used.
 * Sourced from `ELEMENT_ADAPTERS` (see editorElementRegistry.ts) except for
 * `guideDustPath`, whose click hit-test needs the matched control-point index
 * (not just a boolean), so it stays specially handled inline below.
 *
 * NOTE: `kineticBlock`, `rope`, and `pixelMaterial` are deliberately absent
 * from click-priority ordering — they were never point-click-selectable
 * before this migration (ropes are grabbed via `hitTestRopeAnchor`, kinetic
 * blocks and pixel materials have no click-select path), and this migration
 * preserves that existing behavior exactly. All three DO participate in
 * marquee selection (`getAllElementsInRect`, below), which iterates every
 * registered type.
 */
export const CLICK_PRIORITY_ORDER: readonly SelectedElementType[] = [
  'transition', 'enemy', 'saveTomb', 'skillTomb', 'challengeField', 'zipMoveBlock',
  'challengeGate', 'gate', 'challengeTotem', 'dustContainer', 'dustContainerPiece',
  'dustBoostJar', 'dustSwarm', 'lambdaAnchor', 'fireflyJar', 'springboard', 'breakableBlock',
  'dustPile', 'grasshopperArea', 'fireflyArea', 'lightSource', 'sunbeam', 'sceneLight',
  'waterZone', 'lavaZone', 'timeStopField', 'crumbleBlock', 'fallingBlock', 'backgroundBlock',
  'grappleCarryBlock', 'phantasmalTile', 'dialogueTrigger', 'guideDustPath', 'bouncePad',
  'spike', 'laser', 'decoration', 'campaignSpawn', 'playerSpawn', 'customBlock', 'wall', 'ambientLightBlocker',
];

function walkHitCandidatesAnyLayer(
  state: EditorState,
  visit: (element: SelectedElement, guideDustPathPointIndex?: number) => boolean,
): void {
  const room = state.roomData;
  if (room === null) return;

  const bx = state.cursorBlockX;
  const by = state.cursorBlockY;
  let stopped = false;
  const push = (element: SelectedElement, guideDustPathPointIndex?: number) => {
    if (stopped) return;
    if (visit(element, guideDustPathPointIndex)) stopped = true;
  };

  for (const type of CLICK_PRIORITY_ORDER) {
    if (stopped) return;

    if (type === 'guideDustPath') {
      // Hit-test control points directly (1.5 block pick radius) so the
      // matched point index can be threaded through — a boolean-only
      // adapter hitTest can't carry that.
      for (const p of (room.guideDustPaths ?? [])) {
        for (let i = 0; i < p.points.length; i++) {
          const pt = p.points[i];
          const dx = bx - pt.xBlock;
          const dy = by - pt.yBlock;
          if (dx * dx + dy * dy <= 1.5 * 1.5) {
            push({ type: 'guideDustPath', uid: p.uid }, i);
            break;
          }
        }
        if (stopped) break;
      }
      continue;
    }

    const adapter = ELEMENT_ADAPTERS[type];
    for (const el of adapter.enumerate(state, room)) {
      if (adapter.hitTest(el, bx, by, room)) push({ type, uid: adapter.uid(el) });
      if (stopped) break;
    }
  }
}

/**
 * Gathers every selectable element under the cursor's block coordinates,
 * ignoring layer visibility/lock/select-only state, ordered by an explicit
 * priority (see `EditorHitCandidate`). Used by `selectAtCursor` (click/hover)
 * and by the delete tool, so both features agree on exactly the same set of
 * candidates and tie-break order — one hit-test to keep in sync, not two.
 *
 * This exhaustively enumerates every candidate and allocates a
 * `EditorHitCandidate` for each — appropriate when genuine overlap
 * enumeration is needed (e.g. rect-select). Callers that only want the
 * single best eligible candidate (hover, click-select, single-point delete)
 * should use `findTopEligibleHitCandidate` instead, which returns as soon as
 * it finds an eligible match without allocating an array or scanning the
 * remainder of the candidate list.
 */
export function getHitCandidatesAnyLayer(state: EditorState): EditorHitCandidate[] {
  const candidates: EditorHitCandidate[] = [];
  let priority = 0;
  walkHitCandidatesAnyLayer(state, (element, guideDustPathPointIndex) => {
    candidates.push({ element, priority: priority++, guideDustPathPointIndex });
    return false; // never stop — exhaustive by design
  });
  return candidates;
}

/**
 * Early-return, allocation-light lookup of the single top-priority candidate
 * under the cursor that satisfies `predicate` (e.g. `canSelectElementType` or
 * a delete-specific eligibility check). Walks candidates in the exact same
 * priority order as `getHitCandidatesAnyLayer`/`walkHitCandidatesAnyLayer`,
 * but stops at the first eligible match instead of scanning every
 * collection and building a full array — used by hover, click-select, and
 * single-point deletion, all of which only ever need "what's the first
 * eligible thing here".
 */
export function findTopEligibleHitCandidate(
  state: EditorState,
  predicate: (element: SelectedElement) => boolean,
): EditorHitCandidate | null {
  let found: EditorHitCandidate | null = null;
  let priority = 0;
  walkHitCandidatesAnyLayer(state, (element, guideDustPathPointIndex) => {
    const p = priority++;
    if (predicate(element)) {
      found = { element, priority: p, guideDustPathPointIndex };
      return true; // stop — first eligible match wins
    }
    return false;
  });
  return found;
}

/**
 * Attempts to select an element at the given block coordinates, ignoring
 * layer visibility/lock/select-only state. Returns the top-priority (first
 * enumerated) candidate — kept only as a thin convenience wrapper around
 * `getHitCandidatesAnyLayer` for callers that just want "what's on top".
 */
export function selectAtCursorAnyLayer(state: EditorState): SelectedElement | null {
  const top = findTopEligibleHitCandidate(state, () => true);
  if (top === null) return null;
  if (top.element.type === 'guideDustPath' && top.guideDustPathPointIndex !== undefined) {
    state.guideDustPathSelectedPointIndex = top.guideDustPathPointIndex;
  }
  return top.element;
}

/**
 * Attempts to select an element at the cursor's block coordinates, respecting
 * layer visibility/lock/select-only state — the version used by the Select
 * tool's click handling and hover preview (both call this exact function, so
 * hover and click always agree on the resolved candidate).
 *
 * Unlike the old behaviour, an ineligible top-of-stack element no longer
 * rejects the whole hit: eligible candidates further down the stack are still
 * considered.
 */
export function selectAtCursor(state: EditorState): SelectedElement | null {
  const top = findTopEligibleHitCandidate(state, el => canSelectElementType(state, el.type));
  if (top === null) return null;
  if (top.element.type === 'guideDustPath' && top.guideDustPathPointIndex !== undefined) {
    state.guideDustPathSelectedPointIndex = top.guideDustPathPointIndex;
  }
  return top.element;
}

let _hoverCache: {
  room: EditorRoomData | null;
  cursorBlockX: number;
  cursorBlockY: number;
  mutationSerial: number;
  layerSig: string;
  result: SelectedElement | null;
  guideDustPathPointIndex?: number;
} | null = null;

export function resetHoverResolutionCache(): void {
  _hoverCache = null;
}

function _layerSelectabilitySignature(state: EditorState): string {
  let s = '';
  for (const id of LAYER_IDS) {
    const l = state.layers[id];
    if (l) {
      const bits = (l.visible ? 8 : 0) | (l.locked ? 4 : 0) | (l.solo ? 2 : 0) | (l.selectOnly ? 1 : 0);
      s += bits.toString(16);
    } else {
      s += '0';
    }
  }
  return s;
}

/**
 * Resolves hover element at cursor with change-gating to avoid repeating the
 * full multi-collection hit test every idle frame when coordinates and state have
 * not mutated.
 */
export function resolveHoverAtCursor(state: EditorState, mutationSerial = -1): SelectedElement | null {
  const room = state.roomData;
  const layerSig = _layerSelectabilitySignature(state);

  if (
    _hoverCache !== null &&
    _hoverCache.room === room &&
    _hoverCache.cursorBlockX === state.cursorBlockX &&
    _hoverCache.cursorBlockY === state.cursorBlockY &&
    _hoverCache.mutationSerial === mutationSerial &&
    mutationSerial >= 0 &&
    _hoverCache.layerSig === layerSig
  ) {
    if (_hoverCache.guideDustPathPointIndex !== undefined) {
      state.guideDustPathSelectedPointIndex = _hoverCache.guideDustPathPointIndex;
    }
    return _hoverCache.result;
  }

  editorPerfCounters.hoverScans++;
  const result = selectAtCursor(state);
  _hoverCache = {
    room,
    cursorBlockX: state.cursorBlockX,
    cursorBlockY: state.cursorBlockY,
    mutationSerial,
    layerSig,
    result,
    guideDustPathPointIndex: result?.type === 'guideDustPath' ? (state.guideDustPathSelectedPointIndex ?? undefined) : undefined,
  };
  return result;
}

// ── Rotate selected element ──────────────────────────────────────────────────

/**
 * Rotates the currently selected element by 90° clockwise.
 * - Walls: swap width and height.
 * - Transitions: cycle direction right → down → left → up → right and
 *   reposition to the nearest matching room edge.
 */
export function rotateSelectedElement(state: EditorState): boolean {
  const sel = state.selectedElements[0] ?? null;
  if (sel === null || state.roomData === null) return false;
  // Defend this mutation directly — don't rely solely on the layer-toggle
  // callback having cancelled/pruned the selection after the fact.
  if (!canMutateElement(state, sel)) return false;
  if (sel.type === 'wall') {
    const wall = state.roomData.interiorWalls.find(w => w.uid === sel.uid);
    if (!wall) return false;
    let changed = false;
    // Stairs/ramp/smooth-ramp shapes carry an explicit orientation (0-3) —
    // cycle it first so e.g. a square 1x1 stairs block (where wBlock === hBlock
    // and the dimension swap below is a no-op) still visibly rotates.
    if (wall.stairsOrientation !== undefined) {
      wall.stairsOrientation = ((wall.stairsOrientation + 1) % 4) as 0 | 1 | 2 | 3;
      changed = true;
    } else if (wall.rampOrientation !== undefined) {
      wall.rampOrientation = ((wall.rampOrientation + 1) % 4) as 0 | 1 | 2 | 3;
      changed = true;
    } else if (wall.smoothRampOrientation !== undefined) {
      wall.smoothRampOrientation = ((wall.smoothRampOrientation + 1) % 4) as 0 | 1 | 2 | 3;
      changed = true;
    }
    // A square wall's dimensions are unchanged by a width/height swap — this
    // is a genuine no-op, not just "rotation isn't visually distinguishable".
    if (wall.wBlock !== wall.hBlock) {
      const tmp = wall.wBlock;
      wall.wBlock = wall.hBlock;
      wall.hBlock = tmp;
      changed = true;
    }
    return changed;
  } else if (sel.type === 'crumbleBlock') {
    const block = (state.roomData.crumbleBlocks ?? []).find(b => b.uid === sel.uid);
    if (!block) return false;
    let changed = false;
    // Mirrors the 'wall' branch above so a crumble block (including crumble
    // stairs) rotates through the exact same orientations as its non-crumble
    // counterpart.
    if (block.spikeDirection !== undefined) {
      // Cycles in the same up→right→down→left order as the spike's
      // 'direction' <select> options in editorInspector.ts.
      const SPIKE_DIRS = ['up', 'right', 'down', 'left'] as const;
      const idx = SPIKE_DIRS.indexOf(block.spikeDirection);
      block.spikeDirection = SPIKE_DIRS[(idx + 1) % 4];
      changed = true;
    } else if (block.stairsOrientation !== undefined) {
      block.stairsOrientation = ((block.stairsOrientation + 1) % 4) as 0 | 1 | 2 | 3;
      changed = true;
    } else if (block.rampOrientation !== undefined) {
      block.rampOrientation = ((block.rampOrientation + 1) % 4) as 0 | 1 | 2 | 3;
      changed = true;
    } else if (block.smoothRampOrientation !== undefined) {
      block.smoothRampOrientation = ((block.smoothRampOrientation + 1) % 4) as 0 | 1 | 2 | 3;
      changed = true;
    }
    if (block.spikeDirection === undefined && block.wBlock !== block.hBlock) {
      const tmp = block.wBlock;
      block.wBlock = block.hBlock;
      block.hBlock = tmp;
      changed = true;
    }
    return changed;
  } else if (sel.type === 'transition') {
    const t = state.roomData.transitions.find(tr => tr.uid === sel.uid);
    if (!t) return false;
    const DIRS: TransitionDirection[] = ['right', 'down', 'left', 'up'];
    const idx = DIRS.indexOf(t.direction);
    const newDir = DIRS[(idx + 1) % 4];
    _repositionTransitionForNewDirection(t, newDir, state.roomData);
    return true;
  } else if (sel.type === 'enemy') {
    const enemy = state.roomData.enemies.find(e => e.uid === sel.uid);
    if (enemy?.isMomentumTurretFlag === 1) {
      enemy.momentumTurretFacingIndex = (((enemy.momentumTurretFacingIndex ?? 0) + 1) % 4) as 0 | 1 | 2 | 3;
      return true;
    } else if (enemy?.isSlimeSnailFlag === 1) {
      enemy.slimeSnailSurfaceSideIndex = (((enemy.slimeSnailSurfaceSideIndex ?? 0) + 1) % 4) as 0 | 1 | 2 | 3;
      return true;
    }
    return false;
  }
  // Unsupported element type: no-op.
  return false;
}

/**
 * Flips the selected room transition's facing direction horizontally
 * (swaps left ↔ right) or vertically (swaps up ↔ down) depending on the
 * transition's current direction.
 *
 * - Facing left or right: swaps the direction to the opposite horizontal side
 *   and repositions against the opposite wall.
 * - Facing up or down: swaps the direction to the opposite vertical side
 *   and repositions against the opposite wall.
 *
 * No-op for walls and other element types.
 */
export function flipSelectedTransition(state: EditorState): boolean {
  const sel = state.selectedElements[0] ?? null;
  if (sel === null || sel.type !== 'transition' || state.roomData === null) return false;
  // Defend this mutation directly — don't rely solely on the layer-toggle
  // callback having cancelled/pruned the selection after the fact.
  if (!canMutateElement(state, sel)) return false;
  const t = state.roomData.transitions.find(tr => tr.uid === sel.uid);
  if (!t) return false;
  let newDir: TransitionDirection;
  switch (t.direction) {
    case 'left':  newDir = 'right'; break;
    case 'right': newDir = 'left';  break;
    case 'up':    newDir = 'down';  break;
    case 'down':  newDir = 'up';    break;
  }
  _repositionTransitionForNewDirection(t, newDir, state.roomData);
  return true;
}

// ── Transition direction helpers ─────────────────────────────────────────────

/** Cycles a transition's direction to `newDir` and snaps it to the nearest edge. */
function _repositionTransitionForNewDirection(
  t: EditorTransition,
  newDir: TransitionDirection,
  room: EditorRoomData,
): void {
  const gw = t.gradientWidthBlocks ?? 3;
  const isOldHoriz = t.direction === 'left' || t.direction === 'right';
  const isNewHoriz = newDir === 'left' || newDir === 'right';

  // Preserve the opening centre along the current wall axis so the transition
  // stays roughly aligned after a 90° rotation.
  const openingCenter = isOldHoriz
    ? t.yBlock + t.openingSizeBlocks / 2
    : t.xBlock + t.openingSizeBlocks / 2;

  t.direction = newDir;

  // Clamp opening size to fit in the new direction.
  const maxOpening = isNewHoriz
    ? Math.max(1, room.heightBlocks - 2)
    : Math.max(1, room.widthBlocks - 2);
  t.openingSizeBlocks = Math.min(t.openingSizeBlocks, maxOpening);

  const halfOpening = t.openingSizeBlocks / 2;

  switch (newDir) {
    case 'right':
      t.xBlock = gw > 0 ? room.widthBlocks - gw : room.widthBlocks;
      t.yBlock = Math.round(
        Math.max(1, Math.min(openingCenter - halfOpening, room.heightBlocks - t.openingSizeBlocks - 1)),
      );
      break;
    case 'left':
      t.xBlock = 0;
      t.yBlock = Math.round(
        Math.max(1, Math.min(openingCenter - halfOpening, room.heightBlocks - t.openingSizeBlocks - 1)),
      );
      break;
    case 'down':
      t.xBlock = Math.round(
        Math.max(1, Math.min(openingCenter - halfOpening, room.widthBlocks - t.openingSizeBlocks - 1)),
      );
      t.yBlock = gw > 0 ? room.heightBlocks - gw : room.heightBlocks;
      break;
    case 'up':
      t.xBlock = Math.round(
        Math.max(1, Math.min(openingCenter - halfOpening, room.widthBlocks - t.openingSizeBlocks - 1)),
      );
      t.yBlock = 0;
      break;
  }

  // Keep legacy positionBlock in sync.
  t.positionBlock = isNewHoriz ? t.yBlock : t.xBlock;
}

// ── Multi-selection helpers ──────────────────────────────────────────────────

/**
 * Returns all elements whose block-space bounding box overlaps the given
 * rect. Driven entirely by `ELEMENT_ADAPTERS` (see editorElementRegistry.ts)
 * — every registered `SelectedElementType` is checked, which is what closes
 * the marquee-selection parity gap the old hand-written per-type list had
 * (it was missing challengeField/challengeGate/gate/challengeTotem/
 * zipMoveBlock/dialogueTrigger/guideDustPath/customBlock/sceneLight/rope/
 * kineticBlock/campaignSpawn entirely).
 */
export function getAllElementsInRect(
  state: EditorState,
  room: EditorRoomData,
  x1: number, y1: number,
  x2: number, y2: number,
): SelectedElement[] {
  const rect: MarqueeRect = {
    minX: Math.min(x1, x2),
    maxX: Math.max(x1, x2),
    minY: Math.min(y1, y2),
    maxY: Math.max(y1, y2),
  };
  const results: SelectedElement[] = [];
  for (const type of ALL_ELEMENT_TYPES) {
    const adapter = ELEMENT_ADAPTERS[type];
    for (const el of adapter.enumerate(state, room)) {
      if (adapter.marqueeTest(el, rect, room)) {
        results.push({ type, uid: adapter.uid(el) });
      }
    }
  }
  return results.filter(el => canSelectElementType(state, el.type));
}

/**
 * Returns the uid and anchor side of the first rope in room.ropes whose
 * anchor points are within `toleranceBlocks` of (bx, by), or null if none.
 */
export function hitTestRopeAnchor(
  room: EditorRoomData,
  bx: number,
  by: number,
  toleranceBlocks = 0.8,
): { uid: number; anchorSide: 'A' | 'B' } | null {
  const ropes = room.ropes ?? [];
  for (const rope of ropes) {
    const dax = rope.anchorAXBlock - bx;
    const day = rope.anchorAYBlock - by;
    if (Math.sqrt(dax * dax + day * day) <= toleranceBlocks) {
      return { uid: rope.uid, anchorSide: 'A' };
    }
    const dbx = rope.anchorBXBlock - bx;
    const dby = rope.anchorBYBlock - by;
    if (Math.sqrt(dbx * dbx + dby * dby) <= toleranceBlocks) {
      return { uid: rope.uid, anchorSide: 'B' };
    }
  }
  return null;
}
