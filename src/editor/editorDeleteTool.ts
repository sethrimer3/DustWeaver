/**
 * Editor delete tool — removes the element at the cursor position.
 *
 * Extracted from editorTools.ts to keep that module focused on the select,
 * rotate, flip, multi-select, and rope-anchor hit-test operations.
 */

import { EditorState, allocateUid } from './editorState';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import {
  hitTestZone,
  hitTestWall,
  hitTestPoint,
  hitTestTransition,
} from './editorHitTest';
import { markLiquidBodiesDirty } from '../render/liquidBodyCache';
import { getBrushCells, getFillBrushCells, FillKind } from './editorBrush';

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
 */
function deleteAt(state: EditorState, bx: number, by: number): void {
  const room = state.roomData;
  if (room === null) return;

  // Check campaign spawn first (campaign-level singleton marker)
  if (state.campaignSpawnBlock !== null &&
      hitTestPoint(state.campaignSpawnBlock[0], state.campaignSpawnBlock[1], bx, by)) {
    state.campaignSpawnBlock = null;
    state.selectedElements = state.selectedElements.filter(e => e.type !== 'campaignSpawn');
    return;
  }

  // Check transitions first
  for (let i = 0; i < room.transitions.length; i++) {
    if (hitTestTransition(room.transitions[i], bx, by, room)) {
      const removedUid = room.transitions[i].uid;
      room.transitions.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check enemies
  for (let i = 0; i < room.enemies.length; i++) {
    if (hitTestPoint(room.enemies[i].xBlock, room.enemies[i].yBlock, bx, by)) {
      const removedUid = room.enemies[i].uid;
      room.enemies.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check save tombs
  for (let i = 0; i < room.saveTombs.length; i++) {
    if (hitTestPoint(room.saveTombs[i].xBlock, room.saveTombs[i].yBlock, bx, by)) {
      const removedUid = room.saveTombs[i].uid;
      room.saveTombs.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check skill tombs
  for (let i = 0; i < room.skillTombs.length; i++) {
    if (hitTestPoint(room.skillTombs[i].xBlock, room.skillTombs[i].yBlock, bx, by)) {
      const removedUid = room.skillTombs[i].uid;
      room.skillTombs.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check dust containers
  const dustContainers = room.dustContainers ?? [];
  for (let i = 0; i < dustContainers.length; i++) {
    if (hitTestPoint(dustContainers[i].xBlock, dustContainers[i].yBlock, bx, by)) {
      const removedUid = dustContainers[i].uid;
      dustContainers.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check dust container pieces
  const dustContainerPieces = room.dustContainerPieces ?? [];
  for (let i = 0; i < dustContainerPieces.length; i++) {
    if (hitTestPoint(dustContainerPieces[i].xBlock, dustContainerPieces[i].yBlock, bx, by)) {
      const removedUid = dustContainerPieces[i].uid;
      dustContainerPieces.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check dust boost jars
  const dustBoostJars = room.dustBoostJars ?? [];
  for (let i = 0; i < dustBoostJars.length; i++) {
    if (hitTestPoint(dustBoostJars[i].xBlock, dustBoostJars[i].yBlock, bx, by)) {
      const removedUid = dustBoostJars[i].uid;
      dustBoostJars.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check dust swarms
  const dustSwarms = room.dustSwarms ?? [];
  for (let i = 0; i < dustSwarms.length; i++) {
    if (hitTestPoint(dustSwarms[i].xBlock, dustSwarms[i].yBlock, bx, by)) {
      const removedUid = dustSwarms[i].uid;
      dustSwarms.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check lambda anchors
  const lambdaAnchors = room.lambdaAnchors ?? [];
  for (let i = 0; i < lambdaAnchors.length; i++) {
    if (hitTestPoint(lambdaAnchors[i].xBlock, lambdaAnchors[i].yBlock, bx, by)) {
      const removedUid = lambdaAnchors[i].uid;
      lambdaAnchors.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check dust piles
  for (let i = 0; i < room.dustPiles.length; i++) {
    if (hitTestPoint(room.dustPiles[i].xBlock, room.dustPiles[i].yBlock, bx, by)) {
      const removedUid = room.dustPiles[i].uid;
      room.dustPiles.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check grasshopper areas
  for (let i = 0; i < room.grasshopperAreas.length; i++) {
    if (hitTestZone(room.grasshopperAreas[i], bx, by)) {
      const removedUid = room.grasshopperAreas[i].uid;
      room.grasshopperAreas.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }
  // Check firefly areas
  const fireflyAreas = room.fireflyAreas ?? [];
  for (let i = 0; i < fireflyAreas.length; i++) {
    if (hitTestZone(fireflyAreas[i], bx, by)) {
      const removedUid = fireflyAreas[i].uid;
      fireflyAreas.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check decorations
  const decos = room.decorations ?? [];
  for (let i = 0; i < decos.length; i++) {
    if (hitTestPoint(decos[i].xBlock, decos[i].yBlock, bx, by)) {
      const removedUid = decos[i].uid;
      decos.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check walls
  for (let i = 0; i < room.interiorWalls.length; i++) {
    if (hitTestWall(room.interiorWalls[i], bx, by)) {
      const removedUid = room.interiorWalls[i].uid;
      room.interiorWalls.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check light sources (before blockers so the bigger icon wins).
  const lights = room.lightSources ?? [];
  for (let i = 0; i < lights.length; i++) {
    if (hitTestPoint(lights[i].xBlock, lights[i].yBlock, bx, by)) {
      const removedUid = lights[i].uid;
      lights.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check sunbeams.
  const sunbeams = room.sunbeams ?? [];
  for (let i = 0; i < sunbeams.length; i++) {
    if (hitTestPoint(sunbeams[i].xBlock, sunbeams[i].yBlock, bx, by)) {
      const removedUid = sunbeams[i].uid;
      sunbeams.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check scene lights.
  const sceneLights = room.sceneLights ?? [];
  for (let i = 0; i < sceneLights.length; i++) {
    const slBx = sceneLights[i].xWorld / BLOCK_SIZE_MEDIUM;
    const slBy = sceneLights[i].yWorld / BLOCK_SIZE_MEDIUM;
    if (hitTestPoint(slBx, slBy, bx, by)) {
      const removedUid = sceneLights[i].uid;
      sceneLights.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check ambient-light blockers (single-cell match).
  const blockers = room.ambientLightBlockers ?? [];
  const bxFloor = Math.floor(bx);
  const byFloor = Math.floor(by);
  for (let i = 0; i < blockers.length; i++) {
    if (blockers[i].xBlock === bxFloor && blockers[i].yBlock === byFloor) {
      const removedUid = blockers[i].uid;
      blockers.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check water zones. If the hit zone spans more than one tile, split it
  // into the remaining rectangles instead of removing the whole thing.
  const waterZones = room.waterZones ?? [];
  for (let i = 0; i < waterZones.length; i++) {
    const zone = waterZones[i];
    if (hitTestZone(zone, bx, by)) {
      const removedUid = zone.uid;
      waterZones.splice(i, 1);
      for (const piece of splitZoneAroundCell(zone, Math.floor(bx), Math.floor(by))) {
        waterZones.push({ uid: allocateUid(state), ...piece });
      }
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      markLiquidBodiesDirty();
      return;
    }
  }

  // Check lava zones. Same split-instead-of-remove behaviour as water zones.
  const lavaZones = room.lavaZones ?? [];
  for (let i = 0; i < lavaZones.length; i++) {
    const zone = lavaZones[i];
    if (hitTestZone(zone, bx, by)) {
      const removedUid = zone.uid;
      lavaZones.splice(i, 1);
      for (const piece of splitZoneAroundCell(zone, Math.floor(bx), Math.floor(by))) {
        lavaZones.push({ uid: allocateUid(state), ...piece });
      }
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      markLiquidBodiesDirty();
      return;
    }
  }

  // Check crumble blocks
  const crumbleBlocks = room.crumbleBlocks ?? [];
  for (let i = 0; i < crumbleBlocks.length; i++) {
    if (hitTestPoint(crumbleBlocks[i].xBlock, crumbleBlocks[i].yBlock, bx, by)) {
      const removedUid = crumbleBlocks[i].uid;
      crumbleBlocks.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check falling block tiles
  const fallingBlocks = room.fallingBlocks ?? [];
  for (let i = 0; i < fallingBlocks.length; i++) {
    if (hitTestPoint(fallingBlocks[i].xBlock, fallingBlocks[i].yBlock, bx, by)) {
      const removedUid = fallingBlocks[i].uid;
      fallingBlocks.splice(i, 1);
      if (room.fallingBlocks) room.fallingBlocks = fallingBlocks;
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check background blocks
  const backgroundBlocks = room.backgroundBlocks ?? [];
  for (let i = 0; i < backgroundBlocks.length; i++) {
    if (hitTestZone({ xBlock: backgroundBlocks[i].xBlock, yBlock: backgroundBlocks[i].yBlock, wBlock: backgroundBlocks[i].wBlock, hBlock: backgroundBlocks[i].hBlock }, bx, by)) {
      const removedUid = backgroundBlocks[i].uid;
      backgroundBlocks.splice(i, 1);
      room.backgroundBlocks = backgroundBlocks;
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check spikes
  const spikes = room.spikes ?? [];
  for (let i = 0; i < spikes.length; i++) {
    const spSize = spikes[i].size === '2x2' ? 2 : 1;
    if (hitTestZone({ xBlock: spikes[i].xBlock, yBlock: spikes[i].yBlock, wBlock: spSize, hBlock: spSize }, bx, by)) {
      const removedUid = spikes[i].uid;
      spikes.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check bounce pads
  const bouncePads = room.bouncePads ?? [];
  for (let i = 0; i < bouncePads.length; i++) {
    if (hitTestZone({ xBlock: bouncePads[i].xBlock, yBlock: bouncePads[i].yBlock, wBlock: bouncePads[i].wBlock, hBlock: bouncePads[i].hBlock }, bx, by)) {
      const removedUid = bouncePads[i].uid;
      bouncePads.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check kinetic blocks
  const kineticBlocks = room.kineticBlocks ?? [];
  for (let i = 0; i < kineticBlocks.length; i++) {
    if (hitTestZone({ xBlock: kineticBlocks[i].xBlock, yBlock: kineticBlocks[i].yBlock, wBlock: kineticBlocks[i].wBlock, hBlock: kineticBlocks[i].hBlock }, bx, by)) {
      const removedUid = kineticBlocks[i].uid;
      kineticBlocks.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  const grappleCarryBlocks = room.grappleCarryBlocks ?? [];
  for (let i = 0; i < grappleCarryBlocks.length; i++) {
    if (hitTestPoint(grappleCarryBlocks[i].xBlock, grappleCarryBlocks[i].yBlock, bx, by)) {
      const removedUid = grappleCarryBlocks[i].uid;
      grappleCarryBlocks.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  const phantasmalTiles = room.phantasmalTiles ?? [];
  for (let i = 0; i < phantasmalTiles.length; i++) {
    if (hitTestPoint(phantasmalTiles[i].xBlock, phantasmalTiles[i].yBlock, bx, by)) {
      const removedUid = phantasmalTiles[i].uid;
      phantasmalTiles.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check dialogue triggers
  const dialogueTriggers = room.dialogueTriggers ?? [];
  for (let i = 0; i < dialogueTriggers.length; i++) {
    if (hitTestZone({ xBlock: dialogueTriggers[i].xBlock, yBlock: dialogueTriggers[i].yBlock, wBlock: dialogueTriggers[i].wBlock, hBlock: dialogueTriggers[i].hBlock }, bx, by)) {
      const removedUid = dialogueTriggers[i].uid;
      dialogueTriggers.splice(i, 1);
      if (room.dialogueTriggers) room.dialogueTriggers = dialogueTriggers;
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check guide dust paths — clicking near a control point removes that point
  // (or the whole path if it would drop below 2 points). Clicking anywhere on
  // the bounding region of a path deletes the entire path.
  const guideDustPaths = room.guideDustPaths ?? [];
  for (let i = 0; i < guideDustPaths.length; i++) {
    const p = guideDustPaths[i];
    // First check control-point proximity (1.5 block pick radius)
    for (let pi = 0; pi < p.points.length; pi++) {
      const pt = p.points[pi];
      const dx = bx - pt.xBlock;
      const dy = by - pt.yBlock;
      if (dx * dx + dy * dy <= 1.5 * 1.5) {
        if (p.points.length <= 2) {
          // Delete the whole path
          guideDustPaths.splice(i, 1);
          room.guideDustPaths = guideDustPaths;
          state.selectedElements = state.selectedElements.filter(e => e.uid !== p.uid);
        } else {
          p.points.splice(pi, 1);
        }
        state.guideDustPathSelectedPointIndex = null;
        return;
      }
    }
  }

  // Custom block placements
  const placements = room.customBlockPlacements ?? [];
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    if (bx >= p.xBlock && bx < p.xBlock + p.tileWidth &&
        by >= p.yBlock && by < p.yBlock + p.tileHeight) {
      placements.splice(i, 1);
      room.customBlockPlacements = placements;
      state.selectedElements = state.selectedElements.filter(e => e.uid !== p.uid);
      return;
    }
  }
}
