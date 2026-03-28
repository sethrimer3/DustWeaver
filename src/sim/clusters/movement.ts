/**
 * Cluster movement — platformer physics for player and enemies.
 *
 * === Player movement design (Celeste / Hollow Knight style) ===
 *
 * All major tuning constants are exposed at the top of this file.
 * Jump physics are derived from explicit kinematic targets (jump height and
 * time to apex) so changing the targets produces predictable results.
 *
 * Key features:
 *   • Rise / fall gravity split — heavier fall feels snappier and more readable.
 *   • Variable jump height via jump-cut gravity (applying extra gravity while
 *     rising with the jump key released gives shorter, intentional hops).
 *   • Coyote time — jump still allowed briefly after walking off a ledge.
 *   • Jump buffer — jump input remembered briefly before landing.
 *   • Direct acceleration model — no lerp/alpha blending; forces are applied
 *     per-frame so the player reaches top speed quickly and turns feel snappy.
 *   • Turn acceleration — higher acceleration rate when reversing direction.
 *   • Wall slide — pressing into a solid wall while falling caps descent speed.
 *   • Wall jump — launch away from a wall at a fixed vector; a post-jump
 *     lockout prevents instant re-grab and infinite altitude climbing.
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

// ============================================================================
// Jump physics — derived from kinematic targets
// ============================================================================

/**
 * Target full-jump height in world units.
 * 60 px = exactly 2 standard blocks (each 30 px tall).
 */
const JUMP_HEIGHT_WORLD = 60.0;

/**
 * Time from jump launch to apex (seconds).
 * Shorter = snappier arc; 0.40 s gives a slightly floatier, more forgiving arc.
 */
const TIME_TO_APEX_SEC = 0.40;

/**
 * Rise gravity (px/s²): computed from jump height + apex time.
 *   gravity = (2 × jumpHeight) / (timeToApex²) = 750 px/s²
 * Do not edit directly — change JUMP_HEIGHT_WORLD / TIME_TO_APEX_SEC instead.
 */
const RISE_GRAVITY_WORLD_PER_SEC2 = (2.0 * JUMP_HEIGHT_WORLD) / (TIME_TO_APEX_SEC * TIME_TO_APEX_SEC);

/**
 * Initial upward jump velocity (positive value; negated when applied).
 *   jumpVelocity = gravity × timeToApex = 300 px/s
 * Do not edit directly — change JUMP_HEIGHT_WORLD / TIME_TO_APEX_SEC instead.
 */
const PLAYER_JUMP_SPEED_WORLD = RISE_GRAVITY_WORLD_PER_SEC2 * TIME_TO_APEX_SEC;

/**
 * Fall gravity (px/s²).  Stronger than rise gravity so landings feel weighty
 * and the downward arc is visibly faster than the upward arc.  ~1600 px/s²
 * gives a clean asymmetric feel without being punishing.
 */
const FALL_GRAVITY_WORLD_PER_SEC2 = 1600.0;

/**
 * Jump-cut gravity multiplier.
 * While the player is still rising (velocityY < 0) and the jump key is NOT
 * held, gravity is scaled by this factor — producing a shorter hop on early
 * release without any abrupt velocity clamp.  ~2.5 gives a clean range from
 * short quick hops to full two-block arcs.
 */
const JUMP_CUT_GRAVITY_MULTIPLIER = 2.5;

/** Maximum downward fall speed (px/s).  Prevents tunnelling at high speeds. */
const TERMINAL_VELOCITY_WORLD_PER_SEC = 240.0;

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

/** Maximum horizontal run speed (px/s). */
const MAX_RUN_SPEED_WORLD_PER_SEC = 140.0;

/** Ground acceleration: how quickly the player builds up speed on the ground (px/s²). */
const GROUND_ACCELERATION_PER_SEC2 = 1200.0;

/** Ground deceleration: how quickly the player stops on the ground when no input (px/s²). */
const GROUND_DECELERATION_PER_SEC2 = 1500.0;

/** Air acceleration: slightly reduced control while airborne (px/s²). */
const AIR_ACCELERATION_PER_SEC2 = 900.0;

/** Air deceleration: gentle slowdown while airborne with no input (px/s²). */
const AIR_DECELERATION_PER_SEC2 = 1000.0;

/**
 * Turn acceleration: applied when reversing horizontal direction (px/s²).
 * Higher than ground acceleration so direction changes feel crisp and snappy.
 */
