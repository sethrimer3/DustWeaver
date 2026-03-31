/**
 * Cluster movement — platformer physics for player and enemies.
 *
 * === Player movement design (Celeste-inspired) ===
 *
 * All major tuning constants are exposed at the top of this file.
 *
 * Key features:
 *   • Unified normal gravity with jump-cut multiplier and apex half-gravity.
 *   • Variable jump sustain — holding jump prevents gravity from eating into
 *     the launch speed during a short window, creating expressive short/full jumps.
 *   • Apex float — gravity halved near the top of the arc when jump is held.
 *   • Normal fall / fast fall — default cap at 160 px/s; holding down smoothly
 *     approaches 240 px/s for intentional fast falls.
 *   • Coyote time — jump still allowed briefly after walking off a ledge.
 *   • Jump buffer — jump input remembered briefly before landing.
 *   • Direct acceleration model — no lerp/alpha blending; forces are applied
 *     per-frame so the player reaches top speed quickly and turns feel snappy.
 *   • Turn acceleration — higher acceleration rate when reversing direction.
 *   • Wall slide — pressing into a solid wall while falling caps descent at 17 px/s.
 *   • Wall jump — launch away at a strong diagonal (147 H × 147 V); a force-time
 *     window overrides horizontal input to prevent immediate wall return.  A lockout
 *     prevents re-grab and infinite altitude climbing.
 *   • Dash — horizontal burst on a cooldown.
 *
 * === Enemy movement ===
 *   • Walk horizontally toward the player with exponential-blend acceleration.
 *   • Gravity applied so enemies land on platforms.
 *   • No jumping or wall interaction.
 *
 * === Platform collision ===
 *   • Thin walls (h ≤ THIN_OBSTACLE_MAX_HEIGHT_WORLD) are top-surface-only.
 *   • Thick solid walls use a sweep-based axis-priority resolver.
 *   • Wall-touch flags (left / right) are set by the solid-wall resolver and
 *     used this tick for wall-slide capping; used next tick for wall-jump.
 *
 * Called as step 0 in the tick pipeline.
 */

import { WorldState } from '../world';
import { DASH_COOLDOWN_TICKS, DASH_RECHARGE_ANIM_TICKS, ENEMY_DODGE_SPEED_WORLD } from './dashConstants';
import { PLAYER_HALF_HEIGHT_WORLD } from '../../levels/roomDef';
import { nextUint32 } from '../rng';
import { WATER_GRAVITY_MULTIPLIER } from '../hazards';

// ============================================================================
// Debug overrides — mutable values that can be live-tuned from the debug panel.
// When a value is NaN, the default constant is used. When set to a finite
// number, it overrides the constant for playtesting.
// ============================================================================

export const debugSpeedOverrides = {
  walkSpeedWorld: NaN,
  jumpSpeedWorld: NaN,
  gravityWorld: NaN,
  normalFallCapWorld: NaN,
  fastFallCapWorld: NaN,
  sprintMultiplier: NaN,
  groundAccelWorld: NaN,
  groundDecelWorld: NaN,
  airAccelWorld: NaN,
  airDecelWorld: NaN,
  dashSpeedWorld: NaN,
  wallJumpXWorld: NaN,
  wallJumpYWorld: NaN,
};

/** Helper: return override if finite, else fallback. */
function ov(override: number, fallback: number): number {
  return Number.isFinite(override) ? override : fallback;
}

// ============================================================================
// Jump physics — Celeste-inspired tuning
// ============================================================================

/**
 * Unified normal gravity (px/s²).  Used for both rise and fall in the base
 * case.  Rise / fall asymmetry is achieved through jump-cut and apex modifiers,
 * not separate base gravities.
 *
 * Increased by 50% from original 600.0 for faster, snappier feel.
 */
const NORMAL_GRAVITY_WORLD_PER_SEC2 = 900.0;

/**
 * Initial upward jump velocity (positive value; negated when applied).
 * Chosen to pair with NORMAL_GRAVITY for a clean Celeste-like arc.
 *
 * Increased by 50% from original 200.0 for higher, faster jumps.
 */
export const PLAYER_JUMP_SPEED_WORLD = 300.0;

/**
 * Jump-cut gravity multiplier.
 * While the player is still rising (velocityY < 0) and the jump key is NOT
 * held, gravity is scaled by this factor — producing a shorter hop on early
 * release without any abrupt velocity clamp.
 */
const JUMP_CUT_GRAVITY_MULTIPLIER = 2.5;

// ── Variable jump sustain (Celeste-style) ────────────────────────────────────
// While the sustain timer is active AND jump is held, vertical velocity is
// prevented from decaying past the initial launch speed.  This creates a real,
// expressive difference between short hops and full jumps.

/** Duration of the variable-jump sustain window (seconds). */
const VAR_JUMP_TIME_SEC = 0.20;
/** Variable jump sustain window in ticks (60 fps). */
export const VAR_JUMP_TIME_TICKS = Math.round(VAR_JUMP_TIME_SEC * 60.0);

// ── Apex half-gravity ────────────────────────────────────────────────────────
// Near the top of the jump arc, gravity is halved for a brief "floaty apex"
// feel — only when vertical speed is near zero and jump is held.

/** Gravity multiplier applied at the apex of a jump. */
const APEX_GRAVITY_MULTIPLIER = 0.5;

/**
 * Vertical speed threshold (px/s) below which the apex gravity kicks in.
 * Only active when abs(vy) < this value and jump is held.
 */
const APEX_THRESHOLD_WORLD_PER_SEC = 33.0;

// ── Fall system (normal fall + fast fall) ────────────────────────────────────
// By default gravity approaches normalMaxFall.  If the player holds down
// while falling, the cap smoothly approaches fastMaxFall.

/** Default maximum downward fall speed (px/s). Increased by 50% from 107.0. */
const NORMAL_MAX_FALL_WORLD_PER_SEC = 160.5;

/** Maximum downward fall speed when holding down (px/s). Increased by 50% from 160.0. */
const FAST_MAX_FALL_WORLD_PER_SEC = 240.0;

/**
 * Rate at which the current fall cap approaches fastMaxFall when holding
 * down (px/s per second — a speed-of-approach value, not acceleration).
 * Increased by 50% from 200.0.
 */
const FAST_MAX_FALL_APPROACH_PER_SEC = 300.0;

// ============================================================================
// Coyote time & jump buffer
// ============================================================================

/**
 * Ticks after leaving a grounded surface during which a jump is still allowed
 * (coyote time).  At 60 fps, 6 ticks ≈ 0.10 s.
 */
const COYOTE_TIME_TICKS = 6;

/**
 * Ticks a jump input is remembered while airborne (jump buffer).
 * When the player lands while bufferTicks > 0 the jump fires immediately.
 * At 60 fps, 6 ticks ≈ 0.10 s.
 */
const JUMP_BUFFER_TICKS = 6;

// ============================================================================
// Horizontal movement
// ============================================================================

