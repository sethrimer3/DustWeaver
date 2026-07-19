/**
 * Editor tools — Select, Rotate, Flip, Multi-select, and rope-anchor hit-test logic.
 *
 * Place tool logic lives in editorPlaceTool.ts.
 * Delete tool logic lives in editorDeleteTool.ts.
 * Hit-test geometry helpers live in editorHitTest.ts.
 */

import {
  EditorState, EditorRoomData, SelectedElement, EditorTransition,
} from './editorState';
import type { TransitionDirection } from '../levels/roomDef';
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import {
  hitTestZone,
  hitTestWall,
  hitTestPoint,
  hitTestTransition,
  hitTestTransitionRect,
} from './editorHitTest';
export { deleteAtCursor, deleteAtCursorBrushed } from './editorDeleteTool';

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
  for (const field of room.challengeFields ?? []) {
    if (hitTestZone(field, bx, by)) return { type: 'challengeField', uid: field.uid };
  }
  for (const block of room.zipMoveBlocks ?? []) {
    if (hitTestZone(block, bx, by)) return { type: 'zipMoveBlock', uid: block.uid };
  }
  for (const gate of room.challengeGates ?? []) {
    if (hitTestZone(gate, bx, by)) return { type: 'challengeGate', uid: gate.uid };
  }
  for (const gate of room.gates ?? []) {
    if (hitTestZone(gate, bx, by)) return { type: 'gate', uid: gate.uid };
  }
  for (const totem of room.challengeTotems ?? []) {
    if (hitTestPoint(totem.xBlock, totem.yBlock, bx, by)) return { type: 'challengeTotem', uid: totem.uid };
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

  // Check dust swarms
  for (const s of (room.dustSwarms ?? [])) {
    if (hitTestPoint(s.xBlock, s.yBlock, bx, by)) {
      return { type: 'dustSwarm', uid: s.uid };
    }
  }

  // Check lambda anchors
  for (const a of (room.lambdaAnchors ?? [])) {
    if (hitTestPoint(a.xBlock, a.yBlock, bx, by)) {
      return { type: 'lambdaAnchor', uid: a.uid };
    }
  }

  // Check firefly jars
  for (const j of (room.fireflyJars ?? [])) {
    if (hitTestPoint(j.xBlock, j.yBlock, bx, by)) {
      return { type: 'fireflyJar', uid: j.uid };
    }
  }

  // Check springboards
  for (const s of (room.springboards ?? [])) {
    if (hitTestPoint(s.xBlock, s.yBlock, bx, by)) {
      return { type: 'springboard', uid: s.uid };
    }
  }

  // Check breakable blocks
  for (const b of (room.breakableBlocks ?? [])) {
    if (hitTestPoint(b.xBlock, b.yBlock, bx, by)) {
      return { type: 'breakableBlock', uid: b.uid };
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

  // Check scene lights (point selection at world position converted to block coords).
  for (const sl of (room.sceneLights ?? [])) {
    const slBx = sl.xWorld / BLOCK_SIZE_MEDIUM;
    const slBy = sl.yWorld / BLOCK_SIZE_MEDIUM;
    if (hitTestPoint(slBx, slBy, bx, by)) {
      return { type: 'sceneLight', uid: sl.uid };
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

  // Check background blocks
  for (const b of (room.backgroundBlocks ?? [])) {
    if (hitTestZone({ xBlock: b.xBlock, yBlock: b.yBlock, wBlock: b.wBlock, hBlock: b.hBlock }, bx, by)) {
      return { type: 'backgroundBlock', uid: b.uid };
    }
  }

  for (const b of (room.grappleCarryBlocks ?? [])) {
    if (hitTestPoint(b.xBlock, b.yBlock, bx, by)) {
      return { type: 'grappleCarryBlock', uid: b.uid };
    }
  }

  for (const t of (room.phantasmalTiles ?? [])) {
    if (hitTestPoint(t.xBlock, t.yBlock, bx, by)) {
      return { type: 'phantasmalTile', uid: t.uid };
    }
  }

  // Check dialogue triggers
  for (const dt of (room.dialogueTriggers ?? [])) {
    if (hitTestZone({ xBlock: dt.xBlock, yBlock: dt.yBlock, wBlock: dt.wBlock, hBlock: dt.hBlock }, bx, by)) {
      return { type: 'dialogueTrigger', uid: dt.uid };
    }
  }

  // Check guide dust paths — hit-test control points (1.5 block pick radius)
  for (const p of (room.guideDustPaths ?? [])) {
    for (let i = 0; i < p.points.length; i++) {
      const pt = p.points[i];
      const dx = bx - pt.xBlock;
      const dy = by - pt.yBlock;
      if (dx * dx + dy * dy <= 1.5 * 1.5) {
        state.guideDustPathSelectedPointIndex = i;
        return { type: 'guideDustPath', uid: p.uid };
      }
    }
  }

  // Check bounce pads
  for (const b of (room.bouncePads ?? [])) {
    if (hitTestZone({ xBlock: b.xBlock, yBlock: b.yBlock, wBlock: b.wBlock, hBlock: b.hBlock }, bx, by)) {
      return { type: 'bouncePad', uid: b.uid };
    }
  }

  // Check spikes
  for (const sp of (room.spikes ?? [])) {
    const spSize = sp.size === '2x2' ? 2 : 1;
    if (hitTestZone({ xBlock: sp.xBlock, yBlock: sp.yBlock, wBlock: spSize, hBlock: spSize }, bx, by)) {
      return { type: 'spike', uid: sp.uid };
    }
  }

  // Check decorations
  for (const d of (room.decorations ?? [])) {
    if (hitTestPoint(d.xBlock, d.yBlock, bx, by)) {
      return { type: 'decoration', uid: d.uid };
    }
  }

  // Check campaign spawn (campaign-level singleton; if present in this room)
  if (state.campaignSpawnBlock !== null &&
      hitTestPoint(state.campaignSpawnBlock[0], state.campaignSpawnBlock[1], bx, by)) {
    return { type: 'campaignSpawn', uid: 0 };
  }

  // Check player spawn
  if (hitTestPoint(room.playerSpawnBlock[0], room.playerSpawnBlock[1], bx, by)) {
    return { type: 'playerSpawn', uid: 0 };
  }

  // Check custom block placements
  for (const p of (room.customBlockPlacements ?? [])) {
    if (bx >= p.xBlock && bx < p.xBlock + p.tileWidth &&
        by >= p.yBlock && by < p.yBlock + p.tileHeight) {
      return { type: 'customBlock', uid: p.uid };
    }
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

// ── Rotate selected element ──────────────────────────────────────────────────

/**
 * Rotates the currently selected element by 90° clockwise.
 * - Walls: swap width and height.
 * - Transitions: cycle direction right → down → left → up → right and
 *   reposition to the nearest matching room edge.
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
  } else if (sel.type === 'transition') {
    const t = state.roomData.transitions.find(tr => tr.uid === sel.uid);
    if (t) {
      const DIRS: TransitionDirection[] = ['right', 'down', 'left', 'up'];
      const idx = DIRS.indexOf(t.direction);
      const newDir = DIRS[(idx + 1) % 4];
      _repositionTransitionForNewDirection(t, newDir, state.roomData);
    }
  } else if (sel.type === 'enemy') {
    const enemy = state.roomData.enemies.find(e => e.uid === sel.uid);
    if (enemy?.isMomentumTurretFlag === 1) {
      enemy.momentumTurretFacingIndex = (((enemy.momentumTurretFacingIndex ?? 0) + 1) % 4) as 0 | 1 | 2 | 3;
    } else if (enemy?.isSlimeSnailFlag === 1) {
      enemy.slimeSnailSurfaceSideIndex = (((enemy.slimeSnailSurfaceSideIndex ?? 0) + 1) % 4) as 0 | 1 | 2 | 3;
    }
  }
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
export function flipSelectedTransition(state: EditorState): void {
  const sel = state.selectedElements[0] ?? null;
  if (sel === null || sel.type !== 'transition' || state.roomData === null) return;
  const t = state.roomData.transitions.find(tr => tr.uid === sel.uid);
  if (!t) return;
  let newDir: TransitionDirection;
  switch (t.direction) {
    case 'left':  newDir = 'right'; break;
    case 'right': newDir = 'left';  break;
    case 'up':    newDir = 'down';  break;
    case 'down':  newDir = 'up';    break;
  }
  _repositionTransitionForNewDirection(t, newDir, state.roomData);
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
  for (const s of (room.dustSwarms ?? [])) {
    if (s.xBlock >= minX && s.xBlock <= maxX && s.yBlock >= minY && s.yBlock <= maxY) {
      results.push({ type: 'dustSwarm', uid: s.uid });
    }
  }
  for (const a of (room.lambdaAnchors ?? [])) {
    if (a.xBlock >= minX && a.xBlock <= maxX && a.yBlock >= minY && a.yBlock <= maxY) {
      results.push({ type: 'lambdaAnchor', uid: a.uid });
    }
  }
  for (const j of (room.fireflyJars ?? [])) {
    if (j.xBlock >= minX && j.xBlock <= maxX && j.yBlock >= minY && j.yBlock <= maxY) {
      results.push({ type: 'fireflyJar', uid: j.uid });
    }
  }
  for (const s of (room.springboards ?? [])) {
    if (s.xBlock >= minX && s.xBlock <= maxX && s.yBlock >= minY && s.yBlock <= maxY) {
      results.push({ type: 'springboard', uid: s.uid });
    }
  }
  for (const b of (room.breakableBlocks ?? [])) {
    if (b.xBlock >= minX && b.xBlock <= maxX && b.yBlock >= minY && b.yBlock <= maxY) {
      results.push({ type: 'breakableBlock', uid: b.uid });
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
  for (const sp of (room.spikes ?? [])) {
    const spSize = sp.size === '2x2' ? 2 : 1;
    if (sp.xBlock + spSize > minX && sp.xBlock < maxX + 1 &&
        sp.yBlock + spSize > minY && sp.yBlock < maxY + 1) {
      results.push({ type: 'spike', uid: sp.uid });
    }
  }
  for (const fb of (room.fallingBlocks ?? [])) {
    if (fb.xBlock >= minX && fb.xBlock <= maxX && fb.yBlock >= minY && fb.yBlock <= maxY) {
      results.push({ type: 'fallingBlock', uid: fb.uid });
    }
  }
  for (const b of (room.backgroundBlocks ?? [])) {
    if (b.xBlock + b.wBlock > minX && b.xBlock < maxX + 1 &&
        b.yBlock + b.hBlock > minY && b.yBlock < maxY + 1) {
      results.push({ type: 'backgroundBlock', uid: b.uid });
    }
  }
  for (const b of (room.grappleCarryBlocks ?? [])) {
    if (b.xBlock >= minX && b.xBlock <= maxX && b.yBlock >= minY && b.yBlock <= maxY) {
      results.push({ type: 'grappleCarryBlock', uid: b.uid });
    }
  }
  for (const t of (room.phantasmalTiles ?? [])) {
    if (t.xBlock >= minX && t.xBlock <= maxX && t.yBlock >= minY && t.yBlock <= maxY) {
      results.push({ type: 'phantasmalTile', uid: t.uid });
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
