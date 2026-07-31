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
  WALL_JUMP_X_SPEED_FIRST_TOWARD_WALL_WORLD,
  WALL_JUMP_X_SPEED_SECOND_TOWARD_WALL_WORLD,
  WALL_JUMP_X_SPEED_DEFAULT_WORLD,
  WALL_JUMP_Y_SPEED_WORLD,
  WALL_JUMP_FIRST_BONUS_Y_SPEED_WORLD,
  WALL_JUMP_FORCE_TIME_TICKS,
  WALL_JUMP_LOCKOUT_TICKS,
  WALL_JUMP_SECOND_Y_MULTIPLIER,
  WALL_JUMP_SUBSEQUENT_Y_MULTIPLIER,
  VAR_JUMP_TIME_TICKS,
  debugSpeedOverrides,
  ov,
} from './movementConstants';
import {
  type LogicalWallSurface,
  type GroundConnectedExclusion,
  computeLogicalWallSurface,
  computeGroundConnectedExclusion,
  canWallJumpFromSurface,
  canWallSlideOnSurface,
} from './playerWallSurface';
import { getAdvancedWallJumpsEnabled } from '../../ui/renderSettings';
import { isVerdantDustEquipped, VERDANT_JUMP_LAUNCH_MULTIPLIER } from './verdantMobility';

/**
 * Tolerance (world units) used to treat a near-zero gap as "actually touching"
 * the wall for this tick's geometry scan.  Using a live geometric check
 * (rather than relying solely on `isTouchingWallLeftFlag`/`isTouchingWallRightFlag`,
 * which are only rebuilt by the collision resolver *after* the jump trigger
 * runs this same tick) fixes the same-frame timing bug where a jump press on
 * the very tick wall contact begins could be dropped because neither the
 * "touch/grace" nor the strict "proximity" (`dist > 0`) branch matched a
 * zero-gap contact.
 */