/** Maximum horizontal run speed (px/s). Increased by 50% from 70.0. */
const MAX_RUN_SPEED_WORLD_PER_SEC = 105.0;

/** Ground acceleration: how quickly the player builds up speed on the ground (px/s²). */
const GROUND_ACCELERATION_PER_SEC2 = 800.0;

/** Ground deceleration: how quickly the player stops on the ground when no input (px/s²). */
const GROUND_DECELERATION_PER_SEC2 = 1000.0;

/** Air acceleration: slightly reduced control while airborne (px/s²). */
const AIR_ACCELERATION_PER_SEC2 = 520.0;

/** Air deceleration: gentle slowdown while airborne with no input (px/s²). */
const AIR_DECELERATION_PER_SEC2 = 600.0;

/**
 * Turn acceleration: applied when reversing horizontal direction (px/s²).
 * Higher than ground acceleration so direction changes feel crisp and snappy.
 */
const TURN_ACCELERATION_PER_SEC2 = 1466.7;

/** Speed burst applied on a horizontal dash (px/s). */
const PLAYER_DASH_SPEED_WORLD = 373.0;

// ============================================================================
// Wall slide
// ============================================================================

/**
 * Maximum downward speed while wall-sliding (px/s).
 * Slow enough for deliberate, readable wall interaction (Celeste-like).
 * Only active when the player is pushing toward the wall and the
 * wall-jump lockout is not running.
 */
const WALL_SLIDE_MAX_FALL_SPEED = 17.0;

// ============================================================================
// Wall jump
// ============================================================================

/**
 * Horizontal launch speed away from the wall on a wall jump (px/s).
 * Strong outward push prevents rapid same-wall climbing.
 */
const WALL_JUMP_X_SPEED_WORLD = 147.0;

/**
 * Vertical launch speed on a wall jump (px/s, applied upward).
 * Reduced from full ground-jump speed — paired with the strong horizontal
 * push to prevent net altitude gain on same-wall wall-jump chains.
 */
const WALL_JUMP_Y_SPEED_WORLD = 147.0;

/**
 * Ticks after a wall jump during which horizontal input is overridden by
 * the outward launch direction (force-time window).
 * This prevents the player from immediately steering back to the wall.
 * At 60 fps, ~10 ticks ≈ 0.16 s.
 */
const WALL_JUMP_FORCE_TIME_TICKS = 10;

/**
 * Ticks after a wall jump during which the same-side wall sensor is suppressed.
 * Prevents instant re-grab and ensures the player is physically away from the
 * wall before another wall jump becomes available.
 * At 60 fps, 12 ticks ≈ 0.20 s — enough time for the forced outward trajectory.
 */
const WALL_JUMP_LOCKOUT_TICKS = 12;

// ============================================================================
// Enemy movement
// ============================================================================

/** Maximum horizontal chase speed for enemy clusters (px/s). */
const ENEMY_MAX_SPEED_WORLD_PER_SEC = 60.0;

/** Enemy horizontal acceleration rate (exponential blend factor per second). */
const ENEMY_ACCEL_PER_SEC = 8.0;

/**
 * Horizontal distance (px) below which enemies stop advancing.
 * Keeps them in a comfortable attack range.
 */
const ENEMY_ENGAGE_DIST_WORLD = 40.0;

/**
 * Maximum line-of-sight range for rolling enemies (world units).
 * Rolling enemies only chase the player when within this distance,
 * or when recently damaged (rollingEnemyAggressiveTicks > 0).
 * ~25 blocks at BLOCK_SIZE_SMALL = 8.
 */
const ROLLING_ENEMY_SIGHT_RANGE_WORLD = 200.0;

/**
 * Effective rolling radius (world units) used to convert horizontal
 * displacement to sprite rotation.  A smaller value = spins faster.
 */
const ROLLING_ENEMY_SPRITE_RADIUS_WORLD = 5.0;

// ── Player sprint ───────────────────────────────────────────────────────────

/** Sprint speed multiplier applied to MAX_RUN_SPEED when sprinting on ground.
 * Adds another 50% on top of the base run speed when holding shift.
 */
const SPRINT_SPEED_MULTIPLIER = 1.5;

/** Ground deceleration multiplier when holding shift (50% less friction). */
const SPRINT_FRICTION_MULTIPLIER = 0.5;

/** Ground deceleration multiplier when skidding (50% more friction than default). */
const SKID_FRICTION_MULTIPLIER = 1.5;

/** Jump speed multiplier when jumping out of a skid (50% higher jump). */
const SKID_JUMP_MULTIPLIER = 1.5;

/** Velocity threshold (px/s) below which a player is considered "not moving" for skid detection. */
const SKID_VELOCITY_THRESHOLD_WORLD = 5.0;

// ── Player crouch ───────────────────────────────────────────────────────────

/** Half-height of the player hitbox when crouching (world units). */
const CROUCH_HALF_HEIGHT_WORLD = 7;

// ── Player idle animation ───────────────────────────────────────────────────

/** Ticks of no movement before the idle animation cycle begins (1 second at 60fps). */
const IDLE_TRIGGER_TICKS = 60;

/** Ticks for idleBlink animation duration (0.5 seconds at 60fps). */
const IDLE_BLINK_DURATION_TICKS = 30;

// ============================================================================
// Flying eye movement
// ============================================================================

/** Maximum 2D flight speed of flying eye clusters (world units/s). */
const FLYING_EYE_SPEED_WORLD_PER_SEC = 63.0;

/** Acceleration alpha per second for flying eye 2D steering (exponential blend). */
const FLYING_EYE_ACCEL_PER_SEC = 5.5;

/**
 * Preferred hover distance from the player.
 * The eye will approach if farther and retreat if closer.
 */
const FLYING_EYE_PREFERRED_DIST_WORLD = 117.0;

/** Dead-band half-width around preferred hover distance.  Inside the band the eye orbits. */
const FLYING_EYE_PREFERRED_BAND_WORLD = 23.0;

/** Angular rate (radians/second) at which the facing angle tracks the velocity direction. */
const FLYING_EYE_TURN_RATE_PER_SEC = 7.0;

/** Vertical margin from world top/bottom within which flying eyes are clamped. */
const FLYING_EYE_VERTICAL_MARGIN_WORLD = 20.0;

// ============================================================================
// World bounds
// ============================================================================

/** Horizontal margin from world edges within which clusters are clamped. */
const CLUSTER_EDGE_MARGIN_WORLD = 7.0;

// ============================================================================
// Collision helpers
// ============================================================================

/** Epsilon for sweep direction checks to absorb floating-point error. */
const COLLISION_EPSILON = 0.5;

/**
 * Resolves the cluster box against the world floor.
 * Resets isGroundedFlag to 0 on entry, then sets it to 1 if a landing is found.
 * Returns true if the cluster landed this tick.
 */
