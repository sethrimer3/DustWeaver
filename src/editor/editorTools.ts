/**
 * Editor tools — Select and Delete logic.
 *
 * Place tool logic lives in editorPlaceTool.ts.
 * Hit-test geometry helpers live in editorHitTest.ts.
 */

import {
  EditorState, EditorRoomData, SelectedElement,
} from './editorState';
import {
  hitTestZone,
  hitTestWall,
  hitTestPoint,
  hitTestTransition,
  hitTestTransitionRect,
} from './editorHitTest';

// ── Select tool ──────────────────────────────────────────────────────────────

/**
 * Attempts to select an element at the given block coordinates.
 * Returns the selected element or null.
 */
export function selectAtCursor(state: EditorState): SelectedElement | null {
  const room = state.roomData;
  if (room === null) return null;

  const bx = state.cursorBlockX;
  const by = state.cursorBlockY;

  // Check transitions first (they occupy boundary edges)
  for (const t of room.transitions) {
    if (hitTestTransition(t, bx, by, room)) {
      return { type: 'transition', uid: t.uid };
    }
  }

  // Check enemies
  for (const e of room.enemies) {
    if (hitTestPoint(e.xBlock, e.yBlock, bx, by)) {
      return { type: 'enemy', uid: e.uid };
    }
  }

  // Check save tombs
  for (const s of room.saveTombs) {
    if (hitTestPoint(s.xBlock, s.yBlock, bx, by)) {
      return { type: 'saveTomb', uid: s.uid };
    }
  }

  // Check skill tombs
  for (const s of room.skillTombs) {
    if (hitTestPoint(s.xBlock, s.yBlock, bx, by)) {
      return { type: 'skillTomb', uid: s.uid };
    }
  }

  // Check dust containers
  for (const c of (room.dustContainers ?? [])) {
    if (hitTestPoint(c.xBlock, c.yBlock, bx, by)) {
      return { type: 'dustContainer', uid: c.uid };
    }
  }

  // Check dust container pieces
  for (const c of (room.dustContainerPieces ?? [])) {
    if (hitTestPoint(c.xBlock, c.yBlock, bx, by)) {
      return { type: 'dustContainerPiece', uid: c.uid };
    }
  }

  // Check dust boost jars
  for (const j of (room.dustBoostJars ?? [])) {
    if (hitTestPoint(j.xBlock, j.yBlock, bx, by)) {
      return { type: 'dustBoostJar', uid: j.uid };
    }
  }

  // Check dust piles
  for (const p of room.dustPiles) {
    if (hitTestPoint(p.xBlock, p.yBlock, bx, by)) {
      return { type: 'dustPile', uid: p.uid };
    }
  }

  // Check grasshopper areas
  for (const a of room.grasshopperAreas) {
    if (hitTestZone(a, bx, by)) {
      return { type: 'grasshopperArea', uid: a.uid };
    }
  }
  // Check firefly areas
  for (const a of (room.fireflyAreas ?? [])) {
    if (hitTestZone(a, bx, by)) {
      return { type: 'fireflyArea', uid: a.uid };
    }
  }

  // Check light sources (point selection at block centre).
  for (const ls of (room.lightSources ?? [])) {
    if (hitTestPoint(ls.xBlock, ls.yBlock, bx, by)) {
      return { type: 'lightSource', uid: ls.uid };
    }
  }

  // Check sunbeams (point selection at origin block).
  for (const sb of (room.sunbeams ?? [])) {
    if (hitTestPoint(sb.xBlock, sb.yBlock, bx, by)) {
      return { type: 'sunbeam', uid: sb.uid };
    }
  }

  // Check water zones
  for (const z of (room.waterZones ?? [])) {
    if (hitTestZone(z, bx, by)) {
      return { type: 'waterZone', uid: z.uid };
    }
  }

  // Check lava zones
  for (const z of (room.lavaZones ?? [])) {
    if (hitTestZone(z, bx, by)) {
      return { type: 'lavaZone', uid: z.uid };
    }
  }

  // Check crumble blocks
  for (const b of (room.crumbleBlocks ?? [])) {
    if (hitTestPoint(b.xBlock, b.yBlock, bx, by)) {
      return { type: 'crumbleBlock', uid: b.uid };
    }
  }

  // Check falling block tiles
  for (const fb of (room.fallingBlocks ?? [])) {
    if (hitTestPoint(fb.xBlock, fb.yBlock, bx, by)) {
      return { type: 'fallingBlock', uid: fb.uid };
    }
  }

  // Check bounce pads
  for (const b of (room.bouncePads ?? [])) {
    if (hitTestZone({ xBlock: b.xBlock, yBlock: b.yBlock, wBlock: b.wBlock, hBlock: b.hBlock }, bx, by)) {
      return { type: 'bouncePad', uid: b.uid };
    }
  }

  // Check decorations
  for (const d of (room.decorations ?? [])) {
    if (hitTestPoint(d.xBlock, d.yBlock, bx, by)) {
      return { type: 'decoration', uid: d.uid };
    }
  }

  // Check player spawn
  if (hitTestPoint(room.playerSpawnBlock[0], room.playerSpawnBlock[1], bx, by)) {
    return { type: 'playerSpawn', uid: 0 };
  }

  // Check interior walls
  for (const w of room.interiorWalls) {
    if (hitTestWall(w, bx, by)) {
      return { type: 'wall', uid: w.uid };
    }
  }

  // Check ambient-light blockers last — they're single cells and shouldn't
  // block selection of things authored above them.
  const bxFloor = Math.floor(bx);
  const byFloor = Math.floor(by);
  for (const b of (room.ambientLightBlockers ?? [])) {
    if (b.xBlock === bxFloor && b.yBlock === byFloor) {
      return { type: 'ambientLightBlocker', uid: b.uid };
    }
  }

  return null;
}

