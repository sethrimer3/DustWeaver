/**
 * Editor delete tool — removes the element at the cursor position.
 *
 * Extracted from editorTools.ts to keep that module focused on the select,
 * rotate, flip, multi-select, and rope-anchor hit-test operations.
 */

import { EditorState, allocateUid } from './editorState';
import { markLiquidBodiesDirty } from '../render/liquidBodyCache';
import { getBrushCells, getFillBrushCells, FillKind } from './editorBrush';
import { findTopEligibleHitCandidate, type EditorHitCandidate } from './editorTools';
import { canMutateElement, canMutateSelection, getLayerForElementType, isLayerLocked, isLayerVisible } from './editorLayers';
import { bumpSelectionRevision } from './editorSelectionCache';

interface BlockRect { xBlock: number; yBlock: number; wBlock: number; hBlock: number; }

/**
 * Splits a rectangular zone around a single removed cell, returning up to
 * four rectangles that tile the remaining area. Lets deleting one tile of a
 * multi-tile water/lava zone leave the rest of the zone intact instead of
 * removing the whole rectangle.
 */
function splitZoneAroundCell(zone: BlockRect, cellX: number, cellY: number): BlockRect[] {
  const x0 = zone.xBlock;
  const y0 = zone.yBlock;
  const x1 = zone.xBlock + zone.wBlock;
  const y1 = zone.yBlock + zone.hBlock;
  const pieces: BlockRect[] = [];
  if (cellY > y0) {
    pieces.push({ xBlock: x0, yBlock: y0, wBlock: x1 - x0, hBlock: cellY - y0 });
  }
  if (cellY + 1 < y1) {
    pieces.push({ xBlock: x0, yBlock: cellY + 1, wBlock: x1 - x0, hBlock: y1 - (cellY + 1) });
  }
  if (cellX > x0) {
    pieces.push({ xBlock: x0, yBlock: cellY, wBlock: cellX - x0, hBlock: 1 });
  }
  if (cellX + 1 < x1) {
    pieces.push({ xBlock: cellX + 1, yBlock: cellY, wBlock: x1 - (cellX + 1), hBlock: 1 });
  }
  return pieces;
}

/** Removes the first element with the given uid from arr, if present. Returns whether it was found. */
function removeByUid<T extends { uid: number }>(arr: T[] | undefined, uid: number): boolean {
  if (!arr) return false;
  const i = arr.findIndex(e => e.uid === uid);
  if (i === -1) return false;
  arr.splice(i, 1);
  return true;
}

/**
 * Deletes the element at the cursor location.
 */
export function deleteAtCursor(state: EditorState): boolean {
  return deleteAt(state, state.cursorBlockX, state.cursorBlockY);
}

/**
 * Deletes the element(s) under the cursor, respecting the active brush mode
 * (single/3x3/5x5/rect/fill) the same way `placeAtCursor` does for placement.
 * Used for right-click delete and right-drag erase so all brush tools can
 * also be used to remove elements, not just place them.
 *
 * Returns whether at least one cell in the brush actually removed something —
 * callers should skip history/dirty work entirely when this is `false`.
 */
export function deleteAtCursorBrushed(state: EditorState): boolean {
  const room = state.roomData;
  if (room === null) return false;

  if (state.brushMode === 'fill') {
    const cells = getFillBrushCells(room, state.cursorBlockX, state.cursorBlockY, 'tile' as FillKind);
    let changed = false;
    for (const cell of cells) {
      if (deleteAt(state, cell.x, cell.y)) changed = true;
    }
    return changed;
  }

  if (state.brushMode !== 'single') {
    const cells = getBrushCells(
      state.brushMode,
      state.cursorBlockX,
      state.cursorBlockY,
      state.brushRectStartBlockX,
      state.brushRectStartBlockY,
    );
    let changed = false;
    for (const cell of cells) {
      if (deleteAt(state, cell.x, cell.y)) changed = true;
    }
    return changed;
  }

  return deleteAt(state, state.cursorBlockX, state.cursorBlockY);
}

/**
 * Deletes the element at the given block coordinates.
 *
 * Resolves the target via `findTopEligibleHitCandidate` (see editorTools.ts)
 * walking the SAME deterministic priority order the Select tool uses, so
 * deletion can never target a different element than the one permission-
 * checked. Uses `canMutateElement` — not `canSelectElementType` — as the
 * mutation-eligibility check, so selection-eligibility and mutation-
 * eligibility remain architecturally distinct predicates even though they
 * happen to agree today.
 *
 * Explicit destructive click-through policy (distinct from selection, which
 * always falls through locked AND hidden elements unchanged):
 *  - A HIDDEN top candidate is treated as absent — there's nothing visible to
 *    protect, so deletion falls through to whatever is beneath it.
 *  - A VISIBLE LOCKED top candidate BLOCKS destructive click-through: nothing
 *    is deleted at all, neither the locked element itself nor anything
 *    beneath it. A locked object is meant to protect what's under it from an
 *    accidental click, and deleting through it would be surprising.
 *  - A visible, unlocked candidate excluded only by an active select-only
 *    filter is treated like selection's existing select-only behaviour
 *    (skipped, falls through to the next candidate) — select-only doesn't
 *    interact with the lock/hidden click-through policy above; this is
 *    intentionally left matching prior behaviour rather than given new,
 *    separately-defined semantics.
 */
