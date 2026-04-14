/**
 * Editor tools — Select, Place, Delete logic.
 * Operates on EditorRoomData and modifies it in place.
 */

import {
  EditorState, EditorTool, EditorRoomData, EditorWall,
  EditorTransition, SelectedElement, allocateUid,
  PaletteItem,
} from './editorState';

// ── Hit testing helpers ──────────────────────────────────────────────────────

function hitTestWall(w: EditorWall, bx: number, by: number): boolean {
  return bx >= w.xBlock && bx < w.xBlock + w.wBlock && by >= w.yBlock && by < w.yBlock + w.hBlock;
}

function hitTestPoint(xBlock: number, yBlock: number, bx: number, by: number): boolean {
  return Math.abs(bx - xBlock) < 1.5 && Math.abs(by - yBlock) < 1.5;
}

function hitTestTransition(t: EditorTransition, bx: number, by: number, roomData: EditorRoomData): boolean {
  if (t.direction === 'left') {
    return bx <= 1 && by >= t.positionBlock && by < t.positionBlock + t.openingSizeBlocks;
  } else if (t.direction === 'right') {
    return bx >= roomData.widthBlocks - 2 && by >= t.positionBlock && by < t.positionBlock + t.openingSizeBlocks;
  } else if (t.direction === 'up') {
    return by <= 1 && bx >= t.positionBlock && bx < t.positionBlock + t.openingSizeBlocks;
  } else {
    return by >= roomData.heightBlocks - 2 && bx >= t.positionBlock && bx < t.positionBlock + t.openingSizeBlocks;
  }
}

/** Returns true if two wall rectangles (in block coordinates) overlap. */
function wallsOverlap(a: EditorWall, bx: number, by: number, bw: number, bh: number): boolean {
  return a.xBlock < bx + bw &&
         a.xBlock + a.wBlock > bx &&
         a.yBlock < by + bh &&
         a.yBlock + a.hBlock > by;
}


function isInsideRoom(room: EditorRoomData, xBlock: number, yBlock: number): boolean {
  return xBlock >= 0 && yBlock >= 0 && xBlock < room.widthBlocks && yBlock < room.heightBlocks;
}

