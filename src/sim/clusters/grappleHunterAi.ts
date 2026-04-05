/**
 * Grapple Hunter AI — state machine for a ground enemy that walks, jumps,
 * and fires a slow grappling hook toward the player.
 *
 * State machine:
 *   0 = idle     — dormant, awaiting player proximity
 *   1 = chase    — walking toward player
 *   2 = attack   — extending grapple chain tip toward player
 *   3 = reel     — zip-pulling toward player after a hit
 *   4 = recover  — cooldown after attack or miss
 */

import { WorldState } from '../world';
import { ClusterState } from './state';
import { ParticleKind } from '../particles/kinds';
import { getElementProfile } from '../particles/elementProfiles';
import { applyPlayerDamageWithKnockback } from '../playerDamage';

// ============================================================================
// Constants
// ============================================================================

/** Number of Gold particles that form the hunter's grapple chain. */
const GRAPPLE_HUNTER_CHAIN_SEGMENT_COUNT = 8;

/** Speed at which the grapple tip extends (world units/sec). */
const GRAPPLE_EXTEND_SPEED_WORLD_PER_SEC = 120.0;

/** Maximum grapple range (world units). */
const GRAPPLE_MAX_RANGE_WORLD = 80.0;

/** Sight range — distance at which the hunter notices the player (world units). */
const SIGHT_RANGE_WORLD = 150.0;

/** Cooldown ticks after an attack before the next one (3 sec at 60 fps). */
const ATTACK_COOLDOWN_TICKS = 180;

/** Upward velocity applied when the hunter jumps (world units/sec, applied as negative Y). */
const JUMP_SPEED_WORLD = 200.0;

/** Speed at which the hunter zips toward the player during reel (world units/sec). */
const REEL_SPEED_WORLD_PER_SEC = 200.0;

/** Damage dealt when the grapple tip hits the player. */
const GRAPPLE_HIT_DAMAGE = 1;

/** Damage dealt when the hunter slams into the player after reeling. */
const SLAM_DAMAGE = 1;

/** Distance threshold for reel arrival (world units). */
const REEL_ARRIVAL_DIST_WORLD = 6.0;

/** Height difference threshold for triggering a jump (world units). */
const JUMP_HEIGHT_THRESHOLD_WORLD = 12.0;

/** Behavior mode for grapple chain particles (matches player grapple). */
const BEHAVIOR_MODE_GRAPPLE_CHAIN = 3;

/** Very large lifetime to prevent standard lifetime expiry. */
const CHAIN_LIFETIME_TICKS = 9999999.0;

// ============================================================================
// Chain particle allocation
// ============================================================================

/**
 * Allocates 8 Gold chain particles for a grapple hunter and records the
 * start index on the cluster. Called once at enemy spawn time.
 */
export function initGrappleHunterChainParticles(
  world: WorldState,
  cluster: ClusterState,
): void {
  const profile = getElementProfile(ParticleKind.Gold);
  const startIndex = world.particleCount;

  for (let i = 0; i < GRAPPLE_HUNTER_CHAIN_SEGMENT_COUNT; i++) {
    const idx = world.particleCount++;

    world.positionXWorld[idx]      = 0.0;
    world.positionYWorld[idx]      = 0.0;
    world.velocityXWorld[idx]      = 0.0;
    world.velocityYWorld[idx]      = 0.0;
    world.forceX[idx]              = 0.0;
    world.forceY[idx]              = 0.0;
    world.massKg[idx]              = profile.massKg;
    world.chargeUnits[idx]         = 0.0;
    world.isAliveFlag[idx]         = 0; // inactive until grapple fires
    world.kindBuffer[idx]          = ParticleKind.Gold;
    world.ownerEntityId[idx]       = cluster.entityId;
    world.anchorAngleRad[idx]      = 0.0;
    world.anchorRadiusWorld[idx]   = 0.0;
    world.disturbanceFactor[idx]   = 0.0;
    world.ageTicks[idx]            = 0.0;
    world.lifetimeTicks[idx]       = CHAIN_LIFETIME_TICKS;
    world.noiseTickSeed[idx]       = (0xbeef0000 + cluster.entityId * 8 + i) >>> 0;
    world.behaviorMode[idx]        = BEHAVIOR_MODE_GRAPPLE_CHAIN;
    world.particleDurability[idx]  = profile.toughness;
    world.respawnDelayTicks[idx]   = 0;
    world.attackModeTicksLeft[idx] = 0;
    world.isTransientFlag[idx]     = 1; // grapple system controls lifecycle
  }

  cluster.grappleHunterChainStartIndex = startIndex;
}

// ============================================================================
// Main AI tick
// ============================================================================

