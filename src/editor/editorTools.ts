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

  // Check skill tombs
  for (const s of room.skillTombs) {
    if (hitTestPoint(s.xBlock, s.yBlock, bx, by)) {
      return { type: 'skillTomb', uid: s.uid };
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

  if (item.category === 'blocks') {
    const wBlock = getPlacementWidth(item, state.placementRotationSteps);
    const hBlock = getPlacementHeight(item, state.placementRotationSteps);
    room.interiorWalls.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
      wBlock,
      hBlock,
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

    room.transitions.push({
      uid: allocateUid(state),
      direction,
      positionBlock: by,
      openingSizeBlocks: 5,
      targetRoomId: '',
      targetSpawnBlock: [3, by + 2],
    });
  } else if (item.id === 'skill_tomb') {
    room.skillTombs.push({
      uid: allocateUid(state),
      xBlock: bx,
      yBlock: by,
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
      room.transitions.splice(i, 1);
      if (state.selectedElement?.uid === room.transitions[i]?.uid) state.selectedElement = null;
      return;
    }
  }

  // Check enemies
  for (let i = 0; i < room.enemies.length; i++) {
    if (hitTestPoint(room.enemies[i].xBlock, room.enemies[i].yBlock, bx, by)) {
      room.enemies.splice(i, 1);
      state.selectedElement = null;
      return;
    }
  }

  // Check skill tombs
  for (let i = 0; i < room.skillTombs.length; i++) {
    if (hitTestPoint(room.skillTombs[i].xBlock, room.skillTombs[i].yBlock, bx, by)) {
      room.skillTombs.splice(i, 1);
      state.selectedElement = null;
      return;
    }
  }

  // Check walls
  for (let i = 0; i < room.interiorWalls.length; i++) {
    if (hitTestWall(room.interiorWalls[i], bx, by)) {
      room.interiorWalls.splice(i, 1);
      state.selectedElement = null;
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
  if (state.selectedElement === null || state.roomData === null) return;
  if (state.selectedElement.type === 'wall') {
    const wall = state.roomData.interiorWalls.find(w => w.uid === state.selectedElement!.uid);
    if (wall) {
      const tmp = wall.wBlock;
      wall.wBlock = wall.hBlock;
      wall.hBlock = tmp;
    }
  }
}
