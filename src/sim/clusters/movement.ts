/**
 * Cluster movement with smooth acceleration and deceleration.
 *
 * Clusters are the anchor points around which particles orbit.  Moving a
 * cluster smoothly (rather than teleporting) gives players and enemies the
 * feel of momentum: a quick ramp-up when moving and a natural slow-down
 * (drag) when stopping.
 *
 * Player movement:
 *   • Reads world.playerMoveInputDxWorld / playerMoveInputDyWorld (set by
 *     game screen each frame from the directional input).
 *   • Accelerates the cluster velocity toward (input * MAX_SPEED).
 *   • When input is zero the velocity decelerates via drag.
 *   • Dash (world.playerDashTriggeredFlag): one-shot velocity burst in the
 *     current move direction.  3-second recharge.
 *
 * Enemy movement (AI-driven seek + dodge):
 *   • Each non-player alive cluster accelerates toward the player cluster.
 *   • Enemies slow when within a comfortable combat range so they don't
 *     endlessly ram the player.
 *   • When the enemy AI has triggered a dodge (enemyAiDodgeTicks > 0), the
 *     lateral dodge velocity is blended in on top of the seek velocity.
 *
 * Position is updated from velocity; clusters are clamped to world bounds
 * with a margin so they never exit the arena.
 *
 * Called as step 0 in the tick pipeline (before all force/integration passes)
 * so cluster anchor positions are stable for the entire tick.
 */

import { WorldState } from '../world';
import { DASH_COOLDOWN_TICKS, DASH_RECHARGE_ANIM_TICKS, ENEMY_DASH_SPEED_WORLD } from './enemyAi';

// ---- Player constants ------------------------------------------------------
/** Maximum speed of the player cluster (world units per second). */
const PLAYER_MAX_SPEED_WORLD_PER_SEC = 180.0;
/** Responsiveness of speed change per second (higher = snappier acceleration). */
const PLAYER_ACCEL_PER_SEC = 14.0;
/** Speed burst applied on a dash (world units per second). */
const PLAYER_DASH_SPEED_WORLD = 480.0;

// ---- Enemy constants -------------------------------------------------------
/** Maximum chase speed for enemy clusters (world units per second). */
const ENEMY_MAX_SPEED_WORLD_PER_SEC = 75.0;
/** Enemy acceleration rate — slower than player for a lumbering feel. */
const ENEMY_ACCEL_PER_SEC = 3.5;
/**
 * Distance (world units) below which enemies slow down and stop chasing.
 * At this range the enemy's particles are already reaching the player.
 */
const ENEMY_ENGAGE_DIST_WORLD = 140.0;

/** Margin from world edges within which clusters are clamped. */
const CLUSTER_EDGE_MARGIN_WORLD = 50.0;

