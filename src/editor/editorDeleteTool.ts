/**
 * Editor delete tool — removes the element at the cursor position.
 *
 * Extracted from editorTools.ts to keep that module focused on the select,
 * rotate, flip, multi-select, and rope-anchor hit-test operations.
 */

import { EditorState, allocateUid } from './editorState';
import { markLiquidBodiesDirty } from '../render/liquidBodyCache';
import { getBrushCells, getFillBrushCells, FillKind } from './editorBrush';
import { getHitCandidatesAnyLayer, type EditorHitCandidate } from './editorTools';
import { canSelectElementType } from './editorLayers';

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
export function deleteAtCursor(state: EditorState): void {
  deleteAt(state, state.cursorBlockX, state.cursorBlockY);
}

/**
 * Deletes the element(s) under the cursor, respecting the active brush mode
 * (single/3x3/5x5/rect/fill) the same way `placeAtCursor` does for placement.
 * Used for right-click delete and right-drag erase so all brush tools can
 * also be used to remove elements, not just place them.
 */
export function deleteAtCursorBrushed(state: EditorState): void {
  const room = state.roomData;
  if (room === null) return;

  if (state.brushMode === 'fill') {
    const cells = getFillBrushCells(room, state.cursorBlockX, state.cursorBlockY, 'tile' as FillKind);
    for (const cell of cells) {
      deleteAt(state, cell.x, cell.y);
    }
    return;
  }

  if (state.brushMode !== 'single') {
    const cells = getBrushCells(
      state.brushMode,
      state.cursorBlockX,
      state.cursorBlockY,
      state.brushRectStartBlockX,
      state.brushRectStartBlockY,
    );
    for (const cell of cells) {
      deleteAt(state, cell.x, cell.y);
    }
    return;
  }

  deleteAt(state, state.cursorBlockX, state.cursorBlockY);
}

/**
 * Deletes the element at the given block coordinates.
 *
 * Resolves candidates via the SAME `getHitCandidatesAnyLayer` function the
 * Select tool uses (see editorTools.ts), applies the delete policy (locked,
 * hidden, or select-only-excluded layers are never deletable — identical to
 * the select-eligibility policy today), takes exactly the single top-eligible
 * candidate, and deletes exactly that element. There is no second, separately
 * ordered hit-test or priority chain — this guarantees deletion can never
 * target a different element than the one permission-checked, and can never
 * reach "through" a locked/hidden element to something else.
 */
function deleteAt(state: EditorState, bx: number, by: number): void {
  const room = state.roomData;
  if (room === null) return;

  const savedCursorX = state.cursorBlockX;
  const savedCursorY = state.cursorBlockY;
  state.cursorBlockX = bx;
  state.cursorBlockY = by;
  const candidates = getHitCandidatesAnyLayer(state)
    .filter(c => canSelectElementType(state, c.element.type));
  state.cursorBlockX = savedCursorX;
  state.cursorBlockY = savedCursorY;

  if (candidates.length === 0) return;
  let target = candidates[0];
  for (const c of candidates) if (c.priority < target.priority) target = c;

  deleteResolvedCandidate(state, target, Math.floor(bx), Math.floor(by));
}

/**
 * Deletes exactly the element identified by `candidate` — no re-scanning by
 * position, only by type + uid (or, for guide-dust-path points, the resolved
 * point index) — so the deleted element is guaranteed to be the one that was
 * permission-checked.
 */
