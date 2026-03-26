/**
 * Cluster movement — platformer physics with gravity, jumping, and walking.
 *
 * Player movement:
 *   • A/D keys move the player left/right with smooth acceleration.
 *   • Gravity is applied every tick, pulling clusters downward.
 *   • Jump (world.playerJumpTriggeredFlag): applies an upward velocity impulse
 *     when the player is grounded.
 *   • Dash (world.playerDashTriggeredFlag): horizontal velocity burst (Shift key).
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
const GRAVITY_WORLD_PER_SEC2 = 900.0;
/** Maximum downward fall speed (world units per second) — prevents tunnelling. */
const TERMINAL_VELOCITY_WORLD_PER_SEC = 650.0;
/** Upward impulse applied on jump (world units per second). */
const PLAYER_JUMP_SPEED_WORLD = 575.0;

// ---- Player walk constants -------------------------------------------------
/** Maximum horizontal speed of the player cluster (world units per second). */
const PLAYER_MAX_SPEED_WORLD_PER_SEC = 200.0;
/** How quickly the player reaches max speed from rest (higher = snappier). */
const PLAYER_ACCEL_PER_SEC = 18.0;
/** How quickly the player decelerates when no input is given. */
const PLAYER_DECEL_PER_SEC = 26.0;
/** Speed burst applied on a horizontal dash (world units per second). */
const PLAYER_DASH_SPEED_WORLD = 480.0;

// ---- Enemy walk constants --------------------------------------------------
/** Maximum horizontal chase speed for enemy clusters (world units per second). */
const ENEMY_MAX_SPEED_WORLD_PER_SEC = 80.0;
/** Enemy horizontal acceleration rate. */
const ENEMY_ACCEL_PER_SEC = 5.0;
/**
 * Horizontal distance (world units) below which enemies stop advancing.
 * Keeps them in a comfortable attack range.
 */
const ENEMY_ENGAGE_DIST_WORLD = 130.0;

// ---- World bounds ----------------------------------------------------------
/** Horizontal margin from world edges within which clusters are clamped. */
const CLUSTER_EDGE_MARGIN_WORLD = 10.0;
/**
 * Maximum vertical overlap (world units) that still triggers a platform snap.
 * Must exceed the maximum cluster displacement in one tick (≈ terminal velocity / 60).
 */
const PLATFORM_SNAP_TOLERANCE_WORLD = 30.0;

/**
 * Checks the cluster box (bottom edge) against all wall top surfaces and the
 * world floor.  When a landing surface is found, snaps the cluster on top of
 * it, zeroes vertical velocity, and sets isGroundedFlag to 1.
 *
 * Only "landing from above" collisions are resolved (velocity ≥ 0 downward or
 * already standing).  Side / ceiling collisions are handled by particle wall
 * forces alone.
 */
function resolveClusterFloorCollision(cluster: import('./state').ClusterState, world: WorldState): void {
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
    return;
  }

  // ── Walls (platforms) ─────────────────────────────────────────────────────
  for (let wi = 0; wi < world.wallCount; wi++) {
    const wallLeft  = world.wallXWorld[wi];
    const wallRight = wallLeft + world.wallWWorld[wi];
    const wallTop   = world.wallYWorld[wi];

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
      return;
    }
  }
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

    // ── Apply gravity ──────────────────────────────────────────────────────
    cluster.velocityYWorld += GRAVITY_WORLD_PER_SEC2 * dtSec;
    if (cluster.velocityYWorld > TERMINAL_VELOCITY_WORLD_PER_SEC) {
      cluster.velocityYWorld = TERMINAL_VELOCITY_WORLD_PER_SEC;
    }

    if (cluster.isPlayerFlag === 1) {
      // ── Player dash cooldown tick-down ─────────────────────────────────
      if (cluster.dashCooldownTicks > 0) {
        cluster.dashCooldownTicks -= 1;
        if (cluster.dashCooldownTicks === 0) {
          cluster.dashRechargeAnimTicks = DASH_RECHARGE_ANIM_TICKS;
        }
      }
      if (cluster.dashRechargeAnimTicks > 0) {
        cluster.dashRechargeAnimTicks -= 1;
      }

      // ── Player horizontal dash burst (one-shot impulse) ────────────────
      if (world.playerDashTriggeredFlag === 1 && cluster.dashCooldownTicks === 0) {
        // Dash horizontally in movement direction or toward cursor
        const ddx = world.playerDashDirXWorld;
        const dashDirX = ddx !== 0 ? (ddx > 0 ? 1 : -1) : (cluster.velocityXWorld >= 0 ? 1 : -1);
        cluster.velocityXWorld = dashDirX * PLAYER_DASH_SPEED_WORLD;
        cluster.dashCooldownTicks = DASH_COOLDOWN_TICKS;
      }

      // ── Player jump impulse ────────────────────────────────────────────
      if (world.playerJumpTriggeredFlag === 1 && cluster.isGroundedFlag === 1) {
        cluster.velocityYWorld = -PLAYER_JUMP_SPEED_WORLD;
        cluster.isGroundedFlag = 0;
      }

      // ── Player horizontal acceleration ────────────────────────────────
      const inputDx = world.playerMoveInputDxWorld;
      const targetVelX = inputDx * PLAYER_MAX_SPEED_WORLD_PER_SEC;

      let alpha: number;
      if (inputDx !== 0) {
        alpha = PLAYER_ACCEL_PER_SEC * dtSec;
      } else {
        alpha = PLAYER_DECEL_PER_SEC * dtSec;
      }
      if (alpha > 1.0) alpha = 1.0;
      cluster.velocityXWorld += (targetVelX - cluster.velocityXWorld) * alpha;

    } else if (playerFound) {
      // ── Enemy: horizontal walk toward player ───────────────────────────
      const dxToPlayer = playerX - cluster.positionXWorld;
      const absDx = dxToPlayer < 0 ? -dxToPlayer : dxToPlayer;

      let targetVelX = 0.0;
      if (absDx > ENEMY_ENGAGE_DIST_WORLD) {
        // Walk toward player
        targetVelX = (dxToPlayer > 0 ? 1 : -1) * ENEMY_MAX_SPEED_WORLD_PER_SEC;
      } else if (absDx > 10.0) {
        // Slow approach inside engage range
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
    cluster.positionXWorld += cluster.velocityXWorld * dtSec;
    cluster.positionYWorld += cluster.velocityYWorld * dtSec;

    // ── Resolve floor / platform landing ──────────────────────────────────
    resolveClusterFloorCollision(cluster, world);

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