export function applyClusterMovement(world: WorldState): void {
  const dtSec = world.dtMs / 1000.0;

  // ── Find the player cluster position ──────────────────────────────────────
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
  const minY = CLUSTER_EDGE_MARGIN_WORLD;
  const maxX = world.worldWidthWorld  - CLUSTER_EDGE_MARGIN_WORLD;
  const maxY = world.worldHeightWorld - CLUSTER_EDGE_MARGIN_WORLD;

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const cluster = world.clusters[ci];
    if (cluster.isAliveFlag === 0) continue;

    if (cluster.isPlayerFlag === 1) {
      // ── Player dash cooldown tick-down ─────────────────────────────────────
      if (cluster.dashCooldownTicks > 0) {
        cluster.dashCooldownTicks -= 1;
        if (cluster.dashCooldownTicks === 0) {
          cluster.dashRechargeAnimTicks = DASH_RECHARGE_ANIM_TICKS;
        }
      }
      if (cluster.dashRechargeAnimTicks > 0) {
        cluster.dashRechargeAnimTicks -= 1;
      }

      // ── Player dash burst (one-shot impulse) ───────────────────────────────
      if (world.playerDashTriggeredFlag === 1 && cluster.dashCooldownTicks === 0) {
        const ddx = world.playerDashDirXWorld;
        const ddy = world.playerDashDirYWorld;
        const dLen = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dLen > 0.01) {
          cluster.velocityXWorld = (ddx / dLen) * PLAYER_DASH_SPEED_WORLD;
          cluster.velocityYWorld = (ddy / dLen) * PLAYER_DASH_SPEED_WORLD;
        } else {
          const cLen = Math.sqrt(
            cluster.velocityXWorld * cluster.velocityXWorld +
            cluster.velocityYWorld * cluster.velocityYWorld);
          if (cLen > 1.0) {
            cluster.velocityXWorld = (cluster.velocityXWorld / cLen) * PLAYER_DASH_SPEED_WORLD;
            cluster.velocityYWorld = (cluster.velocityYWorld / cLen) * PLAYER_DASH_SPEED_WORLD;
          }
        }
        cluster.dashCooldownTicks = DASH_COOLDOWN_TICKS;
      }

      // ── Player: smooth acceleration toward input direction ─────────────────
      const inputDx = world.playerMoveInputDxWorld;
      const inputDy = world.playerMoveInputDyWorld;

      const targetVelX = inputDx * PLAYER_MAX_SPEED_WORLD_PER_SEC;
      const targetVelY = inputDy * PLAYER_MAX_SPEED_WORLD_PER_SEC;

      // Exponential approach: vel += (target - vel) * alpha * dt
      const alpha = PLAYER_ACCEL_PER_SEC * dtSec;
      const clampedAlpha = alpha < 1.0 ? alpha : 1.0;  // prevent overshoot
      cluster.velocityXWorld += (targetVelX - cluster.velocityXWorld) * clampedAlpha;
      cluster.velocityYWorld += (targetVelY - cluster.velocityYWorld) * clampedAlpha;

    } else if (playerFound) {
      // ── Enemy: accelerate toward player, slow when close ──────────────────
      const dxToPlayer = playerX - cluster.positionXWorld;
      const dyToPlayer = playerY - cluster.positionYWorld;
      const distToPlayer = Math.sqrt(dxToPlayer * dxToPlayer + dyToPlayer * dyToPlayer);

      // Reduce speed as we approach the engagement distance
      let speedFraction = 1.0;
      if (distToPlayer < ENEMY_ENGAGE_DIST_WORLD) {
        speedFraction = distToPlayer / ENEMY_ENGAGE_DIST_WORLD;
      }
      const targetSpeed = ENEMY_MAX_SPEED_WORLD_PER_SEC * speedFraction;

      let targetVelX = 0.0;
      let targetVelY = 0.0;
      if (distToPlayer > 1.0) {
        const invDist = 1.0 / distToPlayer;
        targetVelX = (dxToPlayer * invDist) * targetSpeed;
        targetVelY = (dyToPlayer * invDist) * targetSpeed;
      }

      // ── Blend in dodge/weave lateral velocity ─────────────────────────────
      if (cluster.enemyAiDodgeTicks > 0) {
        targetVelX += cluster.enemyAiDodgeDirXWorld * ENEMY_DASH_SPEED_WORLD;
        targetVelY += cluster.enemyAiDodgeDirYWorld * ENEMY_DASH_SPEED_WORLD;
      }

      const alpha = ENEMY_ACCEL_PER_SEC * dtSec;
      const clampedAlpha = alpha < 1.0 ? alpha : 1.0;
      cluster.velocityXWorld += (targetVelX - cluster.velocityXWorld) * clampedAlpha;
      cluster.velocityYWorld += (targetVelY - cluster.velocityYWorld) * clampedAlpha;
    }

    // ── Integrate position ─────────────────────────────────────────────────
    cluster.positionXWorld += cluster.velocityXWorld * dtSec;
    cluster.positionYWorld += cluster.velocityYWorld * dtSec;

    // ── Clamp to world bounds ──────────────────────────────────────────────
    if (cluster.positionXWorld < minX) {
      cluster.positionXWorld = minX;
      if (cluster.velocityXWorld < 0) cluster.velocityXWorld = 0;
    } else if (cluster.positionXWorld > maxX) {
      cluster.positionXWorld = maxX;
      if (cluster.velocityXWorld > 0) cluster.velocityXWorld = 0;
    }
    if (cluster.positionYWorld < minY) {
      cluster.positionYWorld = minY;
      if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
    } else if (cluster.positionYWorld > maxY) {
      cluster.positionYWorld = maxY;
      if (cluster.velocityYWorld > 0) cluster.velocityYWorld = 0;
    }
  }

  // Clear player move input and dash trigger for next tick
  world.playerMoveInputDxWorld = 0.0;
  world.playerMoveInputDyWorld = 0.0;
  world.playerDashTriggeredFlag = 0;
}