function deleteResolvedCandidate(state: EditorState, candidate: EditorHitCandidate, cellX: number, cellY: number): void {
  const room = state.roomData;
  if (room === null) return;
  const { element } = candidate;
  const uid = element.uid;

  switch (element.type) {
    case 'campaignSpawn':
      state.campaignSpawnBlock = null;
      break;
    case 'playerSpawn':
      // Singleton marker — not deletable, matches prior behaviour.
      return;
    case 'transition':
      removeByUid(room.transitions, uid);
      break;
    case 'enemy':
      removeByUid(room.enemies, uid);
      break;
    case 'saveTomb':
      removeByUid(room.saveTombs, uid);
      break;
    case 'skillTomb':
      removeByUid(room.skillTombs, uid);
      break;
    case 'zipMoveBlock':
      removeByUid(room.zipMoveBlocks, uid);
      break;
    case 'challengeField':
      removeByUid(room.challengeFields, uid);
      break;
    case 'challengeGate':
      removeByUid(room.challengeGates, uid);
      break;
    case 'gate':
      removeByUid(room.gates, uid);
      break;
    case 'challengeTotem':
      removeByUid(room.challengeTotems, uid);
      break;
    case 'dustContainer':
      removeByUid(room.dustContainers, uid);
      break;
    case 'dustContainerPiece':
      removeByUid(room.dustContainerPieces, uid);
      break;
    case 'dustBoostJar':
      removeByUid(room.dustBoostJars, uid);
      break;
    case 'dustSwarm':
      removeByUid(room.dustSwarms, uid);
      break;
    case 'lambdaAnchor':
      removeByUid(room.lambdaAnchors, uid);
      break;
    case 'fireflyJar':
      removeByUid(room.fireflyJars, uid);
      break;
    case 'springboard':
      removeByUid(room.springboards, uid);
      break;
    case 'breakableBlock': {
      // Removing an entire shared group at once, matching prior behaviour.
      const breakableBlocks = room.breakableBlocks ?? [];
      const target = breakableBlocks.find(b => b.uid === uid);
      if (!target) break;
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
      return;
    }
    case 'dustPile':
      removeByUid(room.dustPiles, uid);
      break;
    case 'grasshopperArea':
      removeByUid(room.grasshopperAreas, uid);
      break;
    case 'fireflyArea':
      removeByUid(room.fireflyAreas, uid);
      break;
    case 'decoration':
      removeByUid(room.decorations, uid);
      break;
    case 'wall':
      removeByUid(room.interiorWalls, uid);
      break;
    case 'lightSource':
      removeByUid(room.lightSources, uid);
      break;
    case 'sunbeam':
      removeByUid(room.sunbeams, uid);
      break;
    case 'sceneLight':
      removeByUid(room.sceneLights, uid);
      break;
    case 'ambientLightBlocker':
      removeByUid(room.ambientLightBlockers, uid);
      break;
    case 'waterZone': {
      const zones = room.waterZones ?? [];
      const zone = zones.find(z => z.uid === uid);
      if (!zone) break;
      removeByUid(zones, uid);
      for (const piece of splitZoneAroundCell(zone, cellX, cellY)) {
        zones.push({ uid: allocateUid(state), ...piece });
      }
      markLiquidBodiesDirty();
      break;
    }
    case 'lavaZone': {
      const zones = room.lavaZones ?? [];
      const zone = zones.find(z => z.uid === uid);
      if (!zone) break;
      removeByUid(zones, uid);
      for (const piece of splitZoneAroundCell(zone, cellX, cellY)) {
        zones.push({ uid: allocateUid(state), ...piece });
      }
      markLiquidBodiesDirty();
      break;
    }
    case 'timeStopField': {
      const zones = room.timeStopFields ?? [];
      const zone = zones.find(z => z.uid === uid);
      if (!zone) break;
      removeByUid(zones, uid);
      for (const piece of splitZoneAroundCell(zone, cellX, cellY)) {
        zones.push({ uid: allocateUid(state), ...piece });
      }
      break;
    }
    case 'crumbleBlock':
      removeByUid(room.crumbleBlocks, uid);
      break;
    case 'fallingBlock':
      removeByUid(room.fallingBlocks, uid);
      break;
    case 'backgroundBlock':
      removeByUid(room.backgroundBlocks, uid);
      break;
    case 'spike':
      removeByUid(room.spikes, uid);
      break;
    case 'bouncePad':
      removeByUid(room.bouncePads, uid);
      break;
    case 'kineticBlock':
      removeByUid(room.kineticBlocks, uid);
      break;
    case 'grappleCarryBlock':
      removeByUid(room.grappleCarryBlocks, uid);
      break;
    case 'phantasmalTile':
      removeByUid(room.phantasmalTiles, uid);
      break;
    case 'dialogueTrigger':
      removeByUid(room.dialogueTriggers, uid);
      break;
    case 'guideDustPath': {
      const paths = room.guideDustPaths ?? [];
      const path = paths.find(p => p.uid === uid);
      const pointIndex = candidate.guideDustPathPointIndex;
      if (!path || pointIndex === undefined) break;
      if (path.points.length <= 2) {
        removeByUid(paths, uid);
      } else {
        path.points.splice(pointIndex, 1);
      }
      state.guideDustPathSelectedPointIndex = null;
      state.selectedElements = state.selectedElements.filter(e => e.uid !== uid);
      return;
    }
    case 'customBlock':
      removeByUid(room.customBlockPlacements, uid);
      break;
    default:
      // Element types without deletion support (e.g. those not reachable via
      // hit-testing at all) fall through as a no-op.
      return;
  }

  state.selectedElements = state.selectedElements.filter(e => e.uid !== uid);
}
