/**
 * Wall-jump intent and face-quality filtering.
 *
 * Provides `getWallJumpCandidate`, the single authoritative entry point for
 * deciding whether a wall jump should fire and from which side.
 *
 * Separating this logic from `playerVerticalMovement.ts` makes it easy to
 * debug (the result struct carries rejection reasons), tune (constants live in
 * `movementConstants.ts`), and unit-test independently of the full physics loop.
 *
 * Design goals (see problem-statement for full details):
 *   - Prevent accidental wall jumps when the player clips a small ledge, stair
 *     step, or any block face with insufficient vertical wall area.
 *   - Require at least one strong intent signal before firing a wall jump.
 *   - Keep the strong wall-jump force intact — the issue is frequency, not power.
 *   - Give ground / coyote / buffered jumps priority (enforced by caller ordering
 *     in playerVerticalMovement.ts — this function is only called after those).
 *   - Proximity-only wall jumps require stricter intent than direct-touch / grace.
 */

import type { WorldState } from '../world';
import type { ClusterState } from './state';
import {
  WALL_JUMP_PROXIMITY_PIXELS,
  WALL_JUMP_REQUIRE_INTENT,
  WALL_JUMP_MIN_AIRBORNE_TICKS,
  WALL_JUMP_MIN_VERTICAL_OVERLAP_WORLD,
  WALL_JUMP_LEDGE_SUPPRESS_WORLD,
  WALL_JUMP_PROXIMITY_REQUIRES_AWAY_INPUT,
  debugSpeedOverrides,
  ov,
} from './movementConstants';
import {
  type LogicalWallSurface,
  type GroundConnectedExclusion,
  computeLogicalWallSurface,
  computeGroundConnectedExclusion,
  canWallJumpFromSurface,
} from './playerWallSurface';
import { getAdvancedWallJumpsEnabled } from '../../ui/renderSettings';

// ── Public result type ────────────────────────────────────────────────────────

/**
 * Structured result returned by `getWallJumpCandidate`.
 *
 * Both `canJumpFromLeft` and `canJumpFromRight` may be true simultaneously
 * (e.g. squeezed between two walls).  The caller is responsible for choosing
 * a side when both are valid — typically the nearer wall or the wall in the
 * direction the player is facing.
 *
 * The `dbgLeft` / `dbgRight` strings are lightweight rejection / acceptance
 * descriptions for display in a movement debug overlay.
 *
 * The `logicalSurface*` and `exclusion*` fields expose the computed wall
 * surface analysis for the movement debug panel.
 */
