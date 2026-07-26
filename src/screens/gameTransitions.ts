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
import { isRoomFileCacheActive, loadRoomForGameplayAsync, getActiveRoomAdjacency } from '../levels/roomFileLoader';
import { getTransitionXYBlock, normalizedGradientWidthBlocks } from '../levels/transitionGeometry';
import type { WorldState } from '../sim/world';

export const TRANSITION_SPAWN_INSET_BLOCKS = 3;

/**
 * Rooms with an urgent async load currently in-flight due to a missing-room
 * transition.  Prevents the per-frame console.warn from firing on every tick
 * while the load is pending.  The entry is cleared when the load resolves
 * (success or failure).
 */
const _urgentLoadPending = new Set<string>();

export function getOppositeTransitionDirection(direction: TransitionDirection): TransitionDirection {
  if (direction === 'left') return 'right';
  if (direction === 'right') return 'left';
  if (direction === 'up') return 'down';
  return 'up';
}

export function computeSpawnBlockForTransition(
  room: RoomDef,
  transition: RoomTransitionDef,
  // Player's offset (0..1) along the opening at the moment they crossed the
  // source transition, so the destination spawn preserves relative position
  // instead of always centering in the opening.
  entryOffsetFraction = 0.5,
): readonly [number, number] {
  const { xBlock, yBlock } = getTransitionXYBlock(transition, room);
  const gw = normalizedGradientWidthBlocks(transition);
  const clampedFraction = Math.min(1, Math.max(0, entryOffsetFraction));
  // Keep a 1-block margin from each edge of the opening: the outermost blocks
  // of a door frame are sometimes occupied by wall/pillar geometry even
  // though they fall within the nominal opening range, so spawning exactly at
  // the edge (fraction 0 or 1) can land the player inside a solid wall.
  const edgeMargin = transition.openingSizeBlocks >= 3 ? 1 : 0;
  const maxOffset = Math.max(0, transition.openingSizeBlocks - 1 - 2 * edgeMargin);
  const openingOffset = edgeMargin + Math.round(clampedFraction * maxOffset);
  const openingPosHoriz = yBlock + openingOffset;
  const openingPosVert  = xBlock + openingOffset;

  // Arrival spawn coordinate sits just past the destination transition's own
  // inner/near edge — i.e. relative to the transition's actual placed
  // geometry, not the room's outer boundary. This matches ordinary boundary
  // transitions (xBlock/yBlock at 0 or roomSize - gw) by construction, but
  // also works correctly for interior transitions placed away from a wall.
  if (transition.direction === 'left') {
    return [xBlock + gw, openingPosHoriz] as const;
  }
  if (transition.direction === 'right') {
    return [xBlock - 1, openingPosHoriz] as const;
  }
  if (transition.direction === 'up') {
    return [openingPosVert, yBlock + gw] as const;
  }
  return [openingPosVert, yBlock - 1] as const;
}

