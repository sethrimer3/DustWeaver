/**
 * Grapple zip — the zip-to-anchor state machine.
 *
 * Activated by pressing right mouse button while the grapple is attached to a
 * surface.  The player rockets toward the anchor, decelerates to a stop (stuck
 * phase), then either:
 *   • jump pressed within the window → high-velocity zip-jump (direction biased
 *     toward held horizontal input, or purely in the surface normal direction).
 *   • window expires without a jump → grapple releases; no automatic launch.
 *
 * Extracted from grapple.ts to keep the zip logic self-contained and the
 * main constraint function focused on normal pendulum physics.
 */

import { WorldState } from '../world';
import { ClusterState } from './state';
import { PLAYER_JUMP_SPEED_WORLD, VAR_JUMP_TIME_TICKS, GRAPPLE_SUPER_JUMP_MULTIPLIER } from './movement';
import { debugSpeedOverrides, ov } from './movementConstants';
import { resolveAABBPenetration } from '../physics/collision';
import {
  resolveClusterSolidWallCollision,
  resolveClusterFloorCollision,
} from './movementCollision';
import { raycastWalls, releaseGrapple } from './grappleShared';

// ============================================================================
// Zip tuning constants
// ============================================================================

/**
 * Speed at which the player is zipped toward the grapple anchor — ~3× sprint speed.
 */
const GRAPPLE_ZIP_SPEED_WORLD_PER_SEC = 480.0;

/**
 * Arrival distance (world units) — the player is snapped to the target when
 * the remaining distance falls within one zip step plus this threshold.
 */
const GRAPPLE_ZIP_ARRIVAL_THRESHOLD_WORLD = 4.0;

/**
 * Tolerance (world units) used by the per-frame line-of-sight check between
 * the player and the grapple anchor during zip.  Wall hits whose distance to
 * the anchor is within this margin are treated as the anchor surface itself
 * (i.e. not an obstruction), preventing the LOS check from firing on the
 * final approach into the wall.  Sized to comfortably cover rounding error
 * and the player's AABB half-extents.
 */
const GRAPPLE_ZIP_LOS_TOLERANCE_WORLD = 8.0;

/**
 * Minimum distance (world units) required to record the zip direction as the
 * stuck velocity.  Below this value the direction is unreliable.
 */
const GRAPPLE_ZIP_MIN_DIST_WORLD = 1.0;

/**
 * Speed (world units/second) below which the player is considered fully stopped
 * while in the stuck phase.
 */
const GRAPPLE_STUCK_STOP_THRESHOLD_WORLD = 10.0;

/**
 * Per-tick velocity multiplier applied during the stuck deceleration phase.
 * 0.7 means the player loses ~30 % of their speed each tick — almost instantly.
 */
const GRAPPLE_STUCK_DECEL_FACTOR = 0.7;

/**
 * Window after reaching the zip endpoint during which a jump press fires a
 * high-velocity zip-jump.  Tune ZIP_JUMP_WINDOW_SECONDS to adjust feel.
 * At 60 fps the default 0.15 s gives 9 ticks.
 */
export const ZIP_JUMP_WINDOW_SECONDS = 0.15;
const GRAPPLE_ZIP_JUMP_WINDOW_TICKS = Math.round(ZIP_JUMP_WINDOW_SECONDS * 60);

/**
 * How much the player's held horizontal direction biases the zip-jump launch
 * vector.  0 = pure surface normal, 1 = pure input direction.
 * 0.35 gives a noticeable but not overriding directional influence.
 */
const ZIP_JUMP_INPUT_BIAS = 0.35;

/**
 * Minimum held-input magnitude required to apply horizontal direction bias to
 * the zip-jump launch vector.  Values below this are treated as no input.
 */
const ZIP_JUMP_INPUT_THRESHOLD = 0.5;

/**
 * Epsilon guard for launch vector normalization.  If the biased launch vector
 * has a length smaller than this, normalization is skipped to avoid NaN.
 */
const MIN_LAUNCH_VECTOR_LENGTH = 0.001;

// ============================================================================
// Public API
// ============================================================================