function deleteAt(state: EditorState, bx: number, by: number): boolean {
  const room = state.roomData;
  if (room === null) return false;

  const savedCursorX = state.cursorBlockX;
  const savedCursorY = state.cursorBlockY;
  state.cursorBlockX = bx;
  state.cursorBlockY = by;
  const target = findTopEligibleHitCandidate(state, el => {
    const layerId = getLayerForElementType(el.type);
    if (!isLayerVisible(state, layerId)) return false; // hidden -> absent, fall through
    if (isLayerLocked(state, layerId)) return true; // visible+locked -> stop here; blocks below
    if (!canMutateElement(state, el)) return false; // select-only-excluded -> fall through
    return true; // eligible deletion target
  });
  state.cursorBlockX = savedCursorX;
  state.cursorBlockY = savedCursorY;

  if (target === null) return false;
  // Visible+locked candidates are returned by the predicate above so the
  // walk stops on them (rather than silently skipping past a protector), but
  // they must never actually be deleted — check again here explicitly.
  if (isLayerLocked(state, getLayerForElementType(target.element.type))) return false;

  return deleteResolvedCandidate(state, target, Math.floor(bx), Math.floor(by));
}

/**
 * Deletes exactly the element identified by `candidate` — no re-scanning by
 * position, only by type + uid (or, for guide-dust-path points, the resolved
 * point index) — so the deleted element is guaranteed to be the one that was
 * permission-checked.
 */