function resolveClusterFloorCollision(cluster: import('./state').ClusterState, world: WorldState): boolean {
  cluster.isGroundedFlag = 0;

  const hh = cluster.halfHeightWorld;
  const clusterBottom = cluster.positionYWorld + hh;

  // ── World floor ───────────────────────────────────────────────────────────
  const floorY = world.worldHeightWorld;
  if (clusterBottom >= floorY) {
    cluster.positionYWorld = floorY - hh;
    cluster.velocityYWorld = 0;
    cluster.isGroundedFlag = 1;
    return true;
  }

  // World floor only. Solid wall collisions (including top landings) are
  // handled by axis-separated wall sweeps in resolveClusterSolidWallCollision.
  return false;
}

/**
 * X-axis collision pass: resolve all wall overlaps on X only.
 * Pushes cluster left/right out of walls and zeros velX on contact.
 * Sets isTouchingWallLeftFlag / isTouchingWallRightFlag for player.
 */
function resolveWallsX(
  cluster: import('./state').ClusterState,
  world: WorldState,
  prevXWorld: number,
): void {
  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;

  for (let wi = 0; wi < world.wallCount; wi++) {
    const wallLeft   = world.wallXWorld[wi];
    const wallTop    = world.wallYWorld[wi];
    const wallRight  = wallLeft + world.wallWWorld[wi];
    const wallBottom = wallTop + world.wallHWorld[wi];

    const left   = cluster.positionXWorld - hw;
    const right  = cluster.positionXWorld + hw;
    const top    = cluster.positionYWorld - hh;
    const bottom = cluster.positionYWorld + hh;

    // Skip if no overlap
    if (right <= wallLeft || left >= wallRight || bottom <= wallTop || top >= wallBottom) continue;

    const prevRight = prevXWorld + hw;
    const prevLeft  = prevXWorld - hw;

    // Determine push direction from previous position
    if (prevRight <= wallLeft + COLLISION_EPSILON) {
      // Was to the left of wall — push out left
      cluster.positionXWorld = wallLeft - hw;
      if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
      if (cluster.isPlayerFlag === 1) cluster.isTouchingWallRightFlag = 1;
    } else if (prevLeft >= wallRight - COLLISION_EPSILON) {
      // Was to the right of wall — push out right
      cluster.positionXWorld = wallRight + hw;
      if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
      if (cluster.isPlayerFlag === 1) cluster.isTouchingWallLeftFlag = 1;
    } else {
      // Fallback: push out on the shortest X-axis direction.
      // Edge case where cluster was already overlapping on X at start of tick, e.g. spawn.
      const penLeft  = right - wallLeft;
      const penRight = wallRight - left;
      if (penLeft < penRight) {
        cluster.positionXWorld = wallLeft - hw;
        if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
        if (cluster.isPlayerFlag === 1) cluster.isTouchingWallRightFlag = 1;
      } else {
        cluster.positionXWorld = wallRight + hw;
        if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
        if (cluster.isPlayerFlag === 1) cluster.isTouchingWallLeftFlag = 1;
      }
    }
  }
}

/**
 * Y-axis collision pass: resolve all wall overlaps on Y only.
 * Pushes cluster up/down out of walls and zeros velY on contact.
 * Sets isGroundedFlag when landing on a top face.
 * Returns true if the cluster landed on a top surface.
 */
function resolveWallsY(
  cluster: import('./state').ClusterState,
  world: WorldState,
  prevYWorld: number,
): boolean {
  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;
  let landed = false;

  for (let wi = 0; wi < world.wallCount; wi++) {
    const wallLeft   = world.wallXWorld[wi];
    const wallTop    = world.wallYWorld[wi];
    const wallRight  = wallLeft + world.wallWWorld[wi];
    const wallBottom = wallTop + world.wallHWorld[wi];

    const left   = cluster.positionXWorld - hw;
    const right  = cluster.positionXWorld + hw;
    const top    = cluster.positionYWorld - hh;
    const bottom = cluster.positionYWorld + hh;

    // Skip if no overlap
    if (right <= wallLeft || left >= wallRight || bottom <= wallTop || top >= wallBottom) continue;

    const prevBottom = prevYWorld + hh;
    const prevTop    = prevYWorld - hh;

    // Determine push direction from previous position
    if (prevBottom <= wallTop + COLLISION_EPSILON && cluster.velocityYWorld >= 0) {
      // Was above wall — land on top
      cluster.positionYWorld = wallTop - hh;
      cluster.velocityYWorld = 0;
      cluster.isGroundedFlag = 1;
      landed = true;
    } else if (prevTop >= wallBottom - COLLISION_EPSILON && cluster.velocityYWorld <= 0) {
      // Was below wall — push down
      cluster.positionYWorld = wallBottom + hh;
      if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
    } else {
      // Fallback: push out on the shortest Y-axis direction.
      // Edge case where cluster was already overlapping on Y at start of tick, e.g. spawn.
      const penTop    = bottom - wallTop;
      const penBottom = wallBottom - top;
      if (penTop < penBottom) {
        cluster.positionYWorld = wallTop - hh;
        cluster.velocityYWorld = 0;
        cluster.isGroundedFlag = 1;
        landed = true;
      } else {
        cluster.positionYWorld = wallBottom + hh;
        if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
      }
    }
  }
  return landed;
}

/**
 * Axis-separated sweep collision resolver with sub-tick safety.
 *
 * Two-pass approach:
 *   X pass: apply velX, resolve all X overlaps.
 *   Y pass: apply velY, resolve all Y overlaps.
 *
 * Each axis is sub-stepped if the movement distance exceeds half the
 * cluster's dimension on that axis, preventing tunneling through thin
 * walls at high speed (e.g. dash through a BLOCK_SIZE_SMALL = 8 unit wall).
 *
 * Returns true if the cluster landed on a top surface this tick.
 */
function resolveClusterSolidWallCollision(
  cluster: import('./state').ClusterState,
  world: WorldState,
  prevX: number,
  prevY: number,
  dtSec: number,
): boolean {
  // Restore position to pre-integration state — we re-integrate per axis.
  cluster.positionXWorld = prevX;
  cluster.positionYWorld = prevY;

  // ── X pass with sub-tick safety ──────────────────────────────────────────
  const moveDistXWorld = Math.abs(cluster.velocityXWorld * dtSec);
  const stepsX = moveDistXWorld > cluster.halfWidthWorld
    ? Math.ceil(moveDistXWorld / cluster.halfWidthWorld)
    : 1;
  const dtX = dtSec / stepsX;
  for (let i = 0; i < stepsX; i++) {
    const subPrevX = cluster.positionXWorld;
    cluster.positionXWorld += cluster.velocityXWorld * dtX;
    resolveWallsX(cluster, world, subPrevX);
  }

  // ── Y pass with sub-tick safety ──────────────────────────────────────────
  const moveDistYWorld = Math.abs(cluster.velocityYWorld * dtSec);
  const stepsY = moveDistYWorld > cluster.halfHeightWorld
    ? Math.ceil(moveDistYWorld / cluster.halfHeightWorld)
    : 1;
  const dtY = dtSec / stepsY;
  let landed = false;
  for (let i = 0; i < stepsY; i++) {
    const subPrevY = cluster.positionYWorld;
    cluster.positionYWorld += cluster.velocityYWorld * dtY;
    if (resolveWallsY(cluster, world, subPrevY)) {
      landed = true;
    }
  }

  return landed;
}

