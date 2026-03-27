/**
 * Cluster movement — platformer physics with gravity, jumping, and walking.
 *
 * Player movement (Hollow Knight / Celeste inspired):
 *   • A/D keys move the player left/right with crisp, snappy acceleration.
 *   • Higher gravity + fast-fall multiplier makes jumps feel weighty yet agile.
 *   • Variable jump height: releasing the jump key early cuts the upward velocity,
 *     enabling both short hops and full arcs from the same button.
 *   • Coyote time: jump is still allowed for a brief window after walking off a ledge.
 *   • Jump buffer: a jump input received slightly before landing is remembered and
 *     fires as soon as the player touches down.
 *   • Dash (Shift key): horizontal velocity burst on a 3-second cooldown.
 *
 * Enemy movement:
 *   • Enemies walk horizontally toward the player at a fixed speed.
 *   • Gravity is applied so they stand on platforms.
 *   • No enemy jumping — simple patrol / seek behaviour only.
 *
 * Platform & floor collision:
 *   • After integrating position, the cluster box bottom is tested against all
 *     wall top surfaces and the world floor.  When a landing is detected the
 *     cluster is snapped to the surface, vertical velocity is zeroed, and
 *     isGroundedFlag is set to 1.
 *   • Left/right world bounds are enforced with an edge margin.
 *
 * Called as step 0 in the tick pipeline (before all force/integration passes)
 * so cluster anchor positions are stable for the entire tick.
 */

import { WorldState } from '../world';
import { DASH_COOLDOWN_TICKS, DASH_RECHARGE_ANIM_TICKS, ENEMY_DODGE_SPEED_WORLD } from './dashConstants';

// ---- Gravity & jump --------------------------------------------------------
/** Downward acceleration applied each tick (world units per second²). */
const GRAVITY_WORLD_PER_SEC2 = 1100.0;
/**
 * Extra gravity multiplier applied while the player is falling (velocityY > 0).
 * Creates a weighty-landing feel without being overly punishing.
 */
const FALL_GRAVITY_MULTIPLIER = 2.0;
/** Maximum downward fall speed (world units per second) — prevents tunnelling. */
const TERMINAL_VELOCITY_WORLD_PER_SEC = 900.0;
/** Upward impulse applied on jump (world units per second). */
const PLAYER_JUMP_SPEED_WORLD = 700.0;
/**
 * Fraction of upward velocity retained when the jump key is released early.
 * Lower = shorter minimum hop.  Applied only while the player is still rising.
 */
const JUMP_CUT_MULTIPLIER = 0.40;
/**
 * Ticks after leaving a grounded surface during which a jump is still accepted.
 * Gives the player a brief "coyote time" grace window (~0.1 s at 60 fps).
 */
const COYOTE_TIME_TICKS = 6;
/**
 * Ticks a jump input is remembered while the player is airborne.
 * When the player lands while bufferTicks > 0, the jump fires immediately.
 */
const JUMP_BUFFER_TICKS = 8;

// ---- Player walk constants -------------------------------------------------
/** Maximum horizontal speed of the player cluster (world units per second). */
const PLAYER_MAX_SPEED_WORLD_PER_SEC = 300.0;
/** How quickly the player reaches max speed from rest while grounded (snappy). */
const PLAYER_ACCEL_PER_SEC = 60.0;
/** Air-control acceleration — softer than ground to preserve momentum in the air. */
const PLAYER_AIR_ACCEL_PER_SEC = 30.0;
/** Floor friction: how quickly the player stops when grounded and no input is given. */
const PLAYER_GROUND_DECEL_PER_SEC = 80.0;
/** Air drag: minimal deceleration while airborne so the player keeps horizontal momentum. */
const PLAYER_AIR_DECEL_PER_SEC = 10.0;
/** Speed burst applied on a horizontal dash (world units per second). */
const PLAYER_DASH_SPEED_WORLD = 560.0;