function deleteResolvedCandidate(
  state: EditorState,
  candidate: EditorHitCandidate,
  cellX: number,
  cellY: number,
  deleteWholeElement = false,
): boolean {
  const room = state.roomData;
  if (room === null) return false;
  const { element } = candidate;
  const uid = element.uid;
  let removed = true;

  switch (element.type) {
    case 'campaignSpawn':
      state.campaignSpawnBlock = null;
      break;
    case 'playerSpawn':
      // Singleton marker — not deletable, matches prior behaviour.
      return false;
    case 'transition':
      removed = removeByUid(room.transitions, uid);
      break;
    case 'enemy':
      removed = removeByUid(room.enemies, uid);
      break;
    case 'saveTomb':
      removed = removeByUid(room.saveTombs, uid);
      break;
    case 'skillTomb':
      removed = removeByUid(room.skillTombs, uid);
      break;
    case 'zipMoveBlock':
      removed = removeByUid(room.zipMoveBlocks, uid);
      break;
    case 'challengeField':
      removed = removeByUid(room.challengeFields, uid);
      break;
    case 'challengeGate':
      removed = removeByUid(room.challengeGates, uid);
      break;
    case 'gate':
      removed = removeByUid(room.gates, uid);
      break;
    case 'challengeTotem':
      removed = removeByUid(room.challengeTotems, uid);
      break;
    case 'dustContainer':
      removed = removeByUid(room.dustContainers, uid);
      break;
    case 'dustContainerPiece':
      removed = removeByUid(room.dustContainerPieces, uid);
      break;
    case 'dustBoostJar':
      removed = removeByUid(room.dustBoostJars, uid);
      break;
    case 'dustSwarm':
      removed = removeByUid(room.dustSwarms, uid);
      break;
    case 'lambdaAnchor':
      removed = removeByUid(room.lambdaAnchors, uid);
      break;
    case 'fireflyJar':
      removed = removeByUid(room.fireflyJars, uid);
      break;
    case 'springboard':
      removed = removeByUid(room.springboards, uid);
      break;
    case 'breakableBlock': {
      // Removing an entire shared group at once, matching prior behaviour.
      const breakableBlocks = room.breakableBlocks ?? [];
      const target = breakableBlocks.find(b => b.uid === uid);
      if (!target) return false;
      const groupId = target.groupId;
      const removedUids = new Set<number>();
      if (groupId !== undefined) {
        for (let j = breakableBlocks.length - 1; j >= 0; j--) {
          if (breakableBlocks[j].groupId === groupId) {
            removedUids.add(breakableBlocks[j].uid);
            breakableBlocks.splice(j, 1);
          }
        }
      } else {
        removedUids.add(uid);
        removeByUid(breakableBlocks, uid);
      }
      state.selectedElements = state.selectedElements.filter(e => !removedUids.has(e.uid));
      bumpSelectionRevision(state);
      return true;
    }
    case 'dustPile':
      removed = removeByUid(room.dustPiles, uid);
      break;
    case 'grasshopperArea':
      removed = removeByUid(room.grasshopperAreas, uid);
      break;
    case 'fireflyArea':
      removed = removeByUid(room.fireflyAreas, uid);
      break;
    case 'decoration':
      removed = removeByUid(room.decorations, uid);
      break;
    case 'wall':
      removed = removeByUid(room.interiorWalls, uid);
      break;
    case 'lightSource':
      removed = removeByUid(room.lightSources, uid);
      break;
    case 'sunbeam':
      removed = removeByUid(room.sunbeams, uid);
      break;
    case 'sceneLight':
      removed = removeByUid(room.sceneLights, uid);
      break;
    case 'ambientLightBlocker':
      removed = removeByUid(room.ambientLightBlockers, uid);
      break;
    case 'waterZone': {
      const zones = room.waterZones ?? [];
      const zone = zones.find(z => z.uid === uid);
      if (!zone) return false;
      removeByUid(zones, uid);
      if (!deleteWholeElement) {
        for (const piece of splitZoneAroundCell(zone, cellX, cellY)) {
          zones.push({ uid: allocateUid(state), ...piece });
        }
      }
      markLiquidBodiesDirty();
      break;
    }
    case 'poisonField': {
      const zones = room.poisonFields ?? [];
      const zone = zones.find(z => z.uid === uid);
      if (!zone) return false;
      removeByUid(zones, uid);
      break;
    }
    case 'lavaZone': {
      const zones = room.lavaZones ?? [];
      const zone = zones.find(z => z.uid === uid);
      if (!zone) return false;
      removeByUid(zones, uid);
      if (!deleteWholeElement) {
        for (const piece of splitZoneAroundCell(zone, cellX, cellY)) {
          zones.push({ uid: allocateUid(state), ...piece });
        }
      }
      markLiquidBodiesDirty();
      break;
    }
    case 'timeStopField': {
      const zones = room.timeStopFields ?? [];
      const zone = zones.find(z => z.uid === uid);
      if (!zone) return false;
      removeByUid(zones, uid);
      if (!deleteWholeElement) {
        for (const piece of splitZoneAroundCell(zone, cellX, cellY)) {
          zones.push({ uid: allocateUid(state), ...piece });
        }
      }
      break;
    }
    case 'crumbleBlock':
      removed = removeByUid(room.crumbleBlocks, uid);
      break;
    case 'fallingBlock':
      removed = removeByUid(room.fallingBlocks, uid);
      break;
    case 'backgroundBlock':
      removed = removeByUid(room.backgroundBlocks, uid);
      break;
    case 'spike':
      removed = removeByUid(room.spikes, uid);
      break;
    case 'laser':
      removed = removeByUid(room.lasers, uid);
      break;
    case 'bouncePad':
      removed = removeByUid(room.bouncePads, uid);
      break;
    case 'kineticBlock':
      removed = removeByUid(room.kineticBlocks, uid);
      break;
    case 'pixelMaterial':
      removed = removeByUid(room.pixelMaterials, uid);
      break;
    case 'rope':
      removed = removeByUid(room.ropes, uid);
      break;
    case 'grappleCarryBlock':
      removed = removeByUid(room.grappleCarryBlocks, uid);
      break;
    case 'phantasmalTile':
      removed = removeByUid(room.phantasmalTiles, uid);
      break;
    case 'dialogueTrigger':
      removed = removeByUid(room.dialogueTriggers, uid);
      break;
    case 'guideDustPath': {
      const paths = room.guideDustPaths ?? [];
      const path = paths.find(p => p.uid === uid);
      const pointIndex = candidate.guideDustPathPointIndex;
      if (!path) return false;
      if (deleteWholeElement || path.points.length <= 2) {
        removeByUid(paths, uid);
      } else {
        if (pointIndex === undefined) return false;
        path.points.splice(pointIndex, 1);
      }
      state.guideDustPathSelectedPointIndex = null;
      state.selectedElements = state.selectedElements.filter(e => e.uid !== uid);
      bumpSelectionRevision(state);
      return true;
    }
    case 'customBlock':
      removed = removeByUid(room.customBlockPlacements, uid);
      break;
    default:
      // Element types without deletion support (e.g. those not reachable via
      // hit-testing at all) fall through as a no-op.
      return false;
  }

  if (!removed) return false;
  state.selectedElements = state.selectedElements.filter(e => e.uid !== uid);
  bumpSelectionRevision(state);
  return true;
}

/**
 * Deletes every currently selected, mutable element as a whole object.
 * Returns false without changing anything when any selected layer is not
 * editable. The player spawn remains protected by the editor's established
 * non-deletable singleton policy.
 */
export function deleteSelectedElements(state: EditorState): boolean {
  if (state.roomData === null || state.selectedElements.length === 0 || !canMutateSelection(state)) {
    return false;
  }

  const selection = [...state.selectedElements];
  let changed = false;
  for (const element of selection) {
    if (element.type === 'playerSpawn') continue;
    if (deleteResolvedCandidate(state, { element, priority: 0 }, 0, 0, true)) {
      changed = true;
    }
  }
  if (changed) { state.selectedElements = []; bumpSelectionRevision(state); }
  return changed;
}