function rectFitsInsideRoom(room: EditorRoomData, xBlock: number, yBlock: number, wBlock: number, hBlock: number): boolean {
  return xBlock >= 0 && yBlock >= 0 &&
    xBlock + wBlock <= room.widthBlocks &&
    yBlock + hBlock <= room.heightBlocks;
}

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

  // Check dust piles
  for (const p of room.dustPiles) {
    if (hitTestPoint(p.xBlock, p.yBlock, bx, by)) {
      return { type: 'dustPile', uid: p.uid };
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

  return null;
}

// ── Place tool ───────────────────────────────────────────────────────────────

/**
 * Places the currently selected palette item at the cursor location.
 */
export function placeAtCursor(state: EditorState): void {
  const room = state.roomData;
  const item = state.selectedPaletteItem;
  if (room === null || item === null) return;

  const bx = state.cursorBlockX;
  const by = state.cursorBlockY;

  if (!isInsideRoom(room, bx, by)) return;

  if (item.category === 'blocks') {
    const wBlock = getPlacementWidth(item, state.placementRotationSteps);
    const hBlock = getPlacementHeight(item, state.placementRotationSteps);
    const isPlatformFlag: 0 | 1 = item.isPlatformItem === 1 ? 1 : 0;

    // Compute ramp orientation from rotation steps and flip
    let rampOrientation: 0 | 1 | 2 | 3 | undefined;
    if (item.isRampItem === 1) {
      const base = state.placementRotationSteps % 4;
      // flipH toggles within pairs: 0↔1, 2↔3
      rampOrientation = (state.placementFlipH ? (base ^ 1) : base) as 0 | 1 | 2 | 3;
    }

    // Compute platform edge from rotation steps
    // R=0→top(0), R=1→right(3), R=2→bottom(1), R=3→left(2)
    const platformEdgeMap: readonly (0 | 1 | 2 | 3)[] = [0, 3, 1, 2];
    const platformEdge: 0 | 1 | 2 | 3 = isPlatformFlag === 1
      ? platformEdgeMap[state.placementRotationSteps % 4]
      : 0;

    const isPillarHalfWidthFlag: 0 | 1 = item.isPillarHalfWidthItem === 1 ? 1 : 0;

    if (!rectFitsInsideRoom(room, bx, by, wBlock, hBlock)) return;
    // Prevent overlapping walls
    const overlaps = room.interiorWalls.some(w => wallsOverlap(w, bx, by, wBlock, hBlock));
    if (overlaps) return;
    room.interiorWalls.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
      wBlock,
      hBlock,
      isPlatformFlag,
      platformEdge,
      blockTheme: room.blockTheme,
      rampOrientation,
      isPillarHalfWidthFlag,
    });
  } else if (item.id === 'enemy_rolling') {
    room.enemies.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
      kinds: ['Physical'],
      particleCount: 18,
      isBossFlag: 0,
      isFlyingEyeFlag: 0,
      isRollingEnemyFlag: 1,
      rollingEnemySpriteIndex: 1,
      isRockElementalFlag: 0,
      isRadiantTetherFlag: 0,
      isGrappleHunterFlag: 0,
    });
  } else if (item.id === 'enemy_flying_eye') {
    room.enemies.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
      kinds: ['Wind'],
      particleCount: 16,
      isBossFlag: 0,
      isFlyingEyeFlag: 1,
      isRollingEnemyFlag: 0,
      rollingEnemySpriteIndex: 0,
      isRockElementalFlag: 0,
      isRadiantTetherFlag: 0,
      isGrappleHunterFlag: 0,
    });
  } else if (item.id === 'enemy_rock_elemental') {
    room.enemies.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
      kinds: ['Earth'],
      particleCount: 20,
      isBossFlag: 0,
      isFlyingEyeFlag: 0,
      isRollingEnemyFlag: 0,
      rollingEnemySpriteIndex: 0,
      isRockElementalFlag: 1,
      isRadiantTetherFlag: 0,
      isGrappleHunterFlag: 0,
    });
  } else if (item.id === 'player_spawn') {
    room.playerSpawnBlock = [bx, by];
  } else if (item.id === 'room_transition') {
    // Determine direction from cursor position
    let direction: 'left' | 'right' | 'up' | 'down' = 'right';
    if (bx <= 1) direction = 'left';
    else if (bx >= room.widthBlocks - 2) direction = 'right';
    else if (by <= 1) direction = 'up';
    else if (by >= room.heightBlocks - 2) direction = 'down';

    const openingSizeBlocks = direction === 'left' || direction === 'right'
      ? Math.max(1, Math.min(5, room.heightBlocks - 2))
      : Math.max(1, Math.min(5, room.widthBlocks - 2));

    const positionBlock = direction === 'left' || direction === 'right'
      ? Math.min(Math.max(1, by), room.heightBlocks - 1 - openingSizeBlocks)
      : Math.min(Math.max(1, bx), room.widthBlocks - 1 - openingSizeBlocks);

    room.transitions.push({
      uid: allocateUid(state),
      direction,
      positionBlock,
      openingSizeBlocks,
      targetRoomId: '',
      targetSpawnBlock: [3, by + 2],
    });
  } else if (item.id === 'save_tomb') {
    room.saveTombs.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
    });
  } else if (item.id === 'skill_tomb') {
    room.skillTombs.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
      weaveId: 'storm',
    });
  } else if (item.id === 'dust_pile' || item.id === 'dust_pile_small' || item.id === 'dust_pile_medium' || item.id === 'dust_pile_large') {
    let dustCount: number;
    if (item.id === 'dust_pile_small') {
      dustCount = 3;  // small pile — tight cluster
    } else if (item.id === 'dust_pile_large') {
      dustCount = 8;  // large pile — wide scatter
    } else {
      dustCount = 5;  // medium pile (dust_pile / dust_pile_medium)
    }
    room.dustPiles.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
      dustCount,
    });
  }
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

  // Check dust piles
  for (let i = 0; i < room.dustPiles.length; i++) {
    if (hitTestPoint(room.dustPiles[i].xBlock, room.dustPiles[i].yBlock, bx, by)) {
      const removedUid = room.dustPiles[i].uid;
      room.dustPiles.splice(i, 1);
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
}

// ── Rotation helpers ─────────────────────────────────────────────────────────

function getPlacementWidth(item: PaletteItem, rotSteps: number): number {
  const w = item.defaultWidthBlocks ?? 1;
  const h = item.defaultHeightBlocks ?? 1;
  return (rotSteps % 2 === 0) ? w : h;
}

function getPlacementHeight(item: PaletteItem, rotSteps: number): number {
  const w = item.defaultWidthBlocks ?? 1;
  const h = item.defaultHeightBlocks ?? 1;
  return (rotSteps % 2 === 0) ? h : w;
}

/**
 * Returns the placement preview dimensions for the current palette item.
 */
export function getPlacementPreview(state: EditorState): { wBlock: number; hBlock: number } | null {
  if (state.activeTool !== EditorTool.Place || state.selectedPaletteItem === null) return null;
  const item = state.selectedPaletteItem;
  if (item.category !== 'blocks') {
    return { wBlock: 1, hBlock: 1 };
  }
  return {
    wBlock: getPlacementWidth(item, state.placementRotationSteps),
    hBlock: getPlacementHeight(item, state.placementRotationSteps),
  };
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
  for (const p of room.dustPiles) {
    if (p.xBlock >= minX && p.xBlock <= maxX && p.yBlock >= minY && p.yBlock <= maxY) {
      results.push({ type: 'dustPile', uid: p.uid });
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

function hitTestTransitionRect(
  t: EditorTransition, minX: number, minY: number, maxX: number, maxY: number,
  room: EditorRoomData,
): boolean {
  let tx: number, ty: number, tw: number, th: number;
  if (t.direction === 'left') {
    tx = 0; ty = t.positionBlock; tw = 1; th = t.openingSizeBlocks;
  } else if (t.direction === 'right') {
    tx = room.widthBlocks - 1; ty = t.positionBlock; tw = 1; th = t.openingSizeBlocks;
  } else if (t.direction === 'up') {
    tx = t.positionBlock; ty = 0; tw = t.openingSizeBlocks; th = 1;
  } else {
    tx = t.positionBlock; ty = room.heightBlocks - 1; tw = t.openingSizeBlocks; th = 1;
  }
  return tx + tw > minX && tx < maxX + 1 && ty + th > minY && ty < maxY + 1;
}
