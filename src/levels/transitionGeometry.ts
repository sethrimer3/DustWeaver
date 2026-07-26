/**
 * Shared pure transition-geometry helpers.
 *
 * A single source of truth for interpreting a RoomTransitionDef's
 * xBlock/yBlock/gradientWidthBlocks (with legacy positionBlock/depthBlock
 * fallback) so gameplay (gameTransitions.ts) and the visual-map editor
 * (editorVisualMapHelpers.ts) cannot develop diverging interpretations of
 * where a transition's active/directional edge actually sits.
 */

import type { RoomTransitionDef, TransitionDirection } from './roomDef';

/** Minimal room-shape contract needed to resolve legacy xBlock/yBlock fallback. */
export interface TransitionGeometryRoom {
  readonly widthBlocks: number;
  readonly heightBlocks: number;
}

/**
 * Normalizes a transition's saved depth field: an explicitly-present value
 * <= 0 is invalid and clamps to 2; a fully omitted field keeps the legacy
 * fallback of 3.
 */
export function normalizedGradientWidthBlocks(t: RoomTransitionDef): number {
  const gw = t.gradientWidthBlocks;
  if (gw === undefined) return 3;
  return gw <= 0 ? 2 : gw;
}

/**
 * Returns the runtime xBlock/yBlock for a transition, migrating from legacy
 * positionBlock/depthBlock if the new fields are not yet present.
 */
export function getTransitionXYBlock(
  t: RoomTransitionDef,
  room: TransitionGeometryRoom,
): { xBlock: number; yBlock: number } {
  if (t.xBlock !== undefined && t.yBlock !== undefined) {
    return { xBlock: t.xBlock, yBlock: t.yBlock };
  }
  const gw = normalizedGradientWidthBlocks(t);
  switch (t.direction) {
    case 'left':  return { xBlock: t.depthBlock ?? 0, yBlock: t.positionBlock };
    case 'right': return { xBlock: t.depthBlock ?? (room.widthBlocks  - gw), yBlock: t.positionBlock };
    case 'up':    return { xBlock: t.positionBlock, yBlock: t.depthBlock ?? 0 };
    case 'down':  return { xBlock: t.positionBlock, yBlock: t.depthBlock ?? (room.heightBlocks - gw) };
  }
}

/**
 * Returns the block coordinate of the transition's active/directional edge —
 * the side the player actually emerges from — in the axis the direction
 * faces. This is the transition's real placed geometry, not the containing
 * room's outer boundary, so it is correct for both ordinary boundary
 * transitions and transitions placed away from a wall (interior transitions).
 */
export function getTransitionActiveEdgeBlock(
  t: RoomTransitionDef,
  room: TransitionGeometryRoom,
): number {
  const { xBlock, yBlock } = getTransitionXYBlock(t, room);
  const gw = normalizedGradientWidthBlocks(t);
  switch (t.direction) {
    case 'left':  return xBlock;
    case 'right': return xBlock + gw;
    case 'up':    return yBlock;
    case 'down':  return yBlock + gw;
  }
}

/** True for the two horizontally-facing transition directions. */
export function isHorizontalTransitionDirection(direction: TransitionDirection): boolean {
  return direction === 'left' || direction === 'right';
}

/**
 * True when the transition's active edge lies exactly on its containing
 * room's outer perimeter — i.e. it is an ordinary boundary transition rather
 * than one placed away from a wall (interior transition).
 */
export function isBoundaryTransition(
  t: RoomTransitionDef,
  room: TransitionGeometryRoom,
): boolean {
  const { xBlock, yBlock } = getTransitionXYBlock(t, room);
  switch (t.direction) {
    case 'left':  return xBlock === 0;
    case 'right': return xBlock + normalizedGradientWidthBlocks(t) === room.widthBlocks;
    case 'up':    return yBlock === 0;
    case 'down':  return yBlock + normalizedGradientWidthBlocks(t) === room.heightBlocks;
  }
}