const TURN_ACCELERATION_PER_SEC2 = 2200.0;

/** Speed burst applied on a horizontal dash (px/s). */
const PLAYER_DASH_SPEED_WORLD = 560.0;

// ============================================================================
// Wall slide
// ============================================================================

/**
 * Maximum downward speed while wall-sliding (px/s).
 * The player descends slowly and controllably when pressing into a solid wall
 * in the air.  Only active when the player is pushing toward the wall and the
 * wall-jump lockout is not running.
 */
const WALL_SLIDE_MAX_FALL_SPEED = 80.0;

// ============================================================================
// Wall jump
// ============================================================================

/**
 * Horizontal launch speed away from the wall on a wall jump (px/s).
 * Should exceed MAX_RUN_SPEED so the player is pushed meaningfully away even
 * while holding the opposite direction.
 */
const WALL_JUMP_X_SPEED_WORLD = 160.0;

/**
 * Vertical launch speed on a wall jump (px/s, applied upward).
 * Slightly below a full ground jump to prevent net altitude gain when chaining
 * wall jumps on the same wall.
 */
const WALL_JUMP_Y_SPEED_WORLD = 320.0;

/**
 * Ticks after a wall jump during which the same-side wall sensor is suppressed.
 * Prevents instant re-grab and ensures the player is physically away from the
 * wall before another wall jump becomes available.
 * At 60 fps, 20 ticks ≈ 0.33 s.
 */
const WALL_JUMP_LOCKOUT_TICKS = 20;

// ============================================================================
// Enemy movement
// ============================================================================

/** Maximum horizontal chase speed for enemy clusters (px/s). */
const ENEMY_MAX_SPEED_WORLD_PER_SEC = 90.0;

/** Enemy horizontal acceleration rate (exponential blend factor per second). */
const ENEMY_ACCEL_PER_SEC = 8.0;

/**
 * Horizontal distance (px) below which enemies stop advancing.
 * Keeps them in a comfortable attack range.
 */
const ENEMY_ENGAGE_DIST_WORLD = 60.0;

/**
 * Maximum line-of-sight range for rolling enemies (world units).
 * Rolling enemies only chase the player when within this distance,
 * or when recently damaged (rollingEnemyAggressiveTicks > 0).
 * ~20 blocks at BLOCK_SIZE_WORLD = 15.
 */
const ROLLING_ENEMY_SIGHT_RANGE_WORLD = 300.0;

/**
 * Effective rolling radius (world units) used to convert horizontal
 * displacement to sprite rotation.  A smaller value = spins faster.
 */
const ROLLING_ENEMY_SPRITE_RADIUS_WORLD = 5.0;

// ── Player sprite rotation ──────────────────────────────────────────────────

/** Rotation rate (radians/tick) for the player sprite while idle/moving. */
const PLAYER_SPRITE_ROTATION_SLOW_RAD_PER_TICK = 0.012;

/** Rotation rate (radians/tick) for the player sprite while blocking. */
const PLAYER_SPRITE_ROTATION_FAST_RAD_PER_TICK = 0.10;

// ============================================================================
// Flying eye movement
// ============================================================================

/** Maximum 2D flight speed of flying eye clusters (world units/s). */
const FLYING_EYE_SPEED_WORLD_PER_SEC = 95.0;

/** Acceleration alpha per second for flying eye 2D steering (exponential blend). */
const FLYING_EYE_ACCEL_PER_SEC = 5.5;

/**
 * Preferred hover distance from the player.
 * The eye will approach if farther and retreat if closer.
 */
const FLYING_EYE_PREFERRED_DIST_WORLD = 175.0;

/** Dead-band half-width around preferred hover distance.  Inside the band the eye orbits. */
const FLYING_EYE_PREFERRED_BAND_WORLD = 35.0;

/** Angular rate (radians/second) at which the facing angle tracks the velocity direction. */
const FLYING_EYE_TURN_RATE_PER_SEC = 7.0;

/** Vertical margin from world top/bottom within which flying eyes are clamped. */
const FLYING_EYE_VERTICAL_MARGIN_WORLD = 30.0;

// ============================================================================
// World bounds
// ============================================================================

/** Horizontal margin from world edges within which clusters are clamped. */
const CLUSTER_EDGE_MARGIN_WORLD = 10.0;

/**
 * Maximum vertical overlap (px) that still triggers a platform snap.
 * Must exceed the maximum cluster displacement per tick (≈ terminal vel / 60).
 */