const WALL_TOUCH_EPSILON_WORLD = 0.5;

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
  /** A wall slide is eligible against the left wall (same contact model as jump). */
  canSlideFromLeft: boolean;
  /** A wall slide is eligible against the right wall (same contact model as jump). */
  canSlideFromRight: boolean;
  /** Gap to the best valid left-side wall (0 = touching, >0 = proximity, Infinity = none). */
  leftDistWorld: number;
  /** Gap to the best valid right-side wall (0 = touching, >0 = proximity, Infinity = none). */
  rightDistWorld: number;
  /** True when the left-side candidate is a direct-touch/grace contact (vs. proximity-only). */
  leftIsTouching: boolean;
  /** True when the right-side candidate is a direct-touch/grace contact (vs. proximity-only). */
  rightIsTouching: boolean;
  /** Contact Y for the left wall (overlap midpoint, clamped to the overlap range). */
  leftContactYWorld: number;
  /** Contact Y for the right wall (overlap midpoint, clamped to the overlap range). */
  rightContactYWorld: number;
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
  isDirectlyTouching: boolean,
): boolean {
  const overlap = Math.min(playerBottom, wallBottom) - Math.max(playerTop, wallTop);
  if (overlap <= 0) return false;

  // The minimum-overlap check exists to keep *proximity* wall jumps from
  // firing off a face the player barely grazes (e.g. reaching toward a stair
  // step from a few pixels away). When the player's AABB is ALREADY in direct
  // contact with the face this tick (broad-phase collision already confirmed
  // real intersection), skip this filter so wall-jump agrees with wall-slide,
  // which allows sliding from any direct contact against a tall-enough
  // logical surface — including thin top-corner-only overlaps. The ledge
  // suppression check below still applies to direct contact, so stair-step /
  // low-ledge exploits remain blocked.
  if (!isDirectlyTouching && overlap < WALL_JUMP_MIN_VERTICAL_OVERLAP_WORLD) return false;

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
  isWallSlidingNow: boolean,
): boolean {
  if (!WALL_JUMP_REQUIRE_INTENT) return true;

  // Simple mode (default): jump next to a wall always counts as intent,
  // regardless of horizontal input direction (including no input).
  if (!getAdvancedWallJumpsEnabled()) return true;

  const inputDx = world.playerMoveInputDxWorld;
  // Use the freshly-computed (this-tick) wall-slide eligibility rather than
  // `cluster.isWallSlidingFlag`, which is not rebuilt until the wall-slide
  // block in movement.ts runs *after* this jump-trigger check — using the
  // stale flag would silently deny "wall sliding ⇒ always intentional" on
  // the very tick sliding begins (same-frame timing bug).
  const isWallSliding = isWallSlidingNow;
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
    canSlideFromLeft: false, canSlideFromRight: false,
    leftDistWorld: Infinity, rightDistWorld: Infinity,
    leftIsTouching: false, rightIsTouching: false,
    leftContactYWorld: cluster.positionYWorld + cluster.halfHeightWorld,
    rightContactYWorld: cluster.positionYWorld + cluster.halfHeightWorld,
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
  // Contact Y (overlap midpoint, clamped to the overlap span) of the wall
  // that achieved the minimum gap on each side — preferred over always using
  // playerBottom so ground-exclusion / slide-height checks reflect where the
  // player is actually contacting the face (e.g. top-corner-only contact).
  let leftContactY  = playerBottom;
  let rightContactY = playerBottom;

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

    // Left side: wall's right face is to the player's left.
    const leftGap = playerLeft - wallRight;
    if (leftGap >= 0 && leftGap <= proximity) {
      const leftTouching = leftGap <= WALL_TOUCH_EPSILON_WORLD;
      if (isValidWallJumpFace(playerTop, playerBottom, wallTop, wallBottom, leftTouching)
        && leftGap < leftMinDist) {
        leftMinDist  = leftGap;
        leftFaceX    = wallRight;
        const oMin = Math.max(playerTop, wallTop);
        const oMax = Math.min(playerBottom, wallBottom);
        leftContactY = oMax > oMin ? (oMin + oMax) * 0.5 : playerBottom;
      }
    }

    // Right side: wall's left face is to the player's right.
    const rightGap = wallLeft - playerRight;
    if (rightGap >= 0 && rightGap <= proximity) {
      const rightTouching = rightGap <= WALL_TOUCH_EPSILON_WORLD;
      if (isValidWallJumpFace(playerTop, playerBottom, wallTop, wallBottom, rightTouching)
        && rightGap < rightMinDist) {
        rightMinDist  = rightGap;
        rightFaceX    = wallLeft;
        const oMin = Math.max(playerTop, wallTop);
        const oMax = Math.min(playerBottom, wallBottom);
        rightContactY = oMax > oMin ? (oMin + oMax) * 0.5 : playerBottom;
      }
    }
  }

  // Check which sides have contact (touch / grace) vs proximity-only.
  //
  // IMPORTANT: `isTouchingWallLeftFlag`/`isTouchingWallRightFlag` are rebuilt
  // by the collision resolver *after* the jump trigger runs this same tick
  // (see movement.ts), so on the tick contact first begins those flags still
  // reflect LAST tick. We therefore also treat a live near-zero geometric gap
  // as "touching" — this is what actually fixes the same-frame timing bug
  // (a jump press on the very tick a wall is newly touched would otherwise
  // fall through both the touch/grace branch and the strict `dist > 0`
  // proximity branch and be silently dropped).
  const leftGeometricTouch  = leftMinDist  <= WALL_TOUCH_EPSILON_WORLD;
  const rightGeometricTouch = rightMinDist <= WALL_TOUCH_EPSILON_WORLD;
  const leftHasTouchOrGrace  =
    leftGeometricTouch  || cluster.isTouchingWallLeftFlag  === 1 || cluster.wallJumpGraceLeftTicks  > 0;
  const rightHasTouchOrGrace =
    rightGeometricTouch || cluster.isTouchingWallRightFlag === 1 || cluster.wallJumpGraceRightTicks > 0;

  // A quality wall must be within proximity for either mechanism to activate.
  // (Grace without a nearby quality wall means the player left a low-quality surface.)
  const leftTouchOrGraceOk  = leftHasTouchOrGrace  && leftMinDist  <= proximity;
  const rightTouchOrGraceOk = rightHasTouchOrGrace && rightMinDist <= proximity;

  const leftProximityOnly  =
    !leftHasTouchOrGrace  && leftMinDist  > WALL_TOUCH_EPSILON_WORLD && leftMinDist  <= proximity;
  const rightProximityOnly =
    !rightHasTouchOrGrace && rightMinDist > WALL_TOUCH_EPSILON_WORLD && rightMinDist <= proximity;

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

  // ── Wall-slide eligibility (shared contact model with wall-jump) ──────────
  // Computed live from geometry so both slide and jump agree on the same
  // tick, regardless of when `isWallSlidingFlag` is written by movement.ts.
  const canSlideFromLeft  = leftHasTouchOrGrace  && leftSurface  !== null && leftExclusion  !== null
    ? canWallSlideOnSurface(leftSurface, leftExclusion, leftContactY)
    : false;
  const canSlideFromRight = rightHasTouchOrGrace && rightSurface !== null && rightExclusion !== null
    ? canWallSlideOnSurface(rightSurface, rightExclusion, rightContactY)
    : false;

  // Evaluate left side.
  let canJumpFromLeft  = false;
  let dbgLeft = leftMinDist === Infinity
    ? (leftHasTouchOrGrace ? 'grace/touch+no-quality-wall' : 'no-wall-in-range')
    : 'eval';

  if (leftTouchOrGraceOk) {
    // Surface eligibility: ground-connected exclusion zone check.
    const surfaceOk = leftSurface !== null && leftExclusion !== null
      ? canWallJumpFromSurface(leftSurface, leftExclusion, leftContactY)
      : true;
    if (!surfaceOk) {
      dbgLeft = 'ground-exclusion';
    } else if (hasWallJumpIntent(cluster, world, -1, false, canSlideFromLeft)) {
      canJumpFromLeft = true;
      dbgLeft = (leftGeometricTouch || cluster.isTouchingWallLeftFlag === 1) ? 'touch+intent' : 'grace+intent';
    } else {
      dbgLeft = 'touch/grace+no-intent';
    }
  } else if (leftProximityOnly) {
    const surfaceOk = leftSurface !== null && leftExclusion !== null
      ? canWallJumpFromSurface(leftSurface, leftExclusion, leftContactY)
      : true;
    if (!surfaceOk) {
      dbgLeft = 'ground-exclusion';
    } else if (hasWallJumpIntent(cluster, world, -1, true, canSlideFromLeft)) {
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
      ? canWallJumpFromSurface(rightSurface, rightExclusion, rightContactY)
      : true;
    if (!surfaceOk) {
      dbgRight = 'ground-exclusion';
    } else if (hasWallJumpIntent(cluster, world, 1, false, canSlideFromRight)) {
      canJumpFromRight = true;
      dbgRight = (rightGeometricTouch || cluster.isTouchingWallRightFlag === 1) ? 'touch+intent' : 'grace+intent';
    } else {
      dbgRight = 'touch/grace+no-intent';
    }
  } else if (rightProximityOnly) {
    const surfaceOk = rightSurface !== null && rightExclusion !== null
      ? canWallJumpFromSurface(rightSurface, rightExclusion, rightContactY)
      : true;
    if (!surfaceOk) {
      dbgRight = 'ground-exclusion';
    } else if (hasWallJumpIntent(cluster, world, 1, true, canSlideFromRight)) {
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

  // Debug aid: when wall-slide is eligible but wall-jump was rejected on the
  // same side, print the rejection reason. Gated behind the same DEV flag
  // pattern used elsewhere in the codebase (see src/debug/transitionProfiler.ts).
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    if (canSlideFromLeft && !canJumpFromLeft) {
      console.debug(`[wallJump] slide active but jump rejected (left): ${dbgLeft}`);
    }
    if (canSlideFromRight && !canJumpFromRight) {
      console.debug(`[wallJump] slide active but jump rejected (right): ${dbgRight}`);
    }
  }

  return {
    canJumpFromLeft,
    canJumpFromRight,
    canSlideFromLeft,
    canSlideFromRight,
    leftDistWorld: leftMinDist,
    rightDistWorld: rightMinDist,
    leftIsTouching: leftHasTouchOrGrace,
    rightIsTouching: rightHasTouchOrGrace,
    leftContactYWorld: leftContactY,
    rightContactYWorld: rightContactY,
    dbgLeft,
    dbgRight,
    dbgLogicalSurface,
    dbgExclusion,
    dbgActiveSide,
  };
}

/**
 * The one authoritative wall-jump horizontal launch-speed helper.
 *
 * Reduced speeds (50 for the first wall jump, 100 for the second) apply only
 * when the player is actively holding horizontal input TOWARD the wall being
 * jumped from at the moment of the jump. Holding away, holding no horizontal
 * input, or any other input state — and every third-or-later wall jump
 * regardless of input — uses the default speed (150).
 *
 * @param wallJumpCountSinceReset Jumps already used since the last reset (0 = about to be the first).
 * @param wallDir +1 if the wall is to the player's right, -1 if to the left.
 * @param inputDxWorld Current horizontal input direction (-1, 0, or +1).
 */
export function computeWallJumpXSpeedWorld(
  wallJumpCountSinceReset: number,
  wallDir: number,
  inputDxWorld: number,
): number {
  const isHoldingTowardWall = (wallDir > 0 && inputDxWorld > 0) || (wallDir < 0 && inputDxWorld < 0);
  if (isHoldingTowardWall) {
    if (wallJumpCountSinceReset === 0) return WALL_JUMP_X_SPEED_FIRST_TOWARD_WALL_WORLD;
    if (wallJumpCountSinceReset === 1) return WALL_JUMP_X_SPEED_SECOND_TOWARD_WALL_WORLD;
  }
  return WALL_JUMP_X_SPEED_DEFAULT_WORLD;
}

/**
 * Finds a wall-jump candidate and, if one exists, applies the wall-jump
 * velocity/state immediately. Returns true if a wall jump fired.
 *
 * Shared by the direct jump-press trigger (playerVerticalMovement.ts) and
 * the buffered-jump trigger (movement.ts, fired the instant a wall becomes
 * touchable — the wall-jump equivalent of landing-buffered ground jumps).
 */
export function attemptWallJump(cluster: ClusterState, world: WorldState): boolean {
  const wjCandidate = getWallJumpCandidate(cluster, world);
  const canJumpFromLeft  = wjCandidate.canJumpFromLeft;
  let canJumpFromRight = wjCandidate.canJumpFromRight;

  if (!canJumpFromLeft && !canJumpFromRight) {
    return false;
  }

  // When both sides are eligible, prefer the nearer wall (see getWallJumpCandidate
  // doc comment for tie-break rationale).
  if (canJumpFromLeft && canJumpFromRight) {
    const leftDist  = wjCandidate.leftDistWorld;
    const rightDist = wjCandidate.rightDistWorld;
    if (leftDist < rightDist || (leftDist === rightDist && cluster.velocityXWorld < 0)) {
      canJumpFromRight = false;
    }
  }

  const wallJumpYBase = ov(debugSpeedOverrides.wallJumpYWorld, WALL_JUMP_Y_SPEED_WORLD);
  const isInitialWallJump = cluster.wallJumpCountSinceReset === 0;
  const isSecondWallJump  = cluster.wallJumpCountSinceReset === 1;
  const firstJumpY = wallJumpYBase + WALL_JUMP_FIRST_BONUS_Y_SPEED_WORLD;
  const wallJumpY = isInitialWallJump
    ? firstJumpY
    : isSecondWallJump
      ? firstJumpY * WALL_JUMP_SECOND_Y_MULTIPLIER
      : wallJumpYBase * WALL_JUMP_SUBSEQUENT_Y_MULTIPLIER;
  // wallDir = +1 if wall is to the right, -1 if wall is to the left
  const wallDir = canJumpFromRight ? 1 : -1;
  const tieredWallJumpX = computeWallJumpXSpeedWorld(cluster.wallJumpCountSinceReset, wallDir, world.playerMoveInputDxWorld);
  let wallJumpX = ov(debugSpeedOverrides.wallJumpXWorld, tieredWallJumpX);
  let wallJumpYFinal = wallJumpY;
  // Verdant Dust mobility: wall-jump launch strength (both horizontal and
  // vertical components) is boosted 1.5x while Verdant is equipped. Applied
  // as a multiplier on the resolved tiered/debug-overridden launch values so
  // wall-jump tiers/progression are preserved, just scaled up.
  if (isVerdantDustEquipped(world)) {
    wallJumpX *= VERDANT_JUMP_LAUNCH_MULTIPLIER;
    wallJumpYFinal *= VERDANT_JUMP_LAUNCH_MULTIPLIER;
  }
  // Launch away: strong diagonal push prevents same-wall climbing.
  cluster.velocityXWorld          = -wallDir * wallJumpX;
  cluster.velocityYWorld          = -wallJumpYFinal;
  cluster.isFastFallModeFlag      = 0;
  cluster.wallJumpLockoutTicks    = WALL_JUMP_LOCKOUT_TICKS;
  cluster.wallJumpForceTimeTicks  = WALL_JUMP_FORCE_TIME_TICKS;
  cluster.wallJumpDirX            = -wallDir; // outward direction
  cluster.wallJumpLaunchXSpeedWorld = wallJumpX;
  cluster.isWallSlidingFlag       = 0;
  cluster.coyoteTimeTicks         = 0;
  cluster.wallJumpGraceLeftTicks  = 0;
  cluster.wallJumpGraceRightTicks = 0;
  cluster.wallJumpCountSinceReset += 1;
  if (isInitialWallJump) {
    world.wallJumpSkidDebrisBurstFlag = 1;
    world.skidDebrisXWorld = cluster.positionXWorld;
    world.skidDebrisYWorld = cluster.positionYWorld + cluster.halfHeightWorld;
  }
  // Spawn heavy debris cascade on the 3rd+ consecutive wall jump (weak/slippery).
  if (cluster.wallJumpCountSinceReset > 2) {
    world.weakWallJumpCascadeFlag = 1;
    // Spawn at the wall contact edge (player side facing the wall)
    world.weakWallJumpCascadeXWorld = cluster.positionXWorld
      + wallDir * cluster.halfWidthWorld;
    world.weakWallJumpCascadeYWorld = cluster.positionYWorld;
    world.weakWallJumpCascadeWallSideX = wallDir;
  }
  // Start variable jump sustain for wall jumps too.
  cluster.varJumpTimerTicks       = VAR_JUMP_TIME_TICKS;
  cluster.varJumpSpeedWorld       = -wallJumpYFinal;

  return true;
}
