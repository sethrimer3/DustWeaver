/**
 * transitionCameraReveal.ts — Smooth camera offset for room-transition reveal.
 *
 * Computes a world-space offset applied to the camera (via ox/oy) to reveal
 * edge-extension tiles at room boundaries during two distinct states:
 *
 *   NearTransition:  Player is close to a room exit.  Camera eases outward to
 *                    reveal the TRANSITION_REVEAL_MAX_BLOCKS-deep extension on
 *                    the exit side, giving a visual cue of the passage ahead.
 *
 *   PostTransition:  Player just entered a new room.  Camera immediately shows
 *                    the entry-edge extension and eases back to neutral as the
 *                    player walks deeper into the room.
 *
 * The offset is stored separately from `CameraState.centerXWorld/Y` so the
 * normal follow-and-clamp logic is unaffected.  Apply it to ox/oy before
 * rendering:
 *
 *   const { revealXWorld, revealYWorld } = getTransitionRevealOffset(state);
 *   const ox = camOff.offsetXPx - revealXWorld * zoom;
 *   const oy = camOff.offsetYPx - revealYWorld * zoom;
 *
 * Positive revealXWorld shifts the camera right (shows right-edge extension).
 * Positive revealYWorld shifts the camera down (shows bottom-edge extension).
 */

import type { RoomDef, TransitionDirection } from '../../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import {
  TRANSITION_REVEAL_START_DIST_WORLD,
  TRANSITION_REVEAL_MAX_BLOCKS,
  TRANSITION_REVEAL_DECAY_DIST_WORLD,
  TRANSITION_REVEAL_EASE_SPEED,
} from './transitionConfig';

// ── State ─────────────────────────────────────────────────────────────────────

/** Mutable state for the transition reveal offset.  Pre-allocated; no GC per frame. */
export interface TransitionRevealState {
  /** Smoothed reveal X offset in world units (positive = camera pans right). */
  currentRevealXWorld: number;
  /** Smoothed reveal Y offset in world units (positive = camera pans down). */
  currentRevealYWorld: number;
  /**
   * Which edge of the current room the player most recently entered from.
   * Null when no post-transition reveal is active.
   */
  postTransitionEdge: TransitionDirection | null;
}

/** Create the initial reveal state (neutral, no reveal). */
export function createTransitionRevealState(): TransitionRevealState {
  return {
    currentRevealXWorld: 0,
    currentRevealYWorld: 0,
    postTransitionEdge: null,
  };
}

// ── API ───────────────────────────────────────────────────────────────────────

/**
 * Called once when the player crosses into a new room via a transition.
 *
 * Snaps the current reveal to maximum in the entry direction so the
 * entry-edge extension tiles are visible from the first frame in the
 * new room.  `updateTransitionReveal` will then ease the reveal back
 * to zero as the player walks away from the entry edge.
 *
 * @param entryEdge  The side of the NEW room the player entered from.
 *                   (Opposite of the crossing direction in the old room.)
 *                   e.g., crossing a 'right' exit → entryEdge = 'left'.
 */
export function notifyTransitionRoomEntered(
  state: TransitionRevealState,
  entryEdge: TransitionDirection,
): void {
  state.postTransitionEdge = entryEdge;
  const maxRevealWorld = TRANSITION_REVEAL_MAX_BLOCKS * BLOCK_SIZE_SMALL;
  // Snap to max reveal immediately so the entry edge is visible on frame 1.
  state.currentRevealXWorld =
    entryEdge === 'left'  ? -maxRevealWorld :
    entryEdge === 'right' ?  maxRevealWorld : 0;
  state.currentRevealYWorld =
    entryEdge === 'up'   ? -maxRevealWorld :
    entryEdge === 'down' ?  maxRevealWorld : 0;
}

/**
 * Called when a room is loaded outside of a normal transition
 * (initial load, death respawn, editor playtest).
 * Resets reveal to neutral immediately — no easing.
 */
export function notifyFreshRoomLoaded(state: TransitionRevealState): void {
  state.postTransitionEdge = null;
  state.currentRevealXWorld = 0;
  state.currentRevealYWorld = 0;
}

/**
 * Update the reveal offset each frame.
 *
 * Computes a target reveal offset from two sources and smoothly eases the
 * current offset toward it:
 *
 *  1. PostTransition: entry-edge reveal that decays as the player moves away.
 *  2. NearTransition: activated when approaching a room exit (only while
 *     PostTransition is not dominant, to prevent conflicting directions).
 *
 * @param state         Mutable reveal state (modified in-place).
 * @param playerXWorld  Player X in world units.
 * @param playerYWorld  Player Y in world units.
 * @param room          Current room definition.
 * @param dtSec         Frame delta time in seconds.
 */
