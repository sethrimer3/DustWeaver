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

/**
 * Computes the arc-t position (0..1 along the crescent) for a mote at `rank`
 * in the center-out ordering. Rank 0 gets the center, rank 1 just above,
 * rank 2 just below, rank 3 further above, etc. — earliest-queue motes
 * occupy the strongest defensive (center) positions.
 */
function _centerOutArcT(rank: number, n: number): number {
  if (n <= 1) return 0.5;
  const center = Math.floor((n - 1) / 2);
  let posIdx: number;
  if (rank === 0) {
    posIdx = center;
  } else if (rank % 2 === 1) {
    posIdx = center + Math.ceil(rank / 2);
  } else {
    posIdx = center - (rank / 2);
  }
  posIdx = Math.max(0, Math.min(n - 1, posIdx));
  return posIdx / (n - 1);
}

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

    const arcPosition = _centerOutArcT(rank, total);
    const angle = centerAngle - halfArcRad + arcPosition * 2.0 * halfArcRad;

    const targetX = playerXWorld + Math.cos(angle) * SHIELD_CRESCENT_RADIUS_WORLD;
    const targetY = playerYWorld + Math.sin(angle) * SHIELD_CRESCENT_RADIUS_WORLD;

    const dx = targetX - world.positionXWorld[pidx];
    const dy = targetY - world.positionYWorld[pidx];
    world.forceX[pidx] += dx * SHIELD_SPRING_STRENGTH;
    world.forceY[pidx] += dy * SHIELD_SPRING_STRENGTH;

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
