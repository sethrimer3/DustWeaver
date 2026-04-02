/**
 * Progression Unlocks — functions for granting new abilities and resources.
 *
 * The intended early-game progression:
 *   1. New profile starts empty
 *   2. Unlock Cycle passive technique (dust orbits around the player)
 *   3. Unlock Golden Dust + 2 dust containers (auto-configured, no menu needed)
 *
 * After the initial auto-assignment, future customization happens at save tombs.
 */

import { PlayerProgress } from './playerProgress';
import { PassiveTechniqueId, isPassiveTechniqueUnlocked } from './passiveTechniques';
import { ParticleKind } from '../sim/particles/kinds';
import { CAPACITY_PER_CONTAINER, getMaxParticlesForDust } from './dustCapacity';
import { WeaveId } from '../sim/weaves/weaveDefinition';

// ---- Passive technique unlocks ---------------------------------------------

/**
 * Unlocks a passive technique if not already unlocked.
 * Returns true if the technique was newly unlocked.
 */
export function unlockPassiveTechnique(
  progress: PlayerProgress,
  techniqueId: PassiveTechniqueId,
): boolean {
  if (isPassiveTechniqueUnlocked(progress.unlockedPassiveTechniques, techniqueId)) {
    return false;
  }
  progress.unlockedPassiveTechniques.push(techniqueId);
  return true;
}

// ---- Dust type unlocks -----------------------------------------------------

/**
 * Unlocks a dust type if not already unlocked.
 * Returns true if the dust type was newly unlocked.
 */
export function unlockDustType(
  progress: PlayerProgress,
  kind: ParticleKind,
): boolean {
  if (progress.unlockedDustKinds.indexOf(kind) !== -1) {
    return false;
  }
  progress.unlockedDustKinds.push(kind);
  return true;
}

// ---- Active weave unlocks --------------------------------------------------

/**
 * Unlocks an active weave if not already unlocked.
 * Returns true if the weave was newly unlocked.
 */
export function unlockActiveWeave(
  progress: PlayerProgress,
  weaveId: WeaveId,
): boolean {
  if (progress.unlockedActiveWeaves.indexOf(weaveId) !== -1) {
    return false;
  }
  progress.unlockedActiveWeaves.push(weaveId);
  return true;
}

// ---- Container grants ------------------------------------------------------

/**
 * Grants additional dust containers to the player.
 */
export function grantDustContainers(
  progress: PlayerProgress,
  count: number,
): void {
  progress.dustContainerCount += count;
}

// ---- Early auto-assignment -------------------------------------------------

/**
 * Performs the initial early-game auto-assignment:
 *   - Grants 2 dust containers (8 total capacity)
 *   - Unlocks Golden Dust (ParticleKind.Physical)
 *   - Unlocks Cycle passive technique
 *   - Sets hasCompletedEarlyAutoAssignment = true
 *
 * This should be called when the player reaches the first unlock trigger.
 * It does NOT require visiting a save tomb.
 *
 * Returns the number of Golden Dust particles the player should now have
 * (based on capacity).
 */
export function performEarlyAutoAssignment(progress: PlayerProgress): number {
  if (progress.hasCompletedEarlyAutoAssignment) {
    // Already done — return current capacity
    return getMaxParticlesForDust(
      ParticleKind.Physical,
      progress.dustContainerCount * CAPACITY_PER_CONTAINER,
    );
  }

  // Unlock Cycle passive technique
  unlockPassiveTechnique(progress, 'cycle');

  // Grant 2 dust containers (8 capacity)
  grantDustContainers(progress, 2);

  // Unlock Golden Dust
  unlockDustType(progress, ParticleKind.Physical);

  // Mark auto-assignment as complete
  progress.hasCompletedEarlyAutoAssignment = true;

  // Return the number of Golden Dust particles (8 capacity / 1 cost = 8 particles)
  return getMaxParticlesForDust(
    ParticleKind.Physical,
    progress.dustContainerCount * CAPACITY_PER_CONTAINER,
  );
}