export function updateTransitionReveal(
  state: TransitionRevealState,
  playerXWorld: number,
  playerYWorld: number,
  room: RoomDef,
  dtSec: number,
): void {
  const maxRevealWorld = TRANSITION_REVEAL_MAX_BLOCKS * BLOCK_SIZE_SMALL;
  const decayDist = TRANSITION_REVEAL_DECAY_DIST_WORLD;
  const startDist = TRANSITION_REVEAL_START_DIST_WORLD;

  let targetX = 0;
  let targetY = 0;

  // ── PostTransition reveal ──────────────────────────────────────────────────
  if (state.postTransitionEdge !== null) {
    const edge = state.postTransitionEdge;
    const roomW = room.widthBlocks * BLOCK_SIZE_SMALL;
    const roomH = room.heightBlocks * BLOCK_SIZE_SMALL;

    let distFromEdge: number;
    let revealSign: number;
    let isXAxis: boolean;

    if (edge === 'left') {
      distFromEdge = playerXWorld;
      revealSign = -1;
      isXAxis = true;
    } else if (edge === 'right') {
      distFromEdge = roomW - playerXWorld;
      revealSign = 1;
      isXAxis = true;
    } else if (edge === 'up') {
      distFromEdge = playerYWorld;
      revealSign = -1;
      isXAxis = false;
    } else { // 'down'
      distFromEdge = roomH - playerYWorld;
      revealSign = 1;
      isXAxis = false;
    }

    const t = _smoothstep(1 - Math.min(1, distFromEdge / decayDist));
    const revealAmt = maxRevealWorld * t * revealSign;
    if (isXAxis) targetX = revealAmt;
    else         targetY = revealAmt;

    // Clear post-transition state once the player is far enough from the entry edge.
    if (distFromEdge >= decayDist) {
      state.postTransitionEdge = null;
    }
  }

  // ── NearTransition reveal ──────────────────────────────────────────────────
  // Only activated when PostTransition is not dominant (avoid fighting).
  const postMagnitude = Math.abs(targetX) + Math.abs(targetY);
  if (postMagnitude < maxRevealWorld * 0.25) {
    let nearestDist = startDist;
    let nearestDir: TransitionDirection | null = null;

    for (const t of room.transitions) {
      const dist = _distToTransitionEdge(playerXWorld, playerYWorld, t, room);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestDir = t.direction;
      }
    }

    if (nearestDir !== null) {
      const rawT = 1 - nearestDist / startDist;
      const revealAmt = maxRevealWorld * _smoothstep(rawT);
      if (nearestDir === 'left')       targetX = -revealAmt;
      else if (nearestDir === 'right') targetX =  revealAmt;
      else if (nearestDir === 'up')    targetY = -revealAmt;
      else                             targetY =  revealAmt;
    }
  }

  // ── Ease toward target ─────────────────────────────────────────────────────
  const lerpT = Math.min(1.0, TRANSITION_REVEAL_EASE_SPEED * dtSec);
  state.currentRevealXWorld += (targetX - state.currentRevealXWorld) * lerpT;
  state.currentRevealYWorld += (targetY - state.currentRevealYWorld) * lerpT;
}

/**
 * Return the current smoothed reveal offset for use in computing ox/oy.
 *
 * Apply to the camera offset before rendering:
 *   ox = camOff.offsetXPx - revealXWorld * zoom;
 *   oy = camOff.offsetYPx - revealYWorld * zoom;
 */
export function getTransitionRevealOffset(
  state: TransitionRevealState,
): { revealXWorld: number; revealYWorld: number } {
  return {
    revealXWorld: state.currentRevealXWorld,
    revealYWorld: state.currentRevealYWorld,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * World-space distance from the player to the nearest point on a transition's
 * trigger edge.  Returns Infinity when the player is not aligned with the
 * opening span (with a small tolerance to handle partial alignment).
 */
function _distToTransitionEdge(
  px: number,
  py: number,
  t: RoomDef['transitions'][number],
  room: RoomDef,
): number {
  const BS = BLOCK_SIZE_SMALL;
  const tolerance = BS * 3;
  const isHoriz = t.direction === 'left' || t.direction === 'right';

  if (isHoriz) {
    const openTop    = t.yBlock * BS;
    const openBottom = (t.yBlock + t.openingSizeBlocks) * BS;
    if (py < openTop - tolerance || py > openBottom + tolerance) return Infinity;
    return t.direction === 'left' ? px : room.widthBlocks * BS - px;
  } else {
    const openLeft  = t.xBlock * BS;
    const openRight = (t.xBlock + t.openingSizeBlocks) * BS;
    if (px < openLeft - tolerance || px > openRight + tolerance) return Infinity;
    return t.direction === 'up' ? py : room.heightBlocks * BS - py;
  }
}