// ---- Enemy walk constants --------------------------------------------------
/** Maximum horizontal chase speed for enemy clusters (world units per second). */
const ENEMY_MAX_SPEED_WORLD_PER_SEC = 90.0;
/** Enemy horizontal acceleration rate. */
const ENEMY_ACCEL_PER_SEC = 8.0;
/**
 * Horizontal distance (world units) below which enemies stop advancing.
 * Keeps them in a comfortable attack range.
 */
const ENEMY_ENGAGE_DIST_WORLD = 60.0;

// ---- World bounds ----------------------------------------------------------
/** Horizontal margin from world edges within which clusters are clamped. */
const CLUSTER_EDGE_MARGIN_WORLD = 10.0;
/**
 * Maximum vertical overlap (world units) that still triggers a platform snap.
 * Must exceed the maximum cluster displacement in one tick (≈ terminal velocity / 60).
 */
const PLATFORM_SNAP_TOLERANCE_WORLD = 20.0;
/** Air platforms at or below this thickness remain top-only "thin" obstacles. */
const THIN_OBSTACLE_MAX_HEIGHT_WORLD = 34.0;

/**
 * Checks the cluster box (bottom edge) against all wall top surfaces and the
 * world floor.  When a landing surface is found, snaps the cluster on top of
 * it, zeroes vertical velocity, and sets isGroundedFlag to 1.
 *
 * Only "landing from above" collisions are resolved (velocity ≥ 0 downward or
 * already standing).  Side / ceiling collisions are handled by particle wall
 * forces alone.
 *
 * Returns true if a landing surface was found.
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
    cluster.positionYWorld  = floorY - hh;
    cluster.velocityYWorld  = 0;
    cluster.isGroundedFlag  = 1;
    return true;
  }

  // ── Walls (platforms) ─────────────────────────────────────────────────────
  for (let wi = 0; wi < world.wallCount; wi++) {
    const wallLeft  = world.wallXWorld[wi];
    const wallRight = wallLeft + world.wallWWorld[wi];
    const wallTop   = world.wallYWorld[wi];
    const wallH     = world.wallHWorld[wi];
    if (wallH > THIN_OBSTACLE_MAX_HEIGHT_WORLD) continue;

    // Horizontal overlap required
    if (clusterRight <= wallLeft || clusterLeft >= wallRight) continue;

    // Cluster bottom just passed through or is sitting on the wall top surface
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
 * Returns true if the cluster landed on the top surface of any solid wall this
 * tick.  Used by the caller to trigger buffered jumps consistently on thick
 * platforms (including the main floor) just as thin platforms do via
 * resolveClusterFloorCollision.
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
    const wallLeft = world.wallXWorld[wi];
    const wallTop = world.wallYWorld[wi];
    const wallRight = wallLeft + world.wallWWorld[wi];
    const wallBottom = wallTop + world.wallHWorld[wi];
    const wallH = world.wallHWorld[wi];
    if (wallH <= THIN_OBSTACLE_MAX_HEIGHT_WORLD) continue;

    const left = cluster.positionXWorld - hw;
    const right = cluster.positionXWorld + hw;
    const top = cluster.positionYWorld - hh;
    const bottom = cluster.positionYWorld + hh;
    if (right <= wallLeft || left >= wallRight || bottom <= wallTop || top >= wallBottom) continue;

    const prevLeft = prevX - hw;
    const prevRight = prevX + hw;
    const prevTop = prevY - hh;
    const prevBottom = prevY + hh;

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
      continue;
    }
    if (prevLeft >= wallRight && cluster.velocityXWorld <= 0) {
      cluster.positionXWorld = wallRight + hw;
      if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
      continue;
    }

    const penLeft = right - wallLeft;
    const penRight = wallRight - left;
    const penTop = bottom - wallTop;
    const penBottom = wallBottom - top;
    const minPen = Math.min(penLeft, penRight, penTop, penBottom);

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
    } else {
      cluster.positionXWorld = wallRight + hw;
      if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
    }
  }
  return landed;
}

export function applyClusterMovement(world: WorldState): void {
  const dtSec = world.dtMs / 1000.0;

  // ── Locate the player cluster (needed by enemy AI) ────────────────────────
  let playerX = 0.0;
  let playerFound = false;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isPlayerFlag === 1 && c.isAliveFlag === 1) {
      playerX = c.positionXWorld;
      playerFound = true;
      break;
    }
  }

  const minX = CLUSTER_EDGE_MARGIN_WORLD;
  const maxX = world.worldWidthWorld - CLUSTER_EDGE_MARGIN_WORLD;

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isAliveFlag === 0) continue;

    // ── Apply gravity (with fast-fall multiplier for player) ───────────────
    let gravThisTick = GRAVITY_WORLD_PER_SEC2;
    if (cluster.isPlayerFlag === 1 && cluster.velocityYWorld > 0) {
      gravThisTick *= FALL_GRAVITY_MULTIPLIER;
    }
    cluster.velocityYWorld += gravThisTick * dtSec;
    if (cluster.velocityYWorld > TERMINAL_VELOCITY_WORLD_PER_SEC) {
      cluster.velocityYWorld = TERMINAL_VELOCITY_WORLD_PER_SEC;
    }

    if (cluster.isPlayerFlag === 1) {
      // ── Dash cooldown tick-down ─────────────────────────────────────────
      if (cluster.dashCooldownTicks > 0) {
        cluster.dashCooldownTicks -= 1;
        if (cluster.dashCooldownTicks === 0) {
          cluster.dashRechargeAnimTicks = DASH_RECHARGE_ANIM_TICKS;
        }
      }
      if (cluster.dashRechargeAnimTicks > 0) {
        cluster.dashRechargeAnimTicks -= 1;
      }

      // ── Coyote time tick-down ───────────────────────────────────────────
      if (cluster.coyoteTimeTicks > 0) {
        cluster.coyoteTimeTicks -= 1;
      }

      // ── Jump buffer tick-down ───────────────────────────────────────────
      if (cluster.jumpBufferTicks > 0) {
        cluster.jumpBufferTicks -= 1;
      }

      // ── Variable jump height: cut upward velocity on key-release edge ──
      // Detect the transition from held→not-held to apply the cut exactly once.
      const jumpJustReleased = cluster.prevJumpHeldFlag === 1 && !world.playerJumpHeldFlag;
      if (jumpJustReleased && cluster.velocityYWorld < 0) {
        cluster.velocityYWorld *= JUMP_CUT_MULTIPLIER;
      }
      cluster.prevJumpHeldFlag = world.playerJumpHeldFlag;

      // ── Player horizontal dash burst (one-shot impulse) ─────────────────
      if (world.playerDashTriggeredFlag === 1 && cluster.dashCooldownTicks === 0) {
        const ddx = world.playerDashDirXWorld;
        const dashDirX = ddx !== 0 ? (ddx > 0 ? 1 : -1) : (cluster.velocityXWorld >= 0 ? 1 : -1);
        cluster.velocityXWorld = dashDirX * PLAYER_DASH_SPEED_WORLD;
        cluster.dashCooldownTicks = DASH_COOLDOWN_TICKS;
      }

      // ── Register jump buffer when jump pressed while airborne ───────────
      if (world.playerJumpTriggeredFlag === 1) {
        if (cluster.isGroundedFlag === 1 || cluster.coyoteTimeTicks > 0) {
          // Grounded (or coyote window) — jump immediately
          cluster.velocityYWorld = -PLAYER_JUMP_SPEED_WORLD;
          cluster.isGroundedFlag = 0;
          cluster.coyoteTimeTicks = 0;
        } else {
          // Airborne — buffer the jump
          cluster.jumpBufferTicks = JUMP_BUFFER_TICKS;
        }
        world.playerJumpTriggeredFlag = 0;
      }

      // ── Player horizontal acceleration ───────────────────────────────────
      const inputDx = world.playerMoveInputDxWorld;
      const targetVelX = inputDx * PLAYER_MAX_SPEED_WORLD_PER_SEC;

      let alpha: number;
      if (inputDx !== 0) {
        alpha = (cluster.isGroundedFlag === 1 ? PLAYER_ACCEL_PER_SEC : PLAYER_AIR_ACCEL_PER_SEC) * dtSec;
      } else {
        alpha = (cluster.isGroundedFlag === 1 ? PLAYER_GROUND_DECEL_PER_SEC : PLAYER_AIR_DECEL_PER_SEC) * dtSec;
      }
      if (alpha > 1.0) alpha = 1.0;
      cluster.velocityXWorld += (targetVelX - cluster.velocityXWorld) * alpha;

    } else if (playerFound) {
      // ── Enemy: horizontal walk toward player ───────────────────────────
      const dxToPlayer = playerX - cluster.positionXWorld;
      const absDx = dxToPlayer < 0 ? -dxToPlayer : dxToPlayer;

      let targetVelX = 0.0;
      if (absDx > ENEMY_ENGAGE_DIST_WORLD) {
        targetVelX = (dxToPlayer > 0 ? 1 : -1) * ENEMY_MAX_SPEED_WORLD_PER_SEC;
      } else if (absDx > 10.0) {
        targetVelX = (dxToPlayer > 0 ? 1 : -1) * ENEMY_MAX_SPEED_WORLD_PER_SEC
          * (absDx / ENEMY_ENGAGE_DIST_WORLD);
      }

      // Blend in lateral dodge (X component only for platformer)
      if (cluster.enemyAiDodgeTicks > 0) {
        targetVelX += cluster.enemyAiDodgeDirXWorld * ENEMY_DODGE_SPEED_WORLD;
      }

      const enemyAlpha = ENEMY_ACCEL_PER_SEC * dtSec;
      const clampedEnemyAlpha = enemyAlpha < 1.0 ? enemyAlpha : 1.0;
      cluster.velocityXWorld += (targetVelX - cluster.velocityXWorld) * clampedEnemyAlpha;
    }

    // ── Integrate position ─────────────────────────────────────────────────
    const prevX = cluster.positionXWorld;
    const prevY = cluster.positionYWorld;
    cluster.positionXWorld += cluster.velocityXWorld * dtSec;
    cluster.positionYWorld += cluster.velocityYWorld * dtSec;

    // ── Resolve floor / platform landing ──────────────────────────────────
    const wasGrounded = cluster.isGroundedFlag === 1;
    const thinLanded = resolveClusterFloorCollision(cluster, world);
    const thickLanded = resolveClusterSolidWallCollision(cluster, world, prevX, prevY);
    // justLanded is true for any top-surface landing — thin platform, thick
    // wall (including the main floor), or the world-bottom boundary.
    const justLanded = thinLanded || thickLanded;

    if (cluster.isPlayerFlag === 1) {
      if (justLanded) {
        // Fire buffered jump on landing
        if (cluster.jumpBufferTicks > 0) {
          cluster.velocityYWorld = -PLAYER_JUMP_SPEED_WORLD;
          cluster.isGroundedFlag = 0;
          cluster.jumpBufferTicks = 0;
        }
      } else if (wasGrounded && cluster.isGroundedFlag === 0) {
        // Player just walked off a ledge — start coyote time
        cluster.coyoteTimeTicks = COYOTE_TIME_TICKS;
      }
    }

    // ── Clamp horizontal world bounds ─────────────────────────────────────
    if (cluster.positionXWorld < minX + cluster.halfWidthWorld) {
      cluster.positionXWorld = minX + cluster.halfWidthWorld;
      if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
    } else if (cluster.positionXWorld > maxX - cluster.halfWidthWorld) {
      cluster.positionXWorld = maxX - cluster.halfWidthWorld;
      if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
    }
  }

  // Clear per-tick player inputs
  world.playerMoveInputDxWorld   = 0.0;
  world.playerMoveInputDyWorld   = 0.0;
  world.playerDashTriggeredFlag  = 0;
  world.playerJumpTriggeredFlag  = 0;
}
