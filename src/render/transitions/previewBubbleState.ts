/**
 * LEGACY: previewBubbleState.ts — Computation of nearby-transition preview bubble state.
 *
 * NOT imported by active gameplay. Retained for historical/reference purposes.
 * See src/render/transitions/legacy/README.md for re-enablement instructions.
 *
 * previewBubbleState.ts — Computation of nearby-transition preview bubble state.
 *
 * When the player is within `PREVIEW_START_DISTANCE_WORLD` world units of a
 * room transition edge, a glowing "preview bubble" is drawn at the transition
 * opening.  The bubble grows and brightens as the player approaches, giving a
 * soft visual cue that a passage is near.
 *
 * This module computes the per-bubble state each frame; the actual drawing is
 * handled by previewBubbleRenderer.ts.
 *
 * NOTE: The current implementation renders a coloured radial-gradient glow at
 * the transition centre — it does NOT show actual tiles from the connected room.
 * Full connected-room tile preview requires rendering an offscreen snapshot of
 * the adjacent room; that work is tracked in nextSteps.md.
 */

import type { RoomDef } from '../../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import {
  PREVIEW_START_DISTANCE_WORLD,
  PREVIEW_MIN_RADIUS_PX,
  PREVIEW_MAX_RADIUS_PX,
  PREVIEW_MIN_OPACITY,
  PREVIEW_MAX_OPACITY,
  PREVIEW_MAX_BUBBLES,
} from './transitionConfig';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Screen-space state for a single preview bubble this frame. */
export interface PreviewBubbleState {
  /** Screen X of the bubble centre (virtual pixels). */
  centerXPx: number;
  /** Screen Y of the bubble centre (virtual pixels). */
  centerYPx: number;
  /** Bubble radius (virtual pixels), grows as player approaches. */
  radiusPx: number;
  /** Glow opacity (0–1), grows as player approaches. */
  opacity: number;
  /** Which transition in room.transitions this bubble represents. */
  transitionIndex: number;
}

// ── Easing helper ─────────────────────────────────────────────────────────────

/** Smooth-step easing for a perceptually pleasant fade/grow. */
function _smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// ── Lerp helper ───────────────────────────────────────────────────────────────

function _lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── Distance-from-transition-edge helper ──────────────────────────────────────

/**
 * Returns the world-space distance from the player to the nearest point on
 * the transition's trigger edge.  Returns Infinity if the player is not
 * roughly aligned with the transition opening.
 *
 * Uses a simplified AABB approach:
 * - For left/right transitions: horizontal distance from the room edge col,
 *   provided the player is within the vertical span of the opening.
 * - For up/down transitions:   vertical distance from the room edge row,
 *   provided the player is within the horizontal span of the opening.
 */
function _distanceToTransitionEdge(
  playerXWorld: number,
  playerYWorld: number,
  t: RoomDef['transitions'][number],
  roomWidthBlocks: number,
  roomHeightBlocks: number,
): number {
  const BS = BLOCK_SIZE_SMALL;
  const isHoriz = t.direction === 'left' || t.direction === 'right';

  if (isHoriz) {
    // Opening spans [yBlock, yBlock + openingSizeBlocks) in block units
    const openTopWorld    = t.yBlock * BS;
    const openBottomWorld = (t.yBlock + t.openingSizeBlocks) * BS;
    // Player must overlap the opening vertically (with small tolerance)
    const tolerance = BS * 3;
    if (playerYWorld < openTopWorld - tolerance || playerYWorld > openBottomWorld + tolerance) {
      return Infinity;
    }
    if (t.direction === 'left') {
      // Edge is at x=0; player approaches from the right
      return playerXWorld;
    } else {
      // Edge is at x=roomWidth; player approaches from the left
      return roomWidthBlocks * BS - playerXWorld;
    }
  } else {
    // Opening spans [xBlock, xBlock + openingSizeBlocks) in block units
    const openLeftWorld  = t.xBlock * BS;
    const openRightWorld = (t.xBlock + t.openingSizeBlocks) * BS;
    const tolerance = BS * 3;
    if (playerXWorld < openLeftWorld - tolerance || playerXWorld > openRightWorld + tolerance) {
      return Infinity;
    }
    if (t.direction === 'up') {
      return playerYWorld;
    } else {
      return roomHeightBlocks * BS - playerYWorld;
    }
  }
}

/**
 * Returns the screen-space centre of a transition opening.
 */