export interface WallJumpCandidateResult {
  /** A wall jump can fire from the left wall. */
  canJumpFromLeft: boolean;
  /** A wall jump can fire from the right wall. */
  canJumpFromRight: boolean;
  /** Gap to the best valid left-side wall (0 = touching, >0 = proximity, Infinity = none). */
  leftDistWorld: number;
  /** Gap to the best valid right-side wall (0 = touching, >0 = proximity, Infinity = none). */
  rightDistWorld: number;
  /** Human-readable reason the left side was accepted or rejected (debug). */
  dbgLeft: string;
  /** Human-readable reason the right side was accepted or rejected (debug). */
  dbgRight: string;
  /** Logical wall surface computed for the active (or best) side, for debug overlay. */
  dbgLogicalSurface: LogicalWallSurface | null;
  /** Ground-connected exclusion for the active side, for debug overlay. */
  dbgExclusion: GroundConnectedExclusion | null;
  /** Which side the debug surface/exclusion refers to ('left' | 'right' | 'none'). */
  dbgActiveSide: 'left' | 'right' | 'none';
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Returns true when the wall face has sufficient vertical extent relative to
 * the player AABB to be considered a jumpable wall face (not a tiny ledge/step).
 *
 * Checks:
 *   1. Minimum vertical overlap — rejects walls whose side barely grazes the player.
 *   2. Ledge suppression        — rejects walls whose top is near the player's feet,
 *      indicating the player is at (or just above) the top of a step or ledge.
 *
 * Note: the old per-partition minimum height check (4 blocks) has been removed.
 * Wall-jump eligibility is now gated on the aggregated *logical* wall surface
 * height via `canWallJumpFromSurface` in `playerWallSurface.ts`.  This allows
 * wall-jumping from a single block of valid vertical surface as required, while
 * still preventing hops off tiny stair steps via the overlap and ledge checks.
 */
function isValidWallJumpFace(
  playerTop: number,
  playerBottom: number,
  wallTop: number,
  wallBottom: number,
): boolean {
  const overlap = Math.min(playerBottom, wallBottom) - Math.max(playerTop, wallTop);
  if (overlap < WALL_JUMP_MIN_VERTICAL_OVERLAP_WORLD) return false;

  // Ledge suppression: wallTop is within LEDGE_SUPPRESS_WORLD above the player's
  // feet → this is a ledge edge, not a jumpable wall face.
  if (wallTop >= playerBottom - WALL_JUMP_LEDGE_SUPPRESS_WORLD) return false;

  return true;
}

/**
 * Returns true when the player's inputs or state indicate deliberate intent to
 * perform a wall jump off the given side.
 *
 * With "Advanced Wall Jumps" DISABLED (the default), any jump press next to a
 * quality wall is treated as intentional — including no horizontal input at
 * all — as long as the wall-jump candidate was otherwise found (not grounded,
 * not in coyote time, not grappling; those are enforced by the caller). This
 * makes wall jumps fire whenever the player is next to a wall and presses jump.
 *
 * With "Advanced Wall Jumps" ENABLED, the stricter original behavior applies —
 * intent conditions (ANY is sufficient):
 *   - Wall sliding:          player is actively gripping the wall (always intentional).
 *   - Away input:            pressing away from the wall on the jump frame.
 *   - Airborne long enough:  been airborne ≥ MIN_AIRBORNE_TICKS AND falling.
 *     (prevents wall jumps immediately after hopping over a tiny stair step)
 *
 * Proximity-only wall jumps use a stricter check: only wall-sliding or away
 * input qualify when WALL_JUMP_PROXIMITY_REQUIRES_AWAY_INPUT is true.
 *
 * @param wallSideDir  +1 if the wall is to the player's RIGHT, -1 if to the LEFT.
 * @param usedProximity  True if the candidate was found only via proximity range
 *                       (no direct touch and no active grace timer).
 */
function hasWallJumpIntent(
  cluster: ClusterState,
  world: WorldState,
  wallSideDir: number,
  usedProximity: boolean,
): boolean {
  if (!WALL_JUMP_REQUIRE_INTENT) return true;

  // Simple mode (default): jump next to a wall always counts as intent,
  // regardless of horizontal input direction (including no input).
  if (!getAdvancedWallJumpsEnabled()) return true;

  const inputDx = world.playerMoveInputDxWorld;
  const isWallSliding = cluster.isWallSlidingFlag === 1;
  // "Away from wall": wall on right (+1) → pressing left (inputDx < 0).
  const isPressingAway = inputDx * wallSideDir < 0;
  const isFalling = cluster.velocityYWorld > 0;

  // Wall sliding: player is deliberately gripping the wall.
  if (isWallSliding) return true;

  // Explicit away-from-wall input on the jump frame: always intentional.
  if (isPressingAway) return true;

  // Proximity-only jumps require the above; no further fallback.
  if (usedProximity && WALL_JUMP_PROXIMITY_REQUIRES_AWAY_INPUT) return false;

  // Direct-touch / grace-timer: allow if the player is clearly airborne and
  // falling (not just hopped off a step or ledge a few ticks ago).
  if (isFalling && cluster.airborneTicks >= WALL_JUMP_MIN_AIRBORNE_TICKS) return true;

  return false;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Finds and validates wall-jump candidates on both sides of the player.
 *
 * This function performs one pass over the world's wall array and applies:
 *   1. Platform / ramp exclusion.
 *   2. Wall face quality filtering (vertical overlap + ledge suppression).
 *   3. Proximity / touch / grace-timer detection.
 *   4. Logical wall surface aggregation (to handle horizontally-sliced partitions).
 *   5. Ground-connected bottom-4-block exclusion zone check.
 *   6. Intent filtering.
 *
 * The caller is responsible for:
 *   - Only calling this when ground jump and coyote jump have already been
 *     ruled out (playerVerticalMovement.ts enforces the priority order).
 *   - Resolving ties when both sides are eligible (prefer nearer, then direction).
 *   - Applying the actual wall-jump velocity (this function only decides IF).
 */
export function getWallJumpCandidate(
  cluster: ClusterState,
  world: WorldState,
): WallJumpCandidateResult {
  const noResult: WallJumpCandidateResult = {
    canJumpFromLeft: false, canJumpFromRight: false,
    leftDistWorld: Infinity, rightDistWorld: Infinity,
    dbgLeft: 'lockout', dbgRight: 'lockout',
    dbgLogicalSurface: null, dbgExclusion: null, dbgActiveSide: 'none',
  };

  if (cluster.wallJumpLockoutTicks > 0) {
    return noResult;
  }

  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;
  const posX = cluster.positionXWorld;
  const posY = cluster.positionYWorld;
  const playerLeft   = posX - hw;
  const playerRight  = posX + hw;
  const playerTop    = posY - hh;
  const playerBottom = posY + hh;
  const proximity = ov(debugSpeedOverrides.wallJumpProximityPixels, WALL_JUMP_PROXIMITY_PIXELS);

  // Best (minimum) gap to a quality wall on each side within proximity range.
  let leftMinDist  = Infinity;
  let rightMinDist = Infinity;
  // Face X of the wall that achieved the minimum gap on each side.
  let leftFaceX  = playerLeft;
  let rightFaceX = playerRight;

  for (let wi = 0; wi < world.wallCount; wi++) {
    // NOTE: Only real tile walls (world.walls[]) are scanned here.
    // Architect Blocks are runtime hazard entities stored in world.architectBlock* arrays
    // and are intentionally NOT included in world.wallCount. This means the player cannot
    // wall-jump from Architect Blocks, preventing exploitative wall surfaces from temporary
    // enemy constructs. Normal wall-jump behavior on real tiles is unaffected.
    if (world.wallIsPlatformFlag[wi] === 1) continue;
    if (world.wallRampOrientationIndex[wi] !== 255) continue;

    const wallLeft   = world.wallXWorld[wi];
    const wallTop    = world.wallYWorld[wi];
    const wallRight  = wallLeft + world.wallWWorld[wi];
    const wallBottom = wallTop  + world.wallHWorld[wi];

    // Quality check: must have sufficient vertical overlap and not be a ledge edge.
    // (Minimum height check removed — logical surface aggregation handles that.)
    if (!isValidWallJumpFace(playerTop, playerBottom, wallTop, wallBottom)) continue;

    // Left side: wall's right face is to the player's left.
    const leftGap = playerLeft - wallRight;
    if (leftGap >= 0 && leftGap <= proximity) {
      if (leftGap < leftMinDist) {
        leftMinDist = leftGap;
        leftFaceX   = wallRight;
      }
    }

    // Right side: wall's left face is to the player's right.
    const rightGap = wallLeft - playerRight;
    if (rightGap >= 0 && rightGap <= proximity) {
      if (rightGap < rightMinDist) {
        rightMinDist = rightGap;
        rightFaceX   = wallLeft;
      }
    }
  }

  // Check which sides have contact (touch / grace) vs proximity-only.
  const leftHasTouchOrGrace  =
    cluster.isTouchingWallLeftFlag  === 1 || cluster.wallJumpGraceLeftTicks  > 0;
  const rightHasTouchOrGrace =
    cluster.isTouchingWallRightFlag === 1 || cluster.wallJumpGraceRightTicks > 0;

  // A quality wall must be within proximity for either mechanism to activate.
  // (Grace without a nearby quality wall means the player left a low-quality surface.)
  const leftTouchOrGraceOk  = leftHasTouchOrGrace  && leftMinDist  <= proximity;
  const rightTouchOrGraceOk = rightHasTouchOrGrace && rightMinDist <= proximity;

  const leftProximityOnly  = !leftHasTouchOrGrace  && leftMinDist  > 0 && leftMinDist  <= proximity;
  const rightProximityOnly = !rightHasTouchOrGrace && rightMinDist > 0 && rightMinDist <= proximity;

  // ── Compute logical wall surfaces and exclusion zones ─────────────────────
  // Only compute for sides that have a candidate wall in range.
  let leftSurface:  LogicalWallSurface | null = null;
  let leftExclusion: GroundConnectedExclusion | null = null;
  let rightSurface:  LogicalWallSurface | null = null;
  let rightExclusion: GroundConnectedExclusion | null = null;

  if (leftMinDist <= proximity) {
    leftSurface   = computeLogicalWallSurface(leftFaceX, 'left', playerTop, playerBottom, world);
    leftExclusion = computeGroundConnectedExclusion(leftSurface, 'left', world);
  }
  if (rightMinDist <= proximity) {
    rightSurface   = computeLogicalWallSurface(rightFaceX, 'right', playerTop, playerBottom, world);
    rightExclusion = computeGroundConnectedExclusion(rightSurface, 'right', world);
  }

  // Evaluate left side.
  let canJumpFromLeft  = false;
  let dbgLeft = leftMinDist === Infinity
    ? (leftHasTouchOrGrace ? 'grace/touch+no-quality-wall' : 'no-wall-in-range')
    : 'eval';

  if (leftTouchOrGraceOk) {
    // Surface eligibility: ground-connected exclusion zone check.
    const surfaceOk = leftSurface !== null && leftExclusion !== null
      ? canWallJumpFromSurface(leftSurface, leftExclusion, playerBottom)
      : true;
    if (!surfaceOk) {
      dbgLeft = 'ground-exclusion';
    } else if (hasWallJumpIntent(cluster, world, -1, false)) {
      canJumpFromLeft = true;
      dbgLeft = cluster.isTouchingWallLeftFlag === 1 ? 'touch+intent' : 'grace+intent';
    } else {
      dbgLeft = 'touch/grace+no-intent';
    }
  } else if (leftProximityOnly) {
    const surfaceOk = leftSurface !== null && leftExclusion !== null
      ? canWallJumpFromSurface(leftSurface, leftExclusion, playerBottom)
      : true;
    if (!surfaceOk) {
      dbgLeft = 'ground-exclusion';
    } else if (hasWallJumpIntent(cluster, world, -1, true)) {
      canJumpFromLeft = true;
      dbgLeft = 'proximity+intent';
    } else {
      dbgLeft = 'proximity+no-intent';
    }
  }

  // Evaluate right side.
  let canJumpFromRight = false;
  let dbgRight = rightMinDist === Infinity
    ? (rightHasTouchOrGrace ? 'grace/touch+no-quality-wall' : 'no-wall-in-range')
    : 'eval';

  if (rightTouchOrGraceOk) {
    const surfaceOk = rightSurface !== null && rightExclusion !== null
      ? canWallJumpFromSurface(rightSurface, rightExclusion, playerBottom)
      : true;
    if (!surfaceOk) {
      dbgRight = 'ground-exclusion';
    } else if (hasWallJumpIntent(cluster, world, 1, false)) {
      canJumpFromRight = true;
      dbgRight = cluster.isTouchingWallRightFlag === 1 ? 'touch+intent' : 'grace+intent';
    } else {
      dbgRight = 'touch/grace+no-intent';
    }
  } else if (rightProximityOnly) {
    const surfaceOk = rightSurface !== null && rightExclusion !== null
      ? canWallJumpFromSurface(rightSurface, rightExclusion, playerBottom)
      : true;
    if (!surfaceOk) {
      dbgRight = 'ground-exclusion';
    } else if (hasWallJumpIntent(cluster, world, 1, true)) {
      canJumpFromRight = true;
      dbgRight = 'proximity+intent';
    } else {
      dbgRight = 'proximity+no-intent';
    }
  }

  // Pick the active side for debug display (prefer the side with a candidate wall).
  let dbgActiveSide: 'left' | 'right' | 'none' = 'none';
  let dbgLogicalSurface: LogicalWallSurface | null = null;
  let dbgExclusion: GroundConnectedExclusion | null = null;
  if (leftMinDist <= proximity && (leftMinDist <= rightMinDist || rightMinDist === Infinity)) {
    dbgActiveSide     = 'left';
    dbgLogicalSurface = leftSurface;
    dbgExclusion      = leftExclusion;
  } else if (rightMinDist <= proximity) {
    dbgActiveSide     = 'right';
    dbgLogicalSurface = rightSurface;
    dbgExclusion      = rightExclusion;
  }

  return {
    canJumpFromLeft,
    canJumpFromRight,
    leftDistWorld: leftMinDist,
    rightDistWorld: rightMinDist,
    dbgLeft,
    dbgRight,
    dbgLogicalSurface,
    dbgExclusion,
    dbgActiveSide,
  };
}
