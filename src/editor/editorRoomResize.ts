/**
 * Room-resize helpers for the editor.
 *
 * Extracted from editorController.ts so that dimension-clamping and edge-resize
 * logic lives in a focused, testable module.
 *
 * Exports:
 *   - `clampZoneToDimensions`   – clamps a rect zone to fit within room bounds.
 *   - `applyRoomDimensionChange` – sets a room dimension and clamps all elements.
 *   - `applyEdgeResize`          – adds/removes one row/column from an edge with undo support.
 */

import type { EditorRoomData } from './editorState';
import type { EditorHistory } from './editorHistory';
import { pushSnapshot } from './editorHistory';
import type { RoomEdge } from './editorUI';

/** Clamps a zone rect (with wBlock/hBlock) to fit within the given room dimensions. */
export function clampZoneToDimensions(
  z: { xBlock: number; yBlock: number; wBlock: number; hBlock: number },
  widthBlocks: number,
  heightBlocks: number,
): void {
  z.wBlock = Math.max(1, Math.min(z.wBlock, widthBlocks));
  z.hBlock = Math.max(1, Math.min(z.hBlock, heightBlocks));
  z.xBlock = Math.min(Math.max(0, z.xBlock), widthBlocks - z.wBlock);
  z.yBlock = Math.min(Math.max(0, z.yBlock), heightBlocks - z.hBlock);
}

/**
 * Sets the given room dimension and clamps all point/rect elements to the
 * new bounds so nothing is placed outside the room.
 *
 * Minimum room size is enforced at 10 in each axis.
 */
export function applyRoomDimensionChange(
  roomData: EditorRoomData,
  prop: 'widthBlocks' | 'heightBlocks',
  value: number,
): void {
  const room = roomData;
  const clamped = Math.max(10, value);
  if (prop === 'widthBlocks') {
    room.widthBlocks = clamped;
  } else {
    room.heightBlocks = clamped;
  }

  const maxX = room.widthBlocks - 1;
  const maxY = room.heightBlocks - 1;

  // Keep spawn and point entities inside the new room bounds.
  room.playerSpawnBlock[0] = Math.min(Math.max(0, room.playerSpawnBlock[0]), maxX);
  room.playerSpawnBlock[1] = Math.min(Math.max(0, room.playerSpawnBlock[1]), maxY);

  for (const enemy of room.enemies) {
    enemy.xBlock = Math.min(Math.max(0, enemy.xBlock), maxX);
    enemy.yBlock = Math.min(Math.max(0, enemy.yBlock), maxY);
  }

  for (const tomb of room.saveTombs) {
    tomb.xBlock = Math.min(Math.max(0, tomb.xBlock), maxX);
    tomb.yBlock = Math.min(Math.max(0, tomb.yBlock), maxY);
  }

  for (const tomb of room.skillTombs) {
    tomb.xBlock = Math.min(Math.max(0, tomb.xBlock), maxX);
    tomb.yBlock = Math.min(Math.max(0, tomb.yBlock), maxY);
  }

  for (const pile of room.dustPiles) {
    pile.xBlock = Math.min(Math.max(0, pile.xBlock), maxX);
    pile.yBlock = Math.min(Math.max(0, pile.yBlock), maxY);
  }

  for (const deco of (room.decorations ?? [])) {
    deco.xBlock = Math.min(Math.max(0, deco.xBlock), maxX);
    deco.yBlock = Math.min(Math.max(0, deco.yBlock), maxY);
  }

  for (const light of (room.lightSources ?? [])) {
    light.xBlock = Math.min(Math.max(0, light.xBlock), maxX);
    light.yBlock = Math.min(Math.max(0, light.yBlock), maxY);
  }

  for (const z of (room.waterZones ?? [])) {
    clampZoneToDimensions(z, room.widthBlocks, room.heightBlocks);
  }

  for (const z of (room.lavaZones ?? [])) {
    clampZoneToDimensions(z, room.widthBlocks, room.heightBlocks);
  }

  for (const b of (room.crumbleBlocks ?? [])) {
    clampZoneToDimensions(b, room.widthBlocks, room.heightBlocks);
  }

  for (const b of (room.bouncePads ?? [])) {
    clampZoneToDimensions(b, room.widthBlocks, room.heightBlocks);
  }

  // Clamp interior wall rectangles so they stay fully inside the room.
  for (const wall of room.interiorWalls) {
    wall.wBlock = Math.max(1, Math.min(wall.wBlock, room.widthBlocks));
    wall.hBlock = Math.max(1, Math.min(wall.hBlock, room.heightBlocks));
    wall.xBlock = Math.min(Math.max(0, wall.xBlock), room.widthBlocks - wall.wBlock);
    wall.yBlock = Math.min(Math.max(0, wall.yBlock), room.heightBlocks - wall.hBlock);
  }

  // Keep transitions valid for the updated room dimensions.
  for (const trans of room.transitions) {
    if (trans.direction === 'left' || trans.direction === 'right') {
      const maxOpening = Math.max(1, room.heightBlocks - 2);
      trans.openingSizeBlocks = Math.min(Math.max(1, trans.openingSizeBlocks), maxOpening);
      trans.positionBlock = Math.min(
        Math.max(1, trans.positionBlock),
        room.heightBlocks - 1 - trans.openingSizeBlocks,
      );
      if (trans.depthBlock !== undefined) {
        trans.depthBlock = Math.min(Math.max(0, trans.depthBlock), room.widthBlocks - 6);
      }
    } else {
      const maxOpening = Math.max(1, room.widthBlocks - 2);
      trans.openingSizeBlocks = Math.min(Math.max(1, trans.openingSizeBlocks), maxOpening);
      trans.positionBlock = Math.min(
        Math.max(1, trans.positionBlock),
        room.widthBlocks - 1 - trans.openingSizeBlocks,
      );
      if (trans.depthBlock !== undefined) {
        trans.depthBlock = Math.min(Math.max(0, trans.depthBlock), room.heightBlocks - 6);
      }
    }
  }
}