// ============================================================================
// Main cluster movement update (step 0 of tick pipeline)
// ============================================================================

export function applyClusterMovement(world: WorldState): void {
  const dtSec = world.dtMs / 1000.0;

  // ── Locate the player cluster position (needed by enemy AI) ───────────────
  let playerX = 0.0;
  let playerY = 0.0;
  let playerFound = false;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerX = c.positionXWorld;
      playerY = c.positionYWorld;
      playerFound = true;
      break;
    }
  }

  const minX = CLUSTER_EDGE_MARGIN_WORLD;
  const maxX = world.worldWidthWorld - CLUSTER_EDGE_MARGIN_WORLD;

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isAliveFlag === 0) continue;

    if (cluster.isPlayerFlag === 1) {
      // ── Tick down all cooldown / buffer timers ──────────────────────────
      if (cluster.dashCooldownTicks > 0) {
        cluster.dashCooldownTicks -= 1;
        if (cluster.dashCooldownTicks === 0) {
          cluster.dashRechargeAnimTicks = DASH_RECHARGE_ANIM_TICKS;
        }
      }
      if (cluster.dashRechargeAnimTicks > 0) {
        cluster.dashRechargeAnimTicks -= 1;
      }
      if (cluster.coyoteTimeTicks > 0) {
        cluster.coyoteTimeTicks -= 1;
      }
      if (cluster.jumpBufferTicks > 0) {
        cluster.jumpBufferTicks -= 1;
      }
      if (cluster.wallJumpLockoutTicks > 0) {
        cluster.wallJumpLockoutTicks -= 1;
      }
      if (cluster.wallJumpForceTimeTicks > 0) {
        cluster.wallJumpForceTimeTicks -= 1;
      }
      if (cluster.varJumpTimerTicks > 0) {
        cluster.varJumpTimerTicks -= 1;
      }

      // ── Update player facing direction ──────────────────────────────────
      {
        const inputDxForFacing = world.playerMoveInputDxWorld;
        if (inputDxForFacing < 0) {
          cluster.isFacingLeftFlag = 1;
        } else if (inputDxForFacing > 0) {
          cluster.isFacingLeftFlag = 0;
        }
      }

      // ── Sprint state ──────────────────────────────────────────────────
      // Sprint is active when shift is held and the player is on the ground.
      // Moving or sliding both count as sprinting.
      {
        if (world.playerSprintHeldFlag === 1 && cluster.isGroundedFlag === 1) {
          cluster.isSprintingFlag = 1;
        } else {
          cluster.isSprintingFlag = 0;
        }
      }

      // ── Slide state (shift + down on ground) ──────────────────────────
      {
        if (world.playerSprintHeldFlag === 1 && world.playerCrouchHeldFlag === 1
          && cluster.isGroundedFlag === 1) {
          cluster.isSlidingFlag = 1;
        } else {
          cluster.isSlidingFlag = 0;
        }
      }

      // ── Crouch state ──────────────────────────────────────────────────
      {
        const wasCrouching = cluster.isCrouchingFlag === 1;
        if (world.playerCrouchHeldFlag === 1 && cluster.isGroundedFlag === 1) {
          cluster.isCrouchingFlag = 1;
          if (!wasCrouching) {
            // Entering crouch: shrink hitbox, keep bottom edge stable
            const oldHalfH = cluster.halfHeightWorld;
            cluster.halfHeightWorld = CROUCH_HALF_HEIGHT_WORLD;
            cluster.positionYWorld += oldHalfH - CROUCH_HALF_HEIGHT_WORLD;
          }
        } else {
          cluster.isCrouchingFlag = 0;
          if (wasCrouching) {
            // Exiting crouch: restore hitbox height, keep bottom edge stable
            cluster.halfHeightWorld = PLAYER_HALF_HEIGHT_WORLD;
            cluster.positionYWorld -= PLAYER_HALF_HEIGHT_WORLD - CROUCH_HALF_HEIGHT_WORLD;
          }
        }
      }

      // ── Idle animation state machine ──────────────────────────────────
      {
        const isMoving = world.playerMoveInputDxWorld !== 0;
        if (isMoving || world.isGrappleActiveFlag === 1) {
          // Reset idle state when moving or grappling
          cluster.playerIdleTimerTicks = 0;
          cluster.playerIdleAnimState = 0;
          cluster.playerIdleNextSwitchTicks = 0;
        } else {
          cluster.playerIdleTimerTicks += 1;
          if (cluster.playerIdleTimerTicks >= IDLE_TRIGGER_TICKS) {
            if (cluster.playerIdleNextSwitchTicks > 0) {
              cluster.playerIdleNextSwitchTicks -= 1;
            }
            if (cluster.playerIdleNextSwitchTicks <= 0) {
              // Time to switch idle animation
              if (cluster.playerIdleAnimState === 0) {
                // Currently standing → pick an idle animation
                const roll = nextUint32(world.rng) % 100;
                if (roll < 1) {
                  // 1/100 chance → idle2
                  cluster.playerIdleAnimState = 2;
                  // idle2 duration: 2 seconds ± 1 second (60-180 ticks)
                  cluster.playerIdleNextSwitchTicks = 120 + (nextUint32(world.rng) % 121) - 60;
                } else if (roll < 10) {
                  // 9/100 chance → idleBlink
                  cluster.playerIdleAnimState = 3;
                  cluster.playerIdleNextSwitchTicks = IDLE_BLINK_DURATION_TICKS;
                } else {
                  // 90/100 chance → idle1
                  cluster.playerIdleAnimState = 1;
                  // idle1 duration: 2 seconds ± 1 second (60-180 ticks)
                  cluster.playerIdleNextSwitchTicks = 120 + (nextUint32(world.rng) % 121) - 60;
                }
              } else {
                // Was in an idle animation → return to standing
                cluster.playerIdleAnimState = 0;
                // Next switch in 2 seconds ± 1 second (60-180 ticks)
                cluster.playerIdleNextSwitchTicks = 120 + (nextUint32(world.rng) % 121) - 60;
              }
            }
          }
        }
      }

      // ── Apply gravity (unified + jump-cut + apex half-gravity) ────────
      // When grappling, use consistent gravity (no jump-cut multiplier, no
      // apex modifier) for a natural pendulum feel.  The grapple constraint
      // (step 0.25) handles the actual swing physics.
      const baseGrav = ov(debugSpeedOverrides.gravityWorld, NORMAL_GRAVITY_WORLD_PER_SEC2);
      // Water buoyancy reduces effective gravity when the player is submerged.
      const waterMult = world.isPlayerInWaterFlag === 1 ? WATER_GRAVITY_MULTIPLIER : 1.0;
      let grav: number;
      if (world.isGrappleActiveFlag === 1) {
        // Consistent gravity for pendulum swing.
        grav = baseGrav;
      } else if (cluster.velocityYWorld < 0) {
        // Rising: check for apex half-gravity, then jump-cut multiplier.
        const absVy = -cluster.velocityYWorld; // positive magnitude
        if (
          absVy < APEX_THRESHOLD_WORLD_PER_SEC &&
          world.playerJumpHeldFlag === 1
        ) {
          // Apex band: reduce gravity for a brief floaty feel at the top.
          grav = baseGrav * APEX_GRAVITY_MULTIPLIER;
        } else if (world.playerJumpHeldFlag === 0) {
          // Jump released while rising: apply jump-cut heavy gravity.
          grav = baseGrav * JUMP_CUT_GRAVITY_MULTIPLIER;
        } else {
          grav = baseGrav;
        }
      } else {
        // Falling: check for apex half-gravity (vy just crossed zero, near apex).
        const absVy = cluster.velocityYWorld; // already positive when falling
        if (
          absVy < APEX_THRESHOLD_WORLD_PER_SEC &&
          world.playerJumpHeldFlag === 1
        ) {
          grav = baseGrav * APEX_GRAVITY_MULTIPLIER;
        } else {
          grav = baseGrav;
        }
      }
      cluster.velocityYWorld += grav * waterMult * dtSec;

      // ── Variable jump sustain ────────────────────────────────────────────
      // While the sustain timer is running and the player holds jump, prevent
      // gravity from eating into the initial launch speed.  If jump is released,
      // cancel the sustain immediately.
      if (cluster.varJumpTimerTicks > 0 && world.isGrappleActiveFlag === 0) {
        if (world.playerJumpHeldFlag === 1) {
          // Cap vy so it doesn't decay past the stored launch speed (negative = up).
          if (cluster.velocityYWorld > cluster.varJumpSpeedWorld) {
            cluster.velocityYWorld = cluster.varJumpSpeedWorld;
          }
        } else {
          // Jump released — cancel sustain immediately.
          cluster.varJumpTimerTicks = 0;
        }
      }

      // ── Fall speed cap (normal fall vs fast fall) ────────────────────────
      // Skip terminal velocity cap during grapple — the swing can legitimately
      // exceed the normal fall speed cap without causing tunnelling issues
      // because the rope constraint clamps displacement each tick.
      if (world.isGrappleActiveFlag === 0 && cluster.velocityYWorld > 0) {
        const normalFallCap = ov(debugSpeedOverrides.normalFallCapWorld, NORMAL_MAX_FALL_WORLD_PER_SEC);
        const fastFallCap = ov(debugSpeedOverrides.fastFallCapWorld, FAST_MAX_FALL_WORLD_PER_SEC);
        // Determine current max fall speed: fast fall if holding down
        const isHoldingDown = world.playerMoveInputDyWorld > 0;
        let maxFall: number;
        if (isHoldingDown) {
          // Smoothly approach fastMaxFall from the current cap
          const currentCap = cluster.velocityYWorld < normalFallCap
            ? normalFallCap
            : cluster.velocityYWorld;
          maxFall = currentCap + FAST_MAX_FALL_APPROACH_PER_SEC * dtSec;
          if (maxFall > fastFallCap) maxFall = fastFallCap;
        } else {
          maxFall = normalFallCap;
        }
        if (cluster.velocityYWorld > maxFall) {
          cluster.velocityYWorld = maxFall;
        }
      }

      // ── Dash burst (one-shot horizontal impulse) ─────────────────────────
      if (world.playerDashTriggeredFlag === 1 && cluster.dashCooldownTicks === 0) {
        const ddx = world.playerDashDirXWorld;
        const dashDirX = ddx !== 0 ? (ddx > 0 ? 1 : -1) : (cluster.velocityXWorld >= 0 ? 1 : -1);
        cluster.velocityXWorld = dashDirX * ov(debugSpeedOverrides.dashSpeedWorld, PLAYER_DASH_SPEED_WORLD);
        cluster.dashCooldownTicks = DASH_COOLDOWN_TICKS;
      }

      // ── Jump trigger ─────────────────────────────────────────────────────
      // While the grapple is active the jump button controls rope pull-in
      // (handled in grapple.ts step 0.25), so normal / wall jumps are skipped.
      if (world.playerJumpTriggeredFlag === 1 && world.isGrappleActiveFlag === 0) {
        const baseJumpSpeed = ov(debugSpeedOverrides.jumpSpeedWorld, PLAYER_JUMP_SPEED_WORLD);
        // Skid jump boost: if jumping while skidding, increase jump height by 50%
        const jumpSpeed = cluster.isSkiddingFlag === 1
          ? baseJumpSpeed * SKID_JUMP_MULTIPLIER
          : baseJumpSpeed;
        if (cluster.isGroundedFlag === 1 || cluster.coyoteTimeTicks > 0) {
          // ── Normal ground jump ─────────────────────────────────────────
          cluster.velocityYWorld      = -jumpSpeed;
          cluster.isGroundedFlag      = 0;
          cluster.coyoteTimeTicks     = 0;
          // Start variable jump sustain timer so holding jump sustains height.
          cluster.varJumpTimerTicks   = VAR_JUMP_TIME_TICKS;
          cluster.varJumpSpeedWorld   = -jumpSpeed;
        } else {
          // ── Wall jump (uses wall-touch flags from the previous tick) ───
          const canJumpFromLeft  = cluster.isTouchingWallLeftFlag  === 1
                                && cluster.wallJumpLockoutTicks === 0;
          const canJumpFromRight = cluster.isTouchingWallRightFlag === 1
                                && cluster.wallJumpLockoutTicks === 0;

          if (canJumpFromLeft || canJumpFromRight) {
            const wallJumpX = ov(debugSpeedOverrides.wallJumpXWorld, WALL_JUMP_X_SPEED_WORLD);
            const wallJumpY = ov(debugSpeedOverrides.wallJumpYWorld, WALL_JUMP_Y_SPEED_WORLD);
            // wallDir = +1 if wall is to the right, -1 if wall is to the left
            const wallDir = canJumpFromRight ? 1 : -1;
            // Launch away: strong diagonal push prevents same-wall climbing.
            cluster.velocityXWorld          = -wallDir * wallJumpX;
            cluster.velocityYWorld          = -wallJumpY;
            cluster.wallJumpLockoutTicks    = WALL_JUMP_LOCKOUT_TICKS;
            cluster.wallJumpForceTimeTicks  = WALL_JUMP_FORCE_TIME_TICKS;
            cluster.wallJumpDirX            = -wallDir; // outward direction
            cluster.isWallSlidingFlag       = 0;
            cluster.coyoteTimeTicks         = 0;
            // Start variable jump sustain for wall jumps too.
            cluster.varJumpTimerTicks       = VAR_JUMP_TIME_TICKS;
            cluster.varJumpSpeedWorld       = -wallJumpY;
          } else {
            // Fully airborne and no usable wall — buffer the jump
            cluster.jumpBufferTicks = JUMP_BUFFER_TICKS;
          }
        }
        world.playerJumpTriggeredFlag = 0;
      }

      // ── Horizontal movement (direct acceleration model) ─────────────────
      // While grappling, skip horizontal acceleration and deceleration —
      // the pendulum physics (gravity + rope constraint) governs all motion.
      // Applying platformer-style speed caps or deceleration here would fight
      // against the swing and break the physical feel.
      let inputDx   = world.playerMoveInputDxWorld;
      const isGrounded = cluster.isGroundedFlag === 1;

      // When holding down (without shift), block horizontal acceleration.
      // When holding shift+down (sliding), allow normal input.
      const isHoldingDown = world.playerCrouchHeldFlag === 1;
      if (isHoldingDown && world.playerSprintHeldFlag === 0 && isGrounded) {
        inputDx = 0;
      }

      // ── Skid detection ─────────────────────────────────────────────────
      // Skid when sprint is held, grounded, moving, and velocity is opposite
      // to the facing direction (changing direction while sprinting).
      {
        const isFacingLeft = cluster.isFacingLeftFlag === 1;
        const isMovingRight = cluster.velocityXWorld > SKID_VELOCITY_THRESHOLD_WORLD;
        const isMovingLeft = cluster.velocityXWorld < -SKID_VELOCITY_THRESHOLD_WORLD;
        const isTravelingOppositeToFacing =
          (isFacingLeft && isMovingRight) || (!isFacingLeft && isMovingLeft);
        if (world.playerSprintHeldFlag === 1 && isGrounded && isTravelingOppositeToFacing) {
          cluster.isSkiddingFlag = 1;
        } else {
          cluster.isSkiddingFlag = 0;
        }
      }

      if (world.isGrappleActiveFlag === 0) {
        const baseRunSpeed = ov(debugSpeedOverrides.walkSpeedWorld, MAX_RUN_SPEED_WORLD_PER_SEC);
        const sprintMult = ov(debugSpeedOverrides.sprintMultiplier, SPRINT_SPEED_MULTIPLIER);
        const baseGroundAccel = ov(debugSpeedOverrides.groundAccelWorld, GROUND_ACCELERATION_PER_SEC2);
        const baseGroundDecel = ov(debugSpeedOverrides.groundDecelWorld, GROUND_DECELERATION_PER_SEC2);
        const baseAirAccel = ov(debugSpeedOverrides.airAccelWorld, AIR_ACCELERATION_PER_SEC2);
        const baseAirDecel = ov(debugSpeedOverrides.airDecelWorld, AIR_DECELERATION_PER_SEC2);

        // During wall-jump force-time window, override horizontal velocity
        // to the outward launch direction — prevents immediately steering back.
        // Cancel early if the player hits a wall in the force direction.
        if (cluster.wallJumpForceTimeTicks > 0) {
          const wallJumpX = ov(debugSpeedOverrides.wallJumpXWorld, WALL_JUMP_X_SPEED_WORLD);
          const hitsWallInForceDir =
            (cluster.wallJumpDirX > 0 && cluster.isTouchingWallRightFlag === 1) ||
            (cluster.wallJumpDirX < 0 && cluster.isTouchingWallLeftFlag  === 1);
          if (hitsWallInForceDir) {
            cluster.wallJumpForceTimeTicks = 0;
          } else {
            cluster.velocityXWorld = cluster.wallJumpDirX * wallJumpX;
          }
        }

        if (cluster.wallJumpForceTimeTicks <= 0 && inputDx !== 0) {
          // Reversing direction uses a higher turn acceleration for snappy feel
          const isTurning = (inputDx > 0 && cluster.velocityXWorld < -1.0) ||
                            (inputDx < 0 && cluster.velocityXWorld >  1.0);
          let accel: number;
          if (isTurning) {
            accel = TURN_ACCELERATION_PER_SEC2;
          } else if (isGrounded) {
            accel = baseGroundAccel;
          } else {
            accel = baseAirAccel;
          }
          cluster.velocityXWorld += inputDx * accel * dtSec;
          // Clamp to max run speed only in the direction of input
          // Sprint increases the max speed by 50% when grounded and holding shift
          const maxSpeed = cluster.isSprintingFlag === 1
            ? baseRunSpeed * sprintMult
            : baseRunSpeed;
          if (inputDx > 0 && cluster.velocityXWorld > maxSpeed) {
            cluster.velocityXWorld = maxSpeed;
          } else if (inputDx < 0 && cluster.velocityXWorld < -maxSpeed) {
            cluster.velocityXWorld = -maxSpeed;
          }
        } else if (cluster.wallJumpForceTimeTicks <= 0) {
          // No horizontal input and not in force-time — decelerate toward zero.
          // Friction is modified by sprint (50% less) and skid (50% more).
          let decel: number;
          if (isGrounded) {
            decel = baseGroundDecel;
            if (cluster.isSkiddingFlag === 1) {
              decel *= SKID_FRICTION_MULTIPLIER;
            } else if (world.playerSprintHeldFlag === 1) {
              decel *= SPRINT_FRICTION_MULTIPLIER;
            }
          } else {
            decel = baseAirDecel;
          }
          const dv    = decel * dtSec;
          if (cluster.velocityXWorld > 0) {
            cluster.velocityXWorld = cluster.velocityXWorld - dv > 0 ? cluster.velocityXWorld - dv : 0;
          } else if (cluster.velocityXWorld < 0) {
            cluster.velocityXWorld = cluster.velocityXWorld + dv < 0 ? cluster.velocityXWorld + dv : 0;
          }
        }
      }

    } else if (cluster.isFlyingEyeFlag === 1) {
      // ── Flying Eye: no gravity, 2D steering toward/away from player ────────
      if (playerFound) {
        const dxToPlayer = playerX - cluster.positionXWorld;
        const dyToPlayer = playerY - cluster.positionYWorld;
        const distToPlayer = Math.sqrt(dxToPlayer * dxToPlayer + dyToPlayer * dyToPlayer);
        const invDist = distToPlayer > 0.5 ? 1.0 / distToPlayer : 0.0;
        const dirX = dxToPlayer * invDist;
        const dirY = dyToPlayer * invDist;

        let targetVelX = 0.0;
        let targetVelY = 0.0;

        const outerBand = FLYING_EYE_PREFERRED_DIST_WORLD + FLYING_EYE_PREFERRED_BAND_WORLD;
        const innerBand = FLYING_EYE_PREFERRED_DIST_WORLD - FLYING_EYE_PREFERRED_BAND_WORLD;

        if (distToPlayer > outerBand) {
          // Too far — fly toward player
          targetVelX = dirX * FLYING_EYE_SPEED_WORLD_PER_SEC;
          targetVelY = dirY * FLYING_EYE_SPEED_WORLD_PER_SEC;
        } else if (distToPlayer < innerBand) {
          // Too close — retreat away from player
          targetVelX = -dirX * FLYING_EYE_SPEED_WORLD_PER_SEC;
          targetVelY = -dirY * FLYING_EYE_SPEED_WORLD_PER_SEC;
        } else {
          // In preferred band — gentle circular drift perpendicular to player
          targetVelX = -dirY * FLYING_EYE_SPEED_WORLD_PER_SEC * 0.3;
          targetVelY =  dirX * FLYING_EYE_SPEED_WORLD_PER_SEC * 0.3;
        }

        // Flying eyes apply dodge in full 2D (both X and Y components)
        if (cluster.enemyAiDodgeTicks > 0) {
          targetVelX += cluster.enemyAiDodgeDirXWorld * ENEMY_DODGE_SPEED_WORLD * 1.6;
          targetVelY += cluster.enemyAiDodgeDirYWorld * ENEMY_DODGE_SPEED_WORLD * 1.6;
        }

        const alpha = FLYING_EYE_ACCEL_PER_SEC * dtSec;
        const clampedAlpha = alpha < 1.0 ? alpha : 1.0;
        cluster.velocityXWorld += (targetVelX - cluster.velocityXWorld) * clampedAlpha;
        cluster.velocityYWorld += (targetVelY - cluster.velocityYWorld) * clampedAlpha;
      }

      // Update facing angle to smoothly track velocity direction
      const eyeSpeed = Math.sqrt(
        cluster.velocityXWorld * cluster.velocityXWorld +
        cluster.velocityYWorld * cluster.velocityYWorld,
      );
      if (eyeSpeed > 8.0) {
        const targetAngleRad = Math.atan2(cluster.velocityYWorld, cluster.velocityXWorld);
        // Normalise to [-PI, PI] in O(1) with modulo arithmetic
        let angleDiff = ((targetAngleRad - cluster.flyingEyeFacingAngleRad + Math.PI)
          % (Math.PI * 2.0)) - Math.PI;
        if (angleDiff < -Math.PI) angleDiff += Math.PI * 2.0;
        cluster.flyingEyeFacingAngleRad += angleDiff
          * Math.min(1.0, FLYING_EYE_TURN_RATE_PER_SEC * dtSec);
      }

    } else if (cluster.isRockElementalFlag === 1) {
      // ── Rock Elemental: hover near ground, no standard gravity ─────────────
      // When inactive or activating, stay grounded (apply gravity).
      // When active+, hover: apply gentle upward force to counteract gravity,
      // constrained to a max hover height.
      if (cluster.rockElementalState >= 2) {
        // Active states: hover behavior
        // Apply reduced gravity
        const hoverGrav = 200.0; // Much lighter than normal gravity (900)
        cluster.velocityYWorld += hoverGrav * dtSec;
        
        // Cap downward velocity (gentle float)
        if (cluster.velocityYWorld > 40.0) {
          cluster.velocityYWorld = 40.0;
        }
      } else {
        // Inactive/activating: standard gravity (sit on ground)
        cluster.velocityYWorld += 900.0 * dtSec;
        if (cluster.velocityYWorld > 240.0) {
          cluster.velocityYWorld = 240.0;
        }
      }

    } else if (cluster.isRadiantTetherFlag === 1) {
      // ── Radiant Tether boss: fully floating, no gravity ─────────────────
      // Movement is handled by the chain winching system in radiantTetherAi.ts
      // No gravity, no enemy walk logic — boss moves purely via chain tension.

    } else {
      // ── Ground enemy: gravity ───────────────────────────────────────────────
      cluster.velocityYWorld += NORMAL_GRAVITY_WORLD_PER_SEC2 * dtSec;
      if (cluster.velocityYWorld > FAST_MAX_FALL_WORLD_PER_SEC) {
        cluster.velocityYWorld = FAST_MAX_FALL_WORLD_PER_SEC;
      }

      if (playerFound) {
        // ── Enemy horizontal walk toward player ────────────────────────────
        const dxToPlayer = playerX - cluster.positionXWorld;
        const absDx = dxToPlayer < 0 ? -dxToPlayer : dxToPlayer;
        const distToPlayer = Math.sqrt(dxToPlayer * dxToPlayer +
          (playerY - cluster.positionYWorld) * (playerY - cluster.positionYWorld));

        // Rolling enemies only chase when in sight range or recently damaged
        const canChase = cluster.isRollingEnemyFlag === 0
          || distToPlayer <= ROLLING_ENEMY_SIGHT_RANGE_WORLD
          || cluster.rollingEnemyAggressiveTicks > 0;

        let targetVelX = 0.0;
        if (canChase) {
          if (absDx > ENEMY_ENGAGE_DIST_WORLD) {
            targetVelX = (dxToPlayer > 0 ? 1 : -1) * ENEMY_MAX_SPEED_WORLD_PER_SEC;
          } else if (absDx > 10.0) {
            targetVelX = (dxToPlayer > 0 ? 1 : -1) * ENEMY_MAX_SPEED_WORLD_PER_SEC
              * (absDx / ENEMY_ENGAGE_DIST_WORLD);
          }
        }

        // Blend in lateral dodge (X component only for ground enemies)
        if (cluster.enemyAiDodgeTicks > 0) {
          targetVelX += cluster.enemyAiDodgeDirXWorld * ENEMY_DODGE_SPEED_WORLD;
        }

        const enemyAlpha = ENEMY_ACCEL_PER_SEC * dtSec;
        const clampedEnemyAlpha = enemyAlpha < 1.0 ? enemyAlpha : 1.0;
        cluster.velocityXWorld += (targetVelX - cluster.velocityXWorld) * clampedEnemyAlpha;
      }
    }

    // ── Store pre-integration position ───────────────────────────────────
    const prevX = cluster.positionXWorld;
    const prevY = cluster.positionYWorld;

    // ── Reset player wall-touch flags before collision resolution ──────────
    // Flags are re-populated by resolveClusterSolidWallCollision below.
    // They remain set from the previous tick until this point, so the jump
    // trigger check above correctly sees last-tick wall contact.
    if (cluster.isPlayerFlag === 1) {
      cluster.isTouchingWallLeftFlag  = 0;
      cluster.isTouchingWallRightFlag = 0;
      cluster.isWallSlidingFlag       = 0;
    }

    if (cluster.isFlyingEyeFlag === 1) {
      // ── Flying eye: integrate + clamp to world bounds (no wall collision) ─
      cluster.positionXWorld += cluster.velocityXWorld * dtSec;
      cluster.positionYWorld += cluster.velocityYWorld * dtSec;

      const hw = cluster.halfWidthWorld;
      const hh = cluster.halfHeightWorld;
      const minYEye = FLYING_EYE_VERTICAL_MARGIN_WORLD + hh;
      const maxYEye = world.worldHeightWorld - FLYING_EYE_VERTICAL_MARGIN_WORLD - hh;
      if (cluster.positionYWorld < minYEye) {
        cluster.positionYWorld = minYEye;
        if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
      } else if (cluster.positionYWorld > maxYEye) {
        cluster.positionYWorld = maxYEye;
        if (cluster.velocityYWorld > 0) cluster.velocityYWorld = 0;
      }
      if (cluster.positionXWorld < minX + hw) {
        cluster.positionXWorld = minX + hw;
        if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
      } else if (cluster.positionXWorld > maxX - hw) {
        cluster.positionXWorld = maxX - hw;
        if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
      }
    } else if (cluster.isRadiantTetherFlag === 1) {
      // ── Radiant Tether boss: integrate + clamp to room bounds ────────────
      cluster.positionXWorld += cluster.velocityXWorld * dtSec;
      cluster.positionYWorld += cluster.velocityYWorld * dtSec;

      const hw = cluster.halfWidthWorld;
      const hh = cluster.halfHeightWorld;
      const margin = 20.0; // Keep boss away from absolute room edges
      if (cluster.positionXWorld < minX + margin + hw) {
        cluster.positionXWorld = minX + margin + hw;
        cluster.radiantTetherVelXWorld *= -0.3;
      }
      if (cluster.positionXWorld > maxX - margin - hw) {
        cluster.positionXWorld = maxX - margin - hw;
        cluster.radiantTetherVelXWorld *= -0.3;
      }
      if (cluster.positionYWorld < margin + hh) {
        cluster.positionYWorld = margin + hh;
        cluster.radiantTetherVelYWorld *= -0.3;
      }
      if (cluster.positionYWorld > world.worldHeightWorld - margin - hh) {
        cluster.positionYWorld = world.worldHeightWorld - margin - hh;
        cluster.radiantTetherVelYWorld *= -0.3;
      }
    } else {
      // ── Resolve ground entity collision (axis-separated sweep) ──────────
      // resolveClusterSolidWallCollision handles its own integration internally
      // (X pass then Y pass with sub-tick safety). It receives prevX/prevY and
      // dtSec to integrate position per-axis.
      const wasGrounded = cluster.isGroundedFlag === 1;
      const thickLanded = resolveClusterSolidWallCollision(cluster, world, prevX, prevY, dtSec);

      // Thin platform / world floor check (position already integrated by solid wall resolver)
      const thinLanded  = resolveClusterFloorCollision(cluster, world);
      const justLanded  = thinLanded || thickLanded;

      if (cluster.isPlayerFlag === 1) {
        // ── Wall slide: cap downward velocity when pressing into a wall ─────
        // Only active when airborne, falling, lockout is clear, and the player
        // is actively pushing toward the wall (intentional interaction).
        if (
          cluster.isGroundedFlag === 0 &&
          cluster.velocityYWorld > 0 &&
          cluster.wallJumpLockoutTicks === 0
        ) {
          const inputDx = world.playerMoveInputDxWorld;
          const pressingIntoWall =
            (cluster.isTouchingWallRightFlag === 1 && inputDx > 0) ||
            (cluster.isTouchingWallLeftFlag  === 1 && inputDx < 0);
          if (pressingIntoWall) {
            cluster.isWallSlidingFlag = 1;
            if (cluster.velocityYWorld > WALL_SLIDE_MAX_FALL_SPEED) {
              cluster.velocityYWorld = WALL_SLIDE_MAX_FALL_SPEED;
            }
          }
        }

        if (justLanded) {
          // Reset variable jump sustain on landing
          cluster.varJumpTimerTicks = 0;
          // Fire buffered jump immediately on landing
          if (cluster.jumpBufferTicks > 0) {
            const baseJumpSpeedLand = ov(debugSpeedOverrides.jumpSpeedWorld, PLAYER_JUMP_SPEED_WORLD);
            const landJumpSpeed = cluster.isSkiddingFlag === 1
              ? baseJumpSpeedLand * SKID_JUMP_MULTIPLIER
              : baseJumpSpeedLand;
            cluster.velocityYWorld      = -landJumpSpeed;
            cluster.isGroundedFlag      = 0;
            cluster.jumpBufferTicks     = 0;
            cluster.varJumpTimerTicks   = VAR_JUMP_TIME_TICKS;
            cluster.varJumpSpeedWorld   = -landJumpSpeed;
          }
        } else if (wasGrounded && cluster.isGroundedFlag === 0) {
          // Player walked off a ledge — start coyote time
          cluster.coyoteTimeTicks = COYOTE_TIME_TICKS;
        }
      }

      // ── Clamp horizontal world bounds (ground entities) ─────────────────
      if (cluster.positionXWorld < minX + cluster.halfWidthWorld) {
        cluster.positionXWorld = minX + cluster.halfWidthWorld;
        if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
      } else if (cluster.positionXWorld > maxX - cluster.halfWidthWorld) {
        cluster.positionXWorld = maxX - cluster.halfWidthWorld;
        if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
      }

      // ── Rolling enemy: accumulate roll rotation from horizontal motion ────
      // Only update while grounded so the sprite doesn't spin during free-fall.
      if (cluster.isRollingEnemyFlag === 1 && cluster.isGroundedFlag === 1) {
        cluster.rollingEnemyRollAngleRad +=
          cluster.velocityXWorld * dtSec / ROLLING_ENEMY_SPRITE_RADIUS_WORLD;
        // Keep in [0, 2π) to prevent unbounded growth
        const twoPi = Math.PI * 2.0;
        cluster.rollingEnemyRollAngleRad =
          ((cluster.rollingEnemyRollAngleRad % twoPi) + twoPi) % twoPi;

        // Tick down aggression timer
        if (cluster.rollingEnemyAggressiveTicks > 0) {
          cluster.rollingEnemyAggressiveTicks -= 1;
        }
      }
    }
  } // end for (clusters)

  // ── Update skid debris flag for renderer ──────────────────────────────────
  const player = world.clusters[0];
  if (player !== undefined && player.isAliveFlag === 1 && player.isSkiddingFlag === 1) {
    world.isPlayerSkiddingFlag = 1;
    // Front corner = bottom edge, in the direction the player is sliding
    // (opposite to facing direction since they are skidding)
    const isMovingRight = player.velocityXWorld > 0;
    world.skidDebrisXWorld = isMovingRight
      ? player.positionXWorld + player.halfWidthWorld
      : player.positionXWorld - player.halfWidthWorld;
    world.skidDebrisYWorld = player.positionYWorld + player.halfHeightWorld;
  } else {
    world.isPlayerSkiddingFlag = 0;
  }

  // Clear per-tick player inputs (consumed this tick).
  // playerJumpTriggeredFlag is preserved when grappling so applyGrappleClusterConstraint
  // (step 0.25) can detect the rising edge of a jump press for tap/hold detection.
  world.playerMoveInputDxWorld  = 0.0;
  world.playerMoveInputDyWorld  = 0.0;
  world.playerDashTriggeredFlag = 0;
  if (world.isGrappleActiveFlag === 0) {
    world.playerJumpTriggeredFlag = 0;
  }
}
