/**
 * Shield Weave (dust-particle crescent) — shared implementation used by both
 * the legacy single-slot secondary-weave path (`weaveCombat.ts`, legacy
 * combat mode) and the new independently-unlockable Stage 3 coordinator
 * (`secondaryWeaveCoordinator.ts`).
 *
 * NOT to be confused with `sim/stormweave/shieldWeave.ts` (`world.shieldWeave`
 * / `ShieldWeaveState`), which is an unrelated HP-driven passive Stormweave
 * "life motes" shield geometry — that module is untouched by Stage 3.
 *
 * This module forms a crescent of the player's currently-available ordinary
 * mote particles (via the ordered mote queue) in the aimed direction, using
 * spring forces so the crescent visually settles into position. Only
 * available (non-depleted), non-transient, player-owned, non-dust-switch-
 * transitioning particles participate — depleted motes, dust-switch trail
 * particles, grapple/projectile/transient particles are excluded by
 * construction (the ordered mote queue only tracks ordinary player motes,
 * and dust-switch-transitioning slots are explicitly skipped below).
 */

import { WorldState } from '../world';
import { getAvailableOrderedMoteSlots } from '../motes/orderedMoteQueue';
import { isDustSwitchBehaviorMode } from '../particles/dustSwitchBehaviorMode';
import { isBowArrowBehaviorMode } from '../particles/bowArrowBehaviorMode';
import { isSwordSlashBehaviorMode } from '../particles/swordSlashBehaviorMode';
import { SHIELD_CRESCENT_RADIUS_WORLD, centerOutArcT } from './shieldGeometry';

// Re-exported for backward compatibility with existing importers.
export { SHIELD_CRESCENT_RADIUS_WORLD };

/** Minimum half-arc angle (radians) for 1 particle. */
const SHIELD_MIN_HALF_ARC_RAD = 0.15;
/** Maximum half-arc angle (radians) for maximum particles. */
const SHIELD_MAX_HALF_ARC_RAD = Math.PI * 0.5;
/**
 * Spring force strength pulling particles toward their crescent position.
 *
 * Task section 4 — faster Shield formation. Raised from the previous 600 so the
 * crescent forms almost immediately (defensive, responsive feel) rather than
 * easing in. Paired with the critical-damping term below so the stiffer spring
 * snaps into place without oscillating or overshooting the shield slots.
 */
const SHIELD_SPRING_STRENGTH = 1400.0;
/**
 * Critical-damping factor for the shield spring. The per-particle damping force
 * is `2 * sqrt(SHIELD_SPRING_STRENGTH * mass) * SHIELD_SPRING_DAMPING_RATIO`
 * applied against the mote's velocity, giving a fast, slightly-underdamped
 * settle: motes sweep in quickly but still show a small amount of animated
 * movement as they seat, instead of a rigid teleport.
 */
const SHIELD_SPRING_DAMPING_RATIO = 0.9;
/**
 * Number of particles at which the crescent reaches maximum arc.
 * Beyond this, particles pack more densely rather than widening further.
 */
const SHIELD_MAX_ARC_PARTICLE_COUNT = 30;

/**
 * Applies spring forces that hold the player's available mote particles in a
 * crescent formation centred on the aim direction, and marks them
 * behaviorMode = 2 (block mode) so orbital/binding forces don't fight the
 * spring. No-op (and no particles touched) when no motes are available or
 * the ordered mote queue is not configured.
 */
export function applyShieldWeaveCrescent(
  world: WorldState,
  playerXWorld: number,
  playerYWorld: number,
  aimDirXWorld: number,
  aimDirYWorld: number,
): void {
  const available = getAvailableOrderedMoteSlots(world);
  const total = available.count;
  if (total === 0) return;

  const arcT = Math.min(1.0, total / SHIELD_MAX_ARC_PARTICLE_COUNT);
  const halfArcRad = SHIELD_MIN_HALF_ARC_RAD + arcT * (SHIELD_MAX_HALF_ARC_RAD - SHIELD_MIN_HALF_ARC_RAD);
  const centerAngle = Math.atan2(aimDirYWorld, aimDirXWorld);

  for (let rank = 0; rank < total; rank++) {
    const slot = available.indices[rank];
    const pidx = world.moteSlotParticleIndex[slot];
    if (pidx < 0 || pidx >= world.particleCount) continue;
    if (world.isAliveFlag[pidx] === 0) continue;
    if (isDustSwitchBehaviorMode(world.behaviorMode[pidx])) continue;
    // Motes reserved by the Bow arrow (center mote + loaded arrow motes) are
    // excluded from ordinary shield-slot placement, keeping the central arrow
    // corridor clear and ensuring a mote is never both a shield and arrow mote.
    if (isBowArrowBehaviorMode(world.behaviorMode[pidx])) continue;
    // Motes mid sword-crescent are owned by the Sword Weave, not the shield.
    if (isSwordSlashBehaviorMode(world.behaviorMode[pidx])) continue;

    const arcPosition = centerOutArcT(rank, total);
    const angle = centerAngle - halfArcRad + arcPosition * 2.0 * halfArcRad;

    const targetX = playerXWorld + Math.cos(angle) * SHIELD_CRESCENT_RADIUS_WORLD;
    const targetY = playerYWorld + Math.sin(angle) * SHIELD_CRESCENT_RADIUS_WORLD;

    const dx = targetX - world.positionXWorld[pidx];
    const dy = targetY - world.positionYWorld[pidx];
    world.forceX[pidx] += dx * SHIELD_SPRING_STRENGTH;
    world.forceY[pidx] += dy * SHIELD_SPRING_STRENGTH;

    // Critical damping so the stiffer spring snaps in fast without oscillating.
    const mass = world.massKg[pidx] > 0 ? world.massKg[pidx] : 1.0;
    const dampCoeff = 2.0 * Math.sqrt(SHIELD_SPRING_STRENGTH * mass) * SHIELD_SPRING_DAMPING_RATIO;
    world.forceX[pidx] -= world.velocityXWorld[pidx] * dampCoeff;
    world.forceY[pidx] -= world.velocityYWorld[pidx] * dampCoeff;

    world.behaviorMode[pidx] = 2;
  }
}

/**
 * Releases all player-owned particles currently in block mode (behaviorMode
 * === 2) back to normal orbit behavior. Call when shield ownership ends
 * (release, cancel, unlock lost, or handed off to another weave).
 */
export function releaseShieldWeaveParticles(world: WorldState, playerEntityId: number): void {
  for (let i = 0; i < world.particleCount; i++) {
    if (world.isAliveFlag[i] === 1 && world.ownerEntityId[i] === playerEntityId && world.behaviorMode[i] === 2) {
      world.behaviorMode[i] = 0;
    }
  }
}