export function applyGrappleHunterAI(world: WorldState): void {
  const dtSec = world.dtMs / 1000.0;

  // Find the player cluster
  let player: ClusterState | null = null;
  for (let ci = 0; ci < world.clusters.length; ci++) {
    if (world.clusters[ci].isPlayerFlag === 1 && world.clusters[ci].isAliveFlag === 1) {
      player = world.clusters[ci];
      break;
    }
  }

  for (let ci = 0; ci < world.clusters.length; ci++) {
    const c = world.clusters[ci];
    if (c.isGrappleHunterFlag !== 1 || c.isAliveFlag !== 1) continue;

    c.grappleHunterStateTicks++;

    // Distance to player (or large if player dead/missing)
    let dxToPlayer = 0.0;
    let dyToPlayer = 0.0;
    let distToPlayer = 99999.0;
    if (player !== null) {
      dxToPlayer = player.positionXWorld - c.positionXWorld;
      dyToPlayer = player.positionYWorld - c.positionYWorld;
      distToPlayer = Math.sqrt(dxToPlayer * dxToPlayer + dyToPlayer * dyToPlayer);
    }

    switch (c.grappleHunterState) {
      // ── State 0: Idle ──────────────────────────────────────────────────
      case 0: {
        deactivateChain(world, c);
        if (player !== null && distToPlayer < SIGHT_RANGE_WORLD) {
          transitionTo(c, 1);
        }
        break;
      }

      // ── State 1: Chase ─────────────────────────────────────────────────
      case 1: {
        deactivateChain(world, c);

        if (player === null || distToPlayer > SIGHT_RANGE_WORLD) {
          transitionTo(c, 0);
          break;
        }

        // Jump if player is significantly above and hunter is grounded
        if (dyToPlayer < -JUMP_HEIGHT_THRESHOLD_WORLD && c.isGroundedFlag === 1) {
          c.velocityYWorld = -JUMP_SPEED_WORLD;
          c.isGroundedFlag = 0;
        }

        // Transition to attack if in range and cooldown elapsed
        if (distToPlayer < GRAPPLE_MAX_RANGE_WORLD && c.grappleHunterCooldownTicks <= 0) {
          // Compute fire direction toward player
          const invDist = distToPlayer > 0.5 ? 1.0 / distToPlayer : 0.0;
          c.grappleHunterFireDirX = dxToPlayer * invDist;
          c.grappleHunterFireDirY = dyToPlayer * invDist;
          c.grappleHunterTipXWorld = c.positionXWorld;
          c.grappleHunterTipYWorld = c.positionYWorld;
          c.grappleHunterHasHitPlayerFlag = 0;
          transitionTo(c, 2);
        }
        break;
      }

      // ── State 2: Attack (extending chain) ──────────────────────────────
      case 2: {
        // Stop horizontal movement during attack
        c.velocityXWorld *= 0.9;

        // Extend tip
        c.grappleHunterTipXWorld += c.grappleHunterFireDirX * GRAPPLE_EXTEND_SPEED_WORLD_PER_SEC * dtSec;
        c.grappleHunterTipYWorld += c.grappleHunterFireDirY * GRAPPLE_EXTEND_SPEED_WORLD_PER_SEC * dtSec;

        // Position chain particles along hunter → tip
        positionChainParticles(world, c);

        // Check distance from hunter to tip
        const tipDx = c.grappleHunterTipXWorld - c.positionXWorld;
        const tipDy = c.grappleHunterTipYWorld - c.positionYWorld;
        const tipDist = Math.sqrt(tipDx * tipDx + tipDy * tipDy);

        // Check tip-to-player AABB collision
        if (player !== null && tipHitsCluster(c.grappleHunterTipXWorld, c.grappleHunterTipYWorld, player)) {
          // Hit the player — deal damage
          applyPlayerDamageWithKnockback(
            player,
            GRAPPLE_HIT_DAMAGE,
            c.grappleHunterTipXWorld,
            c.grappleHunterTipYWorld,
          );
          c.grappleHunterHasHitPlayerFlag = 1;
          transitionTo(c, 3);
          break;
        }

        // Check if tip hit a wall (stop early)
        if (tipHitsWall(world, c.grappleHunterTipXWorld, c.grappleHunterTipYWorld)) {
          transitionTo(c, 4);
          c.grappleHunterCooldownTicks = ATTACK_COOLDOWN_TICKS;
          break;
        }

        // Check if tip exceeded max range
        if (tipDist > GRAPPLE_MAX_RANGE_WORLD) {
          transitionTo(c, 4);
          c.grappleHunterCooldownTicks = ATTACK_COOLDOWN_TICKS;
        }
        break;
      }

      // ── State 3: Reel (zip toward player) ──────────────────────────────
      case 3: {
        if (player === null) {
          transitionTo(c, 4);
          c.grappleHunterCooldownTicks = ATTACK_COOLDOWN_TICKS;
          break;
        }

        // Zip toward player
        const reelInvDist = distToPlayer > 0.5 ? 1.0 / distToPlayer : 0.0;
        c.velocityXWorld = dxToPlayer * reelInvDist * REEL_SPEED_WORLD_PER_SEC;
        c.velocityYWorld = dyToPlayer * reelInvDist * REEL_SPEED_WORLD_PER_SEC;

        // Update tip to track toward player during reel
        c.grappleHunterTipXWorld = player.positionXWorld;
        c.grappleHunterTipYWorld = player.positionYWorld;
        positionChainParticles(world, c);

        // Check arrival — slam damage
        if (distToPlayer < REEL_ARRIVAL_DIST_WORLD) {
          applyPlayerDamageWithKnockback(
            player,
            SLAM_DAMAGE,
            c.positionXWorld,
            c.positionYWorld,
          );
          transitionTo(c, 4);
          c.grappleHunterCooldownTicks = ATTACK_COOLDOWN_TICKS;
          c.velocityXWorld = 0;
          c.velocityYWorld = 0;
        }
        break;
      }

      // ── State 4: Recover (cooldown) ────────────────────────────────────
      case 4: {
        deactivateChain(world, c);
        c.grappleHunterCooldownTicks--;
        if (c.grappleHunterCooldownTicks <= 0) {
          c.grappleHunterCooldownTicks = 0;
          if (player !== null && distToPlayer < SIGHT_RANGE_WORLD) {
            transitionTo(c, 1);
          } else {
            transitionTo(c, 0);
          }
        }
        break;
      }
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function transitionTo(c: ClusterState, state: number): void {
  c.grappleHunterState = state;
  c.grappleHunterStateTicks = 0;
}

/** Check if a point overlaps a cluster's AABB. */
function tipHitsCluster(tipX: number, tipY: number, target: ClusterState): boolean {
  return (
    tipX >= target.positionXWorld - target.halfWidthWorld &&
    tipX <= target.positionXWorld + target.halfWidthWorld &&
    tipY >= target.positionYWorld - target.halfHeightWorld &&
    tipY <= target.positionYWorld + target.halfHeightWorld
  );
}

/** Check if a point is inside any wall rectangle (with epsilon tolerance). */
function tipHitsWall(world: WorldState, tipX: number, tipY: number): boolean {
  const wallCollisionEpsilonWorld = 0.5; // absorb float error from accumulated tip position
  for (let wi = 0; wi < world.wallCount; wi++) {
    const wx = world.wallXWorld[wi];
    const wy = world.wallYWorld[wi];
    if (
      tipX >= wx - wallCollisionEpsilonWorld && tipX <= wx + world.wallWWorld[wi] + wallCollisionEpsilonWorld &&
      tipY >= wy - wallCollisionEpsilonWorld && tipY <= wy + world.wallHWorld[wi] + wallCollisionEpsilonWorld
    ) {
      return true;
    }
  }
  return false;
}

/** Position chain particles evenly between hunter position and tip.
 *  Particles are spaced at t = 1/9, 2/9, ..., 8/9 — intentionally excluding
 *  the endpoints so no particle overlaps the hunter body or tip dot. */
function positionChainParticles(world: WorldState, c: ClusterState): void {
  const startIdx = c.grappleHunterChainStartIndex;
  if (startIdx < 0) return;

  const sx = c.positionXWorld;
  const sy = c.positionYWorld;
  const tx = c.grappleHunterTipXWorld;
  const ty = c.grappleHunterTipYWorld;

  for (let i = 0; i < GRAPPLE_HUNTER_CHAIN_SEGMENT_COUNT; i++) {
    const t = (i + 1) / (GRAPPLE_HUNTER_CHAIN_SEGMENT_COUNT + 1);
    const idx = startIdx + i;
    world.positionXWorld[idx] = sx + (tx - sx) * t;
    world.positionYWorld[idx] = sy + (ty - sy) * t;
    world.velocityXWorld[idx] = 0;
    world.velocityYWorld[idx] = 0;
    world.isAliveFlag[idx]    = 1;
  }
}

/** Deactivate all chain particles (set isAliveFlag = 0). */
function deactivateChain(world: WorldState, c: ClusterState): void {
  const startIdx = c.grappleHunterChainStartIndex;
  if (startIdx < 0) return;
  for (let i = 0; i < GRAPPLE_HUNTER_CHAIN_SEGMENT_COUNT; i++) {
    world.isAliveFlag[startIdx + i] = 0;
  }
}
