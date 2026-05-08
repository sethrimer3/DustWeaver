/**
 * Room-transition helpers extracted from gameScreen.ts.
 *
 * Pure utility functions for computing spawn positions at transition edges
 * and detecting when the player has entered a transition zone, delegating
 * the actual room load to a caller-supplied callback.
 */

import type { RoomDef, RoomTransitionDef, TransitionDirection } from '../levels/roomDef';
export type { TransitionDirection };
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { ROOM_REGISTRY } from '../levels/rooms';
import type { WorldState } from '../sim/world';

export const TRANSITION_SPAWN_INSET_BLOCKS = 3;

export function getOppositeTransitionDirection(direction: TransitionDirection): TransitionDirection {
  if (direction === 'left') return 'right';
  if (direction === 'right') return 'left';
  if (direction === 'up') return 'down';
  return 'up';
}

/**
 * Returns the runtime xBlock/yBlock for a transition, migrating from legacy
 * positionBlock/depthBlock if the new fields are not yet present.
 */
function getTransitionXYBlock(t: RoomTransitionDef, room: RoomDef): { xBlock: number; yBlock: number } {
  if (t.xBlock !== undefined && t.yBlock !== undefined) {
    return { xBlock: t.xBlock, yBlock: t.yBlock };
  }
  const gw = t.gradientWidthBlocks ?? 3;
  switch (t.direction) {
    case 'left':  return { xBlock: t.depthBlock ?? 0, yBlock: t.positionBlock };
    case 'right': return { xBlock: t.depthBlock ?? (room.widthBlocks  - gw), yBlock: t.positionBlock };
    case 'up':    return { xBlock: t.positionBlock, yBlock: t.depthBlock ?? 0 };
    case 'down':  return { xBlock: t.positionBlock, yBlock: t.depthBlock ?? (room.heightBlocks - gw) };
  }
}

export function computeSpawnBlockForTransition(
  room: RoomDef,
  transition: RoomTransitionDef,
): readonly [number, number] {
  const { xBlock, yBlock } = getTransitionXYBlock(transition, room);
  // Opening center: for left/right = yBlock + half opening; for up/down = xBlock + half opening
  const openingCenterHoriz = yBlock + Math.floor(transition.openingSizeBlocks / 2);
  const openingCenterVert  = xBlock + Math.floor(transition.openingSizeBlocks / 2);

  if (transition.direction === 'left') {
    return [TRANSITION_SPAWN_INSET_BLOCKS, openingCenterHoriz] as const;
  }
  if (transition.direction === 'right') {
    return [room.widthBlocks - TRANSITION_SPAWN_INSET_BLOCKS - 1, openingCenterHoriz] as const;
  }
  if (transition.direction === 'up') {
    return [openingCenterVert, TRANSITION_SPAWN_INSET_BLOCKS] as const;
  }
  return [openingCenterVert, room.heightBlocks - TRANSITION_SPAWN_INSET_BLOCKS - 1] as const;
}

/**
 * Checks all transitions in `currentRoom` to see if the player has entered
 * a transition zone.  The trigger is crossing the trigger edge:
 *   right → player x crosses zone right edge
 *   left  → player x crosses zone left edge
 *   down  → player y crosses zone bottom edge
 *   up    → player y crosses zone top edge
 *
 * When a match is found, calls `onLoadRoom` with the target room and computed
 * spawn coordinates and returns `true`.  Returns `false` when no transition
 * was triggered this frame.
 */
export function checkRoomTransitions(
  world: WorldState,
  currentRoom: RoomDef,
  _roomWidthWorld: number,
  _roomHeightWorld: number,
  onLoadRoom: (room: RoomDef, spawnX: number, spawnY: number, transitionDirection: TransitionDirection) => void,
): boolean {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return false;

  const px = player.positionXWorld;
  const py = player.positionYWorld;
  const BS = BLOCK_SIZE_MEDIUM;

  for (let ti = 0; ti < currentRoom.transitions.length; ti++) {
    const t = currentRoom.transitions[ti];
    const { xBlock, yBlock } = getTransitionXYBlock(t, currentRoom);
    const gw = t.gradientWidthBlocks ?? 3;
    const isHoriz = t.direction === 'left' || t.direction === 'right';
    const zoneW = isHoriz ? gw : t.openingSizeBlocks;
    const zoneH = isHoriz ? t.openingSizeBlocks : gw;

    // Zone bounds in world coordinates
    const zoneLeft   = xBlock * BS;
    const zoneRight  = (xBlock + zoneW) * BS;
    const zoneTop    = yBlock * BS;
    const zoneBottom = (yBlock + zoneH) * BS;

    // Player must be inside the zone
    if (px < zoneLeft || px > zoneRight || py < zoneTop || py > zoneBottom) continue;

    // Trigger edge check: player must be past the trigger edge.
    // TRIGGER_EDGE_THRESHOLD_BLOCKS: how close to the trigger edge before the transition fires.
    const TRIGGER_EDGE_THRESHOLD_BLOCKS = 0.5;
    let isTriggered = false;
    if (t.direction === 'right') {
      isTriggered = px >= zoneRight - BS * TRIGGER_EDGE_THRESHOLD_BLOCKS;
    } else if (t.direction === 'left') {
      isTriggered = px <= zoneLeft + BS * TRIGGER_EDGE_THRESHOLD_BLOCKS;
    } else if (t.direction === 'down') {
      isTriggered = py >= zoneBottom - BS * TRIGGER_EDGE_THRESHOLD_BLOCKS;
    } else {
      isTriggered = py <= zoneTop + BS * TRIGGER_EDGE_THRESHOLD_BLOCKS;
    }

    if (isTriggered) {
      const targetRoom = ROOM_REGISTRY.get(t.targetRoomId);
      if (targetRoom !== undefined) {
        const oppositeDirection = getOppositeTransitionDirection(t.direction);
        const targetReturnTransition = targetRoom.transitions.find((targetTransition) =>
          targetTransition.targetRoomId === currentRoom.id
          && targetTransition.direction === oppositeDirection,
        );

        if (targetReturnTransition !== undefined) {
          const spawnBlock = computeSpawnBlockForTransition(targetRoom, targetReturnTransition);
          onLoadRoom(targetRoom, spawnBlock[0], spawnBlock[1], t.direction);
        } else {
          onLoadRoom(targetRoom, t.targetSpawnBlock[0], t.targetSpawnBlock[1], t.direction);
        }
        return true;
      }
    }
  }
  return false;
}
