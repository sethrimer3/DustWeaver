/**
 * Weave Combat System — Storm, Shield, and Arrow weaves.
 *
 * Storm Weave: passive attraction of nearby unowned Gold Dust to the player.
 * Shield Weave: crescent formation of player dust in the aimed direction.
 * Arrow Weave: charge-and-release arrow that sticks into terrain and damages enemies.
 */

import { WorldState } from '../world';
import { ParticleKind } from '../particles/kinds';
import { getElementProfile } from '../particles/elementProfiles';
import { WEAVE_ARROW, WEAVE_SHIELD_SWORD } from './weaveDefinition';
import {
  startArrowLoading,
  updateArrowLoading,
  fireArrowFromLoading,
} from './arrowWeave';
import { tickSwordWeave } from './swordWeave';
import { getAvailableOrderedMoteSlots } from '../motes/orderedMoteQueue';

// ── Storm Weave constants ───────────────────────────────────────────────────

/** Maximum distance (world units) at which unowned dust is attracted. */
const STORM_ATTRACT_RADIUS_WORLD = 80.0;
/** Force strength applied toward the player (scales with distance falloff). */
const STORM_ATTRACT_STRENGTH = 120.0;
/** Distance (world units) at which attracted dust is claimed by the player. */
const STORM_CLAIM_RADIUS_WORLD = 12.0;
/** Minimum lifetime (ticks) assigned to newly claimed dust to prevent instant expiration. */
const MIN_CLAIMED_DUST_LIFETIME_TICKS = 2.0;

// ── Shield Weave constants ──────────────────────────────────────────────────

/** Distance (world units) from player center at which the crescent forms. */
const SHIELD_CRESCENT_RADIUS_WORLD = 12.0;
/** Minimum half-arc angle (radians) for 1 particle. */
const SHIELD_MIN_HALF_ARC_RAD = 0.15;
/** Maximum half-arc angle (radians) for maximum particles. */
const SHIELD_MAX_HALF_ARC_RAD = Math.PI * 0.5;
/** Spring force strength pulling particles toward their crescent position. */
const SHIELD_SPRING_STRENGTH = 600.0;
/**
 * Number of particles at which the crescent reaches maximum arc.
 * Beyond this, particles pack more densely rather than widening further.
 */
const SHIELD_MAX_ARC_PARTICLE_COUNT = 30;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Finds the player cluster and returns its entity ID and position, or null. */
function findPlayerCluster(world: WorldState): { entityId: number; xWorld: number; yWorld: number } | null {
  for (let ci = 0; ci < world.clusters.length; ci++) {
    if (world.clusters[ci].isPlayerFlag === 1 && world.clusters[ci].isAliveFlag === 1) {
      return {
        entityId: world.clusters[ci].entityId,
        xWorld: world.clusters[ci].positionXWorld,
        yWorld: world.clusters[ci].positionYWorld,
      };
    }
  }
  return null;
}

// ── Storm Weave: passive attraction ─────────────────────────────────────────

function applyStormAttraction(world: WorldState): void {
  const player = findPlayerCluster(world);
  if (player === null) return;
  const { entityId: playerEntityId, xWorld: playerX, yWorld: playerY } = player;

  const {
    isAliveFlag, ownerEntityId, kindBuffer,
    positionXWorld, positionYWorld,
    forceX, forceY,
    anchorAngleRad, anchorRadiusWorld,
    lifetimeTicks, ageTicks,
    behaviorMode, particleDurability,
    respawnDelayTicks, attackModeTicksLeft,
    isTransientFlag, weaveSlotId,
  } = world;

  const profile = getElementProfile(ParticleKind.Physical);
  const attractRadSq = STORM_ATTRACT_RADIUS_WORLD * STORM_ATTRACT_RADIUS_WORLD;
  const claimRadSq = STORM_CLAIM_RADIUS_WORLD * STORM_CLAIM_RADIUS_WORLD;

  for (let i = 0; i < world.particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    // Only attract unowned Gold Dust (Physical kind)
    if (ownerEntityId[i] !== -1) continue;
    if (kindBuffer[i] !== ParticleKind.Physical) continue;

    const dx = playerX - positionXWorld[i];
    const dy = playerY - positionYWorld[i];
    const distSq = dx * dx + dy * dy;

    if (distSq > attractRadSq || distSq < 0.001) continue;

    // Claim particle if within claim radius
    if (distSq < claimRadSq) {
      ownerEntityId[i] = playerEntityId;
      behaviorMode[i] = 0; // orbit
      anchorAngleRad[i] = Math.atan2(dy, dx);
      anchorRadiusWorld[i] = profile.orbitRadiusWorld;
      particleDurability[i] = profile.toughness;
      respawnDelayTicks[i] = 0;
      attackModeTicksLeft[i] = 0;
      isTransientFlag[i] = 0;
      weaveSlotId[i] = 0;
      // Reset lifetime so newly claimed particles don't immediately expire
      lifetimeTicks[i] = Math.max(MIN_CLAIMED_DUST_LIFETIME_TICKS, profile.lifetimeBaseTicks);
      ageTicks[i] = 0;
      continue;
    }

    // Apply attraction force toward player
    const dist = Math.sqrt(distSq);
    const invDist = 1.0 / dist;
    const falloff = 1.0 - dist / STORM_ATTRACT_RADIUS_WORLD;
    forceX[i] += dx * invDist * STORM_ATTRACT_STRENGTH * falloff;
    forceY[i] += dy * invDist * STORM_ATTRACT_STRENGTH * falloff;
  }
}