/**
 * Adds or removes one row/column from the given edge.
 *
 * Adding to top/left shifts all content. Adding to bottom/right just extends.
 * Removing from top/left shifts content the other direction.
 * Minimum room size is 10×10.
 *
 * Pushes an undo snapshot before making any changes.
 */
export function applyEdgeResize(
  roomData: EditorRoomData,
  history: EditorHistory,
  edge: RoomEdge,
  delta: 1 | -1,
): void {
  pushSnapshot(history, roomData);
  const room = roomData;

  const isHorizontal = edge === 'left' || edge === 'right';
  const prop = isHorizontal ? 'widthBlocks' : 'heightBlocks';
  const currentSize = room[prop];
  const newSize = currentSize + delta;

  // Enforce minimum room size of 10
  if (newSize < 10) return;

  room[prop] = newSize;

  // When adding/removing from top or left, we need to shift all content
  const needsShift = edge === 'top' || edge === 'left';
  if (needsShift) {
    const shiftX = edge === 'left' ? delta : 0;
    const shiftY = edge === 'top' ? delta : 0;

    // Shift player spawn
    room.playerSpawnBlock[0] += shiftX;
    room.playerSpawnBlock[1] += shiftY;

    // Shift enemies
    for (const enemy of room.enemies) {
      enemy.xBlock += shiftX;
      enemy.yBlock += shiftY;
    }

    // Shift save tombs
    for (const tomb of room.saveTombs) {
      tomb.xBlock += shiftX;
      tomb.yBlock += shiftY;
    }

    // Shift skill tombs
    for (const tomb of room.skillTombs) {
      tomb.xBlock += shiftX;
      tomb.yBlock += shiftY;
    }

    // Shift dust piles
    for (const pile of room.dustPiles) {
      pile.xBlock += shiftX;
      pile.yBlock += shiftY;
    }

    // Shift decorations
    for (const deco of (room.decorations ?? [])) {
      deco.xBlock += shiftX;
      deco.yBlock += shiftY;
    }

    // Shift light sources
    for (const light of (room.lightSources ?? [])) {
      light.xBlock += shiftX;
      light.yBlock += shiftY;
    }

    // Shift water zones
    for (const z of (room.waterZones ?? [])) {
      z.xBlock += shiftX;
      z.yBlock += shiftY;
    }

    // Shift lava zones
    for (const z of (room.lavaZones ?? [])) {
      z.xBlock += shiftX;
      z.yBlock += shiftY;
    }

    // Shift crumble blocks
    for (const b of (room.crumbleBlocks ?? [])) {
      b.xBlock += shiftX;
      b.yBlock += shiftY;
    }

    // Shift bounce pads
    for (const b of (room.bouncePads ?? [])) {
      b.xBlock += shiftX;
      b.yBlock += shiftY;
    }

    // Shift interior walls
    for (const wall of room.interiorWalls) {
      wall.xBlock += shiftX;
      wall.yBlock += shiftY;
    }

    // Shift transitions along the shifted axis
    for (const trans of room.transitions) {
      if (edge === 'top' && (trans.direction === 'left' || trans.direction === 'right')) {
        trans.positionBlock += shiftY;
      }
      if (edge === 'left' && (trans.direction === 'up' || trans.direction === 'down')) {
        trans.positionBlock += shiftX;
      }
    }
  }

  // Re-clamp everything to new bounds
  applyRoomDimensionChange(room, prop, newSize);
}