const PLATFORM_SNAP_TOLERANCE_WORLD = 20.0;

/** Walls at or below this height are treated as top-surface-only thin platforms. */
const THIN_OBSTACLE_MAX_HEIGHT_WORLD = 34.0;

// ============================================================================
// Collision helpers
// ============================================================================

/**
 * Resolves the cluster box against the world floor and thin platform top surfaces.
 * Resets isGroundedFlag to 0 on entry, then sets it to 1 if a landing is found.
 * Returns true if the cluster landed this tick.
 */
function resolveClusterFloorCollision(cluster: import('./state').ClusterState, world: WorldState): boolean {
  cluster.isGroundedFlag = 0;

  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;
  const clusterLeft   = cluster.positionXWorld - hw;
  const clusterRight  = cluster.positionXWorld + hw;
  const clusterBottom = cluster.positionYWorld + hh;

  // ── World floor ───────────────────────────────────────────────────────────
  const floorY = world.worldHeightWorld;
  if (clusterBottom >= floorY) {
    cluster.positionYWorld = floorY - hh;
    cluster.velocityYWorld = 0;
    cluster.isGroundedFlag = 1;
    return true;
  }

  // ── Thin wall top surfaces ─────────────────────────────────────────────────
  for (let wi = 0; wi < world.wallCount; wi++) {
    const wallLeft  = world.wallXWorld[wi];
    const wallRight = wallLeft + world.wallWWorld[wi];
    const wallTop   = world.wallYWorld[wi];
    const wallH     = world.wallHWorld[wi];
    if (wallH > THIN_OBSTACLE_MAX_HEIGHT_WORLD) continue;

    if (clusterRight <= wallLeft || clusterLeft >= wallRight) continue;

    if (
      clusterBottom >= wallTop &&
      clusterBottom <= wallTop + PLATFORM_SNAP_TOLERANCE_WORLD &&
      cluster.velocityYWorld >= 0
    ) {
      cluster.positionYWorld = wallTop - hh;
      cluster.velocityYWorld = 0;
      cluster.isGroundedFlag = 1;
      return true;
    }
  }
  return false;
}

/**
 * Resolves the cluster against solid (thick) wall boxes using a sweep-based
 * axis-priority test.  Sets isGroundedFlag for top-surface landings.
 *
 * Also sets isTouchingWallLeftFlag / isTouchingWallRightFlag on the player
 * cluster when it is pushed out of a wall's left or right face — these flags
 * are used this tick for wall-slide capping and next tick for wall-jump input.
 *
 * Returns true if the cluster landed on a top surface this tick.
 */