// ── Shield Weave: crescent formation ────────────────────────────────────────

/**
 * Computes the arc-t position (0..1 along the crescent) for a mote at `rank`
 * in the center-out ordering.  Rank 0 gets the center, rank 1 just above,
 * rank 2 just below, rank 3 further above, etc.
 *
 * This ensures the highest-priority (earliest-queue) motes occupy the
 * strongest defensive positions at the shield's center.
 *
 * Allocation-free and branchless after rank/n resolution.
 */
function _centerOutArcT(rank: number, n: number): number {
  if (n <= 1) return 0.5;
  // Map from even positions (0..n-1) to center-out order.
  // center = floor((n-1)/2); odd ranks go above, even (>0) go below.
  const center = Math.floor((n - 1) / 2);
  let posIdx: number;
  if (rank === 0) {
    posIdx = center;
  } else if (rank % 2 === 1) {
    posIdx = center + Math.ceil(rank / 2);
  } else {
    posIdx = center - (rank / 2);
  }
  // Clamp to valid range in case of odd n edge cases.
  posIdx = Math.max(0, Math.min(n - 1, posIdx));
  return posIdx / (n - 1);
}

function applyShieldCrescent(
  world: WorldState,
  playerX: number,
  playerY: number,
  aimDirX: number,
  aimDirY: number,
): void {
  // Use the ordered mote queue so shield density reflects available motes
  // and earlier-queue motes occupy the strongest center positions.
  const available = getAvailableOrderedMoteSlots(world);
  const total = available.count;
  if (total === 0) return;

  // Arc half-angle scales with how many motes are present.
  const arcT = Math.min(1.0, total / SHIELD_MAX_ARC_PARTICLE_COUNT);
  const halfArcRad = SHIELD_MIN_HALF_ARC_RAD + arcT * (SHIELD_MAX_HALF_ARC_RAD - SHIELD_MIN_HALF_ARC_RAD);

  // Center angle from aim direction.
  const centerAngle = Math.atan2(aimDirY, aimDirX);

  for (let rank = 0; rank < total; rank++) {
    const slot = available.indices[rank];
    const pidx = world.moteSlotParticleIndex[slot];
    if (pidx < 0 || pidx >= world.particleCount) continue;
    if (world.isAliveFlag[pidx] === 0) continue;

    // Center-out arc position: rank 0 = center, rank 1 = above, rank 2 = below …
    const arcPosition = _centerOutArcT(rank, total);
    const angle = centerAngle - halfArcRad + arcPosition * 2.0 * halfArcRad;

    // Target position on the crescent.
    const targetX = playerX + Math.cos(angle) * SHIELD_CRESCENT_RADIUS_WORLD;
    const targetY = playerY + Math.sin(angle) * SHIELD_CRESCENT_RADIUS_WORLD;

    // Spring force toward target position.
    const dx = targetX - world.positionXWorld[pidx];
    const dy = targetY - world.positionYWorld[pidx];
    world.forceX[pidx] += dx * SHIELD_SPRING_STRENGTH;
    world.forceY[pidx] += dy * SHIELD_SPRING_STRENGTH;

    // Set to block mode so binding forces don't interfere.
    world.behaviorMode[pidx] = 2;
  }
}

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Applies weave combat forces for the player each tick.
 *
 * Called from tick.ts. Handles:
 *   1. Storm Weave — passive attraction of nearby unowned Gold Dust
 *   2. Shield Weave — crescent formation when primary/secondary is held
 */
