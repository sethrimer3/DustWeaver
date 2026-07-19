/**
 * connectedRoomLayout.ts — Pure, Node-testable radius-1 connected-room layout.
 *
 * Given an active room and a way to resolve neighbouring RoomDefs, this module
 * produces the set of render-only adjacent-room instances that should be drawn
 * around the active room when the "Render Adjacent Rooms" setting is effective.
 *
 * Design constraints (see task brief + docs/ARCHITECTURE.md):
 *  - Radius 1 only: the active room plus its directly transition-linked rooms.
 *  - Each instance is keyed by the SOURCE transition identity, not only by
 *    target room id — two different transitions can point at the same room and
 *    may require two visual instances.
 *  - Origins are integer world units derived from the canonical block size, and
 *    reuse the pure opening-alignment math (`computeConnectedRoomOrigin` /
 *    `computeTransitionOpeningOffset`).
 *  - No mutation of shared state, no I/O, no canvas access — this is data only.
 *  - Long transitions and unrevealed secret transitions are excluded.
 *  - Self-links, missing/unloaded targets, invalid dims/openings, and malformed
 *    direction pairings are skipped safely (never throws).
 *  - When the effective setting is off the layout is empty and NO neighbour
 *    lookups are performed (zero adjacency work).
 */

import type { RoomTransitionDef, TransitionDirection } from '../../levels/roomDef';
import { BLOCK_SIZE_SMALL } from '../../levels/roomDef';
import {
  computeConnectedRoomOrigin,
  computeTransitionOpeningOffset,
} from '../transitions/transitionPreviewTypes';

/** Minimal room shape this module needs; RoomDef satisfies it structurally. */
export interface ConnectedLayoutRoom {
  readonly id: string;
  readonly widthBlocks: number;
  readonly heightBlocks: number;
  readonly transitions: readonly RoomTransitionDef[];
}

/** How the reciprocal (return) transition was resolved for an instance. */
export type ReciprocalResolution =
  /** Exactly one reverse-direction transition targeting the active room. */
  | 'unambiguous'
  /** Several candidates; chosen deterministically (see rankReciprocal). */
  | 'deterministic'
  /** No reciprocal transition; aligned from source opening + targetSpawnBlock. */
  | 'fallback-spawn';

/** A single render-only adjacent-room instance in active-room world space. */
export interface ConnectedRoomInstance {
  /** Stable identity keyed by the source transition, not just the target id. */
  readonly instanceKey: string;
  readonly sourceRoomId: string;
  /** Index into the active room's `transitions` array. */
  readonly sourceTransitionIndex: number;
  readonly targetRoomId: string;
  readonly direction: TransitionDirection;
  /** Integer world-unit origin of the target room in active-room space. */
  readonly originXWorld: number;
  readonly originYWorld: number;
  readonly targetWidthBlocks: number;
  readonly targetHeightBlocks: number;
  readonly reciprocalResolution: ReciprocalResolution;
  /** True when reciprocal resolution had to break a genuine ambiguity. */
  readonly ambiguous: boolean;
}

/** Reasons a candidate transition is skipped (surfaced for DEV diagnostics). */
export type SkipReason =
  | 'long-transition'
  | 'unrevealed-secret'
  | 'self-link'
  | 'missing-target'
  | 'invalid-dimensions'
  | 'invalid-opening'
  | 'malformed-direction';

export interface SkippedTransition {
  readonly sourceTransitionIndex: number;
  readonly targetRoomId: string;
  readonly reason: SkipReason;
}

export interface ConnectedRoomLayout {
  readonly activeRoomId: string;
  readonly instances: readonly ConnectedRoomInstance[];
  /** Skips useful for DEV diagnostics and async-load requests (missing-target). */
  readonly skipped: readonly SkippedTransition[];
  /** DEV-only warnings (ambiguous reciprocal, degraded fallback). */
  readonly warnings: readonly string[];
}

export interface ConnectedRoomLayoutInput {
  /** The active room (render origin 0,0). */
  readonly activeRoom: ConnectedLayoutRoom;
  /**
   * Resolve a neighbour RoomDef by id. Return null when the room is missing or
   * not yet loaded (the caller then requests it through the async preload path).
   * NOTE: this is only called when `enabled` is true.
   */
  readonly resolveRoom: (roomId: string) => ConnectedLayoutRoom | null;
  /**
   * Whether a secret transition has been revealed/used this session. Only
   * consulted for `isSecretDoor` transitions. Defaults to "not revealed".
   */
  readonly isTransitionRevealed?: (
    sourceRoomId: string,
    transitionIndex: number,
  ) => boolean;
  /** The effective (parent && child) setting. When false: no work is done. */
  readonly enabled: boolean;
}

