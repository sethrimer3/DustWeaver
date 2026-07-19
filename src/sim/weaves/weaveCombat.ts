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
import { WEAVE_ARROW, WEAVE_SHIELD_SWORD, WEAVE_STORM } from './weaveDefinition';
import {
  startArrowLoading,
  updateArrowLoading,
  fireArrowFromLoading,
} from './arrowWeave';
import { tickSwordWeave } from './swordWeave';
import { applyShieldWeaveCrescent } from './shieldWeave';
import { tickSecondaryWeaveCoordinator } from './secondaryWeaveCoordinator';

// ── Storm Weave constants ───────────────────────────────────────────────────

/** Maximum distance (world units) at which unowned dust is attracted. */
const STORM_ATTRACT_RADIUS_WORLD = 80.0;
/** Force strength applied toward the player (scales with distance falloff). */
const STORM_ATTRACT_STRENGTH = 120.0;
/** Distance (world units) at which attracted dust is claimed by the player. */
const STORM_CLAIM_RADIUS_WORLD = 12.0;
/** Minimum lifetime (ticks) assigned to newly claimed dust to prevent instant expiration. */
const MIN_CLAIMED_DUST_LIFETIME_TICKS = 2.0;

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

  const profile = getElementProfile(ParticleKind.Golden);
  const attractRadSq = STORM_ATTRACT_RADIUS_WORLD * STORM_ATTRACT_RADIUS_WORLD;
  const claimRadSq = STORM_CLAIM_RADIUS_WORLD * STORM_CLAIM_RADIUS_WORLD;

  for (let i = 0; i < world.particleCount; i++) {
    if (isAliveFlag[i] === 0) continue;
    // Only attract unowned Gold Dust (Golden kind)
    if (ownerEntityId[i] !== -1) continue;
    if (kindBuffer[i] !== ParticleKind.Golden) continue;

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

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Applies weave combat forces for the player each tick.
 *
 * Called from tick.ts.
 *
 * `combatMode === 'legacy'` runs the original single-equipped-slot system
 * (Storm attraction, Shield/Arrow/Shield-Sword secondary branching) exactly
 * as before — untouched, so existing legacy-mode tests and momentum-mode
 * collision damage rules are unaffected.
 *
 * The default (non-legacy) gameplay mode now runs the Stage 3 independent
 * Sword/Shield/Bow coordinator instead of returning early: previously this
 * function no-op'd entirely outside legacy mode, which disabled ALL player
 * weave offense in the actual default game mode. Storm Weave's passive
 * attraction remains legacy-only (unrelated to Sword/Shield/Bow and not
 * blocking this stage's scope); momentum-based player collision damage is
 * computed entirely outside this function and is unaffected either way.
 */
export function applyPlayerWeaveCombat(world: WorldState): void {
  if (world.combatMode === 'legacy') {
    applyLegacyPlayerWeaveCombat(world);
    return;
  }

  tickSecondaryWeaveCoordinator(world);
}

function applyLegacyPlayerWeaveCombat(world: WorldState): void {
  // ── Storm Weave — only active when Storm is the equipped primary weave ────
  // Storm passively attracts nearby unowned Gold Dust to orbit the player.
  // When another primary weave is equipped, dust materializes from inventory
  // space instead and Storm attraction should not fire.
  // isMoteSourceOrbitFlag mirrors this distinction for renderers.
  if (world.playerPrimaryWeaveId === WEAVE_STORM) {
    applyStormAttraction(world);
  }

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
  if (world.canUsePlayerSecondaryWeaveFlag === 0) {
    resetLockedSecondaryWeaveInput(world);
  } else if (world.playerSecondaryWeaveId === WEAVE_ARROW) {
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
    applyShieldWeaveCrescent(world, playerX, playerY, aimX, aimY);
  }
}

function resetLockedSecondaryWeaveInput(world: WorldState): void {
  world.playerSecondaryWeaveTriggeredFlag = 0;
  world.playerSecondaryWeaveEndFlag = 0;
  world.isPlayerSecondaryWeaveActiveFlag = 0;
}
