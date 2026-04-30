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

function applyShieldCrescent(
  world: WorldState,
  playerEntityId: number,
  playerX: number,
  playerY: number,
  aimDirX: number,
  aimDirY: number,
): void {
  // Collect indices of player-owned, alive, non-grapple particles
  const indices: number[] = [];
  for (let i = 0; i < world.particleCount; i++) {
    if (world.isAliveFlag[i] === 0) continue;
    if (world.ownerEntityId[i] !== playerEntityId) continue;
    // Skip grapple chain particles (behaviorMode 3)
    if (world.behaviorMode[i] === 3) continue;
    indices.push(i);
  }

  const total = indices.length;
  if (total === 0) return;

  // Calculate arc half-angle — scales with particle count
  const arcT = Math.min(1.0, total / SHIELD_MAX_ARC_PARTICLE_COUNT);
  const halfArcRad = SHIELD_MIN_HALF_ARC_RAD + arcT * (SHIELD_MAX_HALF_ARC_RAD - SHIELD_MIN_HALF_ARC_RAD);

  // Center angle from aim direction
  const centerAngle = Math.atan2(aimDirY, aimDirX);

  for (let idx = 0; idx < total; idx++) {
    const i = indices[idx];
    // Distribute evenly across the arc, centered
    const t = total > 1 ? idx / (total - 1) : 0.5;
    const angle = centerAngle - halfArcRad + t * 2.0 * halfArcRad;

    // Target position on the crescent
    const targetX = playerX + Math.cos(angle) * SHIELD_CRESCENT_RADIUS_WORLD;
    const targetY = playerY + Math.sin(angle) * SHIELD_CRESCENT_RADIUS_WORLD;

    // Spring force toward target position
    const dx = targetX - world.positionXWorld[i];
    const dy = targetY - world.positionYWorld[i];
    world.forceX[i] += dx * SHIELD_SPRING_STRENGTH;
    world.forceY[i] += dy * SHIELD_SPRING_STRENGTH;

    // Set to block mode so binding forces don't interfere
    world.behaviorMode[i] = 2;
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
    // RMB held → shielding (delegated to applyShieldCrescent below).
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
      const isShieldActive = world.isPlayerSecondaryWeaveActiveFlag === 1;
      tickSwordWeave(world, playerCluster, isShieldActive);
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
  // Shield Sword secondary DOES activate it (right mouse held = shield mode).
  const isShieldSecondaryActive =
    world.isPlayerSecondaryWeaveActiveFlag === 1 &&
    world.playerSecondaryWeaveId !== WEAVE_ARROW;

  if (world.isPlayerPrimaryWeaveActiveFlag === 1 || isShieldSecondaryActive) {
    const aimX = world.playerWeaveAimDirXWorld;
    const aimY = world.playerWeaveAimDirYWorld;
    applyShieldCrescent(world, playerEntityId, playerX, playerY, aimX, aimY);
  }
}
