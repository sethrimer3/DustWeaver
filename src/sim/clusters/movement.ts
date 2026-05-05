/**
 * Cluster movement — platformer physics for player and enemies.
 *
 * === Player movement design (Celeste-inspired) ===
 *
 * All major tuning constants live in ./movementConstants.ts.
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
import { tickPlayerMovement } from './playerMovement';
import { tickEnemyMovement } from './enemyMovement';

// ============================================================================
// Movement constants — imported from dedicated module for maintainability.
// Re-exports preserve backward compatibility for external consumers.
// ============================================================================

import {
  debugSpeedOverrides,
  ov,
  PLAYER_JUMP_SPEED_WORLD,
  VAR_JUMP_TIME_TICKS,
  COYOTE_TIME_TICKS,
  WALL_SLIDE_MAX_FALL_SPEED,
  WALL_JUMP_GRACE_TICKS,
  SKID_JUMP_MULTIPLIER,
  GRAPPLE_SUPER_JUMP_MULTIPLIER,
  ROLLING_ENEMY_SPRITE_RADIUS_WORLD,
  FLYING_EYE_VERTICAL_MARGIN_WORLD,
  CLUSTER_EDGE_MARGIN_WORLD,
  LANDING_SKID_SPEED_THRESHOLD_WORLD,
  LANDING_SKID_SPEED_FACTOR_MAX,
} from './movementConstants';

// ============================================================================
// Collision helpers — imported from dedicated module for maintainability.
// ============================================================================

import {
  resolveClusterFloorCollision,
  resetClusterGroundedFlag,
  resolveClusterSolidWallCollision,
  resolveRampSurfaces,
} from './movementCollision';
import { resolvePlayerRopeCollisions } from '../ropes/ropeCollision';

export { debugSpeedOverrides, PLAYER_JUMP_SPEED_WORLD, VAR_JUMP_TIME_TICKS, GRAPPLE_SUPER_JUMP_MULTIPLIER };

// ============================================================================
// Main cluster movement update (step 0 of tick pipeline)
// ============================================================================

export function applyClusterMovement(world: WorldState): void {
  const dtSec = world.dtMs / 1000.0;

  // Reset per-tick landing skid factor (set again below if player just landed at high speed).
  world.playerLandingSkidSpeedFactor = 0.0;

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
      tickPlayerMovement(cluster, world, dtSec);
    } else {
      tickEnemyMovement(cluster, world, dtSec, playerX, playerY, playerFound);
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
    } else if (cluster.isBubbleEnemyFlag === 1) {
      // ── Bubble enemy: 2D drift + world-bounds clamp (no wall collision) ─────
      cluster.positionXWorld += cluster.velocityXWorld * dtSec;
      cluster.positionYWorld += cluster.velocityYWorld * dtSec;

      const hw = cluster.halfWidthWorld;
      const hh = cluster.halfHeightWorld;
      const margin = hw;
      if (cluster.positionXWorld < minX + margin) {
        cluster.positionXWorld = minX + margin;
        if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
      } else if (cluster.positionXWorld > maxX - margin) {
        cluster.positionXWorld = maxX - margin;
        if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
      }
      const minYBubble = hh + 4.0;
      const maxYBubble = world.worldHeightWorld - hh - 4.0;
      if (cluster.positionYWorld < minYBubble) {
        cluster.positionYWorld = minYBubble;
        if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
      } else if (cluster.positionYWorld > maxYBubble) {
        cluster.positionYWorld = maxYBubble;
        if (cluster.velocityYWorld > 0) cluster.velocityYWorld = 0;
      }
    } else if (cluster.isGoldenMimicFlag === 1) {
      // ── Golden Mimic: movement and collision handled entirely in goldenMimicAi.ts ──
      // Nothing to do here — velocity is 0 (skipped in tickEnemyMovement) and
      // goldenMimicAi.ts applies its own physics after applyClusterMovement runs.
    } else {
      // ── Resolve ground entity collision (axis-separated sweep) ──────────
      // resolveClusterSolidWallCollision handles its own integration internally
      // (X pass then Y pass with sub-tick safety). It receives prevX/prevY and
      // dtSec to integrate position per-axis.
      const wasGrounded = cluster.isGroundedFlag === 1;
      // Grounding for this tick is rebuilt by collision passes below.
      resetClusterGroundedFlag(cluster);
      const wallResult  = resolveClusterSolidWallCollision(cluster, world, prevX, prevY, dtSec, wasGrounded);
      const thickLanded = wallResult.landed;
      const rampLanded  = resolveRampSurfaces(cluster, world, prevX, prevY);

      // Thin platform / world floor check (position already integrated by solid wall resolver)
      const thinLanded  = resolveClusterFloorCollision(cluster, world);

      // Rope collision — player can stand on and collide with rope capsules.
      // prevY from before integration is used for directional landing detection.
      if (cluster.isPlayerFlag === 1) {
        resolvePlayerRopeCollisions(cluster, world, prevY);
      }

      const justLanded  = thinLanded || thickLanded || rampLanded || cluster.isGroundedFlag === 1;

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
          // Clear wall grace timers — grounded cancels wall coyote time.
          cluster.wallJumpGraceLeftTicks  = 0;
          cluster.wallJumpGraceRightTicks = 0;
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

          // ── Landing skid dust at high horizontal speed ───────────────────
          // When the player touches the ground at above-sprint horizontal speed,
          // trigger skid-dust scaled to the excess speed.
          // factor = 0 at threshold, increasing linearly:
          //   factor = (speed − threshold) / threshold
          // So factor = 1.0 at 2× threshold, 4.0 (max) at 5× threshold.
          const absVx = Math.abs(cluster.velocityXWorld);
          if (absVx > LANDING_SKID_SPEED_THRESHOLD_WORLD) {
            const rawFactor = (absVx - LANDING_SKID_SPEED_THRESHOLD_WORLD)
              / LANDING_SKID_SPEED_THRESHOLD_WORLD;
            world.playerLandingSkidSpeedFactor = Math.min(rawFactor, LANDING_SKID_SPEED_FACTOR_MAX);
          }
        } else if (wasGrounded && cluster.isGroundedFlag === 0) {
          // Player walked off a ledge — start coyote time
          cluster.coyoteTimeTicks = COYOTE_TIME_TICKS;
        }

        // ── Grapple charge refresh on ground contact ─────────────────────────
        // The player can only grapple once while airborne.  Touching the ground
        // restores the charge so they can grapple again.
        if (cluster.isGroundedFlag === 1 || world.isGrappleStuckFlag === 1) {
          world.hasGrappleChargeFlag = 1;
        }
        if (cluster.isGroundedFlag === 1) {
          cluster.hasUsedWallJumpSinceResetFlag = 0;
        }

        // ── Wall jump grace timers: refresh when touching a wall ─────────────
        // Set each frame the wall-touch flag is active so the timer resets to
        // its full window; counts down in tickPlayerMovement via the timer block.
        const graceTicks = ov(debugSpeedOverrides.wallJumpGraceTicks, WALL_JUMP_GRACE_TICKS);
        if (cluster.isTouchingWallLeftFlag === 1) {
          cluster.wallJumpGraceLeftTicks = graceTicks;
        }
        if (cluster.isTouchingWallRightFlag === 1) {
          cluster.wallJumpGraceRightTicks = graceTicks;
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
  // playerLandingSkidSpeedFactor is written above per-tick; read here and by renderer.
  const player = world.clusters[0];
  if (
    player !== undefined &&
    player.isAliveFlag === 1 &&
    (player.isSkiddingFlag === 1 || world.wallJumpSkidDebrisBurstFlag === 1
     || world.playerLandingSkidSpeedFactor > 0)
  ) {
    world.isPlayerSkiddingFlag = 1;
    if (world.playerLandingSkidSpeedFactor > 0) {
      // Landing skid: center the debris on the player's feet, not just a front corner.
      world.skidDebrisXWorld = player.positionXWorld;
      world.skidDebrisYWorld = player.positionYWorld + player.halfHeightWorld;
    } else if (player.isSkiddingFlag === 1) {
      // Normal skid: front corner = bottom edge in the direction the player is sliding
      const isMovingRight = player.velocityXWorld > 0;
      world.skidDebrisXWorld = isMovingRight
        ? player.positionXWorld + player.halfWidthWorld
        : player.positionXWorld - player.halfWidthWorld;
      world.skidDebrisYWorld = player.positionYWorld + player.halfHeightWorld;
    }
  } else {
    world.isPlayerSkiddingFlag = 0;
  }
  world.wallJumpSkidDebrisBurstFlag = 0;

  // Clear per-tick player inputs (consumed this tick).
  // playerJumpTriggeredFlag and playerDownTriggeredFlag are preserved when
  // grappling so applyGrappleClusterConstraint (step 0.25) can detect the
  // rising edge of these inputs for tap/hold detection.
  world.playerMoveInputDxWorld  = 0.0;
  world.playerMoveInputDyWorld  = 0.0;
  if (world.isGrappleActiveFlag === 0) {
    world.playerJumpTriggeredFlag = 0;
    world.playerDownTriggeredFlag = 0;
  }
}
