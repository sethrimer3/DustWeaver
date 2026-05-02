/**
 * Rope collision resolution for the player cluster.
 *
 * Ropes are treated as capsule chains: each consecutive pair of Verlet nodes
 * forms a capsule of radius ropeHalfThickWorld.  The player AABB is tested
 * against each capsule using a closest-point-on-segment vs. AABB test.
 *
 * Only the player cluster is processed (isPlayerFlag=1).  Enemy clusters
 * pass through ropes without collision — this keeps the system simple and
 * avoids expensive O(enemies × rope_segments) checks every tick.
 *
 * Player weight effect: when the player stands on a rope, the two nearest
 * nodes are pushed down slightly each tick, making the rope visibly sag
 * under the player's weight.
 */

import type { WorldState } from '../world';
import { MAX_ROPE_SEGMENTS } from '../world';
import type { ClusterState } from '../clusters/state';
import { COLLISION_EPSILON } from '../clusters/movementConstants';

/**
 * Downward displacement (world units per tick) applied to rope nodes directly
 * under the player when they are standing on the rope.  Creates visible sag.
 */
const ROPE_PLAYER_WEIGHT_PUSH_WORLD = 0.15;

/**
 * Resolves the player cluster against all rope capsules.
 *
 * Must be called *after* `resolveClusterSolidWallCollision` so that the
 * player is already pushed out of solid walls before rope contact is tested.
 *
 * @param cluster  The player cluster (must have isPlayerFlag=1).
 * @param world    Current world state — rope buffers and wall buffers.
 * @param prevY    Player Y position before this tick's integration step
 *                 (used to determine whether the player arrived from above).
 */
export function resolvePlayerRopeCollisions(
  cluster: ClusterState,
  world: WorldState,
  prevY: number,
): void {
  if (world.ropeCount === 0) return;
  if (cluster.isPlayerFlag === 0) return;

  const hw = cluster.halfWidthWorld;
  const hh = cluster.halfHeightWorld;
  const prevBottom = prevY + hh;

  for (let r = 0; r < world.ropeCount; r++) {
    const segCount = world.ropeSegmentCount[r];
    if (segCount < 2) continue;

    const halfThick = world.ropeHalfThickWorld[r];
    const base = r * MAX_ROPE_SEGMENTS;

    for (let s = 0; s < segCount - 1; s++) {
      const ax = world.ropeSegPosXWorld[base + s];
      const ay = world.ropeSegPosYWorld[base + s];
      const bx = world.ropeSegPosXWorld[base + s + 1];
      const by = world.ropeSegPosYWorld[base + s + 1];

      const px = cluster.positionXWorld;
      const py = cluster.positionYWorld;

      // ── Closest point on segment [A,B] to player center ──────────────
      const segDx = bx - ax;
      const segDy = by - ay;
      const lenSq = segDx * segDx + segDy * segDy;
      if (lenSq < 0.01) continue;

      const t = Math.max(0.0, Math.min(1.0,
        ((px - ax) * segDx + (py - ay) * segDy) / lenSq,
      ));
      const cpx = ax + t * segDx;
      const cpy = ay + t * segDy;

      // ── Closest point on player AABB to rope closest point ───────────
      // (This is the point on the AABB surface nearest to the rope.)
      const qx = Math.max(px - hw, Math.min(px + hw, cpx));
      const qy = Math.max(py - hh, Math.min(py + hh, cpy));

      // Vector from Q (AABB surface) to P (rope closest point)
      const distX = cpx - qx;
      const distY = cpy - qy;
      const dist  = Math.sqrt(distX * distX + distY * distY);

      if (dist >= halfThick) continue; // No penetration

      // ── Resolve penetration ─────────────────────────────────────────
      if (dist < 0.0001) {
        // Degenerate: player center is exactly on rope — push upward.
        cluster.positionYWorld = cpy - halfThick - hh;
        if (cluster.velocityYWorld > 0) cluster.velocityYWorld = 0;
        cluster.isGroundedFlag = 1;
        _applyPlayerWeightToRope(world, r, base, s, t);
        continue;
      }

      // Push direction: away from rope (Q toward player).
      const nx = -distX / dist;  // direction from rope CP toward player
      const ny = -distY / dist;
      const pen = halfThick - dist;

      // Landing from above: player was above the rope top surface last tick.
      // ny < 0 means the push direction is upward (rope is below player).
      const ropeTopY = cpy - halfThick;
      if (ny < -0.5 && prevBottom <= ropeTopY + COLLISION_EPSILON) {
        // Snap player bottom to rope top surface and ground them.
        cluster.positionYWorld = ropeTopY - hh;
        if (cluster.velocityYWorld > 0) cluster.velocityYWorld = 0;
        cluster.isGroundedFlag = 1;
        _applyPlayerWeightToRope(world, r, base, s, t);
      } else {
        // General push-out: apply penetration correction along normal.
        cluster.positionXWorld += nx * pen;
        cluster.positionYWorld += ny * pen;
        if (ny < -0.3) {
          if (cluster.velocityYWorld > 0) cluster.velocityYWorld = 0;
          cluster.isGroundedFlag = 1;
          _applyPlayerWeightToRope(world, r, base, s, t);
        } else if (ny > 0.3) {
          if (cluster.velocityYWorld < 0) cluster.velocityYWorld = 0;
        }
      }
    }
  }
}

/**
 * Pushes the two nearest rope nodes downward to simulate player weight.
 * Only the nodes that form the segment the player is standing on are affected,
 * weighted by the interpolation parameter t.
 */
function _applyPlayerWeightToRope(
  world: WorldState,
  ropeIndex: number,
  base: number,
  segIndex: number,
  t: number,
): void {
  const segCount = world.ropeSegmentCount[ropeIndex];
  const pushAmount = ROPE_PLAYER_WEIGHT_PUSH_WORLD;

  // Node A of this segment
  if (segIndex > 0) {
    // Not anchor A — free to move
    world.ropeSegPosYWorld[base + segIndex] += pushAmount * (1.0 - t);
    world.ropeSegPrevYWorld[base + segIndex] += pushAmount * (1.0 - t);
  }
  // Node B of this segment
  const bIdx = segIndex + 1;
  const isBPinned = bIdx === segCount - 1 && world.ropeIsAnchorBFixedFlag[ropeIndex] === 1;
  if (!isBPinned) {
    world.ropeSegPosYWorld[base + bIdx] += pushAmount * t;
    world.ropeSegPrevYWorld[base + bIdx] += pushAmount * t;
  }
}