function _transitionCenterScreen(
  t: RoomDef['transitions'][number],
  roomWidthBlocks: number,
  roomHeightBlocks: number,
  ox: number,
  oy: number,
  zoom: number,
): { cx: number; cy: number } {
  const BS = BLOCK_SIZE_SMALL;
  let worldCX: number;
  let worldCY: number;

  const isHoriz = t.direction === 'left' || t.direction === 'right';
  if (isHoriz) {
    // Centre horizontally at the edge column edge, vertically at opening mid
    worldCX = t.direction === 'left' ? 0 : roomWidthBlocks * BS;
    worldCY = (t.yBlock + t.openingSizeBlocks * 0.5) * BS;
  } else {
    worldCX = (t.xBlock + t.openingSizeBlocks * 0.5) * BS;
    worldCY = t.direction === 'up' ? 0 : roomHeightBlocks * BS;
  }

  return {
    cx: worldCX * zoom + ox,
    cy: worldCY * zoom + oy,
  };
}

// ── Pre-allocated candidates buffer ─────────────────────────────────────────
// Reused across frames to avoid per-frame allocation in the hot path.
// Sized to accommodate the maximum plausible number of transitions per room.
const MAX_TRANSITIONS_PER_ROOM = 16;
type _Candidate = { index: number; dist: number };
const _candidateBuffer: _Candidate[] = [];
for (let _i = 0; _i < MAX_TRANSITIONS_PER_ROOM; _i++) {
  _candidateBuffer.push({ index: 0, dist: 0 });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute the preview bubble state for all nearby transitions in `room`.
 *
 * Bubbles are sorted nearest-first and capped at `PREVIEW_MAX_BUBBLES`.
 * Results are written into `out` (resized as needed) and the count returned.
 *
 * @param playerXWorld  Player world X position.
 * @param playerYWorld  Player world Y position.
 * @param room          Current room definition.
 * @param ox            Camera X offset (world → screen).
 * @param oy            Camera Y offset (world → screen).
 * @param zoom          Camera zoom factor.
 * @param out           Output array (modified in place).
 * @returns             Number of active bubbles written to `out`.
 */
export function computePreviewBubbles(
  playerXWorld: number,
  playerYWorld: number,
  room: RoomDef,
  ox: number,
  oy: number,
  zoom: number,
  out: PreviewBubbleState[],
): number {
  const transitions = room.transitions;

  // Collect nearby-transition candidates into pre-allocated buffer.
  let candidateCount = 0;

  for (let i = 0; i < transitions.length; i++) {
    const dist = _distanceToTransitionEdge(
      playerXWorld,
      playerYWorld,
      transitions[i],
      room.widthBlocks,
      room.heightBlocks,
    );
    if (dist < PREVIEW_START_DISTANCE_WORLD && candidateCount < MAX_TRANSITIONS_PER_ROOM) {
      _candidateBuffer[candidateCount].index = i;
      _candidateBuffer[candidateCount].dist  = dist;
      candidateCount++;
    }
  }

  // Sort nearest-first using insertion sort (tiny count, O(n²) is fine here)
  for (let i = 1; i < candidateCount; i++) {
    const keyIdx  = _candidateBuffer[i].index;
    const keyDist = _candidateBuffer[i].dist;
    let j = i - 1;
    while (j >= 0 && _candidateBuffer[j].dist > keyDist) {
      _candidateBuffer[j + 1].index = _candidateBuffer[j].index;
      _candidateBuffer[j + 1].dist  = _candidateBuffer[j].dist;
      j--;
    }
    _candidateBuffer[j + 1].index = keyIdx;
    _candidateBuffer[j + 1].dist  = keyDist;
  }

  const count = Math.min(candidateCount, PREVIEW_MAX_BUBBLES);

  // Ensure output array is long enough
  while (out.length < count) {
    out.push({ centerXPx: 0, centerYPx: 0, radiusPx: 0, opacity: 0, transitionIndex: -1 });
  }

  for (let i = 0; i < count; i++) {
    const cand = _candidateBuffer[i];
    const t = transitions[cand.index];

    // rawT = 0 at the start distance, 1 at the edge
    const rawT = Math.max(0, Math.min(1, 1 - cand.dist / PREVIEW_START_DISTANCE_WORLD));
    const eased = _smoothstep(rawT);

    const radiusPx = _lerp(PREVIEW_MIN_RADIUS_PX, PREVIEW_MAX_RADIUS_PX, eased);
    const opacity  = _lerp(PREVIEW_MIN_OPACITY,  PREVIEW_MAX_OPACITY,  eased);

    const { cx, cy } = _transitionCenterScreen(
      t, room.widthBlocks, room.heightBlocks, ox, oy, zoom,
    );

    out[i].centerXPx       = cx;
    out[i].centerYPx       = cy;
    out[i].radiusPx        = radiusPx;
    out[i].opacity         = opacity;
    out[i].transitionIndex = cand.index;
  }

  return count;
}