/**
 * Checks all transitions in `currentRoom` to see if the player has entered
 * a transition zone.  The trigger fires when the player crosses 0.5 blocks past
 * the NEAR (inner) edge of the zone strip:
 *   right → player x passes 0.5 blocks past zone left edge
 *   left  → player x passes 0.5 blocks before zone right edge
 *   down  → player bottom y passes 0.5 blocks below zone top edge
 *   up    → player y passes 0.5 blocks above zone bottom edge
 *
 * DESIGN (BUILD 420+): Boundary walls are fully solid, so the player cannot
 * physically reach the far side of a zone.  The trigger fires on entry so
 * transitions start before the boundary wall stops movement.
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
  onLoadRoom: (room: RoomDef, spawnX: number, spawnY: number, transitionDirection: TransitionDirection, transitionIndex: number) => void,
  playerOffsetXWorld = 0,
  playerOffsetYWorld = 0,
): boolean {
  const player = world.clusters[0];
  if (player === undefined || player.isAliveFlag === 0) return false;

  // Adjust to room-local coordinates when the active room is offset in world space.
  const px = player.positionXWorld - playerOffsetXWorld;
  const py = player.positionYWorld - playerOffsetYWorld;
  const BS = BLOCK_SIZE_MEDIUM;

  // Estimate previous-tick player position from current velocity.
  // Used for swept-entry detection so fast grapple/zip movement cannot skip
  // a trigger strip in a single frame even when ClusterState has no stored
  // previous-position field.
  const prevPx = px - player.velocityXWorld;
  const prevPy = py - player.velocityYWorld;

  for (let ti = 0; ti < currentRoom.transitions.length; ti++) {
    const t = currentRoom.transitions[ti];
    const { xBlock, yBlock } = getTransitionXYBlock(t, currentRoom);
    const gw = normalizedGradientWidthBlocks(t);
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

    // Trigger edge check: player must be past the near side of the zone.
    //
    // DESIGN (BUILD 420+): Boundary walls are now fully solid — the player can
    // no longer physically reach the far side of a transition zone.  We trigger
    // when the player has moved 0.5 blocks PAST THE NEAR EDGE of the zone
    // (i.e. just entered the strip), so the transition fires before the player
    // is stopped by the boundary wall.
    //
    // Swept-entry guard: also fires if the player was approaching the threshold
    // and their previous-tick position (estimated from velocity) was before it.
    // This prevents fast grapple/zip movement from skipping the strip in a
    // single frame when the player teleports from outside the zone to inside it.
    const TRIGGER_ENTRY_THRESHOLD_BLOCKS = 0.5;
    const isTriggered = (() => {
      if (t.direction === 'right') {
        // Zone is near the right wall.  Player enters from the left (near) side.
        const threshX = zoneLeft + BS * TRIGGER_ENTRY_THRESHOLD_BLOCKS;
        return px >= threshX
          || (player.velocityXWorld > 0 && prevPx < threshX);
      }
      if (t.direction === 'left') {
        // Zone is near the left wall.  Player enters from the right (near) side.
        const threshX = zoneRight - BS * TRIGGER_ENTRY_THRESHOLD_BLOCKS;
        return px <= threshX
          || (player.velocityXWorld < 0 && prevPx > threshX);
      }
      if (t.direction === 'down') {
        // Zone is near the bottom wall.  Player enters from the top (near) side.
        // Use the player's bottom edge so the trigger fires when feet cross.
        const playerBottom = py + player.halfHeightWorld;
        const prevPlayerBottom = prevPy + player.halfHeightWorld;
        const threshY = zoneTop + BS * TRIGGER_ENTRY_THRESHOLD_BLOCKS;
        return playerBottom >= threshY
          || (player.velocityYWorld > 0 && prevPlayerBottom < threshY);
      }
      // 'up': zone is near the top wall.  Player enters from the bottom (near) side.
      const threshY = zoneBottom - BS * TRIGGER_ENTRY_THRESHOLD_BLOCKS;
      return py <= threshY
        || (player.velocityYWorld < 0 && prevPy > threshY);
    })();

    if (isTriggered) {
      const targetRoom = ROOM_REGISTRY.get(t.targetRoomId);
      if (targetRoom !== undefined) {
        const oppositeDirection = getOppositeTransitionDirection(t.direction);
        const targetReturnTransition = targetRoom.transitions.find((targetTransition) =>
          targetTransition.targetRoomId === currentRoom.id
          && targetTransition.direction === oppositeDirection,
        );

        if (targetReturnTransition !== undefined) {
          // Preserve the player's relative position along the opening: compute
          // how far across the source transition's opening they are (0 = near
          // edge, 1 = far edge) and carry that fraction over to the
          // destination opening instead of always spawning at its center.
          const openingStartBlock = isHoriz ? yBlock : xBlock;
          const playerPerpBlock = (isHoriz ? py : px) / BS;
          const maxSourceOffset = Math.max(1, t.openingSizeBlocks - 1);
          const entryOffsetFraction = (playerPerpBlock - openingStartBlock) / maxSourceOffset;
          const spawnBlock = computeSpawnBlockForTransition(targetRoom, targetReturnTransition, entryOffsetFraction);
          onLoadRoom(targetRoom, spawnBlock[0], spawnBlock[1], t.direction, ti);
        } else {
          console.warn(`[Transition] Room "${currentRoom.id}" transition[${ti}] → "${t.targetRoomId}" has no matching return transition (direction=${t.direction}). Falling back to targetSpawnBlock.`);
          onLoadRoom(targetRoom, t.targetSpawnBlock[0], t.targetSpawnBlock[1], t.direction, ti);
        }
        return true;
      } else {
        // Room is not in ROOM_REGISTRY.
        if (isRoomFileCacheActive()) {
          // Lazy-loading mode (Electron file cache): the preload scheduler
          // should have loaded this room already.  If it hasn't (e.g. the
          // player moved faster than the scheduler), trigger an urgent load.
          // We deduplicate so the warn and IPC call fire only once per load,
          // not on every frame that the player stands in the trigger zone.
          // The transition will re-fire on the next game tick once the room
          // is registered in ROOM_REGISTRY.
          if (!_urgentLoadPending.has(t.targetRoomId)) {
            _urgentLoadPending.add(t.targetRoomId);
            const adjacency = getActiveRoomAdjacency();
            const isInManifest = adjacency !== null
              ? Object.prototype.hasOwnProperty.call(adjacency, t.targetRoomId)
              : null;
            console.warn(
              `[Transition] Room "${t.targetRoomId}" not yet loaded — ` +
              'triggering urgent lazy load. Transition will fire once loaded.',
              `\n  currentRoom=${currentRoom.id}, transitionIndex=${ti}`,
              `\n  isRoomFileCacheActive=true`,
              `\n  inManifestAdjacency=${isInManifest === null ? 'unknown (no adjacency data)' : isInManifest}`,
            );
            void loadRoomForGameplayAsync(t.targetRoomId).then(loaded => {
              _urgentLoadPending.delete(t.targetRoomId);
              if (loaded === undefined) {
                console.error(
                  `[Transition] Urgent load of "${t.targetRoomId}" FAILED.`,
                  `\n  currentRoom=${currentRoom.id}, transitionIndex=${ti}`,
                  `\n  isRoomFileCacheActive=${isRoomFileCacheActive()}`,
                  `\n  inManifestAdjacency=${isInManifest === null ? 'unknown' : isInManifest}`,
                  '\n  Possible causes: room not in manifest, IPC read error, hash mismatch, or hydration failure.',
                );
              } else {
                console.log(`[Transition] Urgent load of "${t.targetRoomId}" succeeded — transition will fire on next tick.`);
              }
            });
          }
        } else {
          // Packed-campaign / browser mode: all rooms should be loaded at
          // startup.  A missing room indicates a broken transition link or
          // a startup bug (e.g. the official campaign cache was deactivated
          // before the player pressed Play — see game.ts navigate('mainMenu')).
          console.warn(`[Transition] Room "${currentRoom.id}" transition[${ti}] points to missing room "${t.targetRoomId}".`);
        }
      }
    }
  }
  return false;
}