const VALID_DIRECTIONS: ReadonlySet<string> = new Set([
  'left',
  'right',
  'up',
  'down',
]);

function opposite(dir: TransitionDirection): TransitionDirection {
  switch (dir) {
    case 'left':
      return 'right';
    case 'right':
      return 'left';
    case 'up':
      return 'down';
    case 'down':
      return 'up';
  }
}

function isHorizontal(dir: TransitionDirection): boolean {
  return dir === 'left' || dir === 'right';
}

function hasValidDimensions(room: ConnectedLayoutRoom): boolean {
  return (
    Number.isFinite(room.widthBlocks) &&
    Number.isFinite(room.heightBlocks) &&
    room.widthBlocks > 0 &&
    room.heightBlocks > 0
  );
}

/**
 * Deterministically rank a reciprocal candidate against the source transition.
 * Lower is better. Compared lexicographically by:
 *   1. opening-size mismatch (prefer equal opening spans)
 *   2. positional proximity of the openings along the shared seam
 *   3. target transition index (stable final tiebreak)
 */
function reciprocalRank(
  source: RoomTransitionDef,
  candidate: RoomTransitionDef,
  candidateIndex: number,
  dir: TransitionDirection,
): [number, number, number] {
  const sizeMismatch = Math.abs(
    (source.openingSizeBlocks ?? 0) - (candidate.openingSizeBlocks ?? 0),
  );
  const proximity = isHorizontal(dir)
    ? Math.abs((source.yBlock ?? 0) - (candidate.yBlock ?? 0))
    : Math.abs((source.xBlock ?? 0) - (candidate.xBlock ?? 0));
  return [sizeMismatch, proximity, candidateIndex];
}

function rankLess(a: [number, number, number], b: [number, number, number]): boolean {
  if (a[0] !== b[0]) return a[0] < b[0];
  if (a[1] !== b[1]) return a[1] < b[1];
  return a[2] < b[2];
}

/**
 * Compute the render-only radius-1 connected-room layout for the active room.
 * Pure and total: never throws, and performs zero neighbour lookups when the
 * effective setting is off.
 */