function resolveClusterSolidWallCollision(
  cluster: import('./state').ClusterState,
  world: WorldState,
  prevX: number,
  prevY: number,
): boolean {
  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;
  let landed = false;

  for (let wi = 0; wi < world.wallCount; wi++) {
    const wallLeft   = world.wallXWorld[wi];
    const wallTop    = world.wallYWorld[wi];
    const wallRight  = wallLeft + world.wallWWorld[wi];
    const wallBottom = wallTop  + world.wallHWorld[wi];
    const wallH      = world.wallHWorld[wi];
    if (wallH <= THIN_OBSTACLE_MAX_HEIGHT_WORLD) continue;

    const left   = cluster.positionXWorld - hw;
    const right  = cluster.positionXWorld + hw;
    const top    = cluster.positionYWorld - hh;
    const bottom = cluster.positionYWorld + hh;
    if (right <= wallLeft || left >= wallRight || bottom <= wallTop || top >= wallBottom) continue;

    const prevLeft   = prevX - hw;
    const prevRight  = prevX + hw;
    const prevTop    = prevY - hh;
    const prevBottom = prevY + hh;

    // ── Sweep-based exact face detection ──────────────────────────────────
    if (prevBottom <= wallTop && cluster.velocityYWorld >= 0) {
      cluster.positionYWorld = wallTop - hh;
      cluster.velocityYWorld = 0;
      cluster.isGroundedFlag = 1;
      landed = true;
      continue;
    }
    if (prevTop >= wallBottom && cluster.velocityYWorld <= 0) {
      cluster.positionYWorld = wallBottom + hh;
      if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
      continue;
    }
    if (prevRight <= wallLeft && cluster.velocityXWorld >= 0) {
      cluster.positionXWorld = wallLeft - hw;
      if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
      if (cluster.isPlayerFlag === 1) cluster.isTouchingWallRightFlag = 1;
      continue;
    }
    if (prevLeft >= wallRight && cluster.velocityXWorld <= 0) {
      cluster.positionXWorld = wallRight + hw;
      if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
      if (cluster.isPlayerFlag === 1) cluster.isTouchingWallLeftFlag = 1;
      continue;
    }

    // ── Fallback: minimum-penetration axis resolution ──────────────────────
    const penLeft   = right  - wallLeft;
    const penRight  = wallRight  - left;
    const penTop    = bottom - wallTop;
    const penBottom = wallBottom - top;
    const minPen    = Math.min(penLeft, penRight, penTop, penBottom);

    if (minPen === penTop) {
      cluster.positionYWorld = wallTop - hh;
      cluster.velocityYWorld = 0;
      cluster.isGroundedFlag = 1;
      landed = true;
    } else if (minPen === penBottom) {
      cluster.positionYWorld = wallBottom + hh;
      if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
    } else if (minPen === penLeft) {
      cluster.positionXWorld = wallLeft - hw;
      if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
      if (cluster.isPlayerFlag === 1) cluster.isTouchingWallRightFlag = 1;
    } else {
      cluster.positionXWorld = wallRight + hw;
      if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
      if (cluster.isPlayerFlag === 1) cluster.isTouchingWallLeftFlag = 1;
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

      // ── Update player sprite rotation ─────────────────────────────────
      {
        const rotRate = world.isPlayerBlockingFlag === 1
          ? PLAYER_SPRITE_ROTATION_FAST_RAD_PER_TICK
          : PLAYER_SPRITE_ROTATION_SLOW_RAD_PER_TICK;
        cluster.playerRotationAngleRad += rotRate;
        if (cluster.playerRotationAngleRad >= Math.PI * 2.0) {
          cluster.playerRotationAngleRad -= Math.PI * 2.0;
        }
      }

      // ── Apply gravity (rise / fall split + jump-cut multiplier) ────────
      // When grappling, use consistent gravity (no jump-cut multiplier, no
      // asymmetric rise/fall) for a natural pendulum feel.  The grapple
      // constraint (step 0.25) handles the actual swing physics.
      let grav: number;
      if (world.isGrappleActiveFlag === 1) {
        // Consistent gravity for pendulum swing — use the base rise gravity
        // for both directions so the arc is symmetric and physically convincing.
        grav = RISE_GRAVITY_WORLD_PER_SEC2;
      } else if (cluster.velocityYWorld < 0) {
        // Rising: use heavier gravity if the jump key was released early,
        // giving a shorter hop without any abrupt velocity clamp.
        grav = world.playerJumpHeldFlag === 1
          ? RISE_GRAVITY_WORLD_PER_SEC2
          : RISE_GRAVITY_WORLD_PER_SEC2 * JUMP_CUT_GRAVITY_MULTIPLIER;
      } else {
        // Falling: stronger gravity for a snappier, more readable descent.
        grav = FALL_GRAVITY_WORLD_PER_SEC2;
      }
      cluster.velocityYWorld += grav * dtSec;
      // Skip terminal velocity cap during grapple — the swing can legitimately
      // exceed the normal fall speed cap without causing tunnelling issues
      // because the rope constraint clamps displacement each tick.
      if (world.isGrappleActiveFlag === 0 &&
          cluster.velocityYWorld > TERMINAL_VELOCITY_WORLD_PER_SEC) {
        cluster.velocityYWorld = TERMINAL_VELOCITY_WORLD_PER_SEC;
      }

      // ── Dash burst (one-shot horizontal impulse) ─────────────────────────
      if (world.playerDashTriggeredFlag === 1 && cluster.dashCooldownTicks === 0) {
        const ddx = world.playerDashDirXWorld;
        const dashDirX = ddx !== 0 ? (ddx > 0 ? 1 : -1) : (cluster.velocityXWorld >= 0 ? 1 : -1);
        cluster.velocityXWorld = dashDirX * PLAYER_DASH_SPEED_WORLD;
        cluster.dashCooldownTicks = DASH_COOLDOWN_TICKS;
      }

      // ── Jump trigger ─────────────────────────────────────────────────────
      // While the grapple is active the jump button controls rope pull-in
      // (handled in grapple.ts step 0.25), so normal / wall jumps are skipped.
      if (world.playerJumpTriggeredFlag === 1 && world.isGrappleActiveFlag === 0) {
        if (cluster.isGroundedFlag === 1 || cluster.coyoteTimeTicks > 0) {
          // ── Normal ground jump ─────────────────────────────────────────
          cluster.velocityYWorld  = -PLAYER_JUMP_SPEED_WORLD;
          cluster.isGroundedFlag  = 0;
          cluster.coyoteTimeTicks = 0;
        } else {
          // ── Wall jump (uses wall-touch flags from the previous tick) ───
          // The flags persist from last tick's collision resolution so they
          // are available here before this tick's position integration.
          const canJumpFromLeft  = cluster.isTouchingWallLeftFlag  === 1
                                && cluster.wallJumpLockoutTicks === 0;
          const canJumpFromRight = cluster.isTouchingWallRightFlag === 1
                                && cluster.wallJumpLockoutTicks === 0;

          if (canJumpFromLeft || canJumpFromRight) {
            // wallDir = +1 if wall is to the right, -1 if wall is to the left
            const wallDir = canJumpFromRight ? 1 : -1;
            // Launch away: horizontal component opposes wallDir
            cluster.velocityXWorld       = -wallDir * WALL_JUMP_X_SPEED_WORLD;
            cluster.velocityYWorld       = -WALL_JUMP_Y_SPEED_WORLD;
            cluster.wallJumpLockoutTicks = WALL_JUMP_LOCKOUT_TICKS;
            cluster.isWallSlidingFlag    = 0;
            cluster.coyoteTimeTicks      = 0;
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
      const inputDx   = world.playerMoveInputDxWorld;
      const isGrounded = cluster.isGroundedFlag === 1;

      if (world.isGrappleActiveFlag === 0) {
        // Direct force accumulation gives responsive control without the
        // slipperiness of a pure lerp approach.
        if (inputDx !== 0) {
          // Reversing direction uses a higher turn acceleration for snappy feel
          const isTurning = (inputDx > 0 && cluster.velocityXWorld < -1.0) ||
                            (inputDx < 0 && cluster.velocityXWorld >  1.0);
          let accel: number;
          if (isTurning) {
            accel = TURN_ACCELERATION_PER_SEC2;
          } else if (isGrounded) {
            accel = GROUND_ACCELERATION_PER_SEC2;
          } else {
            accel = AIR_ACCELERATION_PER_SEC2;
          }
          cluster.velocityXWorld += inputDx * accel * dtSec;
          // Clamp to max run speed only in the direction of input
          if (inputDx > 0 && cluster.velocityXWorld > MAX_RUN_SPEED_WORLD_PER_SEC) {
            cluster.velocityXWorld = MAX_RUN_SPEED_WORLD_PER_SEC;
          } else if (inputDx < 0 && cluster.velocityXWorld < -MAX_RUN_SPEED_WORLD_PER_SEC) {
            cluster.velocityXWorld = -MAX_RUN_SPEED_WORLD_PER_SEC;
          }
        } else {
          // No horizontal input — decelerate toward zero
          const decel = isGrounded ? GROUND_DECELERATION_PER_SEC2 : AIR_DECELERATION_PER_SEC2;
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

    } else {
      // ── Ground enemy: gravity ───────────────────────────────────────────────
      cluster.velocityYWorld += RISE_GRAVITY_WORLD_PER_SEC2 * dtSec;
      if (cluster.velocityYWorld > TERMINAL_VELOCITY_WORLD_PER_SEC) {
        cluster.velocityYWorld = TERMINAL_VELOCITY_WORLD_PER_SEC;
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

    // ── Integrate position ─────────────────────────────────────────────────
    const prevX = cluster.positionXWorld;
    const prevY = cluster.positionYWorld;
    cluster.positionXWorld += cluster.velocityXWorld * dtSec;
    cluster.positionYWorld += cluster.velocityYWorld * dtSec;

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
      // ── Flying eye: clamp to world bounds in both axes (no floor landing) ─
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
    } else {
      // ── Resolve floor / platform landing (ground entities only) ──────────
      const wasGrounded = cluster.isGroundedFlag === 1;
      const thinLanded  = resolveClusterFloorCollision(cluster, world);
      const thickLanded = resolveClusterSolidWallCollision(cluster, world, prevX, prevY);
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
          // Fire buffered jump immediately on landing
          if (cluster.jumpBufferTicks > 0) {
            cluster.velocityYWorld  = -PLAYER_JUMP_SPEED_WORLD;
            cluster.isGroundedFlag  = 0;
            cluster.jumpBufferTicks = 0;
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
