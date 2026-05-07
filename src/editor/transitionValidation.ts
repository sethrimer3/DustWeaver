/**
 * Transition validation utilities — shared helpers for validating transition
 * geometry and link compatibility.
 *
 * These utilities are used by the editor (inspector, visual map, linker) to
 * enforce the valid linking rules:
 *   1. Both transitions must have the same opening width.
 *   2. The two transitions must face opposite directions.
 */

import type { TransitionDirection } from '../levels/roomDef';

// ── Zone geometry ─────────────────────────────────────────────────────────────

/**
 * Minimal transition fields needed to compute the zone rectangle.
 * Both EditorTransition and RoomTransitionDef satisfy this shape after migration.
 */
export interface TransitionZoneInput {
  direction: TransitionDirection;
  xBlock: number;
  yBlock: number;
  openingSizeBlocks: number;
  gradientWidthBlocks?: number;
}

/** Block-coordinate rectangle for a transition zone. */
export interface TransitionZoneRect {
  xBlock: number;
  yBlock: number;
  /** Width along the horizontal axis (blocks). */
  wBlock: number;
  /** Height along the vertical axis (blocks). */
  hBlock: number;
}

/** Default gradient/zone depth used when gradientWidthBlocks is not set. */
export const DEFAULT_GRADIENT_WIDTH_BLOCKS = 3;

/**
 * Returns the block-coordinate rectangle for a transition zone.
 *
 * Zone orientation:
 *   left/right → wBlock = gradientWidthBlocks, hBlock = openingSizeBlocks
 *   up/down    → wBlock = openingSizeBlocks,   hBlock = gradientWidthBlocks
 */
export function getTransitionZoneRect(t: TransitionZoneInput): TransitionZoneRect {
  const gw = t.gradientWidthBlocks ?? DEFAULT_GRADIENT_WIDTH_BLOCKS;
  if (t.direction === 'left' || t.direction === 'right') {
    return { xBlock: t.xBlock, yBlock: t.yBlock, wBlock: gw, hBlock: t.openingSizeBlocks };
  }
  return { xBlock: t.xBlock, yBlock: t.yBlock, wBlock: t.openingSizeBlocks, hBlock: gw };
}

// ── Direction utilities ───────────────────────────────────────────────────────

/** Returns the direction opposite to the given one. */
export function getOppositeTransitionDirection(direction: TransitionDirection): TransitionDirection {
  if (direction === 'left')  return 'right';
  if (direction === 'right') return 'left';
  if (direction === 'up')    return 'down';
  return 'up';
}

// ── Link validation ───────────────────────────────────────────────────────────

/** Structured result of a transition link validation. */
export type TransitionLinkResult =
  | { ok: true }
  | { ok: false; reason: 'width' | 'orientation' };

/**
 * Validates whether two transitions can be linked.
 *
 * Rules (checked in priority order):
 *   1. Width mismatch — openingSizeBlocks must be equal.
 *   2. Orientation mismatch — directions must be opposite.
 *
 * Returns `{ ok: true }` when the link is valid, otherwise
 * `{ ok: false, reason }` identifying the first failing constraint.
 */
export function validateTransitionLink(
  source: { direction: TransitionDirection; openingSizeBlocks: number },
  target: { direction: TransitionDirection; openingSizeBlocks: number },
): TransitionLinkResult {
  if (source.openingSizeBlocks !== target.openingSizeBlocks) {
    return { ok: false, reason: 'width' };
  }
  if (getOppositeTransitionDirection(source.direction) !== target.direction) {
    return { ok: false, reason: 'orientation' };
  }
  return { ok: true };
}

/** Returns a human-readable warning message for an invalid link result. */
export function transitionLinkWarningMessage(result: TransitionLinkResult): string {
  if (result.ok) return '';
  if (result.reason === 'width') {
    return '⚠ Room transition width mismatch, rooms cannot be linked.';
  }
  return '⚠ Room transition orientation mismatch, rooms cannot be linked.';
}