export function computeConnectedRoomLayout(
  input: ConnectedRoomLayoutInput,
): ConnectedRoomLayout {
  const { activeRoom, resolveRoom, enabled } = input;
  const isRevealed = input.isTransitionRevealed ?? (() => false);

  if (!enabled) {
    return { activeRoomId: activeRoom.id, instances: [], skipped: [], warnings: [] };
  }

  const instances: ConnectedRoomInstance[] = [];
  const skipped: SkippedTransition[] = [];
  const warnings: string[] = [];

  if (!hasValidDimensions(activeRoom)) {
    warnings.push(`active room ${activeRoom.id} has invalid dimensions`);
    return { activeRoomId: activeRoom.id, instances, skipped, warnings };
  }

  const transitions = activeRoom.transitions ?? [];
  for (let i = 0; i < transitions.length; i++) {
    const t = transitions[i];

    if (!VALID_DIRECTIONS.has(t.direction)) {
      skipped.push({ sourceTransitionIndex: i, targetRoomId: t.targetRoomId, reason: 'malformed-direction' });
      continue;
    }
    if (t.longTransition === true) {
      skipped.push({ sourceTransitionIndex: i, targetRoomId: t.targetRoomId, reason: 'long-transition' });
      continue;
    }
    if (t.isSecretDoor === true && !isRevealed(activeRoom.id, i)) {
      skipped.push({ sourceTransitionIndex: i, targetRoomId: t.targetRoomId, reason: 'unrevealed-secret' });
      continue;
    }
    if (t.targetRoomId === activeRoom.id) {
      skipped.push({ sourceTransitionIndex: i, targetRoomId: t.targetRoomId, reason: 'self-link' });
      continue;
    }
    if (!(t.openingSizeBlocks > 0)) {
      skipped.push({ sourceTransitionIndex: i, targetRoomId: t.targetRoomId, reason: 'invalid-opening' });
      continue;
    }

    const target = resolveRoom(t.targetRoomId);
    if (target === null) {
      // Missing/unloaded — the caller requests it through the async preload path.
      skipped.push({ sourceTransitionIndex: i, targetRoomId: t.targetRoomId, reason: 'missing-target' });
      continue;
    }
    if (!hasValidDimensions(target)) {
      skipped.push({ sourceTransitionIndex: i, targetRoomId: t.targetRoomId, reason: 'invalid-dimensions' });
      continue;
    }

    // ── Resolve the reciprocal (return) transition in the target room ──────────
    const wantDir = opposite(t.direction);
    const candidates: { def: RoomTransitionDef; index: number }[] = [];
    const targetTransitions = target.transitions ?? [];
    for (let j = 0; j < targetTransitions.length; j++) {
      const c = targetTransitions[j];
      if (c.direction === wantDir && c.targetRoomId === activeRoom.id) {
        candidates.push({ def: c, index: j });
      }
    }

    let resolution: ReciprocalResolution;
    let ambiguous = false;
    let seamDelta: number;

    if (candidates.length === 0) {
      // One-way / no reciprocal: degrade using source opening + target spawn.
      resolution = 'fallback-spawn';
      const spawn = t.targetSpawnBlock ?? [0, 0];
      seamDelta = isHorizontal(t.direction)
        ? t.yBlock - (spawn[1] ?? 0)
        : t.xBlock - (spawn[0] ?? 0);
      warnings.push(
        `transition ${i} (${activeRoom.id}→${t.targetRoomId}) has no reciprocal; aligned from targetSpawnBlock`,
      );
    } else {
      let best = candidates[0];
      let bestRank = reciprocalRank(t, best.def, best.index, t.direction);
      for (let k = 1; k < candidates.length; k++) {
        const rank = reciprocalRank(t, candidates[k].def, candidates[k].index, t.direction);
        if (rankLess(rank, bestRank)) {
          best = candidates[k];
          bestRank = rank;
        }
      }
      if (candidates.length > 1) {
        ambiguous = true;
        resolution = 'deterministic';
        warnings.push(
          `transition ${i} (${activeRoom.id}→${t.targetRoomId}) has ${candidates.length} reciprocal candidates; chose index ${best.index} deterministically`,
        );
      } else {
        resolution = 'unambiguous';
      }
      seamDelta = computeTransitionOpeningOffset(t, best.def, t.direction);
    }

    const seamDeltaRowBlocks = isHorizontal(t.direction) ? seamDelta : 0;
    const seamDeltaColBlocks = isHorizontal(t.direction) ? 0 : seamDelta;
    const { originXWorld, originYWorld } = computeConnectedRoomOrigin(
      t.direction,
      activeRoom.widthBlocks,
      activeRoom.heightBlocks,
      target.widthBlocks,
      target.heightBlocks,
      seamDeltaRowBlocks,
      seamDeltaColBlocks,
    );

    instances.push({
      instanceKey: makeInstanceKey(activeRoom.id, i),
      sourceRoomId: activeRoom.id,
      sourceTransitionIndex: i,
      targetRoomId: t.targetRoomId,
      direction: t.direction,
      // BLOCK_SIZE_SMALL is an integer and all block coords are integers, so the
      // origins are already integer world units; round defensively regardless.
      originXWorld: Math.round(originXWorld),
      originYWorld: Math.round(originYWorld),
      targetWidthBlocks: target.widthBlocks,
      targetHeightBlocks: target.heightBlocks,
      reciprocalResolution: resolution,
      ambiguous,
    });
  }

  return { activeRoomId: activeRoom.id, instances, skipped, warnings };
}

/** Stable instance key derived from the source transition identity. */
export function makeInstanceKey(sourceRoomId: string, transitionIndex: number): string {
  return `${sourceRoomId}#${transitionIndex}`;
}

/** World-space rectangle of a connected instance (for culling / clipping). */
export interface WorldRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The world-space rectangle covered by a connected-room instance. */
export function instanceWorldRect(instance: ConnectedRoomInstance): WorldRect {
  return {
    x: instance.originXWorld,
    y: instance.originYWorld,
    width: instance.targetWidthBlocks * BLOCK_SIZE_SMALL,
    height: instance.targetHeightBlocks * BLOCK_SIZE_SMALL,
  };
}

function rectsIntersect(a: WorldRect, b: WorldRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * True when the instance's world rectangle intersects the camera view rectangle
 * expanded by `marginWorld` on every side. Instances that fail this test are
 * culled and require no draw work.
 */
export function isInstanceVisible(
  instance: ConnectedRoomInstance,
  cameraViewWorldRect: WorldRect,
  marginWorld = 0,
): boolean {
  const expanded: WorldRect = {
    x: cameraViewWorldRect.x - marginWorld,
    y: cameraViewWorldRect.y - marginWorld,
    width: cameraViewWorldRect.width + marginWorld * 2,
    height: cameraViewWorldRect.height + marginWorld * 2,
  };
  return rectsIntersect(instanceWorldRect(instance), expanded);
}

/** Filter a layout's instances to those visible in the given camera view. */
export function cullConnectedInstances(
  instances: readonly ConnectedRoomInstance[],
  cameraViewWorldRect: WorldRect,
  marginWorld = 0,
): ConnectedRoomInstance[] {
  const out: ConnectedRoomInstance[] = [];
  for (const inst of instances) {
    if (isInstanceVisible(inst, cameraViewWorldRect, marginWorld)) out.push(inst);
  }
  return out;
}
