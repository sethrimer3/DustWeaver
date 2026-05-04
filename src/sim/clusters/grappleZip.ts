/**
 * Grapple zip — the double-tap zip-to-anchor state machine.
 *
 * Activated by double-tapping the down key while the grapple is active.
 * The player rockets toward the anchor, decelerates to a stop (stuck phase),
 * then either:
 *   • jump in window  → high-velocity zip-jump in surface normal direction
 *   • window expires  → gentle hop off the surface
 *
 * Extracted from grapple.ts to keep the zip logic self-contained and the
 * main constraint function focused on normal pendulum physics.
 */

import { WorldState } from '../world';
import { ClusterState } from './state';
import { PLAYER_JUMP_SPEED_WORLD, VAR_JUMP_TIME_TICKS, GRAPPLE_SUPER_JUMP_MULTIPLIER } from './movement';
import { debugSpeedOverrides, ov, GRAPPLE_ZIP_DOUBLE_TAP_WINDOW_TICKS } from './movementConstants';
import { resolveAABBPenetration } from '../physics/collision';
import {
  resolveClusterSolidWallCollision,
  resolveClusterFloorCollision,
  moveClusterByDelta,
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
 * Ticks after coming to a complete stop during which a jump input fires a
 * high-velocity zip-jump in the surface normal direction.  At 60 fps,
 * 15 ticks = 0.25 seconds (¼ second).
 */
const GRAPPLE_ZIP_JUMP_WINDOW_TICKS = 15;

/**
 * Speed (world units/second) applied as a gentle hop-off impulse when the
 * zip-jump window expires without a jump input.  Equivalent to ~40 % of
 * normal jump speed — enough to peel the player off the surface but not a
 * powerful launch.
 */
const GRAPPLE_ZIP_HOP_OFF_SPEED_WORLD = PLAYER_JUMP_SPEED_WORLD * 0.4;

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
 * pendulum swing).  Returns false when neither zip activation nor the zip state
 * machine fired, leaving normal pendulum physics to continue.
 *
 * @param jumpJustPressed  Whether the jump key was pressed this tick (rising edge).
 * @param downJustPressed  Whether the down key was pressed this tick (rising edge).
 */
export function tickGrappleZip(
  world: WorldState,
  player: ClusterState,
  jumpJustPressed: boolean,
  downJustPressed: boolean,
  dtSec: number,
): boolean {
  // ── Down double-tap detection (zip activation) ────────────────────────────
  // A double-tap is two rising-edge down presses within ZIP_DOUBLE_TAP_WINDOW_TICKS.
  // On double-tap: store the surface normal from anchor→player and activate zip.
  if (downJustPressed && world.isGrappleZipActiveFlag === 0) {
    const ax = world.grappleAnchorXWorld;
    const ay = world.grappleAnchorYWorld;
    const currentTick = world.tick;
    const lastPressTick = world.playerDownLastPressTick;
    if (
      lastPressTick > 0 &&
      currentTick - lastPressTick <= GRAPPLE_ZIP_DOUBLE_TAP_WINDOW_TICKS
    ) {
      // Double-tap confirmed — activate zip!
      // Compute surface normal = normalized direction from anchor toward player.
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
      world.playerDownLastPressTick = 0; // reset so next press starts fresh
    } else {
      // First press — record tick for double-tap detection
      world.playerDownLastPressTick = currentTick;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Zip grapple — rocket toward anchor, stick, then zip-jump or hop off
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

  // ── Jump input while zipping / stuck ──────────────────────────────────
  if (jumpJustPressed || (world.playerJumpHeldFlag === 1 && world.isGrappleStuckFlag === 1)) {
    const isInZipJumpWindow = world.isGrappleStuckFlag === 1 &&
      world.grappleStuckStoppedTickCount > 0 &&
      world.grappleStuckStoppedTickCount <= GRAPPLE_ZIP_JUMP_WINDOW_TICKS;
    const jumpMultiplier = isInZipJumpWindow
      ? ov(debugSpeedOverrides.grappleSuperJumpMultiplier, GRAPPLE_SUPER_JUMP_MULTIPLIER)
      : 1.0;
    const jumpSpeed = PLAYER_JUMP_SPEED_WORLD * jumpMultiplier;
    // Launch in surface normal direction (away from anchor).
    // Total speed magnitude = jumpSpeed because ||(nx,ny)|| = 1 (unit vector).
    // For ceiling zip: ny > 0 → propels downward.
    // For floor zip: ny < 0 → propels upward.
    // For wall zip: nx ≠ 0 → propels sideways.
    player.velocityXWorld = nx * jumpSpeed;
    player.velocityYWorld = ny * jumpSpeed;
    player.isGroundedFlag = 0;
    // Only sustain var jump when the launch has an upward component
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
    // ── Stuck phase: lock position, decelerate, then hop off if window expired
    player.positionXWorld = targetX;
    player.positionYWorld = targetY;

    // Safety pass: ensure the locked position is outside all solid walls.
    // The stuck target is always geometrically safe (it is the player AABB
    // resting against the anchor surface with halfExtent clearance), but a
    // final penetration resolve catches any residual overlap from ramps or
    // stacked geometry near the anchor.  We resolve all overlapping walls
    // rather than stopping at the first, since the player AABB can overlap
    // multiple walls simultaneously near stacked geometry.
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

      // Auto hop-off after zip-jump window expires.
      // The normal vector (nx, ny) points from the anchor toward the player's
      // arrival position (away from the surface), so multiplying by a positive
      // speed peels the player off in the correct direction:
      //   floor zip (ny < 0 = upward)   → player pushed up
      //   ceiling zip (ny > 0 = down)   → player drops away
      //   wall zip (nx ≠ 0 = sideways)  → player pushed away from wall
      if (world.grappleStuckStoppedTickCount > GRAPPLE_ZIP_JUMP_WINDOW_TICKS) {
        player.velocityXWorld = nx * GRAPPLE_ZIP_HOP_OFF_SPEED_WORLD;
        player.velocityYWorld = ny * GRAPPLE_ZIP_HOP_OFF_SPEED_WORLD;
        player.isFastFallModeFlag = 0;
        releaseGrapple(world, false);
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