// ── Delete tool ──────────────────────────────────────────────────────────────

/**
 * Deletes the element at the cursor location.
 */
export function deleteAtCursor(state: EditorState): void {
  const room = state.roomData;
  if (room === null) return;

  const bx = state.cursorBlockX;
  const by = state.cursorBlockY;

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

  // Check water zones
  const waterZones = room.waterZones ?? [];
  for (let i = 0; i < waterZones.length; i++) {
    if (hitTestZone(waterZones[i], bx, by)) {
      const removedUid = waterZones[i].uid;
      waterZones.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
      return;
    }
  }

  // Check lava zones
  const lavaZones = room.lavaZones ?? [];
  for (let i = 0; i < lavaZones.length; i++) {
    if (hitTestZone(lavaZones[i], bx, by)) {
      const removedUid = lavaZones[i].uid;
      lavaZones.splice(i, 1);
      state.selectedElements = state.selectedElements.filter(e => e.uid !== removedUid);
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
}

// ── Rotate selected element ──────────────────────────────────────────────────

/**
 * Rotates the currently selected wall by 90° (swaps width and height).
 */
export function rotateSelectedElement(state: EditorState): void {
  const sel = state.selectedElements[0] ?? null;
  if (sel === null || state.roomData === null) return;
  if (sel.type === 'wall') {
    const wall = state.roomData.interiorWalls.find(w => w.uid === sel.uid);
    if (wall) {
      const tmp = wall.wBlock;
      wall.wBlock = wall.hBlock;
      wall.hBlock = tmp;
    }
  }
}

// ── Multi-selection helpers ──────────────────────────────────────────────────

/**
 * Returns all elements whose block-space bounding box overlaps the given rect.
 */
export function getAllElementsInRect(
  room: EditorRoomData,
  x1: number, y1: number,
  x2: number, y2: number,
): SelectedElement[] {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const results: SelectedElement[] = [];

  for (const w of room.interiorWalls) {
    if (w.xBlock + w.wBlock > minX && w.xBlock < maxX + 1 &&
        w.yBlock + w.hBlock > minY && w.yBlock < maxY + 1) {
      results.push({ type: 'wall', uid: w.uid });
    }
  }
  for (const e of room.enemies) {
    if (e.xBlock >= minX && e.xBlock <= maxX && e.yBlock >= minY && e.yBlock <= maxY) {
      results.push({ type: 'enemy', uid: e.uid });
    }
  }
  for (const s of room.saveTombs) {
    if (s.xBlock >= minX && s.xBlock <= maxX && s.yBlock >= minY && s.yBlock <= maxY) {
      results.push({ type: 'saveTomb', uid: s.uid });
    }
  }
  for (const s of room.skillTombs) {
    if (s.xBlock >= minX && s.xBlock <= maxX && s.yBlock >= minY && s.yBlock <= maxY) {
      results.push({ type: 'skillTomb', uid: s.uid });
    }
  }
  for (const c of (room.dustContainers ?? [])) {
    if (c.xBlock >= minX && c.xBlock <= maxX && c.yBlock >= minY && c.yBlock <= maxY) {
      results.push({ type: 'dustContainer', uid: c.uid });
    }
  }
  for (const c of (room.dustContainerPieces ?? [])) {
    if (c.xBlock >= minX && c.xBlock <= maxX && c.yBlock >= minY && c.yBlock <= maxY) {
      results.push({ type: 'dustContainerPiece', uid: c.uid });
    }
  }
  for (const j of (room.dustBoostJars ?? [])) {
    if (j.xBlock >= minX && j.xBlock <= maxX && j.yBlock >= minY && j.yBlock <= maxY) {
      results.push({ type: 'dustBoostJar', uid: j.uid });
    }
  }
  for (const p of room.dustPiles) {
    if (p.xBlock >= minX && p.xBlock <= maxX && p.yBlock >= minY && p.yBlock <= maxY) {
      results.push({ type: 'dustPile', uid: p.uid });
    }
  }
  for (const a of room.grasshopperAreas) {
    if (a.xBlock + a.wBlock > minX && a.xBlock < maxX + 1 &&
        a.yBlock + a.hBlock > minY && a.yBlock < maxY + 1) {
      results.push({ type: 'grasshopperArea', uid: a.uid });
    }
  }
  for (const a of (room.fireflyAreas ?? [])) {
    if (a.xBlock + a.wBlock > minX && a.xBlock < maxX + 1 &&
        a.yBlock + a.hBlock > minY && a.yBlock < maxY + 1) {
      results.push({ type: 'fireflyArea', uid: a.uid });
    }
  }
  for (const d of (room.decorations ?? [])) {
    if (d.xBlock >= minX && d.xBlock <= maxX && d.yBlock >= minY && d.yBlock <= maxY) {
      results.push({ type: 'decoration', uid: d.uid });
    }
  }
  for (const ls of (room.lightSources ?? [])) {
    if (ls.xBlock >= minX && ls.xBlock <= maxX && ls.yBlock >= minY && ls.yBlock <= maxY) {
      results.push({ type: 'lightSource', uid: ls.uid });
    }
  }
  for (const sb of (room.sunbeams ?? [])) {
    if (sb.xBlock >= minX && sb.xBlock <= maxX && sb.yBlock >= minY && sb.yBlock <= maxY) {
      results.push({ type: 'sunbeam', uid: sb.uid });
    }
  }
  for (const b of (room.ambientLightBlockers ?? [])) {
    if (b.xBlock >= minX && b.xBlock <= maxX && b.yBlock >= minY && b.yBlock <= maxY) {
      results.push({ type: 'ambientLightBlocker', uid: b.uid });
    }
  }
  for (const z of (room.waterZones ?? [])) {
    if (z.xBlock + z.wBlock > minX && z.xBlock < maxX + 1 &&
        z.yBlock + z.hBlock > minY && z.yBlock < maxY + 1) {
      results.push({ type: 'waterZone', uid: z.uid });
    }
  }
  for (const z of (room.lavaZones ?? [])) {
    if (z.xBlock + z.wBlock > minX && z.xBlock < maxX + 1 &&
        z.yBlock + z.hBlock > minY && z.yBlock < maxY + 1) {
      results.push({ type: 'lavaZone', uid: z.uid });
    }
  }
  for (const b of (room.crumbleBlocks ?? [])) {
    if (b.xBlock >= minX && b.xBlock <= maxX && b.yBlock >= minY && b.yBlock <= maxY) {
      results.push({ type: 'crumbleBlock', uid: b.uid });
    }
  }
  for (const b of (room.bouncePads ?? [])) {
    if (b.xBlock + b.wBlock > minX && b.xBlock < maxX + 1 &&
        b.yBlock + b.hBlock > minY && b.yBlock < maxY + 1) {
      results.push({ type: 'bouncePad', uid: b.uid });
    }
  }
  for (const fb of (room.fallingBlocks ?? [])) {
    if (fb.xBlock >= minX && fb.xBlock <= maxX && fb.yBlock >= minY && fb.yBlock <= maxY) {
      results.push({ type: 'fallingBlock', uid: fb.uid });
    }
  }
  if (room.playerSpawnBlock[0] >= minX && room.playerSpawnBlock[0] <= maxX &&
      room.playerSpawnBlock[1] >= minY && room.playerSpawnBlock[1] <= maxY) {
    results.push({ type: 'playerSpawn', uid: 0 });
  }
  for (const t of room.transitions) {
    if (hitTestTransitionRect(t, minX, minY, maxX, maxY, room)) {
      results.push({ type: 'transition', uid: t.uid });
    }
  }
  return results;
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