export function applyPlayerWeaveCombat(world: WorldState): void {
  // ── Storm Weave (always active) ─────────────────────────────────────────
  applyStormAttraction(world);

  // ── Shield Weave (mouse-button driven) ─────────────────────────────────
  const player = findPlayerCluster(world);
  if (player === null) return;
  const { entityId: playerEntityId, xWorld: playerX, yWorld: playerY } = player;

  // Primary mouse button → shield
  if (world.playerPrimaryWeaveTriggeredFlag === 1) {
    world.playerPrimaryWeaveTriggeredFlag = 0;
    world.isPlayerPrimaryWeaveActiveFlag = 1;
  }
  if (world.playerPrimaryWeaveEndFlag === 1) {
    world.playerPrimaryWeaveEndFlag = 0;
    world.isPlayerPrimaryWeaveActiveFlag = 0;
    // Release particles back to orbit
    for (let i = 0; i < world.particleCount; i++) {
      if (world.isAliveFlag[i] === 1 && world.ownerEntityId[i] === playerEntityId && world.behaviorMode[i] === 2) {
        world.behaviorMode[i] = 0;
      }
    }
  }

  // Whether the sword weave FSM has signalled that the crescent should form
  // this tick.  True when the player is fully in SHIELDING state (after the
  // guard swipe completes), false during GUARD_FORMING / GUARD_SLASHING
  // states when the sword is still executing the opening sweep.
  let swordWeaveShouldApplyCresc = false;

  // Secondary mouse button — branched by equipped weave ID
  if (world.playerSecondaryWeaveId === WEAVE_ARROW) {
    // ── Arrow Weave secondary ────────────────────────────────────────────────
    if (world.playerSecondaryWeaveTriggeredFlag === 1) {
      world.playerSecondaryWeaveTriggeredFlag = 0;
      world.isPlayerSecondaryWeaveActiveFlag = 1;
      startArrowLoading(world);
    }
    if (world.isPlayerSecondaryWeaveActiveFlag === 1) {
      updateArrowLoading(world);
    }
    if (world.playerSecondaryWeaveEndFlag === 1) {
      world.playerSecondaryWeaveEndFlag = 0;
      world.isPlayerSecondaryWeaveActiveFlag = 0;
      fireArrowFromLoading(world, playerX, playerY);
    }
  } else if (world.playerSecondaryWeaveId === WEAVE_SHIELD_SWORD) {
    // ── Shield Sword Weave secondary ────────────────────────────────────────
    // RMB held → guard swipe then shield (delegated to tickSwordWeave).
    // RMB not held → sword auto-swing FSM.
    if (world.playerSecondaryWeaveTriggeredFlag === 1) {
      world.playerSecondaryWeaveTriggeredFlag = 0;
      world.isPlayerSecondaryWeaveActiveFlag = 1;
    }
    if (world.playerSecondaryWeaveEndFlag === 1) {
      world.playerSecondaryWeaveEndFlag = 0;
      world.isPlayerSecondaryWeaveActiveFlag = 0;
      // Release any block-mode particles back to orbit so they don't hang in
      // the crescent after the player lets go of right mouse.
      for (let i = 0; i < world.particleCount; i++) {
        if (
          world.isAliveFlag[i] === 1 &&
          world.ownerEntityId[i] === playerEntityId &&
          world.behaviorMode[i] === 2
        ) {
          world.behaviorMode[i] = 0;
        }
      }
    }

    // Drive sword state machine.  Locate the live player cluster object so
    // the sword module can read facing/position directly.
    let playerCluster = null;
    for (let ci = 0; ci < world.clusters.length; ci++) {
      if (world.clusters[ci].isPlayerFlag === 1 && world.clusters[ci].isAliveFlag === 1) {
        playerCluster = world.clusters[ci];
        break;
      }
    }
    if (playerCluster !== null) {
      const isShieldHeld = world.isPlayerSecondaryWeaveActiveFlag === 1;
      // tickSwordWeave returns true when shield crescent should be applied
      // this tick (only true once GUARD_SLASHING has completed).
      swordWeaveShouldApplyCresc = tickSwordWeave(world, playerCluster, isShieldHeld);
    }
  } else {
    // ── Shield Weave secondary (default) ────────────────────────────────────
    if (world.playerSecondaryWeaveTriggeredFlag === 1) {
      world.playerSecondaryWeaveTriggeredFlag = 0;
      world.isPlayerSecondaryWeaveActiveFlag = 1;
    }
    if (world.playerSecondaryWeaveEndFlag === 1) {
      world.playerSecondaryWeaveEndFlag = 0;
      world.isPlayerSecondaryWeaveActiveFlag = 0;
      for (let i = 0; i < world.particleCount; i++) {
        if (world.isAliveFlag[i] === 1 && world.ownerEntityId[i] === playerEntityId && world.behaviorMode[i] === 2) {
          world.behaviorMode[i] = 0;
        }
      }
    }
  }

  // Apply crescent forces while shield is active on either slot.
  // Arrow weave secondary does NOT activate the shield crescent.
  // Shield Sword secondary uses the sword FSM return value so the crescent
  // is suppressed during the guard swipe animation.
  const isShieldSecondaryActive = (() => {
    if (world.playerSecondaryWeaveId === WEAVE_ARROW) return false;
    if (world.playerSecondaryWeaveId === WEAVE_SHIELD_SWORD) return swordWeaveShouldApplyCresc;
    return world.isPlayerSecondaryWeaveActiveFlag === 1;
  })();

  if (world.isPlayerPrimaryWeaveActiveFlag === 1 || isShieldSecondaryActive) {
    const aimX = world.playerWeaveAimDirXWorld;
    const aimY = world.playerWeaveAimDirYWorld;
    applyShieldCrescent(world, playerX, playerY, aimX, aimY);
  }
}
