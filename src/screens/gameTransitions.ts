/**
 * Room-transition helpers extracted from gameScreen.ts.
 *
 * Pure utility functions for computing spawn positions at transition edges
 * and detecting when the player has entered a transition tunnel, delegating
 * the actual room load to a caller-supplied callback.
 */

import type { RoomDef, RoomTransitionDef, TransitionDirection } from '../levels/roomDef';
export type { TransitionDirection };
import { BLOCK_SIZE_MEDIUM } from '../levels/roomDef';
import { ROOM_REGISTRY } from '../levels/rooms';
import type { WorldState } from '../sim/world';
import { TUNNEL_DETECT_MARGIN_WORLD } from './gameRoom';

export const TRANSITION_SPAWN_INSET_BLOCKS = 3;

export function getOppositeTransitionDirection(direction: TransitionDirection): TransitionDirection {
  if (direction === 'left') return 'right';
  if (direction === 'right') return 'left';
  if (direction === 'up') return 'down';
  return 'up';
}

export function computeSpawnBlockForTransition(
  room: RoomDef,
  transition: RoomTransitionDef,
): readonly [number, number] {
  const openingCenterOffsetBlocks = Math.floor(transition.openingSizeBlocks / 2);
  if (transition.direction === 'left') {
    return [
      TRANSITION_SPAWN_INSET_BLOCKS,
      transition.positionBlock + openingCenterOffsetBlocks,
    ] as const;
  }
  if (transition.direction === 'right') {
    return [
      room.widthBlocks - TRANSITION_SPAWN_INSET_BLOCKS - 1,
      transition.positionBlock + openingCenterOffsetBlocks,
    ] as const;
  }
  if (transition.direction === 'up') {
    return [
      transition.positionBlock + openingCenterOffsetBlocks,
      TRANSITION_SPAWN_INSET_BLOCKS,
    ] as const;
  }
  return [
    transition.positionBlock + openingCenterOffsetBlocks,
    room.heightBlocks - TRANSITION_SPAWN_INSET_BLOCKS - 1,
  ] as const;
}

/**
 * Checks all transitions in `currentRoom` to see if the player has entered
 * a tunnel.  When a match is found, calls `onLoadRoom` with the target room
 * and computed spawn coordinates and returns `true`.  Returns `false` when no
 * transition was triggered this frame.
 */
export function checkRoomTransitions(
  world: WorldState,
  currentRoom: RoomDef,
  roomWidthWorld: number,
  roomHeightWorld: number,
  onLoadRoom: (room: RoomDef, spawnX: number, spawnY: number, transitionDirection: TransitionDirection) => void,
): boolean {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return false;

  const px = player.positionXWorld;
  const py = player.positionYWorld;

  for (let ti = 0; ti < currentRoom.transitions.length; ti++) {
    const t = currentRoom.transitions[ti];
    const openTopWorld    = t.positionBlock * BLOCK_SIZE_MEDIUM;
    const openBottomWorld = (t.positionBlock + t.openingSizeBlocks) * BLOCK_SIZE_MEDIUM;

    let isInTunnel = false;
    if (t.depthBlock !== undefined) {
      // Interior transition: fire when the player's center enters the zone
      const FADE_DEPTH    = 6 * BLOCK_SIZE_MEDIUM;
      const zoneStartWorld = t.depthBlock * BLOCK_SIZE_MEDIUM;
      const zoneEndWorld   = zoneStartWorld + FADE_DEPTH;
      isInTunnel = px >= zoneStartWorld && px <= zoneEndWorld
        && py >= openTopWorld && py <= openBottomWorld;
      // For up/down interior transitions
      if (t.direction === 'up' || t.direction === 'down') {
        isInTunnel = py >= zoneStartWorld && py <= zoneEndWorld
          && px >= openTopWorld && px <= openBottomWorld;
      }
    } else if (t.direction === 'left') {
      isInTunnel = px < TUNNEL_DETECT_MARGIN_WORLD && py >= openTopWorld && py <= openBottomWorld;
    } else if (t.direction === 'right') {
      isInTunnel = px > roomWidthWorld - TUNNEL_DETECT_MARGIN_WORLD && py >= openTopWorld && py <= openBottomWorld;
    } else if (t.direction === 'up') {
      isInTunnel = py < TUNNEL_DETECT_MARGIN_WORLD && px >= openTopWorld && px <= openBottomWorld;
    } else if (t.direction === 'down') {
      isInTunnel = py > roomHeightWorld - TUNNEL_DETECT_MARGIN_WORLD && px >= openTopWorld && px <= openBottomWorld;
    }

    if (isInTunnel) {
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