/**
 * Handles the grapple zip sub-system for one tick.
 *
 * Must be called from applyGrappleClusterConstraint after consuming the jump
 * and down triggered flags.
 *
 * Returns true if the zip path was taken this tick (caller must skip normal
 * pendulum swing).  Returns false when zip is not active and was not activated,
 * leaving normal pendulum physics to continue.
 *
 * @param jumpJustPressed  Whether the jump key was pressed this tick (rising edge).
 */
export function tickGrappleZip(
  world: WorldState,
  player: ClusterState,
  jumpJustPressed: boolean,
  dtSec: number,
): boolean {
  // ── RMB zip activation (triggered flag, consumed once) ────────────────────
  // The flag is set by the command processor when right-click is received while
  // the grapple is attached (isGrappleActiveFlag === 1).
  if (world.isGrappleZipTriggeredFlag === 1 && world.isGrappleZipActiveFlag === 0) {
    world.isGrappleZipTriggeredFlag = 0;
    // Compute surface normal = normalized direction from anchor toward player.
    const ax = world.grappleAnchorXWorld;
    const ay = world.grappleAnchorYWorld;
    const dxToPlayer = player.positionXWorld - ax;
    const dyToPlayer = player.positionYWorld - ay;
    const distToPlayer = Math.sqrt(dxToPlayer * dxToPlayer + dyToPlayer * dyToPlayer);
    if (distToPlayer > 0.001) {
      world.grappleZipNormalXWorld = dxToPlayer / distToPlayer;
      world.grappleZipNormalYWorld = dyToPlayer / distToPlayer;
    } else {
      world.grappleZipNormalXWorld = 0.0;
      world.grappleZipNormalYWorld = -1.0; // default: floor normal (upward)
    }
    world.isGrappleZipActiveFlag = 1;
    world.isGrappleStuckFlag = 0;
    world.grappleStuckStoppedTickCount = 0;
  } else if (world.isGrappleZipTriggeredFlag === 1) {
    // Zip already active — discard duplicate trigger
    world.isGrappleZipTriggeredFlag = 0;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Zip grapple — rocket toward anchor, stick, then zip-jump or release quietly
  // ════════════════════════════════════════════════════════════════════════════
  if (world.isGrappleZipActiveFlag === 0) {
    return false; // zip not active — normal pendulum continues
  }

  const ax = world.grappleAnchorXWorld;
  const ay = world.grappleAnchorYWorld;
  const nx = world.grappleZipNormalXWorld;
  const ny = world.grappleZipNormalYWorld;

  // Arrival target: player center at anchor + surfaceNormal * halfExtent,
  // where halfExtent is the projection of the player's AABB half-extents
  // onto the surface normal (so the player touches the surface regardless
  // of approach angle: e.g. full halfHeight for a floor/ceiling, full
  // halfWidth for a wall, blended for diagonal normals).
  const halfExtent = Math.abs(nx) * player.halfWidthWorld
    + Math.abs(ny) * player.halfHeightWorld;
  const targetX = ax + nx * halfExtent;
  const targetY = ay + ny * halfExtent;

  // ── Jump input while zipping / stuck ────────────────────────────────────
  if (jumpJustPressed || (world.playerJumpHeldFlag === 1 && world.isGrappleStuckFlag === 1)) {
    const isInZipJumpWindow = world.isGrappleStuckFlag === 1 &&
      world.grappleStuckStoppedTickCount > 0 &&
      world.grappleStuckStoppedTickCount <= GRAPPLE_ZIP_JUMP_WINDOW_TICKS;
    const jumpMultiplier = isInZipJumpWindow
      ? ov(debugSpeedOverrides.grappleSuperJumpMultiplier, GRAPPLE_SUPER_JUMP_MULTIPLIER)
      : 1.0;
    const jumpSpeed = PLAYER_JUMP_SPEED_WORLD * jumpMultiplier;

    // Launch direction: surface normal biased toward held horizontal input.
    // This lets the player redirect the zip-jump without ignoring the physics.
    let launchX = nx;
    let launchY = ny;
    const inputDx = world.playerMoveInputDxWorld;
    if (Math.abs(inputDx) > ZIP_JUMP_INPUT_THRESHOLD) {
      launchX = nx * (1.0 - ZIP_JUMP_INPUT_BIAS) + inputDx * ZIP_JUMP_INPUT_BIAS;
      // Normalize so launch speed equals jumpSpeed exactly.
      const launchLen = Math.sqrt(launchX * launchX + launchY * launchY);
      if (launchLen > MIN_LAUNCH_VECTOR_LENGTH) {
        launchX /= launchLen;
        launchY /= launchLen;
      }
    }

    player.velocityXWorld = launchX * jumpSpeed;
    player.velocityYWorld = launchY * jumpSpeed;
    player.isGroundedFlag = 0;
    // Sustain variable jump only when the launch has an upward component.
    if (player.velocityYWorld < 0) {
      player.varJumpTimerTicks = VAR_JUMP_TIME_TICKS;
      player.varJumpSpeedWorld = player.velocityYWorld;
    }
    releaseGrapple(world, false);
    return true;
  }

  if (world.isGrappleStuckFlag === 0) {
    // ── Zip phase: move player toward anchor using swept AABB collision ────
    //
    // Why swept collision instead of direct position assignment:
    //   GRAPPLE_ZIP_SPEED_WORLD_PER_SEC (~480 wu/s) moves ~8 wu per tick at
    //   60 fps.  Direct position assignment can carry the player through thin
    //   walls (BLOCK_SIZE_SMALL = 3 wu) or into floor tiles in a single step.
    //   resolveClusterSolidWallCollision uses the same axis-separated sweep
    //   as normal movement, giving sub-tick safety and automatic wall/floor
    //   sliding at no extra cost.
    const dx = targetX - player.positionXWorld;
    const dy = targetY - player.positionYWorld;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const zipStep = GRAPPLE_ZIP_SPEED_WORLD_PER_SEC * dtSec;

    // ── Per-frame LOS check: stop zip if a wall now blocks the path ────────
    // Cast from the player position toward the grapple anchor.  If a wall is
    // hit well before the anchor (farther than GRAPPLE_ZIP_LOS_TOLERANCE_WORLD
    // from the anchor surface), the path is obstructed — continuing to zip
    // would pull the player through solid geometry.  Release the grapple
    // instead.  The anchor's own wall is excluded from the check by capping
    // the cast distance at anchorDist - LOS_TOLERANCE.
    {
      const dxToAnchor = world.grappleAnchorXWorld - player.positionXWorld;
      const dyToAnchor = world.grappleAnchorYWorld - player.positionYWorld;
      const anchorDist = Math.sqrt(dxToAnchor * dxToAnchor + dyToAnchor * dyToAnchor);
      const losCheckDist = anchorDist - GRAPPLE_ZIP_LOS_TOLERANCE_WORLD;
      if (losCheckDist > 1.0) {
        const invAD = 1.0 / anchorDist;
        const losHit = raycastWalls(
          world,
          player.positionXWorld, player.positionYWorld,
          dxToAnchor * invAD, dyToAnchor * invAD,
          losCheckDist,
        );
        if (losHit !== null) {
          // An intermediate wall blocks the direct line to the anchor.
          // Releasing the grapple here prevents the zip from dragging the
          // player through solid geometry.
          releaseGrapple(world);
          return true;
        }
      }
    }

    if (dist <= zipStep + GRAPPLE_ZIP_ARRIVAL_THRESHOLD_WORLD) {
      // ── Arrival frame: swept movement toward target, then transition to stuck
      if (dist > GRAPPLE_ZIP_MIN_DIST_WORLD) {
        // Use swept collision even on the arrival frame to prevent floor/wall
        // clipping on diagonal approaches (e.g. zipping down into a corner).
        const invDist = 1.0 / dist;
        const oldX = player.positionXWorld;
        const oldY = player.positionYWorld;
        // Scale velocity so the integration moves exactly `dist` this tick.
        player.velocityXWorld = dx * invDist * (dist / dtSec);
        player.velocityYWorld = dy * invDist * (dist / dtSec);
        const arrivalCollision = resolveClusterSolidWallCollision(player, world, oldX, oldY, dtSec, false);
        resolveClusterFloorCollision(player, world);
        // If the player hit a bounce pad during the arrival sweep, launch them
        // away with the reflected zip velocity and release the grapple.
        if (arrivalCollision.bouncedX || arrivalCollision.bouncedY) {
          releaseGrapple(world, false);
          return true;
        }
        // Restore full zip velocity for momentum-on-release and stuck decel.
        player.velocityXWorld = dx * invDist * GRAPPLE_ZIP_SPEED_WORLD_PER_SEC;
        player.velocityYWorld = dy * invDist * GRAPPLE_ZIP_SPEED_WORLD_PER_SEC;
      }
      world.isGrappleStuckFlag = 1;
      world.grappleStuckStoppedTickCount = 0;
    } else {
      // ── Normal zip frame: move at full speed with swept collision ─────────
      // resolveClusterSolidWallCollision zeroes velocity on the contact axis,
      // so if the player hits a wall the perpendicular component continues —
      // giving natural sliding behavior with no extra code.
      const invDist = 1.0 / dist;
      const oldX = player.positionXWorld;
      const oldY = player.positionYWorld;
      player.velocityXWorld = dx * invDist * GRAPPLE_ZIP_SPEED_WORLD_PER_SEC;
      player.velocityYWorld = dy * invDist * GRAPPLE_ZIP_SPEED_WORLD_PER_SEC;
      const zipCollision = resolveClusterSolidWallCollision(player, world, oldX, oldY, dtSec, false);
      resolveClusterFloorCollision(player, world);
      // If the player hit a bounce pad, the velocity has already been reflected
      // by the collision resolver (pre-impact velocity = zip speed). Release
      // the grapple so the reflected velocity carries the player away instead
      // of the zip overriding it on the next tick.
      if (zipCollision.bouncedX || zipCollision.bouncedY) {
        releaseGrapple(world, false);
        return true;
      }
      // Velocity after collision correctly reflects the post-contact direction
      // (zeroed on the blocked axis, preserved on the unblocked axis).
    }
  }

  if (world.isGrappleStuckFlag === 1) {
    // ── Stuck phase: lock position, decelerate, then release if window expired
    player.positionXWorld = targetX;
    player.positionYWorld = targetY;

    // Safety pass: ensure the locked position is outside all solid walls.
    // The stuck target is always geometrically safe (it is the player AABB
    // resting against the anchor surface with halfExtent clearance), but a
    // final penetration resolve catches any residual overlap from ramps or
    // stacked geometry near the anchor.
    {
      const halfW = player.halfWidthWorld;
      const halfH = player.halfHeightWorld;
      for (let wi = 0; wi < world.wallCount; wi++) {
        const wLeft   = world.wallXWorld[wi];
        const wTop    = world.wallYWorld[wi];
        const wRight  = wLeft + world.wallWWorld[wi];
        const wBottom = wTop + world.wallHWorld[wi];
        resolveAABBPenetration(player, halfW, halfH, wLeft, wTop, wRight, wBottom);
      }
    }

    const speed = Math.sqrt(
      player.velocityXWorld * player.velocityXWorld +
      player.velocityYWorld * player.velocityYWorld,
    );

    if (speed <= GRAPPLE_STUCK_STOP_THRESHOLD_WORLD) {
      // Fully stopped — start/continue zip-jump window countdown
      player.velocityXWorld = 0;
      player.velocityYWorld = 0;
      world.grappleStuckStoppedTickCount++;

      // Zip-jump window expired: release grapple quietly without any impulse.
      // The player remains in place until gravity or their own movement takes over.
      // (Jump within the window is handled in the jump-input block above.)
      if (world.grappleStuckStoppedTickCount > GRAPPLE_ZIP_JUMP_WINDOW_TICKS) {
        releaseGrapple(world, true); // grant coyote time for a natural follow-up jump
        return true;
      }
    } else {
      // Still decelerating — heavy friction to stop quickly
      player.velocityXWorld *= GRAPPLE_STUCK_DECEL_FACTOR;
      player.velocityYWorld *= GRAPPLE_STUCK_DECEL_FACTOR;

      // Spawn skid debris while decelerating for dramatic effect
      world.isPlayerSkiddingFlag = 1;
      world.skidDebrisXWorld = player.positionXWorld;
      world.skidDebrisYWorld = player.positionYWorld + player.halfHeightWorld;
    }
  }

  return true; // zip path was taken — skip normal pendulum physics
}
